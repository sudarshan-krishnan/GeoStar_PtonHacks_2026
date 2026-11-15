"""The GeoStar orchestrator and its specialists, built with the Deep Agents SDK (create_deep_agent).

    plotstar-orchestrator           plans (write_todos), delegates (task), scores (compute_site_score), answers
      ├─ property-intelligence      CoStar evidence over MCP
      ├─ financial-feasibility      acquisition, development model, sensitivity
      ├─ resource-infrastructure    power, water, flood, grid
      ├─ community-sustainability   homes, noise, sensitive places, carbon, water
      ├─ design-simulation          layout concepts, comparisons, what-ifs
      └─ safety-operations          incidents, sensors, playbook (dispatch needs a person's approval)

Two entry points share the one graph: a site evaluation (fixed goal: a scored recommendation) and a conversation turn
(any question, with the Studio's live state). The orchestrator delegates only to the specialists a request needs, runs
independent ones in parallel (several `task` calls in one message), and re-delegates when the score reports a conflict.
"""
from __future__ import annotations

import json
import os
import re
import threading
from typing import Any, Literal

from langsmith import traceable
from pydantic import BaseModel, Field, field_validator, model_validator

from app import config
from app.sponsors.langchain.deep_agents import tools as T
from app.sponsors.langchain.deep_agents.mcp_client import MCP
from app.sponsors.langchain.deep_agents.runtime import (
    AGENT_INFO,
    CURRENT,
    LLM_COSTAR,
    ORCHESTRATOR,
    Recorder,
    Run,
    dumps,
    register,
)

ORCH_MODEL = os.getenv("PLOTSTAR_AGENT_MODEL", "claude-sonnet-5-5")
SUB_MODEL = os.getenv("PLOTSTAR_SUBAGENT_MODEL", "claude-haiku-5-5")
SUB_CALL_LIMIT = int(os.getenv("PLOTSTAR_SUBAGENT_CALL_LIMIT", "10"))  # model calls per delegated task
WORKSPACE = config.REPO_ROOT / "services" / "api" / "agent_workspace"


# ------------------------------------------------------------------------------------------- structured findings

class EvidenceRef(BaseModel):
    id: str = Field(..., description="Evidence id returned by one of your tools, e.g. E3")
    tool: str = Field("", description="The tool that returned it")
    what: str = Field("", description="What this evidence shows, in a few words")


def _listify(v: Any) -> Any:
    if v is None:
        return []
    return [v] if isinstance(v, (str, dict)) else v


_STATUS = (("insufficient", "insufficient evidence"), ("unknown", "insufficient evidence"), ("unfav", "unfavourable"),
           ("negative", "unfavourable"), ("not viable", "unfavourable"), ("mix", "mixed"), ("partial", "mixed"),
           ("fav", "favourable"), ("positive", "favourable"), ("viable", "favourable"))


