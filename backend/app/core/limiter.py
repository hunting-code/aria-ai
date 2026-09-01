"""Rate limiting.

Limits are keyed by user where a request is authenticated and by IP otherwise,
so one signed-in user cannot exhaust the quota of everyone behind the same
NAT, and an unauthenticated flood is still bounded.
"""

from __future__ import annotations

import logging

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.security import decode_token

logger = logging.getLogger(__name__)
settings = get_settings()

# Per-route limits. Kept here rather than inline so the whole policy is
# readable in one place.
TRANSCRIBE_LIMIT = "30/minute"
CREATE_SESSION_LIMIT = "10/day"
GLOBAL_LIMIT = "100/minute"


def rate_limit_key(request: Request) -> str:
    """Identify the caller: the user id when signed in, otherwise the IP.

    The token is decoded without touching the database - this runs on every
    request and a query here would be a needless round trip. A malformed token
    simply falls back to the IP; authentication itself is enforced elsewhere.
    """
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            payload = decode_token(auth.split(" ", 1)[1].strip())
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:  # noqa: BLE001 - any failure means "not identified"
            pass
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=[GLOBAL_LIMIT],
    # Tests and local development would otherwise trip limits between cases.
    enabled=not settings.DISABLE_RATE_LIMITS,
    headers_enabled=True,
)

__all__ = [
    "limiter",
    "rate_limit_key",
    "TRANSCRIBE_LIMIT",
    "CREATE_SESSION_LIMIT",
    "GLOBAL_LIMIT",
]
