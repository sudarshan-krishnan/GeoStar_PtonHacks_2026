"""CoStar site intelligence on a synthetic mini-kit: tenancy control, occupancy states, community exposure, redevelopment.
The rules under test come from the kit docs: no tenancy record is unknown (not vacant), availability only from listings,
no invented lease dates, homes deduplicated, listings and units never presented as people."""
from __future__ import annotations

import json
import math
import sqlite3
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db as DB
from app.engine import layout_engine as L
from app.sponsors.costar import homes as H
from app.sponsors.costar import redevelop as R
from app.sponsors.costar import tenancy as T
from app.engine.screening import EARTH_R_M, haversine_m

TODAY = date(2026, 11, 14)
LAT0, LON0 = 29.80, -95.40  # site centre for property 1
ENUMS = {
    "LeaseType": {"0": "Unknown", "1": "Direct", "2": "Sublease", "3": "MonthToMonth", "4": "Owned"},
    "LocationOccupancyExpirationReason": {"0": "Unknown", "10": "MovingOutNewAddressUnknown"},
    "IndustryType": {"0": "Unknown", "5": "Manufacturing"},
    "LocationBusinessStatus": {"0": "Unknown", "1": "Active"},
    "ListingType": {"0": "Unknown", "9": "PropertyForSale", "14": "PropertyDirectSpaceForLease"},
    "SpaceUse": {"0": "Unknown", "7": "Industrial"}, "SpaceType": {"0": "Unknown", "1": "Relet"},
    "RateBasis": {"0": "Unknown", "1": "Monthly", "2": "Yearly"},
    "TransactionType": {"0": "None", "1": "ForSale", "2": "ForRent"},
    "ListingStatus2": {"0": "None", "1": "Active", "2": "Contract", "4": "Sold"},
    "ForSaleStatus": {"0": "Unknown", "1": "ForSale", "5": "Sold"}, "ForRentStatus": {"0": "Unknown", "1": "ForRent"},
    "ListingPropertyType": {"0": "None", "1": "Detached"}, "ApartmentLifestyleType": {"0": "Unknown", "1": "All"},
}


def north(m: float) -> float:
    """Latitude m metres north of the site centre (exact on the sphere used by haversine_m)."""
    return LAT0 + math.degrees(m / EARTH_R_M)


