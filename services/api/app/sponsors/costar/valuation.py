"""Comparable-sales valuation of a CoStar parcel for data center site underwriting.

Reads `sale_comps` (comps.py). For a subject parcel it finds usable market sales of land, industrial and flex property
in the same market, filters them (distance, size band, date window, price-status confidence, the user's exclusions),
scores each one's similarity to the subject, and estimates value on one basis:

- "sf":   $ per SF of building (sale price / CoStar gross building area). Used when the subject has a building.
- "acre": land $ per acre (land sales in full; the land share of improved sales from the assessor, see comps.py).
          Used for land, or a lot with no recorded building.

Freshness: every comp carries its age; comps older than `max_age_years` are flagged stale, shown, and left out of the
estimate. Prices are nominal: the kit has no price index, so nothing is adjusted for appreciation.

Estimates need at least MIN_COMPS usable, non-stale comps; otherwise the result is `insufficient_evidence` with the
reasons and no value. Nothing is invented.

Similarity (0-100) = 30 x distance + 25 x size + 15 x type + 20 x recency + 10 x price confidence, each part 0-1:
  distance   1 - d / radius used
  size       smaller / larger of the subject's and the comp's size on the chosen basis (SF or acres); 0.5 if unknown
  type       1 same type, 0.6 industrial <-> flex, 0.3 otherwise
  recency    1 - age / max_age_years (0 when stale)
  confidence 1 Confirmed/Affidavit/Declaration, 0.6 FullValue/Unconfirmed, 0.5 Approximate, 0.2 other
"""
from __future__ import annotations

import math
import statistics
from datetime import date
from typing import Any, Literal

from app.db import session
from app.sponsors.costar.comps import FALLBACK, SOURCE, TRUSTED, ensure_built

Basis = Literal["sf", "acre"]
RADII_KM = (5.0, 10.0, 25.0, 50.0)
MIN_COMPS = 3
DEFAULT_MAX_AGE = 5.0
SIZE_BAND = (1 / 3, 3.0)  # comp size between a third of and three times the subject's
WEIGHTS = {"distance": 30, "size": 25, "type": 15, "recency": 20, "confidence": 10}
CONFIDENCE = {"Confirmed": 1.0, "Affidavit": 1.0, "Declaration": 1.0, "FullValue": 0.6, "Unconfirmed": 0.6, "Approximate": 0.5}
METHOD = ("Comparable sales from the CoStar Data Extract: individual, arm's-length sales of land, industrial and flex "
          "property in the same market. Nominal prices (the kit has no price index, so nothing is time-adjusted); "
          "stale comps are shown but left out. Similarity = 30 distance + 25 size + 15 type + 20 recency + 10 price "
          "confidence.")


class UnknownParcel(LookupError):
    pass


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(min(1.0, a)))


def age_years(sold: str | None, today: date) -> float | None:
    if not sold:
        return None
    try:
        d = date.fromisoformat(sold[:10])
    except ValueError:
        return None
    return max(0.0, (today - d).days / 365.25)


def quartiles(xs: list[float]) -> tuple[float, float, float]:
    xs = sorted(xs)
    if len(xs) == 1:
        return xs[0], xs[0], xs[0]
    q = statistics.quantiles(xs, n=4, method="inclusive")
    return q[0], statistics.median(xs), q[2]


def pick_basis(subject: dict) -> Basis:
    return "sf" if (subject.get("building_sf") or 0) > 0 and subject.get("property_type") != "Land" else "acre"


def _value(r: dict, basis: Basis) -> float | None:
    return r.get("per_sf") if basis == "sf" else r.get("land_per_acre")


def _size(r: dict, basis: Basis) -> float | None:
    v = r.get("building_sf") if basis == "sf" else r.get("lot_acres")
    return v if v and v > 0 else None


def _type_score(a: str | None, b: str | None) -> float:
    if a and a == b:
        return 1.0
    return 0.6 if {a, b} <= {"Industrial", "Flex"} else 0.3


