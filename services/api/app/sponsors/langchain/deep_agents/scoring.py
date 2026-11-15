"""The site score: reproducible, documented, evidence-backed.

Agents decide what to investigate; the tools they call record evidence; this module turns that evidence into a score.
No model output enters the arithmetic. A criterion counts only when a tool the agents actually ran supplied it; a
missing criterion is reported as an evidence gap and its weight is shared across the criteria that do have evidence.

    score      = Σ pillar_weight × pillar_score, over pillars with evidence, re-normalised to the weights present
    pillar     = mean of its criteria with evidence (each 0–100, linear between the stated anchors)
    coverage   = share of the full weight that had evidence
    verdict    = Insufficient evidence if coverage < 60 %; Not suitable if any hard gate fails; at most Check first if a
                 gate needs review; else Good fit (≥ 70), Check first (≥ 50), Not suitable (< 50)
"""
from __future__ import annotations

from typing import Any, Callable

from app.engine import assumptions as A
from app.sponsors.langchain.deep_agents.runtime import Run

PILLARS: dict[str, dict[str, Any]] = {
    "property": {"label": "Property", "weight": 0.20, "agent": "property-intelligence"},
    "financial": {"label": "Money", "weight": 0.30, "agent": "financial-feasibility"},
    "resource": {"label": "Power and resources", "weight": 0.25, "agent": "resource-infrastructure"},
    "community": {"label": "People and planet", "weight": 0.25, "agent": "community-sustainability"},
}
HARD_GATES = ("Residential proximity", "Sensitive places", "Flood exposure", "Water stress", "Grid proximity")


def _lin(x: float, zero: float, full: float) -> float:
    """0 at `zero`, 100 at `full`, linear between, clamped."""
    if full == zero:
        return 100.0 if x >= full else 0.0
    return round(max(0.0, min(1.0, (x - zero) / (full - zero))) * 100, 1)


def _gate(run: Run, name: str) -> tuple[dict | None, dict | None]:
    ev = run.latest("screen_site")
    if not ev:
        return None, None
    g = next((g for g in ev["data"].get("gates", []) if g.get("gate") == name), None)
    return (g, ev) if g else (None, ev)


_GATE_SCORE = {"Pass": 100.0, "Needs review": 50.0, "Fail": 0.0}


def _concept(run: Run, ev: dict) -> dict | None:
    cs = ev["data"].get("concepts") or []
    pref = (run.context or {}).get("concept_id")
    return next((c for c in cs if c.get("id") == pref), None) or next((c for c in cs if c.get("rank") == 1), cs[0] if cs else None)


def _money(run: Run) -> tuple[dict | None, dict | None]:
    ev = run.latest("development_economics")
    if ev:
        c = _concept(run, ev)
        if c:
            return c.get("money"), ev
    ev = run.latest("underwrite_acquisition")
    if ev and isinstance(ev["data"].get("money"), dict):
        return ev["data"]["money"], ev
    return None, None


# Each extractor returns (raw value, normalised 0-100, plain-language reading, evidence record) or None.
Extract = Callable[[Run], "tuple[Any, float, str, dict] | None"]


def _land(run: Run):
    need = float((run.context.get("brief") or {}).get("mw_it") or 20) / max(A.value("mw_per_acre"), 1e-6)
    for tool, path in (("underwrite_acquisition", ("brief", "lot_acres")), ("get_property_intelligence", ("lot_acres",))):
        ev = run.latest(tool)
        if not ev:
            continue
        v: Any = ev["data"]
        for k in path:
            v = v.get(k) if isinstance(v, dict) else None
        if v is None and tool == "get_property_intelligence":
            b = next((s for s in (ev["data"].get("sections") or []) if isinstance(s, dict) and s.get("title") == "building"), {})
            v = (b.get("facts") or b).get("lot_acres") if isinstance(b, dict) else None
        if isinstance(v, (int, float)) and v > 0:
            return v, _lin(v / need, 0, 1.0), f"{v:.1f} acres for {need:.0f} acres needed", ev
    return None


def _diligence(run: Run):
    ev = run.latest("identify_data_gaps")
    if not ev:
        return None
    c = ev["data"].get("counts") or {}
    h, m, lo = int(c.get("high", 0)), int(c.get("medium", 0)), int(c.get("low", 0))
    return dict(high=h, medium=m, low=lo), max(0.0, 100 - 20 * h - 8 * m - 2 * lo), f"{h} high, {m} medium, {lo} low open items", ev


def _npv(run: Run):
    m, ev = _money(run)
    if not m:
        return None
    npv, inv = m.get("npv_p50", m.get("npv")), m.get("total_investment") or m.get("capex")
    if not isinstance(npv, (int, float)) or not inv:
        return None
    r = npv / inv
    return round(r, 3), _lin(r, -1.0, 0.5), f"NPV P50 is {r * 100:.0f}% of the investment", ev


def _payback(run: Run):
    m, ev = _money(run)
    if not m or "payback_years" not in m:
        return None
    p = m.get("payback_years")
    if p is None:
        return None, 0.0, "does not pay back within the analysis period", ev
    return p, _lin(-float(p), -15, -5), f"pays back in {p:.1f} years", ev


