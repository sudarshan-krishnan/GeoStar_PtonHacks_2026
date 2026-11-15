"""Screening, search and site evaluation (the CoStar-style workflow, for buildable data-center sites).

GET  /screen               gate results for every candidate in a market
GET  /sites/candidates     shortlist shaped as the web app's `Site`
POST /search               polygon + filters -> ranked, screened sites (Planet / People / Money)
POST /sites/evaluate       screen any map point the user drops ("add any parcel for AI evaluation")
POST /impact               energy / water / carbon / capex for a proposed MW + cooling (what-if)
GET  /assumptions          every modeling assumption with basis and label
CRUD /searches             saved searches; GET /searches/{id}/alerts diffs today's results vs the snapshot
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import assumptions, external
from ..db import db_ready, session
from ..screening import Thresholds, load_homes, screen_parcel
from ..siting import METHOD, assemble, candidate_pool

router = APIRouter(tags=["search"])

SEARCH_DDL = """
CREATE TABLE IF NOT EXISTS saved_searches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    market        TEXT NOT NULL,
    request_json  TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    shared_with   TEXT NOT NULL DEFAULT '[]',
    alerts        INTEGER NOT NULL DEFAULT 1,
    notes         TEXT,
    created_at    TEXT NOT NULL,
    checked_at    TEXT NOT NULL
)
"""


def init() -> None:
    with session() as c:
        c.execute(SEARCH_DDL)


def _require_db() -> None:
    if not db_ready():
        raise HTTPException(503, "Parcel store is empty. Run: python -m app.costar.loader")


class ThresholdsIn(BaseModel):
    min_home_distance_m: float = Field(300, ge=0, le=5000)
    max_substation_km: float = Field(5, ge=0, le=100)
    min_substation_kv: float = Field(138, ge=0, le=765)
    max_water_stress_cat: int = Field(2, ge=0, le=4)
    max_water_cooling_cat: int = Field(1, ge=0, le=4)
    min_sensitive_distance_m: float = Field(200, ge=0, le=5000)

    def to(self) -> Thresholds:
        return Thresholds(**self.model_dump())


class Filters(BaseModel):
    min_acres: float | None = Field(None, ge=0)
    max_acres: float | None = Field(None, ge=0)
    min_supportable_mw: float | None = Field(None, ge=0, description="lot acres x mw_per_acre")
    max_land_cost: float | None = Field(None, ge=0)
    heavy_power_only: bool = False
    exclude_flood_zone: bool = False
    water_cooling_required: bool = False
    property_types: list[str] | None = Field(None, description="Industrial, Flex, Land")
    hide_failed: bool = False


class SearchIn(BaseModel):
    market: Literal["Houston", "Los Angeles"] = "Houston"
    polygon: list[tuple[float, float]] | None = Field(None, description="[[lon, lat], ...] ring")
    filters: Filters = Field(default_factory=Filters)
    thresholds: ThresholdsIn = Field(default_factory=ThresholdsIn)
    include_parcel_ids: list[str] = Field(default_factory=list, description="added manually; bypass filters")
    exclude_parcel_ids: list[str] = Field(default_factory=list)
    assumptions: dict[str, float] = Field(default_factory=dict)
    limit: int = Field(60, ge=1, le=300)


def point_in_polygon(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1 + 1e-15) + x1:
            inside = not inside
    return inside


def run_search(q: SearchIn, offline: bool = False) -> dict[str, Any]:
    _require_db()
    pool = candidate_pool(q.market)
    if q.polygon and len(q.polygon) >= 3:
        pool = [p for p in pool if point_in_polygon(p["lon"], p["lat"], q.polygon)]
    f = q.filters
    mw_per_acre = assumptions.value("mw_per_acre", q.assumptions)

    def pre(p: dict[str, Any]) -> bool:  # filters that do not need screening
        acres = p.get("lot_acres")
        if f.min_acres is not None and (acres is None or acres < f.min_acres):
            return False
        if f.max_acres is not None and (acres is None or acres > f.max_acres):
            return False
        if f.min_supportable_mw is not None and (acres is None or acres * mw_per_acre < f.min_supportable_mw):
            return False
        if f.heavy_power_only and p.get("has_heavy_power") != 1:
            return False
        if f.property_types and p.get("property_type") not in f.property_types:
            return False
        return p["parcel_id"] not in q.exclude_parcel_ids

    chosen = [p for p in pool if pre(p)]
    added = []
    if q.include_parcel_ids:
        with session() as c:
            for pid in q.include_parcel_ids:
                row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (pid,)).fetchone()
                if row and pid not in {p["parcel_id"] for p in chosen}:
                    added.append(dict(row))
    sites = assemble(q.market, chosen[: q.limit] + added, q.thresholds.to(), offline, q.assumptions)
    added_ids = {p["parcel_id"] for p in added}

    def post(s: dict[str, Any]) -> bool:  # filters that need screening results
        if s["id"] in added_ids:
            return True
        g = {x["gate"]: x for x in s["screen"]["gates"]}
        if f.exclude_flood_zone and g["Flood exposure"]["status"] == "Fail":
            return False
        if f.water_cooling_required and not s["screen"]["power"].get("water_cooling_ok"):
            return False
        if f.max_land_cost is not None and s["labels"]["landCost"] != "Unknown" and s["landCost"] > f.max_land_cost:
            return False
        return not (f.hide_failed and s["screen"]["status"] == "Fail")

    sites = [dict(s, manuallyAdded=s["id"] in added_ids) for s in sites if post(s)]
    counts = {k: sum(s["screen"]["status"] == k for s in sites) for k in ("Pass", "Needs review", "Fail")}
    return {"market": q.market, "count": len(sites), "counts": counts, "in_polygon": len(pool),
            "sites": sites, "method": METHOD, "thresholds": q.thresholds.model_dump()}


@router.post("/search")
def search(q: SearchIn, offline: bool = False) -> dict[str, Any]:
    return run_search(q, offline)


@router.get("/sites/candidates")
def candidates(market: str = "Houston", min_acres: float = 5, limit: int = Query(8, ge=1, le=50),
               offline: bool = False) -> dict[str, Any]:
    _require_db()
    parcels = candidate_pool(market, min_acres)[:limit]
    sites = assemble(market, parcels, Thresholds(), offline)
    return {"market": market, "sites": sites, "method": METHOD}


@router.get("/screen")
def screen(market: str = "Houston", min_acres: float = 0, offline: bool = False) -> dict[str, Any]:
    _require_db()
    t = Thresholds()
    homes = load_homes(external.MARKET_BBOX.get(market))
    subs = external.osm_substations(market, offline=offline)
    sens = external.osm_sensitive(market, offline=offline)
    results = [screen_parcel(p, homes, subs, t, offline=offline, sensitive=sens) for p in candidate_pool(market, min_acres)]
    counts = {s: sum(r.status == s for r in results) for s in ("Pass", "Needs review", "Fail")}
    return {"market": market, "thresholds": t.__dict__, "counts": counts, "results": [r.as_dict() for r in results]}


class EvaluateIn(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    name: str = Field("Dropped pin", max_length=120)
    acres: float | None = Field(None, gt=0, le=10000)
    market: Literal["Houston", "Los Angeles"] = "Houston"
    thresholds: ThresholdsIn = Field(default_factory=ThresholdsIn)


@router.post("/sites/evaluate")
def evaluate_point(q: EvaluateIn) -> dict[str, Any]:
    """Screen any point (not in the CoStar extract). Acreage is the user's input, labeled as such."""
    _require_db()
    homes = load_homes(external.MARKET_BBOX.get(q.market))
    subs = external.osm_substations(q.market)
    pid = f"pin:{q.lat:.5f},{q.lon:.5f}"
    # a free-chosen point has no lot record, so also look at what is mapped on and around it
    acres = q.acres or 10.0
    reach = max((acres * 4046.86 / 3.14159) ** 0.5, q.thresholds.min_home_distance_m) + 60
    s = screen_parcel({"parcel_id": pid, "lat": q.lat, "lon": q.lon}, homes, subs, q.thresholds.to(),
                      sensitive=external.osm_sensitive(q.market), land=external.osm_land(q.lat, q.lon, reach), acres=acres)
    return {"id": pid, "name": q.name, "lat": q.lat, "lng": q.lon, "lotAcres": q.acres,
            "supportableMw": round(q.acres * assumptions.value("mw_per_acre"), 1) if q.acres else None,
            "source": "user", "screen": s.as_dict(),
            "labels": {"lotAcres": "Sourced" if q.acres else "Unknown", "location": "Sourced"},
            "note": "User-supplied point. No CoStar record, price or building data; gates use public datasets."}


