"""Analytics, schema, pgvector and least-privilege checks on a real PostgreSQL database.
Semantic tests also call the real Gemini API (skipped without GEMINI_API_KEY)."""
import datetime
import uuid

import pytest
from sqlalchemy import text

from backend.app.ai.retrieval import retrieve_safety_guidance
from backend.app.ai.vector_store import vector_store
from backend.app.analytics import insights as analytics
from backend.app.database import base as db_base
from backend.app.models.entities import Incident, IncidentStatusHistory

from conftest import auth_headers, needs_gemini

API = "/api/v1"


def _create(client, headers, **kw):
    body = {"title": "Streetlight out", "description": "Dark lane after sunset near the park.",
            "incident_type": "hazard", "priority": "P3_MODERATE", **kw}
    res = client.post(f"{API}/incidents", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _shift_times(incident_id: int, created_minutes_ago: float, ack_after_minutes=None):
    """Backdate an incident (and its acknowledgement) to build a deterministic timeline."""
    db = db_base.SessionLocal()
    try:
        inc = db.get(Incident, incident_id)
        created = datetime.datetime.utcnow() - datetime.timedelta(minutes=created_minutes_ago)
        inc.created_at = created
        for h in db.query(IncidentStatusHistory).filter(IncidentStatusHistory.incident_id == incident_id):
            if h.status == "reported":
                h.created_at = created
            elif h.status == "acknowledged" and ack_after_minutes is not None:
                h.created_at = created + datetime.timedelta(minutes=ack_after_minutes)
        db.commit()
    finally:
        db.close()


# --- Analytics --------------------------------------------------------------------------------

def test_insights_report_measured_response_times(client, resident, responder):
    inc = _create(client, resident, priority="P2_HIGH", location_address="Gate 3, Lotus Towers")
    assert client.post(f"{API}/incidents/{inc['id']}/acknowledge", headers=responder).status_code == 200
    _shift_times(inc["id"], created_minutes_ago=30, ack_after_minutes=6)

    data = client.get(f"{API}/community/insights", headers=resident).json()
    p2 = next(r for r in data["response_times"] if r["priority"] == "P2_HIGH")
    assert p2["acknowledged"] >= 1 and p2["avg_ack_minutes"] is not None
    assert data["average_response_time_minutes"] is not None
    assert p2["ack_target_minutes"] == 15
    assert data["analytics_engine"].startswith("PostgreSQL")


def test_hotspots_rank_repeated_locations_first(client, resident):
    current = client.get(f"{API}/community/insights", headers=resident).json()["hotspots"]
    needed = (current[0]["incidents"] if current else 0) + 1
    spot = f"Underpass {uuid.uuid4().hex[:6]}"
    for _ in range(needed):
        _create(client, resident, location_address=spot)
    hotspots = client.get(f"{API}/community/insights", headers=resident).json()["hotspots"]
    assert hotspots[0]["location"] == spot and hotspots[0]["rank"] == 1 and hotspots[0]["incidents"] == needed


def test_unacknowledged_critical_incident_counts_as_sla_breach(client, resident):
    before = client.get(f"{API}/community/insights", headers=resident).json()["sla_breaches"]
    inc = _create(client, resident, priority="P1_CRITICAL", incident_type="medical", title="Collapsed in lobby")
    _shift_times(inc["id"], created_minutes_ago=10)
    after = client.get(f"{API}/community/insights", headers=resident).json()["sla_breaches"]
    assert after == before + 1


def test_sql_analytics_compute_exact_median_and_p90(client, resident, responder):
    """Known timeline: 4 P4 incidents, 3 acknowledged after 2, 7 and 11 minutes, 1 unacknowledged.
    PostgreSQL must return median 7, PERCENTILE_CONT(0.9) = 7 + 0.8 * (11 - 7) = 10.2, average 6.67."""
    for minutes_ago, ack_after in ((50, 2), (40, 7), (35, 11), (20, None)):
        inc = _create(client, resident, priority="P4_ADVISORY", location_address="Parity Lane")
        # The rule floor files a hazard at P3 at least; staff lower it to P4 through the audited override.
        assert client.post(f"{API}/incidents/{inc['id']}/priority", headers=responder,
                           json={"priority": "P4_ADVISORY", "reason": "Advisory only, no risk on site."}).status_code == 200
        if ack_after is not None:
            client.post(f"{API}/incidents/{inc['id']}/acknowledge", headers=responder)
        _shift_times(inc["id"], minutes_ago, ack_after)

    now = datetime.datetime.utcnow()
    db = db_base.SessionLocal()
    try:
        m = analytics._sql_metrics(db, now - datetime.timedelta(days=analytics.WINDOW_DAYS), now)
    finally:
        db.close()
    p4 = next(p for p in m["priorities"] if p.priority == "P4_ADVISORY")
    assert (p4.incidents, p4.acknowledged) == (4, 3)
    assert p4.median_ack_minutes == 7.0
    assert abs(p4.p90_ack_minutes - 10.2) < 0.01
    assert abs(p4.avg_ack_minutes - 6.67) < 0.01


# --- Schema and pgvector ----------------------------------------------------------------------

def test_catalog_contains_schema_and_vector_columns():
    expected = {"users", "trusted_contacts", "responders", "incidents", "incident_status_history",
                "location_events", "child_journeys", "elder_checkins", "assistance_requests",
                "community_hazards", "ai_analysis_records", "audit_events",
                "protocol_passages", "incident_embeddings"}
    with db_base.engine.connect() as conn:
        tables = {r[0] for r in conn.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()"))}
        assert expected <= tables
        vectors = {(r[0], r[1]) for r in conn.execute(text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND udt_name = 'vector'"))}
        assert {("protocol_passages", "embedding"), ("incident_embeddings", "embedding")} <= vectors
        hnsw = {r[0] for r in conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%USING hnsw%'"))}
        assert {"ix_protocol_passages_embedding", "ix_incident_embeddings_embedding"} <= hnsw


def test_health_reports_live_postgres_with_pgvector(client):
    db = client.get("/health").json()["database"]
    assert db["mode"] == "postgresql" and db["connected"] is True
    assert db["details"]["server_version"].startswith("PostgreSQL") and db["details"]["pgvector"]


def test_pgvector_cosine_distance_is_exact():
    with db_base.engine.connect() as conn:
        same = conn.execute(text("SELECT '[1,0,0]'::vector <=> '[2,0,0]'::vector")).scalar()
        orthogonal = conn.execute(text("SELECT '[1,0,0]'::vector <=> '[0,1,0]'::vector")).scalar()
    assert abs(same) < 1e-9 and abs(orthogonal - 1.0) < 1e-9


# --- Semantic search with Gemini embeddings ----------------------------------------------------

@needs_gemini
def test_semantic_retrieval_finds_protocols_without_shared_keywords():
    assert vector_store.enabled, vector_store.error
    res = retrieve_safety_guidance("my grandmother is not answering her phone")
    assert res["found"] and res["retrieval_mode"].startswith("hybrid")
    assert res["results"][0]["document_id"] == "DOC-ELDER-003"
    assert "vector" in res["results"][0]["matched_by"]


@needs_gemini
def test_semantic_retrieval_rejects_off_topic_queries():
    assert not retrieve_safety_guidance("quantum astrophysics spaceship orbit")["found"]
    assert not retrieve_safety_guidance("what is the recipe for pasta")["found"]


@needs_gemini
def test_similar_incidents_link_duplicate_reports(client, resident, responder):
    tag = uuid.uuid4().hex[:5]
    place = f"Lane {tag}, Green Glen"
    a = _create(client, resident, title=f"Streetlight broken on Lane {tag}", location_address=place,
                description="The streetlight on our lane has stopped working and the road is completely dark at night.")
    b = _create(client, auth_headers(client, "maya.sen@neighbourhood.org"), title=f"Lane {tag} lamp not working",
                location_address=place,
                description="Street lamp on the lane is not working, the whole road is pitch dark after sunset.")
    unrelated = _create(client, resident, incident_type="medical", title="Neighbour fainted",
                        description="An elderly neighbour fainted in the lift and needs a doctor.")

    similar = client.get(f"{API}/incidents/{a['id']}/similar", headers=responder)
    assert similar.status_code == 200
    ids = [s["id"] for s in similar.json()]
    assert ids[0] == b["id"] and similar.json()[0]["same_location"] is True
    assert unrelated["id"] not in ids
    assert client.get(f"{API}/incidents/{a['id']}/similar", headers=resident).status_code == 403


# --- Least privilege (db/least_privilege.sql) ----------------------------------------------------

@pytest.fixture
def app_role_conn():
    """Run as the restricted application role defined in db/least_privilege.sql."""
    from pathlib import Path

    sql = (Path(__file__).resolve().parent.parent / "db" / "least_privilege.sql").read_text(encoding="utf-8")
    with db_base.engine.begin() as conn:
        conn.exec_driver_sql(sql)
    conn = db_base.engine.connect()
    conn.execute(text("SET ROLE nsin_app"))
    yield conn
    conn.rollback()
    conn.execute(text("RESET ROLE"))
    conn.close()


def test_app_role_can_read_and_write_data(app_role_conn):
    assert app_role_conn.execute(text("SELECT COUNT(*) FROM users")).scalar() > 0
    app_role_conn.execute(text("INSERT INTO audit_events (action, resource_type, timestamp) "
                               "VALUES ('role_probe', 'test', now())"))


@pytest.mark.parametrize("statement", [
    "CREATE TABLE nsin_probe (id INTEGER)",
    "DROP TABLE incidents",
    "ALTER TABLE incidents ADD COLUMN probe INTEGER",
    "UPDATE audit_events SET action = 'tampered'",
    "DELETE FROM audit_events",
])
def test_app_role_is_denied_ddl_and_audit_tampering(app_role_conn, statement):
    from sqlalchemy.exc import DBAPIError
    with pytest.raises(DBAPIError) as err:
        app_role_conn.execute(text(statement))
    assert "permission denied" in str(err.value) or "must be owner" in str(err.value), str(err.value)[:300]
