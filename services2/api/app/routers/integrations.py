"""Sponsor API status and the Matterport proxy.

The Matterport token never reaches the browser: the UI asks this service for model metadata, and the
service calls the GraphQL API with basic auth. Results are cached in SQLite with their retrieval time.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from .. import config
from ..db import db_ready, session

router = APIRouter(tags=["integrations"])

MODEL_ID = re.compile(r"^[A-Za-z0-9]{11}$")
CACHE_DDL = """
CREATE TABLE IF NOT EXISTS matterport_cache (
    model_id      TEXT PRIMARY KEY,
    payload_json  TEXT NOT NULL,
    retrieved_at  TEXT NOT NULL
)
"""
MODEL_QUERY = """
query Model($id: ID!) {
  model(id: $id) { id name created visibility address { address } image { url } }
}
"""


def init() -> None:
    with session() as c:
        c.execute(CACHE_DDL)


def _matterport(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    if not (config.MATTERPORT_API_KEY and config.MATTERPORT_API_TOKEN):
        raise HTTPException(503, "Matterport credentials are not configured in .env")
    try:
        r = httpx.post(
            config.MATTERPORT_GRAPH_URL,
            json={"query": query, "variables": variables},
            auth=(config.MATTERPORT_API_KEY, config.MATTERPORT_API_TOKEN),
            timeout=20,
        )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Matterport unreachable: {type(e).__name__}") from e
    if r.status_code != 200:
        raise HTTPException(502, f"Matterport returned HTTP {r.status_code}")
    body = r.json()
    if body.get("errors"):
        raise HTTPException(502, f"Matterport error: {body['errors'][0].get('message', 'unknown')}")
    return body["data"]


@router.get("/matterport/models/{model_id}")
def matterport_model(model_id: str, refresh: bool = False) -> dict[str, Any]:
    if not MODEL_ID.match(model_id):
        raise HTTPException(422, "Invalid Matterport model id")
    with session() as c:
        if not refresh:
            hit = c.execute("SELECT * FROM matterport_cache WHERE model_id = ?", (model_id,)).fetchone()
            if hit:
                return {**json.loads(hit["payload_json"]), "retrieved_at": hit["retrieved_at"], "cached": True}
        data = _matterport(MODEL_QUERY, {"id": model_id})["model"]
        if data is None:
            raise HTTPException(404, "Model not visible to this API key")
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        c.execute("INSERT OR REPLACE INTO matterport_cache VALUES (?,?,?)", (model_id, json.dumps(data), now))
    return {**data, "retrieved_at": now, "cached": False}


@router.get("/integrations/status")
def status() -> dict[str, Any]:
    return {
        "costar": {"configured": (config.COSTAR_KIT_DIR / "index.md").exists(), "loaded": db_ready()},
        "matterport": {"configured": bool(config.MATTERPORT_API_KEY and config.MATTERPORT_API_TOKEN)},
        "vexcel": {
            "configured": bool(config.VEXCEL_API_KEY),
            "note": "Key present; imagery adapter waits for the Vexcel quickstart (endpoint and parameters).",
        },
        "bedrock": {"configured": bool(config.BEDROCK_MODEL_ID), "note": "Agent arrives in Phase 5"},
    }
