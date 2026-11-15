"""GeoStar Guide: the ElevenLabs voice agent that walks people through the Studio.

The agent runs on ElevenLabs Agents (speech in, speech out, barge-in). It has no server webhooks: every tool is a
*client tool* that runs in the user's browser, so it can point at and click things on the page and call this API
(copilot, status) with the page's own state. The API key never leaves the server; the browser gets a short-lived
signed URL per conversation.

The agent is created on first use and kept in sync: its config is hashed, and when the prompt, tools, voice or LLM
change, the stored agent is updated in place. Its id is cached in CACHE_DIR/eleven_agent.json.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any

import httpx

from app import config

API = "https://api.elevenlabs.io/v1"
STATE_FILE = config.CACHE_DIR / "eleven_agent.json"
_lock = threading.Lock()

VOICE_ID = os.getenv("ELEVENLABS_GUIDE_VOICE", "EXAVITQu4vr4xnSDxMaL")  # "Sarah": mature, reassuring, professional
# The voice agent only routes and speaks; numbers and reasoning come from the Opus copilot through ask_plotstar,
# so a fast model keeps each spoken turn short. Override with ELEVENLABS_AGENT_LLM.
LLM = os.getenv("ELEVENLABS_AGENT_LLM", "claude-haiku-5-5")
TTS_MODEL = os.getenv("ELEVENLABS_GUIDE_TTS", "eleven_flash_v2")  # English agents require turbo or flash v2


def key() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "")


PROMPT = """You are the GeoStar Guide, a calm, friendly voice that helps people plan a data center in GeoStar Studio.

GeoStar Studio has six steps in the left rail: Define (brief and site), Discover (drone survey, then Generate layouts), Explore (2D plan
and 3D model), Analyze (three tabs: Compare the concepts, Analyze money, people, planet and resources, then Decide), Deliver,
Design (three tabs: Model, a 3D concept model of the property type picked in Define; Protect, alerts, sensors and an evacuation
route; Deploy, the facility's Command Center and the deployed projects). Real property data comes from the
CoStar Data Extract; layouts and every number come from GeoStar's layout engine; a separate GeoStar copilot (a
LangGraph agent on Claude) answers questions with those numbers.

How you work:
- Speak in one or two short sentences, like a helpful colleague sitting next to the user. No lists, no markdown.
- Never state a number you did not get from a tool in this conversation. For any question about the project, its
  cost, layout, racks, cooling, risks, the site or CoStar records, call ask_plotstar with the user's question in
  their words, then say the answer briefly in your own words, keeping the figures exactly.
- Call read_screen whenever you need to know where the user is or what they can click. Use point_at to show where
  something is while you talk about it ("this button here"). Prefer showing over describing.
- To do something for the user, call click. If a click changes or saves something (apply a change, save a decision,
  generate layouts, delete), first ask the user and only call click with confirmed=true after they say yes.
