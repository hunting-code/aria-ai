"""Pydantic request/response schemas for the ARIA AI API.

These are the API's contract. ORM models are never returned directly, so
`hashed_password` and other internals can't leak into a response.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import BCRYPT_MAX_BYTES, password_too_long
from app.models.session import Difficulty, JobRole, SessionStatus

# Reused so the rules live in one place.
USERNAME_PATTERN = r"^[a-zA-Z0-9_.-]+$"


class ORMModel(BaseModel):
    """Base for schemas populated from SQLAlchemy rows."""

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Users / auth
# --------------------------------------------------------------------------- #
class UserCreate(BaseModel):
    """Registration payload."""

    username: str = Field(
        min_length=3,
        max_length=50,
        pattern=USERNAME_PATTERN,
        description="Letters, digits, underscore, dot and hyphen only.",
        examples=["alice"],
    )
    email: EmailStr = Field(examples=["alice@example.com"])
    password: str = Field(
        min_length=8,
        max_length=128,
        description=f"8-128 characters, at most {BCRYPT_MAX_BYTES} bytes.",
        examples=["correct-horse-battery"],
    )
    full_name: str | None = Field(default=None, max_length=255, examples=["Alice Ng"])

    @field_validator("username")
    @classmethod
    def _normalise_username(cls, v: str) -> str:
        return v.strip()

    @field_validator("password")
    @classmethod
    def _reject_truncatable_password(cls, v: str) -> str:
        # bcrypt hashes only the first 72 bytes and passlib drops the rest
        # silently, which would make a long password and its prefix equivalent.
        if password_too_long(v):
            raise ValueError(
                f"Password must be at most {BCRYPT_MAX_BYTES} bytes when "
                "UTF-8 encoded (non-ASCII characters count as more than one)"
            )
        return v

    @field_validator("full_name")
    @classmethod
    def _blank_full_name_is_null(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class UserLogin(BaseModel):
    """JSON login payload.

    `POST /auth/login` uses OAuth2PasswordRequestForm (form-encoded) so the
    /docs Authorize button works; this schema is for clients that would rather
    send JSON.
    """

    username: str = Field(min_length=1, max_length=50, examples=["alice"])
    password: str = Field(min_length=1, max_length=128)


class UserResponse(ORMModel):
    """A user as returned by the API. Never includes the password hash."""

    id: uuid.UUID
    username: str
    email: EmailStr
    full_name: str | None = None
    is_active: bool
    created_at: datetime


class Token(ORMModel):
    """Issued by /auth/register and /auth/login."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Token lifetime in seconds.")
    user: UserResponse


class TokenData(BaseModel):
    """The validated contents of an access token."""

    sub: str = Field(description="The user's id, as a string.")
    exp: datetime | None = None
    iat: datetime | None = None
    type: str | None = None

    @property
    def user_id(self) -> uuid.UUID:
        return uuid.UUID(self.sub)


# --------------------------------------------------------------------------- #
# Interview sessions
# --------------------------------------------------------------------------- #
class TrendPoint(BaseModel):
    """One point on a dashboard trend line."""

    session_id: uuid.UUID
    date: datetime
    value: float | None = None


class SessionStats(BaseModel):
    """Aggregates behind the dashboard and history charts."""

    total: int = 0
    avg_score: float | None = None
    best_score: float | None = None
    sessions_this_week: int = 0
    score_trend: list[TrendPoint] = Field(default_factory=list)
    most_practiced_role: str | None = None
    filler_word_trend: list[TrendPoint] = Field(default_factory=list)
    wpm_trend: list[TrendPoint] = Field(default_factory=list)
    dimension_averages: dict[str, float | None] = Field(default_factory=dict)
    sessions_per_week: list[dict] = Field(default_factory=list)
    current_streak: int = 0
    longest_streak: int = 0
    streak_badge: str | None = None
    next_badge_in: int | None = None
    filler_history: dict[str, list[int]] = Field(default_factory=dict)
    tag_performance: dict[str, float] = Field(default_factory=dict)


class SessionCreate(BaseModel):
    """Start a new interview. The owner comes from the bearer token."""

    job_role: JobRole = Field(examples=[JobRole.AI_ENGINEER])
    difficulty: Difficulty = Field(
        default=Difficulty.INTERMEDIATE, examples=[Difficulty.INTERMEDIATE]
    )


class SessionSummary(ORMModel):
    """Condensed session, for dashboard and history lists.

    Carries the component scores as well as the overall: the history cards
    draw a bar per metric, and omitting them left four of five bars reading
    zero rather than "not scored". Answers are still excluded - those are what
    make SessionResponse expensive.
    """

    id: uuid.UUID
    job_role: str
    difficulty: str
    coach_mode: bool = True
    status: SessionStatus
    overall_score: float | None = None
    answer_score: float | None = None
    confidence_score: float | None = None
    communication_score: float | None = None
    filler_word_score: float | None = None
    total_filler_count: int = 0
    avg_wpm: float | None = None
    duration_minutes: float | None = None
    created_at: datetime
    completed_at: datetime | None = None


class SessionResponse(SessionSummary):
    """A full session, including every score breakdown."""

    user_id: uuid.UUID
    final_feedback: dict | None = None
    answers: list["AnswerResponse"] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Answers
# --------------------------------------------------------------------------- #
class AnswerCreate(BaseModel):
    """Submit one answer. Scores are computed server-side, never sent by the client."""

    question_number: int = Field(ge=1, examples=[1])
    question_text: str = Field(min_length=1, examples=["Explain gradient descent."])
    transcript: str | None = Field(default=None, examples=["Well, gradient descent..."])
    duration_seconds: float | None = Field(default=None, ge=0)


class AnswerResponse(ORMModel):
    """A scored answer."""

    id: uuid.UUID
    session_id: uuid.UUID
    question_number: int
    question_text: str
    question_tag: str | None = None
    is_follow_up: bool = False
    transcript: str | None = None
    answer_score: float | None = None
    confidence_score: float | None = None
    communication_score: float | None = None
    filler_count: int = 0
    filler_words_detected: list[str] = Field(default_factory=list)
    wpm: float | None = None
    duration_seconds: float | None = None
    ai_feedback: str | None = None
    created_at: datetime


class FinalFeedback(BaseModel):
    """The whole-session verdict stored on a completed interview."""

    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    top_suggestions: list[str] = Field(default_factory=list)
    overall_verdict: str = ""
    recommended_resources: list[str] = Field(default_factory=list)
    source: str = "model"


class FeedbackResponse(BaseModel):
    """The scored verdict for a single answer, streamed back after analysis."""

    session_id: uuid.UUID
    question_number: int
    answer_score: float | None = None
    confidence_score: float | None = None
    communication_score: float | None = None
    filler_count: int = 0
    filler_words_detected: list[str] = Field(default_factory=list)
    wpm: float | None = None
    ai_feedback: str | None = None
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Generic
# --------------------------------------------------------------------------- #
class MessageResponse(BaseModel):
    """A simple {"detail": "..."} acknowledgement."""

    detail: str


# SessionResponse references AnswerResponse before it is defined.
SessionResponse.model_rebuild()


__all__ = [
    "AnswerCreate",
    "AnswerResponse",
    "FeedbackResponse",
    "FinalFeedback",
    "MessageResponse",
    "SessionCreate",
    "SessionStats",
    "TrendPoint",
    "SessionResponse",
    "SessionSummary",
    "Token",
    "TokenData",
    "UserCreate",
    "UserLogin",
    "UserResponse",
]
