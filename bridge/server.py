"""SiteStar live bridge.

Serves the website plus its live feeds:

* Drone: Tello EDU / Talent camera (MJPEG), telemetry, flight commands and
  evidence snapshots.
* Live Grid: workload machines push measured watts; the website or the ESP32
  button raises a grid emergency; every event becomes a Grid Passport record.
* ERCOT: real Texas grid data (fuel mix, demand, Houston prices), refreshed
  every 5 minutes from ercot.com.

    python bridge/server.py --tello-ip 172.20.10.14   # drone on your hotspot (tello_wifi.py)
    python bridge/server.py                           # drone on its own TELLO-XXXXXX Wi-Fi
    python bridge/server.py --mock                    # simulated drone and machines

Then open http://localhost:8010 (or the HAVEN dashboard: Design -> Discover)
"""

import argparse
import atexit
import math
import re
import threading
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request, send_from_directory

import ercot

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
CAPTURE_DIR = ROOT / "captures"
MOVE_CM = 30
TURN_DEG = 45
FPS = 30
RECONNECT_SECONDS = 5
STATE_TIMEOUT_S = 4          # no state packets for this long = drone gone
KEEPALIVE_S = 8              # a Tello lands itself after 15 s without any command
VIDEO_IDLE_S = 10            # close a /video stream that has had no frame for this long
TELLO_DEFAULT_IP = "192.168.10.1"
# Browsers may call the bridge from these origins only. Commands fly a real drone, so any
# other website the operator has open must not be able to reach them.
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")
GRID_MACHINES = ("baseline", "optimized")
GRID_HISTORY = 480           # samples kept per machine (4 min at 2 Hz)
GRID_STALE_S = 5
PRE_EVENT_S = 10             # window before an emergency used as the "before" level
RESPONSE_DROP = 0.10         # a 10% drop from the before level counts as responding
ERCOT_REFRESH_S = 300

ACTIONS = {
    "takeoff": lambda t: t.takeoff(),
    "land": lambda t: t.land(),
    "up": lambda t: t.move_up(MOVE_CM),
    "down": lambda t: t.move_down(MOVE_CM),
    "left": lambda t: t.move_left(MOVE_CM),
    "right": lambda t: t.move_right(MOVE_CM),
    "forward": lambda t: t.move_forward(MOVE_CM),
    "back": lambda t: t.move_back(MOVE_CM),
    "cw": lambda t: t.rotate_clockwise(TURN_DEG),
    "ccw": lambda t: t.rotate_counter_clockwise(TURN_DEG),
}


# ---------------------------------------------------------------- drone

