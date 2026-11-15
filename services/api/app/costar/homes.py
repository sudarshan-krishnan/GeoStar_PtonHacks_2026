"""Community exposure from real CoStar residential records.

Two derived tables, built once from the kit (rebuilt when a source changes):
  home_listings     one row per HOME (Homes.com MLS listings deduplicated by the home's propertyId, keeping the primary,
                    most recent listing). Only listings the public can see (permissionLevels.homes == 10) and not CoStar's
                    placeholder listings (mls.id 800000). No unit numbers, agent or contact data are stored.
  apt_communities   one row per apartment community with an active Apartments.com listing (unit count, units available
                    now, asking rent range), placed at the property's primary address.

community() counts these in distance bands around a site and estimates generator noise at the nearest receptors with
the layout engine's own noise model. Listing counts and apartment unit counts are different things and are never
added together, and neither is a count of households or people: both are a sample of what CoStar records.
Rules from the kit docs: split sales from rentals; Texas does not disclose sale prices (closePrice null on sold Texas
sales), so those are counted as undisclosed, never filled in; a rent of 0 means no rent was given.
"""
from __future__ import annotations

import json
import math
import sqlite3
import statistics
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import config
from .. import layout_engine as L
from ..db import connect, db_ready
from ..screening import haversine_m, load_homes, nearest
from .loader import Enums
from .tenancy import StoreUnavailable, _d, _iter, _meta
from .tenancy import ensure as tenancy_ensure

KIT = config.COSTAR_KIT_DIR
RES_FILE = "data/residential-listings.jsonl"
APT_FILE = "data/apartment-listing.jsonl"
SOURCE = "CoStar Data Extract"
BANDS = [(0, 250), (250, 500), (500, 1000), (1000, 3000)]
PLACEHOLDER_MLS = 800000
_lock = threading.Lock()
HOMES_SCHEMA = 2  # bump when a derived table's columns change

SCHEMA = """
CREATE TABLE IF NOT EXISTS costar_derived (name TEXT PRIMARY KEY, built_at TEXT, sources TEXT, rows INTEGER);
DROP TABLE IF EXISTS home_listings;
CREATE TABLE home_listings (
    home_id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, residential_listing_id INTEGER, transaction_type TEXT,
    status TEXT, sale_status TEXT, rent_status TEXT, current_price REAL, close_price REAL, price_undisclosed INTEGER,
    beds INTEGER, baths REAL, sqft REAL, home_type TEXT, year_built INTEGER, street TEXT, city TEXT, zip TEXT, state TEXT,
    lat REAL NOT NULL, lon REAL NOT NULL, list_date TEXT, close_date TEXT, listings_merged INTEGER, source_row INTEGER NOT NULL);
CREATE INDEX home_listings_ll ON home_listings(lat, lon);
DROP TABLE IF EXISTS apt_communities;
CREATE TABLE apt_communities (
    property_id INTEGER PRIMARY KEY, name TEXT, street TEXT, city TEXT, units INTEGER, units_available INTEGER,
    min_rent REAL, max_rent REAL, lifestyle TEXT, lat REAL NOT NULL, lon REAL NOT NULL, listed INTEGER NOT NULL,
    source_file TEXT NOT NULL, source_row INTEGER NOT NULL);
CREATE INDEX apt_communities_ll ON apt_communities(lat, lon);
"""
SOURCES = (RES_FILE, APT_FILE)


def _street(a: dict) -> str | None:
    """Street address without the unit number (the docs: addresses hidden from the public have no street at all)."""
    parts = [a.get("streetNumber"), a.get("streetDirPrefix"), a.get("streetName"), a.get("streetSuffix"), a.get("streetDirSuffix")]
    s = " ".join(p for p in parts if p)
    return s or None


