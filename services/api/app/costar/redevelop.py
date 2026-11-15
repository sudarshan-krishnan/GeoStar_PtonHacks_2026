"""Redevelopment potential: a transparent checklist per property, from CoStar building facts.

Each category (industrial conversion, data center redevelopment, expansion, adaptive reuse, land acquisition) is a list
of items. Every item is pass, flag or unknown, with the value, the threshold, the reason and the source. The score is
simply "passes out of known items"; unknown items are listed, never counted as passes or failures. Thresholds are
PlotStar screening rules (team assumptions, listed in THRESHOLDS), not CoStar facts and not engineering findings.

Market status is read from active listings only. A property with no active listing is "not marketed": nothing here
implies it is for sale.
"""
from __future__ import annotations

from typing import Any, Callable

from ..db import connect
from . import homes as H
from . import tenancy as T

SOURCE_P = "data/commercial-property.jsonl"
CATEGORIES = ("industrial_conversion", "data_center_redevelopment", "expansion", "adaptive_reuse", "land_acquisition")
LABELS = {"industrial_conversion": "Industrial conversion", "data_center_redevelopment": "Data center redevelopment",
          "expansion": "Expansion on the lot", "adaptive_reuse": "Adaptive reuse", "land_acquisition": "Land acquisition"}

# PlotStar screening thresholds (team assumptions). Each is quoted in the item that uses it.
THRESHOLDS = {
    "min_lot_acres_dc": 5.0, "min_lot_acres_industrial": 3.0, "min_building_sf_dc": 20_000, "min_clear_height_dc_ft": 18.0,
    "min_clear_height_logistics_ft": 24.0, "max_stories_dc": 2, "heavy_power_amps": 800, "max_coverage_expansion": 0.35,
    "max_coverage_industrial": 0.45, "max_coverage_land": 0.10, "reuse_built_before": 1995, "min_home_distance_m": 300,
}
THRESHOLD_BASIS = "PlotStar screening rule (team assumption), not a CoStar fact or an engineering finding."
SQFT_PER_ACRE = 43_560.0


def _item(name: str, status: str, value: Any, threshold: Any, reason: str, source: str) -> dict[str, Any]:
    return dict(item=name, status=status, value=value, threshold=threshold, reason=reason, source=source)


def _facts(c, parcel_id: str) -> dict[str, Any] | None:
    r = c.execute("SELECT p.*, x.rba_sf, x.gba_sf, x.is_owner_occupied FROM parcels p "
                  "LEFT JOIN property_extra x ON x.property_id = p.costar_property_id WHERE p.parcel_id = ?", (parcel_id,)).fetchone()
    if not r:
        return None
    f = dict(r)
    gba = f.get("gba_sf") or f.get("building_sf")
    st = f.get("stories") or None
    f["footprint_sf"] = gba / st if gba and st else None
    f["coverage"] = round(f["footprint_sf"] / (f["lot_acres"] * SQFT_PER_ACRE), 3) if f["footprint_sf"] and f.get("lot_acres") else None
    return f


def _market_status(av: dict[str, Any]) -> str:
    if av["for_sale"]:
        return "Listed for sale"
    if av["available_sf"]:
        return "Listed for lease (not for sale)"
    return "Not marketed: no active CoStar listing. Nothing implies it is for sale; an off-market approach to the owner would be needed."


