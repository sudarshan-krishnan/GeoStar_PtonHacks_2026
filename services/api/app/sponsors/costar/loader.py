"""CoStar Data Extract -> normalized parcel table (PRD S-1).

Reads the extracted kit (outside the repo, treated as untrusted data: JSON is parsed, nothing is executed)
and writes `parcels`, `matterport_models` and `ingest_runs` into the SQLite evidence store.

Every parcel keeps provenance: the source file and 1-based line number of the property record, plus the
source rows of the listing and sale comp that supplied its prices. Values that are not in the extract are
stored as NULL and surface as Unknown; nothing is invented.

Run:  python -m app.sponsors.costar.loader
"""
from __future__ import annotations

import csv
import json
import sqlite3
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.config import COSTAR_KIT_DIR
from app.db import connect

SQFT_PER_ACRE = 43_560.0
MARKETS = {14: "Houston", 20: "Los Angeles"}
# Property types considered as data-center site candidates (land and industrial-class buildings).
CANDIDATE_TYPES = {"Industrial", "Land", "Flex"}

PROPERTY_FILE = "data/commercial-property.jsonl"
LISTING_FILE = "data/commercial-listing-summary.jsonl"
SALE_FILE = "data/commercial-sale-comp.jsonl"
MATTERPORT_CSV = "commercial-properties.csv"
RESIDENTIAL_FILE = "data/residential-listings.jsonl"
ENUMS_FILE = "schemas/enums.json"

SCHEMA = """
DROP TABLE IF EXISTS parcels;
DROP TABLE IF EXISTS matterport_models;
DROP TABLE IF EXISTS ingest_runs;

CREATE TABLE ingest_runs (
    dataset      TEXT PRIMARY KEY,
    source_file  TEXT NOT NULL,
    rows_read    INTEGER NOT NULL,
    file_bytes   INTEGER NOT NULL,
    file_mtime   TEXT NOT NULL,
    loaded_at    TEXT NOT NULL
);

CREATE TABLE parcels (
    parcel_id            TEXT PRIMARY KEY,         -- "costar:<PropertyId>"
    costar_property_id   INTEGER NOT NULL UNIQUE,
    source_file          TEXT NOT NULL,
    source_row           INTEGER NOT NULL,
    loaded_at            TEXT NOT NULL,

    name                 TEXT,
    building_park        TEXT,
    address              TEXT,
    city                 TEXT,
    state                TEXT,
    postcode             TEXT,
    lat                  REAL,
    lon                  REAL,
    market               TEXT,
    market_id            INTEGER,
    submarket_id         INTEGER,
    county_id            INTEGER,

    property_type        TEXT,
    property_subtype     TEXT,
    building_class       TEXT,
    construction_status  TEXT,
    year_built           INTEGER,
    stories              INTEGER,
    building_sf          REAL,
    lot_size_raw         REAL,
    lot_size_unit        TEXT,
    lot_acres            REAL,
    zoning               TEXT,

    has_heavy_power      INTEGER,                  -- 1 yes, 0 known no, NULL unknown
    amps_low             INTEGER,
    amps_high            INTEGER,
    volts_low            INTEGER,
    volts_high           INTEGER,
    ceiling_height_ft    REAL,
    has_rail             INTEGER,
    leed_certified       INTEGER,

    availability         TEXT,                     -- For sale | For lease | For sale and lease | Not listed
    asking_price_low     INTEGER,
    asking_price_high    INTEGER,
    asking_listing_id    INTEGER,
    asking_source_row    INTEGER,
    asking_listed_date   TEXT,

    last_sale_price      INTEGER,
    last_sale_status     TEXT,
    last_sale_date       TEXT,
    last_sale_comp_id    INTEGER,
    last_sale_is_portfolio INTEGER,
    last_sale_source_row INTEGER,

    photo_url            TEXT,
    matterport_count     INTEGER NOT NULL DEFAULT 0,
    dc_candidate         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_parcels_market ON parcels(market);
CREATE INDEX idx_parcels_candidate ON parcels(dc_candidate, market);

DROP TABLE IF EXISTS homes;
CREATE TABLE homes (                               -- residential locations for the proximity gate
    kind         TEXT NOT NULL,                    -- 'apartment community' | 'home listing'
    ref_id       INTEGER NOT NULL,
    name         TEXT,
    lat          REAL NOT NULL,
    lon          REAL NOT NULL,
    source_file  TEXT NOT NULL,
    source_row   INTEGER NOT NULL
);

CREATE TABLE matterport_models (
    costar_property_id  INTEGER NOT NULL,
    model_id            TEXT NOT NULL,
    source_file         TEXT NOT NULL,
    source_row          INTEGER NOT NULL,
    PRIMARY KEY (costar_property_id, model_id)
);
"""


