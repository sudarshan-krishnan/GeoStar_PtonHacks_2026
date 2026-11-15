"""Deal room: analyses, comp selections, scenarios, inspection notes, deal runs and the tool audit trail.

Data rule (decided by the user): raw CoStar records and CoStar-derived payloads (comp rows, addresses, prices,
valuations) stay in the local store. MongoDB Atlas holds PlotStar's own state and metadata keyed by CoStar ids, so a
deal can be reviewed and audited from any machine without copying licensed data to the cloud.

Atlas collections (schema_version 2):
  costar_analyses   {key, kind, parcel_id, params, label, n_sources, project_id, created_at}      payload: local
  comp_selections   {parcel_id, project_id, excluded[comp ids], basis, created_at}
  scenarios         {project_id, parcel_id, assumptions{}, note, created_at}
  inspection_notes  {parcel_id, project_id, note, author, created_at}
  deal_runs         {run_id, criteria, shortlist[{parcel_id, rank, npv.., gates_failed}], recommendation, timeline}
  audit_log         {tool, via, args, ok, ms, n_sources, error, at}   (background batched writer, w=1, 30-day TTL)
Local SQLite (plotstar.db): analysis_cache (payloads, 6 h) and deal_run_payloads (full results).
When Atlas is unreachable everything falls back to process memory and says so; nothing here blocks the analysis.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

from . import config, mongo
from .db import session

SCHEMA_VERSION = 2
CACHE_TTL_S = 6 * 3600
AUDIT_TTL_S = 30 * 86400
_lock = threading.Lock()
_mem: dict[str, Any] = {"audit": deque(maxlen=500), "cache": {},
                        "docs": {"comp_selections": [], "scenarios": [], "inspection_notes": [], "deal_runs": []}}
_db_override: Any = None
_local_ready = False

INDEXES: dict[str, list[tuple[list[tuple[str, int]], dict[str, Any]]]] = {
    "costar_analyses": [([("key", 1)], {"unique": True}), ([("parcel_id", 1), ("kind", 1), ("created_at", -1)], {}),
                        ([("created_at", 1)], {"expireAfterSeconds": CACHE_TTL_S * 4})],
    "comp_selections": [([("parcel_id", 1), ("created_at", -1)], {}), ([("project_id", 1), ("created_at", -1)], {})],
    "scenarios": [([("project_id", 1), ("created_at", -1)], {})],
    "inspection_notes": [([("parcel_id", 1), ("created_at", -1)], {}), ([("project_id", 1), ("created_at", -1)], {})],
    "deal_runs": [([("run_id", 1)], {"unique": True}), ([("created_at", -1)], {}), ([("shortlist.parcel_id", 1)], {})],
    "audit_log": [([("at", -1)], {}), ([("tool", 1), ("at", -1)], {}), ([("via", 1), ("at", -1)], {}),
                  ([("at", 1)], {"expireAfterSeconds": AUDIT_TTL_S, "name": "audit_ttl"})],
}


def use(db: Any) -> None:
    """Tests inject a database (mongomock)."""
    global _db_override
    _db_override = db


def _db():
    if _db_override is not None:
        return _db_override
    d = mongo.db()
    if d is not None:
        for name, specs in INDEXES.items():
            mongo.ensure_indexes(name, specs)
    return d


def _now() -> datetime:
    return datetime.now(timezone.utc)


def status() -> dict[str, Any]:
    db = _db()
    return {"backend": "MongoDB Atlas" if db is not None else "process memory (Atlas unavailable)",
            "database": config.MONGODB_DB if db is not None else None, "schema_version": SCHEMA_VERSION,
            "payloads": "local SQLite (CoStar-derived data stays on this machine)"}


# ---------------------------------------------------------------------------------------------- local payload store
def _local() -> bool:
    global _local_ready
    if _local_ready:
        return True
    try:
        with session() as c:
            c.execute("CREATE TABLE IF NOT EXISTS analysis_cache (key TEXT PRIMARY KEY, kind TEXT, parcel_id TEXT, "
                      "created REAL, payload TEXT)")
            c.execute("CREATE INDEX IF NOT EXISTS analysis_cache_parcel ON analysis_cache(parcel_id, kind)")
            c.execute("CREATE TABLE IF NOT EXISTS deal_run_payloads (run_id TEXT PRIMARY KEY, created REAL, payload TEXT)")
            c.commit() if hasattr(c, "commit") else None
        _local_ready = True
    except Exception:
        return False
    return True


# ---------------------------------------------------------------------------------------------- cache + analyses
def key(kind: str, params: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps({"k": kind, "p": params}, sort_keys=True, default=str).encode()).hexdigest()[:24]


def cached(kind: str, params: dict[str, Any]) -> dict[str, Any] | None:
    k = key(kind, params)
    hit = _mem["cache"].get(k)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1]
    if _local():
        try:
            with session() as c:
                row = c.execute("SELECT created, payload FROM analysis_cache WHERE key = ?", (k,)).fetchone()
            if row and time.time() - row[0] < CACHE_TTL_S:
                val = json.loads(row[1])
                _mem["cache"][k] = (row[0], val)
                return val
        except Exception:
            pass
    return None


def save_analysis(kind: str, params: dict[str, Any], result: Any, parcel_id: str | None,
                  sources: list[Any], label: str | None, project_id: str | None = None) -> str:
    """Payload to the local cache; metadata (no CoStar-derived values) to Atlas."""
    k = key(kind, params)
    now = time.time()
    _mem["cache"][k] = (now, result)
    if _local():
        try:
            with session() as c:
                c.execute("INSERT OR REPLACE INTO analysis_cache VALUES (?, ?, ?, ?, ?)",
                          (k, kind, parcel_id, now, json.dumps(result, default=str)))
                c.commit() if hasattr(c, "commit") else None
        except Exception:
            pass
    db = _db()
    if db is not None:
        try:
            db["costar_analyses"].replace_one({"key": k}, {
                "key": k, "kind": kind, "parcel_id": parcel_id, "params": mongo.jsonable(params), "label": label,
                "n_sources": len(sources), "project_id": project_id, "created_at": _now(), "schema_version": SCHEMA_VERSION,
                "payload": "local"}, upsert=True)
        except Exception:
            pass
    return k


def analyses(parcel_id: str | None = None, project_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    q = {k: v for k, v in {"parcel_id": parcel_id, "project_id": project_id}.items() if v}
    db = _db()
    if db is not None:
        try:
            return [_clean(d) for d in db["costar_analyses"].find(q, {"_id": 0}).sort("created_at", -1).limit(limit)]
        except Exception:
            pass
    return []


# ---------------------------------------------------------------------------------------------- deal records
def _insert(coll: str, doc: dict[str, Any]) -> dict[str, Any]:
    doc = {**mongo.jsonable(doc), "created_at": _now(), "schema_version": SCHEMA_VERSION}
    db = _db()
    if db is not None:
        try:
            db[coll].insert_one(dict(doc))
            return {"saved": True, "backend": "MongoDB Atlas"}
        except Exception as e:
            _mem["docs"][coll].append(doc)
            return {"saved": True, "backend": "process memory", "warning": f"Atlas write failed ({type(e).__name__})"}
    _mem["docs"][coll].append(doc)
    return {"saved": True, "backend": "process memory", "warning": "Atlas unavailable; kept until the API restarts"}


def save_comp_selection(parcel_id: str, excluded: list[str], basis: str | None, estimate: Any, project_id: str | None) -> dict[str, Any]:
    # the estimate is CoStar-derived, so only the selection (comp ids) goes to Atlas; it is recomputed on demand
    return _insert("comp_selections", {"parcel_id": parcel_id, "project_id": project_id,
                                       "excluded": [str(x) for x in excluded[:200]], "basis": basis})


def save_scenario(project_id: str, parcel_id: str | None, assumptions: dict[str, Any], note: str = "") -> dict[str, Any]:
    return _insert("scenarios", {"project_id": project_id, "parcel_id": parcel_id, "assumptions": assumptions, "note": note[:1000]})


def save_note(parcel_id: str | None, project_id: str | None, note: str, author: str = "") -> dict[str, Any]:
    if not note.strip():
        raise ValueError("The note is empty")
    return _insert("inspection_notes", {"parcel_id": parcel_id, "project_id": project_id, "note": note.strip()[:4000],
                                        "author": author[:80]})


def deal(project_id: str | None = None, parcel_id: str | None = None) -> dict[str, Any]:
    q = {k: v for k, v in {"project_id": project_id, "parcel_id": parcel_id}.items() if v}
    out: dict[str, Any] = {}
    db = _db()
    for coll in ("comp_selections", "scenarios", "inspection_notes"):
        rows: list[dict[str, Any]] = []
        if db is not None:
            try:
                rows = [_clean(d) for d in db[coll].find(q, {"_id": 0}).sort("created_at", -1).limit(50)]
            except Exception:
                rows = []
        rows += [_clean(d) for d in _mem["docs"][coll] if all(d.get(k) == v for k, v in q.items())]
        out[coll] = rows
    out["analyses"] = analyses(parcel_id, project_id)
    return out


# ---------------------------------------------------------------------------------------------- deal runs
_RUN_ROW = ("parcel_id", "rank", "npv", "npv_p10", "npv_p90", "capex", "months_to_power", "feasible", "gates_failed",
            "over_budget", "comps_used")


def save_deal_run(result: dict[str, Any]) -> str:
    """Full result (with CoStar names, addresses, acquisition values) locally; PlotStar's own outputs to Atlas."""
    run_id = uuid.uuid4().hex[:16]
    now = time.time()
    if _local():
        try:
            with session() as c:
                c.execute("INSERT OR REPLACE INTO deal_run_payloads VALUES (?, ?, ?)", (run_id, now, json.dumps(result, default=str)))
                c.commit() if hasattr(c, "commit") else None
        except Exception:
            pass
    memo = result.get("memo") or {}
    _insert("deal_runs", {
        "run_id": run_id, "criteria": result.get("criteria"), "ms": result.get("ms"), "rule": result.get("rule"),
        "shortlist": [{k: r.get(k) for k in _RUN_ROW} for r in result.get("shortlist", [])],
        "recommendation": memo.get("recommendation"), "because": memo.get("because"),
        "leader": next((r.get("parcel_id") for r in result.get("shortlist", []) if r.get("rank") == 1), None),
        "timeline": [{k: t.get(k) for k in ("node", "tool", "ok", "ms", "sources")} for t in result.get("timeline", [])],
        "payload": "local"})
    return run_id