def _w(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


def _occ(i, pid, *, tl=None, lt=1, to=None, sf=(1000.0,), exp=None, mtm=False, move_in="2020-01-01"):
    deal = {"expirationDate": f"{exp}T00:00:00", "isLeaseTermMonthToMonth": mtm} if exp else ({"isLeaseTermMonthToMonth": mtm} if mtm else None)
    return {"id": i, "propertyId": pid, "tenantLocationId": tl, "leaseType": lt, "fromDate": f"{move_in}T00:00:00",
            "toDate": f"{to}T00:00:00" if to else None, "moveInDate": f"{move_in}T00:00:00", "leaseDeal": deal,
            "spaces": [{"squareFeetOccupied": s} for s in sf], "industryType": 0}


@pytest.fixture()
def kit(tmp_path, monkeypatch):
    k = tmp_path / "kit"
    (k / "schemas").mkdir(parents=True)
    (k / "schemas/enums.json").write_text(json.dumps(ENUMS), encoding="utf-8")
    _w(k / T.OCC_FILE, [
        _occ(1, 1, tl=501, sf=(1000.0, 500.0), exp="2028-06-30"),       # current, two spaces, known expiry
        _occ(2, 1, sf=(2000.0,)),                                         # current, unknown tenant, NO expiry
        _occ(3, 1, tl=502, to="2022-05-01", exp="2022-05-01"),            # historical
        _occ(4, 2, tl=503, lt=4, sf=(10000.0,)),                          # owner-occupied
        _occ(5, 3, tl=504, to="2019-01-01"),                              # only historical
        _occ(6, 5, tl=505, sf=(9000.0,), exp="2025-03-31"),               # current, expiry already passed
        _occ(7, 5, tl=506, lt=2, sf=(500.0,), exp="2027-01-31", mtm=True),  # sublease, month to month
    ])
    _w(k / T.COMPANY_FILE, [{"id": i, "name": f"Tenant {i} Houston", "businessStatus": 1, "phone": "555-0100",
                             "email": "x@example.com", "profile": {"companyName": f"Tenant Co {i}", "industryType": 5}}
                            for i in range(501, 507)])
    _w(k / T.LISTING_FILE, [
        {"id": 900, "propertyId": 1, "listingStatus": 1, "listingType": 14, "monetaryUnit": 1, "forLeaseSummary": {"spaces": [
            {"id": 1, "propertyId": 1, "squareFeetMax": 2000.0, "rateLow": 2.0, "rateHigh": 2.5, "rateBasis": 1, "monetaryUnit": 1},
            {"id": 2, "propertyId": 1, "squareFeetMax": 7000.0, "dateOffMarket": "2026-01-01T00:00:00", "rateLow": 0, "rateBasis": 0}]}},
        {"id": 901, "propertyId": 3, "listingStatus": 3, "listingType": 14, "forLeaseSummary": {"spaces": [
            {"id": 3, "propertyId": 3, "squareFeetMax": 50000.0}]}},                    # OffMarket listing: ignored
        {"id": 902, "propertyId": 6, "listingStatus": 1, "listingType": 9, "monetaryUnit": 1,
         "forSaleSummary": {"askingPriceLow": 4_000_000, "totalAvailableSquareFeet": 40000.0, "squareFeetNewOwnerCanOccupy": 40000.0}},
    ])
    _w(k / T.PROPERTY_FILE, [
        {"id": 1, "rentableBuildingAreaSquareFeet": 10000.0, "grossBuildingAreaSquareFeet": 10000.0, "propertyIndustrial": {"isOwnerOccupied": False}},
        {"id": 2, "rentableBuildingAreaSquareFeet": 10000.0, "propertyIndustrial": {"isOwnerOccupied": True}},
        {"id": 3, "rentableBuildingAreaSquareFeet": 50000.0}, {"id": 4, "rentableBuildingAreaSquareFeet": 8000.0},
        {"id": 5, "rentableBuildingAreaSquareFeet": 20000.0}, {"id": 6, "rentableBuildingAreaSquareFeet": 40000.0},
        {"id": 7, "propertyApartment": {"totalNumUnits": 200}},
    ])
    home = lambda i, hid, m, **kw: {"id": i, "propertyId": hid, "residentialListingId": hid * 10, "transactionType": kw.get("tt", 1),  # noqa: E731
                                    "listingStatus": kw.get("st", 1), "forSaleStatus": kw.get("fs"), "currentPrice": kw.get("price", 300000.0),
                                    "closePrice": kw.get("close"), "isPrimaryForThisListingInstance": kw.get("primary", True),
                                    "listDate": kw.get("ld", "2026-06-01T00:00:00"), "permissionLevels": {"homes": kw.get("perm", 10)},
                                    "mls": {"id": 1}, "property": {"bedsMax": 3, "bathsMax": 2, "sqftMin": 1600, "propertyType": 1,
                                    "address": {"streetNumber": "1", "streetName": "Elm", "streetSuffix": "St", "unitNumber": "4B",
                                                "fullStreetAddress": "1 Elm St Unit 4B", "city": "Houston", "zip": "77000", "state": "TX",
                                                "latitude": north(m), "longitude": LON0}}}
    _w(k / H.RES_FILE, [
        home(1, 9001, 100), home(2, 9001, 100, primary=False, ld="2025-01-01T00:00:00"),  # same home, two MLS listings
        home(3, 9002, 300, tt=1, st=4, fs=5, close=None), home(4, 9003, 800, tt=2, price=2100.0),
        home(5, 9004, 2000, price=500000.0), home(6, 9005, 50, perm=255),                    # not public: excluded
    ])
    _w(k / H.APT_FILE, [{"propertyId": 8, "totalNumUnits": 120, "numUnitsAvailable": 9, "minRent": 0, "maxRent": 1800,
                         "lifestyleType": 1, "address": {"streetNumber": "9", "streetName": "Oak", "streetType": "Ave",
                                                         "city": "Houston", "latitude": north(600), "longitude": LON0}}])

    dbp = tmp_path / "t.db"
    monkeypatch.setattr(DB, "DB_PATH", dbp)
    c = sqlite3.connect(dbp)
    c.execute("CREATE TABLE parcels (parcel_id TEXT, costar_property_id INTEGER, name TEXT, address TEXT, city TEXT, lat REAL, lon REAL,"
              " market TEXT, property_type TEXT, building_sf REAL, lot_acres REAL, stories INTEGER, year_built INTEGER, building_class TEXT,"
              " ceiling_height_ft REAL, has_heavy_power INTEGER, amps_high INTEGER, volts_high INTEGER, has_rail INTEGER, zoning TEXT,"
              " construction_status TEXT, dc_candidate INTEGER, source_row INTEGER)")
    rows = [(1, "Industrial", 10000, 6.0, 1, 1985, "B", 28, 1, 1200, 480, 1, "M-2", "Existing", 1),
            (2, "Industrial", 10000, 2.0, 1, 2015, "A", 20, 0, None, None, 0, None, "Existing", 1),
            (3, "Flex", 50000, 4.0, 2, 1990, "C", None, None, None, None, 0, None, "Existing", 1),
            (4, "Industrial", 8000, None, None, None, None, None, None, None, None, None, None, None, 1),
            (5, "Industrial", 20000, 5.0, 1, 2000, "B", 24, 1, 2000, 480, 0, None, "Existing", 1),
            (6, "Industrial", 40000, 10.0, 1, 1980, "C", 30, 1, 1600, 480, 1, None, "Existing", 1),
            (7, "Multifamily", None, 3.0, 3, 2010, "A", None, None, None, None, None, None, "Existing", 0)]
    c.executemany("INSERT INTO parcels VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  [(f"costar:{i}", i, f"P{i}", f"{i} Test Rd", "Houston", LAT0 + (0.0 if i == 1 else 0.05 * i), LON0, "Houston", t, b, a, s, y, cl,
                    ch, hp, amps, v, rail, z, cs, dc, i) for (i, t, b, a, s, y, cl, ch, hp, amps, v, rail, z, cs, dc) in rows])
    c.execute("CREATE TABLE homes (kind TEXT, ref_id INTEGER, name TEXT, lat REAL, lon REAL, source_file TEXT, source_row INTEGER)")
    c.execute("INSERT INTO homes VALUES ('home listing', 1, 'x', ?, ?, 'f', 1)", (north(100), LON0))
    c.commit()
    T.build(k, c)
    H.build(k, c)
    c.close()
    monkeypatch.setattr(T, "ensure", lambda *a, **k: None)
    monkeypatch.setattr(H, "ensure", lambda *a, **k: None)
    return k


