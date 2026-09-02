"""Speech-to-text via Gemini.

Gemini has no dedicated speech endpoint: audio is attached to an ordinary
generate_content call. It also does not accept WebM, which is what
MediaRecorder produces by default, so the browser records WAV instead - see
frontend/src/hooks/useAudio.js.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Final

from app.core.config import get_settings
from app.services.gemini_client import SUPPORTED_AUDIO_MIME, GeminiError, gemini

logger = logging.getLogger(__name__)
settings = get_settings()

# Inline audio must stay under Gemini's ~20 MB request ceiling. WAV is
# uncompressed, so this is roughly ten minutes of 16 kHz mono speech.
MAX_AUDIO_BYTES: Final[int] = 18 * 1024 * 1024

# Normalises what a browser reports to what Gemini names. Anything not in
# SUPPORTED_AUDIO_MIME is refused before the request is made, with a message
# that says which formats do work.
CONTENT_TYPE_ALIASES: Final[dict[str, str]] = {
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/mp3": "audio/mpeg",
    "audio/mpga": "audio/mpeg",
    "audio/x-m4a": "audio/aac",
    "audio/mp4": "audio/aac",
}
DEFAULT_AUDIO_MIME: Final[str] = "audio/wav"

# Phrases a model may emit instead of an empty string when it hears nothing.
# Treating one as a real answer would score silence as a confident reply.
_NON_SPEECH = re.compile(
    r"^\s*(you|thank you\.?|thanks for watching\.?|\[?(silence|no speech|inaudible|music)\]?\.?|\.|,)\s*$",
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
    """Transcribes candidate audio through Gemini."""

    def __init__(self) -> None:
        self.model = settings.GEMINI_AUDIO_MODEL

    @property
    def is_configured(self) -> bool:
        return gemini.is_configured

    # ---- Helpers ---------------------------------------------------------- #
    @staticmethod
    def normalise_mime(content_type: str | None) -> str:
        """Map a browser content type onto one Gemini names."""
        raw = (content_type or "").split(";")[0].strip().lower()
        if not raw:
            return DEFAULT_AUDIO_MIME
        return CONTENT_TYPE_ALIASES.get(raw, raw)

    @staticmethod
    def clean_transcript(text: str) -> str:
        """Normalise whitespace and drop non-speech artefacts."""
        cleaned = re.sub(r"\s+", " ", (text or "")).strip()
        # Models sometimes narrate silence rather than returning nothing.
        if not cleaned or _NON_SPEECH.match(cleaned):
            return ""
        return cleaned

    def _validate(self, audio_bytes: bytes, mime_type: str) -> None:
        if not audio_bytes:
            raise STTUnavailableError("The recording was empty.", kind="empty")
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise STTUnavailableError(
                f"That recording is {len(audio_bytes) / 1_048_576:.1f} MB; "
                f"the limit is {MAX_AUDIO_BYTES // 1_048_576} MB.",
                kind="too_large",
            )
        if mime_type not in SUPPORTED_AUDIO_MIME:
            raise STTUnavailableError(
                f"Audio format {mime_type!r} is not supported. Gemini accepts "
                "WAV, MP3, OGG, AAC and FLAC.",
                kind="bad_format",
                detail=mime_type,
            )
        if not self.is_configured:
            # Silently returning "" would look to the candidate like their
            # answer was not heard, so this is an error, not an empty result.
            raise STTUnavailableError(
                "Speech-to-text is not configured. Set GEMINI_API_KEY in "
                "backend/.env and restart the server - settings are read once at "
                "startup, so a key added afterwards is not picked up.",
                kind="not_configured",
            )

    # ---- Transcription ---------------------------------------------------- #
    async def transcribe_audio_async(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = None
    ) -> str:
        """Transcribe audio. Returns "" when it held no speech."""
        mime = self.normalise_mime(content_type)
        self._validate(audio_bytes, mime)
        try:
            text = await gemini.transcribe(audio_bytes, mime, model=self.model)
        except GeminiError as exc:
            raise STTUnavailableError(str(exc), kind=exc.kind, detail=exc.detail) from exc
        return self.clean_transcript(text)

    def transcribe_audio(
        self, audio_bytes: bytes, content_type: str | None = None, language: str | None = None
    ) -> str:
        """Blocking transcription, for scripts and background jobs."""
        return asyncio.run(
            self.transcribe_audio_async(audio_bytes, content_type, language)
        )


stt_service = STTService()

__all__ = [
    "STTService",
    "STTUnavailableError",
    "MAX_AUDIO_BYTES",
    "CONTENT_TYPE_ALIASES",
    "SUPPORTED_AUDIO_MIME",
    "stt_service",
]