def _checks(f: dict[str, Any], status: dict[str, Any], near_home_m: float | None) -> dict[str, list[dict[str, Any]]]:
    t = THRESHOLDS
    P = f"{SOURCE_P} row {f.get('source_row')}"
    lot, bsf, ch, stories, year = f.get("lot_acres"), f.get("gba_sf") or f.get("building_sf"), f.get("ceiling_height_ft"), f.get("stories"), f.get("year_built")
    cov = f.get("coverage")
    ptype = f.get("property_type") or "Unknown"
    amps = f.get("amps_high")
    states = status["states"]
    av = status["availability"]

    def num(name: str, v: Any, ok: Callable[[Any], bool], thr: str, unit: str, why_ok: str, why_flag: str, src: str = P) -> dict:
        if v is None:
            return _item(name, "unknown", None, thr, f"Not recorded in CoStar. {THRESHOLD_BASIS}", src)
        return _item(name, "pass" if ok(v) else "flag", v, thr, (why_ok if ok(v) else why_flag) + f" ({v:,}{unit}). {THRESHOLD_BASIS}", src)

    power = (_item("Heavy power", "pass", amps, f">= {t['heavy_power_amps']} A", f"CoStar records {amps:,} A (heavy power). Grid "
                   "capacity for a new load still needs the utility.", P) if amps and amps >= t["heavy_power_amps"] else
             _item("Heavy power", "flag", amps, f">= {t['heavy_power_amps']} A", f"CoStar records {amps:,} A, below heavy power. "
                   "A new service from the utility would be needed.", P) if amps else
             _item("Heavy power", "pass" if f.get("has_heavy_power") == 1 else "unknown", None, f">= {t['heavy_power_amps']} A",
                   "CoStar flags heavy power." if f.get("has_heavy_power") == 1 else "Electric service is not recorded in CoStar.", P))
    occ = ("pass" if "confirmed_vacant" in states else "flag" if "occupied" in states else "unknown")
    occ_item = _item("Occupancy", occ, ", ".join(states), "whole building offered and no current tenant",
                     {"pass": "The whole building is offered and no current tenancy is recorded.",
                      "flag": "Tenants are recorded in place; control depends on their leases (see the control analysis).",
                      "unknown": "No current tenancy evidence either way: unknown, not vacant."}[occ], T.OCC_FILE)
    market = _item("Market status", "pass" if av["for_sale"] else "unknown", _market_status(av), "an active sale listing",
                   _market_status(av), T.LISTING_FILE)
    homes_item = (_item("Distance to homes", "pass" if near_home_m >= t["min_home_distance_m"] else "flag", near_home_m,
                        f">= {t['min_home_distance_m']} m", f"Nearest CoStar residential record is {near_home_m:,.0f} m away. "
                        f"{THRESHOLD_BASIS}", "data/residential-listings.jsonl; data/apartment-listing.jsonl; " + SOURCE_P)
                  if near_home_m is not None else
                  _item("Distance to homes", "unknown", None, f">= {t['min_home_distance_m']} m",
                        "No CoStar residential record within 3 km; CoStar homes are a sample, so this is unknown, not clear.", "CoStar residential"))
    existing = _item("Building stands today", "pass" if f.get("construction_status") == "Existing" else
                     "unknown" if not f.get("construction_status") else "flag", f.get("construction_status"), "Existing",
                     f"Construction status: {f.get('construction_status') or 'not recorded'}.", P)
    return {
        "industrial_conversion": [
            _item("Current use", "pass" if ptype not in ("Industrial",) else "flag", ptype, "not already industrial",
                  "Already industrial: nothing to convert." if ptype == "Industrial" else f"{ptype} property: a change of use to industrial.", P),
            num("Lot size", lot, lambda v: v >= t["min_lot_acres_industrial"], f">= {t['min_lot_acres_industrial']} acres", " acres",
                "Room for truck courts and parking", "Small lot for logistics"),
            num("Clear height", ch, lambda v: v >= t["min_clear_height_logistics_ft"], f">= {t['min_clear_height_logistics_ft']} ft", " ft",
                "Modern logistics clear height", "Low clear height for racking"),
            num("Site coverage", cov, lambda v: v <= t["max_coverage_industrial"], f"<= {t['max_coverage_industrial']:.0%}", "",
                "Open land for yards (footprint = GBA / stories, over lot area)", "Little open land for yards"),
            _item("Rail", "pass" if f.get("has_rail") == 1 else "unknown", bool(f.get("has_rail")), "rail served",
                  "CoStar records rail access." if f.get("has_rail") == 1 else "No rail recorded (absence is not proof of none).", P),
            existing, occ_item],
        "data_center_redevelopment": [
            power,
            num("Lot size", lot, lambda v: v >= t["min_lot_acres_dc"], f">= {t['min_lot_acres_dc']} acres", " acres",
                "Room for a plant yard and setbacks", "Tight lot for a data center yard"),
            num("Building size", bsf, lambda v: v >= t["min_building_sf_dc"], f">= {t['min_building_sf_dc']:,} sf", " sf",
                "Shell large enough to reuse", "Small shell"),
            num("Clear height", ch, lambda v: v >= t["min_clear_height_dc_ft"], f">= {t['min_clear_height_dc_ft']} ft", " ft",
                "Room for raised floor or overhead services", "Low for data hall services"),
            num("Storeys", stories, lambda v: v <= t["max_stories_dc"], f"<= {t['max_stories_dc']}", "",
                "Low-rise structure suits heavy equipment loads", "Multi-storey: floor loading needs a structural review"),
            homes_item, existing, occ_item, market],
        "expansion": [
            num("Site coverage", cov, lambda v: v <= t["max_coverage_expansion"], f"<= {t['max_coverage_expansion']:.0%}", "",
                "Open land to build on (footprint = GBA / stories, over lot area)", "Little open land left"),
            num("Lot size", lot, lambda v: v >= t["min_lot_acres_industrial"], f">= {t['min_lot_acres_industrial']} acres", " acres",
                "Lot large enough to add a building", "Small lot"),
            _item("Zoning", "unknown" if not f.get("zoning") or f.get("zoning") == "None" else "pass", f.get("zoning"), "recorded",
                  f"Zoning recorded as {f['zoning']}; permitted uses still need the city." if f.get("zoning") and f.get("zoning") != "None"
                  else "Zoning not recorded in CoStar.", P),
            occ_item],
        "adaptive_reuse": [
            num("Year built", year, lambda v: v <= t["reuse_built_before"], f"<= {t['reuse_built_before']}", "",
                "Older building, typical reuse stock", "Recent building: reuse is less likely to be needed"),
            _item("Building class", "pass" if f.get("building_class") in ("B", "C") else "unknown" if not f.get("building_class") else "flag",
                  f.get("building_class"), "B or C", f"Class {f.get('building_class') or 'not recorded'}: "
                  + ("B and C stock is where reuse usually pays." if f.get("building_class") in ("B", "C") else "A class rarely needs reuse."
                     if f.get("building_class") else "unknown."), P),
            _item("Space on the market", "pass" if av["available_sf"] else "unknown", av["available_sf"], "space listed for lease",
                  f"{av['available_sf']:,} sf listed for lease (available is not vacant)." if av["available_sf"] else
                  "No space listed; that does not mean the building is full.", T.LISTING_FILE),
            existing, occ_item],
        "land_acquisition": [
            _item("Land or lightly built", "pass" if ptype == "Land" or (cov is not None and cov <= t["max_coverage_land"]) else
                  "unknown" if cov is None and ptype != "Land" else "flag", ptype if ptype == "Land" else cov,
                  f"Land, or coverage <= {t['max_coverage_land']:.0%}", f"{ptype} property"
                  + (f", coverage {cov:.0%}" if cov is not None else ", coverage unknown") + f". {THRESHOLD_BASIS}", P),
            num("Lot size", lot, lambda v: v >= t["min_lot_acres_dc"], f">= {t['min_lot_acres_dc']} acres", " acres",
                "Large enough to assemble a campus", "Small lot"),
            market, homes_item],
    }


