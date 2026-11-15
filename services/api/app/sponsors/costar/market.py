"""Submarket and market context from the CoStar Data Extract.

The kit holds the properties on CoStar's Matterport capture list in Houston and Los Angeles (3,339 commercial
properties), not each market's full inventory. Every count here is "in the kit sample" and every statistic carries
its n. Submarket names are not in the kit (concepts/geography-and-markets.md), so a submarket is labelled by its id and
the cities most common inside it. Prices are nominal.
"""
from __future__ import annotations

import statistics
from collections import Counter
from datetime import date
from typing import Any

from app.db import session
from app.sponsors.costar.comps import SOURCE as COMPS_SOURCE, ensure_built
from app.sponsors.costar.valuation import UnknownParcel, quartiles

PROPS_SOURCE = "CoStar Data Extract, data/commercial-property.jsonl (+ listing summary for availability and asking prices)"
SAMPLE_NOTE = ("Counts are of properties in the CoStar hackathon kit (CoStar's Matterport capture list), a sample of "
               "the submarket, not its full inventory.")
LOT_BINS = [(0, 1, "<1 acre"), (1, 5, "1-5 acres"), (5, 10, "5-10 acres"), (10, 25, "10-25 acres"), (25, 1e12, "25+ acres")]
SF_BINS = [(0, 25e3, "<25k SF"), (25e3, 100e3, "25-100k SF"), (100e3, 250e3, "100-250k SF"), (250e3, 1e15, "250k+ SF")]
RECENT_YEARS = 3


def _dist(xs: list[float]) -> dict[str, Any]:
    xs = [x for x in xs if x is not None]
    if not xs:
        return dict(n=0, p25=None, median=None, p75=None, min=None, max=None)
    q1, med, q3 = quartiles(xs)
    return dict(n=len(xs), p25=round(q1, 2), median=round(med, 2), p75=round(q3, 2), min=round(min(xs), 2), max=round(max(xs), 2))


def _bins(xs: list[float], bins: list[tuple[float, float, str]]) -> list[dict[str, Any]]:
    xs = [x for x in xs if x is not None]
    return [dict(label=label, n=sum(1 for x in xs if lo <= x < hi)) for lo, hi, label in bins]


def _asking(p: dict) -> float | None:
    return p.get("asking_price_high") or p.get("asking_price_low")


