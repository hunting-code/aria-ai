"""User ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:  # avoids a circular import at runtime
    from app.models.session import InterviewSession


class User(Base):
    """A candidate account."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    username: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    # Always the bcrypt digest from app.core.security - never a plaintext password.
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    # The shared demo account. Its interviews are reset on each sign-in rather
    # than accumulating, so every visitor starts from the same five samples.
    is_demo: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )

    sessions: Mapped[list["InterviewSession"]] = relationship(
        "InterviewSession",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="InterviewSession.created_at.desc()",
        # Lazy by default: get_current_user() loads a User on every
        # authenticated request and must not drag in the session history.
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"


__all__ = ["User"]