def deal_runs(limit: int = 20) -> list[dict[str, Any]]:
    db = _db()
    if db is not None:
        try:
            return [_clean(d) for d in db["deal_runs"].find({}, {"_id": 0, "timeline": 0}).sort("created_at", -1).limit(limit)]
        except Exception:
            pass
    return [_clean({k: v for k, v in d.items() if k != "timeline"}) for d in reversed(_mem["docs"]["deal_runs"][-limit:])]


def deal_run(run_id: str) -> dict[str, Any] | None:
    if _local():
        try:
            with session() as c:
                row = c.execute("SELECT payload FROM deal_run_payloads WHERE run_id = ?", (run_id,)).fetchone()
            if row:
                return {"run_id": run_id, **json.loads(row[0])}
        except Exception:
            pass
    return None


# ---------------------------------------------------------------------------------------------- audit trail
def audit(tool: str, via: str, args: dict[str, Any], ok: bool, ms: float, n_sources: int, error: str | None) -> None:
    rec = {"tool": tool, "via": via, "args": _short(args), "ok": ok, "ms": round(ms, 1), "n_sources": n_sources,
           "error": (error or "")[:300] or None, "at": _now()}
    with _lock:
        _mem["audit"].appendleft(rec)
    if _db_override is not None:  # tests: write through to the injected database
        try:
            _db_override["audit_log"].insert_one(dict(rec))
        except Exception:
            pass
        return
    if mongo.db() is not None:
        mongo.ensure_indexes("audit_log", INDEXES["audit_log"])
        mongo.write_later("audit_log", dict(rec))  # batched off the request path, w=1


def audit_log(limit: int = 100, tool: str | None = None) -> dict[str, Any]:
    db = _db()
    if db is not None:
        try:
            q = {"tool": tool} if tool else {}
            calls = [_clean(d) for d in db["audit_log"].find(q, {"_id": 0}).sort("at", -1).limit(limit)]
            # include calls still queued for the batch writer, so the timeline is live
            seen = {(c["tool"], c["at"]) for c in calls}
            pending = [_clean(d) for d in list(_mem["audit"])[:limit] if (not tool or d["tool"] == tool)
                       and (d["tool"], _clean(d)["at"]) not in seen]
            merged = sorted(pending + calls, key=lambda c: c["at"], reverse=True)[:limit]
            return {"backend": "MongoDB Atlas", "calls": merged}
        except Exception:
            pass
    calls = [_clean(d) for d in list(_mem["audit"]) if not tool or d["tool"] == tool][:limit]
    return {"backend": "process memory", "calls": calls}


def _short(args: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in args.items():
        s = json.dumps(v, default=str)
        out[k] = v if len(s) <= 300 else s[:300] + "…"
    return mongo.jsonable(out)


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k != "_id"}
