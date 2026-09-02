"""LLM service: interview prompts, the question bank, and answer evaluation.

Every question the interview asks comes from the hardcoded bank below; the LLM
supplies feedback and scoring on top. That keeps a session usable - and its
questions deterministic - even when the model is unavailable.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Any, Final

from app.core.config import get_settings
from app.services.gemini_client import GeminiError, gemini

logger = logging.getLogger(__name__)
settings = get_settings()

PLACEHOLDER_KEYS: Final[frozenset[str]] = frozenset(
    {"", "your-gemini-key-here", "your-api-key-here", "changeme", "test"}
)


class LLMUnavailableError(RuntimeError):
    """The model could not be reached or refused the request."""


# --------------------------------------------------------------------------- #
# Role and difficulty calibration
# --------------------------------------------------------------------------- #
ROLE_PERSONAS: Final[dict[str, str]] = {
    "data_analyst": "a senior Data Analyst at a top tech company",
    "software_engineer": "a senior Software Engineer at a top tech company",
    "hr": "an experienced HR Business Partner at a top tech company",
    "ai_engineer": "a senior AI/ML Engineer at a top tech company",
}

ROLE_FOCUS: Final[dict[str, str]] = {
    "data_analyst": (
        "SQL correctness, statistical reasoning, how they choose a visualisation, "
        "and whether they tie analysis back to a business decision"
    ),
    "software_engineer": (
        "algorithmic reasoning and complexity, system design trade-offs, "
        "API and data-model choices, and how they handle failure cases"
    ),
    "hr": (
        "judgement in ambiguous people situations, policy versus empathy, "
        "evidence of real ownership, and how they handle conflict"
    ),
    "ai_engineer": (
        "model selection and evaluation, data and training pipeline decisions, "
        "LLM/RAG design trade-offs, and what they do when a model underperforms"
    ),
}

DIFFICULTY_CALIBRATION: Final[dict[str, str]] = {
    "beginner": (
        "This candidate is early in their career. Ask for fundamentals and accept "
        "a solid textbook answer. Correct misconceptions gently but clearly. Do not "
        "pile on follow-ups - one clarification at most, and only if the answer is "
        "genuinely unclear."
    ),
    "intermediate": (
        "This candidate has a working foundation and needs polish. Expect concrete "
        "examples from real work, not definitions. Push once on any claim that is "
        "asserted without evidence. Follow-ups are welcome where the answer is thin."
    ),
    "advanced": (
        "This candidate is targeting senior roles at competitive companies. Expect "
        "trade-off reasoning, scale considerations and awareness of failure modes. "
        "Probe hard on hand-waving. A merely correct answer is not yet a strong one."
    ),
}


MODE_INTERVIEWER: Final[str] = "interviewer"
MODE_COACH: Final[str] = "coach"

MODE_PROMPTS: Final[dict[str, str]] = {
    MODE_INTERVIEWER: (
        "Mode: INTERVIEWER. Behave as you would in a real interview. Keep feedback "
        "short and neutral, do not soften a weak answer, and do not teach. Move on "
        "briskly. The candidate should feel evaluated, not tutored."
    ),
    MODE_COACH: (
        "Mode: COACH. The candidate is here to improve, so explain your reasoning. "
        "When an answer falls short, name what was missing and show the shape a "
        "stronger answer would take - a structure, an example to include, a number "
        "to quantify. Stay honest: encouragement never means inflating a score."
    ),
}


def default_mode_for(difficulty: str) -> str:
    """Coaching for newcomers, interview pressure for those targeting seniority."""
    return MODE_INTERVIEWER if difficulty == "advanced" else MODE_COACH


def build_system_prompt(
    job_role: str, difficulty: str, mode: str = MODE_COACH
) -> str:
    """Return the role-specific, difficulty-calibrated interviewer prompt.

    Unknown roles or difficulties fall back to sensible defaults rather than
    raising, so a stray value can never take an interview down mid-session.
    """
    persona = ROLE_PERSONAS.get(job_role, "an experienced interviewer")
    mode_prompt = MODE_PROMPTS.get(mode, MODE_PROMPTS[MODE_COACH])
    focus = ROLE_FOCUS.get(job_role, "the substance and structure of their answers")
    calibration = DIFFICULTY_CALIBRATION.get(
        difficulty, DIFFICULTY_CALIBRATION["intermediate"]
    )

    return f"""You are ARIA, {persona} conducting a real interview. You are direct, professional, and genuinely evaluate every answer.

