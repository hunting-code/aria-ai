"""Session routes: create, list, retrieve and end interview sessions."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from collections import Counter
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.schemas import (
    ProctoringPayload,
    SessionType,
    SessionCreate,
    SessionResponse,
    SessionStats,
    SessionSummary,
)
from app.core.database import get_db
from app.core.limiter import CREATE_SESSION_LIMIT, limiter
from app.core.security import get_current_user
from app.models import Answer, InterviewSession, Resume, User
from app.models.session import SessionStatus
from app.services.llm_service import (
    AI_MEET_PHASES,
    MODE_COACH,
    default_mode_for,
    generate_career_guidance,
    generate_verbal_debrief,
    llm_service,
)
from app.services.score_service import score_service

# Answers are tagged with the phase's display name ("Warm-up"); map back to the
# phase key the scorer and the model columns use.
PHASE_BY_LABEL: dict[str, str] = {
    meta["name"]: phase for phase, meta in AI_MEET_PHASES.items()
}


# Streak badge tiers. A streak counts consecutive *calendar days* on which at
# least one interview was completed.
STREAK_BADGES: tuple[tuple[int, str], ...] = (
    (30, "30-day"),
    (14, "14-day"),
    (7, "7-day"),
    (3, "3-day"),
)


def _streaks(sessions: list) -> tuple[int, int]:
    """Current and longest run of consecutive days with a completed session.

    Counting days rather than sessions means three interviews in one evening is
    a one-day streak, which is what "consecutive days" has to mean for the
    number to be worth anything. A streak stays alive if the last session was
    today or yesterday - finishing at 23:50 should not be punished by a clock.
    """
    days = sorted(
        {
            _aware(s.completed_at or s.created_at).date()
            for s in sessions
            if s.status == SessionStatus.COMPLETED.value and (s.completed_at or s.created_at)
        }
    )
    if not days:
        return 0, 0

    longest = run = 1
    for previous, day in zip(days, days[1:]):
        run = run + 1 if (day - previous).days == 1 else 1
        longest = max(longest, run)

    today = datetime.now(timezone.utc).date()
    gap = (today - days[-1]).days
    current = run if gap <= 1 else 0
    return current, longest


def _badge_for(streak: int) -> tuple[str | None, int | None]:
    """The badge earned, and how many more days until the next one."""
    earned = next((label for threshold, label in STREAK_BADGES if streak >= threshold), None)
    upcoming = [t for t, _ in reversed(STREAK_BADGES) if t > streak]
    return earned, (upcoming[0] - streak) if upcoming else None


def _aware(value: datetime) -> datetime:
    """Treat a naive timestamp as UTC. SQLite gives back naive datetimes and
    comparing one to an aware value raises TypeError."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])