class Findings(BaseModel):
    """A specialist's report back to the orchestrator."""
    objective: str = Field(..., description="The question you were asked to answer")
    summary: str = Field("", description="One-sentence conclusion")
    status: str = Field("mixed", description="One of: favourable, mixed, unfavourable, insufficient evidence")
    evidence: list[EvidenceRef] = Field(default_factory=list, description="Evidence ids your tools returned, with what each shows")
    tools_invoked: list[str] = Field(default_factory=list)
    calculations: list[str] = Field(default_factory=list, description="What was computed and by which tool (never your own arithmetic)")
    assumptions: list[str] = Field(default_factory=list)
    findings: list[str] = Field(default_factory=list, description="Key facts, each with its evidence id")
    confidence: str = Field("medium", description="One of: high, medium, low")
    confidence_reason: str = ""
    risks: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)

    # Tolerant at the boundary: spelling variants and loose shapes are normalised instead of rejected, because a
    # rejected structured response makes the model retry (a loop), and the meaning is unambiguous.
    @model_validator(mode="before")
    @classmethod
    def _recover_xml(cls, data: Any) -> Any:
        """Smaller models sometimes put the whole report, as <field>…</field> tags, inside one string field. Lift
        those tags back into their fields rather than reject (a rejection makes the model resend the same thing)."""
        if not isinstance(data, dict):
            return data
        out = dict(data)
        for v in list(data.values()):
            if isinstance(v, str) and "</" in v:
                for tag, body in re.findall(r"<([a-z_]+)>(.*?)</\1>", v, flags=re.S):
                    if tag in cls.model_fields and not out.get(tag):
                        items = re.findall(r"<(?:item|li)>(.*?)</(?:item|li)>", body, flags=re.S)
                        out[tag] = [i.strip() for i in items] if items else body.strip()
        obj = out.get("objective")
        if isinstance(obj, str) and "<" in obj:
            out["objective"] = re.sub(r"<[^>]+>.*", "", obj, flags=re.S).strip() or obj[:200]
        if not out.get("summary"):
            f = out.get("findings")
            out["summary"] = (f[0] if isinstance(f, list) and f else f if isinstance(f, str) else "") or "See findings."
        return out

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, v: Any) -> str:
        t = str(v or "").strip().lower()
        return next((canon for key, canon in _STATUS if key in t), "mixed")

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, v: Any) -> str:
        t = str(v or "").strip().lower()
        return "high" if t.startswith("h") else "low" if t.startswith("l") else "medium"

    @field_validator("tools_invoked", "calculations", "assumptions", "findings", "risks", "next_steps", mode="before")
    @classmethod
    def _strings(cls, v: Any) -> list[str]:
        return [x if isinstance(x, str) else json.dumps(x, ensure_ascii=False) for x in _listify(v)]

    @field_validator("evidence", mode="before")
    @classmethod
    def _evidence(cls, v: Any) -> list[Any]:
        out = []
        for x in _listify(v):
            if isinstance(x, str):
                m = re.search(r"E\d+", x)
                out.append({"id": m.group(0) if m else x[:12], "tool": "", "what": x})
            elif isinstance(x, dict):
                out.append({"id": str(x.get("id") or x.get("evidence_id") or "?"), "tool": str(x.get("tool") or ""),
                            "what": str(x.get("what") or x.get("description") or "")})
        return out


# ------------------------------------------------------------------------------------------------ the specialists

COMMON = (
    "\n\nRules:\n"
    "- Call your tools. Every number you report must come from a tool result; never compute or estimate one yourself.\n"
    "- Cite the evidence ids (E1, E2, …) your tools return.\n"
    "- A failed tool or an unknown value is a gap: report it, do not guess.\n"
    "- Be efficient: call only the tools the task needs (usually two to four), several at once when independent.\n"
    "- Finish with your structured findings."
    + ("" if LLM_COSTAR else "\n- CoStar names, addresses, prices, rents and coordinates are withheld from you; the user sees them. "
       "Refer to the evidence id instead of guessing.")
)

