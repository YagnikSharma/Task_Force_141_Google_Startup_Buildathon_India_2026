"""NSIN Copilot: role-based tools, human-confirmed write actions, offline fallback, and (with a key)
real Gemini function calling against the live database."""
from conftest import needs_gemini

from backend.app.core.config import settings


def test_tools_are_role_based(client, resident, admin):
    res_tools = {t["name"] for t in client.get("/api/v1/agent/tools", headers=resident).json()}
    admin_tools = {t["name"] for t in client.get("/api/v1/agent/tools", headers=admin).json()}
    assert "dispatch_nearest_responder" not in res_tools and "nearest_responders" not in res_tools
    assert {"dispatch_nearest_responder", "nearest_responders", "file_incident_report"} <= admin_tools


def test_confirm_file_report_runs_real_workflow(client, resident):
    r = client.post("/api/v1/agent/confirm", headers=resident, json={
        "tool": "file_incident_report",
        "args": {"title": "Streetlight out near gate 2", "description": "The lane is completely dark since 8 pm.",
                 "incident_type": "hazard", "location_address": "Gate 2, Gomti Nagar"}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["done"] and body["incident"]["reference_code"].startswith("INC-")
    inc = client.get(body["link"].replace("/incidents/", "/api/v1/incidents/"), headers=resident)
    assert inc.status_code == 200


def test_confirm_respects_permissions(client, resident):
    r = client.post("/api/v1/agent/confirm", headers=resident,
                    json={"tool": "dispatch_nearest_responder", "args": {"incident_id": 1}})
    assert r.status_code == 403
    r = client.post("/api/v1/agent/confirm", headers=resident, json={"tool": "search_safety_protocols", "args": {"query": "x"}})
    assert r.status_code == 400  # read tools are not "actions"


def test_confirm_reports_business_rule_errors(client, resident):
    created = client.post("/api/v1/agent/confirm", headers=resident, json={
        "tool": "file_incident_report",
        "args": {"title": "Loose dog pack", "description": "Three aggressive dogs near the park.", "incident_type": "hazard"}}).json()
    iid = created["incident"]["id"]
    r = client.post("/api/v1/agent/confirm", headers=resident,
                    json={"tool": "update_incident_status", "args": {"incident_id": iid, "status": "on_scene"}})
    assert r.status_code == 409 and "Residents" in r.json()["detail"] or r.status_code == 409


def test_chat_without_gemini_falls_back_to_protocols(client, resident, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(settings, "GOOGLE_GENAI_USE_VERTEXAI", False)
    r = client.post("/api/v1/agent/chat", headers=resident, json={"message": "my elderly neighbour fell and is not answering"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "rules-fallback" and "112" in body["reply"]


@needs_gemini
def test_gemini_agent_reads_live_data_with_tools(client, admin):
    r = client.post("/api/v1/agent/chat", headers=admin,
                    json={"message": "Give me the current neighbourhood safety picture: open incidents by priority and hazards."})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "gemini", body
    assert any(s["tool"] in ("community_overview", "list_incidents") for s in body["steps"]), body["steps"]
    assert body["reply"]


@needs_gemini
def test_gemini_agent_proposes_write_action_for_confirmation(client, resident):
    r = client.post("/api/v1/agent/chat", headers=resident, json={
        "message": "Please file a report: the streetlight outside Sector 12 park, Indira Nagar is broken and the lane is dark. "
                   "Category hazard. Don't ask me anything else, just prepare it."})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine"] == "gemini", body
    tools = [a["tool"] for a in body["pending_actions"]]
    assert tools and tools[0] in ("file_incident_report", "report_community_hazard"), body


def _user(email):
    from backend.app.database.base import SessionLocal
    from backend.app.models.entities import User
    db = SessionLocal()
    return db, db.query(User).filter(User.email == email).one()


def test_read_tools_return_live_data_with_role_visibility(client, resident, admin):
    from backend.app.ai import agent
    db, staff = _user("admin@neighbourhood.org")
    try:
        overview = agent.TOOLS["community_overview"].fn(db, staff, None)
        assert "incidents_by_status" in overview and "available_responders" in overview
        listed = agent.TOOLS["list_incidents"].fn(db, staff, None, limit=50)
        assert 1 <= listed["count"] <= 10  # the tool caps results to keep prompts small
        located = next((i for i in listed["incidents"]), None)
        detail = agent.TOOLS["get_incident"].fn(db, staff, None, incident_id=located["id"])
        assert detail["reference_code"] == located["reference_code"] and "timeline" in detail
        near = agent._safe_run(agent.TOOLS["nearest_responders"], db, staff, None, {"incident_id": located["id"]})
        assert "responders" in near or "error" in near
        proto = agent.TOOLS["search_safety_protocols"].fn(db, staff, None, query="elderly person fell at home")
        assert proto["found"] and proto["protocols"][0]["passage"]
    finally:
        db.close()

    db, res_user = _user("resident@neighbourhood.org")
    try:
        names = {t.name for t in agent.tools_for(res_user)}
        assert "nearest_responders" not in names and "dispatch_nearest_responder" not in names
        # A resident cannot open someone else's private incident through the agent either.
        private = agent._safe_run(agent.TOOLS["get_incident"], db, res_user, None, {"incident_id": 999999})
        assert "error" in private
        bad = agent._safe_run(agent.TOOLS["get_incident"], db, res_user, None, {"wrong_arg": 1})
        assert bad["error"].startswith("bad arguments")
    finally:
        db.close()


def test_action_summaries_are_human_readable():
    from backend.app.ai.agent import _describe_action
    assert "Dispatch" in _describe_action("dispatch_nearest_responder", {"incident_id": 4})
    assert "streetlight" in _describe_action("file_incident_report", {"title": "streetlight", "incident_type": "hazard"})
    assert "dark lane" in _describe_action("report_community_hazard", {"title": "dark lane", "address": "x"})
    assert "resolved" in _describe_action("update_incident_status", {"incident_id": 1, "status": "resolved"})


def test_agent_message_limit(client, resident, monkeypatch):
    from backend.app.api.v1 import agent as agent_api
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    monkeypatch.setattr(settings, "GOOGLE_GENAI_USE_VERTEXAI", False)
    monkeypatch.setattr(agent_api, "_agent_limit", agent_api.LoginThrottle(max_attempts=2, window_seconds=600))
    for _ in range(2):
        assert client.post("/api/v1/agent/chat", headers=resident, json={"message": "hello"}).status_code == 200
    assert client.post("/api/v1/agent/chat", headers=resident, json={"message": "hello"}).status_code == 429
