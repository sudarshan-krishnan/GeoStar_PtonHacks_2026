"""Joint site + cooling + flexibility + schedule optimizer (PRD section 10).

Mathematical optimization, not a weighted score and not an LLM judgment:
  1. enumerate site x cooling x flexibility level (small: ~35 x 3 x 4),
  2. drop combinations that fail a hard gate or whose required curtailment depth exceeds the flexible share,
  3. solve the 24-hour flexible-load schedule exactly (one equality + box bounds -> greedy fill of the
     cheapest-cleanest hours is optimal) for a normal day and a grid-stress day,
  4. compute annual energy / water / CO2 and lifecycle cost (capex + PV of opex), rank by lifecycle cost.

Baseline = cost-first: cheapest feasible site with NO flexibility (f = 0, so it needs full firm capacity),
default cooling, flat load. Both answers are returned side by side with the delta.

Every assumption comes from `assumptions.py` (value + basis + label) or from the request's overrides.
Pure functions; no I/O except `store_run`/`load_run` at the bottom.
"""
from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from . import assumptions as A
from .db import session

FLEX_LEVELS = [0.0, 0.0025, 0.005, 0.01]          # share of the 8,760 annual hours curtailed
STRESS_HOURS = {0.0: 0, 0.0025: 2, 0.005: 3, 0.01: 4}  # curtailed hours on a representative stress day (team assumption)
COOLINGS = ["air", "hybrid", "water"]
DEFAULT_COOLING = "air"

DDL = """
CREATE TABLE IF NOT EXISTS optimizer_runs (
    run_id       TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL,
    request_json TEXT NOT NULL,
    result_json  TEXT NOT NULL
)
"""


def init() -> None:
    with session() as c:
        c.execute(DDL)


@dataclass
class Project:
    mw_it: float
    flexible_share: float = 0.3          # share of IT load that can be deferred within the day
    horizon_years: int = 10
    price_multiplier: float = 1.0
    carbon_price_per_t: float = 0.0
    delay_months: float = 0.0
    capital_budget: float | None = None
    overrides: dict[str, float] = field(default_factory=dict)
    firm_capacity_overrides: dict[str, float] = field(default_factory=dict)   # parcel_id -> share of requested grid MW


@dataclass
class Grid:
    price: list[float]        # 24 x $/MWh
    carbon: list[float]       # 24 x kg CO2/MWh
    price_label: str
    carbon_label: str
    source: str


def v(key: str, p: Project) -> float:
    return A.value(key, p.overrides)


# ----------------------------------------------------------------------------- feasibility

def firm_capacity_share(site: dict[str, Any], p: Project) -> tuple[float, str]:
    """Scenario firm capacity H(s) as a share of the requested grid MW. Simulated until a utility confirms."""
    if site["id"] in p.firm_capacity_overrides:
        return float(p.firm_capacity_overrides[site["id"]]), "user scenario"
    sub = (site.get("screen") or {}).get("power", {}).get("nearest_substation") or {}
    km = sub.get("distance_km")
    near = v("firm_capacity_near_km", p)
    if km is not None and km <= near:
        return 1.0, f"within {near:g} km of a >= 138 kV substation (team scenario: full firm capacity)"
    return v("firm_capacity_far_share", p), f"{km if km is not None else '?'} km from a >= 138 kV substation (team scenario)"


def cooling_allowed(site: dict[str, Any], cooling: str) -> tuple[bool, str]:
    scr = site.get("screen") or {}
    gates = {g["gate"]: g for g in scr.get("gates", [])}
    water_ok = scr.get("power", {}).get("water_cooling_ok")
    if cooling == "water" and not water_ok:
        return False, "water cooling excluded: water-stress gate"
    if cooling == "hybrid" and gates.get("Water stress", {}).get("status") == "Fail":
        return False, "hybrid cooling excluded: water-stress gate failed"
    return True, ""


# ----------------------------------------------------------------------------- scheduling LP

