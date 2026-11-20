"""NSIN Copilot: a Gemini agent that runs real app workflows through function calling.

How one turn works
  1. The user's message (plus a short history) goes to Gemini with the tools this user may use.
     Tools are picked by role: residents get resident tools, verified staff also get operations tools.
  2. Gemini answers or asks for one or more tool calls. READ tools (search protocols, list or open
     incidents, community overview, nearest responders) run straight away against the live database,
     with the same visibility rules as the REST API, and their results go back to Gemini.
  3. WRITE tools (file a report, change a status, dispatch a responder, report a hazard) are never
     run by the model. They come back as "pending actions" that the user must confirm with a button.
     Confirmation runs the same code path as the REST endpoint, so permissions, the safety-rule
     priority floor and the audit log all apply. This is the human-in-the-loop safeguard.
  4. The loop stops after MAX_STEPS model calls or AGENT_BUDGET_SECONDS, whichever comes first.

Cost guards: flash models only (the config fallback chain), output tokens capped, at most
MAX_STEPS calls per message, history trimmed, and a per-user message limit in the API layer.
"""
import json
import logging
import math
import time
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.ai import gemini
from backend.app.ai.retrieval import retrieve_safety_guidance
from backend.app.api.deps import is_staff
from backend.app.core.config import settings
from backend.app.models.entities import CommunityHazard, Incident, Responder, User

logger = logging.getLogger("neighbourhood_safety.agent")

MAX_STEPS = 4
AGENT_BUDGET_SECONDS = 30.0
MAX_HISTORY_TURNS = 8
INCIDENT_TYPES = ["sos", "hazard", "medical", "child_alert", "elder_welfare", "suspicious_activity"]
STATUSES = ["reported", "acknowledged", "responder_en_route", "on_scene", "resolving", "resolved", "false_alarm"]
HAZARD_TYPES = ["dark_street", "road_block", "aggressive_animals", "electrical", "flooding"]

SYSTEM_PROMPT = """You are NSIN Copilot, the assistant inside the Neighbourhood Safety Intelligence Network,
a community-safety app used in Lucknow, India. You help residents, verified volunteer responders and
RWA admins.

Rules:
- Life safety first. If someone may be in immediate danger, tell them to call 112 (India emergency)
  and to press the SOS button in the app, before anything else.
- Use the tools to look up real data. Never invent incidents, counts, responders or protocols.
- When you give safety advice, base it on search_safety_protocols results and name the protocol.
- To change anything (file a report, change a status, dispatch, report a hazard) call the matching
  tool. The user then sees a Confirm button; tell them to review and confirm it. Never claim an
  action is done before it is confirmed.
- Users may write in English, Hindi or Hinglish. Reply in the user's language, short and clear.
- You are advisory. Verified humans make the final decisions. Do not give medical diagnoses.
- Do not reveal other residents' names, phone numbers or exact locations."""


class Tool:
    def __init__(self, name: str, description: str, parameters: Dict[str, Any], fn: Callable,
                 write: bool = False, staff_only: bool = False):
        self.name, self.description, self.parameters = name, description, parameters
        self.fn, self.write, self.staff_only = fn, write, staff_only

    def declaration(self) -> Dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters_json_schema": self.parameters}


def _obj(props: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or []}


