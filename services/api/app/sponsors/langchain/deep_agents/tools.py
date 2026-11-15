"""The tools each GeoStar agent may call.

CoStar tools are called over MCP (mcp_client.MCP) against GeoStar's CoStar MCP server. GeoStar tools wrap the same
deterministic engines the Studio uses: site screening (FEMA, WRI, OpenStreetMap, CoStar homes), the ERCOT grid day, the
layout engine (money, people, planet, resources per concept), what-ifs, and the protection state of a deployed site.

Every tool records its full output as evidence on the current run and returns a JSON *view* to the model with an
`evidence_id` the agent cites. Tools never make up a value: a failed lookup returns ok=false and the reason.
"""
from __future__ import annotations

import os
import time
from typing import Any, Literal

from langchain_core.tools import BaseTool, StructuredTool
from langsmith import traceable
from pydantic import BaseModel, Field

from app.engine import assumptions as A
from app.sponsors.langchain import copilot
from app.sponsors.langchain.deep_agents import scoring
from app.sponsors.langchain.deep_agents.mcp_client import MCP
from app.sponsors.langchain.deep_agents.runtime import CURRENT, LLM_COSTAR, Run, costar_view, dumps

NEXT_URL = os.getenv("PLOTSTAR_WEB_URL", "http://127.0.0.1:3000")


def _run() -> Run:
    r = CURRENT.get()
    if r is None:
        raise RuntimeError("GeoStar agent tools run inside an agent run")
    return r


def _reply(tool: str, data: Any, view: dict[str, Any], *, provider: str = "geostar", label: str | None = None,
           sources: list[str] | None = None, headline: str | None = None, redacted: bool = False) -> str:
    run = _run()
    eid = run.add_evidence(tool, provider, data, view, label=label, sources=sources, redacted=redacted)
    return dumps({"ok": True, "evidence_id": eid, "headline": headline, "label": label, **view})


def _fail(msg: str) -> str:
    return dumps({"ok": False, "error": msg, "headline": msg})


def _tool(fn: Any, name: str, display: str, *, kind: str = "engine", args_schema: type[BaseModel] | None = None,
          provider: str = "geostar") -> BaseTool:
    doc = (fn.__doc__ or "").strip()
    return StructuredTool.from_function(func=fn, name=name, description=doc, args_schema=args_schema,
                                        tags=["tool", provider, kind],
                                        metadata={"tool_provider": provider, "display_name": display, "kind": kind})


# ------------------------------------------------------------------------------------------------ CoStar over MCP

COSTAR_DISPLAY = {
    "search_costar_properties": "CoStar · Property Search", "get_property_intelligence": "CoStar · Property Lookup",
    "find_sales_comps": "CoStar · Sales Comps", "underwrite_acquisition": "CoStar · Underwrite Acquisition",
    "find_off_market_candidates": "CoStar · Off-Market Candidates", "analyze_occupancy": "CoStar · Occupancy",
    "analyze_submarket": "CoStar · Submarket", "find_adjacent_properties": "CoStar · Adjacent Properties",
    "analyze_residential_impact": "CoStar · Residential Impact", "compare_property_portfolio": "CoStar · Portfolio Compare",
    "get_matterport_model": "CoStar · Matterport Scans", "evaluate_conversion": "CoStar · Building Conversion",
    "identify_data_gaps": "CoStar · Data Gaps", "generate_investment_memo": "CoStar · Investment Memo",
    "save_to_deal_room": "CoStar · Save to Deal Room",
}
NOT_FOR_AGENTS = {"save_to_deal_room"}  # the only write tool; agents do not save on the user's behalf


