import os
from pathlib import Path
from typing import List

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def _load_env_file(path: Path) -> None:
    """Load KEY=VALUE pairs from a .env file without overriding real environment variables."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"").strip("'"))


_load_env_file(BASE_DIR / ".env")

DEV_JWT_SECRET = "local-development-only-jwt-secret-change-me"  # nosec B105 - dev default; refused when APP_ENV=production


def _flag(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "yes")


class Settings:
    PROJECT_NAME: str = "Neighbourhood Safety Intelligence Network"
    VERSION: str = "2.0.0"
    API_V1_PREFIX: str = "/api/v1"

    APP_ENV: str = os.getenv("APP_ENV", "development")

    # PostgreSQL + pgvector: Cloud SQL for PostgreSQL in production, a local container in development.
    # DATABASE_URL wins if set; otherwise the URL is built from the parts below. On Cloud Run, set
    # INSTANCE_CONNECTION_NAME (project:region:instance) to connect through the Cloud SQL unix socket.
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "5432"))
    DB_NAME: str = os.getenv("DB_NAME", "nsin")
    DB_USER: str = os.getenv("DB_USER", "nsin")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    INSTANCE_CONNECTION_NAME: str = os.getenv("INSTANCE_CONNECTION_NAME", "")

    # JWT & Auth
    JWT_SECRET: str = os.getenv("JWT_SECRET", DEV_JWT_SECRET)
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # CORS
    CORS_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ]

    # Google Gemini. Use an API key from Google AI Studio (GEMINI_API_KEY), or Vertex AI on Google
    # Cloud with the service account of the Cloud Run service (GOOGLE_GENAI_USE_VERTEXAI=true).
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    GOOGLE_GENAI_USE_VERTEXAI: bool = _flag("GOOGLE_GENAI_USE_VERTEXAI", "false")
    GOOGLE_CLOUD_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    GOOGLE_CLOUD_LOCATION: str = os.getenv("GOOGLE_CLOUD_LOCATION", "asia-south1")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    # Tried in order when the primary model is overloaded (503) or retired (404).
    GEMINI_FALLBACK_MODELS: List[str] = [m.strip() for m in os.getenv(
        "GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.1-flash-lite").split(",") if m.strip()]
    GEMINI_EMBED_MODEL: str = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")
    EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "768"))
    GEMINI_TIMEOUT_SECONDS: int = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "12"))  # per request
    # Total time Gemini may add to one triage or briefing before the rule result is returned alone.
    GEMINI_BUDGET_SECONDS: float = float(os.getenv("GEMINI_BUDGET_SECONDS", "20"))
    # Cost guards. Output tokens include the model's thinking tokens, so leave headroom over the ~400
    # tokens a triage answer needs. The cache reuses identical answers for an hour.
    GEMINI_MAX_OUTPUT_TOKENS: int = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "2048"))
    GEMINI_CACHE_SECONDS: int = int(os.getenv("GEMINI_CACHE_SECONDS", "3600"))
    ENABLE_GEMINI_TRIAGE: bool = _flag("ENABLE_GEMINI_TRIAGE")
    ENABLE_VECTOR_SEARCH: bool = _flag("ENABLE_VECTOR_SEARCH")
    ENABLE_LLM_BRIEFING: bool = _flag("ENABLE_LLM_BRIEFING")

    # Login throttling (per client IP + email)
    # Live map. Demo mode lets staff dispatch a simulated responder so a judge can watch one move.
    MAP_CITY: str = os.getenv("MAP_CITY", "Lucknow")
    MAP_CENTER: List[float] = [float(v) for v in os.getenv("MAP_CENTER", "26.8560,80.9800").split(",")]
    DEMO_MODE: bool = _flag("DEMO_MODE")
    RESPONDER_PING_TTL_SECONDS: int = int(os.getenv("RESPONDER_PING_TTL_SECONDS", "900"))

    LOGIN_MAX_ATTEMPTS: int = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
    LOGIN_WINDOW_SECONDS: int = int(os.getenv("LOGIN_WINDOW_SECONDS", "300"))

    @property
    def gemini_models(self) -> List[str]:
        return [self.GEMINI_MODEL] + [m for m in self.GEMINI_FALLBACK_MODELS if m != self.GEMINI_MODEL]

    @property
    def gemini_configured(self) -> bool:
        return bool(self.GEMINI_API_KEY) or (self.GOOGLE_GENAI_USE_VERTEXAI and bool(self.GOOGLE_CLOUD_PROJECT))


def _validate(s: "Settings") -> None:
    """Refuse to run a production deployment with development-grade secrets."""
    if s.APP_ENV.lower() == "production":
        if s.JWT_SECRET == DEV_JWT_SECRET or len(s.JWT_SECRET) < 32:
            raise RuntimeError("JWT_SECRET must be set to a random value of at least 32 characters when APP_ENV=production.")
        if "*" in s.CORS_ORIGINS:
            raise RuntimeError("CORS_ORIGINS must list explicit origins when APP_ENV=production.")


settings = Settings()
_validate(settings)
