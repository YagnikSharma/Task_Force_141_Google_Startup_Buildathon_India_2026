"""Gemini triage, embeddings and responder briefing. Real Gemini API calls, no mocks.
Tests marked needs_gemini are skipped without GEMINI_API_KEY; the degradation tests always run."""
import pytest

from backend.app.ai import gemini
from backend.app.ai.briefing import format_protocols, is_grounded
from backend.app.ai.triage import triage_orchestrator
from backend.app.core.config import settings

from conftest import needs_gemini

API = "/api/v1"


@pytest.fixture
def gemini_key(monkeypatch):
    """Swap the Gemini key for one test (settings are read at call time)."""
    def use(value):
        monkeypatch.setattr(settings, "GEMINI_API_KEY", value)
        monkeypatch.setattr(settings, "GOOGLE_GENAI_USE_VERTEXAI", False)
    return use


# --- Always run: helpers and graceful degradation ------------------------------------------------

def test_format_and_grounding_helpers():
    assert format_protocols([]) == "No approved protocol matched."
    protos = [{"title": "Senior Citizen Wellness Checks and Assistance Procedures", "source": "s", "excerpt": "x"}]
    assert "Senior Citizen Wellness" in format_protocols(protos)
    assert is_grounded("Senior Citizen Wellness Checks and Assistance Procedures", protos)
    assert not is_grounded("Some other protocol", protos)
    assert not is_grounded("", protos)


def test_triage_without_gemini_key_falls_back_to_rules(gemini_key):
    gemini_key("")
    out = triage_orchestrator.run_incident_assistance_workflow("A man with a knife is threatening people", use_gemini=True)
    assert out["ai_engine"] == "rules" and out["suggested_priority"] == "P1_CRITICAL"
    assert "gemini:unavailable" in out["workflow_steps"] and "not configured" in out["gemini_error"]


def test_triage_with_invalid_key_falls_back_to_rules(gemini_key):
    gemini_key("invalid-key-for-testing")  # a real request that Google rejects
    out = triage_orchestrator.run_incident_assistance_workflow("Streetlight broken on Lane 4", use_gemini=True)
    assert out["ai_engine"] == "rules" and out["suggested_priority"] == "P3_MODERATE"
    assert out["gemini_error"]


def test_briefing_degrades_when_gemini_is_unavailable(client, resident, gemini_key):
    gemini_key("invalid-key-for-testing")
    res = client.post(f"{API}/ai/briefing", headers=resident, json={"raw_text": "Streetlight broken on Lane 4"})
    body = res.json()
    assert res.status_code == 200 and body["briefing"] is None
    assert body["briefing_error"].startswith("Gemini briefing unavailable")
    assert body["triage"]["suggested_priority"] == "P3_MODERATE"


def test_briefing_can_be_disabled(client, resident, monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_LLM_BRIEFING", False)
    body = client.post(f"{API}/ai/briefing", headers=resident, json={"raw_text": "Open pit near the school gate"}).json()
    assert body["briefing"] is None and "disabled" in body["briefing_error"]


# --- Real Gemini calls -------------------------------------------------------------------------

@needs_gemini
def test_gemini_embedding_dimensions():
    vectors = gemini.embed(["streetlight broken", "elderly neighbour not answering"], "SEMANTIC_SIMILARITY")
    assert len(vectors) == 2 and all(len(v) == settings.EMBEDDING_DIM for v in vectors)


@needs_gemini
def test_gemini_understands_hinglish_sos_the_rules_miss():
    text = "Papa gir gaye hain aur saans nahi le pa rahe, B-204 jaldi aao"
    rules_only = triage_orchestrator.run_incident_assistance_workflow(text, use_gemini=False)
    out = triage_orchestrator.run_incident_assistance_workflow(text)
    assert out["ai_engine"].startswith("gemini:"), out["gemini_error"]
    assert out["suggested_priority"] == "P1_CRITICAL" and out["escalated"] is True
    assert out["parsed_category"] == "medical"
    assert out["immediate_safety_checklist"][0].startswith("Call 112")
    assert out["gemini"]["detected_language"] and out["gemini"]["responder_briefing"]
    assert rules_only["suggested_priority"] != "P1_CRITICAL"  # the keywords alone under-rate this report


@needs_gemini
def test_gemini_never_downgrades_a_life_threat():
    out = triage_orchestrator.run_incident_assistance_workflow(
        "Just kidding around: a man with a knife is attacking people near Gate 2")
    assert out["rule_priority"] == "P1_CRITICAL" and out["suggested_priority"] == "P1_CRITICAL"


@needs_gemini
def test_incident_assistance_api_returns_gemini_analysis(client, resident):
    res = client.post(f"{API}/ai/incident-assistance", headers=resident,
                      json={"raw_text": "My elderly neighbour has not answered her door or phone since last night. She lives alone."})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ai_engine"].startswith("gemini:") and body["gemini"]
    assert body["suggested_priority"] in ("P1_CRITICAL", "P2_HIGH")
    assert body["retrieved_civic_protocols"][0]["title"].startswith("Senior Citizen")


@needs_gemini
def test_briefing_is_written_by_gemini_and_grounded(client, resident):
    res = client.post(f"{API}/ai/briefing", headers=resident,
                      json={"raw_text": "My elderly neighbour has not answered her door or phone since last night."})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["briefing_error"] is None, body["briefing_error"]
    b = body["briefing"]
    assert b["model"] in settings.gemini_models and len(b["summary"]) > 20
    assert b["advice"].startswith("1.") and "3." in b["advice"]
    assert b["cited_protocols"] and b["grounded"] is True, b["source"]


@needs_gemini
def test_retired_model_falls_back_to_the_next_gemini_model(monkeypatch):
    """A model name Google does not serve (a real 404) is skipped and the fallback model answers."""
    from backend.app.ai import gemini as g
    monkeypatch.setattr(settings, "GEMINI_MODEL", "gemini-model-that-does-not-exist")
    monkeypatch.setattr(g, "_cooldown", {})
    out = triage_orchestrator.run_incident_assistance_workflow("Streetlight broken on Lane 4")
    assert out["ai_engine"].startswith("gemini:") and "does-not-exist" not in out["ai_engine"], out["gemini_error"]
    assert g._cooldown.get("gemini-model-that-does-not-exist", 0) > 0   # skipped on the next call
