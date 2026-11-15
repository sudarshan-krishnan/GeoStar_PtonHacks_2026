"""Workload controller (PRD section 12/13): runs a fixed amount of CPU work and reports to the PlotStar API.

    python run.py --machine plotstar --token <TELEMETRY_API_KEY> [--api http://localhost:8000] [--seconds 90]

- Both machines run the SAME fixed work (so completed work is equal; PRD V-1).
- machine=plotstar polls GET /hardware/command every second; during an emergency it throttles to
  (1 - requested_reduction) duty and reports state "throttled". machine=baseline ignores emergencies.
- Watts: pass --meter-cmd "<command that prints watts>" to report a real wall-plug or chip reading (source
  "measured"). Without a meter the script reports an ESTIMATE from duty cycle using the PRD laptop figures
  (10 W idle, 40 W loaded) and labels it "estimated". The screen shows that label.

Standard library only, so it runs on a Raspberry Pi or any laptop without installs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.request

IDLE_W, LOAD_W = 10.0, 40.0
SLICE_S = 0.25


def http(url: str, data: dict | None = None, token: str | None = None) -> dict:
    req = urllib.request.Request(url, method="POST" if data is not None else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    body = json.dumps(data).encode() if data is not None else None
    with urllib.request.urlopen(req, body, timeout=5) as r:
        return json.loads(r.read().decode() or "{}")


def work(seconds: float) -> None:
    """Busy CPU for `seconds` (hashing), the unit of fixed work."""
    end = time.perf_counter() + seconds
    h = b"plotstar"
    while time.perf_counter() < end:
        h = hashlib.sha256(h).digest()


def read_meter(cmd: str | None) -> float | None:
    if not cmd:
        return None
    try:
        out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=2).stdout.strip()
        return float(out.split()[0])
    except (subprocess.SubprocessError, ValueError, IndexError):
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--machine", choices=["baseline", "plotstar"], required=True)
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--token", required=True, help="TELEMETRY_API_KEY from the API's .env")
    ap.add_argument("--seconds", type=float, default=90.0, help="CPU-seconds of work in the job")
    ap.add_argument("--meter-cmd", default=None, help="command printing watts (real meter)")
    ap.add_argument("--meter-kind", default="wall-plug", choices=["wall-plug", "chip"])
    a = ap.parse_args()

    done_s, last_poll, duty, state = 0.0, 0.0, 1.0, "running"
    print(f"[{a.machine}] starting {a.seconds:.0f} CPU-seconds of work")
    while done_s < a.seconds:
        now = time.time()
        if a.machine == "plotstar" and now - last_poll >= 1.0:
            last_poll = now
            try:
                cmd = http(f"{a.api}/hardware/command")
                duty = (1.0 - float(cmd.get("facility_depth", 0.3))) if cmd.get("emergency") else 1.0
                state = "throttled" if cmd.get("emergency") else "running"
            except (urllib.error.URLError, ValueError):
                pass
        work(SLICE_S * duty)
        done_s += SLICE_S * duty
        if duty < 1.0:
            time.sleep(SLICE_S * (1.0 - duty))
        watts = read_meter(a.meter_cmd)
        payload = {
            "machine": a.machine, "progress": min(1.0, done_s / a.seconds), "state": state,
            "watts": watts if watts is not None else round(IDLE_W + (LOAD_W - IDLE_W) * duty, 1),
            "source": "measured" if watts is not None else "estimated",
            "meter": a.meter_kind if watts is not None else "estimated",
        }
        try:
            http(f"{a.api}/telemetry", payload, a.token)
        except (urllib.error.URLError, ValueError) as e:
            print("telemetry post failed:", e)
    try:
        http(f"{a.api}/telemetry", {"machine": a.machine, "progress": 1.0, "state": "done",
                                    "watts": IDLE_W, "source": "estimated", "meter": "estimated"}, a.token)
    except (urllib.error.URLError, ValueError):
        pass
    print(f"[{a.machine}] job complete")


if __name__ == "__main__":
    main()
