"""The agent that explains each decision (PRD A-1, LangChain deep bet).

Rule: the optimizer decides, the model explains. The agent may only cite numbers returned by its tools.
With ANTHROPIC_API_KEY (or AWS credentials + BEDROCK_MODEL_ID) set, a LangChain Deep Agent runs with the
tools below. Without credentials, `explain()` returns a deterministic explanation built from the same tool
outputs, labeled model="deterministic", so the screen is never blank and nothing is invented.
"""
from __future__ import annotations

import json
import os
from typing import Any

from app import config
from app.engine import grid as G
from app.engine import optimizer as O
from app.db import session

SYSTEM = (
    "You are GeoStar's explainer for data-center siting. The optimizer has already decided; your job is to explain "
    "the decision in plain language for a non-expert in under 180 words. Use ONLY numbers returned by your tools, "
    "quote them with their labels (Sourced / Estimated / Simulated), and say what is a scenario assumption. "
    "Never invent prices, capacities or savings. If a question needs a number you do not have, say so. "
    "For any what-if question (prices, carbon price, flexible share, MW, utility firm capacity at a site), call "
    "run_what_if so the real optimizer recalculates; never estimate the effect yourself. firm_capacity is a map of "
    "site_id to the share of requested power the utility can supply, e.g. {\"costar:123\": 0.7}."
)


# ----------------------------------------------------------------------------- tools (plain functions)

def tool_get_run(run_id: str) -> dict[str, Any]:
    """Optimizer run: GeoStar pick vs cost-first pick, deltas, rejected sites, grid-day labels."""
    loaded = O.load_run(run_id)
    if not loaded:
        return {"error": "unknown run_id"}
    req, res = loaded
    slim = lambda c: None if not c else {k: c[k] for k in (  # noqa: E731
        "site_id", "site_name", "cooling", "f", "d", "firm_capacity_share", "firm_capacity_basis", "land",
        "energy_cost_year", "co2_est_t_year", "peak_mw", "cost", "stress_hours")}
    return {"request": {k: req.get(k) for k in ("mw_it", "flexible_share", "price_multiplier", "carbon_price_per_t", "market")},
            "optimized": slim(res["optimized"]), "baseline": slim(res["baseline"]),
            "without_flexibility": slim(res.get("inflexible")) if "inflexible" in res else "not computed", "delta": res["delta"],
            "rejected": res["rejected"][:8], "labels": res["labels"], "notes": res["feasibility_notes"],
            "grid": {k: res["grid"].get(k) for k in ("price_label", "carbon_label", "price_date", "carbon_date", "hub")}}


