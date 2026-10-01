"""Scoring: per-answer judgement, text analysis, and session aggregation.

This module owns the score weights. The interview WebSocket delegates its
end-of-session arithmetic here so that a session finalised over the socket and
one finalised through POST /sessions/{id}/complete can never disagree.
"""

from __future__ import annotations

import json
import logging
import re
import statistics
from typing import Any, Final


from app.services.llm_service import PROVIDER_ERRORS, LLMService, build_system_prompt

logger = logging.getLogger(__name__)

# Overall score weighting. Answer quality dominates; delivery adjusts it.
SCORE_WEIGHTS: Final[dict[str, float]] = {
    "answer": 0.40,
    "confidence": 0.25,
    "communication": 0.20,
    "filler": 0.15,
}

# AI Meet phases are scored on what each one actually tests. The warm-up is a
# delivery check; the technical phase is a content check. Each row sums to 1.0.
PHASE_WEIGHTS: Final[dict[str, dict[str, float]]] = {
    "warmup": {"communication": 0.70, "confidence": 0.30},
    "background": {"answer": 0.60, "communication": 0.40},
    "technical": {"answer": 0.80, "communication": 0.20},
    "behavioral": {"answer": 0.50, "communication": 0.30, "confidence": 0.20},
    # Wrap-up is a courtesy exchange, not an assessment; it is scored like the
    # warm-up so an awkward closing cannot distort the overall result.
    "wrap_up": {"communication": 0.70, "confidence": 0.30},
}

PHASE_LABELS: Final[dict[str, str]] = {
    "warmup": "Warm-up",
    "background": "Background",
    "technical": "Technical",
    "behavioral": "Behavioral",
    "wrap_up": "Wrap-up",
}

PHASE_FOCUS: Final[dict[str, str]] = {
    "warmup": "your delivery and composure",
    "background": "the detail behind your experience",
    "technical": "your technical depth",
    "behavioral": "your STAR structure and specifics",
    "wrap_up": "your closing",
}

# --- Communication sub-score budgets (sum to 100) --------------------------- #
VOCABULARY_POINTS: Final[float] = 30.0
VARIETY_POINTS: Final[float] = 30.0
CLARITY_POINTS: Final[float] = 40.0

# A type-token ratio below this reads as repetitive, above it as varied. Spoken
# answers of 50-150 words typically land between the two.
TTR_FLOOR: Final[float] = 0.25
TTR_CEILING: Final[float] = 0.65
# TTR is inflated on short texts (10 unique words out of 10 is a perfect ratio
# and means nothing), so the sub-score is damped until there is enough text.
TTR_RELIABLE_WORDS: Final[int] = 40

# Sentence-length spread that reads as deliberate variety rather than monotony
# or rambling.
VARIETY_SWEET_SPOT: Final[tuple[float, float]] = (3.0, 10.0)
RUN_ON_WORDS: Final[int] = 45

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[a-z0-9']+")


def _words(text: str) -> list[str]:
    return _WORD.findall((text or "").lower())


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split((text or "").strip()) if s.strip()]


def _clamp(value: Any, low: float = 0.0, high: float = 100.0, default: float = 0.0) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