def _pctile(value: float | None, xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    if value is None or not xs:
        return None
    return round(100.0 * sum(1 for x in xs if x <= value) / len(xs), 1)


def _summarise(props: list[dict], comps: list[dict], today: date) -> dict[str, Any]:
    """Statistics over one group of kit properties and the sale comp rows on them."""
    deals: dict[int, dict] = {}
    for c in comps:  # one transaction per comp id; volume only from individual sales with a disclosed price
        d = deals.setdefault(c["comp_id"], dict(year=(c["sold_date"] or "")[:4] or None, price=None, portfolio=c["n_entities"] > 1))
        if c["price_kind"] == "sold" and c["price"]:
            d["price"] = c["price"]
    by_year: dict[str, dict[str, Any]] = {}
    for d in deals.values():
        if not d["year"]:
            continue
        y = by_year.setdefault(d["year"], dict(year=int(d["year"]), deals=0, priced=0, volume=0))
        y["deals"] += 1
        if d["price"] and not d["portfolio"]:
            y["priced"] += 1
            y["volume"] += d["price"]
    since = f"{today.year - RECENT_YEARS:04d}-{today.month:02d}-{today.day:02d}"
    recent = [c for c in comps if c["usable"] and (c["sold_date"] or "") >= since]
    heavy_known = [p for p in props if p.get("has_heavy_power") is not None]
    asking = [_asking(p) for p in props if _asking(p)]
    asking_acre = [_asking(p) / p["lot_acres"] for p in props if _asking(p) and p.get("lot_acres")]
    avail = Counter(p.get("availability") or "Not listed" for p in props)
    return dict(
        inventory=dict(n=len(props), by_type=dict(Counter(p.get("property_type") or "Unknown" for p in props).most_common()),
                       note=SAMPLE_NOTE),
        availability=dict(n=len(props), counts=dict(avail), available=sum(v for k, v in avail.items() if k != "Not listed")),
        lot_acres=dict(**_dist([p.get("lot_acres") for p in props]), bins=_bins([p.get("lot_acres") for p in props], LOT_BINS)),
        building_sf=dict(**_dist([p.get("building_sf") for p in props]), bins=_bins([p.get("building_sf") for p in props], SF_BINS)),
        asking_price=dict(**_dist(asking), per_acre=_dist(asking_acre)),
        year_built=_dist([p.get("year_built") for p in props]),
        heavy_power=dict(n=len(heavy_known), yes=sum(1 for p in heavy_known if p["has_heavy_power"]),
                         share=round(sum(1 for p in heavy_known if p["has_heavy_power"]) / len(heavy_known), 3) if heavy_known else None),
        transactions=dict(by_year=sorted(by_year.values(), key=lambda y: y["year"]), deals=len(deals),
                          note="One deal per sale comp; volume sums disclosed prices of individual sales only (portfolio "
                               "prices are allocated estimates; Texas does not disclose prices)."),
        recent_sales=dict(years=RECENT_YEARS, n=len(recent), per_sf=_dist([c["per_sf"] for c in recent if c.get("per_sf")]),
                          land_per_acre=_dist([c["land_per_acre"] for c in recent if c.get("land_per_acre")]),
                          note="Usable land, industrial and flex market sales only."),
        freshness=dict(latest_sale=max((c["sold_date"] for c in comps if c["sold_date"]), default=None),
                       latest_listing=max((p["asking_listed_date"] for p in props if p.get("asking_listed_date")), default=None),
                       loaded_at=max((p["loaded_at"] for p in props if p.get("loaded_at")), default=None)),
    )


def _load(market: str, submarket_id: int | None = None) -> tuple[list[dict], list[dict]]:
    ensure_built()
    with session() as c:
        q, args = "SELECT * FROM parcels WHERE market = ?", [market]
        if submarket_id is not None:
            q, args = q + " AND submarket_id = ?", args + [submarket_id]
        props = [dict(r) for r in c.execute(q, args)]
        q2, args2 = "SELECT * FROM sale_comps WHERE market = ?", [market]
        if submarket_id is not None:
            q2, args2 = q2 + " AND submarket_id = ?", args2 + [submarket_id]
        comps = [dict(r) for r in c.execute(q2, args2)]
    return props, comps


def _label(market: str, submarket_id: int | None, props: list[dict]) -> str:
    cities = [c for c, _ in Counter(p.get("city") for p in props if p.get("city")).most_common(2)]
    return f"{market} submarket {submarket_id}" + (f" ({', '.join(cities)})" if cities else "")


def submarket_stats(market: str, submarket_id: int | None, today: date | None = None) -> dict[str, Any]:
    props, comps = _load(market, submarket_id)
    return dict(market=market, submarket_id=submarket_id, label=_label(market, submarket_id, props),
                **_summarise(props, comps, today or date.today()), sources=[PROPS_SOURCE, COMPS_SOURCE])


def market_for_parcel(parcel_id: str, today: date | None = None) -> dict[str, Any]:
    """The subject against its CoStar submarket: the submarket's statistics and the subject's percentiles in them."""
    with session() as c:
        p = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not p:
        raise UnknownParcel(parcel_id)
    p = dict(p)
    stats = submarket_stats(p["market"], p["submarket_id"], today)
    props, _ = _load(p["market"], p["submarket_id"])
    asking = _asking(p)
    subject = dict(parcel_id=parcel_id, name=p.get("name"), address=p.get("address"), property_type=p.get("property_type"),
                   lot_acres=p.get("lot_acres"), building_sf=p.get("building_sf"), asking_price=asking,
                   availability=p.get("availability"), year_built=p.get("year_built"), has_heavy_power=p.get("has_heavy_power"),
                   percentiles=dict(
                       lot_acres=_pctile(p.get("lot_acres"), [x.get("lot_acres") for x in props]),
                       building_sf=_pctile(p.get("building_sf"), [x.get("building_sf") for x in props]),
                       asking_price=_pctile(asking, [_asking(x) for x in props]),
                       asking_per_acre=_pctile(asking / p["lot_acres"] if asking and p.get("lot_acres") else None,
                                               [_asking(x) / x["lot_acres"] for x in props if _asking(x) and x.get("lot_acres")])),
                   percentile_note="Share of kit properties in the submarket at or below the subject (n in the submarket stats).")
    return dict(subject=subject, submarket=stats)


def _row(market: str, submarket_id: int | None, props: list[dict], comps: list[dict], today: date) -> dict[str, Any]:
    s = _summarise(props, comps, today)
    return dict(market=market, submarket_id=submarket_id, label=_label(market, submarket_id, props) if submarket_id is not None else market,
                properties=s["inventory"]["n"], available=s["availability"]["available"],
                industrial_flex_land=sum(v for k, v in s["inventory"]["by_type"].items() if k in ("Industrial", "Flex", "Land")),
                median_lot_acres=s["lot_acres"]["median"], median_building_sf=s["building_sf"]["median"],
                median_asking_price=s["asking_price"]["median"], asking_n=s["asking_price"]["n"],
                heavy_power_share=s["heavy_power"]["share"], deals=s["transactions"]["deals"],
                recent_sales=s["recent_sales"]["n"], recent_median_per_sf=s["recent_sales"]["per_sf"]["median"],
                recent_per_sf_n=s["recent_sales"]["per_sf"]["n"], latest_sale=s["freshness"]["latest_sale"])


def compare_submarkets(market: str, today: date | None = None, min_properties: int = 1) -> dict[str, Any]:
    today = today or date.today()
    props, comps = _load(market)
    rows = []
    for sid in sorted({p["submarket_id"] for p in props if p.get("submarket_id") is not None}):
        sp = [p for p in props if p.get("submarket_id") == sid]
        if len(sp) >= min_properties:
            rows.append(_row(market, sid, sp, [c for c in comps if c.get("submarket_id") == sid], today))
    rows.sort(key=lambda r: -r["properties"])
    return dict(market=market, rows=rows, note=SAMPLE_NOTE, sources=[PROPS_SOURCE, COMPS_SOURCE])


def compare_markets(today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    rows = []
    for m in ("Houston", "Los Angeles"):
        props, comps = _load(m)
        rows.append(_row(m, None, props, comps, today))
    return dict(rows=rows, note=SAMPLE_NOTE, sources=[PROPS_SOURCE, COMPS_SOURCE])
