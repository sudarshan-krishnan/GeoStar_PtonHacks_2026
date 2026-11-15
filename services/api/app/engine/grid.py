"""ERCOT grid day: hourly day-ahead prices (Sourced) and an hourly carbon proxy from the fuel mix (Estimated).

Sources (public, no key):
  - Day-Ahead Market Settlement Point Prices, report 12331, hub HB_HOUSTON (ERCOT MIS public reports)
  - Fuel mix dashboard feed (5-minute generation by fuel), aggregated to hourly shares

Everything is cached in `evidence_cache` with the document id / date and retrieval time, so the demo runs
offline after one fetch. If nothing has ever been fetched, a clearly labeled Simulated day is returned.
"""
from __future__ import annotations

import csv
import io
import zipfile
from typing import Any

import httpx

from app.engine.external import USER_AGENT, _cached, _store

ERCOT_LIST = "https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=12331"
ERCOT_DL = "https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={doc_id}"
FUEL_MIX = "https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json"
HUB = "HB_HOUSTON"

# kg CO2 per MWh generated, by ERCOT fuel category. Team values in the range of EPA eGRID / IPCC combustion
# factors; verify before the pitch. Zero-carbon sources are 0 by definition of the proxy (no lifecycle).
FUEL_FACTORS = {"Coal and Lignite": 1000.0, "Natural Gas": 430.0, "Other": 600.0,
                "Nuclear": 0.0, "Wind": 0.0, "Solar": 0.0, "Hydro": 0.0}

# Fallback only: a representative ERCOT shape (overnight trough, evening peak). Simulated.
SIM_PRICE = [26, 24, 23, 23, 24, 28, 36, 42, 38, 34, 33, 35, 38, 42, 48, 58, 74, 96, 88, 62, 46, 38, 32, 28]
SIM_CARBON = [380, 370, 360, 355, 360, 390, 420, 440, 400, 350, 320, 300, 290, 300, 330, 380, 430, 470, 480, 460, 440, 420, 400, 390]


def _dam_docs() -> list[dict[str, Any]]:
    lst = httpx.get(ERCOT_LIST, timeout=30, headers={"User-Agent": USER_AGENT}).json()
    docs = [d["Document"] for d in lst.get("ListDocsByRptTypeRes", {}).get("DocumentList", [])]
    return [d for d in docs if "csv" in d.get("FriendlyName", "").lower()]


def _dam_doc(doc: dict[str, Any], hub: str) -> dict[str, Any] | None:
    z = httpx.get(ERCOT_DL.format(doc_id=doc["DocID"]), timeout=60, headers={"User-Agent": USER_AGENT})
    z.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(z.content))
    rows = list(csv.DictReader(io.TextIOWrapper(zf.open(zf.namelist()[0]), encoding="utf-8")))
    hub_rows = [r for r in rows if r.get("SettlementPoint") == hub and r.get("DSTFlag", "N") == "N"]
    if len(hub_rows) < 24:
        return None
    hub_rows.sort(key=lambda r: int(r["HourEnding"].split(":")[0]))
    prices = [float(r["SettlementPointPrice"]) for r in hub_rows[:24]]
    return {"date": hub_rows[0]["DeliveryDate"], "hub": hub, "prices": prices,
            "doc_id": doc["DocID"], "published": doc.get("PublishDate")}


def _fetch_dam(hub: str) -> dict[str, Any] | None:
    try:
        csvs = _dam_docs()
        return _dam_doc(csvs[0], hub) if csvs else None
    except (httpx.HTTPError, ValueError, KeyError, zipfile.BadZipFile, IndexError):
        return None


def dam_days(n: int = 7, hub: str = HUB, *, offline: bool = False) -> dict[str, Any] | None:
    """The most recent delivery days of day-ahead prices (up to n). Days already cached are not downloaded again."""
    key = f"ercot-dam:{hub}:days"
    hit = _cached(key)
    if offline:
        return hit
    have = {d["doc_id"]: d for d in (hit["payload"]["days"] if hit else [])}
    try:
        docs = _dam_docs()[:n]
    except (httpx.HTTPError, ValueError, KeyError):
        return hit
    days, changed = [], False
    for doc in docs:
        if doc["DocID"] in have:
            days.append(have[doc["DocID"]])
            continue
        try:
            day = _dam_doc(doc, hub)
        except (httpx.HTTPError, ValueError, KeyError, zipfile.BadZipFile, IndexError):
            day = None
        if day:
            days.append(day)
            changed = True
    if not days or not changed:
        return hit
    days.sort(key=lambda d: d["date"][6:] + d["date"][:5])  # MM/DD/YYYY -> sortable
    return _store(key, "ERCOT Day-Ahead Market Settlement Point Prices (report 12331)", ERCOT_LIST, {"hub": hub, "days": days})


