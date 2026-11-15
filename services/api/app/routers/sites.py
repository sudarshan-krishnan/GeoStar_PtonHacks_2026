"""Site discovery over the cached CoStar extract (PRD S-1, S-2 foundation, S-6, S-7)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..db import db_ready, session
from ..provenance import FIELD_SOURCES, chain, labels_for

router = APIRouter(tags=["sites"])

SUMMARY_COLS = (
    "parcel_id, costar_property_id, name, address, city, state, lat, lon, market, property_type, "
    "property_subtype, lot_acres, building_sf, has_heavy_power, amps_high, availability, asking_price_low, "
    "asking_price_high, last_sale_price, last_sale_status, last_sale_date, photo_url, matterport_count, "
    "dc_candidate, source_file, source_row"
)


def _require_db() -> None:
    if not db_ready():
        raise HTTPException(503, "Parcel store is empty. Run: python -m app.costar.loader")


@router.get("/sites")
def list_sites(
    market: str | None = Query(None, description="Houston or Los Angeles"),
    candidates_only: bool = True,
    min_acres: float | None = None,
    heavy_power: bool | None = None,
    limit: int = Query(500, le=5000),
) -> dict[str, Any]:
    _require_db()
    where: list[str] = ["lat IS NOT NULL", "lon IS NOT NULL"]
    args: list[Any] = []
    if market:
        where.append("market = ?")
        args.append(market)
    if candidates_only:
        where.append("dc_candidate = 1")
    if min_acres is not None:
        where.append("lot_acres >= ?")
        args.append(min_acres)
    if heavy_power is not None:
        where.append("has_heavy_power = ?")
        args.append(int(heavy_power))
    sql = (f"SELECT {SUMMARY_COLS} FROM parcels WHERE {' AND '.join(where)} "
           "ORDER BY lot_acres IS NULL, lot_acres DESC LIMIT ?")
    with session() as c:
        rows = [dict(r) for r in c.execute(sql, (*args, limit))]
    return {"count": len(rows), "label": "Sourced", "source": "CoStar Data Extract", "sites": rows}


@router.get("/sites/{parcel_id}")
def get_site(parcel_id: str) -> dict[str, Any]:
    _require_db()
    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
        if not row:
            raise HTTPException(404, f"Unknown parcel {parcel_id}")
        parcel = dict(row)
        models = [r["model_id"] for r in c.execute(
            "SELECT model_id FROM matterport_models WHERE costar_property_id = ? ORDER BY model_id",
            (parcel["costar_property_id"],))]
    return {"parcel": parcel, "labels": labels_for(parcel), "matterport_model_ids": models}


@router.get("/audit/parcel/{parcel_id}/{field}")
def audit_parcel_field(parcel_id: str, field: str) -> dict[str, Any]:
    _require_db()
    if field not in FIELD_SOURCES:
        raise HTTPException(404, f"No evidence mapping for field '{field}'. Known: {sorted(FIELD_SOURCES)}")
    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Unknown parcel {parcel_id}")
    return chain(dict(row), field)
