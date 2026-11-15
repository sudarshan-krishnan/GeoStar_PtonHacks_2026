"""Site walk: notes pinned in 3D and measurements drawn inside a Matterport scan of a CoStar building.

CoStar does not record a building's column grid, door sizes or (often) its clear height. A Matterport scan shows them.
This module stores what a person pins and measures in the scan, so GeoStar can use it: measured values fill the
conversion check (labelled Measured, with who and when), and the agents read the notes as field observations.

Everything here is authored by the user, not CoStar data, so it may be stored in Atlas and shown to the agents.
Stored in MongoDB Atlas (`site_walk`) when reachable, else in a local JSON file.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any

from app import config

CATEGORIES = {
    "power": "Power and electrical", "cooling": "Cooling and HVAC", "structure": "Structure and floor",
    "access": "Access and loading", "fire": "Fire and life safety", "water": "Water and plumbing", "other": "Other",
}
SEVERITIES = ("info", "concern", "blocker")

# kind -> (label, threshold in metres that a data center conversion needs, why). Thresholds are GeoStar assumptions.
KINDS: dict[str, tuple[str, float | None, str]] = {
    "clear_height": ("Clear height", None, "Floor to the underside of the structure; the layout engine's floor-to-floor height is the need."),
    "column_spacing": ("Column spacing", 9.0, "Two rack rows with hot and cold aisles need about 9 m between columns (GeoStar assumption)."),
    "door_width": ("Delivery door width", 1.2, "Racks arrive crated about 1.2 m wide (GeoStar assumption)."),
    "door_height": ("Delivery door height", 2.4, "Crated racks and cooling units need about 2.4 m (GeoStar assumption)."),
    "corridor_width": ("Corridor width", 1.5, "Moving racks to the halls needs about 1.5 m clear (GeoStar assumption)."),
    "room_length": ("Room length", None, "Context for hall layout."),
    "room_width": ("Room width", None, "Context for hall layout."),
    "other": ("Other", None, ""),
}

_LOCAL = config.REPO_ROOT / "services" / "api" / ".cache" / "site_walk.json"
_LOCK = threading.Lock()


def _coll():
    try:
        from app.sponsors.mongodb import mongo
        return mongo.coll("site_walk")
    except Exception:  # noqa: BLE001
        return None


def _local_read() -> list[dict[str, Any]]:
    try:
        return json.loads(_LOCAL.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _local_write(items: list[dict[str, Any]]) -> None:
    _LOCAL.parent.mkdir(parents=True, exist_ok=True)
    _LOCAL.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")


def store_name() -> str:
    return "MongoDB Atlas" if _coll() is not None else "this computer"


def items(parcel_id: str) -> list[dict[str, Any]]:
    c = _coll()
    if c is not None:
        try:
            return list(c.find({"parcel_id": parcel_id}, {"_id": 0}).sort("created_at", 1))
        except Exception:  # noqa: BLE001
            pass
    with _LOCK:
        return [x for x in _local_read() if x.get("parcel_id") == parcel_id]


def _save(doc: dict[str, Any]) -> dict[str, Any]:
    c = _coll()
    if c is not None:
        try:
            c.insert_one(dict(doc))
            return {**doc, "stored": "MongoDB Atlas"}
        except Exception:  # noqa: BLE001
            pass
    with _LOCK:
        all_ = _local_read()
        all_.append(doc)
        _local_write(all_)
    return {**doc, "stored": "this computer"}


def delete(parcel_id: str, item_id: str) -> bool:
    c = _coll()
    if c is not None:
        try:
            return c.delete_one({"parcel_id": parcel_id, "id": item_id}).deleted_count > 0
        except Exception:  # noqa: BLE001
            pass
    with _LOCK:
        all_ = _local_read()
        keep = [x for x in all_ if not (x.get("parcel_id") == parcel_id and x.get("id") == item_id)]
        _local_write(keep)
        return len(keep) < len(all_)


def _base(parcel_id: str, model_id: str | None, author: str | None, kind: str) -> dict[str, Any]:
    return {"id": uuid.uuid4().hex[:12], "type": kind, "parcel_id": parcel_id, "model_id": model_id,
            "author": (author or "").strip()[:80] or None, "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")}


def add_note(parcel_id: str, model_id: str | None, category: str, severity: str, text: str,
             position: dict[str, float] | None, normal: dict[str, float] | None, floor: int | None, author: str | None) -> dict[str, Any]:
    if category not in CATEGORIES:
        raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
    if severity not in SEVERITIES:
        raise ValueError(f"severity must be one of {', '.join(SEVERITIES)}")
    return _save({**_base(parcel_id, model_id, author, "note"), "category": category, "severity": severity,
                  "text": text.strip()[:1200], "position": position, "normal": normal, "floor": floor})


def add_measurement(parcel_id: str, model_id: str | None, kind: str, length_m: float, label: str | None,
                    points: list[dict[str, float]] | None, floor: int | None, author: str | None, method: str) -> dict[str, Any]:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    if not 0.05 <= length_m <= 500:
        raise ValueError("A measurement must be between 0.05 m and 500 m")
    return _save({**_base(parcel_id, model_id, author, "measurement"), "kind": kind, "length_m": round(float(length_m), 3),
                  "label": (label or KINDS[kind][0]).strip()[:80], "points": (points or [])[:20], "floor": floor,
                  "method": method})


def derived(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The value GeoStar uses per kind: the smallest measurement (the binding constraint), with how many were taken."""
    out: dict[str, dict[str, Any]] = {}
    for kind in KINDS:
        ms = [r for r in rows if r.get("type") == "measurement" and r.get("kind") == kind]
        if not ms:
            continue
        low = min(ms, key=lambda r: r["length_m"])
        out[kind] = {"label": KINDS[kind][0], "value_m": low["length_m"], "count": len(ms), "id": low["id"],
                     "method": low.get("method"), "by": low.get("author"), "at": low.get("created_at"),
                     "need_m": KINDS[kind][1], "why": KINDS[kind][2]}
    return out


def summary(parcel_id: str) -> dict[str, Any]:
    rows = items(parcel_id)
    notes = [r for r in rows if r.get("type") == "note"]
    ms = [r for r in rows if r.get("type") == "measurement"]
    by_cat: dict[str, int] = {}
    for n in notes:
        by_cat[n["category"]] = by_cat.get(n["category"], 0) + 1
    return {"parcel_id": parcel_id, "notes": notes, "measurements": ms, "derived": derived(rows),
            "counts": {"notes": len(notes), "measurements": len(ms), "blockers": sum(n["severity"] == "blocker" for n in notes),
                       "by_category": by_cat},
            "categories": CATEGORIES, "kinds": {k: {"label": v[0], "need_m": v[1], "why": v[2]} for k, v in KINDS.items()},
            "stored": store_name(),
            "label": "Measured (Matterport scan, by the user)",
            "note": "Notes and measurements are made by your team inside the Matterport scan. They are not CoStar data."}