SPECIALISTS: list[dict[str, Any]] = [
    dict(name="property-intelligence", title="Property Intelligence",
         role="Is this commercial property suitable for a data center? CoStar evidence over MCP.",
         description="Retrieves and analyses the CoStar record for a property over the CoStar MCP server: building, land, "
                     "valuation and comps, occupancy, submarket, neighbours, redevelopment fit and data gaps. Use first in any site evaluation.",
         tools=["get_property_intelligence", "identify_data_gaps", "find_sales_comps", "analyze_occupancy", "analyze_submarket",
                "find_adjacent_properties", "evaluate_conversion", "get_matterport_model", "site_walk_observations",
                "search_costar_properties", "find_off_market_candidates", "compare_property_portfolio"],
         skills=True,
         prompt="You are GeoStar's Property Intelligence agent. Goal: determine whether a commercial property is suitable for "
                "data center development, from CoStar evidence. For a site evaluation call get_property_intelligence and "
                "identify_data_gaps, and find_sales_comps or evaluate_conversion when the task needs value or an existing building; "
                "call site_walk_observations for the team's notes and measurements from the Matterport scan. "
                "Report land and building fit, value evidence, occupancy, redevelopment opportunity and the open diligence items."),
    dict(name="financial-feasibility", title="Financial Feasibility",
         role="Is it economically viable? Acquisition, build cost, NPV range, payback, sensitivity.",
         description="Evaluates economics: acquisition basis (CoStar underwriting), cost to build, operating and energy cost, "
                     "NPV P10/P50/P90, payback, months to power, and what-if sensitivity (e.g. cooling, capacity).",
         tools=["development_economics", "underwrite_acquisition", "find_sales_comps", "generate_investment_memo", "grid_conditions", "what_if"],
         skills=True,
         prompt="You are GeoStar's Financial Feasibility agent. Goal: evaluate economic viability. Call development_economics "
                "(the development model for the three concepts) and underwrite_acquisition (acquisition basis from CoStar comps). "
                "Report total investment, NPV P50 and its P10–P90 range, payback and months to power for the leading concept, "
                "the main cost drivers and the sensitivity the model states. For a what-if, call what_if and report the money changes."),
    dict(name="resource-infrastructure", title="Resource & Infrastructure",
         role="Can the site be powered and cooled? Power, substation, water, flood, grid.",
         description="Evaluates infrastructure feasibility: facility power demand, distance to a >=138 kV substation, water "
                     "stress and cooling water, flood exposure, the ERCOT grid day, and blockers that need utility confirmation.",
         tools=["screen_site", "resource_demand", "grid_conditions", "evaluate_conversion", "site_walk_observations", "what_if"],
         prompt="You are GeoStar's Resource & Infrastructure agent. Goal: evaluate infrastructure feasibility. Call screen_site "
                "and resource_demand; add grid_conditions for energy timing. Report facility load, substation distance, water "
                "stress and flood status, water use, and what must be confirmed by the utility (grid capacity is never known "
                "from public data). For a what-if (e.g. air vs liquid cooling), call what_if and report power and water changes."),
    dict(name="community-sustainability", title="Community & Sustainability",
         role="What does it do to the neighbours and the environment? Homes, noise, sensitive places, carbon, water.",
         description="Evaluates impacts on residents and the environment: nearest homes and their noise from the generators "
                     "(CoStar homes over MCP), schools/worship/hospitals nearby, operating and build carbon, water use, and mitigations.",
         tools=["analyze_residential_impact", "screen_site", "community_impact", "grid_conditions"],
         prompt="You are GeoStar's Community & Sustainability agent. Goal: evaluate impacts on residents and the environment. "
                "Call analyze_residential_impact and community_impact; use screen_site for sensitive places. Report the nearest "
                "homes, generator noise at the boundary and at homes, sensitive places, carbon and water, and mitigations "
                "(noise wall, setback, cooling choice)."),
    dict(name="design-simulation", title="Design & Simulation",
         role="Turn the site into layout concepts; compare them; run what-ifs.",
         description="Coordinates the layout engine: generates the three facility concepts, compares them, inspects an object "
                     "and runs what-if simulations (capacity, cooling, redundancy, storeys, setback). Results are previews.",
         tools=["generate_layouts", "compare_concepts", "inspect_object", "what_if"],
         prompt="You are GeoStar's Design & Simulation agent. Goal: turn the selected site into viable design concepts and "
                "explain their trade-offs. Use generate_layouts or compare_concepts for alternatives, inspect_object for one "
                "object, and what_if for any change. Say that changes are previews the user applies; CAD (DXF) export is in "
                "the Studio's Deliver step."),
    dict(name="safety-operations", title="Safety & Operations",
         role="Operational risk: leaks, fire, electricity and water use; response plans.",
         description="Analyses the deployed facility's protection state (sensor readings, incidents, plan, telemetry alerts) "
                     "and recommends responses from GeoStar's playbook. Cannot notify anyone; the orchestrator asks a person.",
         tools=["facility_protection_state", "safety_playbook"],
         prompt="You are GeoStar's Safety & Operations agent. Goal: analyse operational risk and recommend responses. Call "
                "facility_protection_state, then safety_playbook for each open incident kind. Report what is happening, the "
                "consequences (isolated systems, blocked routes), and the recommended response. If teams should be notified, "
                "say so in next_steps; you cannot notify anyone yourself."),
]

