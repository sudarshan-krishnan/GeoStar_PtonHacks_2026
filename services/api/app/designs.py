"""Imported designs in MongoDB Atlas: the user's own DXF in GridFS, its parsed summary, notes and builds in `designs`.

These are the user's drawings, not CoStar data, so they live in Atlas in full. Without Atlas nothing is stored and
the import still works (the response just has no design_id).
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from . import mongo

INDEXES = [([("created_at", -1)], {}), ([("sha256", 1)], {}), ([("project_id", 1), ("created_at", -1)], {})]


def _coll():
    c = mongo.coll("designs")
    if c is not None:
        mongo.ensure_indexes("designs", INDEXES)
    return c


def save_dxf(name: str, text: str, parsed: dict[str, Any], project_id: str | None = None) -> str | None:
    c = _coll()
    if c is None:
        return None
    sha = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()
    same = c.find_one({"sha256": sha}, {"_id": 1})
    if same:  # deduplicate re-uploads of the same file
        return same["_id"]
    try:
        import gridfs
        file_id = gridfs.GridFS(mongo.db(), collection="design_files").put(
            text.encode("utf-8", "replace"), filename=name, content_type="application/dxf", sha256=sha)
    except Exception:
        file_id = None
    did = uuid.uuid4().hex[:16]
    fp = parsed.get("footprint") or {}
    c.insert_one({"_id": did, "name": name[:200], "kind": "dxf", "sha256": sha, "file_id": file_id, "bytes": len(text),
                  "project_id": project_id, "units": parsed.get("units"), "units_assumed": parsed.get("units_assumed"),
                  "layers": [l.get("name") if isinstance(l, dict) else l for l in (parsed.get("layers") or [])][:200],
                  "footprint": mongo.jsonable(fp), "warnings": (parsed.get("warnings") or [])[:50], "notes": [], "builds": [],
                  "created_at": datetime.now(timezone.utc)})
    return did


def save_build(design_id: str | None, name: str, footprint: dict[str, Any], notes: list[dict[str, Any]], fit: dict[str, Any],
               project_id: str | None = None) -> str | None:
    c = _coll()
    if c is None:
        return None
    entry = {"at": datetime.now(timezone.utc), "footprint": mongo.jsonable(footprint), "fit": mongo.jsonable(fit)}
    if design_id and c.find_one({"_id": design_id}, {"_id": 1}):
        c.update_one({"_id": design_id}, {"$set": {"notes": mongo.jsonable(notes)[:40], "footprint": mongo.jsonable(footprint)},
                                          "$push": {"builds": {"$each": [entry], "$slice": -20}}})
        return design_id
    did = uuid.uuid4().hex[:16]
    c.insert_one({"_id": did, "name": name[:200] or "Untitled design", "kind": "footprint", "project_id": project_id,
                  "footprint": mongo.jsonable(footprint), "notes": mongo.jsonable(notes)[:40], "builds": [entry],
                  "created_at": datetime.now(timezone.utc)})
    return did


def listing(limit: int = 30) -> list[dict[str, Any]] | None:
    c = _coll()
    if c is None:
        return None
    rows = c.find({}, {"name": 1, "kind": 1, "units": 1, "footprint": 1, "created_at": 1, "notes": {"$slice": 3},
                       "builds": {"$slice": -1}}).sort("created_at", -1).limit(limit)
    return [_clean(r) for r in rows]


def get(design_id: str) -> dict[str, Any] | None:
    c = _coll()
    if c is None:
        return None
    d = c.find_one({"_id": design_id}, {"file_id": 0})
    return _clean(d) if d else None


def file_text(design_id: str) -> str | None:
    c = _coll()
    if c is None:
        return None
    d = c.find_one({"_id": design_id}, {"file_id": 1})
    if not d or not d.get("file_id"):
        return None
    import gridfs
    return gridfs.GridFS(mongo.db(), collection="design_files").get(d["file_id"]).read().decode("utf-8", "replace")


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    out = {("id" if k == "_id" else k): v for k, v in d.items() if k != "file_id"}
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    for b in out.get("builds") or []:
        if isinstance(b.get("at"), datetime):
            b["at"] = b["at"].isoformat()
    return out