def _counts(r: dict, subject: dict, excluded: set[int]) -> bool:
    """A comp counts toward the estimate when it is current, not excluded by the user, and not the subject's own sale
    (the subject's past sale is shown as evidence but would make the estimate circular)."""
    return not r["stale"] and r["comp_id"] not in excluded and r["parcel_id"] != subject.get("parcel_id")


def score(subject: dict, comp: dict, basis: Basis, radius_km: float, max_age: float) -> dict[str, float]:
    """Similarity parts (0-1) and the 0-100 total."""
    s_size, c_size = _size(subject, basis), _size(comp, basis)
    parts = {
        "distance": max(0.0, 1 - comp["distance_km"] / radius_km) if radius_km > 0 else 0.0,
        "size": (min(s_size, c_size) / max(s_size, c_size)) if s_size and c_size else 0.5,
        "type": _type_score(subject.get("property_type"), comp.get("property_type")),
        "recency": 0.0 if comp["age_years"] is None else max(0.0, 1 - comp["age_years"] / max_age),
        "confidence": CONFIDENCE.get(comp.get("price_status") or "", 0.2),
    }
    total = sum(WEIGHTS[k] * v for k, v in parts.items())
    return {**{k: round(v, 3) for k, v in parts.items()}, "total": round(total, 1)}