# ----------------------------------------------------------------------------------------------- tenancy and control
def test_sf_sums_over_spaces_and_tenant_named_without_contacts(kit):
    r = T.control("costar:1", TODAY)
    a = next(t for t in r["tenants"] if t["name"] == "Tenant Co 501")
    assert a["sf"] == 1500.0 and a["industry"] == "Manufacturing" and a["lease_expiration"] == "2028-06-30"
    blob = json.dumps(r)
    assert "555-0100" not in blob and "example.com" not in blob


def test_current_vs_historical_and_unknown_expiry_blocks_control_date(kit):
    r = T.control("costar:1", TODAY)
    assert r["current"]["tenancies"] == 2 and r["coverage"]["records"] == 3
    assert r["earliest_full_control"]["date"] is None and "no recorded expiration" in r["earliest_full_control"]["basis"]
    assert r["expirations_unknown"] == 1
    assert next(t for t in r["tenants"] if t["name"] == "Unidentified tenant")["lease_expiration"] == "unknown"  # never invented
    assert r["current"]["occupied_sf"] == 3500 and r["current"]["occupied_share"] == 0.35 and r["current"]["vacancy_share"] == 0.65
    assert "Occupancy-based" in r["current"]["vacancy_basis"]
    assert {f["flag"] for f in r["diligence_flags"]} >= {"unknown_expirations", "unidentified_tenants"}