- When the user asks what is running, which agents exist, or how GeoStar works behind the scenes, call agents_status.
- When the user seems unsure or asks what to do next, call next_steps and offer the best one or two.
- A what-if from ask_plotstar is only a preview. Tell the user they can apply it with the button that appears.
- If a tool says something is unknown or failed, say so plainly. Never claim grid capacity is available.
- If the user goes quiet after you finish, do not keep talking."""

FIRST_MESSAGE = ("Hi, I'm your GeoStar guide. I can walk you through the studio, explain any number, or try a "
                 "what-if for you. What would you like to do?")


def _tool(name: str, description: str, props: dict[str, Any] | None = None, required: list[str] | None = None,
          timeout: int = 20) -> dict[str, Any]:
    return {"type": "client", "name": name, "description": description, "expects_response": True,
            "response_timeout_secs": timeout,
            "parameters": {"type": "object", "properties": props or {}, "required": required or []}}


TOOLS = [
    _tool("ask_plotstar", "Ask the GeoStar copilot a question about the open project (numbers, layouts, what-ifs, "
          "risks, CoStar property data). Returns the computed answer.",
          {"question": {"type": "string", "description": "The user's question, in their words"}}, ["question"], timeout=60),
    _tool("read_screen", "Read what the user is looking at: current step, selected object, and the list of things "
          "on screen that can be pointed at or clicked, each with a target id."),
    _tool("point_at", "Move the guide's pointer to something on screen and highlight it while you talk about it.",
          {"target": {"type": "string", "description": "A target id from read_screen, a step name such as Analyze, "
                                                       "or an object code from the plan such as DH-01"},
           "caption": {"type": "string", "description": "A few words to show next to the pointer"}}, ["target"]),
    _tool("click", "Click something on screen for the user (a button, a step in the rail, a tab, a room in the plan). "
          "Set confirmed=true only after the user agreed to an action that changes or saves something.",
          {"target": {"type": "string", "description": "A target id from read_screen, a step name, or an object code"},
           "confirmed": {"type": "boolean", "description": "The user said yes to this change"}}, ["target"]),
    _tool("agents_status", "Which GeoStar agents and services are running right now, which models they use, and "
          "what the copilot did on its last run."),
    _tool("next_steps", "Suggestions for what the user could do next, based on where they are in the studio."),
]


def agent_config() -> dict[str, Any]:
    return {
        "name": "GeoStar Guide",
        "tags": ["plotstar", "studio"],
        "conversation_config": {
            "agent": {"first_message": FIRST_MESSAGE, "language": "en",
                      "prompt": {"prompt": PROMPT, "llm": LLM, "tools": TOOLS}},
            "tts": {"voice_id": VOICE_ID, "model_id": TTS_MODEL},
            "conversation": {"max_duration_seconds": 900},
        },
        "platform_settings": {"auth": {"enable_auth": True}},  # sessions only through our signed URLs
    }


def _hash(cfg: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16]


def _load() -> dict[str, Any]:
    """Agent id + config hash: MongoDB Atlas (app_state) first, so every machine reuses one agent; local file fallback."""
    from app.sponsors.mongodb import mongo
    st = mongo.get_state("guide_agent")
    if st and st.get("agent_id"):
        return {"agent_id": st["agent_id"], "hash": st.get("hash")}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(d: dict[str, Any]) -> None:
    from app.sponsors.mongodb import mongo
    mongo.set_state("guide_agent", {"agent_id": d["agent_id"], "hash": d["hash"], "llm": LLM, "voice_id": VOICE_ID})
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(d), encoding="utf-8")


class GuideError(RuntimeError):
    pass


def _call(method: str, path: str, **kw: Any) -> dict[str, Any]:
    try:
        r = httpx.request(method, f"{API}{path}", headers={"xi-api-key": key()}, timeout=30, **kw)
    except httpx.HTTPError as e:
        raise GuideError(f"ElevenLabs unreachable ({type(e).__name__})") from e
    if r.status_code >= 400:
        detail = ""
        try:
            d = r.json().get("detail")
            detail = d.get("message") if isinstance(d, dict) else str(d)
        except ValueError:
            pass
        raise GuideError(f"ElevenLabs returned HTTP {r.status_code}{': ' + detail[:300] if detail else ''}")
    return r.json() if r.content else {}


def ensure_agent() -> str:
    """The agent id, creating or updating the agent when our config changed."""
    if not key():
        raise GuideError("ELEVENLABS_API_KEY is not set")
    pinned = os.getenv("ELEVENLABS_AGENT_ID")
    cfg = agent_config()
    h = _hash(cfg)
    with _lock:
        st = _load()
        agent_id = pinned or st.get("agent_id")
        if agent_id and st.get("hash") == h and st.get("agent_id") == agent_id:
            return agent_id
        if agent_id:
            try:
                _call("PATCH", f"/convai/agents/{agent_id}", json=cfg)
            except GuideError as e:
                if "404" not in str(e) or pinned:
                    raise
                agent_id = None  # deleted on the ElevenLabs side: create a new one
        if not agent_id:
            agent_id = _call("POST", "/convai/agents/create", json=cfg)["agent_id"]
        _save({"agent_id": agent_id, "hash": h})
        return agent_id


def signed_url() -> dict[str, Any]:
    agent_id = ensure_agent()
    d = _call("GET", "/convai/conversation/get-signed-url", params={"agent_id": agent_id})
    return {"signed_url": d["signed_url"], "agent_id": agent_id, "llm": LLM, "voice_id": VOICE_ID}


def status() -> dict[str, Any]:
    st = _load()
    return {"configured": bool(key()), "agent_id": os.getenv("ELEVENLABS_AGENT_ID") or st.get("agent_id"),
            "in_sync": st.get("hash") == _hash(agent_config()), "llm": LLM, "voice_id": VOICE_ID, "tts_model": TTS_MODEL,
            "tools": [t["name"] for t in TOOLS]}


def services() -> list[dict[str, Any]]:
    """What is running behind GeoStar right now, in plain words. Read-only checks, no paid calls."""
    from app.sponsors.langchain import copilot
    from app.sponsors.mongodb import store
    from app.db import db_ready
    out = [
        dict(name="GeoStar Guide", kind="Voice agent", running=bool(key()),
             detail=f"ElevenLabs Agents, {LLM} with the {TTS_MODEL} voice; tools run in your browser."),
        dict(name="GeoStar copilot", kind="LangGraph agent", running=True,
             detail=("Plan, act, verify, respond. " + (f"Claude ({copilot.MODEL}) plans and words answers"
                                                       if copilot.llm_ready() else "Rule planner (no Claude key)")
                     + f"; tools: {', '.join(copilot.TOOLS)}. Every figure is checked against the engine.")),
        dict(name="Layout engine", kind="Deterministic engine", running=True,
             detail="Generates the three concepts, geometry, checks, cost, energy, water, carbon and NPV."),
        dict(name="CoStar Data Extract", kind="Property data", running=db_ready(),
             detail="Parcels loaded from the CoStar hackathon kit." if db_ready() else "Parcel store is empty."),
        dict(name="LangSmith tracing", kind="Observability", running=copilot.TRACING,
             detail="Copilot runs are traced to the plotstar project; CoStar fields are kept out of traces."
             if copilot.TRACING else "Off."),
    ]
    try:
        s = store.status()
        out.append(dict(name="MongoDB Atlas", kind="Project storage", running=bool(s.get("available")),
                        detail="Saved projects." if s.get("available") else (s.get("reason") or "Not reachable.")))
    except Exception as e:  # storage status must never break the guide
        out.append(dict(name="MongoDB Atlas", kind="Project storage", running=False, detail=type(e).__name__))
    out.append(dict(name="Gemini summaries", kind="Writer", running=bool(config.GEMINI_API_KEY),
                    detail=f"Plain-language concept summaries ({config.GEMINI_MODEL}), number-checked."))
    out.append(dict(name="Vexcel imagery", kind="Aerial and 3D context", running=bool(config.VEXCEL_API_KEY),
                    detail="Aerial photo and 3D city mesh around the site."))
    return out
