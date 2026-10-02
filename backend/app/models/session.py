"""InterviewSession ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:  # avoids a circular import at runtime
    from app.models.answer import Answer
    from app.models.user import User

# JSONB on PostgreSQL, plain JSON elsewhere so the SQLite tests keep working.
JSONDict = JSON().with_variant(JSONB(), "postgresql")


class JobRole(str, Enum):
    """Interview tracks ARIA can run."""

    DATA_ANALYST = "data_analyst"
    SOFTWARE_ENGINEER = "software_engineer"
    HR = "hr"
    AI_ENGINEER = "ai_engineer"


class Difficulty(str, Enum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class SessionStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class InterviewSession(Base):
    """One interview run: its configuration, lifecycle and aggregate scores.

    Stored as String columns rather than a database ENUM so a new job role or
    difficulty ships without a migration; the allowed values are enforced by
    CHECK constraints and by the Enum classes above.
    """

    __tablename__ = "interview_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ---- Configuration ----
    job_role: Mapped[str] = mapped_column(String(50), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    # Coach mode explains mistakes; interviewer mode applies pressure. Defaults
    # by difficulty when the session is created, and the candidate can toggle it.
    coach_mode: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=SessionStatus.ACTIVE.value,
        server_default=SessionStatus.ACTIVE.value,
        index=True,
    )

    # ---- AI Meet mode ----
    # "practice" is the classic mode; "ai_meet" is the formal phased interview.
    session_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="practice", server_default="practice"
    )
    # Current phase while an ai_meet session is live; resumes pick up here.
    # warmup | background | technical | behavioral | wrap_up
    meet_phase: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Whether the interviewer had the candidate's resume in front of it.
    resume_used: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # {"warmup": {"score": float, "notes": str}, ...} - written at completion.
    phase_scores: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    # The closing assessment ARIA reads aloud at the end of an AI Meet.
    verbal_debrief: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Structured career guidance generated after an AI Meet completes.
    career_guidance: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)

    # ---- Post-interview analysis ----
    # Root cause behind the weak answers, and a recruiter's read of the whole
    # session. Both are written at completion; null until then.
    failure_dna: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    recruiter_replay: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)

    # ---- Proctoring ----
    # 0-100 focus signal from the browser (tab switches, gaze). Null when the
    # candidate's browser could not measure it - absence is not a red flag.
    integrity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # The raw counts behind that score, so a reader can disagree with it.
    proctoring_data: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)

    # ---- Aggregate scores: null until the interview is scored ----
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    answer_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    communication_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    filler_word_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ---- Speech metrics ----
    total_filler_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    avg_wpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ---- Final report ----
    # Whole-session verdict from score_service.generate_final_feedback:
    # strengths, weaknesses, top_suggestions, overall_verdict and
    # recommended_resources. Null until the session is completed.
    final_feedback: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)

    # ---- Lifecycle ----
    # Soft delete: rows are kept so a deletion cannot silently rewrite past
    # statistics, and every query filters on this being NULL.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ---- Relationships ----
    user: Mapped["User"] = relationship("User", back_populates="sessions")
    answers: Mapped[list["Answer"]] = relationship(
        "Answer",
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Answer.question_number",
    )

    __table_args__ = (
        CheckConstraint(
            "job_role IN ('data_analyst', 'software_engineer', 'hr', 'ai_engineer')",
            name="ck_interview_sessions_job_role",
        ),
        CheckConstraint(
            "difficulty IN ('beginner', 'intermediate', 'advanced')",
            name="ck_interview_sessions_difficulty",
        ),
        CheckConstraint(
            "status IN ('active', 'completed', 'abandoned')",
            name="ck_interview_sessions_status",
        ),
        CheckConstraint(
            "total_filler_count >= 0", name="ck_interview_sessions_filler_count_positive"
        ),
        # Backs the common "my sessions, newest first" dashboard query.
        Index("ix_interview_sessions_user_created", "user_id", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<InterviewSession id={self.id} role={self.job_role!r} "
            f"status={self.status!r}>"
        )


__all__ = ["InterviewSession", "JobRole", "Difficulty", "SessionStatus"]