def costar_tool(name: str) -> BaseTool:
    """One CoStar MCP tool as a LangChain tool. Its JSON schema is the server's own (from tools/list)."""
    MCP.ensure()
    spec = next((t for t in MCP.tools if t.name == name), None)
    if spec is None:
        raise KeyError(f"CoStar MCP tool {name} is not available: {MCP.error or 'not listed by the server'}")
    schema = dict(spec.input_schema or {"type": "object", "properties": {}})
    takes_parcel = "parcel_id" in (schema.get("properties") or {})

    def call(**args: Any) -> str:
        run = _run()
        if takes_parcel and not args.get("parcel_id"):
            args["parcel_id"] = (run.context.get("site") or {}).get("id")
        args = {k: v for k, v in args.items() if v is not None}
        t0 = time.time()
        body = MCP.call(name, args)
        if not body.get("ok"):
            return _fail(f"{name} failed: {body.get('error') or 'no data'}")
        data = body.get("data")
        view = {"data": costar_view(data), "source_count": len(body.get("sources") or []),
                "mcp_ms": round((time.time() - t0) * 1000)}
        if not LLM_COSTAR:
            view["privacy"] = "CoStar names, addresses, prices, rents and coordinates are withheld from the model; the user sees the full record."
        return _reply(name, data, view, provider="costar-mcp", label=body.get("label"), sources=body.get("sources"),
                      headline=copilot.intel_headline(name, data) if LLM_COSTAR else f"{COSTAR_DISPLAY.get(name, name)} returned ({body.get('label')}).",
                      redacted=not LLM_COSTAR)

    desc = (spec.description or name).strip()
    return StructuredTool(name=name, description=desc + " (CoStar MCP server.)", args_schema=schema, func=call,
                          tags=["tool", "mcp", "costar"],
                          metadata={"tool_provider": f"costar-mcp · {MCP.server_name or 'plotstar-costar'}",
                                    "display_name": COSTAR_DISPLAY.get(name, name), "kind": "mcp",
                                    "mcp_transport": MCP.transport})


# ------------------------------------------------------------------------------------------------ GeoStar tools

def screen_site() -> str:
    """Screen the selected site against GeoStar's hard gates with public data: nearest homes (CoStar homes + OpenStreetMap),
    schools/worship/hospitals/childcare (OpenStreetMap), FEMA flood zone, WRI Aqueduct water stress and distance to a
    >=138 kV substation (OpenStreetMap). Returns each gate's status, value, limit and source."""
    from app.engine import external
    from app.db import session
    from app.engine.screening import Thresholds, load_homes, screen_parcel
    run = _run()
    site = run.context.get("site") or {}
    pid, lat, lon, acres, market = site.get("id"), site.get("lat"), site.get("lon"), None, run.context.get("market") or "Houston"
    if isinstance(pid, str) and pid.startswith("costar:"):
        with session() as c:
            row = c.execute("SELECT lat, lon, lot_acres, market FROM parcels WHERE parcel_id = ?", (pid,)).fetchone()
        if row:
            lat, lon, acres, market = row["lat"], row["lon"], row["lot_acres"], row["market"] or market
    if lat is None or lon is None:
        return _fail("No site location to screen.")
    s = screen_parcel({"parcel_id": pid or "site", "lat": lat, "lon": lon}, load_homes(external.MARKET_BBOX.get(market)),
                      external.osm_substations(market), Thresholds(), sensitive=external.osm_sensitive(market), acres=acres)
    d = s.as_dict()
    gates = [{k: g.get(k) for k in ("gate", "status", "value", "limit", "unit", "label")}
             | ({"reason": g.get("reason")} if LLM_COSTAR or "CoStar" not in (g.get("source") or "") else {})
             for g in d["gates"]]
    sub = (d.get("power") or {}).get("nearest_substation") or {}
    view = {"status": d["status"], "gates": gates,
            "substation": {k: sub.get(k) for k in ("name", "kv", "distance_km", "voltage") if k in sub},
            "water_stress_category": (d.get("power") or {}).get("water_stress_cat"), "evidence_gaps": d.get("evidence_gaps")}
    head = f"Site screen {d['status']}: " + "; ".join(f"{g['gate']} {g['status']}" for g in d["gates"])
    return _reply("screen_site", d, view, label="Sourced (public data) / Estimated (distances)",
                  sources=[g.get("source") for g in d["gates"] if g.get("source")], headline=head)


def grid_conditions() -> str:
    """The ERCOT day the engine uses: hourly day-ahead price (Sourced) and grid carbon intensity (Estimated), with the
    cheapest and dirtiest hours. Use for energy cost and carbon questions."""
    from app.engine import grid as G
    gd = G.grid_day(offline=True)
    p, cb = gd.get("price") or [], gd.get("carbon") or []
    if not p:
        return _fail("No ERCOT day is cached.")
    view = {"hub": gd.get("hub"), "price_label": gd.get("price_label"), "price_date": gd.get("price_date"),
            "price_usd_mwh": {"mean": round(sum(p) / len(p), 1), "min": round(min(p), 1), "max": round(max(p), 1),
                              "cheapest_hour": p.index(min(p)), "dearest_hour": p.index(max(p))},
            "carbon_kg_mwh": {"mean": round(sum(cb) / len(cb), 1), "min": round(min(cb), 1), "max": round(max(cb), 1),
                              "cleanest_hour": cb.index(min(cb))} if cb else None,
            "carbon_label": gd.get("carbon_label"), "carbon_date": gd.get("carbon_date")}
    return _reply("grid_conditions", gd, view, label=f"{gd.get('price_label')} prices / {gd.get('carbon_label')} carbon",
                  sources=[gd.get("price_source"), gd.get("carbon_source")],
                  headline=f"ERCOT {gd.get('hub')} {gd.get('price_date')}: mean ${view['price_usd_mwh']['mean']}/MWh.")


