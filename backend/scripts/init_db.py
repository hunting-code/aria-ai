"""Create missing tables and add missing columns, then report what happened.

    python -m scripts.init_db

Safe to run repeatedly: it only adds what is absent and never drops anything.
Use it after a deploy that shipped a model change, since `create_all` alone
cannot alter a table that already exists.
"""

from __future__ import annotations

import logging
import sys

from app.core.database import engine
from app.core.schema_sync import sync_schema

import app.models  # noqa: F401  (registers every mapper)

logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
logger = logging.getLogger("init_db")


def main() -> int:
    from app.core.config import get_settings

    url = get_settings().DATABASE_URL
    # Never print credentials.
    safe = url.split("@")[-1] if "@" in url else url
    logger.info("Target: %s", safe)

    try:
        result = sync_schema(engine)
    except Exception:
        logger.exception("Schema sync failed")
        return 1

    if result["created_tables"]:
        logger.info("Created tables: %s", ", ".join(result["created_tables"]))
    if result["added_columns"]:
        logger.info("Added columns: %s", ", ".join(result["added_columns"]))
    if result["up_to_date"]:
        logger.info("Nothing to do - the schema already matches the models.")

    logger.info("Tables now present: %s", ", ".join(result["tables"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
