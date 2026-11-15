"""Site assembly shared by candidates, polygon search and ad-hoc evaluation.

Scores are transparent 0-100 transforms of gate inputs (label Estimated). They rank sites that PASS the
hard gates; a failed gate excludes a site regardless of score (PRD principle 1).

  People  = distance to nearest residential location (m) / 10, capped at 100
  Planet  = mean(water-stress score, flood score)
            water: WRI category 0->100, 1->80, 2->60, 3->30, 4->0 ; flood: Pass 100, Review 55, Fail 0
  Money   = 0.6 x affordability (rank of acquisition $/acre, cheapest = 100)
          + 0.4 x grid proximity (100 - 15 x km to nearest >= 138 kV substation)
  Overall = mean(People, Planet, Money)
"""
from __future__ import annotations

import math
import statistics
from typing import Any

from . import assumptions, external
from .db import session
from .screening import Screen, Thresholds, load_homes, screen_parcel

SQM_PER_ACRE = 4046.8564224
WATER_SCORE = {0: 100, 1: 80, 2: 60, 3: 30, 4: 0}
FLOOD_SCORE = {"Pass": 100, "Needs review": 55, "Fail": 0}

METHOD = {
    "people": "distance to nearest CoStar residential location (m) / 10, capped at 100",
    "planet": "mean of WRI water-stress score (cat 0..4 -> 100,80,60,30,0) and FEMA flood score (100/55/0)",
    "money": "0.6 x rank of acquisition $/acre (cheapest = 100) + 0.4 x (100 - 15 x km to >= 138 kV substation)",
    "overall": "mean(people, planet, money); sites failing a hard gate are excluded from ranking",
    "supportable_mw": "lot acres x mw_per_acre (team assumption)",
    "acquisition": "asking price > last sale (incl. building) > market median $/acre x acres (Estimated)",
    "width/depth": "square-equivalent of CoStar lot acres (no parcel polygon in the extract)",
}


def clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def candidate_pool(market: str, min_acres: float = 0) -> list[dict[str, Any]]:
    with session() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM parcels WHERE dc_candidate = 1 AND market = ? AND lat IS NOT NULL "
            "AND (lot_acres >= ? OR (? = 0 AND lot_acres IS NULL)) ORDER BY lot_acres DESC",
            (market, min_acres, min_acres))]


def median_price_per_acre(market: str) -> tuple[float | None, int]:
    priced = [(p.get("asking_price_low") or p.get("last_sale_price")) / p["lot_acres"]
              for p in candidate_pool(market)
              if (p.get("asking_price_low") or p.get("last_sale_price")) and p.get("lot_acres")]
    return (statistics.median(priced) if priced else None), len(priced)


def acquisition(p: dict[str, Any], market: str, median: float | None, n_priced: int) -> tuple[float | None, str, str]:
    if p.get("asking_price_low"):
        return p["asking_price_low"], "Asking price (active CoStar listing)", "Sourced"
    if p.get("last_sale_price"):
        return (p["last_sale_price"],
                f"Last sale {p.get('last_sale_date') or 'date unknown'} ({p.get('last_sale_status')}), includes building",
                "Sourced")
    if median and p.get("lot_acres"):
        return (round(median * p["lot_acres"]),
                f"Estimated: {market} median ${median:,.0f}/acre x {p['lot_acres']:.1f} acres "
                f"({n_priced} priced CoStar properties)", "Estimated")
    return None, "Unknown", "Unknown"


def screen_many(market: str, parcels: list[dict[str, Any]], t: Thresholds, offline: bool) -> list[Screen]:
    homes = load_homes(external.MARKET_BBOX.get(market))
    subs = external.osm_substations(market, offline=offline)
    sens = external.osm_sensitive(market, offline=offline)
    return [screen_parcel(p, homes, subs, t, offline=offline, sensitive=sens) for p in parcels]