class ScoreService:
    """Turns transcripts and answers into scores."""

    # ------------------------------------------------------------------ #
    # 1. Answer quality (LLM)
    # ------------------------------------------------------------------ #
    RUBRIC: Final[str] = (
        "Score this answer on four axes, 0-25 points each, and return JSON with "
        "exactly these keys: relevance, technical_accuracy, structure, "
        "specificity (all numbers), and reasoning (one short string).\n"
        "- relevance: did they answer the question that was actually asked?\n"
        "- technical_accuracy: is what they said correct for this role? For a "
        "behavioural question, judge the soundness of their judgement instead.\n"
        "- structure: STAR for behavioural answers, clear logical progression "
        "for technical ones.\n"
        "- specificity: concrete examples, numbers and outcomes. An answer with "
        "no specifics cannot score above 10 here.\n"
        "Be strict. Most real answers land between 10 and 18 per axis."
    )

    async def calculate_answer_score_detailed(
        self,
        question: str,
        transcript: str,
        role: str,
        llm_service: LLMService,
        difficulty: str = "intermediate",
    ) -> dict[str, Any]:
        """Score one answer and return the per-axis breakdown.

        Falls back to a length-based heuristic when the model is unavailable,
        flagged `source: "heuristic"` so a degraded score is never mistaken for
        a judged one.
        """
        text = (transcript or "").strip()
        if not text:
            return {
                "relevance": 0.0,
                "technical_accuracy": 0.0,
                "structure": 0.0,
                "specificity": 0.0,
                "total": 0.0,
                "reasoning": "No answer was given.",
                "source": "empty",
            }

        if not llm_service.is_configured:
            return self._heuristic_answer_score(text)

        try:
            response = await llm_service.client.chat.completions.create(
                model=llm_service.model,
                messages=[
                    {"role": "system", "content": build_system_prompt(role, difficulty)},
                    {
                        "role": "user",
                        "content": (
                            f"Question asked:\n{question}\n\n"
                            f'Candidate\'s answer:\n"""\n{text}\n"""\n\n{self.RUBRIC}'
                        ),
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=400,
            )
            data = json.loads(response.choices[0].message.content or "{}")
        except PROVIDER_ERRORS:
            logger.exception("Answer scoring failed; falling back to the heuristic")
            return self._heuristic_answer_score(text)
        except (json.JSONDecodeError, IndexError, AttributeError):
            logger.exception("Could not parse the answer score; using the heuristic")
            return self._heuristic_answer_score(text)

        axes = {
            "relevance": _clamp(data.get("relevance"), 0, 25),
            "technical_accuracy": _clamp(data.get("technical_accuracy"), 0, 25),
            "structure": _clamp(data.get("structure"), 0, 25),
            "specificity": _clamp(data.get("specificity"), 0, 25),
        }
        return {
            **axes,
            "total": round(sum(axes.values()), 1),
            "reasoning": str(data.get("reasoning") or "").strip(),
            "source": "model",
        }

    async def calculate_answer_score(
        self,
        question: str,
        transcript: str,
        role: str,
        llm_service: LLMService,
        difficulty: str = "intermediate",
    ) -> float:
        """Answer quality from 0 to 100."""
        detail = await self.calculate_answer_score_detailed(
            question, transcript, role, llm_service, difficulty
        )
        return float(detail["total"])

    @staticmethod
    def _heuristic_answer_score(text: str) -> dict[str, Any]:
        """Length-and-specificity proxy used when the model is unavailable.

        Capped well below full marks: nothing here can tell whether the answer
        was correct, only whether it was substantial and contained specifics.
        """
        words = _words(text)
        has_numbers = bool(re.search(r"\b\d", text))
        # "for example", "we", "I built" - weak signals of a concrete story.
        has_example = bool(
            re.search(r"\b(for example|for instance|we |i built|i led|i shipped)\b", text, re.I)
        )

        substance = min(15.0, len(words) / 120 * 15)
        specificity = (8.0 if has_numbers else 0.0) + (6.0 if has_example else 0.0)
        return {
            "relevance": round(substance, 1),
            "technical_accuracy": 0.0,
            "structure": round(substance * 0.6, 1),
            "specificity": round(min(14.0, specificity), 1),
            "total": round(substance + substance * 0.6 + min(14.0, specificity), 1),
            "reasoning": (
                "Scored without the language model: reflects length and the "
                "presence of specifics, not correctness."
            ),
            "source": "heuristic",
        }

    # ------------------------------------------------------------------ #
    # 2. Communication (pure text analysis)
    # ------------------------------------------------------------------ #
    def calculate_communication_score(self, transcript: str) -> float:
        """Communication quality from 0 to 100, from the text alone."""
        return round(self.communication_breakdown(transcript)["total"], 1)

    def communication_breakdown(self, transcript: str) -> dict[str, float]:
        """The three sub-scores behind the communication figure."""
        text = (transcript or "").strip()
        words = _words(text)
        sentences = _sentences(text)

        if not words:
            return {"vocabulary": 0.0, "variety": 0.0, "clarity": 0.0, "total": 0.0}

        vocabulary = self._vocabulary_score(words)
        variety = self._variety_score(sentences)
        clarity = self._clarity_score(text, sentences, words)

        return {
            "vocabulary": round(vocabulary, 1),
            "variety": round(variety, 1),
            "clarity": round(clarity, 1),
            "total": round(vocabulary + variety + clarity, 1),
        }

    @staticmethod
    def _vocabulary_score(words: list[str]) -> float:
        """Type-token ratio, damped on short answers where TTR is meaningless."""
        ttr = len(set(words)) / len(words)
        normalised = (min(max(ttr, TTR_FLOOR), TTR_CEILING) - TTR_FLOOR) / (
            TTR_CEILING - TTR_FLOOR
        )
        reliability = min(1.0, len(words) / TTR_RELIABLE_WORDS)
        return VOCABULARY_POINTS * normalised * reliability

    @staticmethod
    def _variety_score(sentences: list[str]) -> float:
        """Spread of sentence lengths.

        One sentence has no variety to measure, so it earns partial credit
        rather than zero - a single well-formed sentence is not a failure.
        """
        if not sentences:
            return 0.0
        if len(sentences) == 1:
            return VARIETY_POINTS * 0.4

        lengths = [len(s.split()) for s in sentences]
        spread = statistics.pstdev(lengths)
        low, high = VARIETY_SWEET_SPOT

        if low <= spread <= high:
            return VARIETY_POINTS
        if spread < low:
            # Monotone: every sentence the same length.
            return VARIETY_POINTS * (0.35 + 0.65 * (spread / low))
        # Very high spread means one runaway sentence among short ones.
        return VARIETY_POINTS * max(0.4, 1 - (spread - high) / 25)

    @staticmethod
    def _clarity_score(text: str, sentences: list[str], words: list[str]) -> float:
        """Complete sentences, no run-ons, and no going in circles."""
        if not sentences:
            return 0.0

        score = CLARITY_POINTS

        # Complete sentences: terminal punctuation and enough words to be one.
        complete = sum(
            1 for s in sentences if s.rstrip()[-1:] in ".!?" and len(s.split()) >= 3
        )
        completeness = complete / len(sentences)
        score -= (1 - completeness) * 15

        # Run-ons.
        run_ons = sum(1 for s in sentences if len(s.split()) > RUN_ON_WORDS)
        score -= min(10.0, run_ons * 5.0)

        # Circular logic proxy: repeated 4-word sequences. Saying the same thing
        # twice in different places is the textual signature of going in circles.
        if len(words) >= 8:
            grams = [tuple(words[i : i + 4]) for i in range(len(words) - 3)]
            repeats = len(grams) - len(set(grams))
            score -= min(15.0, (repeats / max(1, len(grams))) * 60)

        return max(0.0, score)

    # ------------------------------------------------------------------ #
    # 3. Session aggregation
    # ------------------------------------------------------------------ #
    def calculate_session_scores(self, answers: list) -> dict[str, Any]:
        """Aggregate every answer into the session's five scores plus overall.

        Only answers that carry a score contribute to the averages, so an
        unanswered or unscored question cannot drag an average to zero.
        """
        answers = list(answers or [])

        if not answers:
            return {
                "answer_score": None,
                "communication_score": None,
                "confidence_score": None,
                "filler_word_score": None,
                "overall_score": None,
                "total_filler_count": 0,
                "avg_wpm": None,
                "duration_minutes": None,
                "answers_scored": 0,
            }

        def mean(values: list[Any]) -> float | None:
            usable = [float(v) for v in values if v is not None]
            return round(sum(usable) / len(usable), 1) if usable else None

        total_fillers = sum(int(a.filler_count or 0) for a in answers)
        total_words = sum(len((a.transcript or "").split()) for a in answers)
        total_seconds = sum(float(a.duration_seconds or 0.0) for a in answers)

        answer_avg = mean([a.answer_score for a in answers])
        comm_avg = mean([a.communication_score for a in answers])
        conf_avg = mean([a.confidence_score for a in answers])
        filler = self.calculate_filler_score(total_fillers, total_words)

        overall = None
        if answer_avg is not None:
            overall = round(
                answer_avg * SCORE_WEIGHTS["answer"]
                + (conf_avg or 0.0) * SCORE_WEIGHTS["confidence"]
                + (comm_avg or 0.0) * SCORE_WEIGHTS["communication"]
                + filler * SCORE_WEIGHTS["filler"],
                1,
            )

        return {
            "answer_score": answer_avg,
            "communication_score": comm_avg,
            "confidence_score": conf_avg,
            "filler_word_score": filler,
            "overall_score": overall,
            "total_filler_count": total_fillers,
            "avg_wpm": mean([a.wpm for a in answers]),
            "duration_minutes": round(total_seconds / 60, 2) if total_seconds else None,
            "answers_scored": len(answers),
        }

    # ---- AI Meet: per-phase scoring ------------------------------------- #
    def score_phase(self, phase: str, answers: list) -> dict[str, Any]:
        """Score one AI Meet phase.

        Each phase is judged on what it actually tests: the warm-up is about
        delivery, not content; the technical phase is almost entirely content.
        Weights per phase sum to 1.0, so the result stays on the 0-100 scale.
        """
        weights = PHASE_WEIGHTS.get(phase, PHASE_WEIGHTS["background"])
        scored = [a for a in (answers or []) if getattr(a, "answer_score", None) is not None]

        if not scored:
            return {
                "score": None,
                "notes": "No answers were recorded in this phase.",
                "answers_scored": 0,
            }

        def mean(attr: str) -> float:
            values = [
                float(getattr(a, attr))
                for a in scored
                if getattr(a, attr, None) is not None
            ]
            return sum(values) / len(values) if values else 0.0

        score = _clamp(
            mean("answer_score") * weights.get("answer", 0.0)
            + mean("communication_score") * weights.get("communication", 0.0)
            + mean("confidence_score") * weights.get("confidence", 0.0)
        )
        return {
            "score": round(score, 1),
            "notes": self._phase_notes(phase, score, len(scored)),
            "answers_scored": len(scored),
        }

    @staticmethod
    def _phase_notes(phase: str, score: float, count: int) -> str:
        """One honest sentence about how the phase went."""
        label = PHASE_LABELS.get(phase, phase.replace("_", " "))
        focus = PHASE_FOCUS.get(phase, "your answers")
        if score >= 80:
            band = f"Strong {label.lower()} - {focus} held up well"
        elif score >= 65:
            band = f"Solid {label.lower()}, though {focus} could go deeper"
        elif score >= 50:
            band = f"Mixed {label.lower()} - {focus} needs more substance"
        else:
            band = f"Weak {label.lower()}; {focus} is the thing to rebuild first"
        return f"{band} (across {count} answer{'s' if count != 1 else ''})."

    @staticmethod
    def calculate_filler_score(filler_count: int, word_count: int) -> float:
        """100 for clean speech, falling as filler density rises."""
        if word_count <= 0:
            return 0.0
        ratio = filler_count / word_count
        return max(0.0, min(100.0, round(100.0 - (ratio * 1250), 1)))

    # ------------------------------------------------------------------ #
    # 4. Final feedback
    # ------------------------------------------------------------------ #
    async def generate_final_feedback(
        self, session: Any, answers: list, llm_service: LLMService
    ) -> dict[str, Any]:
        """Whole-session verdict: strengths, weaknesses, suggestions, resources."""
        answers = list(answers or [])
        scores = self.calculate_session_scores(answers)

        if not llm_service.is_configured or not answers:
            return self._offline_final_feedback(scores, answers)

        transcript_digest = "\n\n".join(
            f"Q{a.question_number}: {a.question_text}\n"
            f"Answer: {(a.transcript or '(no answer)')[:600]}\n"
            f"Scored {a.answer_score if a.answer_score is not None else '-'} / 100"
            for a in answers[:12]
        )

        instruction = (
            "Review this whole interview and return JSON with exactly these keys:\n"
            "strengths: array of exactly 3 strings, each quoting or naming something "
            "specific the candidate actually said.\n"
            "weaknesses: array of exactly 3 strings, each pointing at a specific "
            "answer and what was missing from it.\n"
            "top_suggestions: array of exactly 3 actionable things to do differently "
            "next time.\n"
            "overall_verdict: one paragraph, 3-5 sentences, honest about whether they "
            "would pass this interview.\n"
            "recommended_resources: array of 2-3 specific topics or practices to study.\n"
            "Never write generic advice like 'work on communication'. Every point must "
            "reference this interview."
        )

        try:
            response = await llm_service.client.chat.completions.create(
                model=llm_service.model,
                messages=[
                    {
                        "role": "system",
                        "content": build_system_prompt(session.job_role, session.difficulty),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Role: {session.job_role}. Difficulty: {session.difficulty}.\n"
                            f"Overall score: {scores['overall_score']}.\n\n"
                            f"{transcript_digest}\n\n{instruction}"
                        ),
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0.4,
                max_tokens=900,
            )
            data = json.loads(response.choices[0].message.content or "{}")
        except PROVIDER_ERRORS:
            logger.exception("Final feedback generation failed; using the offline summary")
            return self._offline_final_feedback(scores, answers)
        except (json.JSONDecodeError, IndexError, AttributeError):
            logger.exception("Could not parse the final feedback; using the offline summary")
            return self._offline_final_feedback(scores, answers)

        def string_list(key: str, limit: int) -> list[str]:
            raw = data.get(key) or []
            if isinstance(raw, str):
                raw = [raw]
            return [str(item).strip() for item in raw if str(item).strip()][:limit]

        return {
            "strengths": string_list("strengths", 3),
            "weaknesses": string_list("weaknesses", 3),
            "top_suggestions": string_list("top_suggestions", 3),
            "overall_verdict": str(data.get("overall_verdict") or "").strip(),
            "recommended_resources": string_list("recommended_resources", 3),
            "source": "model",
        }

    def _offline_final_feedback(
        self, scores: dict[str, Any], answers: list
    ) -> dict[str, Any]:
        """Summary built from the measured numbers when the model is unavailable."""
        strengths: list[str] = []
        weaknesses: list[str] = []
        suggestions: list[str] = []

        if not answers:
            return {
                "strengths": [],
                "weaknesses": [],
                "top_suggestions": ["Complete an interview to receive feedback."],
                "overall_verdict": "This session has no scored answers yet.",
                "recommended_resources": [],
                "source": "heuristic",
            }

        wpm = scores.get("avg_wpm")
        fillers = scores.get("total_filler_count") or 0
        filler_score = scores.get("filler_word_score") or 0

        if filler_score >= 80:
            strengths.append(f"Clean delivery - only {fillers} filler words across the session.")
        else:
            weaknesses.append(f"{fillers} filler words across the session broke up your delivery.")
            suggestions.append("Pause silently instead of filling the gap with 'um' or 'like'.")

        if wpm and 110 <= wpm <= 150:
            strengths.append(f"Your pace averaged {wpm} wpm, comfortably in the ideal band.")
        elif wpm:
            weaknesses.append(f"Your pace averaged {wpm} wpm, outside the 120-140 target.")
            suggestions.append("Practise reading aloud to a timer to settle your pace.")

        longest = max(answers, key=lambda a: len((a.transcript or "").split()))
        if len((longest.transcript or "").split()) >= 80:
            strengths.append(f"Question {longest.question_number} drew a properly developed answer.")

        shortest = min(answers, key=lambda a: len((a.transcript or "").split()))
        if len((shortest.transcript or "").split()) < 40:
            weaknesses.append(
                f"Question {shortest.question_number} was answered too briefly to show depth."
            )
        suggestions.append("Add one concrete number or outcome to every answer.")

        return {
            "strengths": strengths[:3],
            "weaknesses": weaknesses[:3],
            "top_suggestions": suggestions[:3],
            "overall_verdict": (
                f"Scored {scores.get('overall_score')} overall across "
                f"{scores.get('answers_scored')} answers. This summary was produced "
                "without the language model, so it reflects delivery metrics only - "
                "not whether your answers were correct."
            ),
            "recommended_resources": [
                "Rehearse three STAR stories you can adapt to most behavioural questions",
                "Record yourself answering one question a day and count your filler words",
            ],
            "source": "heuristic",
        }


score_service = ScoreService()

__all__ = ["ScoreService", "SCORE_WEIGHTS", "PHASE_WEIGHTS", "score_service"]
