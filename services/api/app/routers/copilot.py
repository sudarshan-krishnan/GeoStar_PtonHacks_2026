"""Copilot and consequence endpoints for the Studio.

POST /copilot/ask           question + the Studio's generate body + active concept + selected object -> answer, tool
                            results, a what-if proposal (preview only) and the LangGraph trace
GET  /copilot/status        which model, tools and data the copilot can use right now
POST /studio/consequences   generate body + a brief patch -> before/after for every measured quantity (no model)
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import copilot, layout_engine
from .studio import GenerateIn, _grid

router = APIRouter(tags=["copilot"])


class AskIn(GenerateIn):
    question: str = Field(..., min_length=1, max_length=600)
    concept_id: str | None = Field(None, max_length=40)
    selected: str | None = Field(None, max_length=24)
    stage: str | None = Field(None, max_length=20)
    market: str | None = Field(None, max_length=40)
    thread_id: str = Field("default", max_length=60)


@router.post("/copilot/ask")
def ask(q: AskIn) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,60}", q.thread_id):
        raise HTTPException(422, "Invalid thread id")
    req = dict(brief=q.brief.model_dump(), site=q.site.model_dump(), priorities=q.priorities, assumptions=q.assumptions,
               edits={k: e.model_dump() for k, e in q.edits.items()}, concept_id=q.concept_id, selected=q.selected,
               stage=q.stage, market=q.market)
    try:
        return copilot.ask(q.question, req, q.thread_id, _grid)
    except ValueError as e:  # the engine rejected the brief (e.g. the site is too small)
        raise HTTPException(422, str(e)) from e


@router.get("/copilot/status")
def status() -> dict[str, Any]:
    return copilot.status()


class ConsequenceIn(GenerateIn):
    patch: dict[str, Any] = Field(default_factory=dict)
    concept_id: str | None = Field(None, max_length=40)


@router.post("/studio/consequences")
def consequences(q: ConsequenceIn) -> dict[str, Any]:
    bad = [k for k in q.patch if k not in copilot._PATCH_KEYS]
    if bad:
        raise HTTPException(422, f"Cannot change: {', '.join(bad)}")
    b0 = q.brief.model_dump()
    try:
        b1 = type(q.brief)(**{**b0, **q.patch}).model_dump()  # validates the patched brief with the same limits
        grid = _grid()
        site, edits = q.site.model_dump(), {k: e.model_dump() for k, e in q.edits.items()}
        before = layout_engine.generate(b0, site, grid, q.priorities, q.assumptions, edits)
        after = layout_engine.generate(b1, site, grid, q.priorities, q.assumptions, edits)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return copilot.consequences(before, after, q.concept_id)
