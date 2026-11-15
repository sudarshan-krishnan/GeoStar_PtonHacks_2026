"""CoStar comps, valuation and market context.

GET  /costar/land/{parcel_id}       default comps valuation (basis chosen from the subject) + underwriting block
POST /costar/comps/{parcel_id}      the same, recalculated with options: exclude comp ids, max age, radius, basis
GET  /costar/scenario/{parcel_id}   acquisition value moved by ?pct= (e.g. 15 for +15%)
GET  /costar/market/{parcel_id}     the subject against its CoStar submarket
GET  /costar/submarkets?market=     one comparison row per submarket in a market
GET  /costar/markets                Houston against Los Angeles
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..costar import market as M
from ..costar import valuation as V
from ..costar.comps import StoreMissing

router = APIRouter(tags=["costar"])


def _guard(fn, *a, **kw) -> Any:
    try:
        return fn(*a, **kw)
    except V.UnknownParcel as e:
        raise HTTPException(404, f"Unknown parcel {e.args[0]}") from e
    except StoreMissing as e:
        raise HTTPException(503, str(e)) from e


@router.get("/costar/land/{parcel_id}")
def land(parcel_id: str) -> dict[str, Any]:
    return _guard(V.valuation, parcel_id)


class CompsIn(BaseModel):
    exclude: list[int] = Field(default_factory=list, max_length=200)
    max_age_years: float = Field(V.DEFAULT_MAX_AGE, gt=0, le=40)
    radius_km: float | None = Field(None, gt=0, le=200)
    basis: Literal["sf", "acre"] | None = None
    size_band: bool = True


@router.post("/costar/comps/{parcel_id}")
def comps(parcel_id: str, q: CompsIn) -> dict[str, Any]:
    return _guard(V.valuation, parcel_id, exclude=q.exclude, max_age_years=q.max_age_years, radius_km=q.radius_km,
                  basis=q.basis, size_band=q.size_band)


@router.get("/costar/scenario/{parcel_id}")
def scenario(parcel_id: str, pct: float = Query(..., ge=-90, le=500)) -> dict[str, Any]:
    return _guard(V.scenario, parcel_id, pct)


@router.get("/costar/market/{parcel_id}")
def market(parcel_id: str) -> dict[str, Any]:
    return _guard(M.market_for_parcel, parcel_id)


@router.get("/costar/submarkets")
def submarkets(market: Literal["Houston", "Los Angeles"] = "Houston") -> dict[str, Any]:
    return _guard(M.compare_submarkets, market)


@router.get("/costar/markets")
def markets() -> dict[str, Any]:
    return _guard(M.compare_markets)