@dataclass
class Enums:
    raw: dict[str, dict[str, str]]

    def name(self, enum: str, value: Any) -> str | None:
        if value is None:
            return None
        n = self.raw.get(enum, {}).get(str(value))
        return None if n in (None, "Unknown") else n


def _iter_jsonl(path: Path) -> Iterator[tuple[int, dict]]:
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            if line.strip():
                yield lineno, json.loads(line)


def _file_meta(path: Path) -> tuple[int, str]:
    st = path.stat()
    return st.st_size, datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()


def _lot_acres(size: float | None, unit: int | None) -> float | None:
    if size is None or size <= 0:
        return None
    if unit == 2:  # Acres
        return float(size)
    if unit == 1:  # SquareFeet
        return float(size) / SQFT_PER_ACRE
    return None  # unknown unit: do not guess


def _address(a: dict) -> str | None:
    parts = [a.get("streetNumber"), a.get("streetName"), a.get("streetType")]
    street = " ".join(p for p in parts if p)
    return street or None


def _year_built(rec: dict) -> int | None:
    years = [e.get("year") for e in rec.get("constructionEvents") or [] if e.get("eventType") == 2 and e.get("year")]
    return max(years) if years else None


def _tri(v: Any) -> int | None:
    return None if v is None else int(bool(v))


def load_listings(kit: Path) -> tuple[dict[int, dict], int]:
    """Best active listing per property: prefer an active for-sale listing with an asking price."""
    best: dict[int, dict] = {}
    kinds: dict[int, set[str]] = defaultdict(set)
    n = 0
    for row, rec in _iter_jsonl(kit / LISTING_FILE):
        n += 1
        pid = rec.get("propertyId")
        if not pid or rec.get("listingStatus") != 1:  # Active only
            continue
        if rec.get("forLeaseSummary"):
            kinds[pid].add("lease")
        fs = rec.get("forSaleSummary")
        if not fs:
            continue
        kinds[pid].add("sale")
        lo, hi = fs.get("askingPriceLow"), fs.get("askingPriceHigh")
        if (rec.get("monetaryUnit") or 1) != 1:  # non-USD or unknown currency: keep the listing, drop the price
            lo = hi = None
        cand = {
            "asking_price_low": lo or None,
            "asking_price_high": hi or None,
            "asking_listing_id": rec["id"],
            "asking_source_row": row,
            "asking_listed_date": (fs.get("minDateOnMarket") or "")[:10] or None,
        }
        cur = best.get(pid)
        if cur is None or (cur["asking_price_low"] is None and cand["asking_price_low"] is not None):
            best[pid] = cand
    for pid, k in kinds.items():
        avail = "For sale and lease" if k == {"sale", "lease"} else ("For sale" if "sale" in k else "For lease")
        best.setdefault(pid, {})["availability"] = avail
    return best, n