Your behavior:
- After each answer, acknowledge ONE specific thing the candidate actually said
- Point out the EXACT gap or mistake (be specific, never generic)
- If the answer is vague: ask ONE targeted follow-up question
- If the answer is complete: give a brief tip and announce the next question
- Track answer quality across the conversation

What you evaluate:
- Relevance: did they actually answer what was asked?
- Depth: did they show real understanding or surface knowledge?
- Structure: STAR method for behavioral, clear logic for technical
- Specificity: concrete examples, numbers, outcomes - not vague claims

For this role, weight your judgement towards {focus}.

Difficulty calibration: {calibration}

{mode_prompt}

You NEVER say 'good job' unless genuinely earned.
You NEVER give generic feedback like 'work on communication'.
You always reference what they specifically said.
You speak concisely - max 4-5 sentences per feedback turn."""


# --------------------------------------------------------------------------- #
# Question bank
# --------------------------------------------------------------------------- #
# Eight questions per role and difficulty, mixing technical, behavioural,
# situational and role-specific prompts. The interview serves the first N for
# the chosen difficulty (see QUESTION_COUNTS).

DATA_ANALYST_QUESTIONS: Final[dict[str, list[str]]] = {
    "beginner": [
        "Walk me through what you would do with a CSV of last month's sales that you have never seen before.",
        "What is the difference between an INNER JOIN and a LEFT JOIN, and when would the choice change your answer?",
        "You calculate an average order value of $340, but the median is $45. What is going on, and which would you report?",
        "Tell me about a time you found a mistake in your own analysis. How did you catch it?",
        "A stakeholder asks for 'a dashboard of everything'. How do you respond?",
        "What does a p-value actually tell you, in plain language?",
        "You have a column where 30% of values are missing. Walk me through your options.",
        "Describe a chart you have built that changed someone's mind. What made it work?",
    ],
    "intermediate": [
        "Design the SQL to find customers whose spend dropped more than 50% month over month. Talk me through it.",
        "Your weekly report shows signups up 20%, but revenue is flat. How do you investigate?",
        "Explain the difference between correlation and causation using a real example from your work.",
        "Tell me about a time you had to tell a stakeholder their favourite metric was misleading.",
        "How would you design an A/B test for a new checkout flow, and what would make you stop it early?",
        "You inherit a dashboard nobody trusts. What are your first three steps?",
        "When would you use a window function instead of a self-join, and what is the cost?",
        "Describe an analysis where the data was fine but your conclusion was wrong. What did you learn?",
    ],
    "advanced": [
        "You are asked to measure the revenue impact of a feature that shipped to everyone at once, with no holdout. How do you approach it?",
        "Walk me through diagnosing a metrics pipeline that has been silently double-counting for three weeks.",
        "How do you decide whether a 3% lift is worth shipping? Take me through the full reasoning.",
        "Tell me about a time you pushed back on a leadership decision using data, and it did not go your way.",
        "Design a data model for a subscription business that supports both cohort and revenue reporting.",
        "Explain Simpson's paradox with a case you have actually encountered or could plausibly hit.",
        "Your experiment is underpowered but leadership wants an answer on Friday. What do you do?",
        "How would you build a metric that is hard to game but still simple enough to act on?",
    ],
}

SOFTWARE_ENGINEER_QUESTIONS: Final[dict[str, list[str]]] = {
    "beginner": [
        "Explain the difference between a list and a dictionary, and when the choice matters for performance.",
        "Walk me through how you would find duplicates in a large array. What is the complexity?",
        "What happens, step by step, when you type a URL into a browser and press enter?",
        "Tell me about a bug that took you far longer to fix than you expected. What was it?",
        "How would you explain an API to someone non-technical?",
        "What is the difference between a stack and a queue, and where have you used each?",
        "Your code works locally but fails in production. What is your first move?",
        "Describe a piece of code you are proud of. What made it good?",
    ],
    "intermediate": [
        "Design a URL shortener. Start with the data model and the API surface.",
        "Explain the time and space trade-offs between a hash map and a balanced tree for a lookup-heavy workload.",
        "Tell me about a time you disagreed with a code review comment. How did it resolve?",
        "How would you make an endpoint that takes 3 seconds respond in under 300ms?",
        "What does 'idempotent' mean, and why does it matter for a payments API?",
        "Walk me through how you would add caching to a read-heavy service, and what could go wrong.",
        "You are asked to ship a feature you believe is under-specified. What do you do?",
        "Explain a race condition you have actually hit and how you fixed it.",
    ],
    "advanced": [
        "Design a rate limiter that works across a fleet of 200 stateless servers. Talk me through the trade-offs.",
        "How would you migrate a 2TB table to a new schema with zero downtime?",
        "Explain how you would debug a latency regression that only appears at p99 and only in one region.",
        "Tell me about a technical decision you made that you later regretted at scale.",
        "Design the consistency model for a collaborative document editor. What do you give up?",
        "How do you decide between adding a queue and adding a database index? Walk me through the reasoning.",
        "Your service depends on a third party that has started failing 5% of requests. Design the response.",
        "How would you introduce a breaking API change across teams you do not control?",
    ],
}

HR_QUESTIONS: Final[dict[str, list[str]]] = {
    "beginner": [
        "Tell me about yourself and what drew you to people work.",
        "How would you handle an employee who is consistently ten minutes late?",
        "What does a good onboarding experience look like in the first week?",
        "Describe a time you had to deliver news someone did not want to hear.",
        "Two team members disagree publicly in a meeting. What do you do next?",
        "How do you keep a candidate engaged during a slow hiring process?",
        "What would you do if a manager asked you to skip a step in the hiring process?",
        "Tell me about a time you improved something small that made a real difference.",
    ],
    "intermediate": [
        "An employee reports that their manager plays favourites. Walk me through your first 48 hours.",
        "How do you measure whether a culture initiative actually worked?",
        "Tell me about a time you had to balance an employee's request against company policy.",
        "A high performer is threatening to leave over pay. How do you handle it?",
        "How would you redesign a performance review process that everyone dislikes?",
        "Describe a situation where you had to influence a leader without formal authority.",
        "What signals in an exit interview would make you escalate immediately?",
        "How do you keep hiring bars consistent across interviewers who disagree?",
    ],
    "advanced": [
        "You uncover a pay equity gap across a whole function. Walk me through what you do, and in what order.",
        "Design a layoff process that is both legally sound and humane. Where do the tensions sit?",
        "Tell me about a time you had to investigate a senior leader. How did you protect the process?",
        "How would you rebuild trust in HR after a badly handled restructure?",
        "Leadership wants to mandate office attendance; the data says it will cost you senior engineers. What do you do?",
        "How do you decide when a performance problem becomes a termination?",
        "Design the people strategy for a team that must double in twelve months without diluting quality.",
        "Describe a time your judgement about a person turned out to be wrong. What changed in how you work?",
    ],
}

AI_ENGINEER_QUESTIONS: Final[dict[str, list[str]]] = {
    "beginner": [
        "Explain overfitting to someone who has never trained a model, then tell me how you detect it.",
        "What is the difference between training, validation and test sets, and why does the split matter?",
        "Walk me through how you would build a simple text classifier from a labelled dataset.",
        "What does an embedding actually represent?",
        "Tell me about a model you built that did not work. What did you learn?",
        "When would you choose a simpler model over a more accurate one?",
        "Explain what a transformer's attention mechanism is doing, in plain language.",
        "Your model gets 99% accuracy on an imbalanced dataset. Why might that be bad news?",
    ],
    "intermediate": [
        "Design a RAG system for internal company documents. Where does it usually go wrong?",
        "How do you evaluate an LLM feature where there is no single correct answer?",
        "Explain the trade-offs between fine-tuning, prompting and retrieval for a domain-specific task.",
        "Your model performs well offline but poorly in production. Walk me through the investigation.",
        "Tell me about a time you had to explain a model's limitation to a non-technical stakeholder.",
        "How would you detect and handle data drift in a deployed model?",
        "What is your approach to chunking and indexing documents for retrieval, and why?",
        "How do you decide a model is good enough to ship?",
    ],
    "advanced": [
        "Design an evaluation harness for an LLM agent that takes multi-step actions. What do you measure?",
        "How would you cut inference cost by 70% without a material quality drop? Talk me through the options.",
        "Walk me through diagnosing a fine-tune that made the model worse on tasks it used to handle.",
        "Design a guardrail system for a customer-facing LLM. What fails first, and how do you know?",
        "Tell me about a time you disagreed with the team on a modelling approach. How did it resolve?",
        "How do you build a training pipeline that stays reproducible across a year of changes?",
        "Your RAG system returns confident, well-written, wrong answers. Diagnose it.",
        "How would you decide between serving one large model and several specialised smaller ones?",
    ],
}

QUESTION_BANK: Final[dict[str, dict[str, list[str]]]] = {
    "data_analyst": DATA_ANALYST_QUESTIONS,
    "software_engineer": SOFTWARE_ENGINEER_QUESTIONS,
    "hr": HR_QUESTIONS,
    "ai_engineer": AI_ENGINEER_QUESTIONS,
}

# How many questions each difficulty serves. Capped by the pool size at call
# time, so these can be raised without touching the bank.
QUESTION_COUNTS: Final[dict[str, int]] = {
    "beginner": 5,
    "intermediate": 7,
    "advanced": 10,
}



# --------------------------------------------------------------------------- #
# Question tags
# --------------------------------------------------------------------------- #
# One tag per question, aligned by index with the pools above. Kept parallel
# rather than folded into the question strings so the bank stays readable and
# a tag can be corrected without touching the wording.
BEHAVIORAL: Final[str] = "Behavioral"
TECHNICAL: Final[str] = "Technical"
SITUATIONAL: Final[str] = "Situational"
CULTURE_FIT: Final[str] = "Culture Fit"

QUESTION_TAGS: Final[dict[str, dict[str, list[str]]]] = {
    "data_analyst": {
        "beginner": [TECHNICAL, TECHNICAL, TECHNICAL, BEHAVIORAL, SITUATIONAL, TECHNICAL, TECHNICAL, BEHAVIORAL],
        "intermediate": [TECHNICAL, SITUATIONAL, TECHNICAL, BEHAVIORAL, TECHNICAL, SITUATIONAL, TECHNICAL, BEHAVIORAL],
        "advanced": [SITUATIONAL, TECHNICAL, SITUATIONAL, BEHAVIORAL, TECHNICAL, TECHNICAL, SITUATIONAL, TECHNICAL],
    },
    "software_engineer": {
        "beginner": [TECHNICAL, TECHNICAL, TECHNICAL, BEHAVIORAL, CULTURE_FIT, TECHNICAL, SITUATIONAL, BEHAVIORAL],
        "intermediate": [TECHNICAL, TECHNICAL, BEHAVIORAL, TECHNICAL, TECHNICAL, TECHNICAL, SITUATIONAL, TECHNICAL],
        "advanced": [TECHNICAL, TECHNICAL, TECHNICAL, BEHAVIORAL, TECHNICAL, TECHNICAL, SITUATIONAL, SITUATIONAL],
    },
    "hr": {
        "beginner": [CULTURE_FIT, SITUATIONAL, TECHNICAL, BEHAVIORAL, SITUATIONAL, SITUATIONAL, SITUATIONAL, BEHAVIORAL],
        "intermediate": [SITUATIONAL, TECHNICAL, BEHAVIORAL, SITUATIONAL, TECHNICAL, BEHAVIORAL, SITUATIONAL, TECHNICAL],
        "advanced": [SITUATIONAL, TECHNICAL, BEHAVIORAL, SITUATIONAL, SITUATIONAL, TECHNICAL, TECHNICAL, BEHAVIORAL],
    },
    "ai_engineer": {
        "beginner": [TECHNICAL, TECHNICAL, TECHNICAL, TECHNICAL, BEHAVIORAL, SITUATIONAL, TECHNICAL, TECHNICAL],
        "intermediate": [TECHNICAL, TECHNICAL, TECHNICAL, SITUATIONAL, BEHAVIORAL, TECHNICAL, TECHNICAL, SITUATIONAL],
        "advanced": [TECHNICAL, TECHNICAL, SITUATIONAL, TECHNICAL, BEHAVIORAL, TECHNICAL, SITUATIONAL, SITUATIONAL],
    },
}

QUESTION_TAG_VALUES: Final[tuple[str, ...]] = (BEHAVIORAL, TECHNICAL, SITUATIONAL, CULTURE_FIT)


def tag_for(job_role: str, difficulty: str, index: int) -> str:
    """Tag for one question, defaulting to Technical if the pools drift apart."""
    tags = (QUESTION_TAGS.get(job_role) or {}).get(difficulty) or []
    return tags[index] if 0 <= index < len(tags) else TECHNICAL


def get_question_pool(job_role: str, difficulty: str) -> list[str]:
    """The full pool for a role/difficulty, falling back to intermediate."""
    role_bank = QUESTION_BANK.get(job_role) or DATA_ANALYST_QUESTIONS
    return role_bank.get(difficulty) or role_bank["intermediate"]


def get_questions(job_role: str, difficulty: str) -> list[dict[str, str]]:
    """The questions this interview will ask, in order, each with its tag."""
    pool = get_question_pool(job_role, difficulty)
    wanted = QUESTION_COUNTS.get(difficulty, 7)
    if wanted > len(pool):
        # Not fatal, but the UI advertises a count - worth surfacing in logs.
        logger.warning(
            "Difficulty %r wants %d questions but the %r pool holds %d; serving %d.",
            difficulty,
            wanted,
            job_role,
            len(pool),
            len(pool),
        )
    return [
        {"text": text, "tag": tag_for(job_role, difficulty, i)}
        for i, text in enumerate(pool[:wanted])
    ]


# --------------------------------------------------------------------------- #
# Adaptive difficulty
# --------------------------------------------------------------------------- #
PERFORMANCE_STRUGGLING: Final[str] = "struggling"
PERFORMANCE_ON_TRACK: Final[str] = "on_track"
PERFORMANCE_EXCELLING: Final[str] = "excelling"

# Thresholds for the running average of answer scores.
EXCELLING_AT: Final[float] = 80.0
STRUGGLING_BELOW: Final[float] = 50.0

# An answer is vague when it scores poorly AND is short: a low score on a long
# answer is a wrong answer, which a follow-up will not rescue.
VAGUE_SCORE_BELOW: Final[float] = 55.0
VAGUE_WORDS_BELOW: Final[int] = 60

# Where to look when the interview needs a harder or easier question than the
# candidate's chosen difficulty.
_HARDER = {"beginner": "intermediate", "intermediate": "advanced", "advanced": "advanced"}
_EASIER = {"advanced": "intermediate", "intermediate": "beginner", "beginner": "beginner"}


def assess_performance_so_far(answers_so_far: list) -> str:
    """Classify how the candidate is doing from their scored answers.

    Weights the two most recent answers double: an interview that has turned a
    corner should be met where the candidate is now, not where they started.
    """
    scores = [
        float(a.answer_score)
        for a in (answers_so_far or [])
        if getattr(a, "answer_score", None) is not None
    ]
    if not scores:
        return PERFORMANCE_ON_TRACK

    recent = scores[-2:]
    weighted = scores + recent
    average = sum(weighted) / len(weighted)

    if average >= EXCELLING_AT:
        return PERFORMANCE_EXCELLING
    if average < STRUGGLING_BELOW:
        return PERFORMANCE_STRUGGLING
    return PERFORMANCE_ON_TRACK


def is_vague_answer(answer_score: float | None, transcript: str | None) -> bool:
    """True when an answer is thin enough that a follow-up is worth spending."""
    if answer_score is None:
        return False
    words = len((transcript or "").split())
    return answer_score < VAGUE_SCORE_BELOW and words < VAGUE_WORDS_BELOW


def get_adaptive_question(
    role: str,
    base_difficulty: str,
    performance_level: str,
    asked_questions: list[str],
) -> dict[str, str] | None:
    """Pick the next question, adjusted to how the candidate is doing.

    Excelling pulls from a harder pool, struggling from an easier one, and
    anything already asked is skipped - which is what keeps two interviews for
    the same role from being the same interview. Returns None once every pool
    is exhausted.
    """
    asked = {q.strip().lower() for q in (asked_questions or []) if q}

    if performance_level == PERFORMANCE_EXCELLING:
        order = [_HARDER.get(base_difficulty, base_difficulty), base_difficulty]
    elif performance_level == PERFORMANCE_STRUGGLING:
        order = [_EASIER.get(base_difficulty, base_difficulty), base_difficulty]
    else:
        order = [base_difficulty]

    # Fall back through every remaining pool rather than repeating a question.
    for difficulty in [*order, "intermediate", "beginner", "advanced"]:
        pool = get_question_pool(role, difficulty)
        for i, text in enumerate(pool):
            if text.strip().lower() not in asked:
                return {
                    "text": text,
                    "tag": tag_for(role, difficulty, i),
                    "difficulty": difficulty,
                    "adapted": difficulty != base_difficulty,
                }
    return None


FOLLOW_UP_INSTRUCTION: Final[str] = (
    "That answer was thin. Ask ONE short follow-up that names something specific "
    "the candidate did say and asks them to expand on the part they left out. "
    "Phrase it as a single question, no preamble, under 30 words. Do not move on "
    "to a new topic."
)


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #
def _clamp(value: Any, low: float = 0.0, high: float = 100.0, default: float = 0.0) -> float:
    """Coerce a model-supplied score into range. Never raises."""
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


class LLMService:
    """Wraps the Gemini client for interview feedback and scoring.

    When no usable API key is configured the service runs in *offline mode*:
    questions still come from the bank, and feedback/scores fall back to a
    transparent heuristic. That keeps the interview flow developable without a
    key. The fallback is always flagged (`source: "heuristic"`) so it can never
    be mistaken for a model judgement.
    """

    def __init__(self) -> None:
        self.model = settings.GEMINI_MODEL

    @property
    def is_configured(self) -> bool:
        """True when a real-looking API key is present."""
        return gemini.is_configured

    @property
    def client(self):
        """The shared Gemini wrapper. Kept so callers have one seam to mock."""
        return gemini

    # ---- Questions ------------------------------------------------------- #
    async def get_first_question(self, role: str, difficulty: str) -> str:
        """The opening question for this role and difficulty."""
        return get_questions(role, difficulty)[0]

    # ---- Streaming feedback ---------------------------------------------- #
    async def get_ai_response(
        self,
        conversation_history: list[dict[str, str]],
        transcript: str,
        filler_data: dict[str, Any] | None,
        wpm: float | None,
        role: str,
        difficulty: str = "intermediate",
        mode: str = MODE_COACH,
    ) -> AsyncGenerator[str, None]:
        """Stream the interviewer's reply to an answer, token by token.

        `conversation_history` is a list of {"role", "content"} turns excluding
        the system prompt, which is rebuilt here so a prompt change takes effect
        on the next turn rather than the next session.
        """
        filler_data = filler_data or {}
        metrics = self._format_metrics(filler_data, wpm)
        user_turn = (
            f"The candidate answered:\n\"\"\"\n{transcript.strip() or '(silence)'}\n\"\"\"\n\n"
            f"Speech metrics for this answer: {metrics}\n\n"
            "Respond as the interviewer. Reference something specific they said."
        )

        if not self.is_configured:
            for chunk in self._offline_feedback(transcript, filler_data, wpm):
                yield chunk
            return

        try:
            async for token in gemini.stream_text(
                system=build_system_prompt(role, difficulty, mode),
                prompt=user_turn,
                history=conversation_history,
                temperature=0.7,
                max_tokens=300,
                model=self.model,
            ):
                yield token
        except GeminiError as exc:
            raise LLMUnavailableError(str(exc)) from exc

    async def generate_follow_up(
        self,
        question: str,
        transcript: str,
        role: str,
        difficulty: str = "intermediate",
        mode: str = MODE_COACH,
    ) -> str:
        """One targeted follow-up for a vague answer.

        Falls back to a deterministic prompt when the model is unavailable, so
        the interview never stalls waiting for a question that cannot arrive.
        """
        if not self.is_configured:
            return (
                "You touched on this only briefly - can you walk me through a "
                "specific example, including what you actually did and what it changed?"
            )
        try:
            chunks = [
                token
                async for token in gemini.stream_text(
                    system=build_system_prompt(role, difficulty, mode),
                    prompt=(
                        f"Question asked:\n{question}\n\n"
                        f'Candidate\'s answer:\n"""\n{transcript.strip() or "(silence)"}\n"""\n\n'
                        f"{FOLLOW_UP_INSTRUCTION}"
                    ),
                    temperature=0.5,
                    max_tokens=90,
                    model=self.model,
                )
            ]
            text = "".join(chunks).strip()
            return text or "Can you expand on that with a specific example?"
        except GeminiError:
            logger.exception("Follow-up generation failed; using the generic prompt")
            return "Can you expand on that with a specific example and the outcome?"

    # ---- Scoring ---------------------------------------------------------- #
    async def evaluate_answer(
        self,
        question: str,
        transcript: str,
        role: str,
        difficulty: str = "intermediate",
        filler_data: dict[str, Any] | None = None,
        wpm: float | None = None,
        mode: str = MODE_COACH,
    ) -> dict[str, Any]:
        """Score one answer.

        Returns answer_score, communication_score, feedback_text, strengths and
        improvements. Always returns a usable dict - a model failure degrades to
        the heuristic rather than breaking the interview mid-flow.
        """
        filler_data = filler_data or {}

        if not self.is_configured:
            return self._offline_evaluation(transcript, filler_data, wpm)

        rubric = (
            "Score the answer from 0 to 100 on two axes and return JSON with exactly "
            "these keys: answer_score (number), communication_score (number), "
            "feedback_text (string, 2-3 sentences referencing what they said), "
            "strengths (array of at most 3 short strings), "
            "improvements (array of at most 3 short strings).\n"
            "answer_score covers relevance, depth and specificity. "
            "communication_score covers structure, clarity and concision. "
            "Be strict: an answer with no concrete example cannot exceed 60."
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": build_system_prompt(role, difficulty, mode)},
                    {
                        "role": "user",
                        "content": (
                            f"Question asked:\n{question}\n\n"
                            f"Candidate's answer:\n\"\"\"\n{transcript.strip() or '(silence)'}\n\"\"\"\n\n"
                            f"Speech metrics: {self._format_metrics(filler_data, wpm)}\n\n{rubric}"
                        ),
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=400,
            )
            raw = response.choices[0].message.content or "{}"
            data = json.loads(raw)
        except (AuthenticationError, RateLimitError, APIConnectionError, APIError):
            logger.exception("Scoring call failed; falling back to the heuristic")
            return self._offline_evaluation(transcript, filler_data, wpm)
        except (json.JSONDecodeError, IndexError, AttributeError):
            logger.exception("Could not parse the scoring response; using the heuristic")
            return self._offline_evaluation(transcript, filler_data, wpm)

        # Never trust model output shape: clamp numbers, bound the lists.
        return {
            "answer_score": _clamp(data.get("answer_score")),
            "communication_score": _clamp(data.get("communication_score")),
            "feedback_text": str(data.get("feedback_text") or "").strip(),
            "strengths": [str(s) for s in (data.get("strengths") or [])][:3],
            "improvements": [str(s) for s in (data.get("improvements") or [])][:3],
            "source": "model",
        }

    # ---- Helpers ---------------------------------------------------------- #
    @staticmethod
    def _format_metrics(filler_data: dict[str, Any], wpm: float | None) -> str:
        count = filler_data.get("count", 0)
        words = filler_data.get("words") or []
        parts = [f"{count} filler words"]
        if words:
            parts.append(f"({', '.join(str(w) for w in words[:5])})")
        parts.append(f"{round(wpm)} words per minute" if wpm else "pace unknown")
        return ", ".join(parts)

    @staticmethod
    def _offline_feedback(
        transcript: str, filler_data: dict[str, Any], wpm: float | None
    ) -> list[str]:
        """Deterministic stand-in feedback, chunked so it still streams."""
        words = len(transcript.split())
        fillers = int(filler_data.get("count", 0) or 0)
        bits = [
            "[Offline mode - no model configured] ",
            f"You spoke {words} words",
            f" at about {round(wpm)} wpm" if wpm else "",
            f", with {fillers} filler word{'s' if fillers != 1 else ''}. ",
            "Add a concrete example with a number or outcome to make this land, "
            "then say what you would do differently next time.",
        ]
        return [b for b in bits if b]

    @staticmethod
    def _offline_evaluation(
        transcript: str, filler_data: dict[str, Any], wpm: float | None
    ) -> dict[str, Any]:
        """Transparent heuristic used when the model is unavailable.

        Length, filler density and pace only - it cannot judge correctness, so
        it is deliberately capped below a strong score and flagged as heuristic.
        """
        words = len(transcript.split())
        fillers = int(filler_data.get("count", 0) or 0)

        # Substance proxy: answers under ~40 words are rarely complete.
        length_score = min(75.0, (words / 120) * 75) if words else 0.0
        filler_ratio = (fillers / words) if words else 1.0
        filler_penalty = min(25.0, filler_ratio * 250)
        pace_penalty = 0.0
        if wpm:
            # 130-150 wpm is the target band; drift either way costs a little.
            pace_penalty = min(15.0, abs(float(wpm) - 140) / 6)

        answer_score = _clamp(length_score)
        communication_score = _clamp(max(0.0, 80.0 - filler_penalty - pace_penalty))

        improvements = []
        if words < 60:
            improvements.append("Give a fuller answer with a concrete example")
        if filler_ratio > 0.04:
            improvements.append("Cut filler words - pause instead")
        if wpm and (float(wpm) < 110 or float(wpm) > 170):
            improvements.append("Aim for roughly 130-150 words per minute")

        return {
            "answer_score": round(answer_score, 1),
            "communication_score": round(communication_score, 1),
            "feedback_text": (
                "Scored offline without the language model, so this reflects only "
                "length, pace and filler words - not whether the answer was correct."
            ),
            "strengths": ["Answered without long silences"] if words > 30 else [],
            "improvements": improvements or ["Keep answers specific and structured"],
            "source": "heuristic",
        }


llm_service = LLMService()

__all__ = [
    "LLMService",
    "LLMUnavailableError",
    "QUESTION_BANK",
    "QUESTION_COUNTS",
    "build_system_prompt",
    "get_questions",
    "assess_performance_so_far",
    "get_adaptive_question",
    "is_vague_answer",
    "default_mode_for",
    "tag_for",
    "QUESTION_TAGS",
    "QUESTION_TAG_VALUES",
    "MODE_COACH",
    "MODE_INTERVIEWER",
    "get_question_pool",
    "llm_service",
    "DATA_ANALYST_QUESTIONS",
    "SOFTWARE_ENGINEER_QUESTIONS",
    "HR_QUESTIONS",
    "AI_ENGINEER_QUESTIONS",
]
