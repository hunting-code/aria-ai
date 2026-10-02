"""ARIA AI - FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request, WebSocket, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import ai_meet_websocket as meet_ws
from app.api import websocket as ws
from app.api.routes import admin, auth, career, interview, report, resume, session, tts
from app.core.config import get_settings
from app.core.database import check_connection, get_db, init_db
from app.core.limiter import limiter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown. Verifies config and the database before serving traffic."""
    problems = settings.check_production_readiness()
    if problems:
        rendered = "\n".join(f"  - {p}" for p in problems)
        if settings.is_production:
            raise RuntimeError(f"Unsafe production configuration:\n{rendered}")
        logger.warning("Configuration warnings:\n%s", rendered)

    try:
        init_db()
        # create_all only ever adds TABLES - it silently skips one that already
        # exists, so a model change shipped after the first deploy leaves the
        # database behind and every read of that table starts failing. Running
        # the column sync here means a deploy heals itself, with no manual step
        # to forget. Additive only: nothing is dropped or retyped.
        from app.core.schema_sync import sync_schema
        from app.core.database import engine as _engine

        result = sync_schema(_engine)
        if result["created_tables"] or result["added_columns"]:
            logger.info(
                "Schema brought up to date: %s%s",
                f"created {', '.join(result['created_tables'])}; "
                if result["created_tables"]
                else "",
                f"added {', '.join(result['added_columns'])}"
                if result["added_columns"]
                else "",
            )
    except SQLAlchemyError:
        # In production a database the app cannot reach is fatal - fail the
        # deploy rather than serve requests that will 500 one by one.
        if settings.is_production:
            raise
        logger.error(
            "Could not initialise the database. Is PostgreSQL running? "
            "Start it with: docker compose up -d db"
        )

    logger.info(
        "%s v%s started (env=%s)",
        settings.PROJECT_NAME,
        settings.VERSION,
        settings.ENVIRONMENT,
    )
    yield
    logger.info("%s shutting down", settings.PROJECT_NAME)


app = FastAPI(
    title="ARIA AI",
    version="1.0.0",
    description="AI-powered mock interview platform.",
    lifespan=lifespan,
    # Hide the interactive docs in production.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Rate limiting. The middleware applies the global per-IP/user default; routes
# add their own stricter limits with @limiter.limit.
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    logger.warning("Rate limit hit on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": "Too many requests. Please slow down and try again shortly."
        },
        headers={"Retry-After": "60"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,  # http://localhost:5173 by default
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Content-Disposition is not a CORS-safelisted response header, so without
    # this the browser hides it and the PDF download loses its filename.
    expose_headers=[
        "Content-Disposition",
        "Content-Length",
        "X-Total-Count",
        # Lets the client tell a quota failure from a transient one without
        # parsing the message text.
        "X-Error-Kind",
    ],
)


# --------------------------------------------------------------------------- #
# Error handling
# --------------------------------------------------------------------------- #
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return a 422 with the field errors, without leaking internal state.

    `exc.errors()` is deliberately not passed through as-is: entries raised by a
    custom validator carry the original exception object under "ctx", which is
    not JSON-serialisable (every such error would 500), and "input" echoes the
    submitted value back - which for a password field means returning and
    logging the password. Only loc/msg/type are exposed.
    """
    errors = [
        {
            "loc": [str(part) for part in err.get("loc", ())],
            "msg": str(err.get("msg", "")),
            "type": str(err.get("type", "")),
        }
        for err in exc.errors()
    ]
    logger.warning(
        "Validation error on %s %s: %s",
        request.method,
        request.url.path,
        [e["loc"] for e in errors],
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error", "errors": errors},
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(
    request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    """Log the full traceback; return something the caller can act on.

    The client gets a short error id that also appears in the log line, so a
    report of "it returned 503" can be traced to one exact traceback instead of
    guessing. Outside production the cause is included in the response too -
    in production it is not, because database errors quote table and column
    names and sometimes the values that broke them.
    """
    error_id = uuid.uuid4().hex[:8]
    # `orig` carries the driver's own error, which is the part that names the
    # missing column or constraint. The generic SQLAlchemy wrapper does not.
    cause = getattr(exc, "orig", None) or exc
    logger.exception(
        "Database error [%s] on %s %s: %s: %s",
        error_id,
        request.method,
        request.url.path,
        type(cause).__name__,
        str(cause)[:500],
    )
    body: dict[str, Any] = {
        "detail": "A database error occurred. Please try again.",
        "error_id": error_id,
    }
    if not settings.is_production:
        body["error_type"] = type(cause).__name__
        body["error"] = str(cause)[:500]
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=body
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort handler: log the traceback, return an opaque 500."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    detail = repr(exc) if settings.DEBUG else "Internal server error"
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": detail},
    )


# --------------------------------------------------------------------------- #
# Routers
# --------------------------------------------------------------------------- #
app.include_router(auth.router, prefix=settings.API_PREFIX)
app.include_router(interview.router, prefix=settings.API_PREFIX)
app.include_router(session.router, prefix=settings.API_PREFIX)
app.include_router(resume.router, prefix=settings.API_PREFIX)
app.include_router(career.router, prefix=settings.API_PREFIX)
app.include_router(tts.router, prefix=settings.API_PREFIX)
app.include_router(admin.router, prefix=settings.API_PREFIX)
app.include_router(report.router, prefix=settings.API_PREFIX)


# --------------------------------------------------------------------------- #
# Health / meta
# --------------------------------------------------------------------------- #
@app.get("/health", tags=["health"], summary="Liveness and database readiness")
async def health() -> JSONResponse:
    """Report service health. 200 when the database answers, 503 otherwise."""
    db_ok = check_connection()
    payload: dict[str, Any] = {
        "status": "ok" if db_ok else "degraded",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "database": "connected" if db_ok else "unavailable",
        "active_ws_connections": ws.manager.connection_count(),
    }
    return JSONResponse(
        status_code=status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=payload,
    )


@app.get("/", tags=["health"], include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": settings.PROJECT_NAME, "version": settings.VERSION}


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #
@app.websocket("/ws/{session_id}")
async def interview_websocket_route(
    websocket: WebSocket,
    session_id: str,
    db: Session = Depends(get_db),
) -> None:
    """Live interview channel.

    The protocol and state machine live in app.api.websocket. The dependency
    yields a Session for the life of the connection, but SQLAlchemy returns the
    underlying connection to the pool between transactions, so an idle
    interview does not hold one open.
    """
    await ws.interview_websocket(websocket, session_id, db)


@app.websocket("/ws/meet/{session_id}")
async def ai_meet_websocket_route(
    websocket: WebSocket,
    session_id: str,
    db: Session = Depends(get_db),
) -> None:
    """AI Meet channel: the formal, phased interview.

    Separate from /ws/{session_id} because the state machines differ - this one
    tracks phases, transitions and a spoken debrief rather than a flat question
    list. Both share the connection manager in app.api.websocket.
    """
    await meet_ws.ai_meet_websocket(websocket, session_id, db)
