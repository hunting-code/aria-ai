"""AI Meet: the formal, phased interview channel.

A real interview has shape - it warms you up, digs into your background, tests
you technically, probes behaviour, then closes. This handler walks a candidate
through those five phases, where the practice mode in `app.api.websocket` just
serves a flat question list.

Wire format, both directions: {"type": ..., ...}.

  server -> client   aria_speaking | aria_token | aria_complete | phase_change |
                     follow_up | meet_complete | error | pong
  client -> server   ready | answer_transcript | candidate_question |
                     skip_question | end_meet | ping

Mounted in `app.main` at /ws/meet/{session_id}?token=...
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.websocket import (
    WS_NORMAL_CLOSURE,
    WS_POLICY_VIOLATION,
    _authenticate,
    _load_answers,
    _load_session,
    _persist_answer,
    confidence_from_speech,
    manager,
)
from app.models import InterviewSession, Resume
from app.models.session import SessionStatus
from app.services.llm_service import (
    AI_MEET_PHASE_ORDER,
    AI_MEET_PHASES,
    LLMUnavailableError,
    build_ai_meet_system_prompt,
    generate_career_guidance,
    generate_verbal_debrief,
    generate_wrap_up_question,
    get_ai_meet_opening,
    get_phase_transition,
    is_vague_answer,
    llm_service,
)
from app.services.score_service import score_service

logger = logging.getLogger(__name__)

# One follow-up per question at most: a follow-up that is itself vague would
# loop, and a real interviewer moves on.
MAX_FOLLOW_UPS_PER_QUESTION = 1

# Answers are tagged with the phase's display name ("Warm-up"); map back to the
# phase key when regrouping stored rows.
PHASE_BY_LABEL: dict[str, str] = {
    meta["name"]: phase for phase, meta in AI_MEET_PHASES.items()
}


@dataclass
class AIMeetState:
    """Everything the meet needs to decide what ARIA says next."""

    session_id: str
    candidate_name: str
    job_role: str
    resume_data: dict | None = None
    current_phase: str = "warmup"
    phase_question_count: int = 0  # questions ASKED in the current phase
    total_question_count: int = 0
    conversation_history: list[dict[str, str]] = field(default_factory=list)
    phase_answers: dict[str, list] = field(default_factory=dict)
    is_in_follow_up: bool = False
    current_question: str = ""
    started: bool = False

    # ---- Phase arithmetic ---------------------------------------------- #
    @property
    def phase_quota(self) -> int:
        return AI_MEET_PHASES[self.current_phase]["question_count"]

    @property
    def phase_is_complete(self) -> bool:
        """True once this phase has asked AND been answered to quota."""
        return self.phase_question_count >= self.phase_quota

    @property
    def is_final_phase(self) -> bool:
        return self.current_phase == AI_MEET_PHASE_ORDER[-1]

    def next_phase(self) -> str | None:
        idx = AI_MEET_PHASE_ORDER.index(self.current_phase)
        if idx + 1 >= len(AI_MEET_PHASE_ORDER):
            return None
        return AI_MEET_PHASE_ORDER[idx + 1]

    def advance_phase(self) -> str | None:
        nxt = self.next_phase()
        if nxt is not None:
            self.current_phase = nxt
            self.phase_question_count = 0
        return nxt

    def record_answer(self, answer: Any) -> None:
        self.phase_answers.setdefault(self.current_phase, []).append(answer)


# --------------------------------------------------------------------------- #
# Database work (runs off the event loop)
# --------------------------------------------------------------------------- #
def _load_resume_data(db: Session, user_id: uuid.UUID) -> dict | None:
    resume = db.execute(
        select(Resume).where(Resume.user_id == user_id)
    ).scalar_one_or_none()
    return resume.parsed_data if resume and resume.parsed_data else None


def _set_phase(db: Session, session_id: uuid.UUID, phase: str) -> None:
    session = db.get(InterviewSession, session_id)
    if session is not None:
        session.meet_phase = phase
        db.commit()


def _finalise_meet(
    db: Session,
    session_id: uuid.UUID,
    phase_scores: dict,
    debrief: str,
    guidance: dict,
) -> dict[str, Any]:
    """Write the aggregate scores, phase breakdown, debrief and guidance."""
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise LookupError("session disappeared")

    answers = _load_answers(db, session_id)
    scores = score_service.calculate_session_scores(answers)

    session.answer_score = scores["answer_score"]
    session.communication_score = scores["communication_score"]
    session.confidence_score = scores["confidence_score"]
    session.filler_word_score = scores["filler_word_score"] if answers else None
    session.overall_score = scores["overall_score"]
    session.total_filler_count = scores["total_filler_count"]
    session.avg_wpm = scores["avg_wpm"]
    session.duration_minutes = scores["duration_minutes"]
    session.phase_scores = phase_scores
    session.verbal_debrief = debrief
    session.career_guidance = guidance
    session.meet_phase = "wrap_up"
    session.status = SessionStatus.COMPLETED.value
    session.completed_at = datetime.now(timezone.utc)
    db.commit()
    return scores


# --------------------------------------------------------------------------- #
# ARIA's turn
# --------------------------------------------------------------------------- #
async def _speak(
    websocket: WebSocket,
    state: AIMeetState,
    system_prompt: str,
    instruction: str,
    *,
    is_question: bool,
    counts_as_question: bool | None = None,
) -> str | None:
    """Stream one ARIA turn to the client.

    Sends `aria_speaking` first so subtitles can render immediately, then the
    tokens, then `aria_complete` - which is the client's cue to open the mic.
    Returns the full text, or None if the peer vanished mid-stream.
    """
    await manager.send_json(
        websocket,
        {
            "type": "aria_speaking",
            "text": "",
            "is_question": is_question,
            "phase": state.current_phase,
        },
    )

    collected: list[str] = []
    try:
        async for token in llm_service.get_ai_response(
            state.conversation_history,
            instruction,
            None,
            None,
            state.job_role,
            "intermediate",
            system_prompt_override=system_prompt,
        ):
            collected.append(token)
            if not await manager.send_json(
                websocket, {"type": "aria_token", "token": token}
            ):
                return None
    except LLMUnavailableError as exc:
        await manager.send_json(
            websocket,
            {"type": "error", "code": "aria_failed", "message": str(exc)},
        )
        return None

    text = "".join(collected).strip()
    if not text:
        await manager.send_json(
            websocket,
            {
                "type": "error",
                "code": "aria_failed",
                "message": "The AI service is temporarily unavailable.",
            },
        )
        return None

    state.conversation_history.append({"role": "assistant", "content": text})
    # `is_question` tells the CLIENT to reopen the microphone.
    # `counts_as_question` decides whether the phase quota is consumed. They
    # differ for a follow-up: it must be answered, but it re-asks the same slot.
    consumes = is_question if counts_as_question is None else counts_as_question
    if is_question:
        state.current_question = text
    if consumes:
        state.phase_question_count += 1
        state.total_question_count += 1

    await manager.send_json(
        websocket,
        {
            "type": "aria_complete",
            "is_question": is_question,
            "phase": state.current_phase,
            "question_number": state.total_question_count,
        },
    )
    return text


def _ask_instruction(state: AIMeetState) -> str:
    """What to tell the model to produce for the next question."""
    phase = AI_MEET_PHASES[state.current_phase]
    asked = state.phase_question_count
    return (
        f"[DIRECTOR NOTE - not spoken] You are in the {phase['name']} phase: "
        f"{phase['description']}. This is question {asked + 1} of "
        f"{phase['question_count']} in this phase. Ask exactly ONE question, "
        "building on what the candidate has already said. Do not number it, do "
        "not name the phase, and do not restate the whole interview structure."
    )


# --------------------------------------------------------------------------- #
# Handler
# --------------------------------------------------------------------------- #
async def ai_meet_websocket(
    websocket: WebSocket, session_id: str, db: Session
) -> None:
    """Drive one AI Meet interview over a WebSocket."""
    await websocket.accept()

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
        await websocket.close(code=WS_POLICY_VIOLATION, reason="Session not found")
        return
    if session.status == SessionStatus.COMPLETED.value:
        await websocket.close(
            code=WS_POLICY_VIOLATION, reason="Session already completed"
        )
        return
    if session.session_type != "ai_meet":
        await websocket.close(
            code=WS_POLICY_VIOLATION, reason="Not an AI Meet session"
        )
        return

    resume_data = (
        await run_in_threadpool(_load_resume_data, db, user.id)
        if session.resume_used
        else None
    )
    candidate_name = (user.full_name or user.username or "there").split(" ")[0]

    state = AIMeetState(
        session_id=session_id,
        candidate_name=candidate_name,
        job_role=session.job_role,
        resume_data=resume_data,
        current_phase=session.meet_phase or "warmup",
    )
    system_prompt = build_ai_meet_system_prompt(
        session.job_role, candidate_name, resume_data
    )

    await manager.connect(session_id, websocket)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await manager.send_json(websocket, {"type": "pong"})
                continue

            # ---- ready: opening script, then the first question ---------- #
            if msg_type == "ready":
                if state.started:
                    continue
                state.started = True
                opening = get_ai_meet_opening(candidate_name, session.job_role)
                # The opening is a fixed script, not generated - it is sent as
                # one frame so the client can start TTS without waiting.
                await manager.send_json(
                    websocket,
                    {
                        "type": "aria_speaking",
                        "text": opening,
                        "is_question": False,
                        "phase": state.current_phase,
                    },
                )
                await manager.send_json(
                    websocket,
                    {
                        "type": "aria_complete",
                        "is_question": False,
                        "phase": state.current_phase,
                        "question_number": 0,
                    },
                )
                state.conversation_history.append(
                    {"role": "assistant", "content": opening}
                )
                await _speak(
                    websocket, state, system_prompt, _ask_instruction(state),
                    is_question=True,
                )
                continue

            # ---- candidate asked ARIA something -------------------------- #
            if msg_type == "candidate_question":
                text = str(data.get("text") or "").strip()
                if not text:
                    continue
                state.conversation_history.append({"role": "user", "content": text})
                await _speak(
                    websocket,
                    state,
                    system_prompt,
                    "[DIRECTOR NOTE - not spoken] The candidate just asked you a "
                    "question. Answer it briefly and honestly as the interviewer, "
                    "in 2-3 sentences. Do not ask a new interview question yet.",
                    is_question=False,
                )
                continue

            # ---- skip_question -------------------------------------------- #
            # An escape hatch. If recognition fails, or the candidate simply
            # cannot answer, the interview must still be able to move on - being
            # trapped on one question is worse than a gap in the scoring. The
            # skipped question is recorded unanswered rather than scored as a
            # bad answer, so it does not distort the result.
            if msg_type == "skip_question":
                try:
                    await run_in_threadpool(
                        _persist_answer,
                        db,
                        session_id=session_uuid,
                        question_number=state.total_question_count,
                        question_text=state.current_question,
                        question_tag=AI_MEET_PHASES[state.current_phase]["name"],
                        is_follow_up=state.is_in_follow_up,
                        transcript=None,
                        answer_score=None,
                        communication_score=None,
                        confidence_score=None,
                        filler_count=0,
                        filler_words_detected=[],
                        wpm=None,
                        duration_seconds=None,
                        ai_feedback="Skipped.",
                    )
                except SQLAlchemyError:
                    logger.exception("Could not record a skip (%s)", session_id)

                state.is_in_follow_up = False

                if state.phase_is_complete:
                    if state.is_final_phase:
                        await _complete_meet(websocket, state, session, session_uuid, db)
                        return
                    from_phase = state.current_phase
                    to_phase = state.advance_phase()
                    transition = get_phase_transition(from_phase, to_phase)
                    await run_in_threadpool(_set_phase, db, session_uuid, to_phase)
                    await manager.send_json(
                        websocket,
                        {
                            "type": "phase_change",
                            "from": from_phase,
                            "to": to_phase,
                            "message": transition,
                            "phase_name": AI_MEET_PHASES[to_phase]["name"],
                            "question_count": AI_MEET_PHASES[to_phase]["question_count"],
                        },
                    )
                    if to_phase == "wrap_up":
                        wrap = generate_wrap_up_question(candidate_name)
                        full = f"{transition} {wrap}"
                        await manager.send_json(
                            websocket,
                            {"type": "aria_speaking", "text": full,
                             "is_question": True, "phase": to_phase},
                        )
                        state.conversation_history.append(
                            {"role": "assistant", "content": full}
                        )
                        state.current_question = wrap
                        state.phase_question_count += 1
                        state.total_question_count += 1
                        await manager.send_json(
                            websocket,
                            {"type": "aria_complete", "is_question": True,
                             "phase": to_phase,
                             "question_number": state.total_question_count},
                        )
                        continue

                if await _speak(
                    websocket, state, system_prompt, _ask_instruction(state),
                    is_question=True,
                ) is None:
                    raise WebSocketDisconnect(code=WS_NORMAL_CLOSURE)
                continue

            # ---- an answer ----------------------------------------------- #
            if msg_type == "answer_transcript":
                transcript = str(data.get("transcript") or "").strip()
                metrics = data.get("metrics") or {}
                if not isinstance(metrics, dict):
                    metrics = {}
                filler_data = metrics.get("filler_data") or {}
                if not isinstance(filler_data, dict):
                    filler_data = {}
                wpm = metrics.get("wpm")
                duration = metrics.get("duration_seconds")
                question_text = state.current_question

                state.conversation_history.append(
                    {"role": "user", "content": transcript or "(no answer)"}
                )

                # Score the answer. The wrap-up is a courtesy exchange, so it is
                # recorded but not graded for content.
                try:
                    scores = await llm_service.evaluate_answer(
                        question_text,
                        transcript,
                        state.job_role,
                        session.difficulty,
                        filler_data=filler_data,
                        wpm=wpm,
                    )
                except LLMUnavailableError as exc:
                    await manager.send_json(
                        websocket,
                        {"type": "error", "code": "scoring_failed", "message": str(exc)},
                    )
                    continue

                filler_count = int(filler_data.get("count") or 0)
                word_count = len(transcript.split())
                confidence = confidence_from_speech(filler_count, word_count, wpm)

                try:
                    answer_row = await run_in_threadpool(
                        _persist_answer,
                        db,
                        session_id=session_uuid,
                        question_number=state.total_question_count,
                        question_text=question_text,
                        question_tag=AI_MEET_PHASES[state.current_phase]["name"],
                        is_follow_up=state.is_in_follow_up,
                        transcript=transcript or None,
                        answer_score=scores["answer_score"],
                        communication_score=scores["communication_score"],
                        confidence_score=confidence,
                        filler_count=filler_count,
                        filler_words_detected=[
                            str(w) for w in (filler_data.get("words") or [])
                        ][:50],
                        wpm=float(wpm) if wpm else None,
                        duration_seconds=float(duration) if duration else None,
                        ai_feedback=scores.get("feedback_text"),
                    )
                    state.record_answer(answer_row)
                except SQLAlchemyError:
                    logger.exception("Could not save AI Meet answer (%s)", session_id)
                    await manager.send_json(
                        websocket,
                        {
                            "type": "error",
                            "code": "save_failed",
                            "message": "Your answer could not be saved.",
                        },
                    )
                    continue

                # ---- Follow-up? ------------------------------------------ #
                # A thin answer earns exactly one clarifying follow-up, and
                # never in the wrap-up, where there is nothing left to probe.
                needs_follow_up = (
                    not state.is_in_follow_up
                    and state.current_phase != "wrap_up"
                    and is_vague_answer(scores["answer_score"], transcript)
                )
                if needs_follow_up:
                    state.is_in_follow_up = True
                    text = await _speak(
                        websocket,
                        state,
                        system_prompt,
                        "[DIRECTOR NOTE - not spoken] That answer was thin. Ask ONE "
                        "clarifying follow-up that references what they just said "
                        "and asks for the missing specifics. This does not count "
                        "as a new interview question.",
                        # A follow-up IS a question - the candidate has to
                        # answer it, so the client must reopen the microphone.
                        # Sending False left the interview with no mic and no way
                        # to submit, a dead end. It still re-asks the same slot,
                        # so it does not consume one from the phase quota.
                        is_question=True,
                        counts_as_question=False,
                    )
                    if text is None:
                        raise WebSocketDisconnect(code=WS_NORMAL_CLOSURE)
                    # A follow-up re-asks the same slot: keep the question text
                    # so the next answer is filed against it.
                    state.current_question = text
                    await manager.send_json(
                        websocket, {"type": "follow_up", "question": text}
                    )
                    continue

                state.is_in_follow_up = False

                # ---- Phase complete? ------------------------------------- #
                if state.phase_is_complete:
                    if state.is_final_phase:
                        await _complete_meet(
                            websocket, state, session, session_uuid, db
                        )
                        return

                    from_phase = state.current_phase
                    to_phase = state.advance_phase()
                    transition = get_phase_transition(from_phase, to_phase)
                    await run_in_threadpool(_set_phase, db, session_uuid, to_phase)
                    await manager.send_json(
                        websocket,
                        {
                            "type": "phase_change",
                            "from": from_phase,
                            "to": to_phase,
                            "message": transition,
                            "phase_name": AI_MEET_PHASES[to_phase]["name"],
                            "question_count": AI_MEET_PHASES[to_phase]["question_count"],
                        },
                    )

                    # The wrap-up question is a fixed script - the "any
                    # questions?" moment every real interview ends on.
                    if to_phase == "wrap_up":
                        wrap = generate_wrap_up_question(candidate_name)
                        full = f"{transition} {wrap}"
                        await manager.send_json(
                            websocket,
                            {
                                "type": "aria_speaking",
                                "text": full,
                                "is_question": True,
                                "phase": to_phase,
                            },
                        )
                        state.conversation_history.append(
                            {"role": "assistant", "content": full}
                        )
                        state.current_question = wrap
                        state.phase_question_count += 1
                        state.total_question_count += 1
                        await manager.send_json(
                            websocket,
                            {
                                "type": "aria_complete",
                                "is_question": True,
                                "phase": to_phase,
                                "question_number": state.total_question_count,
                            },
                        )
                        continue

                    instruction = (
                        f'[DIRECTOR NOTE - not spoken] Open with this transition, '
                        f'worded naturally: "{transition}" Then '
                        + _ask_instruction(state)[len("[DIRECTOR NOTE - not spoken] "):]
                    )
                    if await _speak(
                        websocket, state, system_prompt, instruction, is_question=True
                    ) is None:
                        raise WebSocketDisconnect(code=WS_NORMAL_CLOSURE)
                    continue

                # ---- Same phase, next question --------------------------- #
                if await _speak(
                    websocket, state, system_prompt, _ask_instruction(state),
                    is_question=True,
                ) is None:
                    raise WebSocketDisconnect(code=WS_NORMAL_CLOSURE)
                continue

            # ---- premature end ------------------------------------------- #
            if msg_type == "end_meet":
                await _complete_meet(websocket, state, session, session_uuid, db)
                return

    except WebSocketDisconnect:
        logger.info("AI Meet socket closed by peer (session=%s)", session_id)
    except Exception:  # noqa: BLE001 - never leak a traceback to the client
        logger.exception("AI Meet failed (session=%s)", session_id)
        await manager.send_json(
            websocket,
            {
                "type": "error",
                "code": "internal",
                "message": "The interview hit an unexpected error.",
            },
        )
    finally:
        manager.disconnect(session_id, websocket)


async def _complete_meet(
    websocket: WebSocket,
    state: AIMeetState,
    session: InterviewSession,
    session_uuid: uuid.UUID,
    db: Session,
) -> None:
    """Score every phase, write the debrief and guidance, close the meet."""
    answers = await run_in_threadpool(_load_answers, db, session_uuid)

    # Normally the live state holds each phase's answers. A socket that
    # reconnected mid-interview starts with an empty map, though, so fall back
    # to regrouping the stored answers by the phase tag they were saved with -
    # otherwise ending after a reconnect would score no phases at all.
    grouped = state.phase_answers
    if not grouped:
        grouped = {}
        for row in answers:
            phase = PHASE_BY_LABEL.get(row.question_tag or "")
            if phase:
                grouped.setdefault(phase, []).append(row)

    phase_scores = {
        phase: score_service.score_phase(phase, rows)
        for phase, rows in grouped.items()
    }
    answer_digest = [
        {
            "question": a.question_text,
            "answer": (a.transcript or "")[:1200],
            "answer_score": a.answer_score,
            "phase": a.question_tag,
        }
        for a in answers
    ]
    session_data = {
        "job_role": session.job_role,
        "overall_score": score_service.calculate_session_scores(answers)[
            "overall_score"
        ],
        "phase_scores": phase_scores,
    }

    debrief = await generate_verbal_debrief(
        session_data, answer_digest, state.candidate_name
    )
    guidance = await generate_career_guidance(
        session_data, answer_digest, state.resume_data
    )

    try:
        scores = await run_in_threadpool(
            _finalise_meet, db, session_uuid, phase_scores, debrief, guidance
        )
    except (SQLAlchemyError, LookupError):
        logger.exception("Could not finalise AI Meet %s", state.session_id)
        await manager.send_json(
            websocket,
            {
                "type": "error",
                "code": "save_failed",
                "message": "The interview could not be saved.",
            },
        )
        return

    # The debrief is spoken, so it ships as an aria_speaking frame too - the
    # client can run TTS over it while rendering the summary.
    await manager.send_json(
        websocket,
        {
            "type": "aria_speaking",
            "text": debrief,
            "is_question": False,
            "phase": "wrap_up",
        },
    )
    await manager.send_json(
        websocket,
        {
            "type": "meet_complete",
            "session_id": state.session_id,
            "verbal_debrief": debrief,
            "phase_scores": phase_scores,
            "career_guidance": guidance,
            "summary": scores,
        },
    )
