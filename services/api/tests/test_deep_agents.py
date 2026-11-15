"""Deep Agents: delegation and the live graph, scoring, redaction, verification and the CoStar MCP tools.

Model calls use fake chat models, so these tests are offline and deterministic; the graph structure, callbacks, scoring
and evidence handling are the real code."""
from __future__ import annotations



import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from app.sponsors.langchain.deep_agents import runtime, scoring
from app.sponsors.langchain.deep_agents.agents import Findings, verify
from app.sponsors.langchain.deep_agents.runtime import ORCHESTRATOR, Recorder, Run, costar_view


class FakeModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kw):  # the harness binds tools; the fake replays scripted messages
        return self


def _deep_run(orchestrator_msgs, sub_msgs):
    from deepagents import create_deep_agent
    runtime.AGENT_INFO.setdefault(ORCHESTRATOR, {"title": "PlotStar Orchestrator"})
    runtime.AGENT_INFO.setdefault("property-intelligence", {"title": "Property Intelligence"})
    sub = {"name": "property-intelligence", "description": "CoStar evidence.", "system_prompt": "x",
           "tools": [], "model": FakeModel(messages=iter(sub_msgs))}
    g = create_deep_agent(model=FakeModel(messages=iter(orchestrator_msgs)), tools=[], subagents=[sub], name=ORCHESTRATOR)
    run = Run("test", "test", {})
    for _ in g.stream({"messages": [{"role": "user", "content": "evaluate"}]},
                      {"callbacks": [Recorder(run, "PlotStar / Test")], "run_name": "PlotStar / Test"}, stream_mode="updates"):
        pass
    return run


def test_delegation_builds_the_graph_from_real_callbacks():
    task = AIMessage(content="", tool_calls=[{"name": "task", "id": "call_1", "args": {
        "description": "Assess costar:1 and return findings", "subagent_type": "property-intelligence"}}])
    run = _deep_run([task, AIMessage(content="Done.")], [AIMessage(content="Property looks fine.")])
    nodes = list(run.nodes.values())
    orch = next(n for n in nodes if n["name"] == ORCHESTRATOR)
    sub = next(n for n in nodes if n["name"] == "property-intelligence")
    assert orch["parent"] is None and sub["parent"] == orch["id"]
    assert sub["objective"] == "Assess costar:1 and return findings" and sub["delegation_id"] == "call_1"
    assert not any(n["name"] == "task" for n in nodes), "a delegation is an edge, not a node"
    models = [n for n in nodes if n["kind"] == "model"]
    assert {m["agent"] for m in models} == {ORCHESTRATOR, "property-intelligence"}
    assert all(n["status"] == "done" for n in nodes)
    assert run.trace_id == orch["lc_run_id"]


def test_parallel_delegations_each_get_their_own_agent_node():
    calls = AIMessage(content="", tool_calls=[
        {"name": "task", "id": "c1", "args": {"description": "A", "subagent_type": "property-intelligence"}},
        {"name": "task", "id": "c2", "args": {"description": "B", "subagent_type": "property-intelligence"}}])
    run = _deep_run([calls, AIMessage(content="ok")], [AIMessage(content="one"), AIMessage(content="two")])
    subs = [n for n in run.nodes.values() if n["name"] == "property-intelligence"]
    assert len(subs) == 2 and {s["delegation_id"] for s in subs} == {"c1", "c2"}
    for s in subs:  # each model call is attributed to the delegation that ran it
        assert [m for m in run.nodes.values() if m["kind"] == "model" and m["parent"] == s["id"]]


def test_structured_findings_are_captured_on_subagent_end():
    run = Run("test", "t", {})
    rec = Recorder(run, "Root")
    runtime.AGENT_INFO.setdefault("financial-feasibility", {"title": "Financial"})
    import uuid
    root, sub = uuid.uuid4(), uuid.uuid4()
    rec.on_chain_start({}, {}, run_id=root, name="Root")
    rec.on_chain_start({}, {}, run_id=sub, parent_run_id=root, name="financial-feasibility",
                       metadata={"lc_agent_name": "financial-feasibility", "lc_subagent_tool_call_id": "t9"})
    f = Findings(objective="o", summary="Negative NPV.", status="unfavourable", confidence="medium", confidence_reason="r",
                 evidence=[{"id": "E1", "tool": "development_economics", "what": "NPV"}])
    rec.on_chain_end({"messages": [], "structured_response": f}, run_id=sub)
    assert run.findings["financial-feasibility"]["status"] == "unfavourable"
    assert any(e["type"] == "finding" for e in run.events)


# ------------------------------------------------------------------------------------------------------ scoring

