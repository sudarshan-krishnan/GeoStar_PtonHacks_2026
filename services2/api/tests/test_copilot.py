"""Copilot: consequences are pure arithmetic on engine runs, the rule planner picks the right tools, and the graph
answers without a model key using only computed numbers."""
from __future__ import annotations

import pytest

from app import config, copilot as C
from app import layout_engine as L

GRID = {"price": [30 + (i % 12) * 3 for i in range(24)], "carbon": [350 + (i % 6) * 20 for i in range(24)]}
SITE = {"gates": [{"gate": "Residential proximity", "status": "Pass", "value": 400},
                  {"gate": "Grid proximity", "status": "Pass", "value": 1.5}]}
BRIEF = dict(mw_it=20, rack_kw=20, redundancy="N+1", cooling="liquid", site_w=320, site_d=240, setback_m=8,
             expansion_pct=10, flexible_share=0, storeys=1)


def req(**kw):
    return dict(brief={**BRIEF, **kw.pop("brief", {})}, site=SITE, priorities={}, assumptions={}, edits={},
                concept_id="service-bands", selected="DH-01", stage="Explore", **kw)


def ctx(**kw):
    return C.Ctx(req(**kw), lambda: GRID)


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")


def test_consequences_match_two_engine_runs():
    a = L.generate(BRIEF, SITE, GRID, {})
    b = L.generate({**BRIEF, "rack_kw": 40}, SITE, GRID, {})
    cons = C.consequences(a, b, "service-bands")
    rows = {r["metric"]: r for r in cons["rows"]}
    assert rows["Racks"]["before"] == 1000 and rows["Racks"]["after"] == 500
    cb = next(c for c in a["concepts"] if c["id"] == "service-bands")
    ca = next(c for c in b["concepts"] if c["id"] == "service-bands")
    assert rows["Cost to build"]["before"] == cb["money"]["capex"] and rows["Cost to build"]["after"] == ca["money"]["capex"]
    assert rows["Building footprint"]["delta"] == ca["metrics"]["footprint_m2"] - cb["metrics"]["footprint_m2"]
    assert rows["IT capacity"]["changed"] is False  # same MW, fewer, denser racks
    assert all(r["changed"] for r in cons["changed"]) and "Explore" in cons["stages"]


def test_unchanged_brief_has_no_changes():
    a = L.generate(BRIEF, SITE, GRID, {})
    assert C.consequences(a, a, "long-halls")["changed"] == []


@pytest.mark.parametrize("q, tool, args", [
    ("What if I double the rack density here?", "WhatIf", {"rack_kw": 40.0}),
    ("Can we fit another 200 racks?", "WhatIf", {"racks_delta": 200}),
    ("What happens if we switch to air cooling?", "WhatIf", {"cooling": "air"}),
    ("Try 2N redundancy", "WhatIf", {"redundancy": "2N"}),
    ("Why is GEN placed there?", "InspectObject", {"code": "GEN"}),
    ("Show me the biggest risks", "ReviewRisks", {}),
    ("Which concept is cheaper over 10 years?", "CompareConcepts", {}),
])
def test_rule_planner(q, tool, args):
    calls = C.rule_plan(q, ctx())
    hit = next(c for c in calls if c["name"] == tool)
    assert all(hit["args"].get(k) == v for k, v in args.items())


def test_low_land_cost_is_not_a_land_property_type():
    calls = C.rule_plan("Find industrial properties near Houston for 20 MW, prioritize low land cost", ctx())
    s = next(c for c in calls if c["name"] == "CostarSearch")["args"]
    assert s["property_types"] == ["Industrial"] and s["sort"] == "price" and s["market"] == "Houston"


def test_what_if_extra_racks_raises_capacity_at_same_density():
    out = C.t_what_if(ctx(), racks_delta=200)
    assert out["ok"] and out["patch"] == {"mw_it": 24.0}
    rows = {r["metric"]: r for r in out["consequences"]["rows"]}
    assert rows["Racks"]["after"] == 1200


def test_what_if_without_a_change_is_refused():
    assert C.t_what_if(ctx(), rack_kw=20)["ok"] is False


def test_inspect_unknown_code_suggests_real_ones():
    out = C.t_inspect(ctx(), "DH-99")
    assert out["ok"] is False and "DH-01" in out["headline"]


def test_graph_answers_without_a_model_and_returns_a_preview():
    out = C.ask("What if I double the rack density here?", req(), "test-thread", lambda: GRID)
    assert out["planned_by"].startswith("Rule planner") and out["written_by"].startswith("Built from the computed numbers")
    assert out["proposal"]["patch"] == {"rack_kw": 40.0} and "1,000" in out["answer"] and "500" in out["answer"]
    assert [t["node"] for t in out["trace"]] == ["plan", "act", "verify", "respond"]
    again = C.ask("And with air cooling?", req(), "test-thread", lambda: GRID)
    assert [t["node"] for t in again["trace"]] == ["plan", "act", "verify", "respond"]  # per-turn trace only


def test_dropped_pin_has_no_costar_record():
    out = C.t_costar_property(ctx())
    assert out["ok"] is False and "dropped pin" in out["headline"]


def test_costar_data_never_enters_graph_state():
    """LangGraph checkpoints and LangSmith traces record the state; CoStar fields must stay in the per-run vault."""
    from app.db import db_ready, session
    if not db_ready():
        pytest.skip("CoStar parcel store not loaded")
    with session() as c:
        row = c.execute("SELECT parcel_id, address FROM parcels WHERE address IS NOT NULL AND market = 'Houston' LIMIT 1").fetchone()
    pid, address = row["parcel_id"], row["address"]
    r = req()
    r["site"] = {**SITE, "id": pid, "name": "Secret Building"}
    out = C.ask("Tell me about this CoStar property", r, "vault-thread", lambda: GRID)
    assert address in out["answer"] and out["tools"][0]["output"]["record"]["address"] == address  # the user sees it
    state = C._GRAPH.get_state({"configurable": {"thread_id": "vault-thread"}}).values
    dumped = repr(state)
    assert address not in dumped and "Secret Building" not in dumped and pid not in repr(state.get("req"))
