"""Hybrid retrieval of approved safety protocols: BM25 keywords + Gemini embeddings in pgvector.

Indexing
    protocols -> passages (60 words, 12 overlap, one row per audience)
              -> Gemini `gemini-embedding-001` (RETRIEVAL_DOCUMENT, 768 dims)
              -> PostgreSQL table protocol_passages (pgvector column, HNSW cosine index)
Query
    BM25 (in memory) ---------------------------------------\
    Gemini query embedding -> pgvector cosine distance (<=>) -> reciprocal rank fusion (+ category prior)

* Metadata filters (category, audience) apply to both branches.
* Passages are grouped back to their protocol, so every answer cites the exact passage that matched.
* Without Gemini (no key, quota, outage) the BM25 branch keeps answering on its own; /health says why.
"""
import logging
import os
import math
import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Engine

from backend.app.ai.protocols import APPROVED_CIVIC_SAFETY_DOCUMENTS
from backend.app.core.config import settings

logger = logging.getLogger("neighbourhood_safety.retrieval")

PASSAGE_TABLE = "protocol_passages"
# Cosine-distance gates for the dense branch, calibrated on the protocol passages with
# gemini-embedding-001 at 768 dims: on-topic questions put the right protocol first at <= 0.40,
# off-topic questions start at >= 0.46 (see docs/AI_DESIGN.md). Override with env vars if you change model.
STRONG_MATCH = float(os.getenv("RETRIEVAL_STRONG_MATCH", "0.40"))
MAX_DISTANCE = float(os.getenv("RETRIEVAL_MAX_DISTANCE", "0.43"))
MIN_MARGIN = 0.02  # passages within this distance of the best one also count as vector hits
RRF_K = 61

PROTOCOL_AUDIENCE = {
    "emergency_response": ["residents", "responders"],
    "child_safety": ["guardians", "responders"],
    "elder_care": ["seniors", "caregivers", "responders"],
    "hazard_mitigation": ["residents", "responders"],
    "transit_safety": ["women", "residents"],
    "responder_procedures": ["responders"],
}
INCIDENT_TO_PROTOCOL_CATEGORY = {
    "sos": "emergency_response",
    "medical": "emergency_response",
    "child_alert": "child_safety",
    "elder_welfare": "elder_care",
    "hazard": "hazard_mitigation",
    "suspicious_activity": "transit_safety",
}
CATEGORY_PRIOR_VOTES = 0.5  # worth half of a first-place vote in the fused ranking

_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "up", "about", "into", "over", "after", "is", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "do", "does", "did", "what", "how", "should", "when", "where", "who", "which", "can",
    "my", "i",
}


def _keywords(value: str) -> set:
    return {w for w in re.findall(r"\b[a-zA-Z0-9_-]{2,}\b", value.lower()) if w not in _STOPWORDS}


def _tokens(value: str) -> List[str]:
    return re.findall(r"(?u)\b\w\w+\b", value.lower())


def build_filters(category: Optional[str] = None, audience: Optional[str] = None) -> Optional[Dict[str, str]]:
    filters = {k: v for k, v in (("category", category), ("audience", audience)) if v}
    return filters or None


def split_into_passages() -> List[Dict[str, Any]]:
    """Word windows of 60 with 12 overlap; one passage row per audience so filters are equality checks."""
    passages = []
    index = 0
    for doc in APPROVED_CIVIC_SAFETY_DOCUMENTS:
        words = f"{doc['title']}. {doc['content']}".split()
        start = 0
        while start < len(words):
            chunk = " ".join(words[start:start + 60])
            for audience in PROTOCOL_AUDIENCE.get(doc["category"], ["residents"]):
                passages.append({"id": f"{doc['id']}-{index:03d}-{audience}", "protocol_id": doc["id"],
                                 "title": doc["title"], "category": doc["category"], "audience": audience,
                                 "content": chunk})
            index += 1
            if start + 60 >= len(words):
                break
            start += 60 - 12
    return passages


