"""Speech-to-text via the OpenAI Whisper API."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Final

from openai import (
    APIConnectionError,
    APIError,
    AsyncOpenAI,
    AuthenticationError,
    OpenAI,
    RateLimitError,
)

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

PLACEHOLDER_KEYS: Final[frozenset[str]] = frozenset(
    {"", "sk-replace-me", "your-openai-key-here", "sk-test", "changeme"}
)

# Whisper rejects anything larger than 25 MB.
MAX_AUDIO_BYTES: Final[int] = 25 * 1024 * 1024

# Extensions Whisper accepts, mapped from the browser's content type. The
# filename matters: the API infers the container format from it, so a webm blob
# sent as "audio.wav" is rejected.
CONTENT_TYPE_EXTENSIONS: Final[dict[str, str]] = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/flac": "flac",
}
DEFAULT_EXTENSION: Final[str] = "webm"

# Whisper emits these for silence or unintelligible audio; treating one as a
# real answer would score an empty recording as a confident one.
_NON_SPEECH = re.compile(
    r"^\s*(you|thank you\.?|thanks for watching\.?|\[?(silence|inaudible|music)\]?\.?|\.|,)\s*$",
    re.IGNORECASE,
)


class STTUnavailableError(RuntimeError):
    """Transcription could not be performed.

    Carries `kind` so the route can answer with a status code that matches what
    actually went wrong, and `detail` with the provider's own message. A single
    opaque 503 for every failure sends the caller into a retry loop for problems
    that retrying cannot fix - an exhausted credit balance being the obvious one.
    """

    def __init__(self, message: str, *, kind: str = "unavailable", detail: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.detail = detail


class STTService:
    """Transcribes candidate audio through Whisper.

    Exposes both a blocking and an async method: the request path needs the
    async one to avoid stalling the event loop, while scripts and background
    jobs can use the blocking call.
    """

    def __init__(self) -> None:
        self._client: OpenAI | None = None
        self._async_client: AsyncOpenAI | None = None
        self.model = settings.WHISPER_MODEL

    @property
    def is_configured(self) -> bool:
        key = (settings.OPENAI_API_KEY or "").strip()
        return key not in PLACEHOLDER_KEYS and len(key) > 20

    @property
    def client(self) -> OpenAI:
        # Built on first use, not at import: settings are read once at startup,
        # and constructing this eagerly would fail the module when no key is set.
        if self._client is None:
            self._client = OpenAI(api_key=settings.OPENAI_API_KEY)
        return self._client

    @property
    def async_client(self) -> AsyncOpenAI:
        if self._async_client is None:
            self._async_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        return self._async_client

    # ---- Helpers ---------------------------------------------------------- #
    @staticmethod
    def filename_for(content_type: str | None) -> str:
        ext = CONTENT_TYPE_EXTENSIONS.get(
            (content_type or "").split(";")[0].strip().lower(), DEFAULT_EXTENSION
        )
        return f"audio.{ext}"

    @staticmethod
    def clean_transcript(text: str) -> str:
        """Normalise whitespace and drop Whisper's silence artefacts."""
        cleaned = re.sub(r"\s+", " ", (text or "")).strip()
        if not cleaned or _NON_SPEECH.match(cleaned):
            return ""
        return cleaned

    def _validate(self, audio_bytes: bytes) -> None:
        if not audio_bytes:
            raise STTUnavailableError("The recording was empty.", kind="empty")
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise STTUnavailableError(
                f"That recording is {len(audio_bytes) / 1_048_576:.1f} MB; "
                f"the limit is {MAX_AUDIO_BYTES // 1_048_576} MB.",
                kind="too_large",
            )
        if not self.is_configured:
            # Silently returning "" would look to the candidate like their
            # answer was not heard, so this is an error, not an empty result.
            raise STTUnavailableError(
                "Speech-to-text is not configured. Set OPENAI_API_KEY in "
                "backend/.env and restart the server - settings are read once at "
                "startup, so a key added afterwards is not picked up.",
                kind="not_configured",
            )

    @staticmethod
    def _openai_message(exc: Exception) -> str:
        """The provider's own message, when it exposes one."""
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict) and error.get("message"):
                return str(error["message"])
        return str(exc)

    @classmethod
    def _wrap_api_error(cls, exc: Exception) -> STTUnavailableError:
        detail = cls._openai_message(exc)

        if isinstance(exc, AuthenticationError):
            return STTUnavailableError(
                "OpenAI API key is invalid or missing.", kind="auth", detail=detail
            )

        if isinstance(exc, RateLimitError):
            # OpenAI returns 429 both for genuine rate limiting and for an
            # exhausted credit balance. They need opposite advice: one says wait,
            # the other says add credit, and telling a user to wait for the
            # second is why this once looked like an intermittent fault.
            code = ""
            body = getattr(exc, "body", None)
            if isinstance(body, dict) and isinstance(body.get("error"), dict):
                code = str(body["error"].get("code") or body["error"].get("type") or "")
            if "quota" in code or "credit" in code or "quota" in detail.lower():
                return STTUnavailableError(
                    "The OpenAI account has no credits remaining, so audio cannot "
                    "be transcribed. Add credits at platform.openai.com/settings/"
                    "organization/billing, or use the text input instead.",
                    kind="quota",
                    detail=detail,
                )
            return STTUnavailableError(
                "OpenAI rate limit reached. Please try again in a moment.",
                kind="rate_limit",
                detail=detail,
            )

        if isinstance(exc, APIConnectionError):
            return STTUnavailableError(
                "Could not reach OpenAI. Check your network connection.",
                kind="connection",
                detail=detail,
            )

        return STTUnavailableError(
            f"Transcription failed: {detail}", kind="api", detail=detail
        )

    # ---- Transcription ---------------------------------------------------- #
    def transcribe_audio(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = None
    ) -> str:
        """Transcribe audio. Blocking - do not call from the event loop.

        Returns the cleaned transcript, or "" when the audio held no speech.
        """
        self._validate(audio_bytes)
        try:
            result = self.client.audio.transcriptions.create(
                model=self.model,
                file=(self.filename_for(content_type), audio_bytes, content_type or "audio/webm"),
                response_format="text",
                **({"language": language} if language else {}),
            )
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            logger.error(
                "Whisper transcription failed (%s): %s",
                type(exc).__name__,
                self._openai_message(exc),
                exc_info=True,
            )
            raise self._wrap_api_error(exc) from exc

        return self.clean_transcript(
            result if isinstance(result, str) else getattr(result, "text", "")
        )

    async def transcribe_audio_async(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = None
    ) -> str:
        """Async transcription, for the request and WebSocket paths."""
        self._validate(audio_bytes)
        try:
            result = await self.async_client.audio.transcriptions.create(
                model=self.model,
                file=(self.filename_for(content_type), audio_bytes, content_type or "audio/webm"),
                response_format="text",
                **({"language": language} if language else {}),
            )
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            logger.error(
                "Whisper transcription failed (%s): %s",
                type(exc).__name__,
                self._openai_message(exc),
                exc_info=True,
            )
            raise self._wrap_api_error(exc) from exc
        except asyncio.CancelledError:
            # The candidate navigated away mid-request; not an error worth logging.
            raise

        return self.clean_transcript(
            result if isinstance(result, str) else getattr(result, "text", "")
        )


stt_service = STTService()

__all__ = [
    "STTService",
    "STTUnavailableError",
    "MAX_AUDIO_BYTES",
    "CONTENT_TYPE_EXTENSIONS",
    "PLACEHOLDER_KEYS",
    "stt_service",
]
