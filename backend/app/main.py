"""ARIA AI - FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api import websocket as ws
from app.api.routes import auth, interview, report, session
from app.core.config import get_settings
from app.core.database import check_connection, init_db

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,  # http://localhost:5173 by default
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Error handling
# --------------------------------------------------------------------------- #
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return a 422 with the field errors, without leaking internal state."""
    logger.warning("Validation error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error", "errors": exc.errors()},
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_exception_handler(
    request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "A database error occurred. Please try again."},
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
async def interview_websocket(websocket: WebSocket, session_id: str) -> None:
    """Live interview channel.

    Accepts `{"type": ..., "data": {...}}` JSON frames and replies in kind.
    A malformed frame is answered with an error message rather than a
    disconnect; only an unexpected server fault closes the socket.
    """
    if not session_id.strip():
        await websocket.close(code=ws.WS_POLICY_VIOLATION, reason="Missing session_id")
        return

    # TODO: authenticate the socket (JWT in the query string or first frame)
    # and verify the caller owns this session before accepting.
    await ws.manager.connect(session_id, websocket)
    try:
        while True:
            try:
                message = await websocket.receive_json()
            except ValueError:
                await ws.manager.send_json(
                    websocket,
                    {"type": "error", "data": {"message": "Expected a JSON frame"}},
                )
                continue

            if not isinstance(message, dict):
                await ws.manager.send_json(
                    websocket,
                    {"type": "error", "data": {"message": "Frame must be a JSON object"}},
                )
                continue

            reply = await ws.handle_message(session_id, message)
            await ws.manager.send_json(websocket, reply)
    except WebSocketDisconnect:
        logger.info("Client disconnected (session=%s)", session_id)
    except Exception:
        logger.exception("WebSocket error (session=%s)", session_id)
        try:
            await websocket.close(code=ws.WS_INTERNAL_ERROR)
        except RuntimeError:
            pass  # already closed
    finally:
        ws.manager.disconnect(session_id, websocket)