def _power_time(run: Run):
    m, ev = _money(run)
    if not m or not isinstance(m.get("months_to_power"), (int, float)):
        return None
    v = float(m["months_to_power"])
    return v, _lin(-v, -48, -12), f"{v:.0f} months to power", ev


def _substation(run: Run):
    g, ev = _gate(run, "Grid proximity")
    if not g or not isinstance(g.get("value"), (int, float)):
        return None
    v = float(g["value"])
    return v, _lin(-v, -10, -1), f"{v:.1f} km to a ≥138 kV substation", ev


def _gate_extract(name: str, reading: str) -> Extract:
    def f(run: Run):
        g, ev = _gate(run, name)
        if not g:
            return None
        return g.get("status"), _GATE_SCORE.get(g.get("status"), 50.0), f"{reading}: {g.get('status')}", ev
    return f


def _homes(run: Run):
    g, ev = _gate(run, "Residential proximity")
    if g and isinstance(g.get("value"), (int, float)):
        v = float(g["value"])
        return v, _lin(v, 300, 1500), f"nearest home {v:.0f} m away", ev
    ev = run.latest("analyze_residential_impact")
    if ev and isinstance(ev["data"].get("engine_gate_home_m"), (int, float)):
        v = float(ev["data"]["engine_gate_home_m"])
        return v, _lin(v, 300, 1500), f"nearest home {v:.0f} m away", ev
    return None


def _noise(run: Run):
    ev = run.latest("analyze_residential_impact")
    if ev:
        rec = (ev["data"].get("noise") or {}).get("receptors") or []
        dbs = [r.get("dba") for r in rec if isinstance(r.get("dba"), (int, float))]
        if dbs:
            v = max(dbs)
            return v, _lin(-v, -55, -40), f"loudest home hears {v:.0f} dBA from the generators", ev
    ev = run.latest("community_impact")
    if ev:
        c = _concept(run, ev)
        v = ((c or {}).get("people") or {}).get("noise_at_home_dba")
        if isinstance(v, (int, float)):
            return v, _lin(-v, -55, -40), f"nearest home hears {v:.0f} dBA from the generators", ev
    return None


CRITERIA: list[dict[str, Any]] = [
    dict(pillar="property", key="land", label="Land for the target capacity", fn=_land,
         rule="lot acres ÷ acres needed (capacity ÷ MW per acre): 0× → 0, ≥ 1× → 100",
         tools=["get_property_intelligence", "underwrite_acquisition"]),
    dict(pillar="property", key="diligence", label="Diligence completeness", fn=_diligence,
         rule="100 − 20 per high, 8 per medium, 2 per low open item", tools=["identify_data_gaps"]),
    dict(pillar="financial", key="npv", label="NPV (P50) relative to investment", fn=_npv,
         rule="−100 % → 0, +50 % → 100", tools=["development_economics", "underwrite_acquisition"]),
    dict(pillar="financial", key="payback", label="Payback", fn=_payback,
         rule="≥ 15 years or none in the period → 0, ≤ 5 years → 100", tools=["development_economics", "underwrite_acquisition"]),
    dict(pillar="financial", key="time_to_power", label="Months to power", fn=_power_time,
         rule="≥ 48 → 0, ≤ 12 → 100", tools=["development_economics", "underwrite_acquisition"]),
    dict(pillar="resource", key="substation", label="Distance to a ≥ 138 kV substation", fn=_substation,
         rule="≥ 10 km → 0, ≤ 1 km → 100", tools=["screen_site"]),
    dict(pillar="resource", key="water", label="Water stress (WRI Aqueduct)", fn=_gate_extract("Water stress", "water stress"),
         rule="Pass 100 · Needs review 50 · Fail 0", tools=["screen_site"]),
    dict(pillar="resource", key="flood", label="Flood exposure (FEMA NFHL)", fn=_gate_extract("Flood exposure", "flood exposure"),
         rule="Pass 100 · Needs review 50 · Fail 0", tools=["screen_site"]),
    dict(pillar="community", key="homes", label="Distance to the nearest home", fn=_homes,
         rule="≤ 300 m → 0, ≥ 1,500 m → 100", tools=["screen_site", "analyze_residential_impact"]),
    dict(pillar="community", key="noise", label="Generator noise at the nearest home", fn=_noise,
         rule="≥ 55 dBA → 0, ≤ 40 dBA → 100", tools=["analyze_residential_impact", "community_impact"]),
    dict(pillar="community", key="sensitive", label="Schools, worship, hospitals and childcare",
         fn=_gate_extract("Sensitive places", "sensitive places"), rule="Pass 100 · Needs review 50 · Fail 0", tools=["screen_site"]),
]


