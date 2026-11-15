"""CoStar site intelligence: control of the building, occupancy, redevelopment screen, and community exposure.

GET  /costar/control/{parcel_id}          tenants, expiration ladder, earliest full control, leasing due-diligence flags
GET  /costar/occupancy/{parcel_id}        occupancy states (confirmed_vacant, listed_available, occupied, unknown) + evidence
GET  /costar/redevelopment/{parcel_id}    checklist per category with pass/flag/unknown items
GET  /costar/candidates                   properties ranked for one redevelopment category
GET  /costar/available                    properties with space or a building marketed now
GET  /costar/diligence                    properties whose current tenancies need leasing due diligence
GET  /costar/community/{parcel_id}        homes and apartment communities by distance band, noise at nearest receptors
GET  /costar/community?lat=&lon=          the same around a dropped pin
POST /costar/community/compare            one exposure row per site
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..costar import homes, redevelop, tenancy

router = APIRouter(tags=["costar-site"])
Category = Literal["industrial_conversion", "data_center_redevelopment", "expansion", "adaptive_reuse", "land_acquisition"]


def _run(fn, *a: Any, **kw: Any) -> Any:
    try:
        out = fn(*a, **kw)
    except tenancy.StoreUnavailable as e:
        raise HTTPException(503, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if out is None:
        raise HTTPException(404, f"Unknown parcel {a[0] if a else ''}".strip())
    return out


@router.get("/costar/control/{parcel_id}")
def control(parcel_id: str) -> dict[str, Any]:
    return _run(tenancy.control, parcel_id)


@router.get("/costar/occupancy/{parcel_id}")
def occupancy(parcel_id: str) -> dict[str, Any]:
    return _run(tenancy.occupancy_status, parcel_id)


@router.get("/costar/redevelopment/{parcel_id}")
def redevelopment(parcel_id: str) -> dict[str, Any]:
    return _run(redevelop.redevelopment, parcel_id)


@router.get("/costar/candidates")
def candidates(market: Literal["Houston", "Los Angeles"] | None = None, category: Category = "data_center_redevelopment",
               limit: int = Query(10, ge=1, le=50), min_acres: float | None = Query(None, ge=0),
               listed_only: bool = False) -> dict[str, Any]:
    return _run(redevelop.find_candidates, market, category, limit, {"min_acres": min_acres, "listed_only": listed_only})


@router.get("/costar/available")
def available(market: Literal["Houston", "Los Angeles"] | None = None, min_sf: float = Query(0, ge=0),
              limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    return _run(redevelop.with_available_space, market, min_sf, limit)


@router.get("/costar/diligence")
def diligence(market: Literal["Houston", "Los Angeles"] | None = None, limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    return _run(redevelop.needs_leasing_diligence, market, limit)


def _community_kw(radius_m: float, gen_offset_m: float, mw_it: float, redundancy: str, cooling: str, noise_wall: bool) -> dict:
    return dict(radius_m=radius_m, gen_offset_m=gen_offset_m, mw_it=mw_it, redundancy=redundancy, cooling=cooling,
                noise_wall=noise_wall)


@router.get("/costar/community")
def community_point(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
                    radius_m: float = Query(3000, ge=100, le=5000), gen_offset_m: float = Query(0, ge=0, le=2000),
                    mw_it: float = Query(20, gt=0.5, le=500), redundancy: Literal["N", "N+1", "2N"] = "N+1",
                    cooling: Literal["air", "hybrid", "water", "liquid"] = "liquid", noise_wall: bool = False) -> dict[str, Any]:
    return _run(lambda: homes.community(None, lat, lon, **_community_kw(radius_m, gen_offset_m, mw_it, redundancy, cooling, noise_wall)))


@router.get("/costar/community/{parcel_id}")
def community(parcel_id: str, radius_m: float = Query(3000, ge=100, le=5000), gen_offset_m: float = Query(0, ge=0, le=2000),
              mw_it: float = Query(20, gt=0.5, le=500), redundancy: Literal["N", "N+1", "2N"] = "N+1",
              cooling: Literal["air", "hybrid", "water", "liquid"] = "liquid", noise_wall: bool = False) -> dict[str, Any]:
    return _run(homes.community, parcel_id, **_community_kw(radius_m, gen_offset_m, mw_it, redundancy, cooling, noise_wall))


class CompareIn(BaseModel):
    parcel_ids: list[str] = Field(..., min_length=1, max_length=12)
    mw_it: float = Field(20, gt=0.5, le=500)
    redundancy: Literal["N", "N+1", "2N"] = "N+1"
    cooling: Literal["air", "hybrid", "water", "liquid"] = "liquid"


@router.post("/costar/community/compare")
def compare(q: CompareIn) -> dict[str, Any]:
    return _run(lambda: homes.compare_sites(q.parcel_ids, mw_it=q.mw_it, redundancy=q.redundancy, cooling=q.cooling))
