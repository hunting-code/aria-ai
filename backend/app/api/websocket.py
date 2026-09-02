"""Live interview WebSocket: connection registry and the interview protocol.

Wire format, both directions: {"type": ..., ...}.

  server -> client   question | feedback_token | feedback_complete |
                     interview_complete | error | pong
  client -> server   answer_transcript | next_question | end_interview | ping

The endpoint is mounted in `app.main` at /ws/{session_id}; this module owns the
state machine so the app module stays thin.
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from app.core.security import decode_token
from app.models import Answer, InterviewSession, User
from app.models.session import SessionStatus
from app.services.llm_service import (
    MODE_COACH,
    MODE_INTERVIEWER,
    LLMUnavailableError,
    assess_performance_so_far,
    default_mode_for,
    get_adaptive_question,
    get_questions,
    is_vague_answer,
    llm_service,
)
from app.services.score_service import score_service

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

# Target speaking band, used for the confidence proxy.
TARGET_WPM = 140.0


class ConnectionManager:
    """Tracks active sockets per interview session.

    A session can hold more than one socket (the candidate plus, say, an
    observer dashboard), so connections are stored as a set per session id.
    """

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        """Register an already-accepted socket."""
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

    async def send_json(self, websocket: WebSocket, payload: dict[str, Any]) -> bool:
        """Send to one socket. Returns False if the peer has gone away."""
        if websocket.client_state is not WebSocketState.CONNECTED:
            return False
        try:
            await websocket.send_json(payload)
            return True
        except (RuntimeError, WebSocketDisconnectError) as exc:
            logger.warning("Dropping send to a closed socket: %s", exc)
            return False

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


# --------------------------------------------------------------------------- #
# Scoring helpers
# --------------------------------------------------------------------------- #
def confidence_from_speech(filler_count: int, word_count: int, wpm: float | None) -> float:
    """Proxy for confidence from delivery alone.

    The model scores content; nothing in the transcript reveals hesitancy, so
    confidence is derived from filler density and how far the pace strays from
    the target band. It is a proxy, not a measurement - named as one so it is
    not mistaken for sentiment analysis.
    """
    if word_count <= 0:
        return 0.0
    filler_ratio = filler_count / word_count
    score = 100.0 - min(45.0, filler_ratio * 400)
    if wpm:
        score -= min(20.0, abs(float(wpm) - TARGET_WPM) / 4)
    return max(0.0, min(100.0, round(score, 1)))


# Kept as a re-export: score_service owns the formula so the socket and the
# completion endpoint cannot drift apart.
filler_score = score_service.calculate_filler_score


# --------------------------------------------------------------------------- #
# Database work (run off the event loop)
# --------------------------------------------------------------------------- #
def _load_session(db: Session, session_id: uuid.UUID, user_id: uuid.UUID):
    """Fetch a session, scoped to its owner. Returns None if not theirs."""
    return db.scalar(
        select(InterviewSession).where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == user_id,
            InterviewSession.deleted_at.is_(None),
        )
    )


def _load_answers(db: Session, session_id: uuid.UUID) -> list[Answer]:
    return list(
        db.scalars(
            select(Answer)
            .where(Answer.session_id == session_id)
            .order_by(Answer.question_number, Answer.created_at)
        ).all()
    )


def _set_mode(db: Session, session_id: uuid.UUID, coach: bool) -> None:
    session = db.get(InterviewSession, session_id)
    if session is not None:
        session.coach_mode = coach
        db.commit()


def _persist_answer(db: Session, **fields: Any) -> Answer:
    answer = Answer(**fields)
    db.add(answer)
    db.commit()
    db.refresh(answer)
    return answer


def _finalise_session(db: Session, session_id: uuid.UUID) -> dict[str, Any]:
    """Aggregate every answer into the session row and mark it completed.

    The arithmetic lives in score_service so this path and
    POST /sessions/{id}/complete always produce the same numbers. The LLM
    written feedback is deliberately not generated here - it would add seconds
    of latency to closing the socket; the completion endpoint fills it in.
    """
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise LookupError("session disappeared")

    answers = db.scalars(select(Answer).where(Answer.session_id == session_id)).all()
    scores = score_service.calculate_session_scores(list(answers))

    session.answer_score = scores["answer_score"]
    session.communication_score = scores["communication_score"]
    session.confidence_score = scores["confidence_score"]
    session.filler_word_score = scores["filler_word_score"] if answers else None
    session.overall_score = scores["overall_score"]
    session.total_filler_count = scores["total_filler_count"]
    session.avg_wpm = scores["avg_wpm"]
    session.duration_minutes = scores["duration_minutes"]
    session.status = SessionStatus.COMPLETED.value
    session.completed_at = datetime.now(timezone.utc)
    db.commit()

    return scores


# --------------------------------------------------------------------------- #
# Handler
# --------------------------------------------------------------------------- #
async def _authenticate(websocket: WebSocket, db: Session) -> User | None:
    """Resolve the ?token= query parameter to a user, or None.

    Browsers cannot set headers on a WebSocket handshake, so the access token
    travels as a query parameter. Without this an interview could be driven by
    anyone who learned a session UUID.
    """
    token = websocket.query_params.get("token")
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = uuid.UUID(str(payload["sub"]))
    except Exception:  # noqa: BLE001 - any failure is simply "not authenticated"
        return None
    return await run_in_threadpool(db.get, User, user_id)


async def interview_websocket(
    websocket: WebSocket, session_id: str, db: Session
) -> None:
    """Drive one interview over a WebSocket.

    The socket is accepted first so that rejections can carry a close reason.
    Nothing is sent before the caller is authenticated and proven to own the
    session.
    """
    await websocket.accept()

    # ---- Authenticate and authorise ------------------------------------- #
    user = await _authenticate(websocket, db)
    if user is None or not user.is_active:
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Not authenticated")
        return

    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Invalid session id")
        return

    session = await run_in_threadpool(_load_session, db, session_uuid, user.id)
    if session is None:
        # Same response whether it does not exist or belongs to someone else,
        # so the socket cannot be used to probe for valid session ids.
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Session not found")
        return

    if session.status == SessionStatus.COMPLETED.value:
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Session already completed")
        return

    job_role, difficulty = session.job_role, session.difficulty
    total_questions = len(get_questions(job_role, difficulty))
    coach_mode = bool(session.coach_mode)

    # Resuming a dropped interview continues from the answers already stored.
    prior = await run_in_threadpool(_load_answers, db, session_uuid)
    scored_answers = [a for a in prior if not a.is_follow_up]
    asked_questions = [a.question_text for a in prior]
    index = min(len(scored_answers), total_questions - 1)

    # The question list is chosen one at a time rather than up front: each pick
    # depends on how the candidate has done so far.
    performance = assess_performance_so_far(scored_answers)
    current = get_adaptive_question(job_role, difficulty, performance, asked_questions)
    if current is None:
        current = {"text": "Tell me about a project you are proud of.", "tag": "Behavioral"}
    pending_follow_up = False

    await manager.connect(session_id, websocket)
    history: list[dict[str, str]] = []

    try:
        # ---- Opening question ------------------------------------------- #
        await manager.send_json(
            websocket,
            {
                "type": "question",
                "content": current["text"],
                "tag": current.get("tag"),
                "question_num": index + 1,
                "total_questions": total_questions,
                "resumed": bool(prior),
                "is_follow_up": False,
                "coach_mode": coach_mode,
                "performance": performance,
                "adapted": bool(current.get("adapted")),
            },
        )
        history.append({"role": "assistant", "content": current["text"]})
        asked_questions.append(current["text"])

        # ---- Main loop --------------------------------------------------- #
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                await manager.send_json(
                    websocket,
                    {"type": "error", "message": "Expected a JSON frame"},
                )
                continue

            if not isinstance(data, dict):
                await manager.send_json(
                    websocket, {"type": "error", "message": "Frame must be a JSON object"}
                )
                continue

            msg_type = data.get("type")

            # ---- ping ---------------------------------------------------- #
            if msg_type == "ping":
                await manager.send_json(websocket, {"type": "pong"})
                continue

            # ---- set_mode ------------------------------------------------- #
            if msg_type == "set_mode":
                coach_mode = bool(data.get("coach_mode", True))
                await run_in_threadpool(_set_mode, db, session_uuid, coach_mode)
                await manager.send_json(
                    websocket, {"type": "mode_changed", "coach_mode": coach_mode}
                )
                continue

            # ---- answer_transcript --------------------------------------- #
            if msg_type == "answer_transcript":
                transcript = str(data.get("transcript") or "").strip()
                filler_data = data.get("filler_data") or {}
                if not isinstance(filler_data, dict):
                    filler_data = {}
                wpm = data.get("wpm")
                duration = data.get("duration_seconds")
                question_text = current["text"]
                mode = MODE_COACH if coach_mode else MODE_INTERVIEWER

                # Stream the interviewer's reply as it is generated.
                collected: list[str] = []
                try:
                    async for token in llm_service.get_ai_response(
                        history, transcript, filler_data, wpm, job_role, difficulty, mode
                    ):
                        collected.append(token)
                        if not await manager.send_json(
                            websocket, {"type": "feedback_token", "token": token}
                        ):
                            # Peer vanished mid-stream; stop generating.
                            raise WebSocketDisconnect(code=WS_NORMAL_CLOSURE)
                except LLMUnavailableError as exc:
                    # Report and keep the socket open: the candidate can retry
                    # the answer without losing the interview.
                    await manager.send_json(
                        websocket,
                        {
                            "type": "error",
                            "code": "feedback_failed",
                            "message": str(exc),
                        },
                    )
                    continue

                feedback = "".join(collected).strip()

                scores = await llm_service.evaluate_answer(
                    question_text,
                    transcript,
                    job_role,
                    difficulty,
                    filler_data=filler_data,
                    wpm=wpm,
                    mode=mode,
                )

                filler_count = int(filler_data.get("count") or 0)
                filler_words = filler_data.get("words") or []
                word_count = len(transcript.split())
                confidence = confidence_from_speech(filler_count, word_count, wpm)

                try:
                    await run_in_threadpool(
                        _persist_answer,
                        db,
                        session_id=session_uuid,
                        question_number=index + 1,
                        question_text=question_text,
                        question_tag=current.get("tag"),
                        is_follow_up=pending_follow_up,
                        transcript=transcript or None,
                        answer_score=scores["answer_score"],
                        communication_score=scores["communication_score"],
                        confidence_score=confidence,
                        filler_count=filler_count,
                        filler_words_detected=[str(w) for w in filler_words][:50],
                        wpm=float(wpm) if wpm else None,
                        duration_seconds=float(duration) if duration else None,
                        ai_feedback=feedback or scores.get("feedback_text"),
                    )
                except SQLAlchemyError:
                    logger.exception("Could not save answer for session %s", session_id)
                    await manager.send_json(
                        websocket,
                        {
                            "type": "error",
                            "code": "save_failed",
                            "message": "Your answer could not be saved.",
                        },
                    )
                    continue

                history.append({"role": "user", "content": transcript or "(no answer)"})
                if feedback:
                    history.append({"role": "assistant", "content": feedback})

                # A thin answer earns one follow-up, and only one: a follow-up
                # that is itself vague would loop.
                needs_follow_up = (
                    not pending_follow_up
                    and is_vague_answer(scores["answer_score"], transcript)
                )

                await manager.send_json(
                    websocket,
                    {
                        "type": "feedback_complete",
                        "feedback": feedback,
                        "question_num": index + 1,
                        "is_follow_up": pending_follow_up,
                        "follow_up_coming": needs_follow_up,
                        "question_tag": current.get("tag"),
                        "scores": {
                            "answer_score": scores["answer_score"],
                            "communication_score": scores["communication_score"],
                            "confidence_score": confidence,
                            "strengths": scores.get("strengths", []),
                            "improvements": scores.get("improvements", []),
                            "source": scores.get("source", "model"),
                        },
                        "is_last_question": index + 1 >= total_questions
                        and not needs_follow_up,
                    },
                )

                if needs_follow_up:
                    follow_up = await llm_service.generate_follow_up(
                        question_text, transcript, job_role, difficulty, mode
                    )
                    pending_follow_up = True
                    # Same question_number, so the follow-up does not advance
                    # the interview or count as a new question.
                    current = {"text": follow_up, "tag": current.get("tag")}
                    asked_questions.append(follow_up)
                    history.append({"role": "assistant", "content": follow_up})
                    await manager.send_json(
                        websocket,
                        {
                            "type": "question",
                            "content": follow_up,
                            "tag": current.get("tag"),
                            "question_num": index + 1,
                            "total_questions": total_questions,
                            "is_follow_up": True,
                            "coach_mode": coach_mode,
                        },
                    )
                else:
                    pending_follow_up = False
                continue

            # ---- next_question -------------------------------------------- #
            if msg_type == "next_question":
                if index + 1 >= total_questions:
                    summary = await run_in_threadpool(_finalise_session, db, session_uuid)
                    await manager.send_json(
                        websocket,
                        {
                            "type": "interview_complete",
                            "session_id": session_id,
                            "summary": summary,
                        },
                    )
                    break

                index += 1
                pending_follow_up = False

                answers_so_far = await run_in_threadpool(_load_answers, db, session_uuid)
                performance = assess_performance_so_far(
                    [a for a in answers_so_far if not a.is_follow_up]
                )
                nxt = get_adaptive_question(
                    job_role, difficulty, performance, asked_questions
                )
                if nxt is None:
                    summary = await run_in_threadpool(_finalise_session, db, session_uuid)
                    await manager.send_json(
                        websocket,
                        {
                            "type": "interview_complete",
                            "session_id": session_id,
                            "summary": summary,
                        },
                    )
                    break

                current = nxt
                asked_questions.append(current["text"])
                await manager.send_json(
                    websocket,
                    {
                        "type": "question",
                        "content": current["text"],
                        "tag": current.get("tag"),
                        "question_num": index + 1,
                        "total_questions": total_questions,
                        "is_follow_up": False,
                        "coach_mode": coach_mode,
                        "performance": performance,
                        "adapted": bool(current.get("adapted")),
                    },
                )
                history.append({"role": "assistant", "content": current["text"]})
                continue

            # ---- end_interview -------------------------------------------- #
            if msg_type == "end_interview":
                try:
                    summary = await run_in_threadpool(_finalise_session, db, session_uuid)
                except (SQLAlchemyError, LookupError):
                    logger.exception("Could not finalise session %s", session_id)
                    await manager.send_json(
                        websocket,
                        {"type": "error", "message": "Could not save your results."},
                    )
                    break
                await manager.send_json(
                    websocket,
                    {
                        "type": "interview_complete",
                        "session_id": session_id,
                        "summary": summary,
                    },
                )
                break

            await manager.send_json(
                websocket,
                {"type": "error", "message": f"Unknown message type: {msg_type!r}"},
            )

    except WebSocketDisconnect:
        # Expected whenever a candidate closes the tab or loses connectivity.
        # The session stays `active` so it can be resumed from the dashboard;
        # marking it abandoned here would punish a flaky network.
        logger.info("Candidate disconnected (session=%s)", session_id)
    except Exception:
        logger.exception("WebSocket error (session=%s)", session_id)
        try:
            await websocket.close(code=WS_INTERNAL_ERROR)
        except RuntimeError:
            pass  # already closed
    finally:
        manager.disconnect(session_id, websocket)
        if websocket.client_state is WebSocketState.CONNECTED:
            try:
                await websocket.close(code=WS_NORMAL_CLOSURE)
            except RuntimeError:
                pass


__all__ = [
    "ConnectionManager",
    "manager",
    "interview_websocket",
    "confidence_from_speech",
    "filler_score",
    "WS_NORMAL_CLOSURE",
    "WS_INTERNAL_ERROR",
    "WS_POLICY_VIOLATION",
]
