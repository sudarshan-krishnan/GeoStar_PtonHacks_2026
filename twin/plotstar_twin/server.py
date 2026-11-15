"""HTTP + WebSocket API so the PlotStar dashboard can show and steer the twin.

GET  /api/twin/state      latest snapshot (same object the WebSocket streams)
GET  /api/twin/day        the replayed grid day + both 24-hour plans
POST /api/twin/control    {"site":"B","cooling":"air","flex_pct":0.5,"carbon_price":80,
                           "physical_plan":"plotstar","emergency":true}   (all optional)
WS   /ws/twin             snapshot pushed 5x per second
GET  /                    built-in status page (no frontend needed)
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

STATIC = Path(__file__).resolve().parent / "static"


class ControlIn(BaseModel):
    site: Optional[str] = None
    cooling: Optional[str] = None
    flex_pct: Optional[float] = None
    carbon_price: Optional[float] = None
    physical_plan: Optional[str] = None
    emergency: Optional[bool] = None


def create_app(twin) -> FastAPI:
    app = FastAPI(title="PlotStar Live Digital Twin")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/twin/state")
    def state():
        return twin.snapshot()

    @app.get("/api/twin/day")
    def day():
        return twin.day_json()

    @app.post("/api/twin/control")
    def control(body: ControlIn):
        return twin.control(**body.model_dump(exclude_none=True))

    @app.websocket("/ws/twin")
    async def ws(sock: WebSocket):
        await sock.accept()
        try:
            while True:
                await sock.send_json(twin.snapshot())
                await asyncio.sleep(0.2)
        except (WebSocketDisconnect, RuntimeError):
            pass

    return app