class Drone:
    """Wraps the Tello connection (or a simulated one in mock mode)."""

    def __init__(self, mock: bool, tello_ip: str = TELLO_DEFAULT_IP):
        self.mock = mock
        self.tello = None
        self.frame_read = None
        self.connected = mock
        self.error = None
        self.command_lock = threading.Lock()
        self.mock_flying = False
        self._last_state = None
        self._last_state_at = 0.0
        self._last_command_at = time.time()

        if not mock:
            from djitellopy import Tello  # imported lazily so --mock works without it
            self.tello = Tello(host=tello_ip)
            threading.Thread(target=self._connect_loop, daemon=True).start()
            threading.Thread(target=self._keepalive_loop, daemon=True).start()

    def _connect_loop(self):
        while True:
            if not self.connected:
                try:
                    self.tello.connect()
                    self.tello.streamon()
                    # djitellopy reuses its frame reader; after the drone power-cycles that
                    # reader's decoder is dead, so drop it and open a fresh one.
                    if self.tello.background_frame_read is not None:
                        self.tello.background_frame_read.stop()
                        self.tello.background_frame_read = None
                    self.frame_read = self.tello.get_frame_read()
                    self._last_state, self._last_state_at = None, time.time()
                    self.connected = True
                    self.error = None
                    print(f"Connected to Tello. Battery {self.tello.get_battery()}%")
                except Exception as exc:  # drone off, wrong Wi-Fi, etc.
                    self.error = str(exc)
                    print(f"Tello at {self.tello.address[0]} not reachable ({exc}); "
                          f"retrying in {RECONNECT_SECONDS}s")
            time.sleep(RECONNECT_SECONDS)

    def _keepalive_loop(self):
        """Without a command every 15 s a hovering Tello lands on its own. A battery query
        counts as a command and works on every Tello firmware ("keepalive" is SDK 3 only)."""
        while True:
            time.sleep(1)
            if not (self.connected and self.tello.is_flying):
                continue
            if time.time() - self._last_command_at < KEEPALIVE_S:
                continue
            if not self.command_lock.acquire(blocking=False):
                continue  # a flight command is running, which already counts
            try:
                self.tello.query_battery()
            except Exception as exc:
                print(f"Tello keepalive failed ({exc})")
            finally:
                self._last_command_at = time.time()
                self.command_lock.release()

    def _alive(self) -> bool:
        """The Tello sends ~10 state packets a second; each one is a new dict."""
        state = self.tello.get_current_state()
        now = time.time()
        if state is not self._last_state:
            self._last_state, self._last_state_at = state, now
        return now - self._last_state_at < STATE_TIMEOUT_S

    def jpeg(self):
        if self.mock:
            frame = mock_frame(self.mock_flying)
        elif self.connected and self.frame_read is not None and self.frame_read.frame is not None:
            frame = self.frame_read.frame
            # djitellopy starts the reader with a black 400x300 placeholder; it is not video.
            if frame.shape[:2] == (300, 400):
                return None
            # djitellopy >= 2.5 returns RGB; OpenCV encodes BGR
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        else:
            return None
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else None

    def status(self):
        base = {"connected": self.connected, "mock": self.mock, "error": self.error}
        if self.mock:
            return {**base, "battery": 87, "height": 120 if self.mock_flying else 0,
                    "temp": 41, "flying": self.mock_flying, "video": True, "ip": None}
        if self.connected and not self._alive():
            self.connected = False
            self.error = "drone stopped sending telemetry"
            print("Tello went quiet; reconnecting")
        if not self.connected:
            return {**base, "connected": False, "battery": None, "height": None,
                    "temp": None, "flying": False, "video": False, "ip": self.tello.address[0]}
        t = self.tello
        return {**base, "battery": t.get_battery(), "height": t.get_height(),
                "temp": t.get_temperature(), "flying": t.is_flying,
                "video": self._has_frame(), "ip": t.address[0]}

    def _has_frame(self) -> bool:
        frame = self.frame_read.frame if self.frame_read is not None else None
        return frame is not None and frame.shape[:2] != (300, 400)

    def command(self, action):
        self._last_command_at = time.time()
        if action == "emergency":
            # Never blocked by a running command: motors stop immediately.
            if self.mock:
                self.mock_flying = False
            else:
                self.tello.emergency()
            return
        if action not in ACTIONS:
            raise ValueError(f"unknown action '{action}'")
        if not self.command_lock.acquire(blocking=False):
            raise BlockingIOError("drone is busy with another command")
        try:
            if self.mock:
                time.sleep(0.4)
                if action == "takeoff":
                    self.mock_flying = True
                elif action == "land":
                    self.mock_flying = False
            else:
                ACTIONS[action](self.tello)
        finally:
            self.command_lock.release()

    def shutdown(self):
        if self.mock or not self.connected:
            return
        try:
            if self.tello.is_flying:
                self.tello.land()
            self.tello.streamoff()
            self.tello.end()
        except Exception:
            pass


