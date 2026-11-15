"""Hard-gate screening (PRD S-4, F-4) and preliminary power signals (P-1).

Community and environmental limits are pass/fail, never blended into a score:
  - residential proximity  (CoStar apartment communities + MLS home listings; point distance)  -> Pass / Fail
  - flood exposure         (FEMA NFHL zone at the property point)                              -> Pass / Fail / Needs review
  - water stress           (WRI Aqueduct not loaded yet)                                        -> Needs review (Unknown)
Power is a feasibility signal, not a community gate: nearest OSM substation + building electric service.
A nearby substation is NOT available capacity; every power result carries "requires utility confirmation".

All thresholds are explicit inputs with a default tagged "team assumption".
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from app.engine import external
from app.db import session

EARTH_R_M = 6_371_000.0
ASSUMED_VOLTS = 480  # used only when CoStar records amps but no volts; labeled in the output


@dataclass(frozen=True)
class Thresholds:
    min_home_distance_m: float = 300.0     # team assumption
    max_substation_km: float = 5.0         # team assumption (beyond this: needs review)
    min_substation_kv: float = 138.0       # transmission-class substation, team assumption
    flood_fail_on_sfha: bool = True        # FEMA Special Flood Hazard Area (1% annual chance) fails
    max_water_stress_cat: int = 2          # WRI bws_cat: 0 Low, 1 Low-Med, 2 Med-High, 3 High, 4 Extremely high
    max_water_cooling_cat: int = 1         # water cooling only where stress is Low-Medium or better
    min_sensitive_distance_m: float = 200.0  # schools, places of worship, hospitals, childcare; team assumption


HOME_BUILDINGS = {"residential", "apartments", "house", "detached", "semidetached_house", "terrace", "dormitory", "bungalow"}
SQM_PER_ACRE = 4046.86


def _describe(tags: dict[str, Any]) -> str:
    kind = (tags.get("amenity") or tags.get("leisure") or
            (f"{tags['landuse']} land" if tags.get("landuse") else None) or
            ("a building" if tags.get("building") in (None, "yes") else f"a {tags['building']} building")).replace("_", " ")
    return f"{tags['name']} ({kind})" if tags.get("name") else kind


@dataclass
class Gate:
    gate: str
    status: str            # Pass | Fail | Needs review
    value: Any
    limit: Any
    unit: str
    label: str             # Sourced | Estimated | Unknown
    reason: str
    source: str
    retrieved_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class Screen:
    parcel_id: str
    status: str
    gates: list[Gate] = field(default_factory=list)
    power: dict[str, Any] = field(default_factory=dict)
    evidence_gaps: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"parcel_id": self.parcel_id, "status": self.status, "gates": [g.as_dict() for g in self.gates],
                "power": self.power, "evidence_gaps": self.evidence_gaps}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(a))


def nearest(lat: float, lon: float, points: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, float | None]:
    best, best_d = None, None
    for p in points:
        d = haversine_m(lat, lon, p["lat"], p["lon"])
        if best_d is None or d < best_d:
            best, best_d = p, d
    return best, best_d


def service_capacity_mw(amps: int | None, volts: int | None) -> tuple[float | None, str | None]:
    """Three-phase building service: kVA = sqrt(3) x V x A / 1000; MW ~ MVA at unity power factor."""
    if not amps:
        return None, None
    v = volts or ASSUMED_VOLTS
    mw = math.sqrt(3) * v * amps / 1e6
    method = f"sqrt(3) x {v} V x {amps} A" + ("" if volts else f" ({ASSUMED_VOLTS} V assumed; volts not recorded)")
    return round(mw, 2), method


def classify_flood(zones: list[dict[str, Any]]) -> tuple[str, str]:
    if not zones:
        return "Needs review", "No NFHL polygon at this point (unmapped area)"
    names = sorted({(z.get("FLD_ZONE") or "?") for z in zones})
    if any(z.get("SFHA_TF") == "T" for z in zones):
        return "Fail", f"In FEMA Special Flood Hazard Area (zone {', '.join(names)}; 1% annual chance)"
    if any("0.2" in (z.get("ZONE_SUBTY") or "") for z in zones):
        return "Needs review", "FEMA zone X shaded (0.2% annual chance flood)"
    return "Pass", f"FEMA zone {', '.join(names)}: minimal flood hazard"


def load_homes(market_bbox: tuple[float, float, float, float] | None) -> list[dict[str, Any]]:
    with session() as c:
        if market_bbox:
            s, w, n, e = market_bbox
            rows = c.execute("SELECT * FROM homes WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
                             (s - 0.2, n + 0.2, w - 0.2, e + 0.2))
        else:
            rows = c.execute("SELECT * FROM homes")
        return [dict(r) for r in rows]


def screen_parcel(parcel: dict[str, Any], homes: list[dict[str, Any]], subs: dict[str, Any] | None,
                  t: Thresholds, *, offline: bool = False, sensitive: dict[str, Any] | None = None,
                  land: dict[str, Any] | None = None, acres: float | None = None) -> Screen:
    """`sensitive` is the market's schools, places of worship, hospitals and childcare (OpenStreetMap).
    `land` is what is mapped at and around a user-chosen point; CoStar parcels are known lots and do not need it."""
    lat, lon = parcel["lat"], parcel["lon"]
    gates: list[Gate] = []
    gaps: list[str] = []
    if land:  # CoStar listings are a sample of homes; around a free-chosen point, add every home mapped in OpenStreetMap
        homes = homes + [{"lat": b["lat"], "lon": b["lon"], "kind": "home mapped in OpenStreetMap", "name": b.get("name"),
                          "ref_id": b["osm_id"], "osm": True}
                         for b in land["payload"]["buildings"] if b.get("building") in HOME_BUILDINGS]

    # 1. Residential proximity (hard gate) + count within one mile (noise exposure context)
    home, d_home = nearest(lat, lon, homes)
    within_mile = sum(1 for h in homes if haversine_m(lat, lon, h["lat"], h["lon"]) <= 1609.344)
    if home is None:
        gates.append(Gate("Residential proximity", "Needs review", None, t.min_home_distance_m, "m", "Unknown",
                          "No residential locations loaded for this market", "CoStar Data Extract"))
    else:
        ok = d_home >= t.min_home_distance_m
        gates.append(Gate(
            "Residential proximity", "Pass" if ok else "Fail", round(d_home), t.min_home_distance_m, "m", "Estimated",
            f"Nearest {home['kind']} ({home['name'] or home['ref_id']}) is {round(d_home)} m away; "
            f"limit {t.min_home_distance_m:.0f} m (team assumption). Point-to-point distance; no parcel polygons.",
            external.OSM_SOURCE if home.get("osm") else
            f"CoStar Data Extract ({home['source_file']} line {home['source_row']})"))

    # 1b. Schools, places of worship, hospitals, childcare (hard gate)
    if sensitive is None:
        gates.append(Gate("Sensitive places", "Needs review", None, t.min_sensitive_distance_m, "m", "Unknown",
                          "Schools, places of worship and hospitals were not retrieved for this market.", "OpenStreetMap"))
        gaps.append("Sensitive places (schools, worship, hospitals) not retrieved")
    else:
        places = sensitive["payload"]["places"]
        place, d_place = nearest(lat, lon, places)
        if place is None:
            gates.append(Gate("Sensitive places", "Needs review", None, t.min_sensitive_distance_m, "m", "Unknown",
                              "No schools, places of worship or hospitals are mapped in this market.", sensitive["source"]))
        else:
            near = sum(1 for p in places if haversine_m(lat, lon, p["lat"], p["lon"]) <= 500)
            gates.append(Gate(
                "Sensitive places", "Pass" if d_place >= t.min_sensitive_distance_m else "Fail", round(d_place),
                t.min_sensitive_distance_m, "m", "Estimated",
                f"Nearest school, place of worship, hospital or childcare is {place['name'] or 'unnamed'} ({place['kind']}), "
                f"{round(d_place)} m away; limit {t.min_sensitive_distance_m:.0f} m (team assumption). "
                f"{near} such place{'s' if near != 1 else ''} within 500 m. Distance to the mapped centre of the place.",
                sensitive["source"], sensitive["retrieved_at"]))

    # 1c. A free-chosen point has no lot: is the land already built on? (hard gate)
    if land is not None:
        acres_ = acres or 10.0
        site_r = math.sqrt(acres_ * SQM_PER_ACRE / math.pi)
        inside = [b for b in land["payload"]["buildings"] if haversine_m(lat, lon, b["lat"], b["lon"]) <= site_r]
        on = next((h for h in land["payload"]["here"] if h.get("building") or h.get("amenity") or h.get("leisure")
                   or h.get("landuse") in ("residential", "cemetery", "retail", "commercial")), None)
        named = sorted({_describe(b) for b in inside if b.get("name") or b.get("amenity")})[:3]
        if on:
            status, reason = "Fail", f"The point is on {_describe(on)}."
        elif len(inside) > 3:
            status, reason = "Fail", f"{len(inside)} existing buildings stand inside the site area"
            reason += f", including {', '.join(named)}." if named else "."
        elif inside:
            status, reason = "Needs review", f"{len(inside)} existing building{'s' if len(inside) > 1 else ''} inside the site area."
        else:
            status, reason = "Pass", "No mapped buildings inside the site area."
        gates.append(Gate(
            "Land in use", status, len(inside), 0, "buildings", "Sourced",
            f"{reason} Site area is an assumed {acres_:.0f} acres around the point, not a surveyed lot. "
            "OpenStreetMap footprints can be incomplete.", land["source"], land["retrieved_at"]))

    # 2. Flood exposure (hard gate)
    fema = external.fema_flood_zone(lat, lon, offline=offline)
    if fema is None:
        gates.append(Gate("Flood exposure", "Needs review", None, "outside SFHA", "", "Unknown",
                          "FEMA NFHL not retrieved", "FEMA NFHL"))
        gaps.append("FEMA flood zone not retrieved")
    else:
        status, reason = classify_flood(fema["payload"]["zones"])
        if status == "Fail" and not t.flood_fail_on_sfha:
            status = "Needs review"
        zones = sorted({z.get("FLD_ZONE") for z in fema["payload"]["zones"] if z.get("FLD_ZONE")})
        gates.append(Gate("Flood exposure", status, ", ".join(zones) or None, "outside SFHA", "", "Sourced",
                          reason, fema["source"], fema["retrieved_at"]))

    # 3. Water stress (hard gate) + water-cooling eligibility
    aq = external.aqueduct_water_stress(lat, lon, offline=offline)
    if aq is None or aq["payload"].get("bws_cat") is None or aq["payload"]["bws_cat"] < 0:
        gates.append(Gate("Water stress", "Needs review", None, t.max_water_stress_cat, "WRI category", "Unknown",
                          "WRI Aqueduct value not retrieved", "WRI Aqueduct 4.0"))
        gaps.append("WRI Aqueduct water stress not retrieved; water cooling not cleared")
        water_cooling_ok = None
        water_cat = None
    else:
        a = aq["payload"]
        cat = water_cat = a["bws_cat"]
        water_cooling_ok = cat <= t.max_water_cooling_cat
        gates.append(Gate(
            "Water stress", "Pass" if cat <= t.max_water_stress_cat else "Fail", a["bws_label"],
            f"category <= {t.max_water_stress_cat}", "WRI category", "Sourced",
            f"Baseline water stress {a['bws_label']} (raw {a['bws_raw']:.2f}, sub-basin {a['pfaf_id']}). "
            f"Water cooling {'allowed' if water_cooling_ok else 'excluded'} "
            f"(limit category <= {t.max_water_cooling_cat}, team assumption).",
            aq["source"], aq["retrieved_at"]))

    # Power feasibility signal (not a community gate)
    mw, method = service_capacity_mw(parcel.get("amps_high"), parcel.get("volts_high"))
    sub, d_sub = (None, None)
    if subs:
        eligible = [s for s in subs["payload"]["substations"] if (s["max_kv"] or 0) >= t.min_substation_kv]
        sub, d_sub = nearest(lat, lon, eligible)
    power = {
        "residential_within_1mi": within_mile,
        "residential_within_1mi_note": "CoStar-recorded apartment communities and MLS home listings within 1 mile; "
                                       "a lower bound, not a census of households",
        "water_cooling_ok": water_cooling_ok,
        "water_stress_cat": water_cat,
        "building_service_mw": mw,
        "building_service_method": method,
        "building_service_label": "Estimated" if mw is not None else "Unknown",
        "has_heavy_power": parcel.get("has_heavy_power"),
        "nearest_substation": None if sub is None else {
            "name": sub["name"], "operator": sub["operator"], "max_kv": sub["max_kv"], "osm_id": sub["osm_id"],
            "distance_km": round(d_sub / 1000, 2), "lat": sub["lat"], "lon": sub["lon"]},
        "substation_source": subs["source"] if subs else None,
        "substation_retrieved_at": subs["retrieved_at"] if subs else None,
        "requires_utility_confirmation": [
            "Available capacity at the nearest substation",
            "Interconnection cost and upgrade scope",
            "Energization date",
        ],
    }
    if sub is None:
        gates.append(Gate("Grid proximity", "Needs review", None, t.max_substation_km, "km", "Unknown",
                          "No transmission substation data", "OpenStreetMap"))
        gaps.append("Substation locations not retrieved")
    else:
        ok = d_sub / 1000 <= t.max_substation_km
        gates.append(Gate(
            "Grid proximity", "Pass" if ok else "Needs review", round(d_sub / 1000, 2), t.max_substation_km, "km",
            "Estimated",
            f"Nearest >= {t.min_substation_kv:.0f} kV substation ({sub['name'] or sub['osm_id']}) is "
            f"{d_sub / 1000:.1f} km away. Proximity is not available capacity; requires utility confirmation.",
            subs["source"], subs["retrieved_at"]))
    if mw is None:
        gaps.append("Building electric service (amps) not recorded in CoStar")

    hard = [g for g in gates if g.gate in ("Residential proximity", "Sensitive places", "Land in use", "Flood exposure",
                                           "Water stress")]
    status = ("Fail" if any(g.status == "Fail" for g in hard)
              else "Needs review" if any(g.status != "Pass" for g in gates) else "Pass")
    return Screen(parcel["parcel_id"], status, gates, power, gaps)
