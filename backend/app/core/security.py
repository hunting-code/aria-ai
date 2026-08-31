"""Password hashing and JWT creation/verification.

Exposes the primitives used by the auth routes and the `get_current_user`
FastAPI dependency that protects every authenticated endpoint.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Final

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import ExpiredSignatureError, JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db

logger = logging.getLogger(__name__)
settings = get_settings()

# bcrypt with 12 rounds: the cost is re-read from each stored hash, so raising
# this later keeps old hashes verifiable (`deprecated="auto"` flags them).
PASSWORD_CONTEXT: Final[CryptContext] = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)

# bcrypt hashes at most 72 bytes and passlib silently discards the rest, which
# would make "<72-byte prefix>" and the full password interchangeable. We reject
# instead of truncating; the API surfaces this as a 422 from the schema.
BCRYPT_MAX_BYTES: Final[int] = 72

TOKEN_TYPE: Final[str] = "access"

# tokenUrl is what /docs posts to for the "Authorize" button; it is relative to
# the server root, hence no leading slash.
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_PREFIX.strip('/')}/auth/login",
    auto_error=True,
)

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def password_too_long(password: str) -> bool:
    """True if bcrypt would silently truncate this password."""
    return len(password.encode("utf-8")) > BCRYPT_MAX_BYTES


def get_password_hash(password: str) -> str:
    """Return the bcrypt digest of `password`.

    Raises:
        ValueError: if the password exceeds bcrypt's 72-byte limit. Callers
            should validate first (see `UserCreate`) so this surfaces as a 422
            rather than a 500.
    """
    if not password:
        raise ValueError("Password must not be empty")
    if password_too_long(password):
        raise ValueError(
            f"Password must be at most {BCRYPT_MAX_BYTES} bytes "
            "(bcrypt would otherwise truncate it)"
        )
    return PASSWORD_CONTEXT.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check a password against a stored hash.

    Never raises: a malformed or empty hash in the database is a failed login,
    not a 500.
    """
    if not plain_password or not hashed_password:
        return False
    try:
        return PASSWORD_CONTEXT.verify(plain_password, hashed_password)
    except (ValueError, TypeError) as exc:
        logger.warning("Password verification failed on a malformed hash: %s", exc)
        return False


def needs_rehash(hashed_password: str) -> bool:
    """True if the hash uses outdated parameters and should be upgraded on login."""
    try:
        return PASSWORD_CONTEXT.needs_update(hashed_password)
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """Sign a JWT carrying `data`.

    `sub` must identify the user. `exp`, `iat` and `type` are added here and
    overwrite any same-named keys in `data`.
    """
    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        **data,
        "exp": expire,
        "iat": now,
        "type": TOKEN_TYPE,
    }
    if "sub" in payload:  # jose requires `sub` to be a string
        payload["sub"] = str(payload["sub"])
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT.

    Returns:
        The payload.

    Raises:
        HTTPException: 401 if the token is expired, tampered with, signed with
            the wrong key, or is not an access token.
    """
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
    except ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except JWTError as exc:
        logger.info("Rejected an invalid token: %s", exc)
        raise CREDENTIALS_EXCEPTION from exc

    # Reject a refresh/reset token presented where an access token is required.
    if payload.get("type") != TOKEN_TYPE:
        raise CREDENTIALS_EXCEPTION
    if not payload.get("sub"):
        raise CREDENTIALS_EXCEPTION
    return payload


# --------------------------------------------------------------------------- #
# FastAPI dependency
# --------------------------------------------------------------------------- #
def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """Resolve the bearer token to the `User` row it identifies.

    Raises:
        HTTPException: 401 if the token is invalid or the user no longer
            exists; 403 if the account has been deactivated.
    """
    from app.models import User  # local import keeps this module import-cycle free

    payload = decode_token(token)
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except (ValueError, KeyError) as exc:
        raise CREDENTIALS_EXCEPTION from exc

    user = db.get(User, user_id)
    if user is None:
        # Valid signature, but the account was deleted since the token was issued.
        raise CREDENTIALS_EXCEPTION
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive",
        )
    return user


__all__ = [
    "PASSWORD_CONTEXT",
    "BCRYPT_MAX_BYTES",
    "create_access_token",
    "decode_token",
    "get_current_user",
    "get_password_hash",
    "needs_rehash",
    "oauth2_scheme",
    "password_too_long",
    "verify_password",
]
