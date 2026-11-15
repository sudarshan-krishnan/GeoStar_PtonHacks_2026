"""Keep the copilot, deal room and design tests off the real MongoDB Atlas cluster.

app.sponsors.mongodb.mongo is the shared Atlas helper for copilot memory, the audit writer, deal runs and designs. Tests that need a
database inject one themselves (store.use / deal_room.use with mongomock); everything else sees "no Atlas" and uses the
in-process fallbacks, so a test run never writes conversations, audit rows or files to the shared cluster.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _no_real_atlas(monkeypatch):
    from app.sponsors.langchain import copilot
    from app.sponsors.mongodb import mongo
    monkeypatch.setattr(mongo, "db", lambda: None)
    monkeypatch.setattr(mongo, "write_later", lambda *a, **k: None)
    copilot._GRAPH = None  # rebuild with the in-memory checkpointer inside the test
    yield
    copilot._GRAPH = None
