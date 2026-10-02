"""Operational endpoints. Gated on a shared secret, not on a user account."""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import get_settings
from app.core.database import engine
from app.core.schema_sync import sync_schema

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()


def _authorise(token: str | None) -> None:
    """Require the shared admin token.

    Refuses outright when ADMIN_TOKEN is unset, rather than defaulting to open:
    an unset secret must never mean "anyone may migrate the database". Compared
    with compare_digest so the check does not leak the token through timing.
    """
    expected = (settings.ADMIN_TOKEN or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin endpoints are disabled: ADMIN_TOKEN is not set.",
        )
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token."
        )


@router.post("/init-db")
def init_db(x_admin_token: str | None = Header(default=None)) -> dict:
    """Create missing tables and add missing columns.

    POST rather than GET: it changes the database, and a GET would be followed
    by link prefetchers and browser history. Additive only - nothing is dropped
    or retyped - so it is safe to call more than once.
    """
    _authorise(x_admin_token)
    try:
        result = sync_schema(engine)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Schema sync failed")
        raise HTTPException(status_code=500, detail=f"Schema sync failed: {exc}")
    logger.info(
        "Schema sync: %d table(s), %d column(s) added",
        len(result["created_tables"]),
        len(result["added_columns"]),
    )
    return result


@router.get("/schema")
def schema_status(x_admin_token: str | None = Header(default=None)) -> dict:
    """What the live schema has, and what the models expect. Read-only."""
    _authorise(x_admin_token)
    from sqlalchemy import inspect

    from app.core.database import Base
    import app.models  # noqa: F401

    inspector = inspect(engine)
    live_tables = set(inspector.get_table_names())
    drift: dict[str, list[str]] = {}
    for table in Base.metadata.sorted_tables:
        if table.name not in live_tables:
            drift[table.name] = ["<table missing>"]
            continue
        live = {c["name"] for c in inspector.get_columns(table.name)}
        missing = [c.name for c in table.columns if c.name not in live]
        if missing:
            drift[table.name] = missing
    return {"tables": sorted(live_tables), "drift": drift, "up_to_date": not drift}
