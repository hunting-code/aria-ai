"""ARIA's voice, via ElevenLabs.

The API key must never reach the browser, so synthesis is proxied here: the
client asks this service for audio and gets back an MP3.

Nothing in the interview depends on this succeeding. Every failure path - no
key, quota exhausted, network down - returns a typed error the client answers
by falling back to the browser's own speech synthesis. Dead silence mid-answer
would be worse than a robotic voice.
"""

from __future__ import annotations

import logging
from typing import Final

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

API_URL: Final = "https://api.elevenlabs.io/v1/text-to-speech"
# Fastest model with acceptable quality; latency matters in a live interview.
MODEL_ID: Final = "eleven_turbo_v2_5"

# The voices offered in the lobby. Ids are ElevenLabs' stock voices.
VOICES: Final[dict[str, dict[str, str]]] = {
    "sarah": {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "blurb": "Professional female"},
    "rachel": {"id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "blurb": "Calm female"},
    "adam": {"id": "pNInz6obpgDQGcFmaJgB", "name": "Adam", "blurb": "Professional male"},
    "josh": {"id": "TxGEqnHWrfWFTfGW9XjX", "name": "Josh", "blurb": "Friendly male"},
}
DEFAULT_VOICE: Final = "sarah"

# A single turn is a question or a short debrief. Anything longer is a bug
# upstream, and sending it would burn the month's quota in one request.
MAX_CHARS: Final = 2_500


class TTSUnavailableError(RuntimeError):
    """Synthesis did not happen. `kind` tells the client why."""

    def __init__(self, detail: str, kind: str = "unavailable") -> None:
        super().__init__(detail)
        self.kind = kind


class TTSService:
    @property
    def is_configured(self) -> bool:
        key = (settings.ELEVENLABS_API_KEY or "").strip()
        return bool(key) and key != "your-elevenlabs-key-here"

    @staticmethod
    def voice_id(voice: str | None) -> str:
        return VOICES.get((voice or "").lower(), VOICES[DEFAULT_VOICE])["id"]

    async def synthesize(self, text: str, voice: str | None = None) -> bytes:
        """Return MP3 bytes for `text`, or raise TTSUnavailableError."""
        clean = (text or "").strip()
        if not clean:
            raise TTSUnavailableError("Nothing to speak.", kind="empty")
        if not self.is_configured:
            raise TTSUnavailableError(
                "Premium speech is not configured.", kind="not_configured"
            )

        payload = {
            "text": clean[:MAX_CHARS],
            "model_id": MODEL_ID,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "style": 0.0,
                "use_speaker_boost": True,
            },
        }
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": settings.ELEVENLABS_API_KEY,
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    f"{API_URL}/{self.voice_id(voice)}", json=payload, headers=headers
                )
        except httpx.RequestError as exc:
            logger.warning("ElevenLabs unreachable: %s", exc)
            raise TTSUnavailableError(
                "Could not reach the speech service.", kind="connection"
            ) from exc

        if response.status_code == 401:
            raise TTSUnavailableError("The speech API key is invalid.", kind="auth")
        if response.status_code == 429:
            # The expected end state on a free tier. The client falls back
            # silently rather than telling the candidate about a billing limit
            # in the middle of their interview.
            raise TTSUnavailableError(
                "The monthly speech quota is used up.", kind="quota"
            )
        if response.status_code >= 400:
            logger.warning(
                "ElevenLabs returned %s: %s", response.status_code, response.text[:200]
            )
            raise TTSUnavailableError("Speech synthesis failed.", kind="api")

        audio = response.content
        if not audio:
            raise TTSUnavailableError("Speech synthesis returned nothing.", kind="api")
        return audio


tts_service = TTSService()
