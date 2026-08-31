"""Authentication routes: register, login and the current-user lookup."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas import Token, UserCreate, UserResponse
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import (
    PASSWORD_CONTEXT,
    create_access_token,
    get_current_user,
    get_password_hash,
    needs_rehash,
    verify_password,
)
from app.models import User

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/auth", tags=["auth"])

# Verifying against a throwaway hash keeps a login for a non-existent username
# as slow as one for a real user, so response time can't be used to enumerate
# accounts. Computed once at import.
_DUMMY_HASH = PASSWORD_CONTEXT.hash("not-a-real-password")

INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect username or password",
    headers={"WWW-Authenticate": "Bearer"},
)


def _issue_token(user: User) -> Token:
    """Build the token response for a freshly authenticated user."""
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    access_token = create_access_token({"sub": str(user.id), "username": user.username})
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.post(
    "/register",
    response_model=Token,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and return a token",
    responses={409: {"description": "Username or email already registered"}},
)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> Token:
    """Register a new user and log them straight in.

    Username and email are both unique and compared case-insensitively, so
    `Alice` cannot register alongside `alice`.
    """
    existing = db.scalar(
        select(User).where(
            or_(
                func.lower(User.username) == payload.username.lower(),
                func.lower(User.email) == payload.email.lower(),
            )
        )
    )
    if existing is not None:
        # Name the clashing field so the signup form can point at it.
        field = (
            "username"
            if existing.username.lower() == payload.username.lower()
            else "email"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"That {field} is already registered",
        )

    user = User(
        username=payload.username,
        email=payload.email.lower(),
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        # Two concurrent signups can both pass the check above; the unique
        # index is the real arbiter.
        db.rollback()
        logger.info("Registration lost a uniqueness race: %s", exc.orig)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That username or email is already registered",
        ) from exc

    db.refresh(user)
    logger.info("Registered user %s (%s)", user.username, user.id)
    return _issue_token(user)


@router.post(
    "/login",
    response_model=Token,
    summary="Exchange username and password for a token",
    responses={401: {"description": "Incorrect username or password"}},
)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    """Authenticate with form-encoded credentials.

    Uses OAuth2PasswordRequestForm so the /docs "Authorize" button works. The
    same error is returned whether the username or the password was wrong.
    """
    username = form_data.username.strip()
    user = db.scalar(
        select(User).where(func.lower(User.username) == username.lower())
    )

    if user is None:
        verify_password(form_data.password, _DUMMY_HASH)  # equalise timing
        raise INVALID_CREDENTIALS
    if not verify_password(form_data.password, user.hashed_password):
        logger.info("Failed login for %s", username)
        raise INVALID_CREDENTIALS
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive",
        )

    # Transparently upgrade hashes made with older bcrypt parameters.
    if needs_rehash(user.hashed_password):
        user.hashed_password = get_password_hash(form_data.password)
        db.commit()
        db.refresh(user)

    logger.info("User %s logged in", user.username)
    return _issue_token(user)


@router.get(
    "/me",
    response_model=UserResponse,
    summary="The authenticated user",
    responses={401: {"description": "Missing, expired or invalid token"}},
)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    """Return the account the bearer token belongs to."""
    return current_user
