"""CoStar comps, valuation and market context. Unit tests use small synthetic records; the integration tests run
against the real store and skip when it is not loaded."""
from __future__ import annotations

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.sponsors.costar import comps as C
from app.sponsors.costar import market as M
from app.sponsors.costar import valuation as V
from app.sponsors.costar.loader import Enums
from app.db import db_ready, session

ENUMS = Enums({
    "SalePriceStatus": {"0": "Unknown", "2": "Approximate", "3": "Confirmed", "5": "FullValue", "8": "Allocated"},
    "PortfolioType": {"0": "Individual", "2": "BulkPortfolio"},
    "SaleCondition": {"1": "DistressSale", "2": "TenThreeOneExchange", "25": "HighVacancyProperty"},
    "BelowMarketSaleReason": {"10": "CorrectionDeed"},
    "SaleType": {"0": "Unknown", "1": "Investment"},
})
PARCELS = {
    1: dict(name="A", address="1 Main", lat=29.70, lon=-95.40, market="Houston", submarket_id=7, property_type="Industrial", lot_acres=10.0, building_sf=100_000.0),
    2: dict(name="B", address="2 Main", lat=29.71, lon=-95.40, market="Houston", submarket_id=7, property_type="Land", lot_acres=5.0, building_sf=None),
    3: dict(name="C", address="3 Main", lat=29.72, lon=-95.40, market="Houston", submarket_id=7, property_type="Office", lot_acres=2.0, building_sf=50_000.0),
}


def rec(cid, pid, price=1_000_000, status=3, sold="2024-06-01", **kw):
    r = {"id": cid, "soldDate": f"{sold}T12:00:00-04:00", "soldForPrice": price, "salePriceStatus": status, "monetaryUnit": 1,
         "portfolioType": 0, "entities": [{"id": cid * 10, "propertyId": pid, "assetType": 1}],
         "assessment": {"landValue": 250_000, "totalValue": 1_000_000}}
    r.update(kw)
    return r


def rows_of(*records):
    out, _, _ = C.comp_rows(list(enumerate(records, 1)), ENUMS, PARCELS)
    return {r["comp_id"]: r for r in out}


def test_grain_status_and_usable_filtering():
    rows = rows_of(
        rec(1, 1),                                                    # usable improved industrial sale
        rec(2, 1, price=None),                                        # no price (Houston -> Texas note)
        rec(3, 1, saleConditions=[1]),                                # distress
        rec(4, 1, belowMarketSaleReasons=[10]),                       # correction deed
        rec(5, 3),                                                    # office: not a site type
        rec(6, 1, entities=[{"id": 61, "propertyId": 1, "assetType": 1, "allocatedPrice": 500_000, "allocatedPriceStatus": 8},
                            {"id": 62, "propertyId": 2, "assetType": 1, "allocatedPrice": 400_000, "allocatedPriceStatus": 8}],
            portfolioType=2),                                         # portfolio: one row per kit entity, allocated, unusable
        rec(7, 99),                                                   # property outside the kit: no row
        rec(8, 1, monetaryUnit=4),                                    # euro
    )
    assert rows[1]["usable"] == 1 and rows[1]["price_status"] == "Confirmed" and rows[1]["price_kind"] == "sold"
    assert "Texas" in rows[2]["reason"] and rows[3]["reason"].startswith("condition of sale: DistressSale")
    assert rows[4]["reason"] == "not a market sale: CorrectionDeed"
    assert "Office" in rows[5]["reason"]
    assert rows[6]["price_kind"] == "allocated" and rows[6]["price_status"] == "Allocated" and not rows[6]["usable"]
    assert 7 not in rows and rows[8]["reason"] == "not in US dollars"
    out, n, ent = C.comp_rows(list(enumerate([rec(6, 1, entities=[{"id": 61, "propertyId": 1, "assetType": 1},
                                                                   {"id": 62, "propertyId": 2, "assetType": 1}])], 1)), ENUMS, PARCELS)
    assert n == 1 and ent == 2 and len(out) == 2  # one deal, two kit properties


