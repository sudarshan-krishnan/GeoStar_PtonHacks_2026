"""Foundation tests: loader normalization + provenance, and the API over a tiny synthetic kit.

The fixture kit is synthetic test input written to a temp dir (never the real CoStar data).
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app.costar import loader

ENUMS = {
    "PropertyType": {"0": "Unknown", "2": "Industrial", "3": "Land", "11": "Multifamily"},
    "PropertySubtype": {"0": "Unknown", "52": "Industrial_Warehouse"},
    "BuildingClass": {"0": "Unknown", "1": "A"},
    "ConstructionStatus": {"1": "Existing"},
    "SalePriceStatus": {"0": "Unknown", "3": "Confirmed", "8": "Allocated"},
}


def _addr(lat: float, lon: float, market: int = 14) -> dict:
    return {"latitude": lat, "longitude": lon, "researchMarketId": market, "city": "Houston", "state": "TX",
            "streetNumber": "1", "streetName": "Test", "streetType": "Rd"}


def _write_kit(root: Path) -> Path:
    (root / "data").mkdir(parents=True)
    (root / "schemas").mkdir()
    (root / "schemas/enums.json").write_text(json.dumps(ENUMS))
    props = [
        {"id": 1, "propertyType": 2, "propertySubtype": 52, "lotSize": 10.0, "lotSizeMeasurementType": 2,
         "primaryAddress": _addr(29.9, -95.3),
         "propertyIndustrial": {"electric": {"hasHeavyPower": True, "ampsHigh": 3000}},
         "constructionEvents": [{"eventType": 2, "year": 2020}]},
        {"id": 2, "propertyType": 3, "lotSize": 87120.0, "lotSizeMeasurementType": 1,
         "primaryAddress": _addr(29.8, -95.4)},
        {"id": 3, "propertyType": 11, "lotSize": 2.0, "lotSizeMeasurementType": 0,
         "primaryAddress": _addr(34.0, -118.2, 20)},
    ]
    (root / loader.PROPERTY_FILE).write_text("\n".join(json.dumps(p) for p in props) + "\n")
    listings = [
        {"id": 900, "propertyId": 1, "listingStatus": 1, "monetaryUnit": 1,
         "forSaleSummary": {"askingPriceLow": 5_000_000, "askingPriceHigh": 5_500_000, "minDateOnMarket": "2026-01-02T00:00:00"}},
        {"id": 901, "propertyId": 2, "listingStatus": 3, "monetaryUnit": 1,
         "forSaleSummary": {"askingPriceLow": 1, "askingPriceHigh": 1}},  # off market: ignored
    ]
    (root / loader.LISTING_FILE).write_text("\n".join(json.dumps(x) for x in listings) + "\n")
    sales = [
        {"id": 50, "soldDate": "2019-05-01", "soldForPrice": 4_000_000, "salePriceStatus": 3, "monetaryUnit": 1,
         "entities": [{"propertyId": 1}]},
        {"id": 51, "soldDate": "2021-05-01", "soldForPrice": 9_000_000, "salePriceStatus": 3, "monetaryUnit": 1,
         "entities": [{"propertyId": 2, "allocatedPrice": 3_000_000, "allocatedPriceStatus": 8}, {"propertyId": 99}]},
    ]
    (root / loader.SALE_FILE).write_text("\n".join(json.dumps(x) for x in sales) + "\n")
    (root / loader.MATTERPORT_CSV).write_text(
        "PropertyId,MatterportModelId,Address,City,State\n1,abcdefghijk,1 Test Rd,Houston,TX\n3,,x,LA,CA\n")
    return root


@pytest.fixture()
def built(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    kit = _write_kit(tmp_path / "kit")
    db = tmp_path / "test.db"
    monkeypatch.setattr("app.db.DB_PATH", db)
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    stats = loader.build(kit, conn)
    yield stats, conn
    conn.close()


def test_loader_counts_and_candidates(built):
    stats, conn = built
    assert stats["properties"] == 3
    assert stats["candidates"] == 2  # Industrial + Land, not Multifamily
    assert stats["matterport_rows"] == 1


def test_lot_size_units(built):
    _, conn = built
    acres = {r["costar_property_id"]: r["lot_acres"] for r in conn.execute("SELECT * FROM parcels")}
    assert acres[1] == 10.0
    assert acres[2] == pytest.approx(2.0)  # 87,120 sq ft / 43,560
    assert acres[3] is None  # unknown unit is never guessed


def test_prices_and_provenance(built):
    _, conn = built
    p1 = dict(conn.execute("SELECT * FROM parcels WHERE costar_property_id = 1").fetchone())
    assert p1["asking_price_low"] == 5_000_000 and p1["asking_source_row"] == 1
    assert p1["availability"] == "For sale"
    assert p1["last_sale_price"] == 4_000_000 and p1["last_sale_status"] == "Confirmed"
    assert p1["source_file"] == loader.PROPERTY_FILE and p1["source_row"] == 1
    assert p1["has_heavy_power"] == 1 and p1["year_built"] == 2020

    p2 = dict(conn.execute("SELECT * FROM parcels WHERE costar_property_id = 2").fetchone())
    assert p2["asking_price_low"] is None  # off-market listing ignored
    assert p2["last_sale_price"] == 3_000_000  # allocated share, not the portfolio total
    assert p2["last_sale_status"] == "Allocated" and p2["last_sale_is_portfolio"] == 1


def test_api_sites_and_audit(built):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        r = client.get("/sites", params={"market": "Houston"})
        assert r.status_code == 200
        assert {s["parcel_id"] for s in r.json()["sites"]} == {"costar:1", "costar:2"}

        d = client.get("/sites/costar:1").json()
        assert d["matterport_model_ids"] == ["abcdefghijk"]
        assert d["labels"]["lot_acres"] == "Sourced"

        a = client.get("/audit/parcel/costar:2/asking_price_low").json()
        assert a["label"] == "Unknown" and a["value"] is None

        a = client.get("/audit/parcel/costar:1/last_sale_price").json()
        assert a["source_file"] == loader.SALE_FILE and a["source_row"] == 1
        assert a["extra"]["last_sale_status"] == "Confirmed"


def test_api_projects_block_unset_assumptions(built):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        r = client.post("/projects", json={"name": "Houston 100 MW", "capacity_mw": 100, "region": "Houston",
                                           "flexible_share": 0.3})
        assert r.status_code == 201
        body = r.json()
        assert "discount_rate" in body["assumptions_unset"]
        bad = client.post("/projects", json={"name": "x", "capacity_mw": 1, "region": "Houston",
                                             "flexible_share": 0.1, "assumptions": {"magic": {"value": 1, "source": "x"}}})
        assert bad.status_code == 422
