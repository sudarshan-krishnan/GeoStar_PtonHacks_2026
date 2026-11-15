"""Deal-to-Design: a LangGraph pipeline that turns acquisition criteria into a ranked, sourced shortlist.

    search → analyze (one branch per candidate, in parallel) → rank → memo

search    CoStar properties matching the criteria (market, size, type, budget, power).
analyze   per candidate, in parallel (LangGraph Send): comps-based valuation, underwriting through the development
          model, occupancy and residential exposure. Each tool call is real and is written to the audit log.
rank      fixed, stated rule: hard-gate failures last, then infeasible layouts, then over-budget, then NPV (P50).
memo      the investment memo and diligence gaps for the leading property.

Every number comes from app/sponsors/costar/tools.py; no model writes figures here. The result includes a timeline of the
actual tool calls with timings, so the UI can show what ran.
"""
from __future__ import annotations

import time
from operator import add
from typing import Annotated, Any, TypedDict

from app.sponsors.costar import tools as T


class DealState(TypedDict, total=False):
    criteria: dict
    candidates: list
    analyses: Annotated[list, add]
    ranked: list
    memo: dict
    timeline: Annotated[list, add]


class Branch(TypedDict):
    criteria: dict
    candidate: dict


def _call(tool: str, **args: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    r = T.run(tool, via="deal-agent", **args)
    step = {"tool": tool, "args": {k: v for k, v in args.items() if k != "payload"}, "ok": r["ok"], "ms": r["ms"],
            "sources": len(r["sources"]), "error": r["error"]}
    return r, step


def n_search(s: DealState) -> dict:
    c = s["criteria"]
    r, step = _call("search_costar_properties", market=c.get("market", "Houston"), min_acres=c.get("min_acres"),
                    property_types=c.get("property_types") or None, heavy_power=c.get("heavy_power"),
                    max_price=c.get("max_price"), available_only=c.get("available_only", False),
                    dc_candidates_only=c.get("dc_candidates_only", True), sort=c.get("sort", "acres"),
                    limit=int(c.get("candidates", 5)))
    cands = (r["data"] or {}).get("properties", []) if r["ok"] else []
    return {"candidates": cands, "timeline": [{"node": "search", **step, "found": (r["data"] or {}).get("total") if r["ok"] else 0}]}


def fan_out(s: DealState):
    from langgraph.types import Send
    if not s.get("candidates"):
        return "rank"
    return [Send("analyze", {"criteria": s["criteria"], "candidate": cand}) for cand in s["candidates"]]


def n_analyze(b: Branch) -> dict:
    c, cand = b["criteria"], b["candidate"]
    pid = cand["parcel_id"]
    steps, out = [], {"parcel_id": pid, "name": cand.get("name") or cand.get("address"), "address": cand.get("address"),
                      "lot_acres": cand.get("lot_acres"), "building_sf": cand.get("building_sf"), "source": cand.get("source")}
    uw, st = _call("underwrite_acquisition", parcel_id=pid, mw_it=float(c.get("mw_it", 20)), rack_kw=float(c.get("rack_kw", 20)),
                   max_comp_age_years=c.get("max_comp_age_years"))
    steps.append(st)
    if uw["ok"]:
        d = uw["data"]
        out.update(acquisition=d["acquisition"]["value"], acquisition_label=d["acquisition"]["label"],
                   acquisition_basis=d["acquisition"]["basis"], comps_used=d["acquisition"].get("comps_used"),
                   capex=d["money"]["capex"], npv=d["money"]["npv"],
                   npv_p10=d["money"]["npv_p10"], npv_p90=d["money"]["npv_p90"], months_to_power=d["money"]["months_to_power"],
                   feasible=d["feasible"], concept=d["concept"], failed_checks=d["failed_checks"],
                   gates_failed=[g["gate"] for g in d["gates"] if g["status"] == "Fail"],
                   gates_review=[g["gate"] for g in d["gates"] if g["status"] not in ("Pass", "Fail")])
    else:
        out["error"] = uw["error"]
    occ, st = _call("analyze_occupancy", parcel_id=pid)
    steps.append(st)
    out["occupancy"] = T._summary((occ["data"] or {}).get("status")) if occ["ok"] else {"error": occ["error"]}
    com, st = _call("analyze_residential_impact", parcel_id=pid)
    steps.append(st)
    out["community"] = T._summary(com["data"]) if com["ok"] else {"error": com["error"]}
    return {"analyses": [out], "timeline": [{"node": f"analyze {pid}", **x} for x in steps]}


def n_rank(s: DealState) -> dict:
    t0 = time.time()
    budget = s["criteria"].get("budget")
    rows = [a for a in s.get("analyses", []) if "npv" in a]
    for a in rows:
        total = (a.get("acquisition") or 0) + (a.get("capex") or 0)
        a["over_budget"] = bool(budget) and a.get("acquisition") is not None and a["acquisition"] > budget
        a["total_cost"] = total if a.get("acquisition") is not None else None
    rows.sort(key=lambda a: (bool(a["gates_failed"]), not a["feasible"], a["over_budget"], a.get("acquisition") is None,
                             -(a.get("npv") or -1e18)))
    for i, a in enumerate(rows):
        a["rank"] = i + 1
    failed = [a for a in s.get("analyses", []) if "npv" not in a]
    return {"ranked": rows + failed, "timeline": [{"node": "rank", "tool": None, "ok": True, "ms": round((time.time() - t0) * 1000, 1),
                                                   "sources": 0, "error": None}]}


def n_memo(s: DealState) -> dict:
    top = next((a for a in s.get("ranked", []) if a.get("rank") == 1), None)
    if not top:
        return {"memo": {}, "timeline": []}
    c = s["criteria"]
    r, st = _call("generate_investment_memo", parcel_id=top["parcel_id"], mw_it=float(c.get("mw_it", 20)), rack_kw=float(c.get("rack_kw", 20)))
    return {"memo": r["data"] if r["ok"] else {"error": r["error"]}, "timeline": [{"node": "memo", **st}]}


_GRAPH = None


def graph():
    global _GRAPH
    if _GRAPH is None:
        from langgraph.graph import END, START, StateGraph
        g = StateGraph(DealState)
        g.add_node("search", n_search)
        g.add_node("analyze", n_analyze)
        g.add_node("rank", n_rank)
        g.add_node("memo", n_memo)
        g.add_edge(START, "search")
        g.add_conditional_edges("search", fan_out, ["analyze", "rank"])
        g.add_edge("analyze", "rank")
        g.add_edge("rank", "memo")
        g.add_edge("memo", END)
        _GRAPH = g.compile()
    return _GRAPH


def run(criteria: dict[str, Any]) -> dict[str, Any]:
    c = dict(criteria)
    c["candidates"] = max(1, min(8, int(c.get("candidates", 5))))
    t0 = time.time()
    out = graph().invoke({"criteria": c, "analyses": [], "timeline": []},
                         {"run_name": "plotstar-deal-to-design", "tags": ["plotstar", "deal"], "max_concurrency": 4})
    result = {"criteria": c, "shortlist": out.get("ranked", []), "memo": out.get("memo", {}), "timeline": out.get("timeline", []),
            "ms": round((time.time() - t0) * 1000), "rule": "Hard-gate failures last, then infeasible layouts, then over budget, "
            "then missing acquisition basis, then highest NPV (P50).",
            "note": "Every figure comes from CoStar records and GeoStar's deterministic development model; see each step's sources."}
    from app.sponsors.costar import deal_room
    result["run_id"] = deal_room.save_deal_run(result)  # summary to Atlas, full payload local
    return result
