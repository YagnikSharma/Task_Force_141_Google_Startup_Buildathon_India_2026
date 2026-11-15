"""PostgreSQL (Cloud SQL) is the application's database: engine, sessions, startup and health status."""
import logging
from typing import Generator

from sqlalchemy.orm import Session


logger = logging.getLogger("neighbourhood_safety.database")

engine = None
SessionLocal = None


def get_db_status() -> dict:
    from backend.app.ai.retrieval import protocol_retriever
    from backend.app.ai.vector_store import vector_store
    from backend.app.database.postgres import make_engine, test_connection

    check = test_connection(engine if engine is not None else make_engine())
    return {
        "mode": "postgresql",
        "connected": check.get("connected", False),
        "driver": "psycopg",
        "details": check,
        "vector_search": vector_store.status(),
        "hybrid_retrieval": protocol_retriever.status(),
    }


def init_db() -> None:
    """Connect (fail fast if unreachable), create missing tables, seed demo data, then enable
    Gemini embeddings for incident similarity and hybrid protocol retrieval."""
    global engine, SessionLocal
    from backend.app.ai.retrieval import protocol_retriever
    from backend.app.ai.vector_store import vector_store
    from backend.app.database.postgres import get_session_factory, make_engine, test_connection

    probe = make_engine()
    verified = test_connection(probe)
    probe.dispose()
    if not verified.get("connected"):
        raise ConnectionError(f"PostgreSQL connection failed: {verified.get('error')}")
    engine, SessionLocal = get_session_factory()
    vector_store.initialise(engine)
    protocol_retriever.enable_vectors(engine)


def get_db() -> Generator[Session, None, None]:
    if SessionLocal is None:
        init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
