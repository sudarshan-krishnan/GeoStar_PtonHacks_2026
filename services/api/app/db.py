"""SQLite evidence store (demo). One connection per request; row access by name."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .config import DB_PATH


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def db_ready() -> bool:
    if not DB_PATH.exists():
        return False
    with session() as c:
        row = c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='parcels'").fetchone()
        return row is not None
