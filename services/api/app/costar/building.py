"""The existing building on a CoStar parcel: CoStar facts plus its Matterport scans, each with an honest scope.

A Matterport model in the CoStar kit is usually one suite, floor or room, not the whole building (summed scan area
is often well under half of CoStar's building area). So every scan carries a scope ("whole building", "partial",
"suite or room", "unknown") worked out from its measured floor area against CoStar's building area, plus a reason.
Scans are evidence of the existing building only; they never describe a proposed design.

Matterport is read through the GraphQL API with the server-side key (routers/integrations.py). Floor and room
areas are cached in SQLite with their retrieval time, separately from the plain model metadata cache.
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from .. import config
from ..db import session
from ..screening import service_capacity_mw

AREA_QUERY = """
query ModelArea($id: ID!) {
  model(id: $id) {
    id name created visibility
    floors { id label dimensions { areaFloor units } }
    rooms { id label dimensions { areaFloor units } }
  }
}
"""
CACHE_DDL = """
CREATE TABLE IF NOT EXISTS matterport_area_cache (
    model_id      TEXT PRIMARY KEY,
    payload_json  TEXT NOT NULL,
    retrieved_at  TEXT NOT NULL
)
"""
MAX_MODELS = 12  # enrich at most this many scans per request; the rest are listed by id
SQFT_PER_M2 = 10.7639
WHOLE, PART = 0.8, 0.4  # scanned share of building area for "whole building" and the floor of "partial"
SUITE_WORDS = re.compile(r"\b(suite|ste\.?|unit|room|office|floor\s*\d|level\s*\d|space|#\s*\d|bldg\.?\s*\w+\s*-\s*\d)", re.I)
EMBED = "https://my.matterport.com/show/?m={id}&play=1&qs=1"

FACT_FIELDS = (("property_type", "Property type"), ("property_subtype", "Subtype"), ("building_class", "Class"),
               ("year_built", "Year built"), ("stories", "Stories"), ("building_sf", "Building area (sf)"),
               ("lot_acres", "Lot (acres)"), ("ceiling_height_ft", "Clear height (ft)"), ("has_rail", "Rail served"),
               ("has_heavy_power", "Heavy power"), ("amps_high", "Service (amps)"), ("volts_high", "Service (volts)"),
               ("zoning", "Zoning"), ("construction_status", "Construction status"))


def _init() -> None:
    with session() as c:
        c.execute(CACHE_DDL)


def _sqft(dim: dict[str, Any] | None) -> float | None:
    if not dim or dim.get("areaFloor") is None:
        return None
    a = float(dim["areaFloor"])
    return a if (dim.get("units") or "imperial") == "imperial" else a * SQFT_PER_M2


def _fetch(model_id: str, refresh: bool) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """(model payload, retrieved_at, error). Never raises: one bad scan must not hide the others."""
    with session() as c:
        if not refresh:
            hit = c.execute("SELECT * FROM matterport_area_cache WHERE model_id = ?", (model_id,)).fetchone()
            if hit:
                return json.loads(hit["payload_json"]), hit["retrieved_at"], None
    from ..routers.integrations import _matterport
    try:
        data = _matterport(AREA_QUERY, {"id": model_id})["model"]
    except HTTPException as e:
        return None, None, str(e.detail)
    if data is None:
        return None, None, "Not visible to this Matterport key"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with session() as c:
        c.execute("INSERT OR REPLACE INTO matterport_area_cache VALUES (?,?,?)", (model_id, json.dumps(data), now))
    return data, now, None


def classify(name: str, scanned_sf: float | None, building_sf: float | None) -> dict[str, Any]:
    """Scope of one scan against the CoStar building area. Pure; unit-tested."""
    hint = bool(SUITE_WORDS.search(name or ""))
    ratio = scanned_sf / building_sf if scanned_sf and building_sf else None
    if ratio is None:
        scope = "suite or room" if hint else "unknown"
        why = ("The scan's name reads like part of a building" if hint else "No measured area") + (
            "; CoStar has no building area to compare with." if not building_sf else "; Matterport returned no floor area.")
    elif ratio >= WHOLE:
        scope, why = "whole building", f"The scan measures {ratio:.0%} of CoStar's building area."
    elif ratio < PART or hint:
        scope = "suite or room"
        why = f"The scan measures {ratio:.0%} of CoStar's building area" + (", and its name reads like a suite or room." if hint else ".")
    else:
        scope, why = "partial", f"The scan measures {ratio:.0%} of CoStar's building area."
    return {"scope": scope, "ratio": round(ratio, 3) if ratio is not None else None, "reason": why}


def building(parcel_id: str, refresh: bool = False) -> dict[str, Any]:
    _init()
    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
        if not row:
            raise KeyError(parcel_id)
        p = dict(row)
        ids = [r["model_id"] for r in c.execute(
            "SELECT model_id FROM matterport_models WHERE costar_property_id = ? ORDER BY source_row", (p["costar_property_id"],))]
    mw, method = service_capacity_mw(p.get("amps_high"), p.get("volts_high"))
    def val(k: str) -> Any:
        v = p.get(k)
        return None if v is None or (isinstance(v, str) and v.strip().lower() in ("", "none", "null")) else v
    facts = [{"key": k, "label": lab, "value": val(k), "tag": "Sourced" if val(k) is not None else "Unknown"}
             for k, lab in FACT_FIELDS]
    facts.append({"key": "existing_service_mw", "label": "Existing electric service (MW)",
                  "value": round(mw, 2) if mw is not None else None, "tag": "Estimated" if mw is not None else "Unknown",
                  "basis": method})
    bsf = float(p["building_sf"]) if p.get("building_sf") else None

    configured = bool(config.MATTERPORT_API_KEY and config.MATTERPORT_API_TOKEN)
    enrich = ids[:MAX_MODELS] if configured else []
    with ThreadPoolExecutor(max_workers=4) as ex:
        fetched = dict(zip(enrich, ex.map(lambda m: _fetch(m, refresh), enrich)))
    models = []
    for mid in ids:
        data, at, err = fetched.get(mid, (None, None, None if configured else "Matterport key not configured"))
        floors = (data or {}).get("floors") or []
        rooms = (data or {}).get("rooms") or []
        floor_sf = [a for a in (_sqft(f.get("dimensions")) for f in floors) if a]
        room_sf = [a for a in (_sqft(r.get("dimensions")) for r in rooms) if a]
        scanned = sum(floor_sf) if floor_sf else (sum(room_sf) if room_sf else None)
        name = (data or {}).get("name") or ""
        vis = (data or {}).get("visibility")
        models.append({
            "model_id": mid, "name": name.strip() or None, "created": (data or {}).get("created"), "visibility": vis,
            "floors": len(floors), "rooms": len(rooms), "named_rooms": [r["label"] for r in rooms if r.get("label")][:12],
            "scanned_sf": round(scanned) if scanned else None,
            **(classify(name, scanned, bsf) if data else {"scope": "unknown", "ratio": None,
                                                         "reason": err or f"Not enriched (only the first {MAX_MODELS} scans are read)."}),
            "embed_url": EMBED.format(id=mid) if vis in ("public", "unlisted", None) else None,
            "retrieved_at": at, "error": err,
        })
    covered = sum(m["scanned_sf"] or 0 for m in models)
    return {
        "parcel_id": parcel_id, "name": p.get("name"), "address": p.get("address"), "city": p.get("city"),
        "facts": facts, "building_sf": bsf, "matterport": models,
        "scan_summary": {
            "count": len(ids), "enriched": len(enrich), "scanned_sf": round(covered) if covered else None,
            "share_of_building": round(covered / bsf, 3) if covered and bsf else None,
            "note": "Scans show parts of the existing building as captured for CoStar. They are not the proposed design.",
        },
        "embed_note": "Public and unlisted scans open in Matterport Showcase with a plain link; no SDK key is needed to view.",
        "source": f"CoStar Data Extract, {p.get('source_file')} row {p.get('source_row')}; Matterport Model API",
        "label": "Sourced",
    }


# ------------------------------------------------------------------------------------------------ conversion check
SQM_PER_SQFT = 0.092903
MISSING_ALWAYS = [
    ("Floor load capacity", "CoStar does not record slab or floor loading; racks and batteries are heavy."),
    ("Structural grid and column spacing", "Not in CoStar; columns decide where rack rows and aisles can go."),
    ("Roof structure", "Unknown whether the roof can carry heat-rejection plant or solar."),
    ("Fire protection system", "Sprinkler type and water supply are not recorded; data halls usually need a different system."),
    ("Utility capacity", "No utility has confirmed power for the facility load; proximity is not capacity."),
]


def conversion(parcel_id: str, mw_it: float, rack_kw: float = 20.0, grid: dict[str, Any] | None = None) -> dict[str, Any]:
    """Could the existing building hold this brief? Compares the floor area and outdoor plant area the layout engine
    needs for the brief with CoStar's building area, lot and clear height. Conceptual screening only."""
    from .. import layout_engine
    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not row:
        raise KeyError(parcel_id)
    p = dict(row)
    bsf = float(p["building_sf"]) if p.get("building_sf") else None
    stories = int(p["stories"]) if p.get("stories") else 1
    clear_ft = float(p["ceiling_height_ft"]) if p.get("ceiling_height_ft") else None
    lot_m2 = float(p["lot_acres"]) * 4046.86 if p.get("lot_acres") else None

    # the engine's own answer for this brief: a generous square site so the brief is never clipped by the lot
    side = max(240.0, (mw_it * 4046.86 * 3) ** 0.5)
    brief = dict(mw_it=mw_it, rack_kw=rack_kw, redundancy="N+1", cooling="liquid", site_w=side, site_d=side, setback_m=8,
                 expansion_pct=0, flexible_share=0, storeys=max(1, min(3, stories)))
    g = grid or {"price": [40.0] * 24, "carbon": [400.0] * 24}
    res = layout_engine.generate(brief, {}, g, {})
    best = min((k for k in res["concepts"] if k["feasible"]) or res["concepts"], key=lambda k: k["metrics"]["gross_floor_m2"])
    need_floor = float(best["metrics"]["gross_floor_m2"])
    need_yard = float(best["metrics"]["yard_area_m2"])
    have_floor = bsf * SQM_PER_SQFT if bsf else None
    footprint = have_floor / max(1, stories) if have_floor else None
    have_yard = lot_m2 - footprint if lot_m2 and footprint else None

    checks = []
    def add(name: str, need: float | None, have: float | None, unit: str, basis: str) -> str:
        if need is None or have is None:
            st = "unknown"
        else:
            r = have / need
            st = "fits" if r >= 1.1 else "tight" if r >= 0.9 else "does not fit"
        checks.append(dict(name=name, status=st, need=round(need, 1) if need is not None else None,
                           have=round(have, 1) if have is not None else None, unit=unit, basis=basis))
        return st
    s_floor = add("Floor area for halls, plant rooms and support", need_floor, have_floor, "m2",
                  f"Engine floor area for {res['brief']['racks']:,} racks in {res['brief']['halls']} halls ({best['name']}), "
                  f"against CoStar's {bsf:,.0f} sf building." if bsf else "CoStar has no building area.")
    s_yard = add("Outdoor land for substation, generators and cooling", need_yard, have_yard, "m2",
                 "Engine yard area against the lot minus the existing footprint (building area / stories).")
    floor_h = layout_engine.FLOOR_H
    if clear_ft is None:
        s_height = "unknown"
        checks.append(dict(name="Clear height", status="unknown", need=floor_h, have=None, unit="m",
                           basis="CoStar has no clear height for this building."))
    else:
        s_height = add("Clear height", floor_h, clear_ft * 0.3048, "m",
                       f"PlotStar's layouts assume {floor_h:g} m floor to floor; CoStar records {clear_ft:g} ft clear.")
    mw, method = service_capacity_mw(p.get("amps_high"), p.get("volts_high"))
    fac = float(res["brief"]["facility_mw"])
    checks.append(dict(name="Existing electric service", status="does not fit" if mw is not None and mw < fac else "unknown",
                       need=fac, have=round(mw, 2) if mw is not None else None, unit="MW",
                       basis=f"Facility load {fac:g} MW against the existing service ({method})." if mw is not None
                       else "CoStar records no electric service for this building."))
    order = ["does not fit", "tight", "unknown", "fits"]
    space = [s_floor, s_yard, s_height]
    # the floor area decides; a known yard or height problem can only make it worse
    overall = "unknown" if s_floor == "unknown" else min((x for x in space if x != "unknown"), key=order.index)
    missing = [dict(item=a, why=b) for a, b in MISSING_ALWAYS]
    if clear_ft is None:
        missing.insert(0, dict(item="Clear height", why="Not recorded by CoStar for this building."))
    if mw is None:
        missing.insert(0, dict(item="Existing electric service", why="Amps and volts are not recorded by CoStar."))
    if not bsf:
        missing.insert(0, dict(item="Building area", why="Not recorded by CoStar."))
    max_racks = None
    if have_floor and need_floor:
        max_racks = int(res["brief"]["racks"] * min(1.0, have_floor / need_floor))
    return dict(parcel_id=parcel_id, mw_it=mw_it, rack_kw=rack_kw, status=overall, checks=checks, missing=missing,
                racks_needed=res["brief"]["racks"], racks_that_fit_by_area=max_racks, concept=best["name"],
                label="Estimated", note="Conceptual screening, not engineering feasibility. A structural and MEP survey decides.",
                source=f"CoStar Data Extract, {p.get('source_file')} row {p.get('source_row')}; PlotStar layout engine")