def _engine() -> dict[str, Any]:
    return _run().ctx.base


def _concepts(pick: tuple[str, ...]) -> list[dict[str, Any]]:
    return [{"id": c["id"], "name": c["name"], "rank": c["rank"], "feasible": c["feasible"],
             **{k: c[k] for k in pick}} for c in sorted(_engine()["concepts"], key=lambda c: c["rank"])]


def development_economics() -> str:
    """GeoStar's development model for the three layout concepts on this site: cost to build, land, total investment,
    revenue, energy and operating cost, NPV P10/P50/P90 (Monte Carlo over build cost, revenue, energy price and delay),
    payback and months to power. Simulated / Estimated, with the finance assumptions."""
    b = _engine()
    cs = _concepts(("money",))
    best = cs[0]["money"]
    view = {"concepts": cs, "finance": b.get("finance"), "brief": {k: b["brief"].get(k) for k in ("mw_it", "facility_mw", "pue", "racks", "rent_kw_month")},
            "land": {k: b["site"].get(k) for k in ("land_label", "land_basis")}, "ranking": b.get("ranking", {}).get("note")}
    pb = best.get("payback_years")
    return _reply("development_economics", {"concepts": cs, "finance": b.get("finance"), "brief": b["brief"]}, view,
                  label="Simulated (Monte Carlo) / Estimated", sources=[b.get("note") or "GeoStar layout engine"],
                  headline=f"{cs[0]['name']}: build ${best['capex'] / 1e6:,.0f}M, NPV P50 ${best.get('npv_p50', best['npv']) / 1e6:,.0f}M, "
                           f"{'payback ' + format(pb, '.1f') + ' yr' if pb else 'no payback within the period'}.")


def resource_demand() -> str:
    """Power, cooling, water and land the layout concepts need: facility MW, PUE, energy MWh/yr, water m3/yr, standby
    generators, battery storage, rooftop solar and open land. Estimated from the brief and the engine assumptions."""
    b = _engine()
    cs = _concepts(("resources",))
    br = b["brief"]
    view = {"concepts": cs, "brief": {k: br.get(k) for k in ("mw_it", "facility_mw", "pue", "cooling", "redundancy", "generators", "racks", "halls")},
            "operating": {k: (b.get("operating") or {}).get(k) for k in ("price_flat", "price_flex", "carbon_flat", "carbon_flex", "flex_note")}}
    r = cs[0]["resources"]
    return _reply("resource_demand", {"concepts": cs, "brief": br, "operating": b.get("operating")}, view, label="Estimated",
                  sources=["GeoStar layout engine and assumptions"],
                  headline=f"{br['facility_mw']} MW facility load (PUE {br['pue']}), {r['water_m3_per_year']:,.0f} m3 water a year, "
                           f"{r['energy_mwh_per_year']:,.0f} MWh a year.")


def community_impact() -> str:
    """People and planet for each concept: generator noise at the boundary and at the nearest home, distance from the
    generators to the boundary, whether a noise wall is needed, operating and build carbon, water use and rooftop solar."""
    b = _engine()
    cs = _concepts(("people", "planet"))
    for c, src in zip(cs, sorted(b["concepts"], key=lambda c: c["rank"])):
        c["water_m3_per_year"] = src["resources"]["water_m3_per_year"]
    p = cs[0]["people"]
    return _reply("community_impact", {"concepts": cs}, {"concepts": cs}, label="Estimated",
                  sources=["GeoStar layout engine (ISO 9613-style distance attenuation)"],
                  headline=f"{cs[0]['name']}: {p['noise_at_boundary_dba']} dBA at the boundary"
                           + (f", {p['noise_at_home_dba']} dBA at the nearest home" if p.get("noise_at_home_dba") is not None else "") + ".")


