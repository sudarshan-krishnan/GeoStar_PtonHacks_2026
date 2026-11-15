"""CoStar intelligence layer: tool envelope and audit, the MCP server, Deal-to-Design ranking, deal room fallback,
copilot routing and headlines. Real-store checks are skipped when the CoStar parcel store is not loaded."""
from __future__ import annotations

import asyncio

import pytest

from app import config
from app.sponsors.langchain import copilot as C, deal_agent
from app.sponsors.costar import deal_room
from app.sponsors.costar import tools as T
from app.db import db_ready

GRID = {"price": [30 + (i % 12) * 3 for i in range(24)], "carbon": [350 + (i % 6) * 20 for i in range(24)]}


@pytest.fixture(autouse=True)
def memory_deal_room(monkeypatch):
    monkeypatch.setattr(deal_room, "_db", lambda: None)  # never write test calls to Atlas
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")


def test_envelope_unknown_tool_and_validation():
    r = T.run("nope")
    assert r["ok"] is False and "Unknown tool" in r["error"]
    r = T.run("search_costar_properties", via="test", market="Paris")
    assert r["ok"] is False and "Houston or Los Angeles" in r["error"]
    assert set(r) >= {"ok", "tool", "data", "sources", "label", "error", "ms"}


def test_write_tool_requires_confirmation_and_is_audited():
    r = T.run("save_to_deal_room", via="test", kind="scenario", project_id="p1", payload={"assumptions": {"rack_kw": 30}})
    assert r["ok"] is False and "confirm" in r["error"]
    r = T.run("save_to_deal_room", via="test", kind="scenario", project_id="p1", payload={"assumptions": {"rack_kw": 30}}, confirm=True)
    assert r["ok"] and r["data"]["backend"] == "process memory"
    calls = deal_room.audit_log(5)["calls"]
    assert calls[0]["tool"] == "save_to_deal_room" and calls[0]["ok"] is True and calls[1]["ok"] is False
    assert deal_room.deal(project_id="p1")["scenarios"][0]["assumptions"] == {"rack_kw": 30}


def test_mcp_server_exposes_every_tool_with_annotations():
    from app.sponsors.costar.mcp_server import server
    tools = asyncio.run(server.list_tools())
    names = {t.name for t in tools}
    assert names == set(T.TOOLS)
    for t in tools:
        assert t.annotations.read_only_hint is (t.name != "save_to_deal_room")
    res = asyncio.run(server.call_tool("save_to_deal_room", {"kind": "scenario"}))
    assert res.structured_content["ok"] is False and "confirm" in res.structured_content["error"]


def test_deal_ranking_rule(monkeypatch):
    fake = {
        "a": dict(gates=[{"gate": "Water stress", "status": "Fail"}], npv=100, acq=1e6, feasible=True),
        "b": dict(gates=[], npv=-50, acq=2e6, feasible=True),
        "c": dict(gates=[], npv=-10, acq=9e9, feasible=True),   # over budget
        "d": dict(gates=[], npv=-20, acq=3e6, feasible=False),  # does not fit
    }

    def run(tool, via="api", **a):
        if tool == "search_costar_properties":
            return {"ok": True, "data": {"total": 4, "properties": [{"parcel_id": k, "name": k} for k in fake]}, "sources": [], "label": None, "error": None, "ms": 1}
        if tool == "underwrite_acquisition":
            f = fake[a["parcel_id"]]
            return {"ok": True, "data": {"acquisition": {"value": f["acq"], "label": "Estimated", "basis": "x"},
                                         "money": {"capex": 1, "npv": f["npv"], "npv_p10": 0, "npv_p90": 0, "months_to_power": 24},
                                         "feasible": f["feasible"], "concept": "c", "failed_checks": [], "gates": f["gates"]},
                    "sources": ["s"], "label": None, "error": None, "ms": 1}
        if tool == "generate_investment_memo":
            return {"ok": True, "data": {"recommendation": "Proceed to diligence", "parcel": a["parcel_id"]}, "sources": [], "label": None, "error": None, "ms": 1}
        return {"ok": True, "data": {"status": {}}, "sources": [], "label": None, "error": None, "ms": 1}
    monkeypatch.setattr(T, "run", run)
    deal_agent._GRAPH = None
    out = deal_agent.run({"market": "Houston", "budget": 5e6, "candidates": 4})
    order = [r["parcel_id"] for r in sorted(out["shortlist"], key=lambda r: r["rank"])]
    assert order == ["b", "c", "d", "a"] or order == ["b", "d", "c", "a"]
    assert order[0] == "b" and order[-1] == "a"  # best eligible first, hard-gate failure last
    assert out["memo"]["parcel"] == "b"
    assert any(t["node"] == "search" for t in out["timeline"]) and sum(t["node"].startswith("analyze") for t in out["timeline"]) == 12


