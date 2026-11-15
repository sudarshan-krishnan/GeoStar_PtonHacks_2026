"""CoStar tenancy and availability: "can we get this building?"

Builds three derived tables from the CoStar kit (streamed once, rebuilt only when a source file changes):
  occupancies      one row per location-occupancy record (tenancy), with the tenant's name and industry from company-detail
  listing_spaces   one row per space (or whole-property offer) in an ACTIVE commercial listing, by property
  property_extra   building facts the parcels table does not keep (RBA, GBA, isOwnerOccupied)

Then answers, per property:
  occupancy_status(parcel_id)  which of four states the data supports: confirmed_vacant, listed_available, occupied, unknown
  control(parcel_id)           current tenants, an expiration ladder, earliest full control, and leasing due-diligence flags

Rules taken from the kit docs (models/location-occupancy.md, concepts/tenants-and-occupancy.md,
models/commercial-listing-summary.md):
  * `toDate` null means the tenant is still in place. No tenancy record means UNKNOWN, never vacant.
  * Occupancy is not vacancy, and available (marketed) is not vacant. Availability comes only from listings.
  * Lease expiry is `leaseDeal.expirationDate`; it is filled on few current tenancies. A missing expiry stays unknown.
  * leaseType Owned is an owner in its own building, not a lease.
  * Contact details in the kit are synthetic: no phone or e-mail is read or returned.

Run `python -m app.costar.tenancy` to build the tables ahead of time.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from .. import config
from ..db import connect, db_ready
from .loader import Enums

KIT = config.COSTAR_KIT_DIR
OCC_FILE = "data/location-occupancy.jsonl"
COMPANY_FILE = "data/company-detail.jsonl"
LISTING_FILE = "data/commercial-listing-summary.jsonl"
PROPERTY_FILE = "data/commercial-property.jsonl"
SOURCE = "CoStar Data Extract"
WHOLE_BUILDING = 0.95  # an offer covering at least 95 % of the rentable area counts as the whole building

_lock = threading.Lock()
TENANCY_SCHEMA = 2  # bump when a derived table's columns change

SCHEMA = """
CREATE TABLE IF NOT EXISTS costar_derived (name TEXT PRIMARY KEY, built_at TEXT, sources TEXT, rows INTEGER);
DROP TABLE IF EXISTS occupancies;
CREATE TABLE occupancies (
    id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL, tenant_location_id INTEGER, tenant_name TEXT,
    tenant_company TEXT, industry TEXT, business_status TEXT, lease_type TEXT, sf REAL, spaces INTEGER,
    from_date TEXT, to_date TEXT, move_in TEXT, lease_commencement TEXT, lease_expiration TEXT,
    month_to_month INTEGER, expiration_reason TEXT, is_current INTEGER NOT NULL, source_row INTEGER NOT NULL);
CREATE INDEX occupancies_property ON occupancies(property_id, is_current);
DROP TABLE IF EXISTS listing_spaces;
CREATE TABLE listing_spaces (
    listing_id INTEGER NOT NULL, property_id INTEGER NOT NULL, kind TEXT NOT NULL, listing_type TEXT,
    space_id INTEGER, suite TEXT, space_use TEXT, space_type TEXT, sf_min REAL, sf_max REAL,
    rate_low REAL, rate_high REAL, rate_basis TEXT, rate_per_sf_year_low REAL, rate_per_sf_year_high REAL,
    lease_pending INTEGER, available_on TEXT, date_on_market TEXT, asking_price_low REAL, asking_price_high REAL,
    new_owner_can_occupy_sf REAL, source_row INTEGER NOT NULL);
CREATE INDEX listing_spaces_property ON listing_spaces(property_id);
DROP TABLE IF EXISTS property_extra;
CREATE TABLE property_extra (
    property_id INTEGER PRIMARY KEY, rba_sf REAL, gba_sf REAL, is_owner_occupied INTEGER, apt_units INTEGER,
    source_row INTEGER NOT NULL);
