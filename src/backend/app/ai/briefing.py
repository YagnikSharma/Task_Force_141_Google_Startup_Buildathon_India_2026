"""Responder briefing written by Gemini, grounded in the approved protocols (RAG).

Trust rules
  * The triage priority is decided before this step and is never changed here.
  * Gemini only sees the report and the retrieved protocol passages, and must name the protocol it
    used. The answer is checked: if the named protocol is not one of the retrieved ones, the
    briefing is marked ungrounded.
"""
import time
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.app.ai import gemini
from backend.app.ai.retrieval import retrieve_safety_guidance
from backend.app.core.config import settings

SYSTEM = (
    "You brief volunteer responders in a neighbourhood safety control room. Be calm, factual and brief. "
    "Use only the incident report and the approved protocol passages you are given. Never invent details."
)


class Briefing(BaseModel):
    summary: str = Field(description="Two short sentences: what happened and why it matters.")
    actions: List[str] = Field(description="Exactly three numbered next actions for the responder, from the protocols.")
    source_protocol: str = Field(description="Exact title of the protocol the actions come from.")


def format_protocols(results: List[Dict[str, Any]]) -> str:
    if not results:
        return "No approved protocol matched."
    return "\n".join(f"[{i}] {r['title']} ({r['source']}): {r.get('cited_passage') or r['excerpt'][:300]}"
                     for i, r in enumerate(results, start=1))


def is_grounded(source: str, protocols: List[Dict[str, Any]]) -> bool:
    lowered = source.lower().strip()
    return bool(lowered) and any(p["title"].lower() in lowered or lowered in p["title"].lower() for p in protocols)


def run_briefing(report: str, triage: Dict[str, Any], protocols: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Raises GeminiUnavailable on failure so the API can degrade to the triage result alone."""
    protocols = protocols if protocols is not None else retrieve_safety_guidance(
        report, incident_type=triage["parsed_category"])["results"]
    started = time.time()
    prompt = (f"Incident report: \"{report}\"\n"
              f"Triage: category {triage['parsed_category']}, priority {triage['suggested_priority']}. "
              f"Reasoning: {triage['triage_reasoning']}\n\n"
              f"Approved protocol passages:\n{format_protocols(protocols)}\n\n"
              "Write the briefing. Do not change the priority.")
    b = gemini.generate_json(prompt, Briefing, SYSTEM, temperature=0.2)
    return {
        "summary": b.summary.strip(),
        "advice": "\n".join(f"{i}. {a.strip().lstrip('0123456789. ')}" for i, a in enumerate(b.actions[:3], start=1)),
        "source": b.source_protocol,
        "grounded": is_grounded(b.source_protocol, protocols),
        "cited_protocols": [p["title"] for p in protocols],
        "model": getattr(gemini.last_model_used, "value", settings.GEMINI_MODEL),
        "backend": gemini.backend_name(),
        "duration_sec": round(time.time() - started, 2),
    }