def _metres(lat1, lng1, lat2, lng2) -> float:
    dx = (lng2 - lng1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110_540
    return math.hypot(dx, dy)


def _incident_brief(inc_resp) -> Dict[str, Any]:
    d = inc_resp.model_dump(mode="json")
    return {k: d.get(k) for k in ("id", "reference_code", "title", "incident_type", "priority", "status",
                                   "location_address", "assigned_responder_name", "created_at")}


# ---------------------------------------------------------------- read tools (run immediately)

def t_search_protocols(db: Session, user: User, request, query: str, audience: Optional[str] = None):
    res = retrieve_safety_guidance(query=query[:300], audience=audience)
    return {"found": res.get("found", False), "retrieval_mode": res.get("retrieval_mode"),
            "protocols": [{"title": r.get("title"), "source": r.get("source"),
                           "passage": (r.get("cited_passage") or r.get("excerpt") or "")[:600]}
                          for r in (res.get("results") or [])[:3]]}


def t_list_incidents(db: Session, user: User, request, status: Optional[str] = None,
                     incident_type: Optional[str] = None, limit: int = 8):
    from backend.app.api.v1.incidents import list_incidents
    rows = list_incidents(status_filter=status if status in STATUSES else None,
                          type_filter=incident_type if incident_type in INCIDENT_TYPES else None,
                          limit=max(1, min(int(limit or 8), 10)), offset=0, current_user=user, db=db)
    return {"count": len(rows), "incidents": [_incident_brief(r) for r in rows]}


def t_get_incident(db: Session, user: User, request, incident_id: int):
    from backend.app.api.v1.incidents import _format_incident_response, _get_visible_incident
    inc = _format_incident_response(_get_visible_incident(db, int(incident_id), user), user)
    d = inc.model_dump(mode="json")
    out = _incident_brief(inc)
    out["description"] = (d.get("description") or "")[:800]
    out["timeline"] = [{"status": h["status"], "notes": h["notes"], "at": h["created_at"]}
                       for h in d.get("status_history", [])[-5:]]
    return out


def t_community_overview(db: Session, user: User, request):
    from backend.app.analytics.insights import ACTIVE_STATUSES
    by_status = dict(db.query(Incident.status, func.count(Incident.id)).group_by(Incident.status).all())
    open_by_priority = dict(db.query(Incident.priority, func.count(Incident.id))
                            .filter(Incident.status.in_(ACTIVE_STATUSES)).group_by(Incident.priority).all())
    hazards = (db.query(CommunityHazard).filter(CommunityHazard.status.in_(["active", "verified"]))
               .order_by(CommunityHazard.created_at.desc()).limit(5).all())
    available = db.query(func.count(Responder.id)).filter(Responder.is_available.is_(True)).scalar()
    return {"incidents_by_status": by_status, "open_incidents_by_priority": open_by_priority,
            "available_responders": available,
            "recent_hazards": [{"title": h.title, "type": h.hazard_type, "severity": h.severity,
                                "address": h.address, "status": h.status} for h in hazards]}


def t_nearest_responders(db: Session, user: User, request, incident_id: int):
    from backend.app.api.v1.incidents import _get_visible_incident
    inc = _get_visible_incident(db, int(incident_id), user)
    if inc.latitude is None:
        return {"error": "This incident has no map location."}
    rows = db.query(Responder, User).join(User, User.id == Responder.user_id) \
        .filter(Responder.is_available.is_(True), Responder.current_lat.isnot(None)).all()
    ranked = sorted(rows, key=lambda r: _metres(r[0].current_lat, r[0].current_lng, inc.latitude, inc.longitude))
    return {"incident": inc.reference_code, "responders": [
        {"name": u.full_name, "badge": p.badge_number, "service": p.service_type,
         "distance_m": round(_metres(p.current_lat, p.current_lng, inc.latitude, inc.longitude))}
        for p, u in ranked[:3]]}


# ---------------------------------------------------------------- write tools (need confirmation)

def t_file_report(db: Session, user: User, request, title: str, description: str, incident_type: str,
                  location_address: Optional[str] = None, latitude: Optional[float] = None,
                  longitude: Optional[float] = None):
    from backend.app.api.v1.incidents import create_incident
    from backend.app.schemas.safety_schemas import IncidentCreate
    req = IncidentCreate(title=title, description=description, incident_type=incident_type,
                         location_address=location_address, latitude=latitude, longitude=longitude)
    inc = create_incident(req=req, request=request, current_user=user, db=db)
    return {"done": True, "message": f"Report {inc.reference_code} filed with priority {inc.priority}.",
            "incident": _incident_brief(inc), "link": f"/incidents/{inc.id}"}


def t_update_status(db: Session, user: User, request, incident_id: int, status: str, notes: Optional[str] = None):
    from backend.app.api.v1.incidents import update_incident_status
    from backend.app.schemas.safety_schemas import IncidentStatusUpdate
    inc = update_incident_status(incident_id=int(incident_id), req=IncidentStatusUpdate(status=status, notes=notes),
                                 request=request, current_user=user, db=db)
    return {"done": True, "message": f"{inc.reference_code} is now {inc.status.replace('_', ' ')}.",
            "incident": _incident_brief(inc), "link": f"/incidents/{inc.id}"}


def t_dispatch(db: Session, user: User, request, incident_id: int):
    from backend.app.api.v1.live_map import demo_dispatch
    r = demo_dispatch(incident_id=int(incident_id), request=request, current_user=user, db=db)
    return {"done": True, "message": f"Responder {r.label} dispatched, ETA about {round((r.eta_seconds or 0) / 60, 1)} min. "
                                     "Watch the unit move on the live map.", "link": "/map"}


def t_report_hazard(db: Session, user: User, request, title: str, hazard_type: str, address: str,
                    severity: str = "medium", latitude: Optional[float] = None, longitude: Optional[float] = None):
    from backend.app.api.v1.community import report_hazard
    from backend.app.schemas.safety_schemas import CommunityHazardCreate
    h = report_hazard(req=CommunityHazardCreate(title=title, hazard_type=hazard_type, severity=severity, address=address,
                                                latitude=latitude, longitude=longitude), current_user=user, db=db)
    return {"done": True, "message": f"Hazard '{h.title}' added to the community map ({h.status}).", "link": "/map"}


TOOLS: Dict[str, Tool] = {t.name: t for t in [
    Tool("search_safety_protocols",
         "Search NSIN's approved safety protocols (emergency, child safety, elder care, hazards, women's "
         "transit safety, responder procedures). Use before giving any safety advice.",
         _obj({"query": {"type": "string", "description": "What the user needs guidance on"},
               "audience": {"type": "string", "enum": ["residents", "women", "guardians", "seniors", "caregivers", "responders"]}},
              ["query"]), t_search_protocols),
    Tool("list_incidents",
         "List incidents the current user may see, newest first. Residents see their own reports plus "
         "public community alerts; staff see all.",
         _obj({"status": {"type": "string", "enum": STATUSES}, "incident_type": {"type": "string", "enum": INCIDENT_TYPES},
               "limit": {"type": "integer", "description": "1-10"}}), t_list_incidents),
    Tool("get_incident", "Open one incident by its numeric id: details and latest timeline.",
         _obj({"incident_id": {"type": "integer"}}, ["incident_id"]), t_get_incident),
    Tool("community_overview",
         "Live neighbourhood picture: incidents by status, open incidents by priority, available "
         "responders and recent hazards.", _obj({}), t_community_overview),
    Tool("nearest_responders", "Staff only: the three nearest available responders to an incident, with distance.",
         _obj({"incident_id": {"type": "integer"}}, ["incident_id"]), t_nearest_responders, staff_only=True),
    Tool("file_incident_report",
         "Prepare a new incident report for the user to confirm. The safety rules and AI set the priority.",
         _obj({"title": {"type": "string", "description": "Short title, 3-200 chars"},
               "description": {"type": "string", "description": "What happened, in the user's words"},
               "incident_type": {"type": "string", "enum": INCIDENT_TYPES},
               "location_address": {"type": "string"},
               "latitude": {"type": "number"}, "longitude": {"type": "number"}},
              ["title", "description", "incident_type"]), t_file_report, write=True),
    Tool("update_incident_status",
         "Prepare a status change for the user to confirm. Residents may only close their own report "
         "(resolved or false_alarm); staff follow the incident lifecycle.",
         _obj({"incident_id": {"type": "integer"}, "status": {"type": "string", "enum": STATUSES},
               "notes": {"type": "string"}}, ["incident_id", "status"]), t_update_status, write=True),
    Tool("dispatch_nearest_responder",
         "Staff only: prepare dispatch of the nearest available responder to an open incident (shown live on the map).",
         _obj({"incident_id": {"type": "integer"}}, ["incident_id"]), t_dispatch, write=True, staff_only=True),
    Tool("report_community_hazard",
         "Prepare a community hazard (dark street, road block, aggressive animals, electrical, flooding) for the user to confirm.",
         _obj({"title": {"type": "string"}, "hazard_type": {"type": "string", "enum": HAZARD_TYPES},
               "address": {"type": "string"}, "severity": {"type": "string", "enum": ["low", "medium", "high"]},
               "latitude": {"type": "number"}, "longitude": {"type": "number"}},
              ["title", "hazard_type", "address"]), t_report_hazard, write=True),
]}


def tools_for(user: User) -> List[Tool]:
    staff = is_staff(user)
    return [t for t in TOOLS.values() if staff or not t.staff_only]


def _describe_action(name: str, args: Dict[str, Any]) -> str:
    if name == "file_incident_report":
        return f"File a {args.get('incident_type', 'incident').replace('_', ' ')} report: \"{args.get('title', '')}\""
    if name == "update_incident_status":
        return f"Change incident #{args.get('incident_id')} to {str(args.get('status', '')).replace('_', ' ')}"
    if name == "dispatch_nearest_responder":
        return f"Dispatch the nearest responder to incident #{args.get('incident_id')}"
    if name == "report_community_hazard":
        return f"Add hazard \"{args.get('title', '')}\" at {args.get('address', '')}"
    return name


def _safe_run(tool: Tool, db: Session, user: User, request: Optional[Request], args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return tool.fn(db, user, request, **args)
    except HTTPException as exc:
        db.rollback()
        return {"error": str(exc.detail)}
    except TypeError as exc:  # the model sent an unknown or missing argument
        db.rollback()
        return {"error": f"bad arguments: {exc}"[:200]}
    except Exception as exc:
        db.rollback()
        logger.warning("agent tool %s failed: %s", tool.name, exc)
        return {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}


def execute_confirmed_action(db: Session, user: User, request: Optional[Request], name: str,
                             args: Dict[str, Any]) -> Dict[str, Any]:
    """Run a write tool after the user pressed Confirm. Permissions are re-checked here."""
    tool = TOOLS.get(name)
    if tool is None or not tool.write:
        raise HTTPException(400, "Unknown action.")
    if tool.staff_only and not is_staff(user):
        raise HTTPException(403, "This action needs a verified responder or admin.")
    result = _safe_run(tool, db, user, request, args)
    if "error" in result:
        raise HTTPException(409, result["error"])
    return result


def _fallback_reply(message: str, db: Session, user: User) -> Dict[str, Any]:
    """Gemini unavailable: answer from the protocol library so the user still gets cited guidance."""
    res = t_search_protocols(db, user, None, message)
    steps = [{"tool": "search_safety_protocols", "args": {"query": message[:80]}, "ok": True}]
    if res["protocols"]:
        top = res["protocols"][0]
        reply = (f"Gemini is unavailable right now, so here is the closest approved protocol.\n\n"
                 f"**{top['title']}** ({top['source']}):\n{top['passage']}\n\n"
                 "In an emergency, call 112 and press SOS.")
    else:
        reply = "Gemini is unavailable right now. In an emergency, call 112 and press SOS in the app."
    return {"reply": reply, "steps": steps, "pending_actions": [], "model": None, "engine": "rules-fallback"}


def run_agent(db: Session, user: User, request: Optional[Request], message: str,
              history: List[Dict[str, str]], location: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    if not settings.gemini_configured:
        return _fallback_reply(message, db, user)
    from google.genai import types

    allowed = {t.name: t for t in tools_for(user)}
    tool_cfg = [types.Tool(function_declarations=[t.declaration() for t in allowed.values()])]
    context = (f"Current user: role={user.role}, verified_staff={is_staff(user)}, first name={user.full_name.split()[0]}. "
               f"Time (UTC): {time.strftime('%Y-%m-%d %H:%M')}.")
    if location:
        context += f" The user's device location: lat {location.get('latitude')}, lng {location.get('longitude')}."

    contents: List[Any] = []
    for turn in history[-MAX_HISTORY_TURNS:]:
        role = "model" if turn.get("role") == "assistant" else "user"
        text = (turn.get("content") or "")[:2000]
        if text:
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message[:2000])]))

    def make_config(timeout_ms: int):
        return types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT + "\n\n" + context,
            temperature=0.2,
            max_output_tokens=settings.GEMINI_MAX_OUTPUT_TOKENS,
            tools=tool_cfg,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            http_options=types.HttpOptions(timeout=timeout_ms),
        )

    started = time.monotonic()
    steps: List[Dict[str, Any]] = []
    pending: List[Dict[str, Any]] = []
    reply = ""
    model_used = None
    for _ in range(MAX_STEPS):
        remaining = AGENT_BUDGET_SECONDS - (time.monotonic() - started)
        try:
            resp = gemini.generate_with_fallback(contents, make_config, budget_seconds=remaining)
        except gemini.GeminiUnavailable as exc:
            if not steps:
                out = _fallback_reply(message, db, user)
                out["gemini_error"] = str(exc)[:200]
                return out
            reply = reply or "I ran out of time while working on this. Here is what I found so far."
            break
        model_used = getattr(gemini.last_model_used, "value", None)
        cand = (resp.candidates or [None])[0]
        parts = list(cand.content.parts) if cand and cand.content and cand.content.parts else []
        calls = [p.function_call for p in parts if p.function_call]
        text = "".join(p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False))
        if not calls:
            reply = text.strip()
            break
        contents.append(cand.content)
        responses = []
        for call in calls:
            args = dict(call.args or {})
            tool = allowed.get(call.name)
            if tool is None:
                result = {"error": "This tool is not available to this user."}
            elif tool.write:
                pending.append({"tool": tool.name, "args": args, "summary": _describe_action(tool.name, args)})
                result = {"status": "awaiting_user_confirmation",
                          "note": "Shown to the user with a Confirm button. Not done yet."}
            else:
                result = _safe_run(tool, db, user, request, args)
            steps.append({"tool": call.name, "args": args, "ok": "error" not in result,
                          "write": bool(tool and tool.write)})
            responses.append(types.Part.from_function_response(name=call.name, response={"result": json.loads(json.dumps(result, default=str))}))
        contents.append(types.Content(role="user", parts=responses))
    if not reply:
        reply = ("Please review the action below and press Confirm." if pending
                 else "I could not finish that. Please try rephrasing.")
    return {"reply": reply, "steps": steps, "pending_actions": pending, "model": model_used, "engine": "gemini"}
