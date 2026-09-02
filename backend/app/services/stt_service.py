"""Speech-to-text via Groq's hosted Whisper.

Transcription is the only thing that runs on Groq - feedback and scoring stay
on OpenAI. Groq's free tier covers Whisper, which is why the split exists.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Final

from groq import (
    APIConnectionError,
    APIError,
    AsyncGroq,
    AuthenticationError,
    Groq,
    RateLimitError,
)

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

PLACEHOLDER_KEYS: Final[frozenset[str]] = frozenset(
    {"", "your-groq-key-here", "gsk-replace-me", "changeme", "test"}
)

# Groq caps free-tier uploads at 25 MB, same as Whisper hosted elsewhere.
MAX_AUDIO_BYTES: Final[int] = 25 * 1024 * 1024

# Extensions Groq accepts, mapped from the browser's content type. The filename
# matters: the API infers the container from it, so a webm blob sent as
# "audio.wav" is rejected.
CONTENT_TYPE_EXTENSIONS: Final[dict[str, str]] = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
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

# Groq's default Whisper model.
DEFAULT_MODEL: Final[str] = "whisper-large-v3-turbo"

# OpenAI model ids that Groq does not serve. A .env left over from the OpenAI
# setup would otherwise fail every transcription with a bare 404, which reads as
# a broken key rather than a stale setting.
LEGACY_MODEL_IDS: Final[frozenset[str]] = frozenset({"whisper-1", "whisper"})

# Whisper emits these for silence or unintelligible audio; treating one as a
# real answer would score an empty recording as a confident one.
_NON_SPEECH = re.compile(
    r"^\s*(you|thank you\.?|thanks for watching\.?|\[?(silence|inaudible|music|blank_audio)\]?\.?|\.|,)\s*$",
    re.IGNORECASE,
)


class STTUnavailableError(RuntimeError):
    """Transcription could not be performed.

    Carries `kind` so the route can answer with a status code that matches what
    actually went wrong, and `detail` with the provider's own message. Raising a
    blanket 503 here instead would send the caller into a retry loop for
    problems retrying cannot fix, such as a bad key.
    """

    def __init__(self, message: str, *, kind: str = "unavailable", detail: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.detail = detail


class STTService:
    """Transcribes candidate audio through Groq Whisper.

    Exposes both a blocking and an async method: the request path needs the
    async one to avoid stalling the event loop, while scripts and background
    jobs can use the blocking call.
    """

    def __init__(self) -> None:
        self._client: Groq | None = None
        self._async_client: AsyncGroq | None = None
        configured = (settings.WHISPER_MODEL or "").strip()
        if configured in LEGACY_MODEL_IDS:
            logger.warning(
                "WHISPER_MODEL=%r is an OpenAI model id and Groq does not serve it; "
                "using %r instead. Update backend/.env to silence this.",
                configured,
                DEFAULT_MODEL,
            )
            configured = DEFAULT_MODEL
        self.model = configured or DEFAULT_MODEL

    @property
    def is_configured(self) -> bool:
        key = (settings.GROQ_API_KEY or "").strip()
        return key not in PLACEHOLDER_KEYS and len(key) > 20

    @property
    def client(self) -> Groq:
        # Built on first use rather than in __init__: this service is a
        # module-level singleton, so constructing it eagerly would run at import
        # time, before anything can report a misconfiguration usefully.
        if self._client is None:
            self._client = Groq(api_key=settings.GROQ_API_KEY)
        return self._client

    @property
    def async_client(self) -> AsyncGroq:
        if self._async_client is None:
            self._async_client = AsyncGroq(api_key=settings.GROQ_API_KEY)
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
                "Speech-to-text is not configured. Set GROQ_API_KEY in "
                "backend/.env and restart the server - settings are read once at "
                "startup, so a key added afterwards is not picked up. Get a free "
                "key at https://console.groq.com/keys",
                kind="not_configured",
            )

    @staticmethod
    def _provider_message(exc: Exception) -> str:
        """Groq's own message, when it exposes one."""
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict) and error.get("message"):
                return str(error["message"])
        return str(exc)

    @classmethod
    def _wrap_api_error(cls, exc: Exception) -> STTUnavailableError:
        detail = cls._provider_message(exc)

        if isinstance(exc, AuthenticationError):
            return STTUnavailableError(
                "The Groq API key is invalid. Check GROQ_API_KEY in backend/.env.",
                kind="auth",
                detail=detail,
            )

        if isinstance(exc, RateLimitError):
            # Groq's free tier is rate limited per minute and per day. Both come
            # back as 429, but only the per-minute one is worth retrying soon.
            daily = "daily" in detail.lower() or "per day" in detail.lower()
            return STTUnavailableError(
                (
                    "The Groq daily free-tier limit has been reached. It resets "
                    "every 24 hours - use the text input until then."
                    if daily
                    else "Groq rate limit reached. Please try again in a moment."
                ),
                kind="quota" if daily else "rate_limit",
                detail=detail,
            )

        if isinstance(exc, APIConnectionError):
            return STTUnavailableError(
                "Could not reach Groq. Check your network connection.",
                kind="connection",
                detail=detail,
            )

        return STTUnavailableError(
            f"Transcription failed: {detail}", kind="api", detail=detail
        )

    # ---- Transcription ---------------------------------------------------- #
    def transcribe_audio(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = "en"
    ) -> str:
        """Transcribe audio. Blocking - do not call from the event loop.

        Returns the cleaned transcript, or "" when the audio held no speech.
        """
        self._validate(audio_bytes)
        try:
            result = self.client.audio.transcriptions.create(
                file=(
                    self.filename_for(content_type),
                    audio_bytes,
                    content_type or "audio/webm",
                ),
                model=self.model,
                response_format="text",
                **({"language": language} if language else {}),
            )
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            logger.error(
                "Groq transcription failed (%s): %s",
                type(exc).__name__,
                self._provider_message(exc),
                exc_info=True,
            )
            raise self._wrap_api_error(exc) from exc

        return self.clean_transcript(
            result if isinstance(result, str) else getattr(result, "text", "")
        )

    async def transcribe_audio_async(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = "en"
    ) -> str:
        """Async transcription, for the request and WebSocket paths."""
        self._validate(audio_bytes)
        try:
            result = await self.async_client.audio.transcriptions.create(
                file=(
                    self.filename_for(content_type),
                    audio_bytes,
                    content_type or "audio/webm",
                ),
                model=self.model,
                response_format="text",
                **({"language": language} if language else {}),
            )
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            logger.error(
                "Groq transcription failed (%s): %s",
                type(exc).__name__,
                self._provider_message(exc),
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
