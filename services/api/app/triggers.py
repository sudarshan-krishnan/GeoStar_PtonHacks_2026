"""In-app triggers and stream processing over Atlas change streams.

Atlas Triggers (scripts/atlas_triggers.py) own the decisions/projects rules when they exist; this worker fills
the gaps and runs everything when they do not:
  - high-watts alert at telemetry ingest (time-series collections cannot have change streams or Atlas Triggers)
  - tumbling one-minute windows over grid_telemetry -> grid_minutes (the Stream Processing pattern, without an SPI)
  - decisions insert -> notifications (+ optional webhook), projects change -> portfolio_snapshot, only when Atlas
    Triggers are not recorded in meta.atlas_triggers
Everything is best-effort and off the request path.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from . import atlas, config, store

ALERT_WATTS = float(__import__("os").getenv("PLOTSTAR_ALERT_WATTS", "900"))
WEBHOOK = __import__("os").getenv("PLOTSTAR_WEBHOOK_URL", "")
_state: dict[str, Any] = {"running": False, "started_at": None, "events": 0, "alerts": 0, "windows": 0, "last_event": None,
                          "atlas_owned": [], "error": None, "rules": []}
_stop = threading.Event()


def atlas_owned() -> list[str]:
    db = atlas._db()
    if db is None:
        return []
    m = db.meta.find_one({"_id": "atlas_triggers"})
    return list((m or {}).get("triggers") or [])


# ------------------------------------------------------------------------------------------------ ingest-time rule
def on_telemetry(machine: str, watts: float | None, state: str | None, source: str) -> None:
    """Called by atlas.telemetry_point after the insert. Writes an alert when watts exceed the threshold."""
    if watts is None or watts <= ALERT_WATTS:
        return
    try:
        db = atlas._db()
        if db is None:
            return
        db.alerts.insert_one({"kind": "high_watts", "machine": machine, "watts": watts, "threshold": ALERT_WATTS, "state": state,
                              "source": source, "rule": "in-app (time-series collections cannot trigger)", "at": datetime.now(timezone.utc),
                              "message": f"{machine} drew {watts:.0f} W, above the {ALERT_WATTS:.0f} W alert line"})
        _state["alerts"] += 1
    except Exception:
        pass


# ------------------------------------------------------------------------------------------------ windows
def rollup_minutes(db, minutes: int = 5) -> int:
    """Tumbling one-minute windows per machine, computed by an Atlas aggregation and upserted into grid_minutes."""
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    rows = list(db.grid_telemetry.aggregate([
        {"$match": {"ts": {"$gte": since}}},
        {"$group": {"_id": {"minute": {"$dateTrunc": {"date": "$ts", "unit": "minute"}}, "machine": "$meta.machine"},
                    "avg_watts": {"$avg": "$watts"}, "max_watts": {"$max": "$watts"}, "min_watts": {"$min": "$watts"}, "points": {"$sum": 1}}}]))
    for r in rows:
        db.grid_minutes.update_one({"minute": r["_id"]["minute"], "machine": r["_id"]["machine"]},
                                   {"$set": {"avg_watts": r["avg_watts"], "max_watts": r["max_watts"], "min_watts": r["min_watts"],
                                             "points": r["points"], "source": "in-app window", "updated_at": datetime.now(timezone.utc)}}, upsert=True)
    return len(rows)


def refresh_portfolio(db, change: str) -> None:
    agg = list(db.studio_projects.aggregate([{"$group": {"_id": None, "projects": {"$sum": 1}, "mw": {"$sum": "$mw_it"},
                                                          "capex": {"$sum": {"$ifNull": ["$summary.capex", 0]}},
                                                          "decided": {"$sum": {"$cond": [{"$eq": ["$status", "decided"]}, 1, 0]}}}}]))
    t = agg[0] if agg else {"projects": 0, "mw": 0, "capex": 0, "decided": 0}
    t.pop("_id", None)
    db.portfolio_snapshot.update_one({"_id": "latest"}, {"$set": {**t, "source": "in-app", "updated_at": datetime.now(timezone.utc), "last_change": change}}, upsert=True)


def notify_decision(db, doc: dict[str, Any]) -> None:
    msg = f"{doc.get('by') or 'Someone'}: {doc.get('event')} on {doc.get('project_id')}"
    db.notifications.insert_one({"kind": "decision", "source": "in-app", "project_id": doc.get("project_id"), "event": doc.get("event"),
                                 "by": doc.get("by"), "status": doc.get("status"), "mw_it": doc.get("mw_it"), "at": datetime.now(timezone.utc), "message": msg})
    if WEBHOOK:
        try:
            httpx.post(WEBHOOK, json={"text": f"PlotStar: {msg}"}, timeout=5)
        except Exception:
            pass


# ------------------------------------------------------------------------------------------------ worker
def _run() -> None:
    db = atlas._db()
    if db is None:
        _state["error"] = store._state["reason"]; return
    owned = atlas_owned()
    _state["atlas_owned"] = owned
    _state["rules"] = [f"high_watts > {ALERT_WATTS:.0f} W at ingest (in-app)",
                       "grid_minutes 1-min windows " + ("(Atlas scheduled trigger)" if "grid_minutes_rollup" in owned else "(in-app, every 60 s)"),
                       "decisions -> notifications " + ("(Atlas trigger)" if "decisions_insert" in owned else "(in-app change stream)"),
                       "projects -> portfolio_snapshot " + ("(Atlas trigger)" if "projects_change" in owned else "(in-app change stream)")]
    _state.update(running=True, started_at=atlas._now(), error=None)
    last_roll = 0.0
    try:
        with db.watch([{"$match": {"ns.coll": {"$in": ["decisions", "studio_projects"]}}}], full_document="updateLookup", max_await_time_ms=1000) as stream:
            while not _stop.is_set():
                if "grid_minutes_rollup" not in owned and time.time() - last_roll >= 60:
                    try:
                        _state["windows"] += rollup_minutes(db)
                    except Exception:
                        pass
                    last_roll = time.time()
                ch = stream.try_next()
                if ch is None:
                    continue
                _state["events"] += 1
                _state["last_event"] = {"op": ch["operationType"], "coll": ch["ns"]["coll"], "at": atlas._now()}
                try:
                    if ch["ns"]["coll"] == "decisions" and ch["operationType"] == "insert" and "decisions_insert" not in owned:
                        notify_decision(db, ch.get("fullDocument") or {})
                    elif ch["ns"]["coll"] == "studio_projects" and "projects_change" not in owned:
                        refresh_portfolio(db, ch["operationType"])
                except Exception:
                    pass
    except Exception as e:
        _state["error"] = f"{type(e).__name__}: {str(e)[:160]}"
    finally:
        _state["running"] = False


def start() -> None:
    if _state["running"] or not config.MONGODB_URI:
        return
    _stop.clear()
    threading.Thread(target=_run, daemon=True, name="plotstar-triggers").start()


def stop() -> None:
    _stop.set()


def status() -> dict[str, Any]:
    out = dict(_state)
    db = atlas._db()
    if db is not None:
        out["counts"] = {c: db[c].estimated_document_count() for c in ("notifications", "alerts", "grid_minutes", "portfolio_snapshot")}
        out["atlas_triggers"] = (db.meta.find_one({"_id": "atlas_triggers"}) or {}).get("triggers", [])
    return out
