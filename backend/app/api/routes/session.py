"""Session routes: create, list, retrieve and end interview sessions."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.schemas import SessionCreate, SessionResponse, SessionSummary
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Answer, InterviewSession, User
from app.models.session import SessionStatus
from app.services.llm_service import llm_service
from app.services.score_service import score_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])

# TODO: retrieve-one and end-session endpoints.


@router.get(
    "/my-sessions",
    response_model=list[SessionSummary],
    summary="Every interview session belonging to the signed-in user",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
def list_my_sessions(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[InterviewSession]:
    """Return the caller's sessions, newest first.

    Scoped to `current_user` at the query level, so one account can never read
    another's history by guessing ids. The dashboard derives its own totals and
    averages from this list.
    """
    sessions = db.scalars(
        select(InterviewSession)
        .where(InterviewSession.user_id == current_user.id)
        .order_by(InterviewSession.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return list(sessions)


@router.post(
    "/create",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a new interview session",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
def create_session(
    payload: SessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Open a session for the signed-in user and return it.

    The owner comes from the bearer token, never from the request body, so a
    caller cannot create a session against someone else's account. The session
    starts in `active`; scores stay null until it is graded.
    """
    session = InterviewSession(
        user_id=current_user.id,
        job_role=payload.job_role.value,
        difficulty=payload.difficulty.value,
        status=SessionStatus.ACTIVE.value,
    )
    db.add(session)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not create a session for user %s", current_user.id)
        raise

    db.refresh(session)
    logger.info(
        "Created session %s (%s / %s) for %s",
        session.id,
        session.job_role,
        session.difficulty,
        current_user.username,
    )
    return session


@router.post(
    "/{session_id}/complete",
    response_model=SessionResponse,
    summary="Score an interview and generate its final feedback",
    responses={
        401: {"description": "Missing, expired or invalid token"},
        404: {"description": "No such session for this user"},
    },
)
async def complete_session(
    session_id: uuid.UUID = Path(..., description="The interview to finalise."),
    regenerate: bool = Query(
        default=False,
        description="Recompute even if feedback already exists.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Compute every score, write the verdict, and return the finished session.

    Safe to call more than once: a session that already carries feedback is
    returned as-is unless `regenerate` is set, so a retry after a dropped
    response does not spend another LLM call. The socket may already have
    aggregated the numeric scores; this recomputes them from the same service,
    so the result is identical either way.
    """
    session = db.scalar(
        select(InterviewSession).where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == current_user.id,
        )
    )
    if session is None:
        # Same answer whether it does not exist or belongs to someone else.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    if session.final_feedback and not regenerate:
        return session

    answers = db.scalars(
        select(Answer)
        .where(Answer.session_id == session.id)
        .order_by(Answer.question_number)
    ).all()

    scores = score_service.calculate_session_scores(list(answers))
    feedback = await score_service.generate_final_feedback(
        session, list(answers), llm_service
    )

    session.answer_score = scores["answer_score"]
    session.communication_score = scores["communication_score"]
    session.confidence_score = scores["confidence_score"]
    session.filler_word_score = scores["filler_word_score"] if answers else None
    session.overall_score = scores["overall_score"]
    session.total_filler_count = scores["total_filler_count"]
    session.avg_wpm = scores["avg_wpm"]
    session.duration_minutes = scores["duration_minutes"]
    session.final_feedback = feedback
    session.status = SessionStatus.COMPLETED.value
    if session.completed_at is None:
        session.completed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(session)
    logger.info(
        "Completed session %s for %s (overall=%s, feedback=%s)",
        session.id,
        current_user.username,
        session.overall_score,
        feedback.get("source"),
    )
    return session