def test_per_sf_and_land_per_acre_arithmetic():
    r = rows_of(rec(1, 1, price=12_000_000))[1]
    assert r["per_sf"] == pytest.approx(120.0)                         # 12M / 100,000 SF
    assert r["all_in_per_acre"] == pytest.approx(1_200_000)            # 12M / 10 acres
    assert r["land_share"] == 0.25 and r["land_per_acre"] == pytest.approx(300_000)  # 12M x 25% / 10 acres
    land = rows_of(rec(2, 2, price=2_000_000))[2]
    assert land["per_sf"] is None and land["land_per_acre"] == pytest.approx(400_000) and land["land_share_basis"] == "land sale"


SUBJECT = dict(parcel_id="costar:500", lat=29.70, lon=-95.40, market="Houston", property_type="Industrial", building_sf=100_000.0, lot_acres=10.0)
TODAY = date(2026, 11, 14)


def comp(cid, km_north=1.0, per_sf=100.0, sold="2025-01-01", status="Confirmed", ptype="Industrial", bsf=100_000.0, parcel=None):
    return dict(comp_id=cid, parcel_id=parcel or f"costar:{cid}", market="Houston", usable=1, reason=None,
                lat=29.70 + km_north / 111.0, lon=-95.40, per_sf=per_sf, land_per_acre=per_sf * 1000, all_in_per_acre=None,
                sold_date=sold, price_status=status, property_type=ptype, building_sf=bsf, lot_acres=10.0, land_share=None,
                land_share_basis=None, price=int(per_sf * bsf), name=f"comp {cid}", address=None, source_row=cid)


def test_radius_ladder_widens_until_three_current_comps():
    rows = [comp(1, 1), comp(2, 2), comp(3, 8), comp(4, 20)]
    r = V.evaluate(SUBJECT, rows, today=TODAY)
    assert r["status"] == "ok" and r["radius_km"] == 10.0 and r["estimate"]["n"] == 3
    assert [s["radius_km"] for s in r["search"]][:2] == [5.0, 10.0]


def test_stale_comps_are_shown_but_not_used_and_insufficient_is_null():
    rows = [comp(1, sold="2025-03-01"), comp(2, sold="2024-08-01"), comp(3, sold="2004-03-23"), comp(4, sold="2010-01-01")]
    r = V.evaluate(SUBJECT, rows, today=TODAY)
    assert r["status"] == "insufficient_evidence" and r["estimate"] is None and r["reasons"]
    stale = {c["comp_id"]: c for c in r["comps"]}
    assert stale[3]["stale"] and not stale[3]["used"] and stale[3]["age_years"] > 20
    assert r["n_stale"] == 2
    ok = V.evaluate(SUBJECT, rows, today=TODAY, max_age_years=25)  # widening the window lets the old sales count
    assert ok["status"] == "ok" and ok["estimate"]["n"] == 4


def test_date_filter_uses_the_max_age():
    rows = [comp(1, sold="2023-01-01"), comp(2, sold="2022-12-01"), comp(3, sold="2022-06-01")]
    assert V.evaluate(SUBJECT, rows, today=TODAY, max_age_years=4)["n_used"] == 2
    assert V.evaluate(SUBJECT, rows, today=TODAY, max_age_years=5)["n_used"] == 3


def test_estimates_median_weighted_and_range():
    rows = [comp(1, 0.5, 100), comp(2, 1, 120), comp(3, 2, 140), comp(4, 3, 160)]
    e = V.evaluate(SUBJECT, rows, today=TODAY)["estimate"]
    assert e["median"] == 130 and e["p25"] == 115 and e["p75"] == 145 and e["n"] == 4
    assert 100 < e["weighted_mean"] < 130  # nearer comps are cheaper here and weigh more


def test_exclusion_recalculates_and_subject_sale_never_counts():
    rows = [comp(1, 0.5, 100), comp(2, 1, 120), comp(3, 2, 140), comp(4, 3, 400), comp(5, 0, 90, parcel="costar:500")]
    base = V.evaluate(SUBJECT, rows, today=TODAY)
    assert base["estimate"]["n"] == 4 and not next(c for c in base["comps"] if c["is_subject"])["used"]
    less = V.evaluate(SUBJECT, rows, today=TODAY, exclude=[4])
    assert less["estimate"]["n"] == 3 and less["estimate"]["median"] == 120 and less["excluded"] == [4]


