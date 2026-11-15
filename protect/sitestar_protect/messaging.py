"""Building-manager messaging: iMessage via the Photon bridge, mirrored on the dashboard phone panel.

Outbound: POST {bridge}/send {"text": ...}   (protect/photon-bridge, spectrum-ts)
Inbound:  the bridge POSTs replies to /api/manager/reply on the PROTECT server.
If the bridge is not running, messages still appear on the dashboard phone panel, and the
YES / NO buttons there behave exactly like an iMessage reply. The demo never depends on Wi-Fi.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Callable, Optional


class Messenger:
    def __init__(self, bridge_url: Optional[str] = "http://127.0.0.1:8797", log_path: Optional[str] = None):
        self.bridge_url = bridge_url.rstrip("/") if bridge_url else None
        self.transcript: list[dict] = []      # what the manager's phone shows
        self.on_reply: Optional[Callable[[str, str], None]] = None
        self.bridge_ok: Optional[bool] = None
        self.bridge_error: Optional[str] = None
        self.log_path = log_path              # every message also appended here (survives restarts)
        self._lock = threading.Lock()

    def _log(self, direction: str, text: str, channel: str, **extra) -> dict:
        item = {"t": time.time(), "dir": direction, "text": text, "channel": channel, **extra}
        with self._lock:
            self.transcript.append(item)
            del self.transcript[:-200]
            if self.log_path:
                try:
                    with open(self.log_path, "a") as fh:
                        fh.write(json.dumps({**item, "at": time.strftime("%Y-%m-%d %H:%M:%S")}) + "\n")
                except OSError:
                    pass
        return item

    def send(self, text: str, *, kind: str = "info", incident: Optional[str] = None,
             actions: Optional[list[str]] = None) -> dict:
        """Send to the manager. Never blocks the caller for long, never raises."""
        item = self._log("out", text, "dashboard", kind=kind, incident=incident, actions=actions or [])
        if self.bridge_url:
            threading.Thread(target=self._push, args=(item,), daemon=True).start()
        return item

    def _push(self, item: dict) -> None:
        body = json.dumps({"text": item["text"]}).encode()
        req = urllib.request.Request(f"{self.bridge_url}/send", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                ok = 200 <= resp.status < 300
            self.bridge_ok, self.bridge_error = ok, None
            if ok:
                item["channel"] = "imessage"
        except urllib.error.HTTPError as e:
            self.bridge_ok = False
            self.bridge_error = e.read().decode(errors="replace")[:200] or str(e)
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            self.bridge_ok, self.bridge_error = False, f"bridge not reachable: {e}"

    def receive(self, text: str, sender: str = "manager", channel: str = "dashboard") -> None:
        self._log("in", text, channel, sender=sender)
        if self.on_reply:
            self.on_reply(text, channel)

    def snapshot(self) -> dict:
        with self._lock:
            return {"transcript": list(self.transcript[-60:]), "bridge_url": self.bridge_url,
                    "bridge_ok": self.bridge_ok, "bridge_error": self.bridge_error}


YES = {"yes", "y", "approve", "approved", "ok", "okay", "go", "do it", "send them", "yes please", "👍", "confirm"}
NO = {"no", "n", "reject", "stop", "don't", "dont", "cancel", "hold", "wait", "👎"}


def parse_decision(text: str) -> Optional[str]:
    t = text.strip().lower().rstrip(".!")
    if t in YES or t.startswith(("yes", "approve", "go ahead")):
        return "approve"
    if t in NO or t.startswith(("no", "reject", "don't", "dont", "cancel")):
        return "reject"
    return None
