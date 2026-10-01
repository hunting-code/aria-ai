"""The user's uploaded resume: extracted text, parsed structure and AI scores.

One row per user - a re-upload replaces the analysis rather than accumulating
versions. Only extracted text is stored, never the original file.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,  # one resume per user; re-upload replaces it
        nullable=False,
        index=True,
    )

    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size_kb: Mapped[float] = mapped_column(Float, nullable=False)

    # Full extracted text - the source of truth every analysis derives from.
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)

    # Structured sections (name, education, experience, projects, skills, ...).
    parsed_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # 0-100 overall, plus the per-dimension breakdown and suggestions from the
    # scoring pass. Kept as JSON: the shape is owned by the prompt, not the DB.
    resume_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    improvement_suggestions: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Role-fit analysis (primary role, per-role match percentages).
    role_fit: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_analysed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