def assemble(market: str, parcels: list[dict[str, Any]], t: Thresholds, offline: bool = False,
             overrides: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """Screen parcels and build site records (web-app `Site` shape + PlotStar extensions)."""
    if not parcels:
        return []
    screens = screen_many(market, parcels, t, offline)
    median, n_priced = median_price_per_acre(market)
    mw_per_acre = assumptions.value("mw_per_acre", overrides)
    sites: list[dict[str, Any]] = []
    for p, s in zip(parcels, screens):
        land, basis, land_label = acquisition(p, market, median, n_priced)
        acres = p.get("lot_acres")
        side = math.sqrt(acres * SQM_PER_ACRE) if acres else 0
        g = {x.gate: x for x in s.gates}
        home_m = g["Residential proximity"].value
        sub = s.power.get("nearest_substation") or {}
        sub_km = sub.get("distance_km")
        water_cat = s.power.get("water_stress_cat")
        if water_cat is not None and water_cat not in WATER_SCORE:
            water_cat = None
        people = clamp((home_m or 0) / 10) if home_m is not None else 0.0
        planet_parts = [FLOOD_SCORE.get(g["Flood exposure"].status, 50)]
        if water_cat is not None:
            planet_parts.append(WATER_SCORE[water_cat])
        planet = sum(planet_parts) / len(planet_parts)
        grid = clamp(100 - 15 * sub_km) if sub_km is not None else 0.0
        risks = [f"{x.gate}: {x.reason}" for x in s.gates if x.status != "Pass"]
        risks.append("Grid capacity, interconnection cost and energization date require utility confirmation.")
        sites.append({
            "id": p["parcel_id"],
            "name": p.get("name") or p.get("address") or p["parcel_id"],
            "area": ", ".join(x for x in (p.get("address"), p.get("city")) if x) or market,
            "lat": p["lat"],
            "lng": p["lon"],
            "width": round(side),
            "depth": round(side),
            "landCost": land or 0,
            "metrics": {"power": round(grid, 1), "community": round(people, 1),
                        "resilience": FLOOD_SCORE.get(g["Flood exposure"].status, 50), "affordability": 0.0},
            "pillars": {"people": round(people, 1), "planet": round(planet, 1), "money": 0.0, "overall": 0.0},
            "risks": risks,
            "context": f"{p.get('property_subtype') or p.get('property_type')} · "
                       f"{(acres or 0):.1f} acres · {(p.get('building_sf') or 0):,.0f} SF building · "
                       f"{p.get('availability')}",
            "amenities": {"schools": 0, "restaurants": 0, "parks": 0, "transit": 0, "population": 0},
            "provenance": f"CoStar Data Extract, {p['source_file']} line {p['source_row']} "
                          f"(CoStar property {p['costar_property_id']}). Loaded {p['loaded_at']}.",
            "source": "costar",
            "parcelId": p["parcel_id"],
            "costarPropertyId": p["costar_property_id"],
            "propertyType": p.get("property_type"),
            "propertySubtype": p.get("property_subtype"),
            "lotAcres": acres,
            "buildingSf": p.get("building_sf"),
            "availability": p.get("availability"),
            "photoUrl": p.get("photo_url"),
            "matterportCount": p.get("matterport_count", 0),
            "supportableMw": round(acres * mw_per_acre, 1) if acres else None,
            "landCostBasis": basis,
            "screen": s.as_dict(),
            "labels": {"landCost": land_label, "lotAcres": "Sourced" if acres else "Unknown",
                       "width": "Estimated", "depth": "Estimated", "metrics": "Estimated",
                       "pillars": "Estimated", "supportableMw": "Estimated"},
            "_grid": grid,
        })
    # Money needs the shortlist: rank acquisition $/acre (cheapest = 100)
    per_acre = sorted((s["landCost"] / s["lotAcres"], s["id"]) for s in sites if s["lotAcres"] and s["landCost"])
    rank = {sid: i for i, (_, sid) in enumerate(per_acre)}
    n = max(1, len(per_acre) - 1)
    for s in sites:
        aff = round(100 - 100 * rank[s["id"]] / n, 1) if s["id"] in rank else 0.0
        if len(per_acre) == 1 and s["id"] in rank:
            aff = 100.0
        s["metrics"]["affordability"] = aff
        money = 0.6 * aff + 0.4 * s.pop("_grid")
        s["pillars"]["money"] = round(money, 1)
        pl = s["pillars"]
        pl["overall"] = round((pl["people"] + pl["planet"] + pl["money"]) / 3, 1)
    sites.sort(key=lambda s: (s["screen"]["status"] == "Fail", -s["pillars"]["overall"]))
    return sites
