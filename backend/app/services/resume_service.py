"""Resume extraction, parsing, scoring and question generation.

Text extraction is local (PyMuPDF / python-docx). Everything intelligent runs
through the same provider-agnostic chat client as the interview engine, so it
works on whichever provider LLM_PROVIDER selects - Groq by default here, since
that is the funded key. Only extracted text ever leaves the machine; the
original file is never stored.
"""

from __future__ import annotations

import io
import json
import logging
from typing import Any

import fitz  # PyMuPDF
from docx import Document

from app.services.llm_service import PROVIDER_ERRORS, llm_service

logger = logging.getLogger(__name__)

# Analyses cap: a resume should be pages, not a novel. Beyond this the text is
# truncated before prompting so one upload cannot burn the whole token budget.
MAX_PROMPT_CHARS = 24_000

PARSE_SCHEMA_HINT = """{
  "name": "string or null", "email": "string or null", "phone": "string or null",
  "linkedin": "string or null", "github": "string or null", "summary": "string or null",
  "education": [{"degree": "string", "institution": "string", "year": "string", "gpa": "string or null"}],
  "experience": [{"title": "string", "company": "string", "duration": "string", "description": "string", "technologies": ["list"]}],
  "projects": [{"name": "string", "description": "string", "technologies": ["list"], "link": "string or null"}],
  "skills": {"technical": ["list"], "tools": ["list"], "soft": ["list"]},
  "certifications": ["list of strings"], "achievements": ["list of strings"]
}"""

SCORE_PROMPT = """You are a senior hiring manager and career coach. Score this resume
on a scale of 0-100 and provide specific, actionable feedback.

Score these dimensions:
- impact (0-25): Are achievements quantified? Do they show results?
- clarity (0-20): Is it easy to read and well-structured?
- relevance (0-20): Are skills and experience market-relevant?
- completeness (0-20): Are all key sections present and filled?
- keywords (0-15): Does it contain industry-standard terminology?

overall_score must equal the sum of the five dimension scores.

Return JSON with exactly these keys:
{
  "overall_score": float,
  "breakdown": {"impact": float, "clarity": float, "relevance": float, "completeness": float, "keywords": float},
  "strengths": ["list of 3 specific strengths with examples from the resume"],
  "critical_issues": ["list of the top 3 problems that must be fixed"],
  "improvement_suggestions": [
    {"category": "Impact|Clarity|Relevance|Completeness|Keywords",
     "issue": "specific problem found",
     "fix": "exact action to take",
     "example": "example of how it should look"}
  ],
  "missing_sections": ["list of important sections not found"],
  "ats_warnings": ["things that might fail Applicant Tracking Systems"]
}"""

ROLES_PROMPT = """You are a career advisor. Based on the candidate's skills, experience
and education, identify which of these four interview tracks fit them:
data_analyst, software_engineer, hr, ai_engineer.

Return JSON with exactly these keys:
{
  "primary_role": "one of: data_analyst, software_engineer, hr, ai_engineer",
  "confidence": 0.0-1.0,
  "suggested_roles": [
    {"role": "data_analyst|software_engineer|hr|ai_engineer",
     "match_percentage": 0-100,
     "matching_skills": ["skills from the resume that fit this role"],
     "missing_skills": ["important skills for this role the resume lacks"],
     "readiness": "ready|almost_ready|needs_work"}
  ],
  "experience_level": "entry|mid|senior",
  "years_of_experience": float
}
Include ALL FOUR roles in suggested_roles, sorted by match_percentage descending."""

QUESTIONS_PROMPT = """You are a technical interviewer who has read this candidate's resume.
Generate 8 highly specific interview questions based on EXACTLY what is
written in their resume. Reference their actual projects, companies,
technologies, and experiences by name.

Rules:
- Reference the candidate's actual work: "In your project [name]..."
- Ask about gaps or claims that need verification
- Mix technical depth-checks with behavioral questions
- Do not ask generic questions - every question must be resume-specific

Return JSON: {"questions": [8 items]} where each item has exactly these keys:
{
  "question": "the full question text referencing their resume",
  "type": "technical|behavioral|clarification|depth_check",
  "what_to_listen_for": "what a good answer includes",
  "red_flags": "what would be a bad answer",
  "resume_reference": "which part of the resume this came from"
}"""


