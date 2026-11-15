"""Saved Studio projects and decisions in MongoDB Atlas.

Optional: without MONGODB_URI, or when Atlas cannot be reached, every call reports "unavailable" and the web app
keeps projects in the browser instead. Nothing here is required for the analysis itself.

Collection `studio_projects`, one document per project:
  _id (client id), name, market, mw_it, site {id, name, address, loc: GeoJSON point}, status,
  brief, priorities, edits, preferred, reasons, decided_by, decided_at, summary, history[], created_at, updated_at
Indexes: updated_at (listing), site.loc 2dsphere (projects near a point).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from app import config

COLLECTION = "studio_projects"
_state: dict[str, Any] = {"client": None, "failed_at": 0.0, "reason": None, "indexed": False}


def _collection():
    """The collection, or None with the reason in _state. A failed connection is not retried for 30 s."""
    if not config.MONGODB_URI:
        _state["reason"] = "MONGODB_URI is not set."
        return None
    if _state["client"] is None:
        if time.time() - _state["failed_at"] < 30:
            return None
        try:
            from pymongo import MongoClient
            client = MongoClient(
                config.MONGODB_URI, appname="plotstar", serverSelectionTimeoutMS=4000, connectTimeoutMS=4000,
                retryWrites=True, retryReads=True, w="majority", maxPoolSize=20, minPoolSize=0, maxIdleTimeMS=60000)
            client.admin.command("ping")
            _state.update(client=client, reason=None)
        except Exception as e:  # driver missing, network blocked, bad credentials: all mean "not available"
            text = str(e)
            _state.update(failed_at=time.time(), reason=(
                "Atlas refused the connection. This machine's IP address is probably not on the Atlas network access list."
                if "SSL handshake failed" in text or "timed out" in text.lower() else f"{type(e).__name__}: {text[:160]}"))
            return None
    col = _state["client"][config.MONGODB_DB][COLLECTION]
    if not _state["indexed"]:
        col.create_index([("updated_at", -1)])                       # recent-first listing
        col.create_index([("site.loc", "2dsphere")])                 # projects near a point
        col.create_index([("status", 1), ("updated_at", -1)])        # portfolio rollups by status
        col.create_index([("market", 1)])
        _state["indexed"] = True
    return col


def use(collection: Any) -> None:
    """Tests inject a collection (mongomock)."""
    class _Holder(dict):
        def __getitem__(self, key):
            return {COLLECTION: collection} if key == config.MONGODB_DB else super().__getitem__(key)
    _state.update(client=_Holder(), failed_at=0.0, reason=None, indexed=True)
    config.MONGODB_URI = config.MONGODB_URI or "mongodb://injected"


def status() -> dict[str, Any]:
    col = _collection()
    return {"available": col is not None, "reason": _state["reason"], "database": config.MONGODB_DB if col is not None else None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save(project_id: str, doc: dict[str, Any]) -> dict[str, Any] | None:
    col = _collection()
    if col is None:
        return None
    now = _now()
    site = dict(doc.get("site") or {})
    if site.get("lat") is not None and site.get("lon") is not None:
        site["loc"] = {"type": "Point", "coordinates": [site["lon"], site["lat"]]}
    if str(site.get("id", "")).startswith("costar:"):  # data governance: CoStar descriptive fields stay in the local kit
        for k in ("name", "address", "custom"):
            site.pop(k, None)
    event = {"at": now, "status": doc.get("status"), "preferred": doc.get("preferred")}
    col.update_one({"_id": project_id},
                   {"$set": {**doc, "site": site, "updated_at": now}, "$setOnInsert": {"created_at": now},
                    "$push": {"history": {"$each": [event], "$slice": -50}}}, upsert=True)
    # audit trail + similarity embedding live in atlas.py; both are best-effort and never block the save
    try:
        from app.sponsors.mongodb import atlas
        atlas.audit(project_id, f"project.{doc.get('status', 'saved')}", doc)
        atlas.embed_project(project_id, {**doc, "site": site})
    except Exception:
        pass
    return get(project_id)


def get(project_id: str) -> dict[str, Any] | None:
    col = _collection()
    if col is None:
        return None
    d = col.find_one({"_id": project_id})
    if d:
        d["id"] = d.pop("_id")
    return d


def listing(limit: int = 30) -> list[dict[str, Any]] | None:
    col = _collection()
    if col is None:
        return None
    keep = {"name": 1, "market": 1, "mw_it": 1, "status": 1, "preferred": 1, "site.id": 1, "site.name": 1, "site.address": 1,
            "decided_by": 1, "updated_at": 1, "summary": 1}
    out = []
    for d in col.find({}, keep).sort("updated_at", -1).limit(limit):
        d["id"] = d.pop("_id")
        out.append(d)
    return out


def delete(project_id: str) -> bool | None:
    col = _collection()
    if col is None:
        return None
    return col.delete_one({"_id": project_id}).deleted_count == 1


def portfolio() -> dict[str, Any] | None:
    """A rollup of all saved projects, computed by Atlas with one aggregation pipeline, not in Python."""
    col = _collection()
    if col is None:
        return None
    agg = list(col.aggregate([{"$group": {
        "_id": None,
        "projects": {"$sum": 1},
        "decided": {"$sum": {"$cond": [{"$eq": ["$status", "decided"]}, 1, 0]}},
        "total_mw": {"$sum": {"$ifNull": ["$mw_it", 0]}},
        "total_capex": {"$sum": {"$ifNull": ["$summary.capex", 0]}},
        "avg_npv": {"$avg": "$summary.npv"},
        "markets": {"$addToSet": "$market"},
    }}]))
    by_status = {d["_id"]: d["count"] for d in col.aggregate(
        [{"$group": {"_id": "$status", "count": {"$sum": 1}}}])}
    base = agg[0] if agg else {"projects": 0, "decided": 0, "total_mw": 0, "total_capex": 0, "avg_npv": None, "markets": []}
    base.pop("_id", None)
    base["by_status"] = by_status
    return base


def near(lat: float, lon: float, km: float = 50, limit: int = 10) -> list[dict[str, Any]] | None:
    """Saved projects within `km` of a point, nearest first (2dsphere index). Empty list if none or the index is cold."""
    col = _collection()
    if col is None:
        return None
    try:
        cur = col.find({"site.loc": {"$near": {"$geometry": {"type": "Point", "coordinates": [lon, lat]},
                                               "$maxDistance": km * 1000}}},
                       {"name": 1, "market": 1, "mw_it": 1, "status": 1, "site.name": 1}).limit(limit)
        out = []
        for d in cur:
            d["id"] = d.pop("_id")
            out.append(d)
        return out
    except Exception:
        return []