def build(kit: Path = KIT, conn: sqlite3.Connection | None = None) -> dict[str, int]:
    own = conn is None
    conn = conn or connect()
    conn.row_factory = sqlite3.Row  # name access, whatever connection the caller passed
    e = Enums(json.loads((kit / "schemas/enums.json").read_text(encoding="utf-8")))
    try:
        conn.executescript(SCHEMA)
        best: dict[int, dict] = {}
        merged: dict[int, int] = {}
        skipped = {"not_public": 0, "placeholder": 0, "no_location": 0}
        for row, r in _iter(kit / RES_FILE):
            if (r.get("permissionLevels") or {}).get("homes") != 10:
                skipped["not_public"] += 1
                continue
            if (r.get("mls") or {}).get("id") == PLACEHOLDER_MLS:
                skipped["placeholder"] += 1
                continue
            prop = r.get("property") or {}
            a = prop.get("address") or {}
            if a.get("latitude") is None or a.get("longitude") is None:
                skipped["no_location"] += 1  # includes the listings whose address is hidden from the public
                continue
            hid = r.get("propertyId")
            tt = e.name("TransactionType", r.get("transactionType"))
            status = e.name("ListingStatus2", r.get("listingStatus"))
            sale_status = e.name("ForSaleStatus", r.get("forSaleStatus"))
            close = r.get("closePrice")
            rec = dict(
                home_id=hid, listing_id=r["id"], residential_listing_id=r.get("residentialListingId"), transaction_type=tt,
                status=status, sale_status=sale_status, rent_status=e.name("ForRentStatus", r.get("forRentStatus")),
                current_price=r.get("currentPrice") or None, close_price=close or None,
                # Texas non-disclosure: a sold sale with no close price has an undisclosed price, not a missing one
                price_undisclosed=int(tt == "ForSale" and (status == "Sold" or sale_status in ("Sold", "RecentlyOffMarket"))
                                      and not close and a.get("state") == "TX"),
                beds=prop.get("bedsMax"), baths=prop.get("bathsMax"), sqft=prop.get("sqftMin"),
                home_type=e.name("ListingPropertyType", prop.get("propertyType")), year_built=prop.get("yearBuilt"),
                street=_street(a), city=a.get("city"), zip=a.get("zip"), state=a.get("state"),
                lat=a["latitude"], lon=a["longitude"], list_date=_d(r.get("listDate")), close_date=_d(r.get("closeDate")),
                listings_merged=1, source_row=row, _primary=bool(r.get("isPrimaryForThisListingInstance")))
            merged[hid] = merged.get(hid, 0) + 1
            cur = best.get(hid)
            # one home: keep the primary listing of its most recent attempt to sell or rent
            if cur is None or (rec["_primary"], rec["list_date"] or "") > (cur["_primary"], cur["list_date"] or ""):
                best[hid] = rec
        homes = [{**{k: v for k, v in h.items() if k != "_primary"}, "listings_merged": merged[h["home_id"]]} for h in best.values()]
        if homes:
            conn.executemany(f"INSERT INTO home_listings VALUES ({','.join(':' + k for k in homes[0])})", homes)

        names = {r["costar_property_id"]: r["name"] for r in conn.execute("SELECT costar_property_id, name FROM parcels")}
        apts = []
        for row, r in _iter(kit / APT_FILE):
            a = r.get("address") or {}
            pid = r.get("propertyId")
            if not pid or a.get("latitude") is None or a.get("longitude") is None:
                continue
            apts.append((pid, names.get(pid), " ".join(x for x in (a.get("streetNumber"), a.get("streetName"), a.get("streetType")) if x) or None,
                         a.get("city"), r.get("totalNumUnits"), r.get("numUnitsAvailable"), r.get("minRent") or None,
                         r.get("maxRent") or None, e.name("ApartmentLifestyleType", r.get("lifestyleType")),
                         a["latitude"], a["longitude"], 1, APT_FILE, row))
        # communities with no active Apartments.com listing are still homes nearby: take them from the property records
        listed = {x[0] for x in apts}
        for p in conn.execute("SELECT p.costar_property_id, p.name, p.address, p.city, p.lat, p.lon, p.source_row, x.apt_units "
                              "FROM parcels p LEFT JOIN property_extra x ON x.property_id = p.costar_property_id "
                              "WHERE p.property_type = 'Multifamily' AND p.lat IS NOT NULL AND p.lon IS NOT NULL"):
            if p["costar_property_id"] not in listed:
                apts.append((p["costar_property_id"], p["name"], p["address"], p["city"], p["apt_units"], None, None, None,
                             None, p["lat"], p["lon"], 0, "data/commercial-property.jsonl", p["source_row"]))
        conn.executemany("INSERT OR REPLACE INTO apt_communities VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", apts)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.execute("INSERT OR REPLACE INTO costar_derived VALUES ('homes', ?, ?, ?)", (now, _meta(kit, SOURCES) + f"|v{HOMES_SCHEMA}", len(homes)))
        conn.commit()
        return {"homes": len(homes), "listings_read": sum(merged.values()), **skipped, "apartment_communities": len(apts)}
    finally:
        if own:
            conn.close()