def generate_layouts() -> str:
    """Lay the brief out three ways on the site with GeoStar's layout engine and summarise each concept: strategy, rank,
    feasibility, the four factor scores, footprint, racks placed, spare positions, failed checks, advantage and trade-off."""
    b = _engine()
    cs = []
    for c in sorted(b["concepts"], key=lambda c: c["rank"]):
        cs.append({"id": c["id"], "name": c["name"], "strategy": c["strategy"], "rank": c["rank"], "feasible": c["feasible"],
                   "scores": c["scores"], "advantage": c["advantage"], "tradeoff": c["tradeoff"],
                   "metrics": {k: c["metrics"][k] for k in ("footprint_m2", "gross_floor_m2", "storeys", "placed_racks", "spare_positions", "site_coverage")},
                   "failed_checks": [k["name"] for k in c["checks"] if not k["ok"]]})
    return _reply("generate_layouts", {"concepts": cs, "ranking": b.get("ranking")}, {"concepts": cs, "ranking": b.get("ranking")},
                  label="Estimated (conceptual layout)", sources=["GeoStar layout engine"],
                  headline=f"Three concepts; {cs[0]['name']} ranks first. {b.get('ranking', {}).get('note', '')}")


def compare_concepts() -> str:
    """Compare the three concepts side by side: rank, cost to build, ten-year cost, NPV, footprint, spare rack positions,
    power route, noise and failed checks, with each concept's advantage and trade-off."""
    o = copilot.t_compare(_run().ctx)
    return _reply("compare_concepts", o, {"table": o["table"], "ranking_note": o["ranking_note"], "close": o["close"]},
                  label="Estimated", sources=["GeoStar layout engine"], headline=o["headline"])


class InspectArgs(BaseModel):
    code: str = Field(..., description="Object code exactly as shown in the plan, e.g. DH-01, SUB-01, G-01")


def inspect_object(code: str) -> str:
    """Look up one object of the active layout by its code: size, position, capacity, checks that involve it and why it is there."""
    o = copilot.t_inspect(_run().ctx, code)
    if not o.get("ok"):
        return _fail(o.get("headline") or f"No object {code}")
    return _reply("inspect_object", o, {k: v for k, v in o.items() if k in ("record", "why", "checks", "facts")},
                  label="Estimated", sources=["GeoStar layout engine"], headline=o.get("headline"))


def what_if(**args: Any) -> str:
    run = _run()
    o = copilot.t_what_if(run.ctx, **{k: v for k, v in args.items() if v is not None})
    if not o.get("ok"):
        return _fail(o.get("headline") or "Nothing to recompute")
    cons = o["consequences"]
    run.proposal = {"patch": o["patch"], "concept_id": cons["concept_id"], "consequences": cons}
    run.emit("proposal", proposal=run.proposal)
    view = {"patch": o["patch"], "concept": cons["concept"], "still_fits_site": cons["feasible_after"],
            "changed": [f"{x['metric']}: {x['before_text']} → {x['after_text']}" for x in cons["changed"]],
            "checks_that_changed": [f"{k['name']}: {'pass' if k['after'] else 'fail'}" for k in cons["check_flips"]],
            "note": "Preview only. The user applies it in the Studio."}
    return _reply("what_if", o, view, label="Estimated (layout engine re-run)", sources=["GeoStar layout engine"], headline=o["headline"])


what_if.__doc__ = copilot.WhatIf.__doc__


def facility_protection_state() -> str:
    """Live state of the deployed facility's protection system: sensor readings (water leak, fire, electricity, water use),
    open incidents, the active response plan, mode and the latest timeline events; plus recent high-load telemetry alerts."""
    import httpx
    run = _run()
    fid = run.context.get("facility_id")
    if not fid:
        return _fail("No deployed facility for this project yet. Deploy it from the Design step first.")
    site = run.context.get("site") or {}
    try:
        r = httpx.get(f"{NEXT_URL}/api/protection/{fid}", timeout=8,
                      params={"name": site.get("name") or site.get("id") or "GeoStar site", "city": run.context.get("market") or "Houston", "type": "Data center"})
        st = r.json()
    except Exception as e:  # noqa: BLE001
        return _fail(f"Protection service not reachable: {type(e).__name__}")
    if "error" in st:
        return _fail(f"Protection service: {st['error']}")
    alerts = []
    try:
        from app.sponsors.mongodb import atlas
        db = atlas._db()
        if db is not None:
            alerts = [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}
                      for d in db["alerts"].find({}, {"_id": 0}).sort("at", -1).limit(5)]
    except Exception:  # noqa: BLE001
        pass
    view = {"mode": st.get("mode"), "plan": st.get("plan"), "deployed": st.get("deployed"), "readings": st.get("readings"),
            "incidents": st.get("incidents"), "timeline": (st.get("timeline") or [])[-6:], "telemetry_alerts": alerts}
    inc = st.get("incidents") or []
    return _reply("facility_protection_state", {**st, "telemetry_alerts": alerts}, view, label="Measured (sensors) / Simulated (demo triggers)",
                  sources=["GeoStar protection service", "MongoDB Atlas alerts"],
                  headline=f"{len(inc)} open incident(s); mode {st.get('mode')}." if inc else f"No open incidents; mode {st.get('mode')}.")