class ImpactIn(BaseModel):
    mw_it: float = Field(..., gt=0, le=5000)
    cooling: Literal["air", "hybrid", "water"] = "air"
    assumptions: dict[str, float] = Field(default_factory=dict)
    grid_kg_co2_per_mwh: float | None = Field(None, ge=0, le=2000)


@router.post("/impact")
def impact(q: ImpactIn) -> dict[str, Any]:
    return assumptions.impact(q.mw_it, q.cooling, q.assumptions, q.grid_kg_co2_per_mwh)


@router.get("/assumptions")
def list_assumptions() -> list[dict[str, Any]]:
    return assumptions.as_list()


# ---------------------------------------------------------------- saved searches + alerts

class SaveSearchIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    request: SearchIn
    shared_with: list[str] = Field(default_factory=list, max_length=20)
    alerts: bool = True
    notes: str | None = Field(None, max_length=2000)


def _snapshot(result: dict[str, Any]) -> dict[str, Any]:
    return {s["id"]: {"status": s["screen"]["status"], "landCost": s["landCost"], "name": s["name"],
                      "availability": s.get("availability")} for s in result["sites"]}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@router.post("/searches", status_code=201)
def save_search(body: SaveSearchIn) -> dict[str, Any]:
    result = run_search(body.request, offline=True)
    now = _now()
    with session() as c:
        cur = c.execute(
            "INSERT INTO saved_searches (name, market, request_json, snapshot_json, shared_with, alerts, notes, "
            "created_at, checked_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (body.name, body.request.market, body.request.model_dump_json(), json.dumps(_snapshot(result)),
             json.dumps(body.shared_with), int(body.alerts), body.notes, now, now))
    return {"id": cur.lastrowid, "name": body.name, "count": result["count"], "created_at": now}