ORCH_PROMPT = """You are the PlotStar orchestrator for GeoStar, a site-intelligence workspace for data center developers.
You coordinate six specialist subagents with the `task` tool. You never compute or estimate a number yourself.

Specialists (subagent_type): property-intelligence, financial-feasibility, resource-infrastructure,
community-sustainability, design-simulation, safety-operations. Do not use general-purpose.

How you work:
1. Start every request with write_todos: a short plan (2-6 items) naming the specialists you will use and why.
2. Delegate only to the specialists the request needs.
3. Run independent work in parallel: put several `task` calls in ONE message.
4. Each task description must stand alone: the parcel id, the target capacity and brief, exactly what to establish, and
   "return your structured findings".
5. Specialists return JSON findings with evidence ids (E1, E2, ...). Cite those ids.

Site evaluation (when asked to evaluate or score a site):
 a. property-intelligence first.
 b. Then financial-feasibility, resource-infrastructure and community-sustainability together, in one message.
 c. Call compute_site_score.
 d. If it reports conflicts, or gaps a specialist's tool can close, re-delegate once with a targeted task, then call
    compute_site_score again.
 e. Answer.

What-ifs about the design (cooling, capacity, redundancy, storeys, setback): delegate in parallel to the specialists whose
metrics change (resource-infrastructure for power and water, financial-feasibility for money, design-simulation for the
layout); each runs what_if. Changes are previews the user applies in the Studio.

Incidents: delegate to safety-operations. To notify teams, call dispatch_safety_alert; a person must approve it.

Final answer: plain language, under 170 words. For an evaluation: the verdict and score from compute_site_score, the two
or three reasons that matter most with evidence ids, what is unknown, and next steps. Use only numbers that appear in tool
or specialist results. Do not use the file tools unless a result is too long to keep in context."""


def _model(slug: str, title: str, role: str, model: str) -> Any:
    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(model=model, max_tokens=4096, timeout=120, max_retries=2, name=f"Model / {title}",
                         tags=["model", f"agent:{slug}"],
                         metadata={"agent_name": slug, "agent_role": role, "model_provider": "anthropic", "model_name": model})


def _register_info() -> None:
    AGENT_INFO[ORCHESTRATOR] = dict(title="PlotStar Orchestrator", role="Plans, delegates, scores and answers.", model=ORCH_MODEL)
    for s in SPECIALISTS:
        AGENT_INFO[s["name"]] = dict(title=s["title"], role=s["role"], model=SUB_MODEL)
    AGENT_INFO["general-purpose"] = dict(title="General purpose", role="Deep Agents default subagent.", model=ORCH_MODEL)


_register_info()

_GRAPH: dict[str, Any] = {}
_GRAPH_LOCK = threading.Lock()


def _checkpointer() -> tuple[Any, str]:
    from app.sponsors.mongodb import mongo
    d = mongo.db()
    if d is not None:
        try:
            from langgraph.checkpoint.mongodb import MongoDBSaver
            return MongoDBSaver(d.client, db_name=config.MONGODB_DB, checkpoint_collection_name="agent_checkpoints",
                                writes_collection_name="agent_checkpoint_writes", ttl=mongo.CHECKPOINT_TTL_S), "MongoDB Atlas"
        except Exception:  # noqa: BLE001
            pass
    from langgraph.checkpoint.memory import InMemorySaver
    return InMemorySaver(), "process memory"


