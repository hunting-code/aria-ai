"""Live interview WebSocket channel: connection registry and message dispatch.

The endpoint itself is declared in `app.main` at `/ws/{session_id}`; this module
owns the connection bookkeeping so the app module stays thin.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)

# Starlette raises RuntimeError when sending on a closed socket; the websockets
# library raises its own ConnectionClosed. Aliased so the except stays readable.
try:  # pragma: no cover - depends on the installed websockets version
    from websockets.exceptions import ConnectionClosed as WebSocketDisconnectError
except ImportError:  # pragma: no cover
    WebSocketDisconnectError = RuntimeError  # type: ignore[misc, assignment]

# Close codes (RFC 6455 + application range).
WS_NORMAL_CLOSURE = 1000
WS_INTERNAL_ERROR = 1011
WS_POLICY_VIOLATION = 1008


class ConnectionManager:
    """Tracks active sockets per interview session.

    A session can hold more than one socket (the candidate plus, say, an
    observer dashboard), so connections are stored as a set per session id.
    """

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        """Accept the handshake and register the socket."""
        await websocket.accept()
        self._connections[session_id].add(websocket)
        logger.info(
            "WebSocket connected (session=%s, sockets=%d)",
            session_id,
            len(self._connections[session_id]),
        )

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        """Deregister a socket. Safe to call more than once."""
        sockets = self._connections.get(session_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(session_id, None)
        logger.info("WebSocket disconnected (session=%s)", session_id)

    async def send_json(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        """Send to one socket, ignoring a peer that has already gone away."""
        if websocket.client_state is not WebSocketState.CONNECTED:
            return
        try:
            await websocket.send_json(payload)
        except (RuntimeError, WebSocketDisconnectError) as exc:
            logger.warning("Dropping send to a closed socket: %s", exc)

    async def broadcast(self, session_id: str, payload: dict[str, Any]) -> None:
        """Send to every socket in a session, pruning any that fail."""
        dead: list[WebSocket] = []
        for websocket in tuple(self._connections.get(session_id, ())):
            if websocket.client_state is not WebSocketState.CONNECTED:
                dead.append(websocket)
                continue
            try:
                await websocket.send_json(payload)
            except Exception as exc:  # noqa: BLE001 - one bad peer must not stop the rest
                logger.warning("Broadcast failed (session=%s): %s", session_id, exc)
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(session_id, websocket)

    def connection_count(self, session_id: str | None = None) -> int:
        if session_id is not None:
            return len(self._connections.get(session_id, ()))
        return sum(len(s) for s in self._connections.values())

    @property
    def active_sessions(self) -> list[str]:
        return list(self._connections)


manager = ConnectionManager()


async def handle_message(session_id: str, message: dict[str, Any]) -> dict[str, Any]:
    """Route one inbound client message and return the reply to send back.

    Wire format is `{"type": ..., "data": {...}}`. The audio/transcript/scoring
    branches are stubs until the services behind them exist.

    TODO: dispatch `audio_chunk` to stt_service, `answer` to llm_service +
    score_service, and stream partial feedback back to the client.
    """
    msg_type = message.get("type")

    if msg_type == "ping":
        return {"type": "pong"}

    if msg_type in {"audio_chunk", "answer", "transcript"}:
        return {
            "type": "ack",
            "data": {"received": msg_type, "session_id": session_id},
        }

    return {
        "type": "error",
        "data": {"message": f"Unknown message type: {msg_type!r}"},
    }


__all__ = [
    "ConnectionManager",
    "manager",
    "handle_message",
    "WS_NORMAL_CLOSURE",
    "WS_INTERNAL_ERROR",
    "WS_POLICY_VIOLATION",
]
