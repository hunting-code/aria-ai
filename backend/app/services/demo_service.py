"""The shared demo account.

Signing in as `demo` gives a tour of a populated account without registering.
Interviews started in demo mode run normally - the WebSocket needs a real row
to attach to - but every sign-in resets the account to the same five samples,
so nothing a visitor does accumulates or leaks into the next visitor's view.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Final

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models import Answer, InterviewSession, User

logger = logging.getLogger(__name__)

DEMO_USERNAME: Final[str] = "demo"
DEMO_PASSWORD: Final[str] = "demo123"
DEMO_EMAIL: Final[str] = "demo@aria.ai"
DEMO_FULL_NAME: Final[str] = "Demo Candidate"

# Five sessions spanning a weak start to a strong finish, so the charts, the
# radar and the streak all have something honest to show.
SAMPLES: Final[list[dict[str, Any]]] = [
    dict(days=12, role="hr", difficulty="beginner", overall=48.2, answer=45.0,
         confidence=58.0, communication=52.0, filler=39.0, fillers=21, wpm=168.0, minutes=11.4),
    dict(days=9, role="data_analyst", difficulty="intermediate", overall=57.6, answer=55.0,
         confidence=62.0, communication=60.0, filler=52.0, fillers=16, wpm=155.0, minutes=16.2),
    dict(days=5, role="software_engineer", difficulty="intermediate", overall=64.1, answer=63.0,
         confidence=66.0, communication=68.0, filler=59.0, fillers=12, wpm=147.0, minutes=18.8),
    dict(days=2, role="ai_engineer", difficulty="advanced", overall=71.8, answer=72.0,
         confidence=70.0, communication=74.0, filler=68.0, fillers=9, wpm=138.0, minutes=24.5),
    dict(days=1, role="ai_engineer", difficulty="advanced", overall=82.4, answer=84.0,
         confidence=79.0, communication=81.0, filler=83.0, fillers=4, wpm=134.0, minutes=27.1),
]

SAMPLE_ANSWERS: Final[list[dict[str, Any]]] = [
    dict(n=1, tag="Technical", q="Design an evaluation harness for an LLM agent that takes multi-step actions. What do you measure?",
         a="We measured task completion at each step, not just the final answer. I built a harness that replays four hundred recorded traces nightly and flags any step where a tool call changed. Completion went from sixty-one percent to seventy-eight after we added retries.",
         score=84.0, conf=81.0, comm=79.0, fillers=["um", "so"], wpm=136.0, secs=98.0,
         fb="Naming the sixty-one to seventy-eight jump is what makes this concrete. You did not say how the four hundred traces were sampled, and that is where selection bias would hide."),
    dict(n=2, tag="Technical", q="How would you cut inference cost by 70% without a material quality drop?",
         a="Quantise to int8, batch aggressively, and cache the embedding lookups.",
         score=41.0, conf=58.0, comm=52.0, fillers=[], wpm=112.0, secs=21.0,
         fb="Three levers named, none costed. You did not say which you would try first or how you would know quality had held."),
    dict(n=2, tag="Technical", follow_up=True, q="You listed three levers - which one would you reach for first, and how would you know quality had not dropped?",
         a="Probably quantisation. We would watch the eval set.",
         score=38.0, conf=52.0, comm=48.0, fillers=[], wpm=104.0, secs=14.0,
         fb="Still no threshold. \"Watch the eval set\" is not a decision rule - name the metric and the number you would stop at."),
    dict(n=3, tag="Situational", q="Your RAG system returns confident, well-written, wrong answers. Diagnose it.",
         a="I would look at retrieval first and check whether the right chunk is even in the top k. We had this exact problem and the chunk size was too big, so the embedding was averaging over three topics. Cutting chunks to four hundred tokens fixed most of it.",
         score=88.0, conf=84.0, comm=86.0, fillers=["like"], wpm=132.0, secs=76.0,
         fb="Going to retrieval before generation is the right order, and the chunk-size story is specific. Say how you verified the fix and this is a complete answer."),
    dict(n=4, tag="Behavioral", q="Tell me about a time you disagreed with the team on a modelling approach.",
         a="We disagreed about whether to fine-tune or improve retrieval. I pushed for an offline eval first, we ran it in two days, and retrieval won on both cost and accuracy. I was prepared to be wrong and said so.",
         score=79.0, conf=76.0, comm=82.0, fillers=["um", "you know"], wpm=141.0, secs=68.0,
         fb="Good STAR shape and you named the outcome. The result would land harder with the actual accuracy delta."),
]

DEMO_FEEDBACK: Final[dict[str, Any]] = {
    "strengths": [
        "You quantified results - sixty-one to seventy-eight percent completion, chunks cut to four hundred tokens.",
        "On the RAG diagnosis you went to retrieval before generation, which is the right order.",
        "You were willing to say you had been prepared to be wrong, and backed it with an eval.",
    ],
    "weaknesses": [
        "The cost question named three levers and costed none of them.",
        "The follow-up still gave no threshold - \"watch the eval set\" is not a decision rule.",
        "Your disagreement story stopped short of the accuracy delta that would prove the point.",
    ],
    "top_suggestions": [
        "Cost every lever you name, even roughly - order of magnitude is enough.",
        "State the metric and the number you would stop at before you start optimising.",
        "End every story with the measured outcome, not the decision.",
    ],
    "overall_verdict": (
        "A strong session with real specifics - the chunk-size story and the completion "
        "numbers are the kind of detail that separates a senior answer from a plausible "
        "one. The cost question is the gap: you know the levers but have not priced them, "
        "and under follow-up you did not converge on a threshold. Close that and this is "
        "a pass at a senior bar."
    ),
    "recommended_resources": [
        "Retrieval evaluation metrics: recall@k versus answer faithfulness",
        "Inference cost profiling - quantisation, batching and KV-cache trade-offs",
    ],
    "source": "model",
}


def get_or_create_demo_user(db: Session) -> User:
    """Fetch the demo account, creating it on first use."""
    user = db.scalar(select(User).where(User.username == DEMO_USERNAME))
    if user is None:
        user = User(
            username=DEMO_USERNAME,
            email=DEMO_EMAIL,
            full_name=DEMO_FULL_NAME,
            hashed_password=get_password_hash(DEMO_PASSWORD),
            is_demo=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info("Created the demo account")
    elif not user.is_demo:
        user.is_demo = True
        db.commit()
    return user


def reset_demo_data(db: Session, user: User) -> None:
    """Restore the demo account to its five sample sessions.

    Everything the previous visitor did is removed first: the account is
    shared, so an interview started in demo mode must not persist into the next
    person's view. This is what "sessions don't save" means in practice.
    """
    existing = db.scalars(
        select(InterviewSession.id).where(InterviewSession.user_id == user.id)
    ).all()
    if existing:
        db.execute(delete(Answer).where(Answer.session_id.in_(existing)))
        db.execute(delete(InterviewSession).where(InterviewSession.id.in_(existing)))
        db.commit()

    now = datetime.now(timezone.utc)
    for i, sample in enumerate(SAMPLES):
        created = now - timedelta(days=sample["days"])
        session = InterviewSession(
            user_id=user.id,
            job_role=sample["role"],
            difficulty=sample["difficulty"],
            status="completed",
            coach_mode=sample["difficulty"] != "advanced",
            overall_score=sample["overall"],
            answer_score=sample["answer"],
            confidence_score=sample["confidence"],
            communication_score=sample["communication"],
            filler_word_score=sample["filler"],
            total_filler_count=sample["fillers"],
            avg_wpm=sample["wpm"],
            duration_minutes=sample["minutes"],
            created_at=created,
            completed_at=created + timedelta(minutes=sample["minutes"]),
            # Only the most recent session carries a written verdict, which is
            # also what a real account looks like mid-use.
            final_feedback=DEMO_FEEDBACK if i == len(SAMPLES) - 1 else None,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        if i == len(SAMPLES) - 1:
            for a in SAMPLE_ANSWERS:
                db.add(
                    Answer(
                        session_id=session.id,
                        question_number=a["n"],
                        question_text=a["q"],
                        question_tag=a["tag"],
                        is_follow_up=a.get("follow_up", False),
                        transcript=a["a"],
                        answer_score=a["score"],
                        confidence_score=a["conf"],
                        communication_score=a["comm"],
                        filler_count=len(a["fillers"]),
                        filler_words_detected=a["fillers"],
                        wpm=a["wpm"],
                        duration_seconds=a["secs"],
                        ai_feedback=a["fb"],
                        created_at=created + timedelta(minutes=a["n"] * 3),
                    )
                )
            db.commit()

    logger.info("Reset the demo account to %d sample sessions", len(SAMPLES))


__all__ = [
    "DEMO_USERNAME",
    "DEMO_PASSWORD",
    "get_or_create_demo_user",
    "reset_demo_data",
]
