"""Session routes: create, list, retrieve and end interview sessions."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.schemas import SessionCreate, SessionResponse, SessionSummary
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import InterviewSession, User
from app.models.session import SessionStatus

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