def schedule_day(mw_it: float, flex: float, pue: float, cap_grid: np.ndarray, price: np.ndarray,
                 carbon: np.ndarray, p: Project, flat: bool = False) -> dict[str, Any] | None:
    """Allocate the day's flexible energy across 24 hours under a grid power envelope. Returns None if infeasible.

    mw_it is the IT capacity; average utilization is `it_load_factor`, so the critical share runs flat at
    (1 - flex) x mw_it x lf and the flexible share must deliver flex x mw_it x lf x 24 MWh before the day ends.
    """
    lf = v("it_load_factor", p)
    critical = mw_it * (1 - flex) * lf
    cap_it = cap_grid / pue
    headroom = cap_it - critical
    if (headroom < -1e-9).any():
        return None  # critical load alone exceeds the envelope: depth needed > flexible share
    e_flex = flex * mw_it * lf * 24.0
    flex_rate_max = min(flex * mw_it, flex * mw_it * lf * v("flex_rate_multiple", p))
    ub = np.minimum(headroom, flex_rate_max)
    if flat:
        x = np.full(24, flex * mw_it * lf)
        if (x > ub + 1e-9).any():
            return None
    elif e_flex <= 1e-9:
        x = np.zeros(24)
    else:
        if ub.sum() < e_flex - 1e-6:
            return None  # cannot finish the day's flexible work before its deadline
        cost_coef = pue * (price * p.price_multiplier + p.carbon_price_per_t * carbon / 1000.0)
        # Exact solution of  min sum(c_t x_t)  s.t.  sum x_t = E,  0 <= x_t <= ub_t : fill cheapest hours first.
        x = np.zeros(24)
        remaining = e_flex
        for t in np.argsort(cost_coef, kind="stable"):
            take = min(ub[t], remaining)
            x[t] = take
            remaining -= take
            if remaining <= 1e-9:
                break
    it_load = critical + x
    grid_load = it_load * pue
    return {
        "it_mw": [round(float(a), 3) for a in it_load],
        "grid_mw": [round(float(a), 3) for a in grid_load],
        "energy_mwh": float(grid_load.sum()),
        "cost": float((grid_load * price * p.price_multiplier).sum()),
        "co2_kg": float((grid_load * carbon).sum()),
        "peak_mw": float(grid_load[np.argsort(-price)[:4]].mean()),   # MW drawn during the grid's 4 peak-price hours
        "max_mw": float(grid_load.max()),
    }


# ----------------------------------------------------------------------------- economics

