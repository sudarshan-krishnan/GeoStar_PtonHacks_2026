"""Shared MongoDB access for PlotStar's app state (copilot memory, deal runs, designs, audit, guide state).

One client for the whole API: the pooled MongoClient that store.py opens for Atlas, reused here, so every module
shares its connection pool, timeouts and retry settings. When Atlas is unreachable every helper returns None and the
caller falls back (memory or the local SQLite store); nothing in the analysis depends on Atlas being up.

Data rule (decided by the user): raw CoStar kit records, and payloads derived from them (comp rows, addresses, sale
prices, valuations), stay in the local store. Atlas holds PlotStar's own state and metadata keyed by CoStar ids.

Optimisations:
- writes that only need to land eventually (audit, telemetry-like logs) use w=1 and a background batch writer
  (insert_many every second or 100 docs), so a tool call never waits on an Atlas round trip;
- every collection gets the indexes its queries use, and TTL indexes bound the size of logs and caches;
- reads use projections so only the fields a caller shows are transferred.
"""
from __future__ import annotations

import atexit
import json
import queue
import threading
import time
from typing import Any

from . import config, store

_state: dict[str, Any] = {"indexed": set(), "writer": None}
_lock = threading.Lock()


def db():
    """The PlotStar database on Atlas, or None."""
    col = store._collection()
    if col is None:
        return None
    return getattr(col, "database", None)


def coll(name: str, fast: bool = False):
    """A collection; fast=True gives w=1 (acknowledged by the primary only) for logs and caches."""
    d = db()
    if d is None:
        return None
    if fast:
        from pymongo import WriteConcern
        return d.get_collection(name, write_concern=WriteConcern(w=1))
    return d[name]


def ensure_indexes(name: str, specs: list[tuple[list[tuple[str, int]], dict[str, Any]]]) -> None:
    """Create a collection's indexes once per process."""
    if name in _state["indexed"]:
        return
    c = coll(name)
    if c is None:
        return
    for keys, opts in specs:
        try:
            c.create_index(keys, **opts)
        except Exception:  # an existing index with other options, or a permission limit: not fatal
            pass
    _state["indexed"].add(name)


# ------------------------------------------------------------------------------------------- background writer
class _Writer:
    """Batches inserts per collection and flushes them with insert_many(ordered=False) off the request path."""

    def __init__(self) -> None:
        self.q: "queue.Queue[tuple[str, dict[str, Any]]]" = queue.Queue(maxsize=10_000)
        self.stats = {"queued": 0, "written": 0, "dropped": 0, "failed_batches": 0, "last_flush_ms": None}
        self.t = threading.Thread(target=self._run, name="mongo-writer", daemon=True)
        self.t.start()
        atexit.register(self.flush)

    def put(self, collection: str, doc: dict[str, Any]) -> None:
        try:
            self.q.put_nowait((collection, doc))
            self.stats["queued"] += 1
        except queue.Full:
            self.stats["dropped"] += 1

    def _drain(self, limit: int = 500) -> dict[str, list[dict[str, Any]]]:
        batch: dict[str, list[dict[str, Any]]] = {}
        for _ in range(limit):
            try:
                c, d = self.q.get_nowait()
            except queue.Empty:
                break
            batch.setdefault(c, []).append(d)
        return batch

    def flush(self) -> None:
        batch = self._drain(10_000)
        for name, docs in batch.items():
            c = coll(name, fast=True)
            if c is None:
                continue
            t0 = time.time()
            try:
                c.insert_many(docs, ordered=False)
                self.stats["written"] += len(docs)
            except Exception:
                self.stats["failed_batches"] += 1
            self.stats["last_flush_ms"] = round((time.time() - t0) * 1000, 1)

    def _run(self) -> None:
        while True:
            time.sleep(1.0)
            if not self.q.empty():
                self.flush()


def write_later(collection: str, doc: dict[str, Any]) -> None:
    """Queue an insert for the background writer (no-op when Atlas is not configured)."""
    if not config.MONGODB_URI:
        return
    with _lock:
        if _state["writer"] is None:
            _state["writer"] = _Writer()
    _state["writer"].put(collection, doc)


def writer_stats() -> dict[str, Any] | None:
    w = _state["writer"]
    return dict(w.stats, pending=w.q.qsize()) if w else None


# ------------------------------------------------------------------------------------------- LangGraph memory
CHECKPOINT_TTL_S = 14 * 86400


def checkpointer():
    """LangGraph checkpointer on Atlas (conversation memory survives restarts), else in-process memory."""
    d = db()
    if d is not None:
        try:
            from langgraph.checkpoint.mongodb import MongoDBSaver
            return MongoDBSaver(d.client, db_name=config.MONGODB_DB, checkpoint_collection_name="copilot_checkpoints",
                                writes_collection_name="copilot_checkpoint_writes", ttl=CHECKPOINT_TTL_S), "MongoDB Atlas"
        except Exception:
            pass
    from langgraph.checkpoint.memory import InMemorySaver
    return InMemorySaver(), "process memory"


# ------------------------------------------------------------------------------------------- small app state
def get_state(key: str) -> dict[str, Any] | None:
    c = coll("app_state")
    if c is None:
        return None
    try:
        return c.find_one({"_id": key}, {"_id": 0})
    except Exception:
        return None


def set_state(key: str, value: dict[str, Any]) -> bool:
    c = coll("app_state")
    if c is None:
        return False
    try:
        c.replace_one({"_id": key}, {**value, "updated_at": time.time()}, upsert=True)
        return True
    except Exception:
        return False


def status() -> dict[str, Any]:
    d = db()
    out: dict[str, Any] = {"atlas": d is not None, "database": config.MONGODB_DB if d is not None else None,
                           "writer": writer_stats(), "raw_costar_in_atlas": False,
                           "rule": "Raw CoStar records and CoStar-derived payloads stay local; Atlas holds app state and metadata keyed by CoStar ids."}
    if d is not None:
        try:
            names = set(d.list_collection_names())
            out["collections"] = {n: d[n].estimated_document_count() for n in sorted(names) if n in {
                "copilot_checkpoints", "copilot_checkpoint_writes", "deal_runs", "designs", "fs.files", "audit_log",
                "costar_analyses", "comp_selections", "scenarios", "inspection_notes", "app_state"}}
        except Exception as e:
            out["error"] = f"{type(e).__name__}"
    return out


def jsonable(v: Any) -> Any:
    return json.loads(json.dumps(v, default=str))
