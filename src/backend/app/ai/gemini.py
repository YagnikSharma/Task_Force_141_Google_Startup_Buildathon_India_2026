"""Thin wrapper around the Google Gen AI SDK (`google-genai`).

One client serves both back ends:
  * Gemini Developer API with a key from Google AI Studio (GEMINI_API_KEY) - local development;
  * Vertex AI on Google Cloud (GOOGLE_GENAI_USE_VERTEXAI=true) - Cloud Run, using the service
    account, so no key is stored in production.

Every caller treats Gemini as optional: if it is not configured or a call fails, the caller falls
back to the deterministic rule-based path, so an SOS is never blocked by the model.
"""
import hashlib
import logging
import threading
import time
from collections import OrderedDict
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
MIN_DEADLINE_SECONDS = 10.0  # smallest per-request deadline the Gemini API accepts
OVERLOAD_COOLDOWN_SECONDS = 30  # 503 high demand / 504: let the next model have the time budget


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
                                           http_status_codes=[500, 502, 503])  # 504 = slow: move to the next model instead
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


# Cost guard: identical requests within GEMINI_CACHE_SECONDS reuse the earlier answer, so reloading a
# page or re-running the same demo report does not spend quota twice. Small, in-process, per instance.
_cache: "OrderedDict[tuple, tuple]" = OrderedDict()
_CACHE_MAX = 256


def generate_json(prompt: str, schema: Type[T], system: str, temperature: float = 0.1) -> T:
    """generate_json with a short-lived response cache (see _cache)."""
    key = (schema.__name__, hashlib.sha256(f"{system}|{prompt}|{temperature}".encode()).hexdigest())
    ttl = settings.GEMINI_CACHE_SECONDS
    if ttl > 0:
        with _lock:
            hit = _cache.get(key)
            if hit and hit[0] > time.time():
                _cache.move_to_end(key)
                last_model_used.value = hit[2]
                return schema.model_validate(hit[1])
    result = _generate_json_uncached(prompt, schema, system, temperature)
    if ttl > 0:
        with _lock:
            _cache[key] = (time.time() + ttl, result.model_dump(), getattr(last_model_used, "value", None))
            while len(_cache) > _CACHE_MAX:
                _cache.popitem(last=False)
    return result


def generate_with_fallback(contents, make_config, budget_seconds: Optional[float] = None):
    """Call generate_content on GEMINI_MODEL, then each fallback model, inside one time budget.

    ``make_config(timeout_ms)`` builds the GenerateContentConfig for one attempt. A model that
    reports exhausted quota (429) or retirement (404) is skipped for a while instead of being
    retried. This is the only retry policy in the app (no retry loops: cost guard)."""
    started = time.monotonic()
    budget = settings.GEMINI_BUDGET_SECONDS if budget_seconds is None else budget_seconds
    errors: List[str] = []
    for model in settings.gemini_models:
        if _cooldown.get(model, 0) > time.time():
            errors.append(f"{model}: cooling down after quota/retirement error")
            continue
        remaining = budget - (time.monotonic() - started)
        if remaining < MIN_DEADLINE_SECONDS:  # the API rejects deadlines under 10 s (400 INVALID_ARGUMENT)
            errors.append("time budget used up")
            break
        timeout = min(remaining, settings.GEMINI_TIMEOUT_SECONDS)
        if remaining - timeout < MIN_DEADLINE_SECONDS <= remaining - MIN_DEADLINE_SECONDS:
            timeout = remaining - MIN_DEADLINE_SECONDS  # leave room for one fallback model
        config = make_config(int(max(timeout, MIN_DEADLINE_SECONDS) * 1000))
        try:
            resp = client().models.generate_content(model=model, contents=contents, config=config)
            last_model_used.value = model
            return resp
        except GeminiUnavailable:
            raise
        except Exception as exc:
            text = str(exc)
            if text.startswith("429") or "RESOURCE_EXHAUSTED" in text:
                _cooldown[model] = time.time() + QUOTA_COOLDOWN_SECONDS
            elif "NOT_FOUND" in text or "no longer available" in text:
                _cooldown[model] = time.time() + RETIRED_COOLDOWN_SECONDS
            elif text.startswith(("503", "504")) or "UNAVAILABLE" in text or "DEADLINE_EXCEEDED" in text:
                _cooldown[model] = time.time() + OVERLOAD_COOLDOWN_SECONDS
            errors.append(f"{model}: {type(exc).__name__}: {text[:120]}")
            logger.info("Gemini model %s unavailable: %s", model, text[:160])
    raise GeminiUnavailable("; ".join(errors)[:300] or "no Gemini model available")


def _generate_json_uncached(prompt, schema: Type[T], system: str, temperature: float = 0.1) -> T:
    """Structured output: Gemini returns JSON that is validated against the Pydantic `schema`.
    Uses the model fallback chain and time budget of generate_with_fallback."""
    from google.genai import types

    def make_config(timeout_ms: int):
        return types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=settings.GEMINI_MAX_OUTPUT_TOKENS,  # cost guard: no runaway answers
            response_mime_type="application/json",
            response_schema=schema,
            http_options=types.HttpOptions(timeout=timeout_ms),
        )

    resp = generate_with_fallback(prompt, make_config)
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
