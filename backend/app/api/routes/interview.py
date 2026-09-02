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
    "not_configured": status.HTTP_503_SERVICE_UNAVAILABLE,
    "quota": status.HTTP_429_TOO_MANY_REQUESTS,
    "rate_limit": status.HTTP_429_TOO_MANY_REQUESTS,
    "empty": status.HTTP_400_BAD_REQUEST,
    "too_large": status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    "connection": status.HTTP_503_SERVICE_UNAVAILABLE,
    "api": status.HTTP_503_SERVICE_UNAVAILABLE,
}


@router.get(
    "/health",
    summary="Check that OpenAI is reachable and Whisper is available",
)
async def interview_health() -> dict:
    """Report whether speech-to-text can actually run.

    Deliberately unauthenticated and cheap: it lists models rather than
    transcribing, so it verifies the key and connectivity without spending
    credit. Note that a working key with an empty balance still lists models
    fine - `credits` below is what tells you transcription will really work.
    """
    if not stt_service.is_configured:
        return {
            "openai": "not_configured",
            "whisper": "unavailable",
            "detail": "OPENAI_API_KEY is missing or still a placeholder. Set it in "
            "backend/.env and restart the server.",
        }

    try:
        models = await stt_service.async_client.models.list()
        ids = {m.id for m in models.data}
    except Exception as exc:  # noqa: BLE001 - the point is to report any failure
        logger.error("OpenAI reachability check failed: %s", exc, exc_info=True)
        return {
            "openai": "unreachable",
            "whisper": "unavailable",
            "detail": stt_service._openai_message(exc)[:300],
        }

    whisper_ok = stt_service.model in ids

    # Listing models costs nothing and succeeds even with a zero balance, so it
    # cannot tell us transcription will work. Probe that separately.
    credits = "unknown"
    detail = ""
    try:
        await stt_service.transcribe_audio_async(_SILENT_WAV, content_type="audio/wav")
        credits = "available"
    except STTUnavailableError as exc:
        credits = "exhausted" if exc.kind == "quota" else "available"
        if exc.kind != "quota":
            credits = "unknown"
        detail = str(exc)

    return {
        "openai": "connected",
        "whisper": "available" if whisper_ok else "unavailable",
        "model": stt_service.model,
        "credits": credits,
        **({"detail": detail} if detail else {}),
    }

# TODO: question flow endpoints (the live interview runs over /ws/{session_id}).


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
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
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