@router.get(
    "/my-sessions",
    response_model=list[SessionSummary],
    summary="Every interview session belonging to the signed-in user",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
def list_my_sessions(
    response: Response,
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
    base = select(InterviewSession).where(
        InterviewSession.user_id == current_user.id,
        InterviewSession.deleted_at.is_(None),
    )

    total = db.scalar(
        select(func.count())
        .select_from(InterviewSession)
        .where(
            InterviewSession.user_id == current_user.id,
            InterviewSession.deleted_at.is_(None),
        )
    )
    # The body stays a plain list so existing callers keep working; the count
    # rides along in a header for the "load more" control.
    response.headers["X-Total-Count"] = str(total or 0)

    sessions = db.scalars(
        base.order_by(InterviewSession.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return list(sessions)


@router.post(
    "/create",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a new interview session",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
@limiter.limit(CREATE_SESSION_LIMIT)
def create_session(
    request: Request,
    # slowapi injects its X-RateLimit-* headers into this when the endpoint
    # returns something other than a Response - which an ORM object is.
    response: Response,
    payload: SessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Open a session for the signed-in user and return it.

    The owner comes from the bearer token, never from the request body, so a
    caller cannot create a session against someone else's account. The session
    starts in `active`; scores stay null until it is graded.
    """
    # AI Meet can interview from the candidate's resume. The resume is looked
    # up by owner, never trusted from the request body, so a caller cannot
    # attach someone else's resume by guessing an id.
    is_meet = payload.session_type is SessionType.AI_MEET
    resume_used = False
    if is_meet and payload.resume_id is not None:
        resume = db.scalar(
            select(Resume).where(
                Resume.id == payload.resume_id,
                Resume.user_id == current_user.id,
            )
        )
        if resume is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="That resume was not found on your account.",
            )
        resume_used = bool(resume.parsed_data)

    session = InterviewSession(
        user_id=current_user.id,
        job_role=payload.job_role.value,
        difficulty=payload.difficulty.value,
        status=SessionStatus.ACTIVE.value,
        # Coaching by default, pressure for advanced. The candidate can toggle
        # it mid-interview.
        coach_mode=default_mode_for(payload.difficulty.value) == MODE_COACH,
        session_type=payload.session_type.value,
        meet_phase="warmup" if is_meet else None,
        resume_used=resume_used,
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


@router.get(
    "/stats",
    response_model=SessionStats,
    summary="Dashboard aggregates across every session",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
def session_stats(
    trend_length: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SessionStats:
    """Totals, averages and trends for the signed-in user.

    Declared above "/{session_id}" on purpose: FastAPI matches in declaration
    order, and the dynamic route would otherwise swallow "stats" and fail to
    parse it as a UUID.
    """
    sessions = list(
        db.scalars(
            select(InterviewSession)
            .where(
                InterviewSession.user_id == current_user.id,
                InterviewSession.deleted_at.is_(None),
            )
            .order_by(InterviewSession.created_at.desc())
        ).all()
    )

    scored = [s for s in sessions if s.overall_score is not None]
    scores = [s.overall_score for s in scored]

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    def _recent(attr: str) -> list[dict]:
        # Oldest-first so the charts read left to right.
        points = [s for s in sessions if getattr(s, attr) is not None][:trend_length]
        return [
            {"session_id": s.id, "date": s.created_at, "value": getattr(s, attr)}
            for s in reversed(points)
        ]

    def _avg(attr: str) -> float | None:
        values = [getattr(s, attr) for s in sessions if getattr(s, attr) is not None]
        return round(sum(values) / len(values), 1) if values else None

    # Sessions per week for the last four weeks, oldest bucket first.
    per_week: list[dict] = []
    now = datetime.now(timezone.utc)
    for week in range(3, -1, -1):
        start = now - timedelta(days=7 * (week + 1))
        end = now - timedelta(days=7 * week)
        count = sum(
            1
            for s in sessions
            if s.created_at and start < _aware(s.created_at) <= end
        )
        per_week.append({"week": f"{week + 1}w ago" if week else "This week", "sessions": count})

    roles = Counter(s.job_role for s in sessions if s.job_role)
    current_streak, longest_streak = _streaks(sessions)
    badge, next_in = _badge_for(current_streak)

    # Per-filler counts across the last few sessions, so the analysis screen can
    # say "you said 'like' 11 times; previously 9, 13, 11".
    recent_ids = [s.id for s in sessions[:4]]
    filler_history: dict[str, list[int]] = {}
    tag_totals: dict[str, list[float]] = {}
    if sessions:
        rows = db.scalars(
            select(Answer).where(Answer.session_id.in_([s.id for s in sessions]))
        ).all()
        by_session: dict[uuid.UUID, Counter] = {}
        for a in rows:
            if a.answer_score is not None and a.question_tag:
                tag_totals.setdefault(a.question_tag, []).append(float(a.answer_score))
            counter = by_session.setdefault(a.session_id, Counter())
            for word in a.filler_words_detected or []:
                counter[str(word).lower()] += 1
        words = {w for sid in recent_ids for w in by_session.get(sid, Counter())}
        for word in words:
            # Newest first, matching how the analysis card reads it out.
            filler_history[word] = [by_session.get(sid, Counter()).get(word, 0) for sid in recent_ids]

    tag_performance = {
        tag: round(sum(values) / len(values), 1) for tag, values in tag_totals.items()
    }

    return SessionStats(
        total=len(sessions),
        avg_score=round(sum(scores) / len(scores), 1) if scores else None,
        best_score=max(scores) if scores else None,
        sessions_this_week=sum(
            1 for s in sessions if s.created_at and _aware(s.created_at) >= week_ago
        ),
        score_trend=_recent("overall_score"),
        most_practiced_role=roles.most_common(1)[0][0] if roles else None,
        filler_word_trend=_recent("total_filler_count"),
        wpm_trend=_recent("avg_wpm"),
        dimension_averages={
            "answer": _avg("answer_score"),
            "confidence": _avg("confidence_score"),
            "communication": _avg("communication_score"),
            "filler": _avg("filler_word_score"),
            "overall": _avg("overall_score"),
        },
        sessions_per_week=per_week,
        current_streak=current_streak,
        longest_streak=longest_streak,
        streak_badge=badge,
        next_badge_in=next_in,
        filler_history=filler_history,
        tag_performance=tag_performance,
    )


# NOTE: this must stay below /my-sessions. FastAPI matches in declaration
# order, and a "/{session_id}" declared first would swallow "my-sessions"
# and fail to parse it as a UUID.
@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    summary="One interview session with its answers",
    responses={
        401: {"description": "Missing, expired or invalid token"},
        404: {"description": "No such session for this user"},
    },
)
def get_session(
    session_id: uuid.UUID = Path(..., description="The interview to fetch."),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InterviewSession:
    """Return a session, its scores, its stored feedback and every answer.

    Scoped to the owner at the query level, and a session belonging to someone
    else is reported as missing rather than forbidden, so ids cannot be probed.
    """
    session = db.scalar(
        select(InterviewSession).where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == current_user.id,
            InterviewSession.deleted_at.is_(None),
        )
    )
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
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
    proctoring: ProctoringPayload | None = None,
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
            InterviewSession.deleted_at.is_(None),
        )
    )
    if session is None:
        # Same answer whether it does not exist or belongs to someone else.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    # Recorded before the early return below: an AI Meet is already marked
    # complete by the socket, so a later call would otherwise drop this.
    # Stored but never allowed to change a score - delivery and content are
    # judged on their own.
    if proctoring is not None:
        session.integrity_score = proctoring.integrity_score
        session.proctoring_data = {
            "tab_switches": proctoring.tab_switches,
            "total_away_ms": proctoring.total_away_ms,
            "suspicious_events": proctoring.suspicious_events,
            "attention_rate": proctoring.attention_rate,
            "tracking_available": proctoring.tracking_available,
            "switches": proctoring.switches[:50],
        }
        try:
            db.commit()
        except SQLAlchemyError:
            db.rollback()
            logger.exception("Could not store proctoring data")

    already_done = session.final_feedback and session.failure_dna and (
        session.session_type != "ai_meet"
        or (session.verbal_debrief and session.career_guidance)
    )
    if already_done and not regenerate:
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

    # An AI Meet also earns a per-phase breakdown, the spoken debrief and
    # career guidance. The socket writes these when the meet runs to its end;
    # this fills them in for a meet that was ended early or is being
    # regenerated, so both paths converge on the same stored result.
    if session.session_type == "ai_meet":
        by_phase: dict[str, list] = {}
        for answer in answers:
            phase = PHASE_BY_LABEL.get(answer.question_tag or "")
            if phase:
                by_phase.setdefault(phase, []).append(answer)
        session.phase_scores = {
            phase: score_service.score_phase(phase, rows)
            for phase, rows in by_phase.items()
        }

        candidate_name = (
            current_user.full_name or current_user.username or "there"
        ).split(" ")[0]
        digest = [
            {
                "question": a.question_text,
                "answer": (a.transcript or "")[:1200],
                "answer_score": a.answer_score,
                "phase": a.question_tag,
            }
            for a in answers
        ]
        session_data = {
            "job_role": session.job_role,
            "overall_score": scores["overall_score"],
            "phase_scores": session.phase_scores,
        }
        resume_data = None
        if session.resume_used:
            resume = db.scalar(
                select(Resume).where(Resume.user_id == current_user.id)
            )
            resume_data = resume.parsed_data if resume else None

        if not session.verbal_debrief or regenerate:
            session.verbal_debrief = await generate_verbal_debrief(
                session_data, digest, candidate_name
            )
        if not session.career_guidance or regenerate:
            session.career_guidance = await generate_career_guidance(
                session_data, digest, resume_data
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

    # Root cause and the recruiter's read. Both degrade to an "unavailable"
    # shape rather than raising, so a model hiccup cannot block completion.
    if not session.failure_dna or regenerate:
        session.failure_dna = await score_service.generate_failure_dna(
            list(answers), session, llm_service
        )
    if not session.recruiter_replay or regenerate:
        session.recruiter_replay = await score_service.generate_recruiter_replay(
            list(answers), session, session.failure_dna or {}, llm_service
        )

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


@router.delete(
    "/all",
    summary="Soft-delete every session for the signed-in user",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
@router.delete("/", include_in_schema=False)
def delete_all_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Clear the user's interview history.

    Soft, for the same reason one-at-a-time deletion is: the rows carry
    transcripts, and a hard delete would make past aggregates irreproducible.
    Returns how many were cleared so the caller can say so honestly.
    """
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(InterviewSession).where(
            InterviewSession.user_id == current_user.id,
            InterviewSession.deleted_at.is_(None),
        )
    ).all()
    for row in rows:
        row.deleted_at = now
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not clear history for %s", current_user.username)
        raise HTTPException(status_code=500, detail="Could not clear your history.")

    logger.info("Cleared %d session(s) for %s", len(rows), current_user.username)
    return {"deleted": len(rows)}


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a session",
    responses={
        401: {"description": "Missing, expired or invalid token"},
        404: {"description": "No such session for this user"},
    },
)
def delete_session(
    session_id: uuid.UUID = Path(..., description="The interview to remove."),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Hide a session from the user without destroying its rows.

    Soft rather than hard: the answers carry the transcripts, and a hard delete
    would also make past aggregates irreproducible. Already-deleted sessions
    return 404, so a repeated delete is not reported as success.
    """
    session = db.scalar(
        select(InterviewSession).where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == current_user.id,
            InterviewSession.deleted_at.is_(None),
        )
    )
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    session.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Soft-deleted session %s for %s", session_id, current_user.username)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
