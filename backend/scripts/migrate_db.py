"""Add any columns the models have and the database does not.

    python -m scripts.migrate_db

Safe to run repeatedly: additive only, and a column that already exists is
skipped. The statements are derived from the models rather than hand-written,
so this cannot drift out of date the way a hard-coded list does - and the
column types always match what SQLAlchemy will query with (a hand-written
`TIMESTAMP` for a `DateTime(timezone=True)` column, for instance, silently
creates a naive column the ORM then mis-reads).

Since the same sync also runs at startup, a normal deploy heals itself; this
is here for when you want to run it by hand or see exactly what changed.
"""

from __future__ import annotations

import logging
import sys

from app.core.database import engine
from app.core.schema_sync import sync_schema

import app.models  # noqa: F401  (registers every mapper)

logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
logger = logging.getLogger("migrate_db")


def main() -> int:
    from app.core.config import get_settings

    url = get_settings().DATABASE_URL
    logger.info("Target: %s", url.split("@")[-1] if "@" in url else url)

    try:
        result = sync_schema(engine)
    except Exception:
        logger.exception("Migration failed")
        return 1

    for name in result["created_tables"]:
        logger.info("CREATED TABLE  %s", name)
    for name in result["added_columns"]:
        logger.info("ADDED COLUMN   %s", name)
    if result["up_to_date"]:
        logger.info("Already up to date - nothing to add.")

    logger.info(
        "Done. %d table(s) created, %d column(s) added.",
        len(result["created_tables"]),
        len(result["added_columns"]),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
