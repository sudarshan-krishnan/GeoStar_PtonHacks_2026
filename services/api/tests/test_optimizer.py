"""Optimizer tests on synthetic sites: pure functions, no network, no database."""
from __future__ import annotations

import numpy as np
import pytest

from app import optimizer as O

PRICE = [30.0] * 24
PRICE[18] = 200.0  # one expensive evening hour
CARBON = [400.0] * 24
GRID = O.Grid(price=PRICE, carbon=CARBON, price_label="Simulated", carbon_label="Simulated", source="test")


def site(sid: str, land: float, km: float, status: str = "Pass", water_ok: bool = True, acres: float = 40.0) -> dict:
    gates = [{"gate": "Residential proximity", "status": "Pass", "value": 900, "limit": 300, "reason": "far"},
             {"gate": "Flood exposure", "status": "Pass", "value": "X", "limit": "outside SFHA", "reason": "ok"},
             {"gate": "Water stress", "status": "Pass", "value": "Low", "limit": "<=2", "reason": "ok"}]
    if status == "Fail":
        gates[0] = {"gate": "Residential proximity", "status": "Fail", "value": 120, "limit": 300, "reason": "homes 120 m"}
    return {"id": sid, "name": sid, "landCost": land, "lotAcres": acres, "supportableMw": acres,
            "screen": {"status": status, "gates": gates,
                       "power": {"water_cooling_ok": water_ok, "nearest_substation": {"distance_km": km}}}}


def test_schedule_moves_flexible_work_out_of_expensive_hour():
    p = O.Project(mw_it=10, flexible_share=0.5)
    cap = np.full(24, 10 * 1.4)
    r = O.schedule_day(10, 0.5, 1.4, cap, np.array(PRICE), np.array(CARBON), p)
    assert r is not None
    assert r["it_mw"][18] == pytest.approx(10 * 0.5 * 0.8)  # only the critical half (at 80% utilization) runs at 6 pm
    assert sum(r["it_mw"]) == pytest.approx(10 * 0.8 * 24)   # same total work as a flat day
    flat = O.schedule_day(10, 0.5, 1.4, cap, np.array(PRICE), np.array(CARBON), p, flat=True)
    assert r["cost"] < flat["cost"] and r["energy_mwh"] == pytest.approx(flat["energy_mwh"])  # cheaper, same energy


def test_curtailment_depth_must_fit_flexible_share():
    far = site("far", 1e6, 8.0)                               # 75% firm capacity -> 25% cut in stress hours
    res = O.evaluate(far, "air", 0.005, O.Project(mw_it=10, flexible_share=0.1), GRID)
    assert res["feasible"] is False and "exceeds flexible share" in res["reason"]
    ok = O.evaluate(far, "air", 0.005, O.Project(mw_it=10, flexible_share=0.3), GRID)
    assert ok["feasible"] is True and ok["d"] == pytest.approx(0.25)


def test_failed_gate_is_rejected_even_if_cheapest():
    sites = [site("cheap-fail", 1e6, 1.0, status="Fail"), site("ok", 5e6, 1.0)]
    res = O.optimize(sites, O.Project(mw_it=10), GRID)
    assert res["optimized"]["site_id"] == "ok"
    assert res["baseline"]["site_id"] == "ok"
    assert any(r["parcel_id"] == "cheap-fail" and r["gate"] == "Residential proximity" for r in res["rejected"])


def test_flexibility_unlocks_a_far_site_that_cost_first_cannot_use():
    # far site: 75% firm capacity -> needs 25% curtailment; near site: full capacity but dear land
    sites = [site("far-cheap", 1e6, 8.0), site("near-dear", 60e6, 1.0)]
    res = O.optimize(sites, O.Project(mw_it=10, flexible_share=0.3), GRID)
    assert res["baseline"]["site_id"] == "near-dear"        # no flexibility: far site infeasible
    assert res["optimized"]["site_id"] == "far-cheap"
    assert res["optimized"]["f"] > 0 and res["optimized"]["d"] == pytest.approx(0.25)
    assert res["delta"]["cost"] > 0


def test_water_cooling_excluded_by_water_gate():
    s = site("dry", 1e6, 1.0, water_ok=False)
    res = O.optimize([s], O.Project(mw_it=10), GRID)
    assert all(c["cooling"] != "water" for c in res["combinations"])


def test_what_if_price_rise_changes_cost_not_energy():
    sites = [site("a", 1e6, 1.0)]
    base = O.optimize(sites, O.Project(mw_it=10), GRID)["optimized"]
    up = O.optimize(sites, O.Project(mw_it=10, price_multiplier=1.3), GRID)["optimized"]
    assert up["energy_cost_year"] == pytest.approx(base["energy_cost_year"] * 1.3)
    assert up["energy_mwh_year"] == pytest.approx(base["energy_mwh_year"])
