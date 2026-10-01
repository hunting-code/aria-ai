"""Career intelligence for a completed AI Meet, and the JD matcher."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Answer, InterviewSession, Resume, User
from app.services.career_service import CAREER_PROVIDER_ERRORS, career_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/career", tags=["career"])

MODEL_DOWN = "The AI service is temporarily unavailable. Please try again shortly."


def _load_meet(db: Session, session_id: uuid.UUID, user_id: uuid.UUID) -> InterviewSession:
    session = db.scalar(
        select(InterviewSession).where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == user_id,
            InterviewSession.deleted_at.is_(None),
        )
    )
    if session is None:
        # Same answer whether it does not exist or belongs to someone else.
        raise HTTPException(status_code=404, detail="Session not found")
    if session.session_type != "ai_meet":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Career intelligence is only generated for AI Meet interviews.",
        )
    return session


def _context(db: Session, session: InterviewSession, user: User):
    answers = db.scalars(
        select(Answer).where(Answer.session_id == session.id).order_by(Answer.question_number)
    ).all()
    digest = [
        {
            "question": a.question_text,
            "answer": (a.transcript or "")[:1200],
            "answer_score": a.answer_score,
            "phase": a.question_tag,
        }
        for a in answers
    ]
    resume_data = None
    if session.resume_used:
        resume = db.scalar(select(Resume).where(Resume.user_id == user.id))
        resume_data = resume.parsed_data if resume else None
    session_data = {
        "job_role": session.job_role,
        "overall_score": session.overall_score,
        "phase_scores": session.phase_scores,
    }
    return session_data, digest, resume_data


@router.get("/{session_id}")
async def career_report(
    session_id: uuid.UUID = Path(...),
    regenerate: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The seven-section report. Generated once, then served from the session."""
    session = _load_meet(db, session_id, current_user.id)

    stored = session.career_guidance or {}
    # The AI Meet writes a short guidance blob at completion; the full report
    # is only built when this page is first opened, so the cost is paid by
    # people who actually look at it.
    if stored.get("readiness") and not regenerate:
        return {"session_id": str(session.id), "resume_used": session.resume_used, **stored}

    session_data, digest, resume_data = _context(db, session, current_user)
    if not digest:
        raise HTTPException(
            status_code=422,
            detail="This interview has no answers to build a report from.",
        )

    try:
        report = await career_service.build_report(session_data, digest, resume_data)
    except CAREER_PROVIDER_ERRORS:
        logger.exception("Career report generation failed")
        raise HTTPException(status_code=503, detail=MODEL_DOWN)
    except (ValueError, KeyError):
        logger.exception("Career report came back unusable")
        raise HTTPException(status_code=502, detail=MODEL_DOWN)

    try:
        # Merge rather than replace: the completion-time guidance (debrief
        # summary, next steps) stays alongside the richer report.
        session.career_guidance = {**stored, **report}
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not store the career report")

    return {"session_id": str(session.id), "resume_used": session.resume_used, **report}


class JDMatchRequest(BaseModel):
    job_description: str = Field(min_length=40, max_length=20_000)
    session_id: uuid.UUID | None = None


@router.post("/jd-match")
async def jd_match(
    payload: JDMatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Score a pasted job description against this candidate."""
    session_data = digest = resume_data = None
    if payload.session_id is not None:
        session = _load_meet(db, payload.session_id, current_user.id)
        session_data, digest, resume_data = _context(db, session, current_user)
    else:
        # No session given: still match against the resume if there is one.
        resume = db.scalar(select(Resume).where(Resume.user_id == current_user.id))
        resume_data = resume.parsed_data if resume else None

    try:
        return await career_service.match_job_description(
            payload.job_description, session_data, digest, resume_data
        )
    except CAREER_PROVIDER_ERRORS:
        logger.exception("JD match failed")
        raise HTTPException(status_code=503, detail=MODEL_DOWN)