def evaluate(site: dict[str, Any], cooling: str, f: float, p: Project, grid: Grid, flat: bool = False) -> dict[str, Any]:
    """One configuration. Returns {'feasible': bool, 'reason': str} or the full result."""
    scr = site.get("screen") or {}
    if scr.get("status") == "Fail":
        failed = [g for g in scr.get("gates", []) if g["status"] == "Fail"]
        return {"feasible": False, "reason": f"fails hard gate: {', '.join(g['gate'] for g in failed)}"}
    ok, why = cooling_allowed(site, cooling)
    if not ok:
        return {"feasible": False, "reason": why}
    pue = v(f"pue_{cooling}", p)
    requested_grid = p.mw_it * pue
    h_share, h_basis = firm_capacity_share(site, p)
    depth = max(0.0, 1.0 - h_share)                      # share of load that must be shed in a stress hour
    if f == 0.0 and h_share < 1.0 - 1e-9:
        return {"feasible": False, "reason": f"needs {depth:.0%} curtailment but no flexibility offered (firm capacity {h_share:.0%} of request)"}
    if depth > p.flexible_share + 1e-9:
        return {"feasible": False, "reason": f"required curtailment depth {depth:.0%} exceeds flexible share {p.flexible_share:.0%}"}
    if site.get("supportableMw") is not None and site["supportableMw"] < p.mw_it * v("site_fit_tolerance", p):
        return {"feasible": False, "reason": f"lot supports ~{site['supportableMw']} MW at the density assumption"}

    price, carbon = np.array(grid.price), np.array(grid.carbon)
    normal_cap = np.full(24, requested_grid)
    normal = schedule_day(p.mw_it, p.flexible_share, pue, normal_cap, price, carbon, p, flat)
    if normal is None:
        return {"feasible": False, "reason": "flexible work cannot be completed within the day"}
    k = STRESS_HOURS[f]
    stress_days = (f * 8760.0 / k) if k else 0.0
    if k:
        stress_hours = np.argsort(-price)[:k]
        cap = normal_cap.copy()
        cap[stress_hours] = requested_grid * h_share
        stress = schedule_day(p.mw_it, p.flexible_share, pue, cap, price, carbon, p, flat)
        if stress is None:
            return {"feasible": False, "reason": "cannot ride through the grid-stress hours"}
    else:
        stress, stress_hours = normal, np.array([], dtype=int)

    normal_days = 365.0 - stress_days
    energy_mwh = normal["energy_mwh"] * normal_days + stress["energy_mwh"] * stress_days
    energy_cost = normal["cost"] * normal_days + stress["cost"] * stress_days
    co2_t = (normal["co2_kg"] * normal_days + stress["co2_kg"] * stress_days) / 1000.0
    water_gal = energy_mwh / pue * 1000.0 * v(f"wue_{cooling}", p) / A.LITERS_PER_GALLON
    water_cost = water_gal / 1000.0 * v("water_price_per_kgal", p)
    opex = energy_cost + water_cost + p.mw_it * v("opex_per_mw_year", p)

    sub = scr.get("power", {}).get("nearest_substation") or {}
    km = sub.get("distance_km") or v("default_substation_km", p)
    interconnect = km * v("interconnect_cost_per_km", p)
    land = float(site.get("landCost") or 0.0)
    capex = land + p.mw_it * (v("capex_per_mw", p) + v(f"cooling_capex_{cooling}", p)) + interconnect
    if p.capital_budget is not None and capex > p.capital_budget:
        return {"feasible": False, "reason": f"capex ${capex/1e6:,.0f}M exceeds budget"}

    r = v("discount_rate", p)
    annuity = sum(1.0 / (1 + r) ** t for t in range(1, p.horizon_years + 1))
    delay_cost = p.delay_months * v("delay_penalty_per_month_per_mw", p) * p.mw_it
    lifecycle = capex + opex * annuity + delay_cost
    revenue = p.mw_it * v("revenue_per_mw_year", p)
    npv = revenue * annuity - lifecycle
    payback = (capex + delay_cost) / max(1e-9, revenue - opex) if revenue > opex else None

    return {
        "feasible": True,
        "site_id": site["id"], "site_name": site.get("name"),
        "cooling": cooling, "f": f, "d": round(depth, 3), "firm_capacity_share": h_share, "firm_capacity_basis": h_basis,
        "stress_hours": [int(h) for h in stress_hours], "stress_days_per_year": round(stress_days, 1),
        "pue": pue, "land": land, "interconnect": interconnect, "capex": capex,
        "energy_mwh_year": energy_mwh, "energy_cost_year": energy_cost, "water_gal_year": water_gal,
        "opex_year": opex, "delay_cost": delay_cost,
        "cost": lifecycle, "npv": npv, "payback_years": payback,
        "co2_est_t_year": co2_t, "peak_mw": normal["peak_mw"], "max_mw": normal["max_mw"],
        "water_cost_year": water_cost,
        "schedule": normal["grid_mw"], "schedule_stress": stress["grid_mw"],
    }


# ----------------------------------------------------------------------------- orchestration

def optimize(sites: list[dict[str, Any]], p: Project, grid: Grid) -> dict[str, Any]:
    combos, rejected, infeasible = [], [], []
    for s in sites:
        scr = s.get("screen") or {}
        if scr.get("status") == "Fail":
            for g in scr.get("gates", []):
                if g["status"] == "Fail":
                    rejected.append({"parcel_id": s["id"], "name": s.get("name"), "gate": g["gate"],
                                     "value": g["value"], "limit": g["limit"], "reason": g["reason"]})
            continue
        for c in COOLINGS:
            for f in FLEX_LEVELS:
                res = evaluate(s, c, f, p, grid)
                if res["feasible"]:
                    combos.append(res)
                else:
                    infeasible.append({"site_id": s["id"], "name": s.get("name"), "cooling": c, "f": f, "reason": res["reason"]})
    combos.sort(key=lambda x: x["cost"])
    optimized = combos[0] if combos else None

    baseline_pool = [evaluate(s, DEFAULT_COOLING, 0.0, p, grid, flat=True) for s in sites
                     if (s.get("screen") or {}).get("status") != "Fail"]
    baseline_pool = [b for b in baseline_pool if b["feasible"]]
    baseline_pool.sort(key=lambda x: x["capex"])          # cost-first: cheapest to acquire and build
    baseline = baseline_pool[0] if baseline_pool else None

    delta = None
    if optimized and baseline:
        delta = {
            "cost": baseline["cost"] - optimized["cost"],
            "npv": optimized["npv"] - baseline["npv"],
            "co2_est_t_year": baseline["co2_est_t_year"] - optimized["co2_est_t_year"],
            "peak_mw": baseline["peak_mw"] - optimized["peak_mw"],
            "same_site": baseline["site_id"] == optimized["site_id"],
        }
    run_id = uuid.uuid4().hex[:12]
    result = {
        "run_id": run_id,
        "objective": "minimize lifecycle cost (capex + PV of opex over the horizon) for a fixed computing requirement",
        "baseline": baseline, "optimized": optimized, "delta": delta,
        "combinations": combos[:60], "infeasible": infeasible[:200], "rejected": rejected,
        "feasibility_notes": [
            "Moving computation to another hour does not reduce energy; it changes cost, carbon and peak.",
            "Firm capacity H(s) is a scenario (Simulated) until a utility study confirms it.",
            f"Grid prices: {grid.price_label} ({grid.source}); wholesale prices are not a retail tariff.",
            f"Carbon: {grid.carbon_label}; annual factors are not hourly measurements.",
        ],
        "labels": {
            "cost": "Estimated", "npv": "Estimated", "capex": "Estimated", "opex_year": "Estimated",
            "co2_est_t_year": "Estimated", "peak_mw": "Estimated", "schedule": "Estimated",
            "land": "Sourced/Estimated (see site)", "firm_capacity_share": "Simulated", "price": grid.price_label,
        },
        "assumptions_used": [a for a in A.as_list() if a["key"] in USED_KEYS],
        "grid": {"price": grid.price, "carbon": grid.carbon, "source": grid.source},
    }
    return result


