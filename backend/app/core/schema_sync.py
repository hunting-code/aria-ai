"""Bring a live database in line with the models.

`create_all` only ever ADDS TABLES. It will not add a column to a table that
already exists, so any model change shipped after the first deploy leaves
production querying columns that are not there - which surfaces as a generic
500/503 on every read of that table, while /health still reports "connected".

This module closes that gap: it compares the mapped columns against the live
ones and issues `ALTER TABLE ... ADD COLUMN` for whatever is missing. Additive
only - it never drops or retypes a column, so it cannot destroy data.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateTable

from app.core.database import Base

logger = logging.getLogger(__name__)


def _column_ddl(engine: Engine, column: Any) -> str:
    """The dialect's DDL for one column, without constraints we cannot add."""
    compiler = engine.dialect.ddl_compiler(engine.dialect, CreateTable(column.table))
    ddl = compiler.get_column_specification(column)
    # A NOT NULL column cannot be added to a table with existing rows unless it
    # carries a default; keep any server_default and relax the nullability.
    return ddl.replace(" NOT NULL", "") if " NOT NULL" in ddl else ddl


def sync_schema(engine: Engine) -> dict[str, Any]:
    """Create missing tables, then add missing columns. Returns what changed."""
    created_tables: list[str] = []
    added_columns: list[str] = []

    inspector = inspect(engine)
    existing = set(inspector.get_table_names())

    missing_tables = [t for t in Base.metadata.sorted_tables if t.name not in existing]
    if missing_tables:
        Base.metadata.create_all(bind=engine, tables=missing_tables)
        created_tables = [t.name for t in missing_tables]
        logger.info("Created table(s): %s", ", ".join(created_tables))

    # Re-inspect: the tables just created are already current.
    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if table.name in created_tables:
            continue
        live = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in live:
                continue
            ddl = _column_ddl(engine, column)
            statement = f'ALTER TABLE "{table.name}" ADD COLUMN {ddl}'
            try:
                with engine.begin() as connection:
                    connection.execute(text(statement))
                added_columns.append(f"{table.name}.{column.name}")
                logger.info("Added column %s.%s", table.name, column.name)
            except Exception:  # noqa: BLE001 - one bad column must not stop the rest
                logger.exception("Could not add %s.%s", table.name, column.name)

    inspector = inspect(engine)
    return {
        "created_tables": created_tables,
        "added_columns": added_columns,
        "tables": sorted(inspector.get_table_names()),
        "up_to_date": not created_tables and not added_columns,
    }
