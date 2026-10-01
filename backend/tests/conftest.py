"""Test fixtures.

Every test runs against a throwaway SQLite file, never the configured
PostgreSQL database - a test run must not be able to touch real interviews.
The DATABASE_URL override is set before `app` is imported, because settings are
read once at import time.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP_DB = Path(tempfile.gettempdir()) / "aria_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB}"
# Keys are irrelevant here: nothing in these tests calls a model provider.
os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-characters-long")
os.environ.setdefault("GROQ_API_KEY", "gsk_test_key_placeholder_value_0000000000")


@pytest.fixture(scope="session", autouse=True)
def _database() -> None:
    """Create a fresh schema for the session and remove the file afterwards."""
    if _TMP_DB.exists():
        _TMP_DB.unlink()

    from app.core.database import Base, engine

    import app.models  # noqa: F401  (registers every mapper)

    Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()
    if _TMP_DB.exists():
        _TMP_DB.unlink()


@pytest.fixture()
def client():
    """A TestClient bound to the app, with its lifespan run."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def unique_user() -> dict[str, str]:
    """Registration payload that cannot collide with another test's user."""
    import uuid

    tag = uuid.uuid4().hex[:10]
    return {
        "username": f"t{tag}",
        "email": f"t{tag}@example.com",
        "password": "TestPass123!",
        "full_name": "Test Person",
    }