@router.get("/searches")
def list_searches() -> list[dict[str, Any]]:
    with session() as c:
        rows = c.execute("SELECT * FROM saved_searches ORDER BY id DESC").fetchall()
    return [{"id": r["id"], "name": r["name"], "market": r["market"], "shared_with": json.loads(r["shared_with"]),
             "alerts": bool(r["alerts"]), "notes": r["notes"], "created_at": r["created_at"],
             "checked_at": r["checked_at"], "request": json.loads(r["request_json"]),
             "count": len(json.loads(r["snapshot_json"]))} for r in rows]


@router.delete("/searches/{search_id}", status_code=204)
def delete_search(search_id: int) -> None:
    with session() as c:
        c.execute("DELETE FROM saved_searches WHERE id = ?", (search_id,))


@router.get("/searches/{search_id}/alerts")
def search_alerts(search_id: int, update_snapshot: bool = False) -> dict[str, Any]:
    """Re-run the saved search and report what changed: new sites, removed sites, gate or price changes."""
    with session() as c:
        row = c.execute("SELECT * FROM saved_searches WHERE id = ?", (search_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Saved search not found")
    before = json.loads(row["snapshot_json"])
    now_result = run_search(SearchIn.model_validate_json(row["request_json"]))
    after = _snapshot(now_result)
    alerts = []
    for pid in after.keys() - before.keys():
        alerts.append({"type": "new_site", "parcel_id": pid, "name": after[pid]["name"],
                       "detail": f"New match ({after[pid]['status']})"})
    for pid in before.keys() - after.keys():
        alerts.append({"type": "removed", "parcel_id": pid, "name": before[pid]["name"],
                       "detail": "No longer matches the search"})
    for pid in after.keys() & before.keys():
        a, b = after[pid], before[pid]
        if a["status"] != b["status"]:
            alerts.append({"type": "risk_change", "parcel_id": pid, "name": a["name"],
                           "detail": f"Gate status {b['status']} -> {a['status']}"})
        if a["landCost"] != b["landCost"]:
            alerts.append({"type": "price_change", "parcel_id": pid, "name": a["name"],
                           "detail": f"Acquisition {b['landCost']:,.0f} -> {a['landCost']:,.0f}"})
        if a["availability"] != b["availability"]:
            alerts.append({"type": "availability", "parcel_id": pid, "name": a["name"],
                           "detail": f"{b['availability']} -> {a['availability']}"})
    now = _now()
    with session() as c:
        if update_snapshot:
            c.execute("UPDATE saved_searches SET snapshot_json = ?, checked_at = ? WHERE id = ?",
                      (json.dumps(after), now, search_id))
        else:
            c.execute("UPDATE saved_searches SET checked_at = ? WHERE id = ?", (now, search_id))
    return {"search_id": search_id, "checked_at": now, "since": row["checked_at"], "alerts": alerts,
            "count": now_result["count"]}
