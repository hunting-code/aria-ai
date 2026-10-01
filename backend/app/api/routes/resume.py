"""Resume upload, analysis and personalized interview questions.

Only the extracted text and its analyses are stored - the uploaded file itself
is read, mined and discarded.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Path, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Resume, User
from app.services.llm_service import LLMUnavailableError, get_questions, llm_service
from app.services.resume_service import RESUME_PROVIDER_ERRORS, resume_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/resume", tags=["resume"])

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_SUFFIXES = (".pdf", ".docx")
VALID_ROLES = frozenset({"data_analyst", "software_engineer", "hr", "ai_engineer"})

MODEL_DOWN = "The AI service is temporarily unavailable. Please try again shortly."


def _serialize(resume: Resume) -> dict:
    return {
        "id": str(resume.id),
        "original_filename": resume.original_filename,
        "file_size_kb": resume.file_size_kb,
        "parsed_data": resume.parsed_data,
        "resume_score": resume.resume_score,
        "score_breakdown": resume.score_breakdown,
        "improvement_suggestions": resume.improvement_suggestions,
        "role_fit": resume.role_fit,
        "uploaded_at": resume.uploaded_at.isoformat() if resume.uploaded_at else None,
        "last_analysed_at": (
            resume.last_analysed_at.isoformat() if resume.last_analysed_at else None
        ),
    }


def _get_resume(db: Session, user_id) -> Resume | None:
    return db.execute(
        select(Resume).where(Resume.user_id == user_id)
    ).scalar_one_or_none()


@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Extract, parse, score and role-match a PDF/DOCX resume in one pass."""
    filename = file.filename or ""
    if not filename.lower().endswith(ALLOWED_SUFFIXES):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF and DOCX files are supported.",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"That file is {len(file_bytes) / 1_048_576:.1f} MB; the limit is 5 MB.",
        )
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    try:
        raw_text = resume_service.extract_text(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except Exception:
        logger.exception("Failed to extract text from %s", filename)
        raise HTTPException(
            status_code=422,
            detail="That file could not be read. Is it a valid PDF or DOCX?",
        )

    if len(raw_text.split()) < 30:
        raise HTTPException(
            status_code=422,
            detail=(
                "Very little text could be extracted. Scanned/image-only resumes "
                "are not supported - export a text-based PDF or DOCX."
            ),
        )

    try:
        parsed = await resume_service.parse_resume(raw_text)
        scored = await resume_service.score_resume(parsed, raw_text)
        roles = await resume_service.identify_target_roles(parsed)
    except RESUME_PROVIDER_ERRORS:
        logger.exception("Resume analysis failed at the model call")
        raise HTTPException(status_code=503, detail=MODEL_DOWN)
    except (ValueError, KeyError):
        logger.exception("Resume analysis returned an unusable shape")
        raise HTTPException(status_code=502, detail=MODEL_DOWN)

    now = datetime.now(timezone.utc)
    try:
        resume = _get_resume(db, current_user.id)
        if resume is None:
            resume = Resume(user_id=current_user.id)
            db.add(resume)
        resume.original_filename = filename
        resume.file_size_kb = round(len(file_bytes) / 1024, 1)
        resume.raw_text = raw_text
        resume.parsed_data = parsed
        resume.resume_score = scored["overall_score"]
        resume.score_breakdown = {
            "breakdown": scored.get("breakdown", {}),
            "strengths": scored.get("strengths", []),
            "critical_issues": scored.get("critical_issues", []),
            "missing_sections": scored.get("missing_sections", []),
            "ats_warnings": scored.get("ats_warnings", []),
        }
        resume.improvement_suggestions = scored.get("improvement_suggestions", [])
        resume.role_fit = roles
        resume.uploaded_at = now
        resume.last_analysed_at = now
        db.commit()
        db.refresh(resume)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not save the resume analysis")
        raise HTTPException(status_code=500, detail="Could not save the analysis.")

    return _serialize(resume)


@router.get("/my-resume")
def my_resume(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resume = _get_resume(db, current_user.id)
    if resume is None:
        raise HTTPException(status_code=404, detail="No resume uploaded yet.")
    return _serialize(resume)


@router.delete("/my-resume", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resume = _get_resume(db, current_user.id)
    if resume is None:
        raise HTTPException(status_code=404, detail="No resume uploaded yet.")
    try:
        db.delete(resume)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not delete the resume")
        raise HTTPException(status_code=500, detail="Could not delete the resume.")


@router.get("/questions/{job_role}")
async def resume_questions(
    job_role: str = Path(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """8 questions generated from the user's own resume for this role.

    With no resume on file the standard bank answers instead, flagged by
    `source`, so the caller can always render something.
    """
    if job_role not in VALID_ROLES:
        raise HTTPException(status_code=404, detail=f"Unknown role '{job_role}'.")

    resume = _get_resume(db, current_user.id)
    if resume is None or not resume.parsed_data:
        bank = get_questions(job_role, "intermediate")
        return {
            "source": "standard",
            "job_role": job_role,
            "questions": [
                {
                    "question": q["text"] if isinstance(q, dict) else str(q),
                    "type": "technical",
                    "what_to_listen_for": None,
                    "red_flags": None,
                    "resume_reference": None,
                }
                for q in bank[:8]
            ],
        }

    try:
        questions = await resume_service.generate_resume_questions(
            resume.parsed_data, job_role
        )
    except RESUME_PROVIDER_ERRORS:
        logger.exception("Personalized question generation failed")
        raise HTTPException(status_code=503, detail=MODEL_DOWN)

    if not questions:
        raise HTTPException(status_code=502, detail=MODEL_DOWN)
    return {"source": "resume", "job_role": job_role, "questions": questions}


class PracticeRequest(BaseModel):
    question: str = Field(min_length=5, max_length=2000)
    answer: str = Field(min_length=1, max_length=8000)
    job_role: str = "software_engineer"


@router.post("/practice")
async def practice_question(
    payload: PracticeRequest,
    current_user: User = Depends(get_current_user),
):
    """Score one typed answer to a suggested question - the quick-practice modal."""
    role = payload.job_role if payload.job_role in VALID_ROLES else "software_engineer"
    try:
        result = await llm_service.evaluate_answer(
            payload.question, payload.answer, role, "intermediate"
        )
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {
        "verdict": result.get("verdict", "unscored"),
        "correctness_note": result.get("correctness_note", ""),
        "answer_score": result.get("answer_score"),
        "communication_score": result.get("communication_score"),
        "feedback_text": result.get("feedback_text", ""),
        "strengths": result.get("strengths", []),
        "improvements": result.get("improvements", []),
    }
