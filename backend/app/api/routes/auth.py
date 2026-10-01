"""Authentication routes: register, login and the current-user lookup."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sqlalchemy.exc import SQLAlchemyError

from app.api.schemas import (
    AccountDeleteRequest,
    PasswordChange,
    ProfileUpdate,
    Token,
    UserCreate,
    UserResponse,
)
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
from app.services.demo_service import (
    DEMO_PASSWORD,
    DEMO_USERNAME,
    get_or_create_demo_user,
    reset_demo_data,
)

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

    # The demo account is provisioned on first use and reset on every sign-in,
    # so each visitor starts from the same five sample sessions and nothing
    # they do in demo mode survives for the next one.
    if username.lower() == DEMO_USERNAME and form_data.password == DEMO_PASSWORD:
        demo = get_or_create_demo_user(db)
        reset_demo_data(db, demo)
        logger.info("Demo sign-in; account reset to its samples")
        return _issue_token(demo)

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


@router.put(
    "/profile",
    response_model=UserResponse,
    summary="Update the signed-in user's profile",
    responses={
        400: {"description": "The current password is wrong, or the request is incomplete"},
        401: {"description": "Missing, expired or invalid token"},
        403: {"description": "The shared demo account cannot be modified"},
    },
)
def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Change the display name, and optionally the password.

    Username and email are deliberately immutable: both identify the account
    elsewhere, and changing them is an account-recovery problem rather than a
    settings one.
    """
    if current_user.is_demo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The shared demo account cannot be modified.",
        )

    wants_password_change = any(
        (payload.current_password, payload.new_password)
    )
    if wants_password_change:
        if not payload.current_password or not payload.new_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both the current and new password are required.",
            )
        if not verify_password(payload.current_password, current_user.hashed_password):
            # Deliberately specific: the caller is already authenticated, so
            # this leaks nothing they do not already know.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That is not your current password.",
            )
        if verify_password(payload.new_password, current_user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The new password must be different from the current one.",
            )
        current_user.hashed_password = get_password_hash(payload.new_password)

    if payload.full_name is not None:
        current_user.full_name = payload.full_name.strip() or None

    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not update the profile for %s", current_user.username)
        raise HTTPException(status_code=500, detail="Could not save your changes.")

    db.refresh(current_user)
    logger.info(
        "Profile updated for %s (password changed: %s)",
        current_user.username,
        bool(wants_password_change),
    )
    return current_user


@router.put(
    "/password",
    response_model=UserResponse,
    summary="Change the signed-in user's password",
    responses={
        400: {"description": "The current password is wrong, or the new one is unusable"},
        401: {"description": "Missing, expired or invalid token"},
        403: {"description": "The shared demo account cannot be modified"},
    },
)
def change_password(
    payload: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Change only the password.

    A thin wrapper over the same checks as PUT /profile, for callers that want
    a dedicated endpoint rather than a partial profile update.
    """
    return update_profile(
        ProfileUpdate(
            current_password=payload.current_password,
            new_password=payload.new_password,
        ),
        current_user=current_user,
        db=db,
    )


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete the signed-in account",
    responses={
        400: {"description": "The password is wrong"},
        403: {"description": "The shared demo account cannot be deleted"},
    },
)
def delete_account(
    payload: AccountDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete the account and everything attached to it.

    This is irreversible, so it is gated on the password even though the caller
    already holds a valid token - a forgotten open session should not be enough
    to destroy someone's history.
    """
    if current_user.is_demo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The shared demo account cannot be deleted.",
        )
    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That password is incorrect."
        )

    username = current_user.username
    try:
        # Sessions, answers and the resume all cascade from the user row.
        db.delete(current_user)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Could not delete the account %s", username)
        raise HTTPException(status_code=500, detail="Could not delete your account.")
    logger.info("Account deleted: %s", username)
