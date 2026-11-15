"""PROTECT API + dashboard.

GET  /api/state              live snapshot (sensors, rooms, incidents, agent trace, phone transcript)
GET  /api/building           building model + sensor plan (from DESIGN)
GET  /api/incidents/{id}/files   the agent's dossier files for one incident
POST /api/manager/reply      {"text": "YES", "channel": "imessage"}  (Photon bridge posts here)
POST /api/sim/key/{k}        drive the built-in fake board (only with --sim)
POST /api/badge/{uid}        simulate a card tap at the lobby panel (manager / any card)
POST /api/badges/manager/{uid}   make this card the manager card (saved to config/badges.json)
WS   /ws                     snapshot pushed 4x per second
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

STATIC = Path(__file__).resolve().parent / "static"


class Reply(BaseModel):
    text: str
    sender: Optional[str] = "manager"
    channel: Optional[str] = "dashboard"


class Project(BaseModel):
    id: str
    name: str
    city: Optional[str] = ""
    type: Optional[str] = ""
    by: Optional[str] = "dashboard"


def create_app(ctrl, sim_board=None) -> FastAPI:
    app = FastAPI(title="SiteStar PROTECT")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/state")
    def state():
        return ctrl.snapshot()

    @app.get("/api/building")
    def building():
        return ctrl.building.to_json()

    @app.get("/api/incidents/{incident_id}/files")
    def files(incident_id: str):
        if not incident_id.replace("-", "").isalnum():
            raise HTTPException(400, "bad id")
        root = ctrl.commander.fs_root / "incidents" / incident_id if ctrl.commander else None
        if not root or not root.exists():
            return {"files": []}
        return {"files": [{"name": p.name, "text": p.read_text()[:20000]} for p in sorted(root.glob("*.md"))]}

    @app.post("/api/manager/reply")
    def reply(body: Reply):
        if body.text.strip().upper() in ("YES", "NO"):     # Approve / Decline on the dashboard
            ctrl.acknowledge_alarm(body.channel or "dashboard")
        ctrl.messenger.receive(body.text, body.sender or "manager", body.channel or "dashboard")
        return {"ok": True}

    @app.post("/api/sim/key/{k}")
    def sim_key(k: str):
        if sim_board is None:
            raise HTTPException(409, "not running with --sim")
        sim_board.key(k[:1])
        return {"ok": True}

    @app.post("/api/power/feed")
    def power_feed(body: dict):
        if ctrl.meter is None:
            raise HTTPException(409, "power metering is off (--flex-workers 0)")
        w = float(body.get("watts", -1))
        if not 0 <= w < 2000:
            raise HTTPException(400, "bad watts")
        ctrl.meter.feed(w)
        return {"ok": True}

    @app.post("/api/haven/link")
    def haven_link(body: Project):
        """Connect the physical model to a deployed project in the main app (Studio → Deploy)."""
        try:
            f = ctrl.haven.link(body.model_dump(exclude={"by"}), by=(body.by or "dashboard")[:40])
        except ValueError as e:
            raise HTTPException(400, str(e))
        ctrl._log(f"physical model connected to {f['name']}", body.by or "dashboard")
        return {"ok": True, "facility": f}

    @app.post("/api/grid/request")
    def grid_request(depth: Optional[int] = None):
        return {"result": ctrl.grid_request(source="dashboard", depth=depth), "grid": ctrl.power_snapshot()["grid"]}

    @app.post("/api/grid/end")
    def grid_end():
        return {"result": ctrl.grid_end(source="dashboard")}

    @app.post("/api/key/{k}")
    def key(k: str):
        if len(k) != 1 or k not in "0123456789ABCD*#":
            raise HTTPException(400, "bad key")
        ctrl.on_key(k)
        return {"ok": True}

    @app.post("/api/badge/{uid}")
    def badge(uid: str):
        uid = uid.upper()
        if uid == "MANAGER":
            uid = (ctrl.badges["managers"] or ["MANAGER1"])[0]
            if uid not in ctrl.badges["managers"]:
                ctrl.badges["managers"].append(uid)          # in memory only, for the simulator
        if not uid.isalnum() or len(uid) > 20:
            raise HTTPException(400, "bad uid")
        ctrl.on_badge(uid)
        return {"ok": True, "uid": uid}

    @app.post("/api/badges/manager/{uid}")
    def badge_manager(uid: str):
        uid = uid.upper()
        if not all(c in "0123456789ABCDEF" for c in uid) or not 4 <= len(uid) <= 20:
            raise HTTPException(400, "bad uid")
        ctrl.make_manager_card(uid)
        return {"ok": True, "managers": ctrl.badges["managers"]}

    @app.websocket("/ws")
    async def ws(sock: WebSocket):
        await sock.accept()
        try:
            while True:
                await sock.send_json(ctrl.snapshot())
                await asyncio.sleep(0.25)
        except (WebSocketDisconnect, RuntimeError):
            pass

    return app
