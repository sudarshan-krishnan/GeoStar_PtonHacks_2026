"""Sensor history and incident detection (deterministic, explainable thresholds)."""
from __future__ import annotations

import itertools
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Optional

from .building import Building
from .device import Reading

# Demo-tuned thresholds: a judge can trigger each one by hand at the table.
OVERHEAT_C = 31.0          # hold the DHT11 in your fingers
HUMIDITY_SPIKE_PTS = 12.0  # breathe on the DHT11
HUMIDITY_WINDOW_S = 90.0
FREEZE_C = 6.0             # ice cube on the pipe thermistor
SUMP_HIGH_CM = 8.0         # water surface this close to the ultrasonic sensor
VALVE_FAULT_S = 1.5        # valve commanded shut but its micro switch still open this long (hold the arm)

SEVERITY = {"leak": "critical", "smoke": "critical", "overheat": "warning",
            "humidity_spike": "warning", "freeze_risk": "warning", "sump_high": "critical",
            "valve_fault": "critical"}
TITLES = {"leak": "Water leak", "smoke": "Smoke", "overheat": "Equipment room overheating",
          "humidity_spike": "Humidity spike", "freeze_risk": "Pipe freeze risk", "sump_high": "Sump water high",
          "valve_fault": "Valve did not close"}


@dataclass
class Incident:
    id: str
    kind: str
    room: str
    room_name: str
    severity: str
    title: str
    started: float
    evidence: dict
    status: str = "active"                  # active -> cleared -> resolved
    cleared: Optional[float] = None
    reflex: list = field(default_factory=list)   # [{"t": ts, "action": str, "latency_ms": int}]
    agent_state: str = "queued"             # queued|thinking|waiting_approval|done|offline|error
    pending_approval: Optional[dict] = None
    work_order: Optional[str] = None
    summary: str = ""

    def to_json(self) -> dict:
        return asdict(self)


class History:
    def __init__(self, seconds: float = 900.0):
        self.seconds = seconds
        self.items: deque[Reading] = deque()

    def add(self, r: Reading) -> None:
        self.items.append(r)
        cutoff = r.ts - self.seconds
        while self.items and self.items[0].ts < cutoff:
            self.items.popleft()

    @property
    def latest(self) -> Optional[Reading]:
        return self.items[-1] if self.items else None

    def window(self, seconds: float) -> list[Reading]:
        if not self.items:
            return []
        cutoff = self.items[-1].ts - seconds
        return [r for r in self.items if r.ts >= cutoff]

    def series(self, field_name: str, seconds: float) -> list[tuple[float, float]]:
        out = []
        for r in self.window(seconds):
            v = getattr(r, field_name, None)
            if isinstance(v, bool):
                v = float(v)
            if v is not None:
                out.append((r.ts, float(v)))
        return out

    def summary(self, field_name: str, minutes: float = 10.0, buckets: int = 10) -> dict:
        s = self.series(field_name, minutes * 60)
        if not s:
            return {"sensor": field_name, "samples": 0, "note": "no data (sensor not fitted?)"}
        vals = [v for _, v in s]
        t0, t1 = s[0][0], s[-1][0]
        step = max(1e-6, (t1 - t0) / buckets)
        trend = []
        for i in range(buckets):
            seg = [v for t, v in s if t0 + i * step <= t < t0 + (i + 1) * step] or [vals[-1]]
            trend.append(round(sum(seg) / len(seg), 2))
        return {"sensor": field_name, "samples": len(vals), "minutes": minutes, "min": round(min(vals), 2),
                "max": round(max(vals), 2), "first": round(vals[0], 2), "last": round(vals[-1], 2),
                "trend_oldest_to_newest": trend}


class Detector:
    """Turns readings into incidents. One active incident per (kind, room)."""

    _ids = itertools.count(1)

    def __init__(self, building: Building, history: History):
        self.b, self.h = building, history
        self.active: dict[str, Incident] = {}
        self.all: list[Incident] = []
        self._vfault_since: Optional[float] = None
        self._vsw_seen = False      # the micro switch has been pressed at least once = it is mounted

    def _conditions(self, r: Reading) -> dict[str, bool]:
        hw = self.b.hardware_map
        rh_spike = False
        rh = self.h.series("rh", HUMIDITY_WINDOW_S)
        if len(rh) >= 2:
            rh_spike = (rh[-1][1] - min(v for _, v in rh)) >= HUMIDITY_SPIKE_PTS
        # The valve reports what it was told; the micro switch reports what it actually did. Only trust
        # the switch once it has been pressed at least once (a loose, unmounted switch is never pressed).
        if r.vsw:
            self._vsw_seen = True
        if self._vsw_seen and r.vsw is False and not r.valve_open:
            self._vfault_since = self._vfault_since or r.ts
        else:
            self._vfault_since = None
        vfault = self._vfault_since is not None and r.ts - self._vfault_since >= VALVE_FAULT_S
        return {
            f"leak:{hw['leak']}": r.wet,
            f"smoke:{hw['smoke']}": r.smoke,
            f"overheat:{hw['dht']}": r.t is not None and r.t >= OVERHEAT_C,
            f"humidity_spike:{hw['dht']}": rh_spike,
            f"freeze_risk:{hw['pipe']}": r.pipe is not None and r.pipe <= FREEZE_C,
            f"sump_high:{hw['sump']}": r.lvl is not None and r.lvl <= SUMP_HIGH_CM,
            f"valve_fault:{hw.get('valve', hw['leak'])}": vfault,
        }

    def update(self, r: Reading) -> tuple[list[Incident], list[Incident]]:
        """Returns (new incidents, newly cleared incidents)."""
        new, cleared = [], []
        for key, on in self._conditions(r).items():
            kind, room = key.split(":", 1)
            inc = self.active.get(key)
            if on and inc is None:
                inc = Incident(id=f"INC-{next(self._ids):04d}", kind=kind, room=room,
                               room_name=self.b.room_name(room), severity=SEVERITY[kind], title=TITLES[kind],
                               started=r.ts, evidence=self._evidence(r))
                self.active[key] = inc
                self.all.append(inc)
                new.append(inc)
            elif not on and inc is not None:
                inc.status, inc.cleared = "cleared", r.ts
                del self.active[key]
                cleared.append(inc)
        return new, cleared

    def _evidence(self, r: Reading) -> dict:
        return {"leak_adc": r.leak, "wet": r.wet, "smoke_beam_pct": round(r.beam_pct, 1), "mech_temp_c": r.t,
                "mech_rh_pct": r.rh, "pipe_c": r.pipe, "lounge_occupied": r.pir, "sump_cm": r.lvl,
                "valve_open": r.valve_open, "valve_switch_confirms_shut": r.vsw, "fire_door_open": r.door_open,
                "at": time.strftime("%H:%M:%S", time.localtime(r.ts))}

    def get(self, incident_id: str) -> Optional[Incident]:
        return next((i for i in self.all if i.id == incident_id), None)