def ensure(kit: Path = KIT) -> None:
    if not db_ready():
        raise StoreUnavailable("Parcel store is empty. Run: python -m app.costar.loader")
    with _lock:
        conn = connect()
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS costar_derived (name TEXT PRIMARY KEY, built_at TEXT, sources TEXT, rows INTEGER)")
            row = conn.execute("SELECT sources FROM costar_derived WHERE name='homes'").fetchone()
            have = all(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()
                       for t in ("home_listings", "apt_communities"))
        finally:
            conn.close()
        if have and row and row["sources"] == _meta(kit, SOURCES) + f"|v{HOMES_SCHEMA}":
            return
        if not (kit / RES_FILE).exists():
            raise StoreUnavailable(f"CoStar kit not found at {kit}")
    tenancy_ensure(kit)  # property_extra (unit counts) comes from the tenancy build
    with _lock:
        build(kit)


# ----------------------------------------------------------------------------------------------------- noise
def noise_model(mw_it: float = 20.0, redundancy: str = "N+1", cooling: str = "liquid", noise_wall: bool = False):
    """The layout engine's generator-noise model (layout_engine.generate, People block), built from the same _Ctx so the
    generator count and constants are the engine's own:  L(d) = src - 20 log10(max(d, 7) / 7),
    src = genset_dba_at_7m + 10 log10(gens_needed) - noise_wall_loss_dba (when a wall stands near the yard)."""
    c = L._Ctx({"mw_it": mw_it, "rack_kw": 20.0, "cooling": cooling, "redundancy": redundancy, "storeys": 1}, {})
    src = c.v("genset_dba_at_7m") + 10 * math.log10(max(1, c.gens_needed)) - (c.v("noise_wall_loss_dba") if noise_wall else 0.0)

    def at(d_m: float) -> float:
        return round(src - 20 * math.log10(max(d_m, 7.0) / 7.0), 1)
    return at, dict(gens_needed=c.gens_needed, limit_dba=c.v("noise_limit_dba"), source_dba_at_7m=round(src, 1))


# ----------------------------------------------------------------------------------------------------- queries
def _box(lat: float, lon: float, r_m: float) -> tuple[float, float, float, float]:
    dlat = r_m / 111_320.0
    dlon = r_m / (111_320.0 * max(0.01, math.cos(math.radians(lat))))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon


def _near(c: sqlite3.Connection, table: str, lat: float, lon: float, r_m: float) -> list[dict]:
    a, b, x, y = _box(lat, lon, r_m)  # indexed bounding-box prefilter, then exact distance
    out = []
    for r in c.execute(f"SELECT * FROM {table} WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", (a, b, x, y)):
        d = haversine_m(lat, lon, r["lat"], r["lon"])
        if d <= r_m:
            out.append({**dict(r), "distance_m": round(d)})
    return sorted(out, key=lambda h: h["distance_m"])


def _median(v: list[float]) -> float | None:
    v = [x for x in v if x]
    return round(statistics.median(v)) if v else None