def evaluate(subject: dict, rows: list[dict], *, basis: Basis | None = None, radius_km: float | None = None,
             max_age_years: float = DEFAULT_MAX_AGE, exclude: list[int] | None = None, size_band: bool = True,
             today: date | None = None) -> dict[str, Any]:
    """Pure comps selection and estimate for `subject` over candidate `rows` (sale_comps rows). For tests and callers."""
    today = today or date.today()
    basis = basis or pick_basis(subject)
    excluded = set(exclude or [])
    reasons_out: dict[str, int] = {}

    def drop(why: str) -> None:
        reasons_out[why] = reasons_out.get(why, 0) + 1

    pool = []
    s_size = _size(subject, basis)
    for r in rows:
        if r.get("market") != subject.get("market"):
            continue
        if not r.get("usable"):
            drop(r.get("reason") or "not usable")
            continue
        if r.get("lat") is None or r.get("lon") is None:
            drop("comp has no coordinates")
            continue
        if basis == "sf" and r.get("property_type") == "Land":
            drop("land sale (no building) on the $/SF basis")
            continue
        v = _value(r, basis)
        if not v:
            drop("no building SF in CoStar" if basis == "sf" else "no lot size or assessor land share in CoStar")
            continue
        c_size = _size(r, basis)
        if size_band and s_size and c_size and not (SIZE_BAND[0] <= c_size / s_size <= SIZE_BAND[1]):
            drop("size outside 1/3x to 3x the subject")
            continue
        d = haversine_km(subject["lat"], subject["lon"], r["lat"], r["lon"])
        a = age_years(r.get("sold_date"), today)
        pool.append({**r, "distance_km": round(d, 2), "age_years": round(a, 1) if a is not None else None,
                     "stale": a is None or a > max_age_years, "value": v})

    radii = (radius_km,) if radius_km else RADII_KM
    chosen: dict[str, Any] | None = None
    tried = []
    for statuses, label in ((TRUSTED, "trusted"), (TRUSTED + FALLBACK, "widened")):
        for km in radii:
            near = [r for r in pool if r["distance_km"] <= km and r.get("price_status") in statuses]
            current = [r for r in near if _counts(r, subject, excluded)]
            tried.append(dict(radius_km=km, statuses=label, current=len(current), stale=sum(r["stale"] for r in near)))
            if len(current) >= MIN_COMPS:
                chosen = dict(radius_km=km, statuses=list(statuses), label=label, near=near)
                break
        if chosen:
            break
    if not chosen:  # show what exists at the widest search even when there is too little to estimate
        km = radii[-1]
        chosen = dict(radius_km=km, statuses=list(TRUSTED + FALLBACK), label=None,
                      near=[r for r in pool if r["distance_km"] <= km and r.get("price_status") in TRUSTED + FALLBACK])

    comps = []
    for r in chosen["near"]:
        sim = score(subject, r, basis, chosen["radius_km"], max_age_years)
        comps.append(dict(
            comp_id=r["comp_id"], parcel_id=r["parcel_id"], is_subject=r["parcel_id"] == subject.get("parcel_id"),
            name=r.get("name"), address=r.get("address"), lat=r["lat"], lon=r["lon"], property_type=r.get("property_type"),
            sold_date=r.get("sold_date"), age_years=r["age_years"], stale=r["stale"], price=r.get("price"),
            price_status=r.get("price_status"), building_sf=r.get("building_sf"),
            lot_acres=round(r["lot_acres"], 2) if r.get("lot_acres") else None,
            per_sf=round(r["per_sf"], 2) if r.get("per_sf") else None,
            land_per_acre=round(r["land_per_acre"]) if r.get("land_per_acre") else None,
            all_in_per_acre=round(r["all_in_per_acre"]) if r.get("all_in_per_acre") else None,
            land_share=round(r["land_share"], 3) if r.get("land_share") is not None else None,
            land_share_basis=r.get("land_share_basis"), distance_km=r["distance_km"], similarity=sim["total"],
            similarity_parts={k: sim[k] for k in WEIGHTS}, excluded=r["comp_id"] in excluded,
            used=_counts(r, subject, excluded), source_row=r["source_row"]))
    comps.sort(key=lambda c: (-c["used"], -c["similarity"]))
    used = [c for c in comps if c["used"]]
    unit = "$/SF" if basis == "sf" else "$/acre"
    out = dict(basis=basis, unit=unit, radius_km=chosen["radius_km"], max_age_years=max_age_years,
               price_statuses=chosen["statuses"], widened_statuses=chosen["label"] == "widened",
               excluded=sorted(excluded), comps=comps, n_used=len(used), n_stale=sum(c["stale"] for c in comps),
               search=tried, rejected=reasons_out, method=METHOD, source=SOURCE)
    if len(used) < MIN_COMPS:
        why = [f"{len(used)} usable, current comp{'s' if len(used) != 1 else ''} on the {unit} basis within "
               f"{chosen['radius_km']:g} km; at least {MIN_COMPS} are needed."]
        if out["n_stale"]:
            why.append(f"{out['n_stale']} more are older than {max_age_years:g} years and are not used for a current value.")
        if subject.get("market") == "Houston":
            why.append("Texas does not disclose sale prices, so most Houston sales in the kit have no price.")
        return {**out, "status": "insufficient_evidence", "estimate": None, "reasons": why}
    vals = [c["per_sf"] if basis == "sf" else c["land_per_acre"] for c in used]
    w = [max(c["similarity"], 1.0) for c in used]
    q1, med, q3 = quartiles(vals)
    est = dict(median=round(med, 2), weighted_mean=round(sum(v * x for v, x in zip(vals, w)) / sum(w), 2),
               p25=round(q1, 2), p75=round(q3, 2), n=len(used), unit=unit)
    return {**out, "status": "ok", "estimate": est, "reasons": []}


