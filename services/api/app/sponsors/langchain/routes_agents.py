"""Deep Agents endpoints: start a site evaluation or a conversation turn, stream its live execution, inspect evidence.

POST /agents/site-evaluation       Studio generate body (+ stage) -> {run_id}; the orchestrator scores the site
POST /agents/chat                  question + the Studio's live state -> {run_id}; one conversational agent everywhere
GET  /agents/runs                  recent runs
GET  /agents/runs/{id}             snapshot: nodes, plan, findings, evidence (without raw data), score, answer
GET  /agents/runs/{id}/stream      server-sent events: node, plan, evidence, finding, score, proposal, answer, status
GET  /agents/runs/{id}/evidence/{eid}   one evidence record with its full tool output (local only, never sent to a model
                                   unless COPILOT_LLM_COSTAR=1)
POST /agents/runs/{id}/approval    approve or reject a paused action (human in the loop)
GET  /agents/architecture          agents, tools, models, MCP status, scoring rule, harness features
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.sponsors.langchain.deep_agents import agents, runtime
from app.routers.studio import GenerateIn

router = APIRouter(prefix="/agents", tags=["agents"])


class EvaluateIn(GenerateIn):
    stage: str | None = Field(None, max_length=30)
    market: str | None = Field(None, max_length=40)
    concept_id: str | None = Field(None, max_length=40)


class ChatIn(EvaluateIn):
    question: str = Field(..., min_length=1, max_length=800)
    thread_id: str = Field("default", max_length=60)
    selected: str | None = Field(None, max_length=24)
    facility_id: str | None = Field(None, max_length=80)
    last_score: dict[str, Any] | None = None


def _req(q: EvaluateIn) -> dict[str, Any]:
    site = q.site.model_dump()
    return dict(brief=q.brief.model_dump(), site=site, priorities=q.priorities, assumptions=q.assumptions,
                edits={k: e.model_dump() for k, e in q.edits.items()}, concept_id=q.concept_id, stage=q.stage,
                market=q.market or "Houston")


@router.post("/site-evaluation")
def site_evaluation(q: EvaluateIn) -> dict[str, Any]:
    if not q.site.id:
        raise HTTPException(422, "Choose a site first.")
    run = agents.start_site_evaluation(_req(q), q.stage)
    return {"run_id": run.id, "status": run.status}


@router.post("/chat")
def chat(q: ChatIn) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,60}", q.thread_id):
        raise HTTPException(422, "Invalid thread id")
    req = _req(q) | dict(selected=q.selected, facility_id=q.facility_id,
                         last_score={k: (q.last_score or {}).get(k) for k in ("verdict", "score")} if q.last_score else None)
    run = agents.start_chat(q.question, req, f"chat-{q.thread_id}", q.stage)
    return {"run_id": run.id, "status": run.status}


@router.get("/runs")
def runs(limit: int = 20) -> dict[str, Any]:
    return {"runs": runtime.recent(max(1, min(limit, 60)))}


def _run(run_id: str) -> runtime.Run:
    r = runtime.get(run_id)
    if r is None:
        raise HTTPException(404, "Unknown or expired run")
    return r


@router.get("/runs/{run_id}")
def run_snapshot(run_id: str) -> dict[str, Any]:
    return _run(run_id).snapshot()


@router.get("/runs/{run_id}/evidence/{eid}")
def evidence(run_id: str, eid: str) -> dict[str, Any]:
    r = _run(run_id)
    e = r.evidence.get(eid)
    if e is None:
        raise HTTPException(404, "Unknown evidence id")
    return json.loads(runtime.dumps(e))


class ApprovalIn(BaseModel):
    approve: bool
    note: str | None = Field(None, max_length=300)


@router.post("/runs/{run_id}/approval")
def approval(run_id: str, q: ApprovalIn) -> dict[str, Any]:
    r = _run(run_id)
    if r.status != "awaiting_approval":
        raise HTTPException(409, "This run is not waiting for approval")
    r.decide(q.approve, q.note)
    return {"ok": True}


@router.get("/runs/{run_id}/stream")
async def stream(run_id: str, cursor: int = 0) -> StreamingResponse:
    r = _run(run_id)

    async def gen():
        pos, idle = max(0, cursor), 0
        yield "retry: 2000\n\n"
        while True:
            evs = r.since(pos)
            for e in evs:
                yield f"id: {e['seq']}\ndata: {runtime.dumps(e)}\n\n"
            pos += len(evs)
            if r.status in ("done", "error") and not evs:
                yield f"data: {runtime.dumps({'type': 'end', 'status': r.status})}\n\n"
                return
            idle = 0 if evs else idle + 1
            if idle and idle % 50 == 0:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/architecture")
def architecture() -> dict[str, Any]:
    return agents.architecture()