def day_ahead_prices(hub: str = HUB, *, offline: bool = False) -> dict[str, Any] | None:
    key = f"ercot-dam:{hub}:latest"
    hit = _cached(key)
    if offline:
        return hit
    fresh = _fetch_dam(hub)
    if fresh is None:
        return hit
    if hit and hit["payload"].get("doc_id") == fresh["doc_id"]:
        return hit
    return _store(key, "ERCOT Day-Ahead Market Settlement Point Prices (report 12331)", ERCOT_LIST, fresh)


def _fetch_fuel_mix() -> dict[str, Any] | None:
    try:
        body = httpx.get(FUEL_MIX, timeout=30, headers={"User-Agent": USER_AGENT}).json()
    except (httpx.HTTPError, ValueError):
        return None
    data = body.get("data", {})
    # choose the most recent day with samples in all 24 hours
    for day in sorted(data.keys(), reverse=True):
        hours: dict[int, dict[str, list[float]]] = {}
        for ts, fuels in data[day].items():
            h = int(ts[11:13])
            bucket = hours.setdefault(h, {})
            for fuel, val in fuels.items():
                if fuel in FUEL_FACTORS:
                    bucket.setdefault(fuel, []).append(float(val.get("gen", 0.0)))
        if len(hours) < 24:
            continue
        mix, carbon = [], []
        for h in range(24):
            avg = {f: sum(vs) / len(vs) for f, vs in hours[h].items()}
            total = sum(max(0.0, x) for x in avg.values()) or 1.0
            shares = {f: round(max(0.0, x) / total, 4) for f, x in avg.items()}
            kg = sum(max(0.0, avg[f]) * FUEL_FACTORS[f] for f in avg) / total
            mix.append(shares)
            carbon.append(round(kg, 1))
        return {"date": day, "mix": mix, "carbon_kg_per_mwh": carbon, "last_updated": body.get("lastUpdated"),
                "factors": FUEL_FACTORS}
    return None


def fuel_mix_day(*, offline: bool = False) -> dict[str, Any] | None:
    key = "ercot-fuelmix:latest"
    hit = _cached(key)
    if offline:
        return hit
    fresh = _fetch_fuel_mix()
    if fresh is None:
        return hit
    if hit and hit["payload"].get("date") == fresh["date"]:
        return hit
    return _store(key, "ERCOT fuel mix dashboard (5-minute generation by fuel) x fuel emission factors", FUEL_MIX, fresh)


def grid_day(*, offline: bool = False) -> dict[str, Any]:
    dam = day_ahead_prices(offline=offline)
    fm = fuel_mix_day(offline=offline)
    out: dict[str, Any] = {}
    if dam:
        out.update(price=dam["payload"]["prices"], price_label="Sourced", price_date=dam["payload"]["date"],
                   price_source=f"{dam['source']} doc {dam['payload']['doc_id']}, retrieved {dam['retrieved_at']}")
    else:
        out.update(price=SIM_PRICE, price_label="Simulated", price_date=None,
                   price_source="Representative ERCOT day shape (no fetch yet)")
    if fm:
        out.update(carbon=fm["payload"]["carbon_kg_per_mwh"], mix=fm["payload"]["mix"], carbon_label="Estimated",
                   carbon_date=fm["payload"]["date"],
                   carbon_source=f"{fm['source']}, retrieved {fm['retrieved_at']}")
    else:
        out.update(carbon=SIM_CARBON, mix=None, carbon_label="Simulated", carbon_date=None,
                   carbon_source="Representative shape (no fetch yet)")
    out["hub"] = HUB
    out["notes"] = ["Wholesale day-ahead prices are not a retail tariff.",
                    "Hourly carbon is fuel mix x fuel factors (team values), not a measurement."]
    return out