class ResumeService:
    # ---- Local text extraction ------------------------------------------- #
    @staticmethod
    def extract_text(file_bytes: bytes, filename: str) -> str:
        """Pull plain text out of a PDF or DOCX. Raises ValueError otherwise."""
        name = (filename or "").lower()
        if name.endswith(".pdf"):
            with fitz.open(stream=file_bytes, filetype="pdf") as doc:
                text = "".join(page.get_text() for page in doc)
            return text.strip()
        if name.endswith(".docx"):
            doc = Document(io.BytesIO(file_bytes))
            parts = [p.text for p in doc.paragraphs]
            # Tables hold half the content of many resume templates.
            for table in doc.tables:
                for row in table.rows:
                    parts.extend(cell.text for cell in row.cells)
            return "\n".join(part for part in parts if part).strip()
        raise ValueError("Only PDF and DOCX files are supported")

    # ---- Model calls ------------------------------------------------------ #
    @staticmethod
    async def _json_call(system: str, user: str, max_tokens: int = 2500) -> dict[str, Any]:
        """One JSON-mode chat call on the active provider; raises on failure."""
        response = await llm_service.client.chat.completions.create(
            model=llm_service.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=max_tokens,
            **llm_service._reasoning_kwargs(),
        )
        return json.loads(response.choices[0].message.content or "{}")

    async def parse_resume(self, raw_text: str) -> dict[str, Any]:
        """Extract the structured sections from raw resume text."""
        system = (
            "You are a professional resume parser. Extract structured information "
            "from the resume text provided. Return ONLY valid JSON matching the "
            "schema exactly. If a field is not present, use null or an empty array. "
            "Do not invent information. Extract exactly what is written.\n\n"
            f"Schema:\n{PARSE_SCHEMA_HINT}"
        )
        text = raw_text[:MAX_PROMPT_CHARS]
        data = await self._json_call(
            system, f"Parse this resume:\n\n{text}\n\nReturn JSON only.", max_tokens=3500
        )
        # Guarantee every section the frontend renders exists, whatever shape
        # the model returned.
        data.setdefault("skills", {})
        for key in ("technical", "tools", "soft"):
            data["skills"].setdefault(key, [])
        for key in ("education", "experience", "projects", "certifications", "achievements"):
            data.setdefault(key, [])
        for key in ("name", "email", "phone", "linkedin", "github", "summary"):
            data.setdefault(key, None)
        return data

    async def score_resume(self, parsed_data: dict, raw_text: str) -> dict[str, Any]:
        """Score the resume 0-100 with a per-dimension breakdown."""
        user = (
            f"Parsed sections:\n{json.dumps(parsed_data, ensure_ascii=False)}\n\n"
            f"Full resume text:\n{raw_text[:MAX_PROMPT_CHARS]}"
        )
        data = await self._json_call(SCORE_PROMPT, user, max_tokens=3000)
        data.setdefault("overall_score", 0)
        data.setdefault("breakdown", {})
        for key, default in (
            ("strengths", []), ("critical_issues", []), ("improvement_suggestions", []),
            ("missing_sections", []), ("ats_warnings", []),
        ):
            data.setdefault(key, default)
        # Clamp: model arithmetic drifts occasionally.
        try:
            data["overall_score"] = max(0.0, min(100.0, float(data["overall_score"])))
        except (TypeError, ValueError):
            data["overall_score"] = 0.0
        return data

    async def identify_target_roles(self, parsed_data: dict) -> dict[str, Any]:
        """Match the resume against the four interview tracks."""
        data = await self._json_call(
            ROLES_PROMPT, f"Resume data:\n{json.dumps(parsed_data, ensure_ascii=False)}",
            max_tokens=2500,
        )
        data.setdefault("suggested_roles", [])
        data.setdefault("primary_role", None)
        data.setdefault("experience_level", "entry")
        data.setdefault("years_of_experience", 0)
        return data

    async def generate_resume_questions(
        self, parsed_data: dict, job_role: str
    ) -> list[dict[str, Any]]:
        """THE differentiator: interview questions built from this resume."""
        user = (
            f"Job role being interviewed for: {job_role}\n\n"
            f"Resume data: {json.dumps(parsed_data, ensure_ascii=False)}"
        )
        data = await self._json_call(QUESTIONS_PROMPT, user, max_tokens=3500)
        questions = data.get("questions")
        if not isinstance(questions, list):
            # Some models return the array under a different key, or bare.
            for value in data.values():
                if isinstance(value, list):
                    questions = value
                    break
        return [q for q in (questions or []) if isinstance(q, dict) and q.get("question")][:8]


resume_service = ResumeService()

# Re-exported so routes can catch provider failures without importing openai/groq.
RESUME_PROVIDER_ERRORS = PROVIDER_ERRORS