def test_rule_planner_routes_costar_questions_without_stealing_compare():
    cx = C.Ctx({"brief": {"mw_it": 20, "rack_kw": 20}, "site": {"id": "costar:1"}}, lambda: GRID)
    assert C.rule_plan("Show me the three most relevant transactions", cx)[0]["name"] == "find_sales_comps"
    uw = C.rule_plan("What happens to the investment case if the acquisition price increases 15%?", cx)[0]
    assert uw["name"] == "underwrite_acquisition" and uw["args"]["price_change_pct"] == 15.0
    assert C.rule_plan("Which concept is cheaper over 10 years?", cx)[0]["name"] == "CompareConcepts"
    deal = C.rule_plan("Find the best property in Houston for 20 MW under a $50M budget", cx)[0]
    assert deal["name"] == "deal_to_design" and deal["args"] == {"market": "Houston", "mw_it": 20.0, "budget": 50e6}


def test_comps_headline_quotes_only_computed_values():
    insufficient = {"status": "insufficient_evidence", "reasons": ["0 usable comps within 50 km"], "estimate": None}
    assert "Not enough usable comparable sales" in C.intel_headline("find_sales_comps", insufficient)
    ok = {"status": "ok", "n_used": 3, "radius_km": 10, "estimate": {"median": 242.0, "p25": 237.0, "p75": 246.0, "unit": "$/SF"},
          "value": {"value": 2_020_000}, "comps": [{"used": True, "similarity": 84, "name": "1250 Broadway", "sold_date": "2025-05-29",
                                                    "price": 1_700_000, "price_status": "Confirmed"}]}
    h = C.intel_headline("find_sales_comps", ok)
    assert "242" in h and "$2.0M" in h and "1250 Broadway sold 2025-05-29" in h and "Confirmed" in h


@pytest.mark.skipif(not db_ready(), reason="CoStar parcel store not loaded")
def test_real_store_search_and_adjacency_carry_sources():
    r = T.run("search_costar_properties", via="test", market="Houston", min_acres=10, limit=2)
    assert r["ok"] and r["data"]["properties"] and all("row" in s for s in r["sources"])
    pid = r["data"]["properties"][0]["parcel_id"]
    a = T.run("find_adjacent_properties", via="test", parcel_id=pid, radius_m=1500)
    assert a["ok"] and all(n["distance_m"] <= 1500 for n in a["data"]["neighbours"])
    assert "not that the lots touch" in a["data"]["limits"][0]


def test_mongo_wiring_without_atlas_falls_back_and_keeps_costar_payloads_local():
    from app.sponsors.mongodb import mongo
    assert mongo.db() is None  # conftest keeps tests off the real cluster
    saver, where = mongo.checkpointer()
    assert where == "process memory"
    k = deal_room.save_analysis("find_sales_comps", {"parcel_id": "costar:1"}, {"comps": [{"address": "1 Main St"}]},
                                "costar:1", ["row 1"], "Estimated")
    assert deal_room.cached("find_sales_comps", {"parcel_id": "costar:1"}) == {"comps": [{"address": "1 Main St"}]}
    assert k
    run_id = deal_room.save_deal_run({"criteria": {"market": "Houston"}, "shortlist": [
        {"parcel_id": "costar:1", "rank": 1, "npv": -5, "name": "Secret Name", "address": "1 Main St", "acquisition": 9e6}],
        "memo": {"recommendation": "Proceed to diligence", "because": "x"}, "timeline": []})
    summary = deal_room.deal_runs(5)[0]
    assert summary["run_id"] == run_id and summary["shortlist"][0] == {k: ({"parcel_id": "costar:1", "rank": 1, "npv": -5}).get(k)
                                                                        for k in deal_room._RUN_ROW}
    assert "Secret Name" not in str(summary) and "1 Main St" not in str(summary)  # CoStar-derived fields stay local
    assert deal_room.deal_run(run_id)["shortlist"][0]["name"] == "Secret Name"


def test_tool_results_are_cached(monkeypatch):
    calls = {"n": 0}

    def fake(parcel_id):
        calls["n"] += 1
        return {"status": "ok", "parcel": parcel_id}, "Estimated"
    monkeypatch.setitem(T.TOOLS, "find_sales_comps", fake)
    import uuid
    pid = f"costar:cache-{uuid.uuid4().hex[:8]}"  # fresh key: the local cache persists between runs
    a = T.run("find_sales_comps", via="test", parcel_id=pid)
    b = T.run("find_sales_comps", via="test", parcel_id=pid)
    assert a["ok"] and b["ok"] and b.get("cached") is True and calls["n"] == 1