PLAYBOOK: dict[str, dict[str, Any]] = {
    "leak": {"trigger": "Moisture sensor above its threshold", "isolate": ["Close the riser feeding the zone", "Isolate freight elevator E1 (riser R-3 dependency)"],
             "protect": ["Power down racks below the leak path", "Move to the alternate cooling loop"],
             "notify": ["maintenance", "security"], "route": "Exclude routes through the wet zone"},
    "fire": {"trigger": "Smoke or heat point in alarm", "isolate": ["Release clean-agent suppression in the affected hall only", "Elevators to recall floor"],
             "protect": ["Evacuate by the routes that avoid the alarm zone", "Hold re-entry until the fire service clears"],
             "notify": ["security", "fire service", "operations"], "route": "Exclude routes touching the fire zone"},
    "electricity": {"trigger": "Site draw above the contracted limit", "isolate": [],
                    "protect": ["Shift flexible jobs to the cheapest, cleanest hours", "Discharge the battery to shave the peak"],
                    "notify": ["operations"], "route": "No route change"},
    "water_usage": {"trigger": "Daily water draw above the municipal allocation", "isolate": [],
                    "protect": ["Switch cooling to the dry-cooler mode", "Defer non-urgent wash-down"],
                    "notify": ["operations", "utility liaison"], "route": "No route change"},
}


class PlaybookArgs(BaseModel):
    kind: Literal["leak", "fire", "electricity", "water_usage"]


def safety_playbook(kind: str) -> str:
    """GeoStar's response playbook for one incident kind (leak, fire, electricity, water_usage): trigger, isolation,
    protective actions, who to notify and how evacuation routes change. Deterministic; the source of every recommended step."""
    p = PLAYBOOK[kind]
    return _reply("safety_playbook", {"kind": kind, **p}, {"kind": kind, **p}, label="GeoStar playbook",
                  sources=["GeoStar protection engine rules"], headline=f"{kind}: notify {', '.join(p['notify'])}.")


def site_walk_observations() -> str:
    """Your team's site walk of the existing building: notes pinned inside the Matterport scan (category, severity,
    floor, text) and measurements drawn in it (clear height, column spacing, door and corridor widths). Measured by
    people, not CoStar data. Use it for anything about the existing building's condition, structure or access."""
    from app.sponsors.matterport import sitewalk
    run = _run()
    pid = (run.context.get("site") or {}).get("id")
    if not (isinstance(pid, str) and pid.startswith("costar:")):
        return _fail("No CoStar building is selected, so there is no site walk.")
    d = sitewalk.summary(pid)
    view = {"notes": [{k: n.get(k) for k in ("category", "severity", "floor", "text", "author", "created_at")} for n in d["notes"]][:40],
            "measurements": [{k: m.get(k) for k in ("kind", "label", "length_m", "floor", "method")} for m in d["measurements"]][:40],
            "binding_values": {k: {"value_m": v["value_m"], "need_m": v["need_m"], "count": v["count"]} for k, v in d["derived"].items()},
            "counts": d["counts"]}
    c = d["counts"]
    return _reply("site_walk_observations", d, view, label=d["label"], sources=[f"Site walk ({d['stored']})"],
                  headline=f"Site walk: {c['notes']} notes ({c['blockers']} blockers), {c['measurements']} measurements."
                  if c["notes"] or c["measurements"] else "No site walk notes or measurements yet for this building.")


# ------------------------------------------------------------------------------------------- orchestrator tools

