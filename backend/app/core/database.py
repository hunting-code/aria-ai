"""SQLAlchemy engine, session factory, declarative Base and the FastAPI dependency."""

from __future__ import annotations

import logging
from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# SQLite (used by the test suite) needs a different argument set and does not
# support the queue-pool tuning below.
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

_engine_kwargs: dict = {
    "echo": settings.SQL_ECHO,
    "future": True,
    # Verify a pooled connection is alive before handing it out, so a restarted
    # database or an idle-timeout kill surfaces as a reconnect, not a 500.
    "pool_pre_ping": True,
}
if not _is_sqlite:
    _engine_kwargs.update(
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_recycle=settings.DB_POOL_RECYCLE,
    )
else:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        """Enforce foreign keys on SQLite.

        SQLite ignores ON DELETE CASCADE unless this pragma is set per
        connection. Without it, relationships declared with
        passive_deletes=True silently leave orphaned rows behind - a bug that
        would show up only in the SQLite-backed tests, never in PostgreSQL.
        """
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped database session.

    Rolls back on any exception and always closes the session, so a failed
    request can never leak a connection or leave a half-applied transaction.
    """
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Database error - transaction rolled back")
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Transactional session for use outside a request (scripts, workers, startup).

    Commits on success, rolls back on failure.
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Database error - transaction rolled back")
        raise
    finally:
        db.close()


def check_connection() -> bool:
    """Return True if the database answers a trivial query. Never raises."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        logger.exception("Database connectivity check failed")
        return False


def init_db() -> None:
    """Create any missing tables.

    Imports the model modules first so every mapper is registered against
    `Base.metadata` before `create_all` runs. Fine for development; use Alembic
    migrations once the schema starts changing in production.
    """
    from app import models  # noqa: F401  (registers the ORM mappers)

    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables verified/created")
    except SQLAlchemyError:
        logger.exception("Failed to create database tables")
        raise


__all__ = [
    "Base",
    "SessionLocal",
    "engine",
    "get_db",
    "session_scope",
    "check_connection",
    "init_db",
]