def method() -> dict[str, Any]:
    """The scoring rule as data, for the UI and the docs."""
    return dict(pillars={k: {kk: vv for kk, vv in v.items()} for k, v in PILLARS.items()},
                criteria=[{k: v for k, v in c.items() if k != "fn"} for c in CRITERIA], hard_gates=list(HARD_GATES),
                verdict="Insufficient evidence if coverage < 60 %; Not suitable if a hard gate fails; at most Check first if "
                        "a gate needs review; else Good fit ≥ 70, Check first ≥ 50, Not suitable < 50.",
                note=__doc__.strip().split("\n\n")[1].strip())


def compute(run: Run) -> dict[str, Any]:
    """Score the run's evidence. Pure function of the evidence records (and the run's brief for acres needed)."""
    pillars: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    for pk, p in PILLARS.items():
        crit = []
        for c in (c for c in CRITERIA if c["pillar"] == pk):
            got = c["fn"](run)
            if got is None:
                gaps.append(dict(criterion=c["label"], pillar=p["label"], agent=p["agent"],
                                 reason=f"No evidence: none of {', '.join(c['tools'])} was run for this site."))
                crit.append(dict(key=c["key"], label=c["label"], rule=c["rule"], value=None, score=None, evidence=None,
                                 agent=None, reading="evidence gap", costar=False))
                continue
            raw, sc, reading, ev = got
            crit.append(dict(key=c["key"], label=c["label"], rule=c["rule"], value=raw, score=sc, evidence=ev["id"],
                             agent=ev.get("agent"), reading=reading, costar=ev["provider"].startswith("costar")))
        have = [c["score"] for c in crit if c["score"] is not None]
        pillars.append(dict(key=pk, label=p["label"], weight=p["weight"], agent=p["agent"], criteria=crit,
                            score=round(sum(have) / len(have), 1) if have else None,
                            coverage=round(len(have) / len(crit), 2)))
    present = [p for p in pillars if p["score"] is not None]
    wsum = sum(p["weight"] * p["coverage"] for p in present)
    score = round(sum(p["weight"] * p["coverage"] * p["score"] for p in present) / wsum, 1) if wsum else None
    for p in pillars:
        p["effective_weight"] = round(p["weight"] * p["coverage"] / wsum, 3) if wsum and p["score"] is not None else 0.0
    coverage = round(sum(p["weight"] * p["coverage"] for p in pillars), 2)

    gate_rows: list[dict[str, Any]] = []
    screen = run.latest("screen_site")
    if screen:
        for g in screen["data"].get("gates", []):
            if g.get("gate") in HARD_GATES:
                gate_rows.append(dict(gate=g["gate"], status=g.get("status"), value=g.get("value"), unit=g.get("unit"),
                                      evidence=screen["id"]))
    failed = [g["gate"] for g in gate_rows if g["status"] == "Fail"]
    review = [g["gate"] for g in gate_rows if g["status"] == "Needs review"]

    if score is None or coverage < 0.6:
        verdict, why = "Insufficient evidence", f"Only {coverage * 100:.0f}% of the scoring weight has evidence."
    elif failed:
        verdict, why = "Not suitable", f"Hard gate failed: {', '.join(failed)}."
    elif score >= 70 and not review:
        verdict, why = "Good fit", f"Score {score:.0f} with every hard gate passing."
    elif score >= 50:
        verdict, why = "Check first", (f"Needs review: {', '.join(review)}." if review else f"Score {score:.0f} is between 50 and 70.")
    else:
        verdict, why = "Not suitable", f"Score {score:.0f} is below 50."

    # conflicts: what a specialist concluded vs what its own pillar's evidence scores
    conflicts = []
    for p in pillars:
        f = run.findings.get(p["agent"]) or {}
        st = f.get("status")
        if p["score"] is None or not st:
            continue
        if st == "favourable" and p["score"] < 40 or st == "unfavourable" and p["score"] > 70:
            conflicts.append(dict(pillar=p["label"], agent=p["agent"], agent_status=st, pillar_score=p["score"],
                                  note=f"{p['agent']} reported '{st}' but its evidence scores {p['score']:.0f}/100."))
    confidence = "high" if coverage >= 0.9 and not conflicts else "medium" if coverage >= 0.6 else "low"
    return dict(score=score, verdict=verdict, verdict_reason=why, coverage=coverage, confidence=confidence,
                pillars=pillars, gates=gate_rows, gaps=gaps, conflicts=conflicts,
                method="Weighted mean of evidence-backed criteria; see /agents/architecture for every rule.")


def model_view(result: dict[str, Any]) -> dict[str, Any]:
    """What the orchestrator model sees: scores, readings and evidence ids; raw CoStar values stay out unless allowed."""
    from app.sponsors.langchain.deep_agents.runtime import LLM_COSTAR
    out = {k: v for k, v in result.items() if k != "pillars"}
    out["pillars"] = [dict(label=p["label"], score=p["score"], effective_weight=p["effective_weight"],
                           criteria=[dict(label=c["label"], score=c["score"], evidence=c["evidence"],
                                          reading=(c["reading"] if (LLM_COSTAR or not c["costar"]) else "from the CoStar record (held locally)"))
                                     for c in p["criteria"]]) for p in result["pillars"]]
    return out
