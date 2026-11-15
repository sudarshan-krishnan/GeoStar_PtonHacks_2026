"""CoStar building facts and Matterport scope. GraphQL is mocked; no live Matterport calls."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import config
from app.sponsors.costar import building as B
from app.db import db_ready, session
from app.main import app


@pytest.mark.parametrize("name, sf, bsf, scope", [
    ("Main warehouse", 60000, 69500, "whole building"),
    ("Main warehouse", 40000, 69500, "partial"),
    ("Main warehouse", 11650, 69500, "suite or room"),
    ("Suite 200 - 2,855 SF", 50000, 69500, "suite or room"),  # the name says suite even at 72%
    ("Conference Room", None, 69500, "suite or room"),
    ("Building A", None, 69500, "unknown"),
    ("Building A", 5000, None, "unknown"),
])
def test_classify(name, sf, bsf, scope):
    out = B.classify(name, sf, bsf)
    assert out["scope"] == scope and out["reason"]
    if sf and bsf:
        assert out["ratio"] == round(sf / bsf, 3)


def test_area_units():
    assert B._sqft({"areaFloor": 100, "units": "imperial"}) == 100
    assert round(B._sqft({"areaFloor": 100, "units": "metric"})) == 1076
    assert B._sqft({"units": "imperial"}) is None and B._sqft(None) is None


@pytest.fixture
def parcel():
    if not db_ready():
        pytest.skip("CoStar parcel store not loaded")
    with session() as c:
        row = c.execute("SELECT p.parcel_id, p.building_sf, m.model_id FROM parcels p JOIN matterport_models m "
                        "ON m.costar_property_id = p.costar_property_id WHERE p.building_sf > 0 LIMIT 1").fetchone()
        c.execute(B.CACHE_DDL)
        c.execute("DELETE FROM matterport_area_cache WHERE model_id = ?", (row["model_id"],))
    return dict(row)


def test_building_with_mocked_graphql(monkeypatch, parcel):
    calls = []

    def fake(query, variables):
        calls.append(variables["id"])
        return {"model": {"id": variables["id"], "name": "Suite 120", "created": "2026-01-01T00:00:00Z", "visibility": "public",
                          "floors": [{"id": "f", "label": "Floor 1", "dimensions": {"areaFloor": parcel["building_sf"] * 0.1, "units": "imperial"}}],
                          "rooms": [{"id": "r", "label": "Office"}]}}

    monkeypatch.setattr(config, "MATTERPORT_API_KEY", "k")
    monkeypatch.setattr(config, "MATTERPORT_API_TOKEN", "t")
    monkeypatch.setattr("app.routers.integrations._matterport", fake)
    c = TestClient(app)
    d = c.get(f"/costar/building/{parcel['parcel_id']}").json()
    m = next(x for x in d["matterport"] if x["model_id"] == parcel["model_id"])
    assert m["scope"] == "suite or room" and m["ratio"] == 0.1 and m["embed_url"].startswith("https://my.matterport.com/show/?m=")
    assert "not the proposed design" in d["scan_summary"]["note"]
    assert any(f["key"] == "existing_service_mw" for f in d["facts"])
    n = len(calls)
    c.get(f"/costar/building/{parcel['parcel_id']}")  # second read comes from the cache
    assert len(calls) == n


def test_matterport_error_does_not_break_the_dossier(monkeypatch, parcel):
    def boom(query, variables):
        raise HTTPException(502, "Matterport returned HTTP 500")

    monkeypatch.setattr(config, "MATTERPORT_API_KEY", "k")
    monkeypatch.setattr(config, "MATTERPORT_API_TOKEN", "t")
    monkeypatch.setattr("app.routers.integrations._matterport", boom)
    d = TestClient(app).get(f"/costar/building/{parcel['parcel_id']}?refresh=true").json()
    m = next(x for x in d["matterport"] if x["model_id"] == parcel["model_id"])
    assert m["scope"] == "unknown" and "HTTP 500" in m["error"]


def test_bad_ids():
    c = TestClient(app)
    assert c.get("/costar/building/23296").status_code == 422
    if db_ready():
        assert c.get("/costar/building/costar:999999999").status_code == 404


def test_conversion_screening(parcel):
    from app.sponsors.costar.building import conversion
    small, big = conversion(parcel["parcel_id"], 1, 20), conversion(parcel["parcel_id"], 400, 20)
    assert small["status"] in ("fits", "tight", "does not fit") and "not engineering feasibility" in small["note"]
    floor = lambda d: next(k for k in d["checks"] if k["name"].startswith("Floor area"))
    assert floor(big)["need"] > floor(small)["need"]  # more IT needs more floor
    assert big["status"] == "does not fit" and big["racks_that_fit_by_area"] < big["racks_needed"]
    assert any(m["item"] == "Floor load capacity" for m in small["missing"])


def test_conversion_endpoint_validation():
    c = TestClient(app)
    assert c.get("/costar/conversion/costar:1?mw_it=0").status_code == 422
    assert c.get("/costar/conversion/nope").status_code == 422