def _band_summary(homes: list[dict], apts: list[dict]) -> list[dict[str, Any]]:
    out = []
    for lo, hi in BANDS:
        h = [x for x in homes if lo <= x["distance_m"] < hi]
        a = [x for x in apts if lo <= x["distance_m"] < hi]
        sale_active = [x for x in h if x["transaction_type"] == "ForSale" and x["status"] in ("Active", "Contract")]
        sold = [x for x in h if x["transaction_type"] == "ForSale" and x["status"] == "Sold"]
        rent_active = [x for x in h if x["transaction_type"] == "ForRent" and x["status"] in ("Active", "Contract")]
        out.append(dict(
            band=f"{lo}-{hi} m", from_m=lo, to_m=hi, homes_listed=len(h),
            for_sale_active=len(sale_active), median_asking_price=_median([x["current_price"] for x in sale_active]),
            sold_last_year=len(sold), median_sold_price=_median([x["close_price"] for x in sold]),
            sold_price_undisclosed=sum(1 for x in sold if x["price_undisclosed"]),
            for_rent_active=len(rent_active), median_asking_rent_month=_median([x["current_price"] for x in rent_active]),
            apartment_communities=len(a), apartment_communities_listed=sum(1 for x in a if x["listed"]),
            apartment_units=sum(x["units"] or 0 for x in a), apartment_units_unknown=sum(1 for x in a if not x["units"]),
            apartment_units_available=sum(x["units_available"] or 0 for x in a)))
    return out


