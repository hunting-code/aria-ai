"""Answer ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Text,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:  # avoids a circular import at runtime
    from app.models.session import InterviewSession

# JSONB on PostgreSQL (indexable, binary-packed); plain JSON elsewhere so the
# SQLite-backed test suite keeps working.
JSONList = JSON().with_variant(JSONB(), "postgresql")


class Answer(Base):
    """One question/answer turn inside an interview session."""

    __tablename__ = "answers"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ---- Question / response ----
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Null between recording the audio and the STT result coming back.
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ---- Per-answer scores: null until the scoring pass runs ----
    answer_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    communication_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ---- Speech metrics ----
    filler_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # A list of the filler words found, e.g. ["um", "like", "you know"].
    filler_words_detected: Mapped[list[str]] = mapped_column(
        JSONList, nullable=False, default=list
    )
    wpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ---- LLM output ----
    ai_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped["InterviewSession"] = relationship(
        "InterviewSession", back_populates="answers"
    )

    __table_args__ = (
        CheckConstraint("question_number > 0", name="ck_answers_question_number_positive"),
        CheckConstraint("filler_count >= 0", name="ck_answers_filler_count_positive"),
        # Backs "all answers for this session, in order".
        Index("ix_answers_session_question", "session_id", "question_number"),
    )

    def __repr__(self) -> str:
        return (
            f"<Answer id={self.id} session={self.session_id} "
            f"q={self.question_number}>"
        )


__all__ = ["Answer"]