"""


def _iter(path: Path) -> Iterator[tuple[int, dict]]:
    with path.open(encoding="utf-8") as fh:
        for row, line in enumerate(fh, start=1):
            if line.strip():
                yield row, json.loads(line)


def _d(v: Any) -> str | None:
    """ISO date (YYYY-MM-DD) from a CoStar date-time, or None."""
    return v[:10] if isinstance(v, str) and len(v) >= 10 else None


def _meta(kit: Path, files: Iterable[str]) -> str:
    out = {}
    for f in files:
        p = kit / f
        if p.exists():
            st = p.stat()
            out[f] = [st.st_size, int(st.st_mtime)]
    return json.dumps(out, sort_keys=True)


def _enums(kit: Path) -> Enums:
    return Enums(json.loads((kit / "schemas/enums.json").read_text(encoding="utf-8")))


# ----------------------------------------------------------------------------------------------------- build
TABLES = ("occupancies", "listing_spaces", "property_extra")
SOURCES = (OCC_FILE, COMPANY_FILE, LISTING_FILE, PROPERTY_FILE)


def build(kit: Path = KIT, conn: sqlite3.Connection | None = None) -> dict[str, int]:
    own = conn is None
    conn = conn or connect()
    conn.row_factory = sqlite3.Row  # name access, whatever connection the caller passed
    e = _enums(kit)
    try:
        conn.executescript(SCHEMA)
        # 1. tenancies (needed first, to know which companies to read)
        occ, need = [], set()
        for row, r in _iter(kit / OCC_FILE):
            pid = r.get("propertyId")
            if not pid:
                continue
            sp = r.get("spaces") or []
            sf_vals = [s.get("squareFeetOccupied") for s in sp if s.get("squareFeetOccupied")]
            deal = r.get("leaseDeal") or {}
            tl = r.get("tenantLocationId")
            if tl:
                need.add(tl)
            occ.append(dict(
                id=r["id"], property_id=pid, tenant_location_id=tl, industry_occ=r.get("industryType"),
                lease_type=e.name("LeaseType", r.get("leaseType")), sf=round(sum(sf_vals), 1) if sf_vals else None,
                spaces=len(sp), from_date=_d(r.get("fromDate")), to_date=_d(r.get("toDate")), move_in=_d(r.get("moveInDate")),
                lease_commencement=_d(deal.get("commencementDate")), lease_expiration=_d(deal.get("expirationDate")),
                month_to_month=int(bool(deal.get("isLeaseTermMonthToMonth")) or r.get("leaseType") == 3),
                expiration_reason=e.name("LocationOccupancyExpirationReason", r.get("expirationReason")),
                is_current=int(not r.get("toDate")), source_row=row))
        # 2. tenant names and industries, only for the locations we need (no contact fields are read)
        comp: dict[int, tuple] = {}
        for _, r in _iter(kit / COMPANY_FILE):
            if r.get("id") in need:
                p = r.get("profile") or {}
                comp[r["id"]] = (r.get("name"), p.get("companyName"), e.name("IndustryType", p.get("industryType")),
                                 e.name("LocationBusinessStatus", r.get("businessStatus")))
        conn.executemany(
            "INSERT INTO occupancies VALUES (:id,:property_id,:tenant_location_id,:tenant_name,:tenant_company,:industry,"
            ":business_status,:lease_type,:sf,:spaces,:from_date,:to_date,:move_in,:lease_commencement,:lease_expiration,"
            ":month_to_month,:expiration_reason,:is_current,:source_row)",
            [{**o, "tenant_name": comp.get(o["tenant_location_id"], (None,) * 4)[0],
              "tenant_company": comp.get(o["tenant_location_id"], (None,) * 4)[1],
              # the company's industry; the occupancy's own industryType is only meaningful for unknown tenants
              "industry": comp.get(o["tenant_location_id"], (None,) * 4)[2]
              or (e.name("IndustryType", o["industry_occ"]) if not o["tenant_location_id"] else None),
              "business_status": comp.get(o["tenant_location_id"], (None,) * 4)[3]} for o in occ])
        # 3. active listings: lease spaces (dropping off-market spaces) and whole-property sale offers
        spaces = []
        for row, r in _iter(kit / LISTING_FILE):
            if r.get("listingStatus") != 1:  # Active only; OffMarket listings are not on the market now
                continue
            usd = (r.get("monetaryUnit") or 1) == 1
            lt = e.name("ListingType", r.get("listingType"))
            fl = r.get("forLeaseSummary")
            if fl:
                for s in fl.get("spaces") or []:
                    pid = s.get("propertyId") or r.get("propertyId")
                    if not pid or s.get("dateOffMarket"):
                        continue
                    basis = e.name("RateBasis", s.get("rateBasis"))
                    lo, hi = (s.get("rateLow") or None), (s.get("rateHigh") or None)  # 0 = no rate recorded
                    mult = 12.0 if basis == "Monthly" else 1.0 if basis == "Yearly" else None
                    ok = usd and (s.get("monetaryUnit") or 1) == 1 and mult is not None
                    spaces.append(dict(
                        listing_id=r["id"], property_id=pid, kind="lease", listing_type=lt, space_id=s.get("id"),
                        suite=s.get("suite"), space_use=e.name("SpaceUse", s.get("spaceUse")),
                        space_type=e.name("SpaceType", s.get("spaceType")), sf_min=s.get("squareFeetMin"),
                        sf_max=s.get("squareFeetMax"), rate_low=lo, rate_high=hi, rate_basis=basis,
                        rate_per_sf_year_low=round(lo * mult, 2) if ok and lo else None,
                        rate_per_sf_year_high=round(hi * mult, 2) if ok and hi else None,
                        lease_pending=int(bool(s.get("isLeasePending"))), available_on=_d(s.get("availableOnDate")),
                        date_on_market=_d(s.get("dateOnMarket")), asking_price_low=None, asking_price_high=None,
                        new_owner_can_occupy_sf=None, source_row=row))
            fs = r.get("forSaleSummary")
            if fs and r.get("propertyId"):
                spaces.append(dict(
                    listing_id=r["id"], property_id=r["propertyId"], kind="sale", listing_type=lt, space_id=None, suite=None,
                    space_use=None, space_type=None, sf_min=None, sf_max=fs.get("totalAvailableSquareFeet"),
                    rate_low=None, rate_high=None, rate_basis=None, rate_per_sf_year_low=None, rate_per_sf_year_high=None,
                    lease_pending=0, available_on=None, date_on_market=_d(fs.get("minDateOnMarket")),
                    asking_price_low=(fs.get("askingPriceLow") or None) if usd else None,
                    asking_price_high=(fs.get("askingPriceHigh") or None) if usd else None,
                    new_owner_can_occupy_sf=fs.get("squareFeetNewOwnerCanOccupy"), source_row=row))
        if spaces:
            conn.executemany(f"INSERT INTO listing_spaces VALUES ({','.join(':' + k for k in spaces[0])})", spaces)
        # 4. building facts the parcels table does not hold
        extra = []
        for row, r in _iter(kit / PROPERTY_FILE):
            owner = None
            for blk in ("propertyIndustrial", "propertyFlex", "propertyOffice"):
                b = r.get(blk) or {}
                if b.get("isOwnerOccupied") is not None:
                    owner = int(bool(b["isOwnerOccupied"]))
                    break
            extra.append((r["id"], r.get("rentableBuildingAreaSquareFeet"), r.get("grossBuildingAreaSquareFeet"), owner,
                          (r.get("propertyApartment") or {}).get("totalNumUnits"), row))
        conn.executemany("INSERT INTO property_extra VALUES (?,?,?,?,?,?)", extra)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        conn.execute("INSERT OR REPLACE INTO costar_derived VALUES ('tenancy', ?, ?, ?)", (now, _meta(kit, SOURCES) + f"|v{TENANCY_SCHEMA}", len(occ)))
        conn.commit()
        return {"occupancies": len(occ), "companies": len(comp), "listing_spaces": len(spaces), "property_extra": len(extra)}
    finally:
        if own:
            conn.close()


class StoreUnavailable(RuntimeError):
    pass


def ensure(kit: Path = KIT) -> None:
    """Build the derived tables once, or again when a source file changed. Thread-safe."""
    if not db_ready():
        raise StoreUnavailable("Parcel store is empty. Run: python -m app.costar.loader")
    with _lock:
        conn = connect()
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS costar_derived (name TEXT PRIMARY KEY, built_at TEXT, sources TEXT, rows INTEGER)")
            row = conn.execute("SELECT sources FROM costar_derived WHERE name='tenancy'").fetchone()
            have = all(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone() for t in TABLES)
        finally:
            conn.close()
        if have and row and row["sources"] == _meta(kit, SOURCES) + f"|v{TENANCY_SCHEMA}":
            return
        if not (kit / OCC_FILE).exists():
            raise StoreUnavailable(f"CoStar kit not found at {kit}")
        build(kit)


# ----------------------------------------------------------------------------------------------------- analysis
def _parcel(c: sqlite3.Connection, parcel_id: str) -> dict | None:
    r = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    return dict(r) if r else None


def _months(to: str, today: date) -> float:
    return round((date.fromisoformat(to) - today).days / 30.44, 1)


def _availability(c: sqlite3.Connection, pid: int) -> dict[str, Any]:
    rows = [dict(r) for r in c.execute("SELECT * FROM listing_spaces WHERE property_id = ?", (pid,))]
    lease = [r for r in rows if r["kind"] == "lease"]
    sale = [r for r in rows if r["kind"] == "sale"]
    avail = [r for r in lease if not r["lease_pending"]]
    sf = sum(r["sf_max"] or 0 for r in avail)
    rated = [r for r in avail if r["rate_per_sf_year_low"] and r["sf_max"]]
    w = sum(r["sf_max"] for r in rated)
    rent = round(sum(r["rate_per_sf_year_low"] * r["sf_max"] for r in rated) / w, 2) if w else None
    return dict(
        lease_spaces=len(avail), lease_pending_spaces=len(lease) - len(avail), available_sf=round(sf) if sf else 0,
        asking_rent_per_sf_year=rent,
        asking_rent_basis=(f"Area-weighted low end of the asking rate on {len(rated)} of {len(avail)} available spaces, "
                           "converted to $/sf/year from each space's rate basis. Asking, not achieved." if rent else
                           "No asking rate recorded on the available spaces." if avail else None),
        for_sale=[dict(listing_id=r["listing_id"], asking_price_low=r["asking_price_low"], asking_price_high=r["asking_price_high"],
                       available_sf=r["sf_max"], new_owner_can_occupy_sf=r["new_owner_can_occupy_sf"],
                       on_market_since=r["date_on_market"], listing_type=r["listing_type"], source_row=r["source_row"]) for r in sale],
        spaces=[dict(listing_id=r["listing_id"], suite=r["suite"], use=r["space_use"], space_type=r["space_type"],
                     sf_min=r["sf_min"], sf_max=r["sf_max"], rate_low=r["rate_low"], rate_high=r["rate_high"],
                     rate_basis=r["rate_basis"], lease_pending=bool(r["lease_pending"]), available_on=r["available_on"],
                     source_row=r["source_row"]) for r in lease],
        source_rows=sorted({r["source_row"] for r in rows}), source_file=LISTING_FILE)


def occupancy_status(parcel_id: str, today: date | None = None) -> dict[str, Any] | None:
    """Which occupancy states the CoStar data supports. Several can apply at once (occupied + some space listed)."""
    ensure()
    today = today or date.today()
    c = connect()
    try:
        p = _parcel(c, parcel_id)
        if not p:
            return None
        pid = p["costar_property_id"]
        ex = c.execute("SELECT * FROM property_extra WHERE property_id = ?", (pid,)).fetchone()
        rba = (ex["rba_sf"] if ex else None) or p.get("building_sf")
        n_all = c.execute("SELECT COUNT(*) FROM occupancies WHERE property_id = ?", (pid,)).fetchone()[0]
        cur = [dict(r) for r in c.execute("SELECT * FROM occupancies WHERE property_id = ? AND is_current = 1", (pid,))]
        av = _availability(c, pid)
    finally:
        c.close()
    states, evidence = [], []
    whole = None
    for s in av["for_sale"]:
        if rba and s["new_owner_can_occupy_sf"] and s["new_owner_can_occupy_sf"] >= WHOLE_BUILDING * rba:
            whole = (f"Active sale listing (row {s['source_row']}) says a new owner can occupy "
                     f"{s['new_owner_can_occupy_sf']:,.0f} sf of the {rba:,.0f} sf building.")
    if not whole and rba and av["available_sf"] >= WHOLE_BUILDING * rba:
        whole = f"Active lease listings market {av['available_sf']:,.0f} sf, at least {WHOLE_BUILDING:.0%} of the {rba:,.0f} sf building."
    if whole and not cur:
        states.append("confirmed_vacant")
        evidence.append(dict(state="confirmed_vacant", reason=whole + " No current tenancy is recorded. Offered for the whole "
                             "building; physical emptiness is not separately stated.", source=LISTING_FILE))
    elif whole:
        evidence.append(dict(state="conflict", reason=whole + f" But {len(cur)} current tenancy record(s) still exist, so it is "
                             "not treated as vacant. Confirm with the listing broker.", source=f"{LISTING_FILE}; {OCC_FILE}"))
    if av["available_sf"] or av["for_sale"]:
        states.append("listed_available")
        parts = []
        if av["available_sf"]:
            parts.append(f"{av['available_sf']:,} sf for lease in {av['lease_spaces']} space(s)")
        if av["for_sale"]:
            parts.append(f"{len(av['for_sale'])} active sale listing(s)")
        evidence.append(dict(state="listed_available", reason="Marketed now: " + " and ".join(parts)
                             + ". Available means marketed, not necessarily vacant.", source=LISTING_FILE))
    if cur:
        states.append("occupied")
        evidence.append(dict(state="occupied", reason=f"{len(cur)} current tenancy record(s) (no end date).", source=OCC_FILE))
    if not states or (not cur and "confirmed_vacant" not in states):
        if "unknown" not in states:
            states.append("unknown")
        evidence.append(dict(state="unknown", reason=("No tenancy records for this property, so occupancy is unknown, not vacant."
                                                      if n_all == 0 else
                                                      f"{n_all} past tenancy record(s) but none current; that does not prove the building is empty."),
                             source=OCC_FILE))
    return dict(parcel_id=parcel_id, costar_property_id=pid, states=states, evidence=evidence, availability=av,
                current_tenancies=len(cur), tenancy_records=n_all, building_sf=rba, label="Sourced", source=SOURCE)


def control(parcel_id: str, today: date | None = None) -> dict[str, Any] | None:
    """Who is in the building, when the leases end, and when the whole building could be controlled."""
    ensure()
    today = today or date.today()
    c = connect()
    try:
        p = _parcel(c, parcel_id)
        if not p:
            return None
        pid = p["costar_property_id"]
        ex = c.execute("SELECT * FROM property_extra WHERE property_id = ?", (pid,)).fetchone()
        rows = [dict(r) for r in c.execute("SELECT * FROM occupancies WHERE property_id = ? ORDER BY is_current DESC, sf DESC", (pid,))]
    finally:
        c.close()
    status = occupancy_status(parcel_id, today)
    rba = (ex["rba_sf"] if ex else None) or p.get("building_sf")
    cur = [r for r in rows if r["is_current"]]
    known_sf = [r["sf"] for r in cur if r["sf"]]
    occ_sf = round(sum(known_sf)) if known_sf else 0
    share = round(occ_sf / rba, 3) if rba and known_sf else None
    owned = [r for r in cur if r["lease_type"] == "Owned"]
    owner_flag = bool(ex and ex["is_owner_occupied"]) or bool(owned)

    tenants = [dict(name=r["tenant_company"] or r["tenant_name"] or "Unidentified tenant", location=r["tenant_name"],
                    industry=r["industry"], sf=r["sf"], share_of_building=round(r["sf"] / rba, 3) if r["sf"] and rba else None,
                    lease_type=r["lease_type"] or "Unknown", move_in=r["move_in"], from_date=r["from_date"],
                    lease_expiration=r["lease_expiration"] or "unknown", month_to_month=bool(r["month_to_month"]),
                    future_move_in=bool(r["move_in"] and r["move_in"] > today.isoformat()), source_row=r["source_row"])
               for r in cur]
    ladder: dict[str, dict[str, float]] = defaultdict(lambda: {"tenancies": 0, "sf": 0.0})
    unknown = 0
    for r in cur:
        if r["lease_type"] == "Owned":
            continue
        if r["lease_expiration"]:
            y = r["lease_expiration"][:4]
            ladder[y]["tenancies"] += 1
            ladder[y]["past"] = r["lease_expiration"] < today.isoformat() or ladder[y].get("past", False)
            ladder[y]["sf"] += r["sf"] or 0
        else:
            unknown += 1
    leases = [r for r in cur if r["lease_type"] != "Owned"]

    # earliest full control: every current lease has ended. Unknown expiries make it unknowable; never guessed.
    if not rows:
        full = dict(date=None, months=None, basis="No tenancy records for this property, so control timing is unknown, not immediate.")
    elif not cur:
        full = dict(date=None, months=None, basis="No current tenancy on record. That suggests, but does not prove, that no tenant is in place.")
    elif unknown:
        full = dict(date=None, months=None,
                    basis=f"{unknown} of {len(leases)} current lease(s) have no recorded expiration, so the date cannot be computed.")
    elif not leases:
        full = dict(date=None, months=None, basis="Owner-occupied: control depends on buying from the owner-user, not on a lease ending.")
    else:
        last = max(r["lease_expiration"] for r in leases)
        full = dict(date=last, months=max(0.0, _months(last, today)),
                    basis=f"Latest recorded expiration among the {len(leases)} current lease(s)."
                          + (" Every recorded expiration has passed while the tenancies are still current: holdover or a "
                             "stale record, so verify before relying on it." if last < today.isoformat() else "")
                          + (" The owner also occupies space." if owned else ""))

    five = today.replace(year=today.year - 5).isoformat()
    turnover = dict(moved_out_last_5y=sum(1 for r in rows if r["to_date"] and r["to_date"] >= five),
                    moved_in_last_5y=sum(1 for r in rows if (r["move_in"] or r["from_date"] or "") >= five))

    # leasing due diligence
    flags = []
    if unknown:
        flags.append(dict(flag="unknown_expirations", detail=f"{unknown} current lease(s) without a recorded expiration date."))
    past = [r for r in cur if r["lease_expiration"] and r["lease_expiration"] < today.isoformat() and r["lease_type"] != "Owned"]
    if past:
        flags.append(dict(flag="expired_but_current", detail=f"{len(past)} current tenancy(ies) whose recorded lease expiration has "
                          "passed: holdover, renewal not recorded, or a stale record."))
    mtm = [r for r in cur if r["month_to_month"]]
    if mtm:
        flags.append(dict(flag="month_to_month", detail=f"{len(mtm)} tenancy(ies) month to month."))
    subs = [r for r in cur if r["lease_type"] in ("Sublease", "Assignment")]
    if subs:
        flags.append(dict(flag="subleases", detail=f"{len(subs)} sublease or assignment tenancy(ies): check the head lease."))
    soon = (today.replace(year=today.year + 2)).isoformat()
    for r in cur:
        if r["lease_expiration"] and today.isoformat() <= r["lease_expiration"] <= soon and rba and (r["sf"] or 0) >= 0.25 * rba:
            flags.append(dict(flag="large_tenant_expiring_24m", detail=f"{r['tenant_company'] or r['tenant_name'] or 'A tenant'} "
                              f"({r['sf']:,.0f} sf) expires {r['lease_expiration']}."))
    unidentified = sum(1 for r in cur if not r["tenant_location_id"])
    if unidentified:
        flags.append(dict(flag="unidentified_tenants", detail=f"{unidentified} current tenancy(ies) with no named tenant."))
    largest = max((t for t in tenants if t["sf"]), key=lambda t: t["sf"], default=None)

    return dict(
        parcel_id=parcel_id, costar_property_id=pid, name=p.get("name"), address=p.get("address"),
        building_sf=rba, building_sf_basis="Rentable building area (RBA) from the property record" if ex and ex["rba_sf"] else "Building area from the parcel record",
        states=status["states"], state_evidence=status["evidence"], availability=status["availability"],
        current=dict(tenancies=len(cur), tenants_named=len(cur) - unidentified, occupied_sf=occ_sf,
                     sf_unknown_tenancies=len(cur) - len(known_sf), occupied_share=share,
                     vacancy_share=round(max(0.0, 1 - share), 3) if share is not None else None,
                     vacancy_basis=("1 - (sum of squareFeetOccupied on current tenancies / building RBA). Occupancy-based, "
                                    "not marketed vacancy; tenancies without a recorded area are left out." if share is not None
                                    else "Not computed: no current tenancy area or no building area."),
                     owner_occupied=owner_flag, largest_tenant=largest["name"] if largest else None,
                     largest_tenant_share=largest["share_of_building"] if largest else None),
        tenants=tenants, expiration_ladder=[{"year": y, **v} for y, v in sorted(ladder.items())],
        expirations_unknown=unknown, earliest_full_control=full, turnover=turnover, diligence_flags=flags,
        coverage=dict(records=len(rows), current=len(cur), current_with_expiry=len(leases) - unknown),
        label=f"From {len(rows)} CoStar tenancy record(s)", source=SOURCE, source_file=OCC_FILE,
        source_rows=[r["source_row"] for r in rows][:200], as_of=today.isoformat())


if __name__ == "__main__":
    import time
    t = time.time()
    print(build(), f"{time.time() - t:.1f}s")
