"""GET /costar/building/{parcel_id}: CoStar building facts and its Matterport scans, each with an honest scope."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.sponsors.costar import building as B
from app.db import db_ready

router = APIRouter(tags=["costar"])


@router.get("/costar/building/{parcel_id}")
def building(parcel_id: str, refresh: bool = False) -> dict[str, Any]:
    if not re.fullmatch(r"costar:\d{1,12}", parcel_id):
        raise HTTPException(422, "Expected a CoStar parcel id such as costar:23296")
    if not db_ready():
        raise HTTPException(503, "Parcel store is empty. Run: python -m app.sponsors.costar.loader")
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
        raise HTTPException(503, "Parcel store is empty. Run: python -m app.sponsors.costar.loader")
    from app.routers.studio import _grid
    try:
        return B.conversion(parcel_id, mw_it, rack_kw, _grid())
    except KeyError as e:
        raise HTTPException(404, f"Unknown parcel {parcel_id}") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


# ------------------------------------------------------------------------------------------------ site walk
# Notes pinned in 3D and measurements drawn inside the Matterport scan (app/sponsors/matterport/sitewalk.py). User-authored, not CoStar data.
from pydantic import BaseModel, Field  # noqa: E402

from app.sponsors.matterport import sitewalk  # noqa: E402


def _pid(parcel_id: str) -> str:
    if not re.fullmatch(r"costar:\d{1,12}", parcel_id):
        raise HTTPException(422, "Expected a CoStar parcel id such as costar:23296")
    return parcel_id


class Vec(BaseModel):
    x: float
    y: float
    z: float


class NoteIn(BaseModel):
    model_id: str | None = Field(None, max_length=40)
    category: str = Field(..., max_length=20)
    severity: str = Field("concern", max_length=10)
    text: str = Field(..., min_length=1, max_length=1200)
    position: Vec | None = None
    normal: Vec | None = None
    floor: int | None = Field(None, ge=-5, le=200)
    author: str | None = Field(None, max_length=80)


class MeasureIn(BaseModel):
    model_id: str | None = Field(None, max_length=40)
    kind: str = Field(..., max_length=24)
    length_m: float = Field(..., gt=0, le=500)
    label: str | None = Field(None, max_length=80)
    points: list[Vec] = Field(default_factory=list, max_length=20)
    floor: int | None = Field(None, ge=-5, le=200)
    author: str | None = Field(None, max_length=80)
    method: str = Field("Matterport measurement tool", max_length=60)


@router.get("/costar/site-walk/{parcel_id}")
def site_walk(parcel_id: str) -> dict[str, Any]:
    return sitewalk.summary(_pid(parcel_id))


@router.post("/costar/site-walk/{parcel_id}/notes")
def site_walk_note(parcel_id: str, q: NoteIn) -> dict[str, Any]:
    try:
        return sitewalk.add_note(_pid(parcel_id), q.model_id, q.category, q.severity, q.text,
                                 q.position.model_dump() if q.position else None, q.normal.model_dump() if q.normal else None,
                                 q.floor, q.author)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.post("/costar/site-walk/{parcel_id}/measurements")
def site_walk_measure(parcel_id: str, q: MeasureIn) -> dict[str, Any]:
    try:
        return sitewalk.add_measurement(_pid(parcel_id), q.model_id, q.kind, q.length_m, q.label,
                                        [p.model_dump() for p in q.points], q.floor, q.author, q.method)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.delete("/costar/site-walk/{parcel_id}/items/{item_id}")
def site_walk_delete(parcel_id: str, item_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{6,32}", item_id):
        raise HTTPException(422, "Bad item id")
    if not sitewalk.delete(_pid(parcel_id), item_id):
        raise HTTPException(404, "No such note or measurement")
    return {"ok": True}
