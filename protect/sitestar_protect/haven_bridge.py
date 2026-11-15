"""Pushes real hardware events into the team's main app (Next.js, HAVEN command center in Studio → Deploy).

The main app's Protect command center and the iPhone app read the same protection workspace. Its
API only knows demo incidents, so a real event is sent as the matching command:

    our incident            -> main app command
    leak / valve_fault      -> {"action": "trigger", "kind": "leak"}
    smoke                   -> {"action": "trigger", "kind": "fire"}
    overheat                -> {"action": "trigger", "kind": "usage"}
    manager badge approval  -> {"action": "acknowledge", "incidentId": <newest active>}
    everything clear        -> {"action": "reset"}   (the command center then shows Recovering)

Which project the physical model belongs to (one kit, one project at a time):
    1. the project it was last connected to from the dashboard ("Connect here", or deploying a
       project), saved to disk so it survives a restart;
    2. else HAVEN_FACILITY (the --haven-facility flag);
    3. else the most recently deployed non-sample project, else the most recent deployed sample.
Never raises into the caller; failures are shown on the dashboard.
"""
from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

KIND_FOR = {"leak": "leak", "valve_fault": "leak", "smoke": "fire", "overheat": "usage"}
FACILITY_ID = re.compile(r"^[a-z0-9-]{1,150}$")
RESOLVE_EVERY_S = 5.0            # retry finding a project this often while none is known


def clean_facility(f: dict) -> dict:
    """The fields the main app needs, validated. Raises ValueError on a bad project."""
    fid = str(f.get("id", ""))
    name = str(f.get("name", "")).strip()
    if not FACILITY_ID.match(fid) or not name:
        raise ValueError("a project needs an id (a-z, 0-9, -) and a name")
    return {"id": fid, "name": name[:160], "city": str(f.get("city", ""))[:120], "type": str(f.get("type", ""))[:60]}