def community(parcel_id: str | None = None, lat: float | None = None, lon: float | None = None, radius_m: float = 3000,
              gen_offset_m: float = 0.0, mw_it: float = 20.0, redundancy: str = "N+1", cooling: str = "liquid",
              noise_wall: bool = False, max_points: int = 300) -> dict[str, Any] | None:
    """Residential exposure around a CoStar parcel or a dropped pin. None if the parcel is unknown."""
    ensure()
    radius_m = max(100.0, min(float(radius_m), 5000.0))
    c = connect()
    try:
        name = None
        if parcel_id:
            p = c.execute("SELECT parcel_id, name, address, lat, lon, market FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
            if not p:
                return None
            lat, lon, name = p["lat"], p["lon"], p["name"] or p["address"]
        if lat is None or lon is None:
            raise ValueError("Give a parcel id or both lat and lon.")
        homes = _near(c, "home_listings", lat, lon, radius_m)
        apts = _near(c, "apt_communities", lat, lon, radius_m)
    finally:
        c.close()

    at, nm = noise_model(mw_it, redundancy, cooling, noise_wall)
    receptors = sorted([{"kind": "home", "id": h["home_id"], "distance_m": h["distance_m"]} for h in homes]
                       + [{"kind": "apartment community", "id": a["property_id"], "distance_m": a["distance_m"]} for a in apts],
                       key=lambda x: x["distance_m"])
    noise = [dict(**r, generator_distance_m=round(r["distance_m"] + gen_offset_m), dba=at(r["distance_m"] + gen_offset_m),
                  over_limit=at(r["distance_m"] + gen_offset_m) > nm["limit_dba"]) for r in receptors[:5]]

    # what the engine's residential-proximity gate measures: the nearest record in the `homes` table (CoStar apartment
    # communities and every CoStar home listing, public or not), so it can be nearer than the public listings used here
    s_, n_, w_, e_ = _box(lat, lon, 20_000)
    gate_home, gate_d = nearest(lat, lon, load_homes((s_, w_, n_, e_)))  # load_homes takes (south, west, north, east)
    pts = [dict(kind="home", lat=h["lat"], lon=h["lon"], distance_m=h["distance_m"], status=h["status"],
                transaction=h["transaction_type"]) for h in homes] + \
          [dict(kind="apartment community", lat=a["lat"], lon=a["lon"], distance_m=a["distance_m"], units=a["units"],
                listed=bool(a["listed"])) for a in apts]
    pts.sort(key=lambda x: x["distance_m"])

    return dict(
        parcel_id=parcel_id, name=name, lat=lat, lon=lon, radius_m=radius_m,
        nearest_home_listing_m=homes[0]["distance_m"] if homes else None,
        nearest_apartment_community_m=apts[0]["distance_m"] if apts else None,
        engine_gate_home_m=round(gate_d) if gate_d is not None else None,
        engine_gate_home_kind=gate_home.get("kind") if gate_home else None,
        engine_gate_note=("The site screen's residential gate uses the nearest record in PlotStar's homes table (CoStar apartment "
                          "communities and all CoStar home listings, including non-public ones; OpenStreetMap homes are added "
                          "only for dropped pins). This panel uses public listings and active apartment listings only."),
        bands=_band_summary(homes, apts),
        nearest_homes=[dict(home_id=h["home_id"], street=h["street"], city=h["city"], distance_m=h["distance_m"],
                            transaction=h["transaction_type"], status=h["status"], asking_price=h["current_price"],
                            sold_price=h["close_price"], price_undisclosed=bool(h["price_undisclosed"]), beds=h["beds"],
                            baths=h["baths"], sqft=h["sqft"], home_type=h["home_type"], year_built=h["year_built"],
                            list_date=h["list_date"], close_date=h["close_date"], listings_merged=h["listings_merged"],
                            source_row=h["source_row"]) for h in homes[:10]],
        nearest_apartments=[dict(property_id=a["property_id"], name=a["name"], distance_m=a["distance_m"], units=a["units"],
                                 units_available=a["units_available"], min_rent=a["min_rent"], max_rent=a["max_rent"],
                                 lifestyle=a["lifestyle"], listed=bool(a["listed"]), source_file=a["source_file"],
                                 source_row=a["source_row"]) for a in apts[:10]],
        noise=dict(receptors=noise, gen_offset_m=gen_offset_m, assumptions=dict(mw_it=mw_it, redundancy=redundancy, cooling=cooling,
                                                                                noise_wall=noise_wall, **nm),
                   label="Estimated, same model as the layout engine",
                   basis="Generator noise during tests and outages only, free-field, at the nearest five receptors. Distance is "
                         "site point to receptor plus gen_offset_m (the generator yard's offset from the site point)."),
        points=pts[:max_points], points_total=len(pts),
        wording=("Counts are homes listed on Homes.com and apartment units in listed communities. They are a sample of what "
                 "CoStar records, not households or population, and listings and units are never added together."),
        label="Sourced", source=SOURCE, source_files=[RES_FILE, APT_FILE])


def compare_sites(parcel_ids: list[str], **kw: Any) -> dict[str, Any]:
    """One exposure row per site, in the order given, for side-by-side comparison."""
    rows = []
    for pid in parcel_ids[:12]:
        r = community(pid, **{"radius_m": 3000, **kw})
        if r is None:
            rows.append(dict(parcel_id=pid, found=False))
            continue
        within = lambda m: sum(b["homes_listed"] for b in r["bands"] if b["to_m"] <= m)  # noqa: E731
        units = lambda m: sum(b["apartment_units"] for b in r["bands"] if b["to_m"] <= m)  # noqa: E731
        near = r["noise"]["receptors"][0] if r["noise"]["receptors"] else None
        rows.append(dict(parcel_id=pid, found=True, name=r["name"], nearest_receptor_m=near["distance_m"] if near else None,
                         nearest_receptor_kind=near["kind"] if near else None, noise_at_nearest_dba=near["dba"] if near else None,
                         homes_listed_500m=within(500), homes_listed_1km=within(1000), homes_listed_3km=within(3000),
                         apartment_units_1km=units(1000), apartment_units_3km=units(3000),
                         engine_gate_home_m=r["engine_gate_home_m"]))
    return dict(sites=rows, label="Sourced", source=SOURCE,
                wording="Listed homes and apartment units, a sample of CoStar records; not households or population.")


if __name__ == "__main__":
    import time
    t = time.time()
    print(build(), f"{time.time() - t:.1f}s")
