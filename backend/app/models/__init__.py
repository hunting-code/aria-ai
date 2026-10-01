"""SQLAlchemy ORM models.

Importing this package registers every mapper against `Base.metadata`, which is
what lets `init_db()` / the migration script emit `CREATE TABLE` for all of
them. Import models from here rather than from the individual modules:

    from app.models import Answer, InterviewSession, User
"""

from app.models.answer import Answer
from app.models.resume import Resume
from app.models.session import (
    Difficulty,
    InterviewSession,
    JobRole,
    SessionStatus,
)
from app.models.user import User

__all__ = [
    "Answer",
    "Resume",
    "Difficulty",
    "InterviewSession",
    "JobRole",
    "SessionStatus",
    "User",
]
