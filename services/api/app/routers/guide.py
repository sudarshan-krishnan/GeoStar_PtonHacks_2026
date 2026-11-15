"""PlotStar Guide endpoints.

GET /guide/session   a signed ElevenLabs conversation URL for the voice agent (creates or syncs the agent first)
GET /guide/status    whether the voice agent is configured and in sync
GET /guide/agents    the agents and services running behind PlotStar, for the guide to read out
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import guide

router = APIRouter(tags=["guide"])


@router.get("/guide/session")
def session() -> dict[str, Any]:
    try:
        return guide.signed_url()
    except guide.GuideError as e:
        raise HTTPException(503, str(e)) from e


@router.get("/guide/status")
def status() -> dict[str, Any]:
    return guide.status()


@router.get("/guide/agents")
def agents() -> dict[str, Any]:
    return {"services": guide.services()}
