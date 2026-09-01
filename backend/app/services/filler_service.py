"""Filler-word detection and speech-delivery metrics.

The word list is mirrored in frontend/src/utils/fillerDetector.js so the live
display and the stored score agree. Change one, change the other.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Final

logger = logging.getLogger(__name__)

FILLER_WORDS: Final[list[str]] = [
    "um",
    "uh",
    "like",
    "basically",
    "actually",
    "you know",
    "so",
    "right",
    "okay",
    "kind of",
    "sort of",
    "literally",
    "honestly",
    "totally",
    "essentially",
    "obviously",
]

# Longest first, so "kind of" is matched before "of" would be reached and
# "you know" is consumed as one hit rather than leaving "know" behind. The
# alternation is ordered, and Python's re returns the first alternative that
# matches at a position.
_ORDERED = sorted(FILLER_WORDS, key=lambda w: (-len(w.split()), -len(w)))
_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in _ORDERED) + r")\b",
    re.IGNORECASE,
)

# Words per minute considered comfortable for an interview answer.
TARGET_WPM: Final[float] = 140.0


class FillerService:
    """Counts filler words and derives delivery metrics from a transcript."""

    @staticmethod
    def detect_fillers(transcript: str, duration_seconds: float | None = None) -> dict[str, Any]:
        """Find filler words in a transcript.

        Returns count, the words in the order spoken, a per-minute rate and a
        per-word tally. Matching is case-insensitive and whole-word only, so
        "so" does not fire inside "sort" and "like" does not fire inside
        "likely".
        """
        text = transcript or ""
        matches = [m.group(0).lower() for m in _PATTERN.finditer(text)]

        flagged: dict[str, int] = {}
        for word in matches:
            flagged[word] = flagged.get(word, 0) + 1

        per_minute = 0.0
        if duration_seconds and duration_seconds > 0:
            per_minute = round(len(matches) / (duration_seconds / 60), 1)

        return {
            "count": len(matches),
            "words": matches,
            "per_minute": per_minute,
            "flagged_words": flagged,
        }

    @staticmethod
    def calculate_wpm(transcript: str, duration_seconds: float) -> float:
        """Words per minute. Returns 0.0 when the duration is unusable."""
        if not duration_seconds or duration_seconds <= 0:
            return 0.0
        words = len((transcript or "").split())
        if not words:
            return 0.0
        return round(words / (duration_seconds / 60), 1)

    @staticmethod
    def calculate_confidence_score(
        filler_count: int, wpm: float, answer_length: int
    ) -> float:
        """Delivery-confidence score from 0 to 100.

        `answer_length` is a word count. A pace of 0 is treated as unknown and
        takes a flat penalty rather than the full distance from the target,
        which would otherwise zero the score outright.

        The result is clamped to 100 as well as to 0: the length bonus can
        otherwise push a clean, well-paced, long answer to 110, and this value
        is stored and averaged as a percentage.
        """
        filler_penalty = min(filler_count * 4, 40)
        wpm_penalty = max(0.0, abs(wpm - TARGET_WPM) * 0.15) if wpm > 0 else 20.0
        length_bonus = min(10.0, max(0.0, (answer_length - 50) * 0.1))
        score = 100.0 - filler_penalty - wpm_penalty + length_bonus
        return round(min(100.0, max(0.0, score)), 1)

    @classmethod
    def analyse(cls, transcript: str, duration_seconds: float | None = None) -> dict[str, Any]:
        """Everything the interview needs about one answer's delivery."""
        fillers = cls.detect_fillers(transcript, duration_seconds)
        wpm = cls.calculate_wpm(transcript, duration_seconds or 0.0)
        word_count = len((transcript or "").split())
        return {
            **fillers,
            "wpm": wpm,
            "word_count": word_count,
            "confidence_score": cls.calculate_confidence_score(
                fillers["count"], wpm, word_count
            ),
        }


filler_service = FillerService()

__all__ = ["FILLER_WORDS", "FillerService", "filler_service", "TARGET_WPM"]