def graph() -> Any:
    """The compiled orchestrator (one per process; tools find their run through a context variable)."""
    with _GRAPH_LOCK:
        if "g" in _GRAPH:
            return _GRAPH["g"]
        from deepagents import FilesystemPermission, create_deep_agent
        from deepagents.backends import FilesystemBackend
        from langchain.agents.middleware import ModelCallLimitMiddleware, TodoListMiddleware
        G, C = T.geostar_tools(), T.costar_tools()
        missing: list[str] = []

        def pick(names: list[str]) -> list[Any]:
            out = []
            for n in names:
                t = C.get(n) or G.get(n)
                (out.append(t) if t else missing.append(n))
            return out

        subagents = []
        for s in SPECIALISTS:
            spec: dict[str, Any] = dict(name=s["name"], description=s["description"], system_prompt=s["prompt"] + COMMON,
                                        tools=pick(s["tools"]), model=_model(s["name"], s["title"], s["role"], SUB_MODEL),
                                        response_format=Findings,
                                        middleware=[ModelCallLimitMiddleware(run_limit=SUB_CALL_LIMIT, exit_behavior="end")])
            if s.get("skills"):
                spec["skills"] = ["/deep_skills/"]
            subagents.append(spec)
        saver, where = _checkpointer()
        g = create_deep_agent(
            model=_model(ORCHESTRATOR, "Orchestrator", "Plans, delegates, scores and answers.", ORCH_MODEL),
            tools=[G["compute_site_score"], G["dispatch_safety_alert"]],
            system_prompt=ORCH_PROMPT, middleware=[TodoListMiddleware()], subagents=subagents,
            skills=["/deep_skills/"], memory=["/memory/AGENTS.md"],
            backend=FilesystemBackend(root_dir=str(WORKSPACE), virtual_mode=True),
            permissions=[FilesystemPermission(operations=["write"], paths=["/memory/**", "/deep_skills/**", "/skills/**"], mode="deny")],
            interrupt_on={"dispatch_safety_alert": True}, checkpointer=saver, name=ORCHESTRATOR)
        _GRAPH.update(g=g, memory=where, missing=missing, tools={k: [t.name for t in pick(s["tools"])] for k, s in
                                                                  ((s["name"], s) for s in SPECIALISTS)})
        return g


# --------------------------------------------------------------------------------------------------- execution

def _brief_line(b: dict[str, Any]) -> str:
    return (f"{b.get('mw_it')} MW IT at {b.get('rack_kw')} kW per rack, {b.get('redundancy')}, {b.get('cooling')} cooling, "
            f"{b.get('storeys') or 1} storey(s); site rectangle {b.get('site_w')} x {b.get('site_d')} m, setback {b.get('setback_m')} m")


def _site_line(req: dict[str, Any]) -> str:
    s = req.get("site") or {}
    pid = s.get("id") or "no site chosen"
    extra = f" ({s.get('name')})" if LLM_COSTAR and s.get("name") else ""
    return f"{pid}{extra} in {req.get('market') or 'Houston'}"


def _ctx(req: dict[str, Any]) -> Any:
    from app.sponsors.langchain import copilot
    from app.routers.studio import _grid
    return copilot.Ctx(req, _grid)


def start_site_evaluation(req: dict[str, Any], stage: str | None = None) -> Run:
    pid = (req.get("site") or {}).get("id")
    run = register(Run("site-evaluation", f"Evaluate {pid} for a data center", req))
    run.ctx = _ctx(req)
    prio = req.get("priorities") or {}
    msg = (f"Evaluate this site for a data center and give a scored recommendation.\n"
           f"Site: {_site_line(req)}.\nTarget: {_brief_line(req.get('brief') or {})}.\n"
           + (f"Priorities (0-4): {', '.join(f'{k} {v:g}' for k, v in prio.items())}.\n" if prio else "")
           + f"Workflow stage: {stage or 'Define'}.\nFollow the site evaluation procedure.")
    _launch(run, msg, f"eval-{run.id}", "PlotStar / Site Evaluation", stage or "Define")
    return run