def load_sales(kit: Path, enums: Enums) -> tuple[dict[int, dict], int]:
    """Most recent priced sale per property. Portfolio sales use the entity's allocated price when present."""
    latest: dict[int, dict] = {}
    n = 0
    for row, rec in _iter_jsonl(kit / SALE_FILE):
        n += 1
        if (rec.get("monetaryUnit") or 1) != 1:
            continue
        entities = rec.get("entities") or []
        portfolio = len(entities) > 1
        date = (rec.get("soldDate") or "")[:10] or None
        for ent in entities:
            pid = ent.get("propertyId")
            if not pid:
                continue
            if portfolio:
                price, status = ent.get("allocatedPrice"), enums.name("SalePriceStatus", ent.get("allocatedPriceStatus"))
            else:
                price, status = rec.get("soldForPrice"), enums.name("SalePriceStatus", rec.get("salePriceStatus"))
            if not price:
                continue
            cur = latest.get(pid)
            if cur is None or (date or "") > (cur["last_sale_date"] or ""):
                latest[pid] = {
                    "last_sale_price": int(price),
                    "last_sale_status": status or "Unknown",
                    "last_sale_date": date,
                    "last_sale_comp_id": rec["id"],
                    "last_sale_is_portfolio": int(portfolio),
                    "last_sale_source_row": row,
                }
    return latest, n


def load_matterport(kit: Path) -> tuple[list[tuple[int, str, str, int]], int]:
    rows = []
    n = 0
    with (kit / MATTERPORT_CSV).open(encoding="utf-8", newline="") as fh:
        for i, r in enumerate(csv.DictReader(fh), start=2):  # header is line 1
            n += 1
            if r.get("MatterportModelId"):
                rows.append((int(r["PropertyId"]), r["MatterportModelId"], MATTERPORT_CSV, i))
    return rows, n