def _subject(parcel_id: str) -> dict:
    with session() as c:
        p = c.execute("SELECT parcel_id, name, address, city, lat, lon, market, submarket_id, property_type, lot_acres, "
                      "building_sf, asking_price_low, asking_price_high, last_sale_price, last_sale_status, last_sale_date "
                      "FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not p:
        raise UnknownParcel(parcel_id)
    return dict(p)


def _rows(market: str | None) -> list[dict]:
    with session() as c:
        return [dict(r) for r in c.execute("SELECT * FROM sale_comps WHERE market = ?", (market,))]


def find_comps(parcel_id: str, *, basis: Basis | None = None, radius_km: float | None = None,
               max_age_years: float = DEFAULT_MAX_AGE, exclude: list[int] | None = None, size_band: bool = True,
               today: date | None = None) -> dict[str, Any]:
    """Comps for a parcel, scored and filtered, with the estimate on the chosen basis. Raises UnknownParcel."""
    ensure_built()
    s = _subject(parcel_id)
    if s["lat"] is None or s["lon"] is None:
        return dict(status="insufficient_evidence", estimate=None, comps=[], basis=basis or pick_basis(s),
                    reasons=["This CoStar record has no coordinates, so nearby comps cannot be found."], source=SOURCE,
                    subject=_subject_view(s))
    r = evaluate(s, _rows(s["market"]), basis=basis, radius_km=radius_km, max_age_years=max_age_years,
                 exclude=exclude, size_band=size_band, today=today)
    return {**r, "subject": _subject_view(s)}


def _subject_view(s: dict) -> dict:
    return {k: s.get(k) for k in ("parcel_id", "name", "address", "city", "market", "submarket_id", "property_type",
                                  "lot_acres", "building_sf", "lat", "lon", "asking_price_low", "asking_price_high",
                                  "last_sale_price", "last_sale_status", "last_sale_date")}


def _clip(t: str, n: int) -> str:
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"


def _usd(n: float) -> str:
    return f"${n / 1e9:.2f}B" if n >= 1e9 else f"${n / 1e6:.1f}M" if n >= 1e6 else f"${n / 1e3:.0f}K"


def valuation(parcel_id: str, **opts: Any) -> dict[str, Any]:
    """Indicative value of the subject (per-unit value x its size) and an `underwriting` block for the Studio."""
    r = find_comps(parcel_id, **opts)
    s, est = r["subject"], r.get("estimate")
    size = (s.get("building_sf") if r["basis"] == "sf" else s.get("lot_acres")) or None
    size_unit = "SF of building" if r["basis"] == "sf" else "acres"
    value = None
    if est and size:
        value = dict(value=round(est["median"] * size), low=round(est["p25"] * size), high=round(est["p75"] * size),
                     weighted=round(est["weighted_mean"] * size), size=size, size_unit=size_unit, n=est["n"])
    if value:
        what = "land and building" if r["basis"] == "sf" else "land only"
        per = f"${est['median']:,.0f}/SF" if r["basis"] == "sf" else f"${est['median']:,.0f}/acre"
        basis_text = (f"Median {per} x {size:,.0f} {'SF' if r['basis'] == 'sf' else 'acres'} from {est['n']} CoStar sale comps "
                      f"within {r['radius_km']:g} km, last {r['max_age_years']:g} yrs; P25-P75 {_usd(value['low'])}-{_usd(value['high'])}. "
                      f"Nominal, {what}.")
        uw = dict(acquisition_value=value["value"], low=value["low"], high=value["high"], label="Estimated",
                  basis_text=basis_text)
    else:
        why = r.get("reasons") or (["The parcel has no " + size_unit + " in CoStar."] if est else [])
        uw = dict(acquisition_value=None, low=None, high=None, label="Unknown",
                  basis_text=_clip("No comps-based value: " + " ".join(why), 200))
    return {**r, "value": value, "underwriting": uw}


def scenario(parcel_id: str, price_change_pct: float, **opts: Any) -> dict[str, Any]:
    """What-if on the acquisition price: the comps value moved by `price_change_pct`. The copilot reruns the engine."""
    v = valuation(parcel_id, **opts)
    uw = v["underwriting"]
    if uw["acquisition_value"] is None:
        return dict(parcel_id=parcel_id, price_change_pct=price_change_pct, base=None, acquisition_value=None,
                    label="Unknown", basis_text=uw["basis_text"])
    f = 1 + price_change_pct / 100.0
    return dict(parcel_id=parcel_id, price_change_pct=price_change_pct, base=uw["acquisition_value"],
                acquisition_value=round(uw["acquisition_value"] * f), low=round(uw["low"] * f), high=round(uw["high"] * f),
                label="Estimated", basis_text=f"{uw['basis_text'][:178]} Scenario {price_change_pct:+g}%.")
