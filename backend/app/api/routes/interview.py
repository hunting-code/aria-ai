"""Interview routes: start an interview, fetch/advance questions, submit answers."""

from fastapi import APIRouter

router = APIRouter(prefix="/interview", tags=["interview"])

# TODO: question generation and answer submission endpoints.