def test_owner_occupied_is_not_a_lease(kit):
    r = T.control("costar:2", TODAY)
    assert r["current"]["owner_occupied"] is True and r["expiration_ladder"] == []
    assert "Owner-occupied" in r["earliest_full_control"]["basis"] and r["earliest_full_control"]["date"] is None


def test_stale_and_sublease_flags(kit):
    r = T.control("costar:5", TODAY)
    flags = {f["flag"] for f in r["diligence_flags"]}
    assert {"expired_but_current", "subleases", "month_to_month"} <= flags
    assert r["earliest_full_control"]["date"] == "2027-01-31"


# ----------------------------------------------------------------------------------------------- occupancy states
def test_missing_tenant_record_is_unknown_not_vacant(kit):
    r = T.occupancy_status("costar:4", TODAY)
    assert r["states"] == ["unknown"] and "not vacant" in r["evidence"][-1]["reason"]
    assert T.control("costar:4", TODAY)["current"]["vacancy_share"] is None


def test_only_historical_tenants_and_offmarket_listing_stay_unknown(kit):
    r = T.occupancy_status("costar:3", TODAY)
    assert r["states"] == ["unknown"] and r["availability"]["available_sf"] == 0  # OffMarket listing is not availability


def test_availability_only_from_active_listings(kit):
    r = T.occupancy_status("costar:1", TODAY)
    assert set(r["states"]) == {"listed_available", "occupied"}
    av = r["availability"]
    assert av["available_sf"] == 2000 and av["asking_rent_per_sf_year"] == 24.0 and "Asking, not achieved" in av["asking_rent_basis"]


def test_confirmed_vacant_needs_whole_building_offer_and_no_tenant(kit):
    r = T.occupancy_status("costar:6", TODAY)
    assert "confirmed_vacant" in r["states"] and "listed_available" in r["states"] and "occupied" not in r["states"]


# ----------------------------------------------------------------------------------------------- community
def test_haversine_known_pair():
    assert abs(haversine_m(0, 0, 0, 1) - EARTH_R_M * math.pi / 180) < 0.5
    assert abs(haversine_m(LAT0, LON0, north(1000), LON0) - 1000) < 0.5


def test_bands_dedupe_public_only_and_wording(kit):
    r = H.community("costar:1")
    bands = {b["band"]: b for b in r["bands"]}
    assert bands["0-250 m"]["homes_listed"] == 1  # two MLS listings of home 9001 count once; the non-public one at 50 m is gone
    assert bands["250-500 m"]["homes_listed"] == 1 and bands["250-500 m"]["sold_price_undisclosed"] == 1
    assert bands["250-500 m"]["median_sold_price"] is None  # Texas non-disclosure: never filled in
    assert bands["500-1000 m"]["for_rent_active"] == 1 and bands["500-1000 m"]["median_asking_rent_month"] == 2100
    assert bands["500-1000 m"]["apartment_units"] == 120 and bands["1000-3000 m"]["homes_listed"] == 1
    assert r["nearest_home_listing_m"] == 100
    assert r["nearest_homes"][0]["listings_merged"] == 2 and "4B" not in json.dumps(r)  # no unit numbers
    assert "not households or population" in r["wording"]
    assert [p["distance_m"] for p in r["points"]] == sorted(p["distance_m"] for p in r["points"])
    assert r["engine_gate_home_m"] == 100