class BM25:
    """Okapi BM25 (k1=1.5, b=0.75) over the passages."""

    def __init__(self, docs: List[Dict[str, Any]], k1: float = 1.5, b: float = 0.75) -> None:
        self.docs, self.k1, self.b = docs, k1, b
        self.tfs = [Counter(_tokens(d["content"])) for d in docs]
        self.lengths = [sum(tf.values()) for tf in self.tfs]
        self.avg_len = sum(self.lengths) / max(1, len(self.lengths))
        df = Counter(t for tf in self.tfs for t in tf)
        n = len(docs)
        idf = {t: math.log((n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        floor = 0.25 * (sum(idf.values()) / max(1, len(idf)))
        self.idf = {t: (v if v > 0 else floor) for t, v in idf.items()}

    def search(self, query: str, filters: Optional[Dict[str, str]], top_k: int = 12) -> List[Tuple[Dict[str, Any], float]]:
        q = _tokens(query)
        scored = []
        for doc, tf, length in zip(self.docs, self.tfs, self.lengths, strict=True):
            if filters and any(doc[k] != v for k, v in filters.items()):
                continue
            s = 0.0
            for t in q:
                if t in tf:
                    f = tf[t]
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * length / self.avg_len))
            if s > 0:
                scored.append((doc, s))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]


