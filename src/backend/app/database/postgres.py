"""PostgreSQL + pgvector access (Cloud SQL for PostgreSQL in production).

* Locally: a `pgvector/pgvector` container (see docker-compose.yml).
* On Cloud Run: Cloud SQL through its unix socket, /cloudsql/<INSTANCE_CONNECTION_NAME>.
"""
import logging
from typing import Any, Dict

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.orm import sessionmaker

from backend.app.core.config import settings

logger = logging.getLogger("neighbourhood_safety.postgres")


def database_url() -> URL:
    """SQLAlchemy URL for psycopg 3. URL.create escapes credentials, so passwords with @ : / ? are safe."""
    if settings.DATABASE_URL:
        url = make_url(settings.DATABASE_URL)
        return url.set(drivername="postgresql+psycopg") if url.drivername in ("postgres", "postgresql") else url
    if settings.INSTANCE_CONNECTION_NAME:
        return URL.create("postgresql+psycopg", username=settings.DB_USER, password=settings.DB_PASSWORD,
                          database=settings.DB_NAME,
                          query={"host": f"/cloudsql/{settings.INSTANCE_CONNECTION_NAME}"})
    return URL.create("postgresql+psycopg", username=settings.DB_USER, password=settings.DB_PASSWORD,
                      host=settings.DB_HOST, port=settings.DB_PORT, database=settings.DB_NAME)


def make_engine() -> Engine:
    return create_engine(database_url(), pool_pre_ping=True, pool_size=5, max_overflow=10)


def test_connection(engine: Engine) -> Dict[str, Any]:
    """Read server time, version and whether pgvector is installed. Never raises."""
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT now(), version(), current_database()")).first()
            vector = conn.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).scalar()
        return {
            "connected": True,
            "server_time": str(row[0]),
            "server_version": str(row[1]).split(" on ")[0],
            "database": row[2],
            "pgvector": vector,
            "cloud_sql_socket": bool(settings.INSTANCE_CONNECTION_NAME),
        }
    except Exception as exc:
        logger.error("PostgreSQL connection test failed: %s", exc)
        return {"connected": False, "error": str(exc).splitlines()[0][:300]}


def get_session_factory():
    """Engine and session factory. Enables pgvector, creates missing tables and seeds demo data."""
    from backend.app.database.seed import seed_data
    from backend.app.models.entities import Base

    engine = make_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        seed_data(session)
    finally:
        session.close()
    return engine, SessionLocal
