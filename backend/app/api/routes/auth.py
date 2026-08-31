"""Authentication routes: register, login, token refresh, current user."""

from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["auth"])

# TODO: register, login, refresh and /me endpoints.