class HavenBridge:
    def __init__(self, base_url: Optional[str] = "http://127.0.0.1:3000", link_path: Optional[Path] = None):
        self.base = base_url.rstrip("/") if base_url else None
        self.link_path = Path(link_path) if link_path else None
        self.facility: Optional[dict] = self._load_link()
        self.linked_by: Optional[str] = "saved" if self.facility else None
        self.ok: Optional[bool] = None
        self.error: Optional[str] = None
        self.last: Optional[str] = None
        self.log: list[dict] = []
        self._q: "queue.Queue[dict]" = queue.Queue()
        if self.base:
            threading.Thread(target=self._worker, name="haven-bridge", daemon=True).start()

    # ------------------------------------------------------------------ API
    def incident(self, kind: str, title: str) -> None:
        if self.base and kind in KIND_FOR:
            self._q.put({"action": "trigger", "kind": KIND_FOR[kind], "live": True, "_why": title})

    def approved(self) -> None:
        if self.base:
            self._q.put({"action": "acknowledge", "_why": "manager badge"})

    def all_clear(self) -> None:
        if self.base:
            self._q.put({"action": "reset", "_why": "all sensors normal"})

    def link(self, facility: dict, by: str = "dashboard") -> dict:
        """Connect the physical model to this project from now on (and after a restart)."""
        f = clean_facility(facility)
        self.facility, self.linked_by = f, by
        self.ok, self.error = None, None
        if self.link_path:
            try:
                self.link_path.parent.mkdir(parents=True, exist_ok=True)
                self.link_path.write_text(json.dumps(f, indent=2) + "\n")
            except OSError as e:
                self.error = f"could not save the project link: {e}"
        self._note(f"connected to {f['name']} ({by})")
        return f

    def snapshot(self) -> dict:
        f = self.facility or {}
        return {"url": self.base, "ok": self.ok, "error": self.error, "facility": f.get("name"),
                "facility_id": f.get("id") or os.environ.get("HAVEN_FACILITY"),
                "facility_type": f.get("type"), "facility_city": f.get("city"), "linked_by": self.linked_by,
                "last": self.last, "log": self.log[-8:]}

    # -------------------------------------------------------------- plumbing
    def _load_link(self) -> Optional[dict]:
        if not self.link_path or not self.link_path.exists():
            return None
        try:
            return clean_facility(json.loads(self.link_path.read_text()))
        except (OSError, ValueError, TypeError):
            return None

    def _forget_link(self) -> None:
        self.facility, self.linked_by = None, None
        if self.link_path:
            try:
                self.link_path.unlink()
            except OSError:
                pass

    def _note(self, text: str) -> None:
        self.last = f"{time.strftime('%H:%M:%S')} {text}"
        self.log.append({"t": time.time(), "text": self.last})
        del self.log[:-50]
        print(f"[haven] {self.last}")

    def _http(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode() or "{}")

    def _pick_facility(self) -> dict:
        projects = self._http("GET", "/api/protection").get("projects", [])
        want = os.environ.get("HAVEN_FACILITY")
        if want:
            match = [p for p in projects if p["facility"]["id"] == want]
            if not match:
                raise RuntimeError(f"HAVEN_FACILITY {want} is not a deployed facility")
            return match[0]["facility"]
        real = [p for p in projects if not p.get("sample")]
        pool = real or projects
        if not pool:
            raise RuntimeError("no deployed facility in the main app yet (Protect -> Deploy one)")
        return pool[0]["facility"]

    def _resolve(self) -> None:
        if self.facility is None:
            self.facility = clean_facility(self._pick_facility())
            self.linked_by = "flag" if os.environ.get("HAVEN_FACILITY") else "newest deployed"
            self._note(f"connected to {self.facility['name']} ({self.linked_by})")

    def _state(self) -> dict:
        f = self.facility
        q = urllib.parse.urlencode({"name": f["name"], "city": f.get("city", ""), "type": f.get("type", "")})
        return self._http("GET", f"/api/protection/{f['id']}?{q}")

    def _send(self, cmd: dict) -> str:
        self._resolve()
        state = self._state()
        command = {k: v for k, v in cmd.items() if not k.startswith("_")}
        if command["action"] == "acknowledge":
            active = [i for i in state.get("incidents", []) if i.get("status") == "active"]
            if not active:
                return "nothing to acknowledge"
            command["incidentId"] = active[-1]["id"]
        if command["action"] == "reset" and not [i for i in state.get("incidents", [])
                                                 if i.get("status") != "resolved"]:
            return "already clear"
        body = {"facility": {k: self.facility.get(k, "") for k in ("id", "name", "city", "type")},
                "revision": state.get("revision", 0), "command": command}
        try:
            self._http("PATCH", f"/api/protection/{self.facility['id']}", body)
        except urllib.error.HTTPError as e:
            if e.code == 409:                       # someone clicked in the UI meanwhile: retry once
                body["revision"] = self._state().get("revision", 0)
                self._http("PATCH", f"/api/protection/{self.facility['id']}", body)
            else:
                raise
        return "sent"

    def _worker(self) -> None:
        while True:
            try:
                cmd = self._q.get(timeout=RESOLVE_EVERY_S)
            except queue.Empty:
                # Idle: find the project up front so the dashboard knows where the kit belongs.
                if self.facility is None:
                    try:
                        self._resolve()
                        self.ok, self.error = True, None
                    except Exception as e:  # noqa: BLE001
                        self.error = f"no project yet: {getattr(e, 'reason', e)}"
                continue
            label = f"{cmd['action']} {cmd.get('kind', '')}".strip()
            try:
                result = self._send(cmd)
                self.ok, self.error = True, None
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors="replace")[:160]
                result, self.ok, self.error = f"HTTP {e.code}", False, f"{label}: HTTP {e.code} {detail}"
                if e.code == 404:
                    self._forget_link()
            except (urllib.error.URLError, OSError, TimeoutError) as e:
                result, self.ok = "main app not reachable", False
                self.error = f"main app not reachable at {self.base} ({getattr(e, 'reason', e)})"
            except Exception as e:  # noqa: BLE001
                result, self.ok, self.error = "error", False, f"{label}: {e}"
            self._note(f"{label} ({cmd.get('_why', '')}): {result}")
            if self.error and not self.ok:
                print(f"[haven]   -- {self.error}")
