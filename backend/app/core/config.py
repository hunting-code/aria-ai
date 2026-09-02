"""Application settings, loaded from the environment via pydantic-settings.

Import `get_settings()` rather than instantiating `Settings` directly - the
result is cached so the .env file is parsed and validated exactly once.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> parents[2] == backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"

PLACEHOLDER_SECRET = "your-secret-key-here-change-in-production"
PLACEHOLDER_OPENAI_KEY = "your-openai-key-here"
PLACEHOLDER_GROQ_KEY = "your-groq-key-here"


class Settings(BaseSettings):
    """Runtime configuration.

    Fields without a default are required; startup fails loudly if they are
    missing rather than letting the app run half-configured.
    """

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Database ----
    DATABASE_URL: str
    DB_POOL_SIZE: int = Field(default=5, ge=1)
    DB_MAX_OVERFLOW: int = Field(default=10, ge=0)
    DB_POOL_RECYCLE: int = Field(default=1800, ge=60)
    SQL_ECHO: bool = False

    # ---- Auth / JWT ----
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=1440, ge=1)

    # ---- OpenAI (feedback and scoring) ----
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4o-mini"

    # ---- Groq (speech-to-text) ----
    # Transcription is split onto Groq because its free tier covers Whisper.
    # Optional so the app still starts without it - the interview then falls
    # back to the typed answer path rather than failing outright.
    GROQ_API_KEY: str = ""
    # Groq's Whisper model name. Note this is not an OpenAI model id: Groq
    # serves whisper-large-v3-turbo, and "whisper-1" would be rejected.
    WHISPER_MODEL: str = "whisper-large-v3-turbo"

    # ---- Application ----
    PROJECT_NAME: str = "ARIA AI"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False

    # ---- Rate limiting ----
    # Off for the test suite and for local runs where repeated requests are
    # normal; on by default everywhere else.
    DISABLE_RATE_LIMITS: bool = False

    # ---- CORS ----
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origins_list(self) -> list[str]:
        """CORS_ORIGINS as a list. Accepts a comma-separated string or `*`."""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @field_validator("DATABASE_URL")
    @classmethod
    def _validate_database_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("DATABASE_URL must not be empty")
        if "://" not in v:
            raise ValueError(
                "DATABASE_URL must be a SQLAlchemy URL, e.g. "
                "postgresql://user:password@host:5432/dbname"
            )
        return v

    @field_validator("SECRET_KEY")
    @classmethod
    def _validate_secret_key(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("SECRET_KEY must not be empty")
        return v

    def check_production_readiness(self) -> list[str]:
        """Return a list of problems that make this config unsafe to deploy.

        Called at startup: fatal in production, logged as warnings elsewhere so
        local development still works straight after `cp .env.example .env`.
        """
        problems: list[str] = []
        if self.SECRET_KEY == PLACEHOLDER_SECRET:
            problems.append(
                "SECRET_KEY is still the .env.example placeholder - "
                "generate one with: openssl rand -hex 32"
            )
        elif len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY is shorter than 32 characters")
        if self.OPENAI_API_KEY in (PLACEHOLDER_OPENAI_KEY, ""):
            problems.append("OPENAI_API_KEY is missing or still the .env.example placeholder")
        if self.GROQ_API_KEY in (PLACEHOLDER_GROQ_KEY, ""):
            problems.append(
                "GROQ_API_KEY is missing - speech-to-text will be unavailable"
            )
        if self.DEBUG and self.is_production:
            problems.append("DEBUG must be false in production")
        if "*" in self.cors_origins_list and self.is_production:
            problems.append("CORS_ORIGINS must not be '*' in production")
        return problems


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached Settings instance.

    Raises:
        RuntimeError: if required variables are missing or malformed, with a
            message naming each offending variable.
    """
    try:
        return Settings()  # type: ignore[call-arg]  # values come from env/.env
    except ValidationError as exc:
        details = "\n".join(
            f"  - {'.'.join(str(p) for p in err['loc']) or '<root>'}: {err['msg']}"
            for err in exc.errors()
        )
        hint = "" if ENV_FILE.exists() else (
            f"\n\nNo .env file found at {ENV_FILE}. Create one with:\n"
            f"  cp {ENV_FILE.parent / '.env.example'} {ENV_FILE}"
        )
        raise RuntimeError(
            f"Invalid configuration - the app cannot start:\n{details}{hint}"
        ) from exc


__all__ = ["Settings", "get_settings", "BACKEND_DIR", "ENV_FILE"]
