"""Jugnu assistant API: chat with the Gemini agent, then confirm the actions it proposes."""
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.ai.agent import TOOLS, execute_confirmed_action, run_agent, tools_for
from backend.app.api.deps import get_current_user
from backend.app.core.audit import record_audit
from backend.app.core.rate_limit import LoginThrottle
from backend.app.database.base import get_db
from backend.app.models.entities import User

router = APIRouter(prefix="/agent", tags=["Jugnu assistant (Gemini agent)"])

# Cost guard: each user may send at most 30 agent messages per 10 minutes.
_agent_limit = LoginThrottle(max_attempts=30, window_seconds=600)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatLocation(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: List[ChatTurn] = Field(default_factory=list, max_length=20)
    location: Optional[ChatLocation] = None


class ConfirmRequest(BaseModel):
    tool: str = Field(max_length=64)
    args: Dict[str, Any] = Field(default_factory=dict)


@router.get("/tools")
def list_tools(current_user: User = Depends(get_current_user)):
    """The tools this user's agent can call (role-based), for transparency in the UI."""
    return [{"name": t.name, "description": t.description, "needs_confirmation": t.write}
            for t in tools_for(current_user)]


@router.post("/chat")
def chat(req: ChatRequest, request: Request, current_user: User = Depends(get_current_user),
         db: Session = Depends(get_db)):
    key = f"agent:{current_user.id}"
    wait = _agent_limit.retry_after(key)
    if wait:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Too many assistant messages. Try again in {wait} s.")
    _agent_limit.record_failure(key)  # counts every message, not just failures
    result = run_agent(db, current_user, request, req.message,
                       [t.model_dump() for t in req.history],
                       req.location.model_dump() if req.location else None)
    record_audit(db, "agent_chat", "agent", None, user_id=current_user.id, request=request,
                 details={"tools": [s["tool"] for s in result["steps"]], "pending": len(result["pending_actions"]),
                          "model": result.get("model"), "engine": result.get("engine")})
    db.commit()
    return result


@router.post("/confirm")
def confirm(req: ConfirmRequest, request: Request, current_user: User = Depends(get_current_user),
            db: Session = Depends(get_db)):
    """Run an action the agent proposed, after the user pressed Confirm (human in the loop)."""
    if req.tool not in TOOLS or req.tool not in {t.name for t in tools_for(current_user)}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This action is not available to you.")
    result = execute_confirmed_action(db, current_user, request, req.tool, req.args)
    record_audit(db, "agent_action_confirmed", "agent", None, user_id=current_user.id, request=request,
                 details={"tool": req.tool})
    db.commit()
    return result
