"""Thin wrapper around the Google Gen AI SDK (`google-genai`).

One client serves both back ends:
  * Gemini Developer API with a key from Google AI Studio (GEMINI_API_KEY) - local development;
  * Vertex AI on Google Cloud (GOOGLE_GENAI_USE_VERTEXAI=true) - Cloud Run, using the service
    account, so no key is stored in production.

Every caller treats Gemini as optional: if it is not configured or a call fails, the caller falls
back to the deterministic rule-based path, so an SOS is never blocked by the model.
"""
import logging
import threading
import time
from typing import Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel

from backend.app.core.config import settings

logger = logging.getLogger("neighbourhood_safety.gemini")

T = TypeVar("T", bound=BaseModel)
_client = None
_client_key: Optional[tuple] = None
_lock = threading.Lock()
EMBED_BATCH = 50
last_model_used = threading.local()
# Models that just reported exhausted quota (429) or retirement (404) are skipped until this time.
_cooldown: Dict[str, float] = {}
QUOTA_COOLDOWN_SECONDS = 120
RETIRED_COOLDOWN_SECONDS = 3600


class GeminiUnavailable(RuntimeError):
    """Gemini is not configured or the call failed; callers fall back to rules."""


def _settings_key() -> tuple:
    return (settings.GEMINI_API_KEY, settings.GOOGLE_GENAI_USE_VERTEXAI, settings.GOOGLE_CLOUD_PROJECT,
            settings.GOOGLE_CLOUD_LOCATION, settings.GEMINI_TIMEOUT_SECONDS)


def client():
    """Shared client, rebuilt if the settings change (tests switch keys at runtime)."""
    global _client, _client_key
    if not settings.gemini_configured:
        raise GeminiUnavailable("Gemini is not configured (set GEMINI_API_KEY or GOOGLE_GENAI_USE_VERTEXAI)")
    key = _settings_key()
    with _lock:
        if _client is None or _client_key != key:
            from google import genai
            from google.genai import types

            # One quick retry for transient overload (5xx). Quota errors (429) are not retried: the
            # next model in the fallback list is tried instead.
            retry = types.HttpRetryOptions(attempts=2, initial_delay=0.5, max_delay=2.0,
                                           http_status_codes=[500, 502, 503, 504])
            http = types.HttpOptions(timeout=settings.GEMINI_TIMEOUT_SECONDS * 1000, retry_options=retry)
            if settings.GOOGLE_GENAI_USE_VERTEXAI:
                _client = genai.Client(vertexai=True, project=settings.GOOGLE_CLOUD_PROJECT,
                                       location=settings.GOOGLE_CLOUD_LOCATION, http_options=http)
            else:
                _client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=http)
            _client_key = key
        return _client


def backend_name() -> str:
    return "vertex-ai" if settings.GOOGLE_GENAI_USE_VERTEXAI else "gemini-developer-api"


def generate_json(prompt: str, schema: Type[T], system: str, temperature: float = 0.1) -> T:
    """Structured output: Gemini returns JSON that is validated against the Pydantic `schema`.

    Tries GEMINI_MODEL, then each GEMINI_FALLBACK_MODELS entry, within a total budget of
    GEMINI_BUDGET_SECONDS so an emergency report is never held up by a slow model. A model that
    reports exhausted quota or retirement is skipped for a while instead of being retried."""
    from google.genai import types

    started = time.monotonic()
    resp, errors = None, []
    for model in settings.gemini_models:
        if _cooldown.get(model, 0) > time.time():
            errors.append(f"{model}: cooling down after quota/retirement error")
            continue
        remaining = settings.GEMINI_BUDGET_SECONDS - (time.monotonic() - started)
        if remaining < 2:
            errors.append("time budget used up")
            break
        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=schema,
            http_options=types.HttpOptions(timeout=int(min(remaining, settings.GEMINI_TIMEOUT_SECONDS) * 1000)),
        )
        try:
            resp = client().models.generate_content(model=model, contents=prompt, config=config)
            last_model_used.value = model
            break
        except GeminiUnavailable:
            raise
        except Exception as exc:
            text = str(exc)
            if text.startswith("429") or "RESOURCE_EXHAUSTED" in text:
                _cooldown[model] = time.time() + QUOTA_COOLDOWN_SECONDS
            elif "NOT_FOUND" in text or "no longer available" in text:
                _cooldown[model] = time.time() + RETIRED_COOLDOWN_SECONDS
            errors.append(f"{model}: {type(exc).__name__}: {text[:120]}")
            logger.info("Gemini model %s unavailable: %s", model, text[:160])
    if resp is None:
        raise GeminiUnavailable("; ".join(errors)[:300])
    parsed = resp.parsed
    if isinstance(parsed, schema):
        return parsed
    try:
        return schema.model_validate_json(resp.text or "")
    except Exception as exc:
        raise GeminiUnavailable(f"Gemini returned output that does not match {schema.__name__}") from exc


def embed(texts: List[str], task_type: str) -> List[List[float]]:
    """Gemini embeddings (gemini-embedding-001), truncated to EMBEDDING_DIM with Matryoshka output
    dimensionality. task_type: RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY or SEMANTIC_SIMILARITY."""
    from google.genai import types

    out: List[List[float]] = []
    try:
        for i in range(0, len(texts), EMBED_BATCH):
            resp = client().models.embed_content(
                model=settings.GEMINI_EMBED_MODEL,
                contents=texts[i:i + EMBED_BATCH],
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=settings.EMBEDDING_DIM),
            )
            out.extend(list(e.values) for e in resp.embeddings)
    except GeminiUnavailable:
        raise
    except Exception as exc:
        raise GeminiUnavailable(f"{type(exc).__name__}: {str(exc)[:200]}") from exc
    if any(len(v) != settings.EMBEDDING_DIM for v in out):
        raise GeminiUnavailable(f"{settings.GEMINI_EMBED_MODEL} did not return {settings.EMBEDDING_DIM} dimensions")
    return out
