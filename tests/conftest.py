"""Integration test setup: every test runs against a real PostgreSQL + pgvector database and, for
Gemini features, the real Gemini API. Nothing is mocked.

Database defaults match the local container from the README (localhost:5433, user/db nsin); override
with DATABASE_URL or DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD.
Gemini tests run when GEMINI_API_KEY is set (in the environment or src/backend/.env) and are
skipped with a clear reason otherwise.
At the start of a run the application's tables are dropped and recreated, so results are repeatable.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest

SRC_DIR = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", "5433")
os.environ.setdefault("DB_NAME", "nsin")
os.environ.setdefault("DB_USER", "nsin")
os.environ.setdefault("DB_PASSWORD", "nsin-local-dev")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from backend.app.core.config import settings  # noqa: E402
from backend.app.database import base as db_base  # noqa: E402
from backend.app.database.postgres import make_engine  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models.entities import Base  # noqa: E402

DEMO_PASSWORD = "Password123!"

needs_gemini = pytest.mark.skipif(not settings.gemini_configured,
                                  reason="needs GEMINI_API_KEY (free key from Google AI Studio)")


def reset_database() -> None:
    engine = make_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    if os.environ.get("NSIN_KEEP_DB") != "1":
        reset_database()
    db_base.init_db()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def auth_headers(client, email: str, password: str = DEMO_PASSWORD) -> dict:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}.{uuid.uuid4().hex[:10]}@example.org"


@pytest.fixture
def resident(client):
    return auth_headers(client, "resident@neighbourhood.org")


@pytest.fixture
def responder(client):
    return auth_headers(client, "responder@neighbourhood.org")


@pytest.fixture
def admin(client):
    return auth_headers(client, "admin@neighbourhood.org")
