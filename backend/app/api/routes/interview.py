"""Interview routes: transcription and per-answer speech analysis."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.security import get_current_user
from app.models import User
from app.services.filler_service import filler_service
from app.services.stt_service import MAX_AUDIO_BYTES, STTUnavailableError, stt_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/interview", tags=["interview"])

# TODO: question flow endpoints (the live interview runs over /ws/{session_id}).


@router.post(
    "/transcribe",
    summary="Transcribe an audio chunk and analyse its delivery",
    responses={
        401: {"description": "Missing, expired or invalid token"},
        413: {"description": "Recording too large"},
        503: {"description": "Speech-to-text unavailable"},
    },
)
async def transcribe(
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
        # A configuration or upstream problem, not the caller's fault.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
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