def mock_frame(flying: bool, w=960, h=720):
    """Synthetic 'aerial survey' frame for testing without a drone."""
    t = time.time()
    frame = np.zeros((h, w, 3), np.uint8)
    frame[:] = (24, 22, 20)
    step = 60
    ox, oy = int(t * 40) % step, int(t * 25) % step
    for x in range(-step, w + step, step):
        cv2.line(frame, (x + ox, 0), (x + ox, h), (60, 58, 54), 1)
    for y in range(-step, h + step, step):
        cv2.line(frame, (0, y + oy), (w, y + oy), (60, 58, 54), 1)
    cx = int(w / 2 + math.sin(t / 3) * 120)
    cy = int(h / 2 + math.cos(t / 4) * 80)
    cv2.rectangle(frame, (cx - 160, cy - 110), (cx + 160, cy + 110), (52, 104, 235), 2)
    cv2.putText(frame, "PARCEL A", (cx - 150, cy - 120), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (52, 104, 235), 2)
    cv2.drawMarker(frame, (w // 2, h // 2), (236, 239, 240), cv2.MARKER_CROSS, 28, 1)
    label = "SIMULATED FEED  |  " + ("AIRBORNE" if flying else "LANDED")
    cv2.putText(frame, label, (24, h - 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (236, 239, 240), 2)
    cv2.putText(frame, time.strftime("%H:%M:%S"), (w - 140, h - 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (236, 239, 240), 1)
    return frame


# ---------------------------------------------------------------- live grid

class Grid:
    """Per-machine watts, the grid-emergency flag and the Grid Passport log.

    Workload controllers POST readings; the site and controllers GET the state.
    """

    def __init__(self, mock: bool):
        self.mock = mock
        self.lock = threading.Lock()
        self.emergency = False
        self.emergency_since = None
        self.machines = {m: None for m in GRID_MACHINES}
        self.history = {m: deque(maxlen=GRID_HISTORY) for m in GRID_MACHINES}
        self.events = []      # finished Grid Passport records, oldest first
        self.active = None    # the event in progress
        if mock:
            threading.Thread(target=self._mock_loop, daemon=True).start()

    # readings
    def record(self, machine, watts, progress=None, done=None, measure=None):
        if machine not in GRID_MACHINES:
            raise ValueError(f"machine must be one of {', '.join(GRID_MACHINES)}")
        watts = float(watts)
        if not math.isfinite(watts) or watts < 0:
            raise ValueError("watts must be a non-negative number")
        if progress is not None:
            progress = min(max(float(progress), 0.0), 1.0)
        if measure not in (None, "chip", "wall"):
            raise ValueError("measure must be 'chip' or 'wall'")
        now = time.time()
        with self.lock:
            self.machines[machine] = {
                "watts": round(watts, 2), "progress": progress, "done": bool(done),
                "measure": measure, "updated": now,
            }
            self.history[machine].append((round(now, 2), round(watts, 2)))
            if machine == "optimized" and done:
                # Close out the job record of any event that ended before the job finished.
                for ev in self.events[-5:]:
                    if ev["job"]["finished_at"] is None:
                        ev["job"]["finished_at"] = round(now, 2)

    def _avg(self, machine, t0, t1):
        vals = [w for t, w in self.history[machine] if t0 <= t <= t1]
        return round(sum(vals) / len(vals), 2) if vals else None

    # emergency + passport
    def set_emergency(self, active: bool, source: str = "web"):
        with self.lock:
            now = time.time()
            if active and not self.emergency:
                opt = self.machines["optimized"] or {}
                self.active = {
                    "id": len(self.events) + 1, "started": round(now, 2), "source": source,
                    "before": {m: self._avg(m, now - PRE_EVENT_S, now) for m in GRID_MACHINES},
                    "progress_start": opt.get("progress"),
                }
                self.emergency_since = now
            elif not active and self.emergency and self.active:
                self.events.append(self._close_event(now))
                self.events = self.events[-50:]
                self.active = None
                self.emergency_since = None
            self.emergency = active

    def _close_event(self, now):
        ev = self.active
        start = ev["started"]
        machines = {}
        for m in GRID_MACHINES:
            before = ev["before"][m]
            during = self._avg(m, start, now)
            cur = self.machines[m] or {}
            machines[m] = {
                "before_w": before, "during_w": during,
                "change_pct": round((during - before) / before * 100, 1) if before and during is not None else None,
                "measure": cur.get("measure"),
                "samples": sum(1 for t, _ in self.history[m] if start <= t <= now),
            }
        response_s = None
        before = ev["before"]["optimized"]
        if before:
            for t, w in self.history["optimized"]:
                if t >= start and w <= before * (1 - RESPONSE_DROP):
                    response_s = round(t - start, 2)
                    break
        opt = self.machines["optimized"] or {}
        return {
            "id": ev["id"], "started": start, "ended": round(now, 2),
            "duration_s": round(now - start, 1), "source": ev["source"], "mock": self.mock,
            "machines": machines, "response_s": response_s,
            "response_rule": f"first reading {int(RESPONSE_DROP * 100)}% below the {PRE_EVENT_S}-second pre-event average",
            "job": {"progress_start": ev["progress_start"], "progress_end": opt.get("progress"),
                    "finished_at": round(now, 2) if opt.get("done") else None},
        }

    def state(self):
        now = time.time()
        with self.lock:
            machines = {}
            for m in GRID_MACHINES:
                cur = self.machines[m]
                machines[m] = None if cur is None else {
                    **cur, "stale": now - cur["updated"] > GRID_STALE_S,
                    "history": list(self.history[m]),
                }
            return {"mock": self.mock, "emergency": self.emergency,
                    "emergency_since": self.emergency_since, "active": self.active,
                    "events": self.events[-10:][::-1], "machines": machines, "now": now}

    def _mock_loop(self):
        """Simulated readings so the page can be tested without workload machines."""
        progress = {m: 0.0 for m in GRID_MACHINES}
        while True:
            for m in GRID_MACHINES:
                deferring = m == "optimized" and self.emergency
                watts = (12 if deferring else 38) + math.sin(time.time() * 1.7 + len(m)) * 1.5
                progress[m] = 0.0 if progress[m] >= 1 else progress[m] + (0.0 if deferring else 0.004)
                self.record(m, watts, progress=progress[m], done=progress[m] >= 1, measure="chip")
            time.sleep(0.5)


# ---------------------------------------------------------------- ERCOT

class ErcotFeed:
    """Keeps a fresh copy of the real ERCOT data (see ercot.py)."""

    def __init__(self, enabled: bool = True):
        self.data, self.error, self.fetched = None, None, None
        self.lock = threading.Lock()
        if enabled:
            threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                data = ercot.build()
                with self.lock:
                    self.data, self.error, self.fetched = data, None, time.time()
            except Exception as exc:  # offline, ERCOT down, format change
                with self.lock:
                    self.error = str(exc)
                print(f"ERCOT refresh failed: {exc}")
            time.sleep(ERCOT_REFRESH_S if self.error is None else 60)

    def get(self):
        with self.lock:
            return self.data, self.error


# ---------------------------------------------------------------- app

def create_app(drone: Drone, grid: Grid, feed: ErcotFeed) -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.before_request
    def reject_foreign_origins():
        # A page on any other site could otherwise POST /api/command and fly the drone.
        origin = request.headers.get("Origin")
        if origin and not LOCAL_ORIGIN.match(origin) and request.host_url.rstrip("/") != origin:
            return jsonify(error="cross-origin requests to the bridge are not allowed"), 403

    @app.after_request
    def cors(resp):
        # Lets a copy of the site on another local port (for example the Next.js app) reach it.
        origin = request.headers.get("Origin")
        if origin and LOCAL_ORIGIN.match(origin):
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Vary"] = "Origin"
        return resp

    def body():
        return request.get_json(silent=True) or {}

    @app.get("/")
    def index():
        if not (WEB_DIR / "index.html").exists():
            return jsonify(bridge="SiteStar live bridge", drone=drone.status())
        return send_from_directory(WEB_DIR, "index.html")

    @app.get("/<path:path>")
    def static_files(path):
        return send_from_directory(WEB_DIR, path)

    # drone
    @app.get("/api/status")
    def status():
        return jsonify(drone.status())

    @app.route("/api/command", methods=["POST", "OPTIONS"])
    def command():
        if request.method == "OPTIONS":
            return "", 204
        action = body().get("action", "")
        if not drone.connected:
            return jsonify(error="drone not connected"), 503
        try:
            drone.command(action)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except BlockingIOError as exc:
            return jsonify(error=str(exc)), 409
        except Exception as exc:  # Tello rejected the command (low battery, etc.)
            return jsonify(error=str(exc)), 502
        return jsonify(ok=True, action=action)

    @app.get("/video")
    def video():
        def stream():
            # Ends after VIDEO_IDLE_S without frames, so a stream opened while the drone is
            # away does not hold a server thread forever; the page reopens it on reconnect.
            last_frame = time.time()
            while time.time() - last_frame < VIDEO_IDLE_S:
                jpg = drone.jpeg()
                if jpg:
                    last_frame = time.time()
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
                time.sleep(1 / FPS)

        return Response(stream(), mimetype="multipart/x-mixed-replace; boundary=frame")

    @app.route("/api/drone/snapshot", methods=["POST", "OPTIONS"])
    def snapshot():
        if request.method == "OPTIONS":
            return "", 204
        jpg = drone.jpeg()
        if not jpg:
            return jsonify(error="no camera frame available"), 503
        CAPTURE_DIR.mkdir(exist_ok=True)
        # Milliseconds in the name: a survey can capture twice within one second.
        now = time.time()
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + f"-{int(now * 1000) % 1000:03d}"
        name = stamp + ("-sim" if drone.mock else "") + ".jpg"
        (CAPTURE_DIR / name).write_bytes(jpg)
        return jsonify(snapshot_info(name))

    @app.get("/api/drone/snapshots")
    def snapshots():
        if not CAPTURE_DIR.exists():
            return jsonify([])
        files = sorted(CAPTURE_DIR.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
        return jsonify([snapshot_info(p.name) for p in files[:12]])

    @app.get("/captures/<path:name>")
    def capture_file(name):
        return send_from_directory(CAPTURE_DIR, name)

    # live grid
    @app.get("/api/grid")
    def grid_state():
        return jsonify(grid.state())

    @app.route("/api/grid/telemetry", methods=["POST", "OPTIONS"])
    def grid_telemetry():
        """Body: {"machine": "baseline"|"optimized", "watts": 38.2,
        "progress": 0.0-1.0, "done": false, "measure": "chip"|"wall"}"""
        if request.method == "OPTIONS":
            return "", 204
        b = body()
        try:
            grid.record(b.get("machine"), b.get("watts"), b.get("progress"), b.get("done"), b.get("measure"))
        except (TypeError, ValueError) as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, emergency=grid.emergency)

    @app.route("/api/grid/emergency", methods=["POST", "OPTIONS"])
    def grid_emergency():
        """Body: {"active": true|false, "source": "web"|"esp32"|...}"""
        if request.method == "OPTIONS":
            return "", 204
        b = body()
        active = b.get("active")
        if not isinstance(active, bool):
            return jsonify(error="'active' must be true or false"), 400
        source = str(b.get("source") or "api")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,24}", source):
            return jsonify(error="'source' must be a short name like 'web' or 'esp32'"), 400
        grid.set_emergency(active, source)
        return jsonify(ok=True, emergency=grid.emergency)

    # ERCOT
    @app.get("/api/ercot")
    def ercot_data():
        data, error = feed.get()
        if data is None:
            return jsonify(error=error or "ERCOT data not loaded yet"), 503
        return jsonify({**data, "live": True, "refresh_error": error})

    return app


def snapshot_info(name: str) -> dict:
    p = CAPTURE_DIR / name
    return {"url": f"/captures/{name}", "time": round(p.stat().st_mtime, 2), "simulated": "-sim" in name}


def main():
    parser = argparse.ArgumentParser(description="SiteStar live bridge (drone, Live Grid, ERCOT)")
    parser.add_argument("--mock", action="store_true",
                        help="simulated drone and workload machines, no hardware needed")
    parser.add_argument("--mock-grid", action="store_true",
                        help="simulate only the two workload machines (real drone, fake watts)")
    parser.add_argument("--tello-ip", default=TELLO_DEFAULT_IP,
                        help="drone IP when it has joined a router via tello_wifi.py")
    parser.add_argument("--no-ercot", action="store_true", help="don't fetch live ERCOT data")
    parser.add_argument("--host", default="127.0.0.1",
                        help="use 0.0.0.0 to let other devices on the network view the site")
    parser.add_argument("--port", type=int, default=8010)  # 8000 is services/api; 5000 clashes with macOS AirPlay
    args = parser.parse_args()

    drone = Drone(mock=args.mock, tello_ip=args.tello_ip)
    grid = Grid(mock=args.mock or args.mock_grid)
    feed = ErcotFeed(enabled=not args.no_ercot)
    atexit.register(drone.shutdown)
    mode = "mock" if args.mock else f"Tello at {args.tello_ip}" + (", simulated machines" if args.mock_grid else "")
    print(f"SiteStar bridge on http://{args.host}:{args.port}  ({mode})")
    create_app(drone, grid, feed).run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