@traceable(run_type="chain", name="Computation / Weighted Site Score", tags=["computation", "deterministic"])
def _score(run: Run) -> dict[str, Any]:
    return scoring.compute(run)


def compute_site_score() -> str:
    """Compute the site score from the evidence the specialists gathered: documented weights per pillar (property,
    money, power and resources, people and planet), linear normalisation, hard gates and evidence gaps. Deterministic and
    reproducible; call it after the specialists report, and again after any follow-up investigation."""
    run = _run()
    res = _score(run)
    run.score = res
    run.emit("score", score=res)
    view = scoring.model_view(res)
    return dumps({"ok": True, "headline": f"{res['verdict']}: {res['score']} (coverage {res['coverage'] * 100:.0f}%, confidence {res['confidence']})",
                  **view})


class DispatchArgs(BaseModel):
    kind: Literal["leak", "fire", "electricity", "water_usage"]
    zone: str = Field(..., max_length=80, description="Where, e.g. 'Level 4 east corridor'")
    message: str = Field(..., max_length=400, description="What the team must do, from the playbook")
    severity: Literal["advisory", "urgent", "emergency"] = "urgent"


def dispatch_safety_alert(kind: str, zone: str, message: str, severity: str = "urgent") -> str:
    """Notify the on-call teams for an incident (writes a notification the facility's teams receive). A person must
    approve this before it runs. Use only after safety-operations has recommended it."""
    run = _run()
    p = PLAYBOOK.get(kind)
    if p is None:
        return _fail(f"Unknown incident kind {kind}")
    doc = {"kind": kind, "zone": zone, "message": message, "severity": severity, "teams": p["notify"],
           "run_id": run.id, "facility_id": run.context.get("facility_id"), "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    stored = "this GeoStar session"
    try:
        from app.sponsors.mongodb import atlas
        db = atlas._db()
        if db is not None:
            db["notifications"].insert_one({**doc, "source": "safety-operations agent (approved)"})
            stored = "MongoDB Atlas notifications"
    except Exception:  # noqa: BLE001
        pass
    run.dispatches.append({**doc, "stored": stored})
    run.emit("dispatch", dispatch=run.dispatches[-1])
    return dumps({"ok": True, "headline": f"Sent to {', '.join(p['notify'])} ({stored}).", "dispatch": doc})


# ------------------------------------------------------------------------------------------------ the tool sets

def geostar_tools() -> dict[str, BaseTool]:
    return {
        "screen_site": _tool(screen_site, "screen_site", "GeoStar · Site Screen (FEMA, WRI, OSM)"),
        "grid_conditions": _tool(grid_conditions, "grid_conditions", "GeoStar · ERCOT Grid Day"),
        "development_economics": _tool(development_economics, "development_economics", "GeoStar · Development Model"),
        "resource_demand": _tool(resource_demand, "resource_demand", "GeoStar · Resource Demand"),
        "community_impact": _tool(community_impact, "community_impact", "GeoStar · Community Impact"),
        "generate_layouts": _tool(generate_layouts, "generate_layouts", "GeoStar · Layout Engine"),
        "compare_concepts": _tool(compare_concepts, "compare_concepts", "GeoStar · Compare Concepts"),
        "inspect_object": _tool(inspect_object, "inspect_object", "GeoStar · Inspect Object", args_schema=InspectArgs),
        "what_if": _tool(what_if, "what_if", "GeoStar · What-If (engine re-run)", args_schema=copilot.WhatIf),
        "facility_protection_state": _tool(facility_protection_state, "facility_protection_state", "GeoStar · Protection State"),
        "safety_playbook": _tool(safety_playbook, "safety_playbook", "GeoStar · Safety Playbook", args_schema=PlaybookArgs),
        "site_walk_observations": _tool(site_walk_observations, "site_walk_observations", "Matterport · Site Walk Notes"),
        "compute_site_score": _tool(compute_site_score, "compute_site_score", "Computation / Weighted Site Score", kind="computation"),
        "dispatch_safety_alert": _tool(dispatch_safety_alert, "dispatch_safety_alert", "Action / Dispatch Safety Alert",
                                       kind="action", args_schema=DispatchArgs),
    }


def costar_tools() -> dict[str, BaseTool]:
    if not MCP.ensure():
        return {}
    return {t.name: costar_tool(t.name) for t in MCP.tools if t.name not in NOT_FOR_AGENTS}


def acres_needed(mw_it: float) -> float:
    return mw_it / max(A.value("mw_per_acre"), 1e-6)