def start_chat(question: str, req: dict[str, Any], thread_id: str, stage: str | None = None) -> Run:
    run = register(Run("conversation", question[:120], req))
    run.ctx = _ctx(req)
    sc = req.get("last_score") or {}
    msg = ("[GeoStar workspace]\n"
           f"Stage: {stage or 'Studio'}. Site: {_site_line(req)}.\n"
           f"Brief: {_brief_line(req.get('brief') or {})}.\n"
           + (f"Active concept: {req.get('concept_id')}. " if req.get("concept_id") else "")
           + (f"Selected object: {req.get('selected')}. " if req.get("selected") else "")
           + (f"Latest site score: {sc.get('verdict')} {sc.get('score')}. " if sc.get("verdict") else "")
           + ("Deployed facility: yes. " if req.get("facility_id") else "")
           + f"\n\n[Question]\n{question}")
    _launch(run, msg, thread_id, "PlotStar / Conversation", stage or "Studio")
    return run


def _launch(run: Run, message: str, thread_id: str, root_name: str, stage: str) -> None:
    run.thread_id = thread_id
    threading.Thread(target=_execute, args=(run, message, thread_id, root_name, stage), name=f"agent-{run.id}", daemon=True).start()


def _execute(run: Run, message: str, thread_id: str, root_name: str, stage: str) -> None:
    from langchain_core.messages import HumanMessage
    from langgraph.types import Command
    token = CURRENT.set(run)
    try:
        run.emit("started", kind=run.kind, title=run.title, message=message)
        g = graph()
        pid = (run.context.get("site") or {}).get("id")
        cfg: dict[str, Any] = {
            "configurable": {"thread_id": thread_id}, "callbacks": [Recorder(run, root_name)], "run_name": root_name,
            "recursion_limit": 150, "tags": ["plotstar", "deep-agents", run.kind],
            # run-wide context only: LangSmith copies root metadata onto every child run, so agent identity lives on
            # each model (agent_name, agent_role, model_name) and in the SDK's lc_agent_name / ls_agent_type
            "metadata": {"workflow_stage": stage, "property_id": pid, "scenario_id": run.id, "run_kind": run.kind,
                         "orchestrator_model": ORCH_MODEL, "subagent_model": SUB_MODEL}}
        payload: Any = {"messages": [HumanMessage(message)]}
        while True:
            for _ in g.stream(payload, cfg, stream_mode="updates"):
                pass
            state = g.get_state(cfg)
            pending = [i for t in (state.tasks or ()) for i in (t.interrupts or ())]
            if not pending:
                break
            reqs = []
            for i in pending:
                v = i.value if isinstance(i.value, dict) else {}
                reqs += [dict(name=a.get("name"), args=a.get("args"), description=a.get("description"))
                         for a in (v.get("action_requests") or [])]
            decision = run.request_approval(reqs)
            payload = Command(resume={"decisions": [decision for _ in (reqs or [None])]})
        msgs = state.values.get("messages") or []
        run.answer = next((_text(m.content) for m in reversed(msgs) if getattr(m, "type", "") == "ai" and _text(m.content)), "")
        run.verification = verify(run)
        run.emit("answer", answer=run.answer, verification=run.verification, proposal=run.proposal)
        run.set_status("done")
    except Exception as e:  # noqa: BLE001
        run.error = f"{type(e).__name__}: {e}"
        run.emit("error", error=run.error)
        run.set_status("error")
    finally:
        CURRENT.reset(token)


def _text(c: Any) -> str:
    if isinstance(c, str):
        return c.strip()
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()
    return ""


# -------------------------------------------------------------------------------------------------- verification

_NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _nums(text: str) -> list[float]:
    out = []
    for n in _NUM.findall(text):
        try:
            out.append(float(n.replace(",", "")))
        except ValueError:
            pass
    return out


