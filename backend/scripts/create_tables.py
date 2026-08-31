#!/usr/bin/env python
"""Database migration script - creates every table defined in app.models.

Usage (from the backend/ directory, with the venv active):

    python -m scripts.create_tables            # create missing tables
    python -m scripts.create_tables --check    # report drift, change nothing
    python -m scripts.create_tables --sql      # print the DDL, execute nothing
    python -m scripts.create_tables --drop     # DESTRUCTIVE: drop, then recreate

`create_all` only ever adds missing tables - it will not alter a table whose
columns have changed. Once the schema starts evolving in production, move to
Alembic (`pip install alembic && alembic init migrations`) and treat this
script as first-time bootstrap only.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Allow `python scripts/create_tables.py` as well as `python -m scripts.create_tables`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.schema import CreateTable

from app.core.config import get_settings
from app.core.database import Base, engine
from app.models import Answer, InterviewSession, User  # noqa: F401  (registers mappers)

logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
logger = logging.getLogger("create_tables")


def _redacted_url() -> str:
    """The database URL with the password masked, safe to log."""
    return engine.url.render_as_string(hide_password=True)


def print_sql() -> int:
    """Print the CREATE TABLE statements for the configured dialect."""
    for table in Base.metadata.sorted_tables:
        print(str(CreateTable(table).compile(engine)).strip() + ";\n")
    return 0


def check() -> int:
    """Compare the models against the live database. Returns 1 if tables are missing."""
    expected = set(Base.metadata.tables)
    try:
        existing = set(inspect(engine).get_table_names())
    except SQLAlchemyError:
        logger.exception("Could not inspect the database at %s", _redacted_url())
        return 2

    missing = sorted(expected - existing)
    extra = sorted(existing - expected - {"alembic_version"})

    for name in sorted(expected & existing):
        logger.info("present  %s", name)
    for name in missing:
        logger.warning("MISSING  %s", name)
    for name in extra:
        logger.info("unmanaged %s (not defined in app.models)", name)

    if missing:
        logger.error(
            "%d table(s) missing. Run: python -m scripts.create_tables", len(missing)
        )
        return 1
    logger.info("Schema is up to date (%d tables).", len(expected))
    return 0


def create(drop_first: bool = False) -> int:
    """Create all tables, optionally dropping them first."""
    settings = get_settings()
    logger.info("Target database: %s", _redacted_url())

    if drop_first:
        if settings.is_production:
            logger.error("Refusing to --drop in a production environment.")
            return 2
        confirm = input(
            "This DELETES every table and all their data. Type 'drop' to confirm: "
        )
        if confirm.strip().lower() != "drop":
            logger.info("Aborted - nothing was changed.")
            return 1
        try:
            Base.metadata.drop_all(bind=engine)
            logger.info("Dropped all tables.")
        except SQLAlchemyError:
            logger.exception("Failed to drop tables")
            return 2

    try:
        before = set(inspect(engine).get_table_names())
        Base.metadata.create_all(bind=engine)
        after = set(inspect(engine).get_table_names())
    except SQLAlchemyError as exc:
        logger.error("Could not create tables: %s", exc)
        logger.error(
            "Is PostgreSQL running and reachable? Start it with: docker compose up -d db"
        )
        return 2

    created = sorted(after - before)
    if created:
        logger.info("Created: %s", ", ".join(created))
    else:
        logger.info("No changes - every table already existed.")
    logger.info("Tables now present: %s", ", ".join(sorted(after)))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--check", action="store_true", help="report missing tables, change nothing"
    )
    group.add_argument(
        "--sql", action="store_true", help="print the DDL without executing it"
    )
    group.add_argument(
        "--drop",
        action="store_true",
        help="DESTRUCTIVE: drop every table before recreating (asks to confirm)",
    )
    args = parser.parse_args()

    try:
        if args.sql:
            return print_sql()
        if args.check:
            return check()
        return create(drop_first=args.drop)
    except RuntimeError as exc:  # configuration error from get_settings()
        logger.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        logger.info("Interrupted.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