def _scored_run() -> Run:
    run = Run("test", "t", {"brief": {"mw_it": 20}})
    gates = [{"gate": "Residential proximity", "status": "Pass", "value": 1866, "unit": "m"},
             {"gate": "Sensitive places", "status": "Pass", "value": 522, "unit": "m"},
             {"gate": "Flood exposure", "status": "Pass", "value": "X"},
             {"gate": "Water stress", "status": "Pass", "value": "Medium - High"},
             {"gate": "Grid proximity", "status": "Pass", "value": 2.51, "unit": "km"}]
    run.add_evidence("screen_site", "geostar", {"gates": gates}, {})
    run.add_evidence("development_economics", "geostar", {"concepts": [{"id": "a", "rank": 1, "money": {
        "npv_p50": -100.0, "total_investment": 250.0, "payback_years": None, "months_to_power": 22}}]}, {})
    run.add_evidence("underwrite_acquisition", "costar-mcp", {"brief": {"lot_acres": 9.6}}, {})
    run.add_evidence("identify_data_gaps", "costar-mcp", {"counts": {"high": 4, "medium": 2, "low": 0}}, {})
    run.add_evidence("analyze_residential_impact", "costar-mcp", {"noise": {"receptors": [{"dba": 36.5}, {"dba": 33.4}]}}, {})
    return run


def test_score_is_reproducible_and_documented():
    run = _scored_run()
    a, b = scoring.compute(run), scoring.compute(_scored_run())
    assert a["score"] == b["score"] and a["coverage"] == 1.0 and not a["gaps"]
    land = next(c for p in a["pillars"] for c in p["criteria"] if c["key"] == "land")
    assert land["score"] == pytest.approx(48.0, abs=0.1) and land["costar"] is True  # 9.6 of 20 acres at 1 MW/acre
    pay = next(c for p in a["pillars"] for c in p["criteria"] if c["key"] == "payback")
    assert pay["score"] == 0.0  # no payback in the period
    assert sum(p["effective_weight"] for p in a["pillars"]) == pytest.approx(1.0, abs=0.01)
    assert {c["key"] for c in scoring.method()["criteria"]} == {c["key"] for c in scoring.CRITERIA}


def test_missing_evidence_is_a_gap_not_a_guess():
    run = _scored_run()
    run.evidence = {k: v for k, v in run.evidence.items() if v["tool"] != "development_economics"}
    res = scoring.compute(run)
    money = next(p for p in res["pillars"] if p["key"] == "financial")
    assert money["score"] is None and res["coverage"] == pytest.approx(0.7)
    assert {g["criterion"] for g in res["gaps"]} >= {"NPV (P50) relative to investment", "Payback", "Months to power"}


def test_a_failed_hard_gate_overrides_the_score():
    run = _scored_run()
    run.evidence["E1"]["data"]["gates"][2]["status"] = "Fail"
    assert scoring.compute(run)["verdict"] == "Not suitable"


def test_conflict_between_finding_and_its_evidence_is_reported():
    run = _scored_run()
    run.findings["financial-feasibility"] = {"status": "favourable"}
    res = scoring.compute(run)
    assert res["conflicts"] and res["conflicts"][0]["agent"] == "financial-feasibility"


# ------------------------------------------------------------------------------------------- privacy, verification

def test_costar_view_withholds_descriptive_fields(monkeypatch):
    monkeypatch.setattr(runtime, "LLM_COSTAR", False)
    d = {"name": "Kayvon Plaza", "address": "6134 Airline Dr", "lat": 29.9, "asking_price": 5e6, "lot_acres": 9.6,
         "checks": [{"name": "Floor area", "status": "fits"}], "nearest_homes": [{"street": "x"}, {"street": "y"}],
         "money": {"npv": -1.0, "capex": 2.0}, "sources": ["row 1"]}
    v = costar_view(d)
    assert "name" not in v and "address" not in v and "lat" not in v and "asking_price" not in v and "sources" not in v
    assert v["lot_acres"] == 9.6 and v["checks"][0]["name"] == "Floor area" and v["nearest_homes_count"] == 2
    assert v["money"] == {"npv": -1.0, "capex": 2.0}


def test_verification_flags_numbers_no_tool_returned():
    run = _scored_run()
    run.score = scoring.compute(run)
    run.answer = f"Check first at {run.score['score']}; nearest homes hear 36.5 dBA (E5). Rent is 4,321 a month (E99)."
    v = verify(run)
    assert 4321.0 in v["unverified_numbers"] and "E99" in v["unknown_citations"] and not v["grounded"]
    run.answer = f"Score {run.score['score']} with 36.5 dBA at homes (E5)."
    assert verify(run)["grounded"]


def test_costar_tools_are_served_over_mcp():
    from app.sponsors.langchain.deep_agents.mcp_client import MCP
    if not MCP.ensure(timeout=60):
        pytest.skip(f"CoStar MCP unavailable here: {MCP.error}")
    names = {t.name for t in MCP.tools}
    assert len(names) == 15 and {"get_property_intelligence", "underwrite_acquisition", "analyze_residential_impact"} <= names


def test_findings_boundary_recovers_loose_model_output_instead_of_looping():
    # observed from claude-haiku: the whole report packed as XML into `objective`, US spelling, string evidence
    f = Findings.model_validate({"objective": "Evaluate costar:1\n<summary>Shell too small.</summary><status>Unfavorable</status>"
                                              "<findings><item>Floor area fails (E3)</item></findings></Findings>",
                                 "evidence": ["E3: conversion screen"], "confidence": "Medium-high"})
    assert f.objective == "Evaluate costar:1" and f.summary == "Shell too small." and f.status == "unfavourable"
    assert f.findings == ["Floor area fails (E3)"] and f.evidence[0].id == "E3" and f.confidence == "medium"
    assert Findings.model_validate({"objective": "o"}).status == "mixed"
