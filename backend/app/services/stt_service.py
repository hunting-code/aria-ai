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
from app.services.llm_service import PLACEHOLDER_KEYS

logger = logging.getLogger(__name__)
settings = get_settings()

# Whisper rejects anything larger than 25 MB.
MAX_AUDIO_BYTES: Final[int] = 25 * 1024 * 1024

# Extensions the API accepts, mapped from the browser's content type. The
# filename matters: the API infers the container format from it, so a webm
# blob sent as "audio.wav" is rejected.
CONTENT_TYPE_EXTENSIONS: Final[dict[str, str]] = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
}
DEFAULT_EXTENSION: Final[str] = "webm"

# Whisper emits this for silence or unintelligible audio; treating it as a real
# answer would score an empty recording as a confident one.
_HALLUCINATED_SILENCE = re.compile(
    r"^\s*(you|thank you\.?|thanks for watching\.?|\.|,)\s*$", re.IGNORECASE
)


class STTUnavailableError(RuntimeError):
    """Transcription could not be performed."""


class STTService:
    """Transcribes candidate audio.

    Exposes both a blocking and an async method: the WebSocket path needs the
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
        if not cleaned or _HALLUCINATED_SILENCE.match(cleaned):
            return ""
        return cleaned

    def _validate(self, audio_bytes: bytes) -> None:
        if not audio_bytes:
            raise STTUnavailableError("The recording was empty.")
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise STTUnavailableError(
                f"That recording is {len(audio_bytes) / 1_048_576:.1f} MB; "
                f"the limit is {MAX_AUDIO_BYTES // 1_048_576} MB."
            )
        if not self.is_configured:
            # No offline fallback exists for speech: silently returning "" would
            # look to the candidate like their answer was not heard.
            raise STTUnavailableError(
                "Speech-to-text is not configured. Set OPENAI_API_KEY to enable it."
            )

    @staticmethod
    def _wrap_api_error(exc: Exception) -> STTUnavailableError:
        if isinstance(exc, AuthenticationError):
            return STTUnavailableError("Speech-to-text is not configured correctly.")
        if isinstance(exc, RateLimitError):
            return STTUnavailableError(
                "Transcription is busy right now. Please try again in a moment."
            )
        return STTUnavailableError("Transcription is temporarily unavailable.")

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
                file=(self.filename_for(content_type), audio_bytes),
                response_format="text",
                **({"language": language} if language else {}),
            )
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            logger.exception("Whisper transcription failed")
            raise self._wrap_api_error(exc) from exc

        return self.clean_transcript(result if isinstance(result, str) else getattr(result, "text", ""))

    async def transcribe_audio_async(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = None
    ) -> str:
        """Async transcription, for the request and WebSocket paths."""
        self._validate(audio_bytes)
        try:
            result = await self.async_client.audio.transcriptions.create(
                model=self.model,
                file=(self.filename_for(content_type), audio_bytes),
                response_format="text",
                **({"language": language} if language else {}),
            )
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError) as exc:
            logger.exception("Whisper transcription failed")
            raise self._wrap_api_error(exc) from exc
        except asyncio.CancelledError:
            # The candidate navigated away mid-request; not an error worth logging.
            raise

        return self.clean_transcript(result if isinstance(result, str) else getattr(result, "text", ""))


stt_service = STTService()

__all__ = [
    "STTService",
    "STTUnavailableError",
    "MAX_AUDIO_BYTES",
    "CONTENT_TYPE_EXTENSIONS",
    "stt_service",
]
