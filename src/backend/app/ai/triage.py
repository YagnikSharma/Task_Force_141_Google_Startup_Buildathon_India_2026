"""Incident triage: deterministic rule agents as the safety net, Gemini as the primary analyst.

Workflow (a small explicit state machine, every step is logged in ``workflow_steps``):

    intake (rules) -> assess (rules) -> gemini (structured JSON) -> merge -> route
        -> critical: escalate (112 first) + retrieve protocols
        -> standard: retrieve protocols

Trust rules
  * The rule engine always runs, so triage works with no network, no key and no quota.
  * Gemini can raise the priority (it reads Hindi, Hinglish and messy text the rules miss), but it
    can never lower it below what the rules decided. Life-safety keywords always win.
  * The output is advisory; verified human responders make every decision.
"""
import logging
import re
import time
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from backend.app.ai.retrieval import retrieve_safety_guidance
from backend.app.core.config import settings

logger = logging.getLogger("neighbourhood_safety.triage")

# Keyword rules are matched on whole words / phrases (see _mentions), in priority order.
CATEGORY_KEYWORDS = (
    ("sos", ("sos", "help me", "attack", "attacked", "attacking", "threatening", "danger", "stalk", "stalking", "stalker", "emergency",
             "assault", "assaulted", "kidnap", "following me")),
    ("medical", ("heart attack", "chest pain", "breathing", "breathe", "unconscious", "bleeding", "blood",
                 "doctor", "ambulance", "fell", "fall", "fallen", "injury", "injured", "fainted", "seizure", "stroke")),
    ("child_alert", ("child", "children", "kid", "kids", "school", "son", "daughter", "school bus",
                     "missing child", "boy", "girl")),
    ("elder_welfare", ("elder", "elderly", "senior", "grandfather", "grandmother", "grandpa", "grandma",
                       "old man", "old woman", "medicine", "medicines", "wellness")),
    ("suspicious_activity", ("prowler", "masked", "mask", "loiter", "loitering", "suspicious", "theft",
                             "stolen", "break-in", "burglar", "burglary", "trespass", "trespassing")),
)
LIFE_THREAT_WORDS = ("weapon", "knife", "gun", "bleeding heavily", "severe bleeding", "fire", "smoke",
                     "attack", "attacked", "attacking", "not breathing", "unconscious")
ELDER_RISK_WORDS = ("not answering", "not answered", "hasn't answered", "has not answered", "no answer",
                    "not picking up", "not responding", "unresponsive", "no response", "no reply",
                    "missed", "fell", "fall", "collapsed", "confused", "wandered", "missing")
INTRUSION_WORDS = ("break-in", "breaking in", "forced entry", "forced", "stalking", "masked")
TIME_WORDS = ("now", "just", "minutes", "minute", "hour", "hours", "pm", "am", "today", "tonight",
              "yesterday", "morning", "evening", "since")