def tool_site_checks(parcel_id: str) -> dict[str, Any]:
    """Hard-gate results and power signals for one CoStar parcel (from the last search that screened it)."""
    with session() as c:
        row = c.execute("SELECT name, address, lot_acres, availability, asking_price_low, last_sale_price, "
                        "last_sale_status FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    return dict(row) if row else {"error": "unknown parcel"}


def tool_grid_day() -> dict[str, Any]:
    """The cached ERCOT day: hourly prices (Sourced) and carbon proxy (Estimated), with min/max hours."""
    gd = G.grid_day(offline=True)
    p, cb = gd["price"], gd["carbon"]
    return {"hub": gd["hub"], "price_label": gd["price_label"], "price_date": gd["price_date"],
            "cheapest_hour": int(min(range(24), key=lambda h: p[h])), "dearest_hour": int(max(range(24), key=lambda h: p[h])),
            "price_min": min(p), "price_max": max(p), "carbon_label": gd["carbon_label"],
            "cleanest_hour": int(min(range(24), key=lambda h: cb[h])), "dirtiest_hour": int(max(range(24), key=lambda h: cb[h])),
            "carbon_min": min(cb), "carbon_max": max(cb)}


def tool_run_what_if(run_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Re-run the real optimizer from an existing run with changed inputs. Returns the new run (slim)."""
    from app.routers.optimize import ScenarioIn, scenario

    allowed = {"price_multiplier", "carbon_price_per_t", "flexible_share", "mw_it", "delay_months", "firm_capacity"}
    clean = {k: v for k, v in (changes or {}).items() if k in allowed}
    if not clean:
        return {"error": f"no valid change; allowed keys: {sorted(allowed)}"}
    try:
        res = scenario(ScenarioIn(run_id=run_id, changes=clean))
    except Exception as e:  # validation or unknown run
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    out = tool_get_run(res["run_id"])
    out["new_run_id"], out["changes_applied"] = res["run_id"], clean
    return out


TOOLS = {"get_run": tool_get_run, "site_checks": tool_site_checks, "grid_day": tool_grid_day, "run_what_if": tool_run_what_if}


# ----------------------------------------------------------------------------- deterministic explainer

def _h(h: int) -> str:
    return "12 am" if h == 0 else "12 pm" if h == 12 else f"{h} am" if h < 12 else f"{h - 12} pm"


def deterministic(run_id: str, question: str | None) -> dict[str, Any]:
    trace = []
    run = tool_get_run(run_id)
    trace.append({"tool": "get_run", "args": {"run_id": run_id}, "ok": "error" not in run})
    if "error" in run:
        return {"answer": "I don't have that run. Search again and ask about the new result.", "trace": trace, "model": "deterministic"}
    gd = tool_grid_day()
    trace.append({"tool": "grid_day", "args": {}, "ok": True})
    o, b, d, r = run["optimized"], run["baseline"], run["delta"], run["request"]
    if not o:
        return {"answer": "No site can run this project with the current limits. Loosen a must-have or lower the MW and search again.",
                "trace": trace, "model": "deterministic"}
    parts = [f"GeoStar picks {o['site_name']} for {r['mw_it']:g} MW: {o['cooling']} cooled, "
             + (f"easing off {o['d']:.0%} of load for about {o['f'] * 8760:.0f} hours a year when the grid is stressed. "
                if o["f"] > 0 else "full power all year. ")]
    parts.append(f"Heavy jobs move into the cleanest, cheapest hours: on the ERCOT {gd['price_date']} day ({gd['price_label']}) "
                 f"power is cheapest around {_h(gd['cheapest_hour'])} (${gd['price_min']:.0f}/MWh) and cleanest around "
                 f"{_h(gd['cleanest_hour'])} ({gd['carbon_min']:.0f} kg/MWh, {gd['carbon_label']}), "
                 f"against {gd['carbon_max']:.0f} kg/MWh at the dirtiest hour.")
    if b and d:
        if d["same_site"]:
            parts.append(f"The cost-first method picks the same site, so the difference is how it runs: about "
                         f"{d['co2_est_t_year']:,.0f} t less CO₂ a year and ${abs(d['cost']):,.0f} "
                         f"{'less' if d['cost'] >= 0 else 'more'} over ten years (Estimated).")
        else:
            parts.append(f"Cost-first would pick {b['site_name']} with a flat schedule. GeoStar's plan saves about "
                         f"{d['co2_est_t_year']:,.0f} t CO₂ a year and ${abs(d['cost']):,.0f} over ten years (Estimated)"
                         + (f"; it needs flexibility because that site's firm power is a scenario at {o['firm_capacity_share']:.0%} of the request (Simulated)." if o["f"] > 0 else "."))
    if run["rejected"]:
        names = {}
        for x in run["rejected"]:
            names.setdefault(x["name"], x["gate"])
        top = list(names.items())[:3]
        parts.append("Sites rejected by a hard gate, whatever their price: " + "; ".join(f"{n} ({g.lower()})" for n, g in top) + ".")
    parts.append("Firm grid capacity and interconnection cost are scenarios until a utility confirms them.")
    if question:
        parts.append(f"(You asked: \"{question[:120]}\". Without a model key I can only explain the run above.)")
    return {"answer": " ".join(parts), "trace": trace, "model": "deterministic"}


# ----------------------------------------------------------------------------- LangChain deep agent

def _llm():
    if config.ANTHROPIC_API_KEY:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5"), api_key=config.ANTHROPIC_API_KEY,
                             max_tokens=800), "anthropic"
    from app.sponsors.amazon import bedrock
    if bedrock.configured():
        return bedrock.chat_model(), "bedrock"
    return None, None


def tool_search_sites(market: str = "Houston", min_acres: float = 2, only_passing: bool = False) -> dict[str, Any]:
    """Screened CoStar candidate properties in a market (top 15 by score), with the failing gate where there is one."""
    from app.routers.screen import Filters, SearchIn, run_search

    if market not in ("Houston", "Los Angeles"):
        return {"error": "market must be Houston or Los Angeles (the CoStar extract covers only these)"}
    res = run_search(SearchIn(market=market, filters=Filters(min_acres=min_acres, hide_failed=only_passing), limit=150), offline=True)
    rows = []
    for s in res["sites"][:15]:
        fail = next((g for g in s["screen"]["gates"] if g["status"] == "Fail"), None)
        sub = s["screen"]["power"].get("nearest_substation") or {}
        rows.append({"site_id": s["id"], "name": s["name"], "acres": s["lotAcres"], "acquisition_usd": s["landCost"],
                     "acquisition_label": s["labels"]["landCost"], "screen": s["screen"]["status"],
                     "failed_gate": fail and f"{fail['gate']}: {fail['reason']}", "substation_km": sub.get("distance_km"),
                     "score": s["pillars"]["overall"]})
    return {"market": market, "total": res["count"], "counts": res["counts"], "top": rows}


def tool_site_detail(parcel_id: str) -> dict[str, Any]:
    """Screening gates, power signals and scores for one CoStar property."""
    from app.engine.screening import Thresholds
    from app.engine.siting import assemble

    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not row:
        return {"error": "unknown parcel id; ids look like costar:235279"}
    p = dict(row)
    s = assemble(p["market"], [p], Thresholds(), offline=True)[0]
    return {"site_id": s["id"], "name": s["name"], "address": s["area"], "lat": s["lat"], "lon": s["lng"], "acres": s["lotAcres"],
            "availability": s["availability"], "acquisition_usd": s["landCost"], "acquisition_basis": s["landCostBasis"],
            "screen": s["screen"]["status"],
            "gates": [{k: g[k] for k in ("gate", "status", "value", "limit", "label", "reason")} for g in s["screen"]["gates"]],
            "power": {k: s["screen"]["power"].get(k) for k in ("building_service_mw", "nearest_substation", "residential_within_1mi", "requires_utility_confirmation")},
            "provenance": s["provenance"]}


def tool_local_conditions(lat: float, lon: float) -> dict[str, Any]:
    """Climate (Open-Meteo), solar yield (NREL PVWatts), households nearby (US Census), retail power price (EIA)."""
    from app.routers.context import context

    return context(lat, lon, "CA" if lon < -110 else "TX")


def tool_run_optimizer(mw_it: float, flexible_share: float = 0.3, market: str = "Houston") -> dict[str, Any]:
    """Run the joint site + cooling + schedule optimizer from scratch. Returns the new run (slim) and its run_id."""
    from app.routers.optimize import OptimizeIn, _run

    try:
        res = _run(OptimizeIn(market=market, mw_it=mw_it, flexible_share=flexible_share, carbon_price_per_t=50, offline=True))
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    out = tool_get_run(res["run_id"])
    out["run_id"] = res["run_id"]
    return out


CHAT_SYSTEM = (
    "You are GeoStar's research agent for data-center site selection, working for a developer's site-selection team. "
    "You answer by calling tools; the optimizer and screening code produce every number. Rules: "
    "(1) Use ONLY numbers returned by tools and say whether each is Sourced, Estimated or Simulated when it matters. "
    "(2) For any what-if, call run_what_if or run_optimizer; never estimate an effect yourself. "
    "(3) Grid capacity is never confirmed by public data: say 'requires utility confirmation'. "
    "(4) For questions that need several steps, write a short plan with write_todos first, and delegate property "
    "research to the site-researcher and scenario work to the scenario-analyst with the task tool. "
    "(5) Answer in plain language, under 200 words, leading with the conclusion. If a tool lacks a number, say so."
)


def _text(content: Any) -> str:
    if isinstance(content, list):
        return " ".join(x.get("text", "") for x in content if isinstance(x, dict)).strip()
    return str(content or "").strip()


_SANDBOX: dict[str, Any] = {}


def _sandbox_backend() -> Any:
    """A LangSmith sandbox for agent-written analysis code. Off unless LANGSMITH_API_KEY and PLOTSTAR_SANDBOX=1.
    Written against langsmith.sandbox / deepagents.backends.LangSmithSandbox; NOT yet run against a real account."""
    if not (os.getenv("LANGSMITH_API_KEY") and os.getenv("PLOTSTAR_SANDBOX") == "1"):
        return None
    if "backend" not in _SANDBOX:
        try:
            from deepagents.backends import LangSmithSandbox
            from langsmith.sandbox import SandboxClient

            client = SandboxClient(api_key=os.getenv("LANGSMITH_API_KEY"))
            box = client.create_sandbox(snapshot=os.getenv("PLOTSTAR_SANDBOX_SNAPSHOT") or None, name="plotstar-agent", idle_ttl_seconds=1800)
            _SANDBOX["backend"] = LangSmithSandbox(box)
        except Exception as e:  # never block the agent on sandbox setup
            _SANDBOX["backend"], _SANDBOX["error"] = None, f"{type(e).__name__}: {str(e)[:160]}"
    return _SANDBOX["backend"]


WORKSPACE = config.REPO_ROOT / "services" / "api" / "agent_workspace"
_AGENT: dict[str, Any] = {}


def tool_trigger_grid_event(duration_s: float = 20) -> dict[str, Any]:
    """Start a grid event on the live test rig at the depth the current plan relies on."""
    from app.engine import livegrid as L

    plan = L.STATE.plan
    depth = float(plan["d"]) if plan and plan.get("d") else 0.3
    e = L.start_emergency(max(3.0, min(float(duration_s), 120.0)), depth, "software")
    return {"started": e.active, "facility_depth": depth, "duration_s": duration_s, "site": plan and plan.get("site")}


def build_agent(llm: Any) -> Any:
    """Deep agent: planning, two sub-agents, memory + skills on a filesystem backend, a LangGraph checkpointer
    for threads, and human approval (interrupt) before it may trigger a grid event."""
    from deepagents import create_deep_agent
    from deepagents.backends import FilesystemBackend
    from langchain_core.tools import tool
    from langgraph.checkpoint.memory import InMemorySaver

    @tool
    def get_run(run_id: str) -> str:
        """An optimizer run: recommended plan, cost-first plan, without-flexibility plan, deltas, rejected sites."""
        return json.dumps(tool_get_run(run_id))

    @tool
    def run_what_if(run_id: str, changes_json: str) -> str:
        """Re-run the optimizer from run_id with changed inputs. changes_json is a JSON object with any of:
        price_multiplier, carbon_price_per_t, flexible_share (0-1), mw_it, firm_capacity ({site_id: share 0-1})."""
        try:
            changes = json.loads(changes_json)
        except ValueError:
            return json.dumps({"error": "changes_json must be a JSON object"})
        return json.dumps(tool_run_what_if(run_id, changes))

    @tool
    def run_optimizer(mw_it: float, flexible_share: float = 0.3, market: str = "Houston") -> str:
        """Run the joint optimizer from scratch for a capacity (MW IT), flexible share (0-1) and market."""
        return json.dumps(tool_run_optimizer(mw_it, flexible_share, market))

    @tool
    def grid_day() -> str:
        """The cached ERCOT day: price and carbon extremes with labels."""
        return json.dumps(tool_grid_day())

    @tool
    def search_sites(market: str = "Houston", min_acres: float = 2, only_passing: bool = False) -> str:
        """Screened CoStar candidate properties in Houston or Los Angeles, top 15 by score."""
        return json.dumps(tool_search_sites(market, min_acres, only_passing))

    @tool
    def site_detail(parcel_id: str) -> str:
        """Gates, power signals, acquisition basis and provenance for one property id such as costar:235279."""
        return json.dumps(tool_site_detail(parcel_id))

    @tool
    def local_conditions(lat: float, lon: float) -> str:
        """Climate, solar yield, households within a mile and retail power price at a point."""
        return json.dumps(tool_local_conditions(lat, lon))

    @tool
    def trigger_grid_event(duration_s: float = 20) -> str:
        """Start a grid event on the live test machines (they cut load to the plan's depth). Needs human approval."""
        return json.dumps(tool_trigger_grid_event(duration_s))

    research = [search_sites, site_detail, local_conditions]
    scenario = [get_run, run_what_if, run_optimizer, grid_day]
    subagents = [
        {"name": "site-researcher", "description": "Finds and compares CoStar properties and explains why a property passes or fails screening.",
         "system_prompt": "You research candidate properties. Use the tools; report gates with their values, limits and labels. "
                          "Never invent a price or a capacity. Return a compact summary.", "tools": research},
        {"name": "scenario-analyst", "description": "Runs the optimizer and what-if scenarios and compares plans against cost-first planning.",
         "system_prompt": "You run scenarios with the real optimizer. Always call a tool for a what-if. Report the recommended "
                          "site, 10-year cost, CO2 and whether the recommendation changed. Return a compact summary.", "tools": scenario},
    ]
    sandbox = _sandbox_backend()
    prompt = CHAT_SYSTEM + (" You can start a grid event on the live test rig with trigger_grid_event when the user asks to "
                            "test or demonstrate the plan; a person must approve it first.")
    kwargs: dict[str, Any] = dict(model=llm, tools=research + scenario + [trigger_grid_event], subagents=subagents,
                                  checkpointer=InMemorySaver(), interrupt_on={"trigger_grid_event": True})
    if sandbox is not None:
        prompt += (" You also have a LangSmith sandbox: for analysis the tools do not cover, save tool output with "
                   "write_file and run Python with execute. Say when a figure came from your own sandbox calculation.")
        kwargs["backend"] = sandbox
    else:
        kwargs.update(backend=FilesystemBackend(root_dir=str(WORKSPACE), virtual_mode=True),
                      memory=["/memory/AGENTS.md"], skills=["/skills/"])
    return create_deep_agent(system_prompt=prompt, **kwargs)


def _agent(llm: Any) -> Any:
    if "graph" not in _AGENT:      # one compiled graph per process so the checkpointer keeps every thread
        _AGENT["graph"] = build_agent(llm)
    return _AGENT["graph"]


OUR_TOOLS = {"get_run", "run_what_if", "run_optimizer", "grid_day", "search_sites", "site_detail", "local_conditions",
             "trigger_grid_event", "task", "write_todos", "write_file", "read_file", "ls"}
QUIET = {"write_todos"}


def stream_chat(messages: list[dict[str, str]], run_id: str | None, thread_id: str | None = None,
                resume: str | None = None):
    """Yield events: plan, tool, result, approval, answer, error.

    thread_id keeps the conversation in the LangGraph checkpointer, so only the new message is sent each turn.
    resume ('approve' | 'reject') continues a run paused for human approval.
    """
    import uuid

    llm, kind = _llm()
    if llm is None:
        if run_id:
            det = deterministic(run_id, messages[-1]["content"] if messages else None)
            for t in det["trace"]:
                yield {"type": "tool", "name": t["tool"], "args": t.get("args")}
            yield {"type": "answer", "text": det["answer"], "model": "deterministic"}
        else:
            yield {"type": "answer", "text": "No language model is configured and there is no optimizer run to explain yet.", "model": "deterministic"}
        return
    try:
        from langgraph.types import Command

        agent = _agent(llm)
        cfg = {"configurable": {"thread_id": thread_id or uuid.uuid4().hex}, "recursion_limit": 60}
        if resume:
            decision = {"type": "approve"} if resume == "approve" else {"type": "reject", "message": "The user declined. Do not retry; say it was not run."}
            payload: Any = Command(resume={"decisions": [decision]})
        else:
            text = messages[-1]["content"]
            if run_id:
                text = f"(Current optimizer run_id: {run_id}.) {text}"
            # with a thread the checkpointer already holds earlier turns; without one, replay what the client sent
            payload = {"messages": [{"role": "user", "content": text}] if thread_id else [*messages[:-1], {"role": "user", "content": text}]}
        final = ""
        for update in agent.stream(payload, stream_mode="updates", config=cfg):
            for node, delta in (update or {}).items():
                if node == "__interrupt__":
                    actions = []
                    for intr in delta or []:
                        for a in (getattr(intr, "value", None) or {}).get("action_requests", []):
                            actions.append({"name": a.get("name"), "args": a.get("args")})
                    yield {"type": "approval", "actions": actions}
                    return
                if not isinstance(delta, dict):
                    continue
                if delta.get("todos"):
                    yield {"type": "plan", "todos": [{"content": t.get("content"), "status": t.get("status")} for t in delta["todos"]]}
                for m in delta.get("messages") or []:
                    kind_m = m.__class__.__name__
                    if kind_m == "AIMessage":
                        for tc in getattr(m, "tool_calls", None) or []:
                            if tc.get("name") in OUR_TOOLS - QUIET:
                                yield {"type": "tool", "name": tc["name"], "args": tc.get("args")}
                        if _text(m.content) and not getattr(m, "tool_calls", None):
                            final = _text(m.content)
                    elif kind_m == "ToolMessage" and getattr(m, "name", "") in OUR_TOOLS - QUIET:
                        yield {"type": "result", "name": m.name, "chars": len(_text(m.content))}
        yield {"type": "answer", "text": final or "The agent finished without an answer.", "model": kind}
    except Exception as e:
        yield {"type": "error", "text": f"{type(e).__name__}: {str(e)[:200]}"}


def explain(run_id: str, question: str | None = None) -> dict[str, Any]:
    """One-shot explanation of a run (used by the recommendation screen, read-aloud and the evaluation harness)."""
    trace, answer, model, err = [], "", "deterministic", None
    for ev in stream_chat([{"role": "user", "content": question or "Explain this decision to a non-expert in under 180 words."}], run_id):
        if ev["type"] == "tool":
            trace.append({"tool": ev["name"], "args": ev.get("args"), "ok": True})
        elif ev["type"] == "answer":
            answer, model = ev["text"], ev["model"]
        elif ev["type"] == "error":
            err = ev["text"]
    if err or not answer:
        det = deterministic(run_id, question)
        det["model_error"] = err or "empty answer"
        return det
    return {"answer": answer, "trace": trace, "model": model}