def redevelopment(parcel_id: str, categories: tuple[str, ...] = CATEGORIES) -> dict[str, Any] | None:
    T.ensure()
    c = connect()
    try:
        f = _facts(c, parcel_id)
    finally:
        c.close()
    if f is None:
        return None
    status = T.occupancy_status(parcel_id)
    com = H.community(parcel_id, radius_m=3000)
    near = min([d for d in (com["nearest_home_listing_m"], com["nearest_apartment_community_m"]) if d is not None], default=None) if com else None
    checks = _checks(f, status, near)
    out = {}
    for k in categories:
        items = checks[k]
        known = [i for i in items if i["status"] != "unknown"]
        passes = sum(1 for i in known if i["status"] == "pass")
        out[k] = dict(label=LABELS[k], items=items, passes=passes, known=len(known), unknown=len(items) - len(known),
                      score=round(passes / len(known), 2) if known else None,
                      summary=f"Passes {passes} of {len(known)} known checks; {len(items) - len(known)} unknown.")
    return dict(parcel_id=parcel_id, costar_property_id=f["costar_property_id"], name=f.get("name"), address=f.get("address"),
                property_type=f.get("property_type"), market_status=_market_status(status["availability"]),
                facts=dict(lot_acres=f.get("lot_acres"), building_sf=f.get("gba_sf") or f.get("building_sf"), rba_sf=f.get("rba_sf"),
                           stories=f.get("stories"), footprint_sf=round(f["footprint_sf"]) if f.get("footprint_sf") else None,
                           coverage=f.get("coverage"), coverage_basis="footprint = gross building area / stories; coverage = footprint / lot area",
                           building_class=f.get("building_class"), year_built=f.get("year_built"), ceiling_height_ft=f.get("ceiling_height_ft"),
                           amps_high=f.get("amps_high"), volts_high=f.get("volts_high"), heavy_power=f.get("has_heavy_power"),
                           rail=f.get("has_rail"), zoning=f.get("zoning"), construction_status=f.get("construction_status"),
                           occupancy_states=status["states"], available_sf=status["availability"]["available_sf"]),
                categories=out, thresholds=THRESHOLDS, threshold_basis=THRESHOLD_BASIS, label="Screening",
                note="A desk screen from CoStar records. Not a feasibility study, an appraisal or an engineering assessment.",
                source="CoStar Data Extract", source_row=f.get("source_row"))


