"""Protocol retrieval: metadata filtering, passage citations and the guidance API.
Runs in BM25-only mode without Gemini and in hybrid mode (BM25 + Gemini embeddings in pgvector) with it."""
import pytest

from backend.app.ai.retrieval import BM25, build_filters, protocol_retriever, retrieve_safety_guidance, split_into_passages

API = "/api/v1"


def test_build_filters_combines_conditions():
    assert build_filters() is None
    assert build_filters(category="elder_care") == {"category": "elder_care"}
    assert build_filters(category="elder_care", audience="seniors") == {"category": "elder_care", "audience": "seniors"}


def test_category_filter_restricts_results():
    res = retrieve_safety_guidance("emergency help procedure for residents", category="elder_care")
    assert all(r["category"] == "elder_care" for r in res["results"])


def test_audience_filter_restricts_results():
    res = retrieve_safety_guidance("safety at night when walking alone", audience="responders")
    assert all("responders" in r["audience"] for r in res["results"])
    women = retrieve_safety_guidance("safe transit corridor for women at night", audience="women")
    assert women["found"] and women["results"][0]["document_id"] == "DOC-WOMEN-005"


def test_results_cite_the_matching_passage():
    res = retrieve_safety_guidance("child journey delay escalation for guardians")
    top = res["results"][0]
    assert top["document_id"] == "DOC-CHILD-002"
    assert top["cited_passage"] and top["cited_passage"] in protocol_retriever.protocols["DOC-CHILD-002"]["title"] + ". " \
        + protocol_retriever.protocols["DOC-CHILD-002"]["content"]


def test_empty_or_stopword_queries_return_nothing():
    assert not retrieve_safety_guidance("the and of")["found"]


def test_guidance_api_validates_filters(client, resident):
    ok = client.get(f"{API}/ai/guidance", params={"query": "elderly wellness check", "audience": "seniors"}, headers=resident)
    assert ok.status_code == 200 and ok.json()["results"][0]["category"] == "elder_care"
    bad = client.get(f"{API}/ai/guidance", params={"query": "anything here", "audience": "aliens"}, headers=resident)
    assert bad.status_code == 422


def test_passages_overlap_and_carry_one_audience_each():
    passages = split_into_passages()
    assert len({p["protocol_id"] for p in passages}) == len(protocol_retriever.protocols)
    assert all(len(p["content"].split()) <= 60 for p in passages)
    assert len({p["id"] for p in passages}) == len(passages)


def test_bm25_ranks_matching_passage_first_and_honours_filters():
    bm25 = BM25(split_into_passages())
    top = bm25.search("broken streetlights and waterlogging", None)[0][0]
    assert top["protocol_id"] == "DOC-HAZARD-004"
    assert all(d["audience"] == "women" for d, _ in bm25.search("night walk", {"audience": "women"}))


def test_hybrid_status_reports_pgvector_table():
    if not protocol_retriever.hybrid:  # decided at startup, after test collection
        pytest.skip("hybrid retrieval needs GEMINI_API_KEY")
    status = protocol_retriever.status()
    assert status["hybrid"] and status["table"] == "protocol_passages" and status["passages"] > 6
