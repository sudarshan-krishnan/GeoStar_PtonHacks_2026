"""Local conditions for a site, each cached with its source and retrieval time.

GET /context?lat=&lon=   climate (Open-Meteo), solar yield (NREL PVWatts), households (US Census),
                         Texas industrial retail electricity price (EIA)

Any source that fails or lacks a key comes back as {"available": false, "why": ...}; nothing is guessed.
"""
from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter

from app.engine.external import USER_AGENT, _cached, _store

router = APIRouter(tags=["context"])
H = {"User-Agent": USER_AGENT}
MILE_KM2 = 8.137  # area of a 1-mile-radius circle


def _get(url: str, params: dict[str, Any]) -> Any:
    r = httpx.get(url, params=params, headers=H, timeout=40, follow_redirects=True)
    r.raise_for_status()
    return r.json()


def _wrap(hit: dict[str, Any]) -> dict[str, Any]:
    return {"available": True, **hit["payload"], "source": hit["source"], "retrieved_at": hit["retrieved_at"]}


def climate(lat: float, lon: float) -> dict[str, Any]:
    key = f"openmeteo:{lat:.2f},{lon:.2f}:2025"
    hit = _cached(key)
    if not hit:
        try:
            d = _get("https://archive-api.open-meteo.com/v1/archive",
                     {"latitude": lat, "longitude": lon, "start_date": "2025-01-01", "end_date": "2025-12-31",
                      "daily": "temperature_2m_max,temperature_2m_mean", "timezone": "auto"})["daily"]
            mean = [v for v in d["temperature_2m_mean"] if v is not None]
            mx = [v for v in d["temperature_2m_max"] if v is not None]
            hit = _store(key, "Open-Meteo historical weather (ERA5 reanalysis), year 2025",
                         "https://archive-api.open-meteo.com/v1/archive",
                         {"year": 2025, "mean_c": round(sum(mean) / len(mean), 1), "hottest_c": max(mx),
                          "days_above_35c": sum(v > 35 for v in mx), "cool_days_below_18c": sum(v < 18 for v in mean),
                          "label": "Sourced"})
        except (httpx.HTTPError, KeyError, ValueError, ZeroDivisionError) as e:
            return {"available": False, "why": type(e).__name__}
    return _wrap(hit)


def solar(lat: float, lon: float) -> dict[str, Any]:
    key = f"pvwatts:{lat:.2f},{lon:.2f}"
    hit = _cached(key)
    if not hit:
        try:
            d = _get("https://developer.nlr.gov/api/pvwatts/v8.json",
                     {"api_key": os.getenv("NREL_API_KEY") or "DEMO_KEY", "lat": lat, "lon": lon, "system_capacity": 1000,
                      "module_type": 0, "losses": 14, "array_type": 1, "tilt": 20, "azimuth": 180})
            if d.get("errors"):
                return {"available": False, "why": str(d["errors"])[:120]}
            o = d["outputs"]
            hit = _store(key, "NREL PVWatts v8 (fixed roof mount, 20 degree tilt, 14% losses)", "https://developer.nlr.gov/api/pvwatts/v8",
                         {"mwh_per_mwp_year": round(o["ac_annual"] / 1000, 0), "capacity_factor_pct": round(o["capacity_factor"], 1),
                          "label": "Estimated"})
        except (httpx.HTTPError, KeyError, ValueError) as e:
            return {"available": False, "why": type(e).__name__}
    return _wrap(hit)


def households(lat: float, lon: float) -> dict[str, Any]:
    key = f"census:{lat:.4f},{lon:.4f}"
    hit = _cached(key)
    if not hit:
        ck = os.getenv("CENSUS_API_KEY")
        try:
            g = _get("https://geocoding.geo.census.gov/geocoder/geographies/coordinates",
                     {"x": lon, "y": lat, "benchmark": "Public_AR_Current", "vintage": "Current_Current",
                      "layers": "Census Tracts", "format": "json"})
            t = g["result"]["geographies"]["Census Tracts"][0]
            if not ck:
                return {"available": False, "tract": t["GEOID"], "why": "set CENSUS_API_KEY (free) to load household counts"}
            rows = _get("https://api.census.gov/data/2023/acs/acs5",
                        {"get": "B11001_001E,B01003_001E", "for": f"tract:{t['TRACT']}",
                         "in": f"state:{t['STATE']} county:{t['COUNTY']}", "key": ck})
            hh, pop = int(rows[1][0]), int(rows[1][1])
            km2 = float(t["AREALAND"]) / 1e6
            hit = _store(key, "US Census ACS 2023 5-year (tract households) + Census geocoder", "https://api.census.gov/data/2023/acs/acs5",
                         {"tract": t["GEOID"], "tract_households": hh, "tract_population": pop, "tract_km2": round(km2, 2),
                          "households_within_1mi_est": round(hh / km2 * MILE_KM2) if km2 > 0 else None,
                          "method": "tract household density x area of a 1-mile circle", "label": "Estimated"})
        except (httpx.HTTPError, KeyError, ValueError, IndexError) as e:
            return {"available": False, "why": type(e).__name__}
    return _wrap(hit)


def retail_price(state: str = "TX") -> dict[str, Any]:
    key = f"eia-retail:{state}:IND"
    hit = _cached(key)
    if not hit:
        try:
            d = _get("https://api.eia.gov/v2/electricity/retail-sales/data/",
                     {"api_key": os.getenv("EIA_API_KEY") or "DEMO_KEY", "frequency": "monthly", "data[0]": "price",
                      "facets[stateid][]": state, "facets[sectorid][]": "IND", "sort[0][column]": "period",
                      "sort[0][direction]": "desc", "length": 1})
            row = d["response"]["data"][0]
            hit = _store(key, "US EIA retail sales of electricity (industrial sector, state average)", "https://api.eia.gov/v2/electricity/retail-sales",
                         {"state": state, "period": row["period"], "cents_per_kwh": float(row["price"]),
                          "usd_per_mwh": round(float(row["price"]) * 10, 1), "label": "Sourced"})
        except (httpx.HTTPError, KeyError, ValueError, IndexError) as e:
            return {"available": False, "why": type(e).__name__}
    return _wrap(hit)


@router.get("/context")
def context(lat: float, lon: float, state: str = "TX") -> dict[str, Any]:
    return {"climate": climate(lat, lon), "solar": solar(lat, lon), "households": households(lat, lon),
            "retail_price": retail_price(state)}
