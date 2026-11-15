"""Related-incident search: Gemini embeddings stored in PostgreSQL with pgvector.

Every incident is embedded with `gemini-embedding-001` (SEMANTIC_SIMILARITY, 768 dims) into the
table incident_embeddings. Responders get related reports, for example several residents reporting
the same broken streetlight, ranked by pgvector cosine distance (<=>) on an HNSW index.
"""
import logging
import os
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.engine import Engine

from backend.app.core.config import settings

logger = logging.getLogger("neighbourhood_safety.vectors")

# Calibrated with gemini-embedding-001 (768 dims, SEMANTIC_SIMILARITY): two reports of the same
# event sit below this cosine distance; different kinds of incidents sit above it.
SIMILAR_INCIDENT_MAX_DISTANCE = float(os.getenv("SIMILAR_INCIDENT_MAX_DISTANCE", "0.20"))


@dataclass
class VectorHit:
    key: str
    distance: float


def _document(title: str, description: str) -> str:
    return f"{title}. {description}"


class IncidentVectorStore:
    def __init__(self) -> None:
        self.engine: Optional[Engine] = None
        self._lock = threading.Lock()
        self.enabled = False
        self.error: Optional[str] = None

    def initialise(self, engine: Engine) -> None:
        """Embed incidents that have no vector yet. Never raises: without Gemini the rest of the
        app keeps working and /health reports why."""
        self.enabled = False
        if not settings.ENABLE_VECTOR_SEARCH:
            self.error = "disabled by ENABLE_VECTOR_SEARCH"
            return
        try:
            from backend.app.ai import gemini

            gemini.client()  # raises GeminiUnavailable when no key / project is configured
            self.engine = engine
            backfilled = self._backfill_incidents()
            self.enabled = True
            self.error = None
            logger.info("Related-incident search enabled (%s, pgvector); embedded %d incident(s).",
                        settings.GEMINI_EMBED_MODEL, backfilled)
        except Exception as exc:
            self.error = str(exc)[:300]
            logger.warning("Related-incident search unavailable: %s", exc)

    def _backfill_incidents(self) -> int:
        from backend.app.ai import gemini

        with self.engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT i.id, i.title, i.description FROM incidents i "
                "LEFT JOIN incident_embeddings e ON e.incident_id = i.id "
                "WHERE e.incident_id IS NULL ORDER BY i.id LIMIT 500")).fetchall()
        if rows:
            vectors = gemini.embed([_document(r[1], r[2]) for r in rows], "SEMANTIC_SIMILARITY")
            with self.engine.begin() as conn:
                for r, v in zip(rows, vectors, strict=True):
                    self._upsert(conn, int(r[0]), v)
        return len(rows)

    @staticmethod
    def _upsert(conn, incident_id: int, vector: List[float]) -> None:
        conn.execute(text(
            "INSERT INTO incident_embeddings (incident_id, model, embedding) "
            "VALUES (:i, :m, CAST(:v AS vector)) "
            "ON CONFLICT (incident_id) DO UPDATE SET model = EXCLUDED.model, embedding = EXCLUDED.embedding"),
            {"i": incident_id, "m": settings.GEMINI_EMBED_MODEL, "v": str(vector)})

    def index_incident(self, incident_id: int, title: str, description: str) -> bool:
        if not self.enabled:
            return False
        try:
            from backend.app.ai import gemini

            vector = gemini.embed([_document(title, description)], "SEMANTIC_SIMILARITY")[0]
            with self._lock, self.engine.begin() as conn:
                self._upsert(conn, int(incident_id), vector)
            return True
        except Exception as exc:  # embedding must never block an emergency report
            logger.warning("Could not index incident %s for similarity search: %s", incident_id, exc)
            return False

    def similar_incidents(self, incident_id: int, k: int = 5) -> List[VectorHit]:
        if not self.enabled:
            return []
        with self.engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT e.incident_id, e.embedding <=> src.embedding AS distance "
                "FROM incident_embeddings e, incident_embeddings src "
                "WHERE src.incident_id = :i AND e.incident_id <> :i "
                "ORDER BY distance LIMIT :k"), {"i": int(incident_id), "k": max(1, min(int(k), 20))}).fetchall()
        return [VectorHit(str(r[0]), float(r[1])) for r in rows if float(r[1]) <= SIMILAR_INCIDENT_MAX_DISTANCE]

    def status(self) -> Dict[str, object]:
        return {
            "enabled": self.enabled,
            "library": "pgvector (HNSW, cosine)" if self.enabled else None,
            "model": settings.GEMINI_EMBED_MODEL if self.enabled else None,
            "dimensions": settings.EMBEDDING_DIM if self.enabled else None,
            "reason": None if self.enabled else (self.error or "not initialised"),
        }


vector_store = IncidentVectorStore()