class SafetyProtocolRetriever:
    def __init__(self) -> None:
        self.protocols = {d["id"]: d for d in APPROVED_CIVIC_SAFETY_DOCUMENTS}
        self.passages = split_into_passages()
        self.bm25 = BM25(self.passages)
        self.engine: Optional[Engine] = None
        self.error: Optional[str] = None
        logger.info("BM25 index: %d passages from %d protocols.", len(self.passages), len(self.protocols))

    @property
    def hybrid(self) -> bool:
        return self.engine is not None

    def enable_vectors(self, engine: Engine) -> None:
        """Embed passages with Gemini into pgvector (only the ones not stored yet). Never raises:
        on failure the service keeps answering with BM25 alone and reports why in /health."""
        self.engine = None
        if not settings.ENABLE_VECTOR_SEARCH:
            self.error = "disabled by ENABLE_VECTOR_SEARCH"
            return
        try:
            from backend.app.ai import gemini

            with engine.connect() as conn:
                stored = {r[0] for r in conn.execute(text(f"SELECT id FROM {PASSAGE_TABLE}"))}  # nosec B608 - constant table name
            todo = [p for p in self.passages if p["id"] not in stored]
            if todo:
                vectors = gemini.embed([f"{p['title']}: {p['content']}" for p in todo], "RETRIEVAL_DOCUMENT")
                with engine.begin() as conn:
                    for p, v in zip(todo, vectors, strict=True):
                        conn.execute(text(
                            f"INSERT INTO {PASSAGE_TABLE} (id, protocol_id, category, audience, content, embedding) "  # nosec B608
                            "VALUES (:id, :protocol_id, :category, :audience, :content, CAST(:embedding AS vector))"),
                            {**{k: p[k] for k in ("id", "protocol_id", "category", "audience", "content")},
                             "embedding": str(v)})
            self.engine = engine
            self.error = None
            logger.info("Hybrid retrieval enabled: %d passages (%d newly embedded with %s).",
                        len(self.passages), len(todo), settings.GEMINI_EMBED_MODEL)
        except Exception as exc:
            self.error = str(exc)[:300]
            logger.warning("Vector retrieval unavailable, using BM25 only: %s", exc)

    def _dense(self, query: str, filters: Optional[Dict[str, str]], top_k: int = 12) -> List[Tuple[Dict[str, Any], float]]:
        from backend.app.ai import gemini

        vector = gemini.embed([query], "RETRIEVAL_QUERY")[0]
        where, params = "", {"q": str(vector), "k": top_k}
        if filters:
            where = "WHERE " + " AND ".join(f"{k} = :{k}" for k in filters)  # keys come from build_filters only
            params.update(filters)
        sql = (f"SELECT id, protocol_id, category, audience, content, embedding <=> CAST(:q AS vector) AS distance "  # nosec B608
               f"FROM {PASSAGE_TABLE} {where} ORDER BY distance LIMIT :k")
        with self.engine.connect() as conn:
            rows = conn.execute(text(sql), params).fetchall()
        return [({"id": r[0], "protocol_id": r[1], "category": r[2], "audience": r[3], "content": r[4]}, float(r[5]))
                for r in rows]

    @staticmethod
    def _best_per_protocol(hits: List[Tuple[Dict[str, Any], float]]) -> List[Tuple[Dict[str, Any], float]]:
        seen, best = set(), []
        for doc, score in hits:
            if doc["protocol_id"] not in seen:
                seen.add(doc["protocol_id"])
                best.append((doc, score))
        return best

    def query(self, query_text: str, category: Optional[str] = None, audience: Optional[str] = None,
              top_k: int = 3, prefer_category: Optional[str] = None) -> Dict[str, Any]:
        q_terms = _keywords(query_text)
        mode = "hybrid (BM25 + Gemini embeddings in pgvector)" if self.hybrid else "BM25"
        if not q_terms:
            return {"results": [], "found": False, "retrieval_mode": mode,
                    "message": "Query was empty or contained no searchable keywords."}
        filters = build_filters(category, audience)

        bm25_hits = self._best_per_protocol(
            [(d, s) for d, s in self.bm25.search(query_text, filters) if q_terms & _keywords(d["content"])])
        dense_hits: List[Tuple[Dict[str, Any], float]] = []
        if self.hybrid:
            try:
                dense_hits = self._best_per_protocol(self._dense(query_text, filters))
            except Exception as exc:  # Gemini quota or outage: answer with keywords only
                logger.warning("Dense retrieval failed, BM25 only for this query: %s", exc)
                mode = "BM25 (Gemini embeddings unavailable for this query)"
        if dense_hits:
            best = dense_hits[0][1]
            margin = dense_hits[1][1] - best if len(dense_hits) > 1 else 1.0
            if not (best <= STRONG_MATCH or (best <= MAX_DISTANCE and margin >= MIN_MARGIN)):
                dense_hits = []
            dense_hits = [(d, s) for d, s in dense_hits if s <= best + MIN_MARGIN]

        ranked_lists = [h for h in (bm25_hits, dense_hits) if h]
        fused: Dict[str, float] = defaultdict(float)
        passage: Dict[str, Dict[str, Any]] = {}
        matched: Dict[str, List[str]] = defaultdict(list)
        distances: Dict[str, float] = {}
        for label, hits in (("bm25", bm25_hits), ("vector", dense_hits)):
            for rank, (d, score) in enumerate(hits):
                pid = d["protocol_id"]
                # Normalised RRF: a first place in one list is worth 1/len(lists).
                fused[pid] += (RRF_K / (RRF_K + rank)) / len(ranked_lists)
                matched[pid].append(label)
                passage.setdefault(pid, d)
                if label == "vector":
                    distances[pid] = score
        if prefer_category and ranked_lists:
            prior = CATEGORY_PRIOR_VOTES / len(ranked_lists)
            for pid in fused:
                if self.protocols[pid]["category"] == prefer_category:
                    fused[pid] += prior

        if not fused:
            return {"results": [], "found": False, "retrieval_mode": mode, "query": query_text, "filters": filters,
                    "message": "No approved safety protocol matched the query. Please consult on-duty responders."}

        results = []
        for pid in sorted(fused, key=fused.get, reverse=True)[:top_k]:
            proto = self.protocols[pid]
            results.append({
                "document_id": pid,
                "title": proto["title"],
                "category": proto["category"],
                "audience": PROTOCOL_AUDIENCE.get(proto["category"], []),
                "excerpt": proto["content"],
                "cited_passage": passage[pid]["content"],
                "source": proto["source"],
                "updated_at": proto["updated_at"],
                "relevance_score": round(fused[pid], 4),
                "matched_by": "+".join(matched[pid]),
                "vector_distance": round(distances[pid], 4) if pid in distances else None,
            })
        return {"results": results, "found": True, "count": len(results), "retrieval_mode": mode,
                "filters": filters, "top_source": results[0]["source"], "query": query_text}

    def status(self) -> Dict[str, Any]:
        return {"hybrid": self.hybrid, "passages": len(self.passages),
                "table": PASSAGE_TABLE if self.hybrid else None,
                "embedding_model": settings.GEMINI_EMBED_MODEL if self.hybrid else None,
                "reason": None if self.hybrid else (self.error or "not initialised")}


protocol_retriever = SafetyProtocolRetriever()


def retrieve_safety_guidance(query: str, category: Optional[str] = None, incident_type: Optional[str] = None,
                             audience: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve cited protocols. ``category``/``audience`` are hard filters; ``incident_type``
    (from triage) is a soft ranking prior."""
    return protocol_retriever.query(query_text=query, category=category, audience=audience,
                                    prefer_category=INCIDENT_TO_PROTOCOL_CATEGORY.get(incident_type or ""))