def test_similarity_parts_and_ranking():
    near_same = comp(1, 0.2, bsf=100_000.0)
    far_small = comp(2, 9.0, bsf=40_000.0, ptype="Flex", status="Approximate", sold="2022-01-01")
    s1 = V.score(SUBJECT, {**near_same, "distance_km": 0.2, "age_years": 1.9}, "sf", 10.0, 5.0)
    s2 = V.score(SUBJECT, {**far_small, "distance_km": 9.0, "age_years": 4.9}, "sf", 10.0, 5.0)
    assert s1["total"] > s2["total"] and s2["type"] == 0.6 and s2["confidence"] == 0.5 and s2["size"] == 0.4
    total = sum(V.WEIGHTS[k] * s1[k] for k in V.WEIGHTS)
    assert s1["total"] == pytest.approx(total, abs=0.15)


def test_basis_follows_the_subject_and_size_band_filters():
    assert V.pick_basis(SUBJECT) == "sf" and V.pick_basis({**SUBJECT, "property_type": "Land"}) == "acre"
    rows = [comp(1, 1, bsf=10_000.0), comp(2, 1), comp(3, 2), comp(4, 3)]
    r = V.evaluate(SUBJECT, rows, today=TODAY)
    assert 1 not in [c["comp_id"] for c in r["comps"]] and r["rejected"]["size outside 1/3x to 3x the subject"] == 1


# ------------------------------------------------------------------------------------------- real store

real = pytest.mark.skipif(not db_ready(), reason="CoStar parcel store not loaded")


@real
def test_real_store_valuation_and_endpoints():
    try:
        C.ensure_built()
    except C.StoreMissing:
        pytest.skip("CoStar kit not available")
    from app.main import app
    c = TestClient(app)
    with session() as s:
        pid = s.execute("SELECT parcel_id FROM parcels WHERE market='Los Angeles' AND property_type='Industrial' "
                        "AND lat IS NOT NULL AND building_sf > 0 LIMIT 1").fetchone()[0]
    r = c.get(f"/costar/land/{pid}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ok", "insufficient_evidence") and set(body["underwriting"]) == {"acquisition_value", "low", "high", "label", "basis_text"}
    assert len(body["underwriting"]["basis_text"]) <= 200
    if body["status"] == "ok":
        v = body["value"]
        assert v["value"] == round(body["estimate"]["median"] * v["size"])
    assert c.get("/costar/land/costar:0").status_code == 404
    assert c.post(f"/costar/comps/{pid}", json={"exclude": [], "max_age_years": 10}).status_code == 200
    assert c.get(f"/costar/scenario/{pid}?pct=15").status_code == 200


@real
def test_market_aggregations_match_sql():
    try:
        C.ensure_built()
    except C.StoreMissing:
        pytest.skip("CoStar kit not available")
    with session() as s:
        p = dict(s.execute("SELECT parcel_id, market, submarket_id FROM parcels WHERE market='Houston' AND submarket_id IS NOT NULL "
                           "GROUP BY submarket_id ORDER BY COUNT(*) DESC LIMIT 1").fetchone())
        n_props = s.execute("SELECT COUNT(*) FROM parcels WHERE market=? AND submarket_id=?", (p["market"], p["submarket_id"])).fetchone()[0]
        n_avail = s.execute("SELECT COUNT(*) FROM parcels WHERE market=? AND submarket_id=? AND availability <> 'Not listed'",
                            (p["market"], p["submarket_id"])).fetchone()[0]
        n_deals = s.execute("SELECT COUNT(DISTINCT comp_id) FROM sale_comps WHERE market=? AND submarket_id=?",
                            (p["market"], p["submarket_id"])).fetchone()[0]
        n_market = s.execute("SELECT COUNT(*) FROM parcels WHERE market='Houston'").fetchone()[0]
    m = M.market_for_parcel(p["parcel_id"])["submarket"]
    assert m["inventory"]["n"] == n_props and m["availability"]["available"] == n_avail and m["transactions"]["deals"] == n_deals
    assert sum(b["n"] for b in m["lot_acres"]["bins"]) == m["lot_acres"]["n"]
    rows = M.compare_markets()["rows"]
    assert next(r for r in rows if r["market"] == "Houston")["properties"] == n_market
    assert sum(r["properties"] for r in M.compare_submarkets("Houston")["rows"]) <= n_market
