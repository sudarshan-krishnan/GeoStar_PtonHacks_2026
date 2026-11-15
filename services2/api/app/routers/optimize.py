"""Optimizer, what-if scenarios, audit trail and the grid day (PRD section 10 contract).

POST /optimize               project + search scope -> baseline vs optimized, rejected, run_id
POST /scenarios/run          run_id + changed inputs -> a new run (what-if), linked to its parent
GET  /audit/run/{run_id}/{field}   evidence chain for a figure, e.g. optimized.cost
GET  /runs/{run_id}          a stored run
GET  /grid/day               the cached ERCOT day (prices Sourced, carbon Estimated)
"""
from __future__ import annotations

import dataclasses
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import grid as G
from .. import optimizer as O
from .screen import Filters, SearchIn, ThresholdsIn, run_search

router = APIRouter(tags=["optimize"])


class OptimizeIn(BaseModel):
    market: Literal["Houston", "Los Angeles"] = "Houston"
    polygon: list[tuple[float, float]] | None = None
    parcel_ids: list[str] | None = Field(None, description="restrict to these parcels (e.g. the user's shortlist)")
    min_acres: float = Field(2, ge=0)
    limit: int = Field(60, ge=1, le=200)
    thresholds: ThresholdsIn = Field(default_factory=ThresholdsIn)

    mw_it: float = Field(..., gt=0, le=2000)
    flexible_share: float = Field(0.3, ge=0, le=1)
    horizon_years: int = Field(10, ge=1, le=30)
    price_multiplier: float = Field(1.0, gt=0, le=5)
    carbon_price_per_t: float = Field(0.0, ge=0, le=1000)
    delay_months: float = Field(0.0, ge=0, le=120)
    capital_budget: float | None = Field(None, gt=0)
    assumptions: dict[str, float] = Field(default_factory=dict)
    firm_capacity: dict[str, float] = Field(default_factory=dict, description="parcel_id -> share of requested grid MW")
    also_inflexible: bool = Field(True, description="also solve with flexible_share = 0 to show whether flexibility changes the site")
    offline: bool = False


def _grid(offline: bool) -> tuple[O.Grid, dict[str, Any]]:
    gd = G.grid_day(offline=offline)
    return O.Grid(price=gd["price"], carbon=gd["carbon"], price_label=gd["price_label"],
                  carbon_label=gd["carbon_label"], source=f"{gd['price_source']}; {gd['carbon_source']}"), gd


def _run(q: OptimizeIn, parent_run_id: str | None = None) -> dict[str, Any]:
    t0 = time.time()
    search = run_search(SearchIn(market=q.market, polygon=q.polygon, filters=Filters(min_acres=q.min_acres),
                                 thresholds=q.thresholds, assumptions=q.assumptions, limit=q.limit), offline=q.offline)
    sites = search["sites"]
    if q.parcel_ids:
        keep = set(q.parcel_ids)
        sites = [s for s in sites if s["id"] in keep]
    if not sites:
        raise HTTPException(404, "No candidate sites in scope")
    grid, gd = _grid(q.offline)
    project = O.Project(mw_it=q.mw_it, flexible_share=q.flexible_share, horizon_years=q.horizon_years,
                        price_multiplier=q.price_multiplier, carbon_price_per_t=q.carbon_price_per_t,
                        delay_months=q.delay_months, capital_budget=q.capital_budget, overrides=q.assumptions,
                        firm_capacity_overrides=q.firm_capacity)
    result = O.optimize(sites, project, grid)
    if q.also_inflexible and q.flexible_share > 0:
        r0 = O.optimize(sites, dataclasses.replace(project, flexible_share=0.0), grid)
        result["inflexible"] = r0["optimized"]
        result["inflexible_feasible_plans"] = len(r0["combinations"])
    result["parent_run_id"] = parent_run_id
    result["elapsed_s"] = round(time.time() - t0, 2)
    result["grid"].update({k: gd[k] for k in ("price_label", "carbon_label", "price_date", "carbon_date", "hub")})
    result["grid"]["mix"] = gd.get("mix")
    result["sites"] = [{"id": s["id"], "name": s["name"], "status": s["screen"]["status"], "pillars": s["pillars"],
                        "landCost": s["landCost"], "lotAcres": s["lotAcres"], "lat": s["lat"], "lng": s["lng"],
                        "supportableMw": s.get("supportableMw")} for s in sites]
    O.store_run(q.model_dump(), result)
    return result


@router.post("/optimize")
def optimize(q: OptimizeIn) -> dict[str, Any]:
    return _run(q)


class ScenarioIn(BaseModel):
    run_id: str
    changes: dict[str, Any] = Field(..., description="any OptimizeIn fields to change, e.g. {'price_multiplier': 1.3}")


@router.post("/scenarios/run")
def scenario(s: ScenarioIn) -> dict[str, Any]:
    loaded = O.load_run(s.run_id)
    if not loaded:
        raise HTTPException(404, "Unknown run_id")
    req, _ = loaded
    merged = {**req, **s.changes}
    if "assumptions" in s.changes:
        merged["assumptions"] = {**req.get("assumptions", {}), **s.changes["assumptions"]}
    merged["offline"] = True  # what-ifs re-use cached evidence so they stay under the 10 s budget
    return _run(OptimizeIn.model_validate(merged), parent_run_id=s.run_id)


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    loaded = O.load_run(run_id)
    if not loaded:
        raise HTTPException(404, "Unknown run_id")
    req, res = loaded
    return {"request": req, "result": res}


@router.get("/audit/run/{run_id}/{field}")
def audit_run(run_id: str, field: str) -> dict[str, Any]:
    chain = O.audit(run_id, field)
    if not chain:
        raise HTTPException(404, f"No figure '{field}' in run {run_id}")
    return chain


@router.get("/grid/day")
def grid_day(offline: bool = False) -> dict[str, Any]:
    return G.grid_day(offline=offline)
