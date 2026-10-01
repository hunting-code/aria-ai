"""Career intelligence built from a completed AI Meet.

The interview already knows how the candidate performed; this turns that into
the things they actually do next - what to learn, how to describe themselves,
where to apply, and whether a specific job is worth their time.

Everything here runs through the same provider-agnostic client as the rest of
the app, so it works on whichever provider LLM_PROVIDER selects.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.services.llm_service import PROVIDER_ERRORS, llm_service

logger = logging.getLogger(__name__)

MAX_JD_CHARS = 12_000

LEVELS = ("none", "beginner", "intermediate", "advanced", "expert")
PRIORITIES = ("critical", "high", "nice_to_have")

REPORT_PROMPT = """You are a senior career coach and hiring manager writing a
career intelligence report after a mock interview. Be specific and honest -
cite what the candidate actually said. Never invent employers or job postings.

Return JSON with exactly these keys:

{
  "readiness": {
    "score": 0-100,
    "level": "entry|mid|senior",
    "summary": "2-3 sentences on where they stand for this role, citing evidence"
  },
  "resume_reality": [
    {"claim": "a claim from their resume",
     "status": "confirmed|partial|gap",
     "severity": "low|medium|high",
     "evidence": "what their interview answers did or did not show"}
  ],
  "skill_gaps": [
    {"skill": "string",
     "priority": "critical|high|nice_to_have",
     "current_level": "none|beginner|intermediate|advanced|expert",
     "required_level": "none|beginner|intermediate|advanced|expert",
     "why": "one sentence on why this matters for the role",
     "resource": "a specific, well-known learning resource (book, course, docs)",
     "time_estimate": "e.g. '2 weeks' or '20 hours'"}
  ],
  "linkedin": {
    "headline": "an exact LinkedIn headline under 220 characters they can paste",
    "about": "a 3-4 sentence About section they can paste",
    "missing_keywords": ["8-12 industry keywords their profile likely lacks"],
    "experience_tips": ["3 specific tips for their experience bullets"]
  },
  "job_search": {
    "stretch": {"description": "type of company - never a real company name",
                "why": "why this is a stretch for them",
                "titles": ["2-4 job titles"]},
    "target":  {"description": "...", "why": "...", "titles": [...]},
    "starter": {"description": "...", "why": "...", "titles": [...]}
  },
  "action_plan": [
    {"week": 1, "focus": "short focus area",
     "actions": ["3 concrete actions for this week"]}
  ]
}

Rules:
- resume_reality: only include entries when resume data is supplied; [] otherwise.
- skill_gaps: 5 to 8 entries, spread across the priorities.
- action_plan: exactly 4 entries, weeks 1 to 4, 3 actions each.
- job_search: describe COMPANY TYPES (e.g. "early-stage AI startups"), never
  named employers."""

JD_PROMPT = """You are a hiring manager screening a candidate against a job
description. Be realistic - most candidates match 50-75%. Judge only on
evidence from their interview and resume.

