"""GET /costar/building/{parcel_id}: CoStar building facts and its Matterport scans, each with an honest scope."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..costar import building as B
from ..db import db_ready

router = APIRouter(tags=["costar"])


@router.get("/costar/building/{parcel_id}")
def building(parcel_id: str, refresh: bool = False) -> dict[str, Any]:
    if not re.fullmatch(r"costar:\d{1,12}", parcel_id):
        raise HTTPException(422, "Expected a CoStar parcel id such as costar:23296")
    if not db_ready():
        raise HTTPException(503, "Parcel store is empty. Run: python -m app.costar.loader")
    try:
        return B.building(parcel_id, refresh)
    except KeyError as e:
        raise HTTPException(404, f"Unknown parcel {parcel_id}") from e


@router.get("/costar/conversion/{parcel_id}")
def conversion(parcel_id: str, mw_it: float = Query(10, gt=0.5, le=500), rack_kw: float = Query(20, ge=3, le=200)) -> dict[str, Any]:
    """Could the existing building hold this brief? Conceptual screening, not engineering feasibility."""
    if not re.fullmatch(r"costar:\d{1,12}", parcel_id):
        raise HTTPException(422, "Expected a CoStar parcel id such as costar:23296")
    if not db_ready():
        raise HTTPException(503, "Parcel store is empty. Run: python -m app.costar.loader")
    from .studio import _grid
    try:
        return B.conversion(parcel_id, mw_it, rack_kw, _grid())
    except KeyError as e:
        raise HTTPException(404, f"Unknown parcel {parcel_id}") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
