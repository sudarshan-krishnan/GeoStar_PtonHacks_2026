"""Saved projects: exercised against an in-memory MongoDB (mongomock); skipped when it is not installed."""
from __future__ import annotations

import pytest

mongomock = pytest.importorskip("mongomock")

from app.sponsors.mongodb import store  # noqa: E402


def test_save_list_load_delete():
    store.use(mongomock.MongoClient()["plotstar"][store.COLLECTION])
    assert store.status()["available"]
    doc = dict(name="Houston 20 MW", market="Houston", mw_it=20, status="generated", preferred=None,
               site={"id": "costar:1", "name": "Site", "lat": 29.9, "lon": -95.3}, brief={"mw": 20}, edits={})
    saved = store.save("proj-000001", doc)
    assert saved["id"] == "proj-000001" and saved["site"]["loc"] == {"type": "Point", "coordinates": [-95.3, 29.9]}
    assert saved["created_at"] and len(saved["history"]) == 1
    again = store.save("proj-000001", {**doc, "status": "decided", "preferred": "long-halls"})
    assert again["status"] == "decided" and again["created_at"] == saved["created_at"] and len(again["history"]) == 2
    rows = store.listing()
    assert [r["id"] for r in rows] == ["proj-000001"] and "brief" not in rows[0]

    store.save("proj-000002", dict(name="LA 40 MW", market="Los Angeles", mw_it=40, status="draft",
                                   summary={"capex": 4e8, "npv": 2e7}))
    store.save("proj-000001", {**doc, "status": "decided", "summary": {"capex": 2e8, "npv": 1e7}})
    roll = store.portfolio()
    assert roll["projects"] == 2 and roll["decided"] == 1 and roll["total_mw"] == 60
    assert roll["total_capex"] == 6e8 and sorted(roll["markets"]) == ["Houston", "Los Angeles"]
    assert roll["by_status"] == {"decided": 1, "draft": 1}

    assert store.delete("proj-000001") is True and store.get("proj-000001") is None
    assert store.portfolio()["projects"] == 1