Return JSON with exactly these keys:
{
  "match_percentage": 0-100,
  "verdict": "strong_match|worth_applying|stretch|not_yet",
  "recommendation": "2-3 sentences: should they apply, and how to frame it",
  "matching": [{"requirement": "from the JD", "evidence": "what shows they meet it"}],
  "missing": [{"requirement": "from the JD", "gap": "what is missing", "severity": "low|medium|high"}],
  "role_title": "the job title from the JD, or null",
  "tailoring_tips": ["3 specific ways to tailor their application"]
}"""


def _coerce(value: Any, allowed: tuple[str, ...], default: str) -> str:
    text = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    return text if text in allowed else default


class CareerService:
    @staticmethod
    async def _json_call(system: str, user: str, max_tokens: int = 4000) -> dict[str, Any]:
        response = await llm_service.client.chat.completions.create(
            model=llm_service.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=max_tokens,
            **llm_service._reasoning_kwargs(),
        )
        return json.loads(response.choices[0].message.content or "{}")

    async def build_report(
        self,
        session_data: dict,
        answers: list[dict],
        resume_data: dict | None = None,
    ) -> dict[str, Any]:
        """The full seven-section career intelligence report."""
        user = (
            f"Role interviewed for: {session_data.get('job_role')}\n"
            f"Overall interview score: {session_data.get('overall_score')}\n"
            f"Per-phase scores: {json.dumps(session_data.get('phase_scores') or {})}\n"
            + (
                f"\nResume: {json.dumps(resume_data, ensure_ascii=False)[:6000]}\n"
                if resume_data
                else "\nNo resume was provided - return [] for resume_reality.\n"
            )
            + f"\nInterview answers:\n{json.dumps(answers, ensure_ascii=False)[:11000]}"
        )
        data = await self._json_call(REPORT_PROMPT, user)
        return self._normalise(data, bool(resume_data))

    @staticmethod
    def _normalise(data: dict, had_resume: bool) -> dict[str, Any]:
        """Never trust model output shape - the page renders whatever is here."""
        readiness = data.get("readiness") or {}
        try:
            score = max(0.0, min(100.0, float(readiness.get("score", 0))))
        except (TypeError, ValueError):
            score = 0.0

        gaps = []
        for row in data.get("skill_gaps") or []:
            if not isinstance(row, dict) or not row.get("skill"):
                continue
            gaps.append(
                {
                    "skill": str(row["skill"])[:80],
                    "priority": _coerce(row.get("priority"), PRIORITIES, "high"),
                    "current_level": _coerce(row.get("current_level"), LEVELS, "beginner"),
                    "required_level": _coerce(row.get("required_level"), LEVELS, "advanced"),
                    "why": str(row.get("why") or ""),
                    "resource": str(row.get("resource") or ""),
                    "time_estimate": str(row.get("time_estimate") or ""),
                }
            )

        reality = []
        if had_resume:
            for row in data.get("resume_reality") or []:
                if not isinstance(row, dict) or not row.get("claim"):
                    continue
                reality.append(
                    {
                        "claim": str(row["claim"]),
                        "status": _coerce(
                            row.get("status"), ("confirmed", "partial", "gap"), "partial"
                        ),
                        "severity": _coerce(
                            row.get("severity"), ("low", "medium", "high"), "medium"
                        ),
                        "evidence": str(row.get("evidence") or ""),
                    }
                )

        linkedin = data.get("linkedin") or {}
        job_search = data.get("job_search") or {}

        def tier(name: str) -> dict:
            row = job_search.get(name) or {}
            return {
                "description": str(row.get("description") or ""),
                "why": str(row.get("why") or ""),
                "titles": [str(t) for t in (row.get("titles") or [])][:4],
            }

        plan = []
        for i, row in enumerate(data.get("action_plan") or [], start=1):
            if not isinstance(row, dict):
                continue
            plan.append(
                {
                    "week": int(row.get("week") or i),
                    "focus": str(row.get("focus") or ""),
                    "actions": [str(a) for a in (row.get("actions") or [])][:3],
                }
            )

        return {
            "readiness": {
                "score": round(score, 1),
                "level": _coerce(readiness.get("level"), ("entry", "mid", "senior"), "entry"),
                "summary": str(readiness.get("summary") or ""),
            },
            "resume_reality": reality[:8],
            "skill_gaps": gaps[:10],
            "linkedin": {
                "headline": str(linkedin.get("headline") or "")[:220],
                "about": str(linkedin.get("about") or ""),
                "missing_keywords": [
                    str(k) for k in (linkedin.get("missing_keywords") or [])
                ][:14],
                "experience_tips": [
                    str(t) for t in (linkedin.get("experience_tips") or [])
                ][:4],
            },
            "job_search": {
                "stretch": tier("stretch"),
                "target": tier("target"),
                "starter": tier("starter"),
            },
            "action_plan": plan[:4],
        }

    async def match_job_description(
        self,
        job_description: str,
        session_data: dict | None = None,
        answers: list[dict] | None = None,
        resume_data: dict | None = None,
    ) -> dict[str, Any]:
        """Score one pasted job description against this candidate."""
        user = (
            f"Job description:\n\"\"\"\n{job_description[:MAX_JD_CHARS]}\n\"\"\"\n\n"
            f"Candidate's interview role: {(session_data or {}).get('job_role')}\n"
            f"Interview score: {(session_data or {}).get('overall_score')}\n"
            + (
                f"Resume: {json.dumps(resume_data, ensure_ascii=False)[:5000]}\n"
                if resume_data
                else ""
            )
            + (
                f"\nInterview answers:\n{json.dumps(answers, ensure_ascii=False)[:8000]}"
                if answers
                else ""
            )
        )
        data = await self._json_call(JD_PROMPT, user, max_tokens=3000)

        try:
            pct = max(0.0, min(100.0, float(data.get("match_percentage", 0))))
        except (TypeError, ValueError):
            pct = 0.0

        def rows(key: str, fields: tuple[str, ...]) -> list[dict]:
            out = []
            for row in data.get(key) or []:
                if isinstance(row, dict) and row.get(fields[0]):
                    item = {f: str(row.get(f) or "") for f in fields}
                    if "severity" in row:
                        item["severity"] = _coerce(
                            row.get("severity"), ("low", "medium", "high"), "medium"
                        )
                    out.append(item)
            return out[:12]

        return {
            "match_percentage": round(pct, 1),
            "verdict": _coerce(
                data.get("verdict"),
                ("strong_match", "worth_applying", "stretch", "not_yet"),
                "stretch",
            ),
            "recommendation": str(data.get("recommendation") or ""),
            "matching": rows("matching", ("requirement", "evidence")),
            "missing": rows("missing", ("requirement", "gap")),
            "role_title": (str(data["role_title"]) if data.get("role_title") else None),
            "tailoring_tips": [str(t) for t in (data.get("tailoring_tips") or [])][:4],
        }


career_service = CareerService()
CAREER_PROVIDER_ERRORS = PROVIDER_ERRORS