USED_KEYS = {"pue_air", "pue_hybrid", "pue_water", "wue_air", "wue_hybrid", "wue_water", "capex_per_mw",
             "cooling_capex_air", "cooling_capex_hybrid", "cooling_capex_water", "opex_per_mw_year",
             "water_price_per_kgal", "interconnect_cost_per_km", "default_substation_km", "discount_rate",
             "revenue_per_mw_year", "delay_penalty_per_month_per_mw", "flex_rate_multiple",
             "firm_capacity_near_km", "firm_capacity_far_share", "site_fit_tolerance", "mw_per_acre"}

FORMULAS = {
    "cost": "capex + opex_year x annuity(discount_rate, horizon) + delay_cost",
    "capex": "land + MW_IT x (capex_per_mw + cooling_capex[cooling]) + km_to_substation x interconnect_cost_per_km",
    "opex_year": "energy_cost_year + water_cost + MW_IT x opex_per_mw_year",
    "energy_cost_year": "sum over hours of grid MW x price x multiplier, for normal days + stress days",
    "npv": "revenue_per_mw_year x MW_IT x annuity - cost",
    "co2_est_t_year": "sum over hours of grid MW x hourly carbon factor, annualized",
    "peak_mw": "average grid MW drawn during the day's 4 highest-price hours (the grid's peak)",
    "d": "1 - firm_capacity_share (share of load shed during stress hours)",
    "schedule": "24-hour LP: minimize energy cost s.t. flexible energy delivered, envelope, rate limit",
}


def store_run(request: dict[str, Any], result: dict[str, Any]) -> None:
    with session() as c:
        c.execute("INSERT INTO optimizer_runs VALUES (?,?,?,?)",
                  (result["run_id"], datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   json.dumps(request), json.dumps(result)))


def load_run(run_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    with session() as c:
        row = c.execute("SELECT request_json, result_json FROM optimizer_runs WHERE run_id = ?", (run_id,)).fetchone()
    return (json.loads(row["request_json"]), json.loads(row["result_json"])) if row else None


def audit(run_id: str, field_path: str) -> dict[str, Any] | None:
    """Evidence chain for a displayed figure, e.g. 'optimized.cost' or 'delta.co2_est_t_year'."""
    loaded = load_run(run_id)
    if not loaded:
        return None
    req, res = loaded
    head, _, fld = field_path.partition(".")
    obj = res.get(head) if head in ("optimized", "baseline", "delta") else None
    if obj is None or fld not in obj:
        return None
    return {
        "run_id": run_id, "field": field_path, "value": obj[fld],
        "label": res["labels"].get(fld, "Estimated"),
        "formula": FORMULAS.get(fld, "see optimizer.py"),
        "inputs": {k: obj[k] for k in ("site_id", "cooling", "f", "d", "pue", "firm_capacity_share") if k in obj},
        "assumptions": res["assumptions_used"],
        "grid_source": res["grid"]["source"],
        "request": req,
    }
