"""Interview routes: transcription and per-answer speech analysis."""

from __future__ import annotations

import logging

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)

from app.core.limiter import TRANSCRIBE_LIMIT, limiter
from app.core.security import get_current_user
from app.models import User
from app.services.filler_service import filler_service
from app.services.stt_service import MAX_AUDIO_BYTES, STTUnavailableError, stt_service

logger = logging.getLogger(__name__)

# One second of near-silence, used only by the health probe to confirm the
# account can actually bill a transcription.
_SILENT_WAV = (
    b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00"
    b"\x02\x00\x10\x00data\x00\x00\x00\x00" + b"\x00\x00" * 8000
)

router = APIRouter(prefix="/interview", tags=["interview"])

# Which HTTP status each failure deserves. Retrying only helps for the last two.
STT_ERROR_STATUS = {
    "auth": status.HTTP_401_UNAUTHORIZED,
    "bad_format": status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
    "bad_request": status.HTTP_400_BAD_REQUEST,
    "server": status.HTTP_503_SERVICE_UNAVAILABLE,
    "not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
    "quota": status.HTTP_429_TOO_MANY_REQUESTS,
    "rate_limit": status.HTTP_429_TOO_MANY_REQUESTS,
    "empty": status.HTTP_400_BAD_REQUEST,
    "too_large": status.HTTP_413_CONTENT_TOO_LARGE,
    "connection": status.HTTP_503_SERVICE_UNAVAILABLE,
    "api": status.HTTP_503_SERVICE_UNAVAILABLE,
}


@router.get(
    "/health",
    summary="Check that OpenAI is reachable and Whisper is available",
)
async def interview_health() -> dict:
    """Report whether speech-to-text can actually run.

    Unauthenticated, so it can be opened in a browser while debugging. It
    transcribes one second of silence rather than merely listing models,
    because a key can authenticate and still be out of daily quota - and only a
    real call reveals that.
    """
    if not stt_service.is_configured:
        return {
            "provider": "groq",
            "groq_stt": "not_configured",
            "whisper": "unavailable",
            "detail": "GROQ_API_KEY is missing or still a placeholder. Set it in "
            "backend/.env and restart the server. Free keys: "
            "https://console.groq.com/keys",
        }

    # One real call is the only honest check: a key can authenticate and still
    # be out of daily quota, in which case nothing will actually transcribe.
    try:
        await stt_service.transcribe_audio_async(_SILENT_WAV, content_type="audio/wav")
        return {
            "provider": "groq",
            "groq_stt": "connected",
            "whisper": "available",
            "model": stt_service.model,
        }
    except STTUnavailableError as exc:
        reachable = exc.kind not in {"auth", "not_configured"}
        return {
            "provider": "groq",
            "groq_stt": "connected" if reachable else "unauthorised",
            "whisper": "unavailable",
            "model": stt_service.model,
            "reason": exc.kind,
            "detail": str(exc),
        }



@router.post(
    "/transcribe",
    summary="Transcribe an audio chunk and analyse its delivery",
    responses={
        401: {"description": "Missing, expired or invalid token"},
        413: {"description": "Recording too large"},
        429: {"description": "Too many transcription requests"},
        503: {"description": "Speech-to-text unavailable"},
    },
)
@limiter.limit(TRANSCRIBE_LIMIT)
async def transcribe(
    request: Request,
    response: Response,
    file: UploadFile = File(..., description="Recorded audio (webm/ogg/mp4/wav)."),
    duration_seconds: float | None = Form(default=None),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Transcribe one recording and return its filler/pace metrics.

    Used for the live partial transcript while the candidate is still speaking,
    so it stays stateless: nothing is written to the database here. The answer
    is persisted once, over the interview WebSocket.
    """
    audio = await file.read()

    if not audio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The recording was empty."
        )
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Recording exceeds the {MAX_AUDIO_BYTES // 1_048_576} MB limit.",
        )

    try:
        transcript = await stt_service.transcribe_audio_async(
            audio, content_type=file.content_type
        )
    except STTUnavailableError as exc:
        # Answer with the status code that matches what actually failed. A blanket
        # 503 tells the client to retry, which is wrong for a bad key or an empty
        # credit balance - neither improves by trying again.
        logger.error(
            "Transcription failed for %s (%s): %s",
            current_user.username,
            exc.kind,
            exc.detail or exc,
        )
        raise HTTPException(
            status_code=STT_ERROR_STATUS.get(exc.kind, status.HTTP_503_SERVICE_UNAVAILABLE),
            detail=str(exc),
            headers={"X-Error-Kind": exc.kind},
        ) from exc
    except Exception as exc:  # noqa: BLE001 - never surface a bare 500 here
        logger.exception("Unexpected transcription failure for %s", current_user.username)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Transcription failed unexpectedly: {exc}",
        ) from exc

    analysis = filler_service.analyse(transcript, duration_seconds)
    logger.debug(
        "Transcribed %d bytes for %s (%d words)",
        len(audio),
        current_user.username,
        analysis["word_count"],
    )

    return {
        "transcript": transcript,
        "filler_data": {
            "count": analysis["count"],
            "words": analysis["words"],
            "per_minute": analysis["per_minute"],
            "flagged_words": analysis["flagged_words"],
        },
        "wpm": analysis["wpm"],
        "word_count": analysis["word_count"],
        "confidence_score": analysis["confidence_score"],
    }