def _mentions(text: str, words) -> bool:
    """True if any keyword or phrase appears as whole words ("person" does not contain "son")."""
    return any(re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", text) for w in words)


class IncidentIntakeAgent:
    """
    Rule agent 1: Structures a resident's free-text report,
    extracts key entities, category, and identifies critical missing information.
    """
    role = "Incident Intake Specialist"
    goal = "Transform unstructured citizen safety reports into structured, actionable triage tickets."

    def execute(self, raw_text: str, reported_category: Optional[str] = None) -> Dict[str, Any]:
        text_lower = raw_text.lower()

        # 1. Category identification (whole-word matching: "person" must not match "son")
        detected_category = reported_category or "hazard"
        for category, words in CATEGORY_KEYWORDS:
            if _mentions(text_lower, words):
                detected_category = category
                break

        # 2. Location entity extraction
        location_match = re.search(r'\b(?:at|near|behind|in front of|opposite|in|on)\s+([A-Za-z0-9\s,\.-]{4,40})', raw_text, re.IGNORECASE)
        extracted_location = location_match.group(1).strip() if location_match else None

        # 3. Missing information detection
        missing = []
        if not extracted_location:
            missing.append("Specific street, landmark, or apartment number")
        if not _mentions(text_lower, TIME_WORDS):
            missing.append("Exact time or duration of incident")
        if detected_category in ["sos", "medical", "elder_welfare"] and not _mentions(text_lower, ("alone", "with")):
            missing.append("Whether the person is currently alone or accompanied")

        return {
            "parsed_category": detected_category,
            "extracted_location": extracted_location,
            "missing_critical_info": missing,
            "raw_summary": raw_text[:200] + ("..." if len(raw_text) > 200 else "")
        }

class SafetyTriageAssistant:
    """
    Rule agent 2: Analyzes severity and suggests a preliminary priority
    with evidence-based triage reasoning. Human responder retains final discretion.
    """
    role = "Safety Triage Assessor"
    goal = "Evaluate immediate risk to human life, property, or community peace."

    def execute(self, intake_result: Dict[str, Any], raw_text: str) -> Dict[str, Any]:
        text_lower = raw_text.lower()
        category = intake_result["parsed_category"]
        reasoning_points: List[str] = []

        if category == "sos" or _mentions(text_lower, LIFE_THREAT_WORDS):
            priority = "P1_CRITICAL"
            reasoning_points.append("Active or immediate physical distress / threat to life detected.")
            actions = [
                "Move to a well-lit, crowded, or secure locked space immediately if possible.",
                "Keep emergency phone line open; community responders alerted in <120 seconds.",
                "Do not confront any aggressor directly."
            ]
        elif (category in ["medical", "child_alert"]
              or (category == "elder_welfare" and _mentions(text_lower, ELDER_RISK_WORDS))
              or _mentions(text_lower, INTRUSION_WORDS)):
            priority = "P2_HIGH"
            reasoning_points.append(f"Significant vulnerability identified ({category.replace('_', ' ').title()}).")
            reasoning_points.append("Requires rapid volunteer / patrol dispatch within 15 minutes.")
            actions = [
                "Verify coordinates with trusted emergency contacts.",
                "Dispatch the nearest verified responder for an in-person check.",
                "Keep the child's or elder's phone line reachable."
            ]
        elif category in ["hazard", "suspicious_activity", "elder_welfare"]:
            priority = "P3_MODERATE"
            reasoning_points.append(
                {"hazard": "Environmental or infrastructure hazard reported without active violence.",
                 "suspicious_activity": "Suspicious activity reported without an immediate threat to life.",
                 "elder_welfare": "Senior welfare request without signs of an emergency."}[category])
            actions = {
                "hazard": ["Warn nearby neighbours and pedestrians to take an alternative route.",
                           "Civic authority ticket created for the municipal repair team."],
                "suspicious_activity": ["Do not approach; note descriptions, vehicle numbers and direction of travel.",
                                        "Patrol notified to verify the area on its next round."],
                "elder_welfare": ["Schedule a wellness visit from a verified volunteer.",
                                  "Confirm medicines and essentials are available."],
            }[category]
        else:
            priority = "P4_ADVISORY"
            reasoning_points.append("Non-urgent community advisory or general information request.")
            actions = ["Log entry in neighbourhood safety ledger for routine monitoring."]

        return {
            "suggested_priority": priority,
            "triage_reasoning": " ".join(reasoning_points),
            "immediate_safety_checklist": actions
        }

class KnowledgeAssistant:
    """
    Rule agent 3: Queries the hybrid protocol retriever (BM25 + Gemini embeddings)
    to retrieve officially approved community safety protocols and citations.
    """
    role = "Civic Knowledge Retrieval Officer"
    goal = "Provide verified municipal SOPs and emergency resources relevant to the incident."

    def execute(self, category: str, query_hint: str) -> List[Dict[str, str]]:
        retrieved = retrieve_safety_guidance(query_hint, incident_type=category)
        protocols = []
        for r in retrieved.get("results", []):
            protocols.append({
                "title": r["title"],
                "source": r["source"],
                "protocol_snippet": r.get("cited_passage") or (r["excerpt"][:220] + "..."),
                "matched_by": r.get("matched_by", ""),
            })
        return protocols

class CommunityInsightsAgent:
    """
    Rule agent 4: Aggregates incident counts into de-identified
    hotspot insights, trend summaries, and proactive neighbourhood safety advice.
    """
    role = "Community Intelligence Analyst"
    goal = "Synthesize trends into actionable civic advisories without exposing PII."

    def execute(self, total_incidents: int, active_count: int, hazard_count: int) -> str:
        if active_count > 3:
            return (
                f"Elevated community vigilance recommended. {active_count} active incidents and {hazard_count} "
                "civic hazards are currently being monitored. Evening patrols have been intensified along primary corridors."
            )
        elif hazard_count > 0:
            return (
                f"Normal neighbourhood safety index. {hazard_count} infrastructure hazards under municipal review. "
                "Residents are advised to use designated Safe Transit routes after dusk."
            )
        else:
            return "Optimal neighbourhood safety metrics. All active corridors verified clear by community patrol."

PRIORITY_ORDER = ["P4_ADVISORY", "P3_MODERATE", "P2_HIGH", "P1_CRITICAL"]
Category = Literal["sos", "medical", "child_alert", "elder_welfare", "suspicious_activity", "hazard"]
Priority = Literal["P1_CRITICAL", "P2_HIGH", "P3_MODERATE", "P4_ADVISORY"]

GEMINI_SYSTEM = (
    "You are the triage analyst of a neighbourhood emergency network in India. Residents write in English, "
    "Hindi or Hinglish, often in panic. Classify the report and help volunteer responders act fast. "
    "Priorities: P1_CRITICAL = threat to life now (violence, not breathing, unconscious, fire, severe bleeding); "
    "P2_HIGH = vulnerable person at risk, medical need, missing or unreachable child or elder, intrusion; "
    "P3_MODERATE = hazard or suspicious activity without immediate danger; P4_ADVISORY = information only. "
    "Never invent facts that are not in the report. Write the briefing and actions in clear English."
)


class GeminiTriage(BaseModel):
    """Structured output schema for Gemini."""
    category: Category
    priority: Priority
    reasoning: str = Field(description="One or two sentences explaining the priority.")
    responder_briefing: str = Field(description="What happened and what the responder should know, max 2 sentences.")
    immediate_actions: List[str] = Field(description="Up to 4 short, concrete safety steps for the person reporting.")
    missing_information: List[str] = Field(description="Critical details missing from the report, if any.")
    detected_language: str = Field(description="Language of the report, e.g. English, Hindi, Hinglish.")
    extracted_location: Optional[str] = Field(default=None, description="Address or landmark mentioned, if any.")


def more_severe(a: str, b: str) -> str:
    return a if PRIORITY_ORDER.index(a) >= PRIORITY_ORDER.index(b) else b


def gemini_triage(raw_text: str, rules: Dict[str, Any], location: Optional[str]) -> GeminiTriage:
    from backend.app.ai import gemini

    prompt = (f"Incident report:\n\"\"\"{raw_text}\"\"\"\n"
              f"Location given by the app: {location or 'not provided'}\n"
              f"Keyword pre-screen (may be wrong for non-English text): category {rules['parsed_category']}, "
              f"priority {rules['suggested_priority']}.")
    return gemini.generate_json(prompt, GeminiTriage, GEMINI_SYSTEM)


class SafetyTriageOrchestrator:
    """Runs the triage workflow and shapes its state into the API response."""

    def __init__(self):
        self.intake_agent = IncidentIntakeAgent()
        self.triage_agent = SafetyTriageAssistant()
        self.knowledge_agent = KnowledgeAssistant()
        self.insights_agent = CommunityInsightsAgent()

    def run_incident_assistance_workflow(
        self,
        raw_text: str,
        reported_category: Optional[str] = None,
        location: Optional[str] = None,
        use_gemini: Optional[bool] = None,
    ) -> Dict[str, Any]:
        started = time.time()
        steps: List[str] = []

        # 1-2. Rules: always run, never need the network.
        intake = self.intake_agent.execute(raw_text, reported_category)
        if location and not intake.get("extracted_location"):
            intake["extracted_location"] = location
        steps.append(f"intake:{intake['parsed_category']}")
        rules = self.triage_agent.execute(intake, raw_text)
        steps.append(f"triage:{rules['suggested_priority']}")

        category, priority = intake["parsed_category"], rules["suggested_priority"]
        reasoning, checklist = rules["triage_reasoning"], list(rules["immediate_safety_checklist"])
        missing, extracted_location = intake["missing_critical_info"], intake["extracted_location"]
        engine, gemini_out, gemini_error = "rules", None, None

        # 3. Gemini: structured analysis, merged under the "never downgrade" rule.
        if use_gemini is None:
            use_gemini = settings.ENABLE_GEMINI_TRIAGE
        if use_gemini:
            try:
                g = gemini_triage(raw_text, {"parsed_category": category, "suggested_priority": priority}, location)
                gemini_out = g.model_dump()
                if more_severe(g.priority, priority) == g.priority:
                    category = g.category  # Gemini agrees or saw more risk: trust its reading of the text
                priority = more_severe(g.priority, priority)
                reasoning = g.reasoning
                checklist = [a for a in g.immediate_actions if a][:4] or checklist
                missing = g.missing_information or missing
                extracted_location = extracted_location or g.extracted_location
                from backend.app.ai.gemini import last_model_used
                engine = f"gemini:{getattr(last_model_used, 'value', settings.GEMINI_MODEL)}"
                steps.append(f"gemini:{g.priority}")
            except Exception as exc:  # no key, quota, outage: the rule result stands
                gemini_error = str(exc)[:200]
                steps.append("gemini:unavailable")
                logger.info("Gemini triage unavailable, using rules: %s", gemini_error)

        # 4. Route.
        escalated = priority == "P1_CRITICAL"
        if escalated:
            first = "Call 112 now if anyone is in immediate danger; responders are being alerted."
            if first not in checklist:
                checklist.insert(0, first)
            steps.append("escalated")

        # 5. Retrieve approved protocols for the final category.
        protocols = self.knowledge_agent.execute(category, f"{category.replace('_', ' ')} {raw_text}")
        steps.append(f"knowledge:{len(protocols)}")

        duration = round(time.time() - started, 3)
        logger.info("Triage %s finished in %ss (priority %s)", " > ".join(steps), duration, priority)
        return {
            "parsed_category": category,
            "extracted_location": extracted_location,
            "missing_critical_info": missing,
            "suggested_priority": priority,
            "rule_priority": rules["suggested_priority"],
            "triage_reasoning": reasoning,
            "immediate_safety_checklist": checklist,
            "retrieved_civic_protocols": protocols,
            "escalated": escalated,
            "workflow_steps": steps,
            "ai_engine": engine,
            "gemini": gemini_out,
            "gemini_error": gemini_error,
            "execution_duration_sec": duration,
            "advisory_notice": "AI-assisted guidance is strictly advisory. Final decisions remain with verified human responders.",
        }


triage_orchestrator = SafetyTriageOrchestrator()