# ----------------------------------------------------------------------------------------------------- searches
_PREFILTER = {
    "industrial_conversion": "p.property_type IN ('Flex','Office','Retail','Specialty','Land') OR p.dc_candidate = 1",
    "data_center_redevelopment": "p.dc_candidate = 1",
    "expansion": "p.lot_acres IS NOT NULL",
    "adaptive_reuse": "p.year_built IS NOT NULL AND p.year_built <= 1995",
    "land_acquisition": "p.property_type = 'Land' OR p.lot_acres >= 5",
}


def find_candidates(market: str | None = None, category: str = "data_center_redevelopment", limit: int = 10,
                    filters: dict[str, Any] | None = None) -> dict[str, Any]:
    """Properties ranked by their checklist score for one category. SQL prefilter, then the same checklist per property."""
    if category not in CATEGORIES:
        raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
    T.ensure()
    H.ensure()
    f = filters or {}
    where, args = [f"({_PREFILTER[category]})", "p.lat IS NOT NULL"], []
    if market:
        where.append("p.market = ?"); args.append(market)
    if f.get("min_acres") is not None:
        where.append("p.lot_acres >= ?"); args.append(f["min_acres"])
    if f.get("property_types"):
        where.append("p.property_type IN (%s)" % ",".join("?" * len(f["property_types"]))); args += list(f["property_types"])
    if f.get("listed_only"):
        where.append("EXISTS (SELECT 1 FROM listing_spaces s WHERE s.property_id = p.costar_property_id)")
    c = connect()
    try:
        ids = [r[0] for r in c.execute(f"SELECT p.parcel_id FROM parcels p WHERE {' AND '.join(where)} "
                                       "ORDER BY p.lot_acres DESC LIMIT 400", args)]
    finally:
        c.close()
    scored = []
    for pid in ids:
        r = redevelopment(pid, (category,))
        cat = r["categories"][category]
        if cat["known"] == 0:
            continue
        scored.append(dict(parcel_id=pid, name=r["name"], address=r["address"], property_type=r["property_type"],
                           score=cat["score"], passes=cat["passes"], known=cat["known"], unknown=cat["unknown"],
                           market_status=r["market_status"],
                           evidence=[f"{i['item']}: {i['status']} ({i['reason']})" for i in cat["items"]]))
    scored.sort(key=lambda x: (-(x["score"] or 0), -x["passes"], x["unknown"]))
    return dict(category=category, label=LABELS[category], market=market, screened=len(ids), candidates=scored[:max(1, min(limit, 50))],
                note="Ranked by checklist score (passes over known checks), ties by more passes and fewer unknowns. "
                     "'Not marketed' properties are not for sale as far as CoStar shows.", threshold_basis=THRESHOLD_BASIS)