@traceable(run_type="chain", name="Verify / Evidence and numbers", tags=["verification", "deterministic"])
def verify(run: Run) -> dict[str, Any]:
    """Every number in the answer must match a number the tools returned (allowing rounding and $M / k scaling), and
    every evidence id cited by the answer or a specialist must exist. Flags, never rewrites."""
    answer = run.answer or ""
    pool_text = " ".join([dumps(e["view"]) for e in run.evidence.values()] + [dumps(run.score or {}), dumps(run.findings),
                                                                             dumps(run.context.get("brief") or {}), run.title])
    pool = set(_nums(pool_text))
    scaled = pool | {p / 1e6 for p in pool} | {p / 1e3 for p in pool} | {p * 100 for p in pool if abs(p) <= 1.5}

    def ok(x: float) -> bool:
        ax = abs(x)
        if ax <= 10 and float(x).is_integer():
            return True
        return any(abs(ax - abs(y)) <= max(0.51, 0.006 * abs(y)) for y in scaled)

    stray = sorted({n for n in _nums(re.sub(r"\bE\d+\b", "", answer)) if not ok(n)})
    cited = sorted(set(re.findall(r"\bE\d+\b", answer)))
    f_cited = {r["id"] for f in run.findings.values() for r in (f.get("evidence") or []) if isinstance(r, dict) and r.get("id")}
    unknown = sorted((set(cited) | f_cited) - set(run.evidence))
    return dict(grounded=not stray and not unknown, numbers_checked=len(_nums(answer)), unverified_numbers=stray[:8],
                cited=cited, unknown_citations=unknown,
                note=("Every number in the answer matches a tool result." if not stray else
                      f"{len(stray)} number(s) in the answer do not match any tool result; treat them with care.")
                + (f" Unknown evidence ids: {', '.join(unknown)}." if unknown else ""))


# --------------------------------------------------------------------------------------------------- architecture

def architecture() -> dict[str, Any]:
    from importlib.metadata import version

    from app.sponsors.langchain.deep_agents import scoring
    MCP.ensure(timeout=10)
    try:
        graph()
    except Exception as e:  # noqa: BLE001
        _GRAPH.setdefault("error", f"{type(e).__name__}: {e}")
    tools_by = _GRAPH.get("tools") or {}
    allt = {**T.geostar_tools(), **T.costar_tools()}

    def tinfo(n: str) -> dict[str, Any]:
        t = allt.get(n)
        md = (t.metadata or {}) if t else {}
        return dict(name=n, display=md.get("display_name", n), provider=md.get("tool_provider", "geostar"), kind=md.get("kind"),
                    available=t is not None)

    agents = [dict(name=ORCHESTRATOR, title="PlotStar Orchestrator", role="Plans, delegates, scores and answers.", model=ORCH_MODEL,
                   kind="orchestrator", tools=[tinfo("compute_site_score"), tinfo("dispatch_safety_alert"),
                                               dict(name="task", display="Delegate to a subagent", provider="deepagents", kind="delegation", available=True),
                                               dict(name="write_todos", display="Plan", provider="deepagents", kind="planning", available=True)],
                   skills=["site-scoring", "costar-evidence"], approval=["dispatch_safety_alert"])]
    for s in SPECIALISTS:
        agents.append(dict(name=s["name"], title=s["title"], role=s["role"], description=s["description"], model=SUB_MODEL,
                           kind="subagent", tools=[tinfo(n) for n in tools_by.get(s["name"], s["tools"])],
                           skills=["site-scoring", "costar-evidence"] if s.get("skills") else [], output="Findings (structured)"))
    on = bool(os.getenv("LANGSMITH_API_KEY")) and os.getenv("LANGSMITH_TRACING", "").lower() == "true"
    return dict(
        sdk={"deepagents": version("deepagents"), "langgraph": version("langgraph"), "langchain": version("langchain")},
        harness=["create_deep_agent orchestrator", "subagents via task (isolated context, structured response)",
                 "TodoListMiddleware planning", "skills (progressive disclosure)", "memory (AGENTS.md)",
                 "filesystem backend with write permissions denied on memory and skills",
                 "summarization and Anthropic prompt caching (SDK defaults)", f"checkpointer: {_GRAPH.get('memory') or 'not started'}",
                 "human-in-the-loop: interrupt_on dispatch_safety_alert"],
        agents=agents, mcp=MCP.status(), scoring=scoring.method(), privacy={"costar_fields_to_model": LLM_COSTAR},
        langsmith={"tracing": on, "project": os.getenv("LANGSMITH_PROJECT") or "default"},
        missing_tools=_GRAPH.get("missing") or [], error=_GRAPH.get("error"))
