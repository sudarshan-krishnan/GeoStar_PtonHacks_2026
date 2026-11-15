"""CoStar sale comps: the `sale_comps` table that valuation.py and market.py read.

Builds `sale_comps` from data/commercial-sale-comp.jsonl, one row per kit property in a sale. Semantics follow the kit's own guidance (models/commercial-sale-comp.md,
concepts/sale-comps-and-pricing.md):

- Grain: a comp is one transaction; `entities[]` are the properties in it. We store one row per entity whose property
  is in the kit (only those have a location and lot size). Valuation uses individual sales only: a portfolio price is
  an allocated estimate and is never divided by one property's size.
- Price confidence: `soldForPrice` always travels with `salePriceStatus`. Trusted by default: Confirmed, Affidavit,
  Declaration. FullValue, Unconfirmed and Approximate are used only when too few trusted comps exist, and the result
  says so.
- Not usable as a market comp, with the reason recorded: non-USD, no price, portfolio, condo or rumoured asset, any
  below-market sale reason (not a market sale), and conditions that break comparability (distress, 1031 exchange,
  partial interest, ground lease, sale-leaseback, business value included, REO, short sale, bankruptcy, court sale).
- Land, not buildings: a land sale (`isLandValueSale` or a Land property) gives land $/acre = price / lot acres. An
  improved Industrial/Flex sale includes its building, so its land share is taken from the assessor's land / total
  value on the same comp (market assessment when present, else assessed value) and land $/acre = price x share /
  lot acres. Both the land and the all-in $/acre are kept, plus $/SF of building for improved property (price /
  CoStar gross building area). Values are nominal: the kit has no price index, so nothing is time-adjusted.

Run:  python -m app.costar.comps
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from ..config import COSTAR_KIT_DIR
from ..db import connect, db_ready, session
from .loader import ENUMS_FILE, SALE_FILE, Enums, _file_meta, _iter_jsonl

# Property types relevant to a data center site (the loader's candidate types).
SITE_TYPES = ("Land", "Industrial", "Flex")
TRUSTED = ("Confirmed", "Affidavit", "Declaration")
FALLBACK = ("FullValue", "Unconfirmed", "Approximate")
# SaleCondition codes that make a sale non-comparable for land valuation (enum names in schemas/enums.json).
EXCLUDE_CONDITIONS = {1: "DistressSale", 2: "TenThreeOneExchange", 3: "SaleLeaseback", 4: "GroundLeaseLeasehold",
                      5: "GroundLeaseLeasedFee", 12: "BulkPortfolioSale", 13: "BusinessValueIncluded",
                      27: "PartialInterestTransfer", 33: "RealEstateOwnedSale", 34: "ShortSale", 36: "CourtAppointedSale",
                      40: "BankruptcySale"}
SOURCE = "CoStar Data Extract, data/commercial-sale-comp.jsonl"

SCHEMA = """
DROP TABLE IF EXISTS sale_comps;
CREATE TABLE sale_comps (
    comp_id          INTEGER NOT NULL,
    entity_id        INTEGER NOT NULL,
    property_id      INTEGER NOT NULL,
    parcel_id        TEXT NOT NULL,
    sold_date        TEXT,
    price            INTEGER,
    price_status     TEXT,
    price_kind       TEXT,          -- 'sold' (soldForPrice) | 'allocated' (entities[].allocatedPrice)
    portfolio_type   TEXT,
    n_entities       INTEGER,
    land_value_sale  INTEGER NOT NULL,
    sale_type        TEXT,
    conditions       TEXT,          -- JSON list of SaleCondition names
    below_market     TEXT,          -- JSON list of BelowMarketSaleReason names
    property_type    TEXT,
    name             TEXT,
    address          TEXT,
    lot_acres        REAL,
    building_sf      REAL,
    lat              REAL,
    lon              REAL,
    market           TEXT,
    submarket_id     INTEGER,
    land_share       REAL,          -- assessor land / total value on the comp
    land_share_basis TEXT,          -- 'market assessment' | 'assessed value' | 'land sale'
    all_in_per_acre  REAL,          -- price / lot acres (building included for improved property)
    land_per_acre    REAL,          -- land-only $ per acre (see module docstring)
    per_sf           REAL,          -- price / building SF, improved property only
    usable           INTEGER NOT NULL,
    reason           TEXT,          -- why it is not usable for land valuation (NULL when usable)
    source_row       INTEGER NOT NULL,
    PRIMARY KEY (comp_id, entity_id)
);
CREATE INDEX idx_comps_market ON sale_comps(market, usable, sold_date);
CREATE INDEX idx_comps_sub ON sale_comps(submarket_id, sold_date);
CREATE INDEX idx_comps_geo ON sale_comps(lat, lon);
CREATE INDEX idx_comps_parcel ON sale_comps(parcel_id);
CREATE TABLE IF NOT EXISTS sale_comps_runs (
    id INTEGER PRIMARY KEY CHECK (id = 1), built_at TEXT NOT NULL, file_bytes INTEGER NOT NULL, file_mtime TEXT NOT NULL,
    comps_read INTEGER NOT NULL, entities_read INTEGER NOT NULL, rows_stored INTEGER NOT NULL, usable_rows INTEGER NOT NULL
);
"""

_lock = threading.Lock()


class StoreMissing(RuntimeError):
    pass


def _share(rec: dict) -> tuple[float | None, str | None]:
    m = rec.get("marketAssessment") or {}
    if (m.get("marketLandValue") or 0) > 0 and (m.get("marketTotalValue") or 0) > 0:
        return min(1.0, m["marketLandValue"] / m["marketTotalValue"]), "market assessment"
    a = rec.get("assessment") or {}
    if (a.get("landValue") or 0) > 0 and (a.get("totalValue") or 0) > 0:
        return min(1.0, a["landValue"] / a["totalValue"]), "assessed value"
    return None, None


def comp_rows(records: Iterable[tuple[int, dict]], enums: Enums, parcels: dict[int, dict]) -> tuple[list[dict], int, int]:
    """Turn sale comp records into sale_comps rows. `parcels` maps property id -> parcel fields. Pure, for tests."""
    out: list[dict] = []
    n_comps = n_ent = 0
    for row, rec in records:
        n_comps += 1
        entities = rec.get("entities") or []
        n_ent += len(entities)
        portfolio = enums.raw.get("PortfolioType", {}).get(str(rec.get("portfolioType", 0)), "Unknown")
        is_portfolio = len(entities) > 1 or portfolio not in ("Individual", "Unknown")
        conds = [int(c) for c in rec.get("saleConditions") or []]
        below = [enums.raw.get("BelowMarketSaleReason", {}).get(str(b), str(b)) for b in rec.get("belowMarketSaleReasons") or []]
        sold = (rec.get("soldDate") or "")[:10] or None
        land_sale = bool(rec.get("isLandValueSale"))
        share, basis = _share(rec)
        for ent in entities:
            pid = ent.get("propertyId")
            p = parcels.get(pid) if pid else None
            if p is None:
                continue  # property outside the kit: no location or lot size to value against
            if is_portfolio:
                price, status, kind = ent.get("allocatedPrice"), enums.name("SalePriceStatus", ent.get("allocatedPriceStatus")), "allocated"
            else:
                price, status, kind = rec.get("soldForPrice"), enums.name("SalePriceStatus", rec.get("salePriceStatus")), "sold"
            ptype = p.get("property_type")
            acres = p.get("lot_acres")
            reason = None
            if (rec.get("monetaryUnit") or 1) != 1:
                reason = "not in US dollars"
            elif not price:
                reason = "no price recorded" + (" (Texas does not disclose sale prices)" if p.get("market") == "Houston" else "")
            elif is_portfolio:
                reason = "portfolio sale (price is an allocated share)"
            elif ent.get("assetType") != 1:
                reason = "condo or rumoured asset, not a whole property"
            elif below:
                reason = "not a market sale: " + ", ".join(below)
            elif any(c in EXCLUDE_CONDITIONS for c in conds):
                reason = "condition of sale: " + ", ".join(EXCLUDE_CONDITIONS[c] for c in conds if c in EXCLUDE_CONDITIONS)
            elif ptype not in SITE_TYPES and not land_sale:
                reason = f"property type {ptype or 'unknown'} is not land, industrial or flex"
            all_in = land = None
            land_basis = None
            if price and acres:
                all_in = price / acres
                if land_sale or ptype == "Land":
                    land, land_basis = price / acres, "land sale"
                elif share is not None:
                    land, land_basis = price * share / acres, basis
            bsf = p.get("building_sf")
            per_sf = price / bsf if price and bsf and bsf > 0 and ptype != "Land" and not land_sale else None
            out.append(dict(
                comp_id=rec["id"], entity_id=ent.get("id") or pid, property_id=pid, parcel_id=f"costar:{pid}",
                sold_date=sold, price=int(price) if price else None, price_status=status or "Unknown", price_kind=kind,
                portfolio_type=portfolio, n_entities=len(entities), land_value_sale=int(land_sale),
                sale_type=enums.raw.get("SaleType", {}).get(str(rec.get("saleType", 0)), "Unknown"),
                conditions=json.dumps([enums.raw.get("SaleCondition", {}).get(str(c), str(c)) for c in conds]),
                below_market=json.dumps(below), property_type=ptype, name=p.get("name"), address=p.get("address"),
                lot_acres=acres, building_sf=p.get("building_sf"), lat=p.get("lat"), lon=p.get("lon"),
                market=p.get("market"), submarket_id=p.get("submarket_id"),
                land_share=share if land_basis in ("market assessment", "assessed value") else (1.0 if land_basis == "land sale" else None),
                land_share_basis=land_basis, all_in_per_acre=all_in, land_per_acre=land, per_sf=per_sf,
                usable=int(reason is None), reason=reason, source_row=row))
    return out, n_comps, n_ent


def build(kit: Path = COSTAR_KIT_DIR) -> dict[str, Any]:
    """Rebuild sale_comps from the kit. Needs the parcel store (python -m app.costar.loader) first."""
    path = kit / SALE_FILE
    if not path.exists():
        raise StoreMissing(f"CoStar sale comps not found at {path}. Set COSTAR_KIT_DIR in .env.")
    if not db_ready():
        raise StoreMissing("Parcel store is empty. Run: python -m app.costar.loader")
    t0 = time.time()
    enums = Enums(json.loads((kit / ENUMS_FILE).read_text(encoding="utf-8")))
    conn = connect()
    try:
        parcels = {r["costar_property_id"]: dict(r) for r in conn.execute(
            "SELECT costar_property_id, name, address, lat, lon, market, submarket_id, property_type, lot_acres, building_sf FROM parcels")}
        rows, n_comps, n_ent = comp_rows(_iter_jsonl(path), enums, parcels)
        conn.executescript(SCHEMA)
        cols = list(rows[0].keys()) if rows else []
        if rows:
            conn.executemany(f"INSERT OR REPLACE INTO sale_comps ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                             [tuple(r[c] for c in cols) for r in rows])
        size, mtime = _file_meta(path)
        usable = sum(r["usable"] for r in rows)
        conn.execute("INSERT OR REPLACE INTO sale_comps_runs VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
                     (datetime.now(timezone.utc).isoformat(timespec="seconds"), size, mtime, n_comps, n_ent, len(rows), usable))
        conn.commit()
    finally:
        conn.close()
    return dict(comps_read=n_comps, entities_read=n_ent, rows_stored=len(rows), usable_rows=usable, seconds=round(time.time() - t0, 1))


def ensure_built(kit: Path = COSTAR_KIT_DIR) -> None:
    """Build once, on first use, and again if the kit file changed."""
    with _lock:
        if not db_ready():
            raise StoreMissing("Parcel store is empty. Run: python -m app.costar.loader")
        path = kit / SALE_FILE
        with session() as c:
            have = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_comps_runs'").fetchone()
            run = c.execute("SELECT file_bytes, file_mtime FROM sale_comps_runs WHERE id = 1").fetchone() if have else None
            table = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_comps'").fetchone()
        if run and table and path.exists() and tuple(run) == _file_meta(path):
            return
        if run and table and not path.exists():
            return  # kit removed after a build: keep serving what was built
        build(kit)


if __name__ == "__main__":
    print(build())
