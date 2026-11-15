"""Live Grid endpoints: hardware telemetry in, emergency control, SSE stream out, Grid Passport."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .. import grid as G
from .. import livegrid as L
from .. import optimizer as O

router = APIRouter(tags=["live-grid"])


class TelemetryIn(BaseModel):
    machine: Literal["baseline", "plotstar"]
    watts: float | None = Field(None, ge=0, le=5000)
    progress: float | None = Field(None, ge=0, le=1)
    state: Literal["running", "throttled", "paused", "done", "idle"] | None = None
    source: Literal["measured", "estimated"] = "measured"
    meter: Literal["wall-plug", "chip", "estimated", "none"] | None = None


@router.post("/telemetry", status_code=202)
def telemetry(body: TelemetryIn, authorization: str | None = Header(None)) -> dict[str, Any]:
    if not L.check_token(authorization):
        raise HTTPException(401 if authorization else 503,
                            "Set TELEMETRY_API_KEY in .env and send 'Authorization: Bearer <key>'")
    L.record(body.machine, body.watts, body.progress, body.state, body.source, body.meter)
    return {"ok": True, "command": L.command()}


@router.get("/hardware/command")
def hardware_command() -> dict[str, Any]:
    """Polled by the workload controller and the ESP32 bridge."""
    return L.command()


class PlanIn(BaseModel):
    run_id: str


@router.post("/livegrid/plan")
def set_plan(body: PlanIn) -> dict[str, Any]:
    """Make the PlotStar machine follow this run's recommended hourly plan (and curtail to its depth on an event)."""
    loaded = O.load_run(body.run_id)
    if not loaded:
        raise HTTPException(404, "Unknown run_id")
    req, res = loaded
    o = res.get("optimized")
    if not o:
        L.set_plan(None)
        return {"plan": None}
    plan = {"run_id": body.run_id, "site": o.get("site_name"), "d": float(o.get("d") or 0), "f": o.get("f"),
            "flexible_share": float(req.get("flexible_share") or 0), "schedule": o.get("schedule")}
    L.set_plan(plan)
    return {"plan": {k: plan[k] for k in ("run_id", "site", "d", "f", "flexible_share")}}


class EmergencyIn(BaseModel):
    duration_s: float = Field(20, ge=3, le=600)
    depth: float | None = Field(None, ge=0.05, le=1.0, description="facility-level share to shed; defaults to the plan's d")
    source: Literal["software", "button"] = "software"


@router.post("/hardware/emergency")
def emergency(body: EmergencyIn) -> dict[str, Any]:
    """Start a grid event. Depth defaults to the curtailment depth the recommended plan relies on."""
    plan = L.STATE.plan
    depth = body.depth if body.depth is not None else (float(plan["d"]) if plan and plan.get("d") else 0.3)
    e = L.start_emergency(body.duration_s, depth, body.source)
    return {"emergency": e.active, "until": e.until, "facility_depth": e.facility_depth,
            "plan": plan and {k: plan.get(k) for k in ("run_id", "site", "d", "f", "flexible_share")}}


@router.post("/hardware/emergency/end")
def emergency_end() -> dict[str, Any]:
    p = L.end_emergency()
    return {"ended": p is not None, "passport": p}


@router.post("/hardware/reset")
def reset() -> dict[str, Any]:
    L.reset_simulation()
    return {"ok": True}


@router.get("/telemetry/snapshot")
def snapshot() -> dict[str, Any]:
    gd = G.grid_day(offline=True)
    return L.snapshot(gd["price"], gd["carbon"], gd.get("mix"))


@router.get("/telemetry/history")
def tel_history(seconds: float = 120) -> dict[str, Any]:
    return {m: L.history(m, seconds) for m in L.MACHINES}


@router.get("/passport/latest")
def passport() -> dict[str, Any]:
    p = L.latest_passport()
    if not p:
        raise HTTPException(404, "No grid event recorded yet")
    return p


@router.get("/telemetry/stream")
async def stream() -> EventSourceResponse:
    gd = G.grid_day(offline=True)
    price, carbon, mix = gd["price"], gd["carbon"], gd.get("mix")

    async def gen():
        while True:
            yield {"event": "tick", "data": json.dumps(L.snapshot(price, carbon, mix))}
            await asyncio.sleep(1.0)

    return EventSourceResponse(gen(), ping=15)
