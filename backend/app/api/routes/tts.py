"""Speech synthesis proxy. Keeps the ElevenLabs key server-side."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.models import User
from app.services.tts_service import (
    DEFAULT_VOICE,
    VOICES,
    TTSUnavailableError,
    tts_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts", tags=["tts"])

# Which failures the client should answer by falling back quietly, rather than
# surfacing. All of them, in practice: a candidate mid-interview can do nothing
# useful with "the quota is exhausted".
_STATUS = {
    "not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
    "quota": status.HTTP_429_TOO_MANY_REQUESTS,
    "auth": status.HTTP_503_SERVICE_UNAVAILABLE,
    "connection": status.HTTP_503_SERVICE_UNAVAILABLE,
    "empty": status.HTTP_400_BAD_REQUEST,
    "api": status.HTTP_502_BAD_GATEWAY,
}


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str | None = None


@router.get("/voices")
def list_voices(_: User = Depends(get_current_user)) -> dict:
    """The voices the lobby offers, and whether premium speech is available."""
    return {
        "available": tts_service.is_configured,
        "default": DEFAULT_VOICE,
        "voices": [{"id": k, **{m: v for m, v in val.items() if m != "id"}} for k, val in VOICES.items()],
    }


@router.post(
    "/speak",
    responses={
        200: {"content": {"audio/mpeg": {}}, "description": "MP3 audio"},
        429: {"description": "Monthly quota exhausted - fall back client-side"},
        503: {"description": "Not configured or unreachable - fall back client-side"},
    },
)
async def speak(
    payload: SpeakRequest,
    _: User = Depends(get_current_user),
) -> Response:
    """Synthesize one turn of speech.

    Any failure here is recoverable: the client falls back to the browser's own
    speech synthesis, so the interview continues either way.
    """
    try:
        audio = await tts_service.synthesize(payload.text, payload.voice)
    except TTSUnavailableError as exc:
        raise HTTPException(
            status_code=_STATUS.get(exc.kind, 503),
            detail=str(exc),
            headers={"X-TTS-Fallback": exc.kind},
        )
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )
