"""Google Gemini provider wrapper.

The rest of the app talks to this module, not to the SDK, so the interview
engine, the scorer and the transcriber share one place that knows about
authentication, error shapes and model names.

Gemini handles both jobs OpenAI used to split across two APIs: text generation
and audio transcription are the same `generate_content` call, differing only in
whether an audio part is attached.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncGenerator
from typing import Any, Final

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

PLACEHOLDER_KEYS: Final[frozenset[str]] = frozenset(
    {"", "your-gemini-key-here", "your-api-key-here", "changeme", "test"}
)

# Audio MIME types Gemini accepts as inline data. WebM is deliberately absent:
# it is what MediaRecorder produces by default and Gemini rejects it, which is
# why the browser now records WAV instead.
SUPPORTED_AUDIO_MIME: Final[frozenset[str]] = frozenset(
    {
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/aiff",
        "audio/aac",
        "audio/ogg",
        "audio/flac",
    }
)


class GeminiError(RuntimeError):
    """A Gemini call failed.

    `kind` lets callers answer with a status code that matches the cause, and
    `detail` carries Google's own message. A single opaque failure would send
    the caller into a retry loop for problems retrying cannot fix.
    """

    def __init__(self, message: str, *, kind: str = "api", detail: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.detail = detail


def _message_of(exc: Exception) -> str:
    """Google's own error text, when it exposes one."""
    for attr in ("message", "details"):
        value = getattr(exc, attr, None)
        if isinstance(value, str) and value:
            return value
    return str(exc)


def classify(exc: Exception) -> GeminiError:
    """Turn an SDK exception into something the API layer can act on."""
    detail = _message_of(exc)
    # The SDK's .message drops the quota metadata; only str(exc) carries it, and
    # that metadata is the sole way to tell "you are going too fast" apart from
    # "this project has no quota at all".
    full = f"{detail} {exc}"
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)

    if isinstance(exc, genai_errors.ClientError):
        if code in (401, 403) or "API_KEY" in full.upper() or "PERMISSION_DENIED" in full.upper():
            return GeminiError(
                "The Gemini API key is invalid, or the Generative Language API is "
                "not enabled for its project.",
                kind="auth",
                detail=detail,
            )
        if code == 429 or "RESOURCE_EXHAUSTED" in full:
            # Google returns 429 both for genuine per-minute throttling and for a
            # project with no quota allocated at all. They need opposite advice,
            # and the limit value is what separates them.
            exhausted = (
                "'quota_limit_value': '0'" in full
                or '"quota_limit_value": "0"' in full
            )
            if exhausted:
                return GeminiError(
                    "This Gemini project has no quota allocated. Enable the "
                    "Generative Language API for it, or create a key at "
                    "https://aistudio.google.com/apikey which includes free-tier quota.",
                    kind="quota",
                    detail=detail,
                )
            return GeminiError(
                "Gemini rate limit reached. Please try again in a moment.",
                kind="rate_limit",
                detail=detail,
            )
        if code == 400:
            return GeminiError(f"Gemini rejected the request: {detail}", kind="bad_request", detail=detail)

    if isinstance(exc, genai_errors.ServerError):
        return GeminiError("Gemini is temporarily unavailable.", kind="server", detail=detail)

    return GeminiError(f"Gemini call failed: {detail}", kind="api", detail=detail)


def _strip_code_fence(text: str) -> str:
    """Remove a ```json fence if the model wrapped its JSON in one."""
    fenced = re.match(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", text, re.S)
    return fenced.group(1) if fenced else text


class GeminiClient:
    """Thin async wrapper over the Gemini SDK."""

    def __init__(self) -> None:
        self._client: genai.Client | None = None

    @property
    def is_configured(self) -> bool:
        key = (settings.GEMINI_API_KEY or "").strip()
        return key not in PLACEHOLDER_KEYS and len(key) > 20

    @property
    def client(self) -> genai.Client:
        # Built on first use, not at import: settings are read once at startup,
        # and constructing this eagerly would fail the whole module when no key
        # is configured yet.
        if self._client is None:
            self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
        return self._client

    @staticmethod
    def _to_contents(history: list[dict[str, str]], prompt: str) -> list[types.Content]:
        """Map the app's OpenAI-shaped turns onto Gemini's contents list.

        Gemini names the assistant role "model", and carries the system prompt
        separately rather than as a first message.
        """
        contents: list[types.Content] = []
        for turn in history or []:
            role = "model" if turn.get("role") == "assistant" else "user"
            text = str(turn.get("content") or "").strip()
            if text:
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt)]))
        return contents

    # ---- Text ------------------------------------------------------------- #
    async def stream_text(
        self,
        *,
        system: str,
        prompt: str,
        history: list[dict[str, str]] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 300,
        model: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Yield the reply chunk by chunk."""
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
        try:
            stream = await self.client.aio.models.generate_content_stream(
                model=model or settings.GEMINI_MODEL,
                contents=self._to_contents(history or [], prompt),
                config=config,
            )
            async for chunk in stream:
                text = getattr(chunk, "text", None)
                if text:
                    yield text
        except Exception as exc:  # noqa: BLE001 - re-raised as a typed error
            error = classify(exc)
            logger.error("Gemini stream failed (%s): %s", error.kind, error.detail, exc_info=True)
            raise error from exc

    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 600,
        model: str | None = None,
    ) -> dict[str, Any]:
        """Ask for JSON and return it parsed.

        Uses Gemini's JSON response mode, but still strips a code fence and
        tolerates a parse failure, because a model that returns prose instead of
        JSON should not take an interview down.
        """
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens,
            response_mime_type="application/json",
        )
        try:
            response = await self.client.aio.models.generate_content(
                model=model or settings.GEMINI_MODEL,
                contents=prompt,
                config=config,
            )
        except Exception as exc:  # noqa: BLE001
            error = classify(exc)
            logger.error("Gemini JSON call failed (%s): %s", error.kind, error.detail, exc_info=True)
            raise error from exc

        raw = _strip_code_fence(response.text or "{}")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Gemini returned unparseable JSON: %s", raw[:200])
            raise GeminiError(
                "Gemini returned a malformed response.", kind="bad_response", detail=raw[:300]
            ) from None
        return parsed if isinstance(parsed, dict) else {}

    # ---- Audio ------------------------------------------------------------- #
    async def transcribe(
        self,
        audio_bytes: bytes,
        mime_type: str,
        *,
        model: str | None = None,
    ) -> str:
        """Transcribe speech.

        Gemini has no separate speech endpoint: the audio travels as a part of
        an ordinary generate_content call, with a prompt telling it to write
        down exactly what was said and nothing else.
        """
        if mime_type not in SUPPORTED_AUDIO_MIME:
            raise GeminiError(
                f"Gemini does not accept {mime_type!r} audio. Record WAV, MP3, "
                "OGG, AAC or FLAC.",
                kind="bad_format",
                detail=mime_type,
            )

        config = types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=2048,
            system_instruction=(
                "You are a transcription engine. Write out exactly the words "
                "spoken in the audio, including filler words such as um, uh and "
                "like. Do not summarise, translate, correct grammar, or add "
                "commentary. If the audio contains no speech, return an empty "
                "string."
            ),
        )
        try:
            response = await self.client.aio.models.generate_content(
                model=model or settings.GEMINI_AUDIO_MODEL,
                contents=[
                    types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                    types.Part.from_text(text="Transcribe this audio verbatim."),
                ],
                config=config,
            )
        except Exception as exc:  # noqa: BLE001
            error = classify(exc)
            logger.error(
                "Gemini transcription failed (%s): %s", error.kind, error.detail, exc_info=True
            )
            raise error from exc

        return (response.text or "").strip()

    async def reachable(self) -> tuple[bool, str]:
        """Cheap connectivity probe for the health endpoint."""
        try:
            await self.client.aio.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents="ping",
                config=types.GenerateContentConfig(max_output_tokens=8),
            )
            return True, ""
        except Exception as exc:  # noqa: BLE001
            return False, classify(exc).detail[:300]


gemini = GeminiClient()

__all__ = ["GeminiClient", "GeminiError", "gemini", "classify", "SUPPORTED_AUDIO_MIME"]