def test_noise_matches_the_layout_engine():
    site = {"gates": [{"gate": "Residential proximity", "status": "Pass", "value": 400}]}
    brief = dict(mw_it=20, rack_kw=20, redundancy="N+1", cooling="liquid", site_w=320, site_d=240, setback_m=8, expansion_pct=10)
    out = L.generate(brief, site, {"price": [40] * 24, "carbon": [400] * 24}, {})
    p = out["concepts"][0]["people"]
    at, _ = H.noise_model(20, "N+1", "liquid")
    assert abs(at(p["generator_to_boundary_m"] + 400) - p["noise_at_home_dba"]) <= 0.15


def test_compare_sites(kit):
    r = H.compare_sites(["costar:1", "costar:999"])
    assert r["sites"][0]["nearest_receptor_m"] == 100 and r["sites"][1] == {"parcel_id": "costar:999", "found": False}
    assert "not households" in r["wording"]


# ----------------------------------------------------------------------------------------------- redevelopment
def test_redevelopment_checklist_is_transparent(kit):
    r = R.redevelopment("costar:1")
    dc = r["categories"]["data_center_redevelopment"]
    items = {i["item"]: i for i in dc["items"]}
    assert items["Heavy power"]["status"] == "pass" and items["Distance to homes"]["status"] == "flag"  # home at 100 m
    assert dc["passes"] + sum(1 for i in dc["items"] if i["status"] == "flag") == dc["known"]
    assert all(i["reason"] and i["source"] for c in r["categories"].values() for i in c["items"])
    assert r["market_status"].startswith("Listed for lease")
    unknown = R.redevelopment("costar:4")["categories"]["data_center_redevelopment"]
    assert unknown["unknown"] >= 4  # missing facts stay unknown, never pass or fail


def test_off_market_is_never_for_sale(kit):
    r = R.redevelopment("costar:5")
    assert "Not marketed" in r["market_status"] and "Nothing implies it is for sale" in r["market_status"]
    c = R.find_candidates("Houston", "data_center_redevelopment", 10)
    assert c["candidates"]
    for x in c["candidates"]:  # only the property with an active sale listing (costar:6) may read as for sale
        assert (x["market_status"] == "Listed for sale") == (x["parcel_id"] == "costar:6")


def test_searches(kit):
    av = R.with_available_space("Houston")["properties"]
    assert {p["parcel_id"] for p in av} == {"costar:1", "costar:6"}
    dd = {p["parcel_id"]: p for p in R.needs_leasing_diligence("Houston")["properties"]}
    assert dd["costar:1"]["unknown_expirations"] == 1 and dd["costar:5"]["subleases"] == 1


# ----------------------------------------------------------------------------------------------- endpoints
def test_endpoints(kit):
    from app.main import app
    c = TestClient(app)
    assert c.get("/costar/control/costar:1").status_code == 200
    assert c.get("/costar/control/costar:999").status_code == 404
    assert c.get("/costar/occupancy/costar:4").json()["states"] == ["unknown"]
    assert c.get("/costar/redevelopment/costar:6").status_code == 200
    assert c.get(f"/costar/community?lat={LAT0}&lon={LON0}").json()["nearest_home_listing_m"] == 100
    assert c.get("/costar/candidates?market=Houston&category=expansion").status_code == 200
    assert c.get("/costar/candidates?category=nope").status_code == 422
    assert c.post("/costar/community/compare", json={"parcel_ids": ["costar:1"]}).json()["sites"][0]["found"] is True


def test_real_store_if_loaded():
    if not Path(DB.DB_PATH).exists():
        pytest.skip("real parcel store not loaded")
    with DB.session() as c:
        if not c.execute("SELECT 1 FROM sqlite_master WHERE name='occupancies'").fetchone():
            pytest.skip("derived tables not built")
        n = c.execute("SELECT COUNT(*) FROM occupancies WHERE is_current = 1").fetchone()[0]
    assert n == 11179  # matches the kit docs (concepts/tenants-and-occupancy.md)