def build(kit: Path = COSTAR_KIT_DIR, conn: sqlite3.Connection | None = None) -> dict[str, int]:
    if not (kit / PROPERTY_FILE).exists():
        raise FileNotFoundError(f"CoStar kit not found at {kit}. Set COSTAR_KIT_DIR in .env.")
    t0 = time.time()
    enums = Enums(json.loads((kit / ENUMS_FILE).read_text(encoding="utf-8")))
    loaded_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    listings, n_listings = load_listings(kit)
    sales, n_sales = load_sales(kit, enums)
    mp_rows, n_mp = load_matterport(kit)
    mp_count: dict[int, int] = defaultdict(int)
    for pid, *_ in mp_rows:
        mp_count[pid] += 1

    own = conn is None
    conn = conn or connect()
    conn.executescript(SCHEMA)

    parcels = []
    n_props = 0
    for row, rec in _iter_jsonl(kit / PROPERTY_FILE):
        n_props += 1
        pid = rec["id"]
        a = rec.get("primaryAddress") or {}
        ptype = enums.name("PropertyType", rec.get("propertyType"))
        sub = rec.get("propertyIndustrial") or rec.get("propertyFlex") or {}
        elec = sub.get("electric") or {}
        struct = sub.get("structural") or {}
        unit_code = rec.get("lotSizeMeasurementType")
        lst = listings.get(pid, {})
        sale = sales.get(pid, {})
        zoning = (rec.get("zoningDescription") or "").strip() or None
        parcels.append({
            "parcel_id": f"costar:{pid}",
            "costar_property_id": pid,
            "source_file": PROPERTY_FILE,
            "source_row": row,
            "loaded_at": loaded_at,
            "name": rec.get("buildingName"),
            "building_park": rec.get("buildingPark"),
            "address": _address(a),
            "city": a.get("city"),
            "state": a.get("state"),
            "postcode": a.get("postcode"),
            "lat": a.get("latitude"),
            "lon": a.get("longitude"),
            "market": MARKETS.get(a.get("researchMarketId")),
            "market_id": a.get("researchMarketId"),
            "submarket_id": rec.get("primarySubmarketId"),
            "county_id": a.get("countyId"),
            "property_type": ptype,
            "property_subtype": enums.name("PropertySubtype", rec.get("propertySubtype")),
            "building_class": enums.name("BuildingClass", rec.get("buildingClass")),
            "construction_status": enums.name("ConstructionStatus", rec.get("constructionStatus")),
            "year_built": _year_built(rec),
            "stories": rec.get("numStoriesAboveGrade"),
            "building_sf": rec.get("grossBuildingAreaSquareFeet"),
            "lot_size_raw": rec.get("lotSize"),
            "lot_size_unit": {1: "sqft", 2: "acres", 3: "sqm"}.get(unit_code),
            "lot_acres": _lot_acres(rec.get("lotSize"), unit_code),
            "zoning": zoning,
            "has_heavy_power": _tri(elec.get("hasHeavyPower")),
            "amps_low": elec.get("ampsLow"),
            "amps_high": elec.get("ampsHigh"),
            "volts_low": elec.get("voltsLow"),
            "volts_high": elec.get("voltsHigh"),
            "ceiling_height_ft": struct.get("ceilingHeightFeet"),
            "has_rail": int(bool(sub.get("railAccess"))) if sub else None,
            "leed_certified": int(bool((rec.get("environmental") or {}).get("leedCertifications"))),
            "availability": lst.get("availability", "Not listed"),
            "asking_price_low": lst.get("asking_price_low"),
            "asking_price_high": lst.get("asking_price_high"),
            "asking_listing_id": lst.get("asking_listing_id"),
            "asking_source_row": lst.get("asking_source_row"),
            "asking_listed_date": lst.get("asking_listed_date"),
            **{k: sale.get(k) for k in (
                "last_sale_price", "last_sale_status", "last_sale_date",
                "last_sale_comp_id", "last_sale_is_portfolio", "last_sale_source_row")},
            "photo_url": (rec.get("primaryPhoto") or {}).get("attachmentUri"),
            "matterport_count": mp_count.get(pid, 0),
            "dc_candidate": int(ptype in CANDIDATE_TYPES),
        })

    # Residential locations: CoStar multifamily communities + MLS home listings (both carry coordinates).
    homes = [
        ("apartment community", p["costar_property_id"], p["name"], p["lat"], p["lon"], PROPERTY_FILE, p["source_row"])
        for p in parcels
        if p["property_type"] == "Multifamily" and p["lat"] is not None and p["lon"] is not None
    ]
    n_res = 0
    res_path = kit / RESIDENTIAL_FILE
    if res_path.exists():
        for row, rec in _iter_jsonl(res_path):
            n_res += 1
            a = (rec.get("property") or {}).get("address") or {}
            if a.get("latitude") is not None and a.get("longitude") is not None:
                homes.append(("home listing", rec["id"], a.get("fullStreetAddress"), a["latitude"], a["longitude"],
                              RESIDENTIAL_FILE, row))
    conn.executemany("INSERT INTO homes VALUES (?,?,?,?,?,?,?)", homes)

    cols = list(parcels[0].keys())
    conn.executemany(
        f"INSERT INTO parcels ({','.join(cols)}) VALUES ({','.join(':' + c for c in cols)})", parcels
    )
    conn.executemany("INSERT OR IGNORE INTO matterport_models VALUES (?,?,?,?)", mp_rows)

    for dataset, rel, n in (
        ("commercial-property", PROPERTY_FILE, n_props),
        ("commercial-listing-summary", LISTING_FILE, n_listings),
        ("commercial-sale-comp", SALE_FILE, n_sales),
        ("matterport-starter-csv", MATTERPORT_CSV, n_mp),
        ("residential-listings", RESIDENTIAL_FILE, n_res),
    ):
        if not (kit / rel).exists():
            continue
        size, mtime = _file_meta(kit / rel)
        conn.execute("INSERT INTO ingest_runs VALUES (?,?,?,?,?,?)", (dataset, rel, n, size, mtime, loaded_at))
    conn.commit()

    stats = {
        "properties": n_props,
        "listings_read": n_listings,
        "sale_comps_read": n_sales,
        "matterport_rows": len(mp_rows),
        "candidates": sum(p["dc_candidate"] for p in parcels),
        "with_asking_price": sum(1 for p in parcels if p["asking_price_low"]),
        "with_sale_price": sum(1 for p in parcels if p["last_sale_price"]),
        "home_locations": len(homes),
        "seconds": round(time.time() - t0, 1),
    }
    if own:
        conn.close()
    return stats


if __name__ == "__main__":
    kit = Path(sys.argv[1]) if len(sys.argv) > 1 else COSTAR_KIT_DIR
    for k, v in build(kit).items():
        print(f"{k:>20}: {v}")
