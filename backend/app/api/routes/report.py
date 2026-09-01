"""Report routes: generate and download the PDF interview report."""

from __future__ import annotations

import logging
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Answer, InterviewSession, User
from app.services.report_service import report_service

logger = logging.getLogger(__name__)

# The spec addresses this as /report/{id}/pdf, so the prefix is singular.
router = APIRouter(prefix="/report", tags=["reports"])


@router.post(
    "/{session_id}/pdf",
    summary="Generate the interview report as a PDF",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {}}, "description": "The report"},
        401: {"description": "Missing, expired or invalid token"},
        404: {"description": "No such session for this user"},
    },
)
async def download_report_pdf(
    session_id: uuid.UUID = Path(..., description="The interview to report on."),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Render the report server-side and return it as a downloadable PDF.

    This is the fallback for the browser's canvas export: it needs no rendered
    page, so it works from a retry, a background job, or a client where the
    capture failed.
    """
    session = db.scalar(
        select(InterviewSession).where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == current_user.id,
            InterviewSession.deleted_at.is_(None),
        )
    )
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    answers = db.scalars(
        select(Answer)
        .where(Answer.session_id == session.id)
        .order_by(Answer.question_number)
    ).all()

    history = db.scalars(
        select(InterviewSession)
        .where(
            InterviewSession.user_id == current_user.id,
            InterviewSession.deleted_at.is_(None),
        )
        .order_by(InterviewSession.created_at.desc())
        .limit(5)
    ).all()

    # fpdf2 is CPU-bound and synchronous; keep it off the event loop.
    pdf_bytes = await run_in_threadpool(
        report_service.generate_pdf, session, list(answers), current_user, list(history)
    )

    filename = report_service.filename_for(session)
    logger.info(
        "Generated report %s for %s (%d bytes)", filename, current_user.username, len(pdf_bytes)
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            # filename* carries the UTF-8 form for clients that support it,
            # with an ASCII fallback for those that do not.
            "Content-Disposition": (
                f'attachment; filename="{filename}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Content-Length": str(len(pdf_bytes)),
        },
    )