def with_available_space(market: str | None = None, min_sf: float = 0, limit: int = 50) -> dict[str, Any]:
    """Properties with space or a building marketed now (active CoStar listings). Available is not vacant."""
    T.ensure()
    c = connect()
    try:
        rows = [dict(r) for r in c.execute(
            "SELECT p.parcel_id, p.name, p.address, p.property_type, p.lot_acres, "
            " SUM(CASE WHEN s.kind='lease' AND s.lease_pending=0 THEN COALESCE(s.sf_max,0) ELSE 0 END) AS available_sf, "
            " SUM(CASE WHEN s.kind='lease' AND s.lease_pending=0 THEN 1 ELSE 0 END) AS lease_spaces, "
            " SUM(CASE WHEN s.kind='sale' THEN 1 ELSE 0 END) AS sale_listings, "
            " MIN(s.rate_per_sf_year_low) AS min_asking_rent_per_sf_year, GROUP_CONCAT(DISTINCT s.source_row) AS source_rows "
            "FROM listing_spaces s JOIN parcels p ON p.costar_property_id = s.property_id "
            "WHERE (? IS NULL OR p.market = ?) GROUP BY p.parcel_id HAVING available_sf >= ? OR sale_listings > 0 "
            "ORDER BY available_sf DESC LIMIT ?", (market, market, min_sf, limit))]
    finally:
        c.close()
    return dict(market=market, properties=rows, source=T.LISTING_FILE,
                note="From active listings only. Available means marketed, not necessarily vacant; asking rent is not achieved rent.")


def needs_leasing_diligence(market: str | None = None, limit: int = 50) -> dict[str, Any]:
    """Properties whose current tenancies carry leasing risk: unknown expiries, month to month, subleases, stale leases."""
    T.ensure()
    c = connect()
    try:
        rows = [dict(r) for r in c.execute(
            "SELECT p.parcel_id, p.name, p.address, p.property_type, COUNT(*) AS current_tenancies, "
            " SUM(o.lease_expiration IS NULL AND COALESCE(o.lease_type,'') <> 'Owned') AS unknown_expirations, "
            " SUM(o.month_to_month) AS month_to_month, SUM(o.lease_type IN ('Sublease','Assignment')) AS subleases, "
            " SUM(o.lease_expiration IS NOT NULL AND o.lease_expiration < date('now')) AS expired_but_current, "
            " SUM(o.tenant_location_id IS NULL) AS unidentified "
            "FROM occupancies o JOIN parcels p ON p.costar_property_id = o.property_id "
            "WHERE o.is_current = 1 AND (? IS NULL OR p.market = ?) GROUP BY p.parcel_id "
            "HAVING unknown_expirations + month_to_month + subleases + expired_but_current > 0 "
            "ORDER BY (unknown_expirations + month_to_month + subleases + expired_but_current) DESC LIMIT ?",
            (market, market, limit))]
    finally:
        c.close()
    return dict(market=market, properties=rows, source=T.OCC_FILE,
                note="Counts of current tenancy records. Unknown expirations are missing data, never assumed dates.")
