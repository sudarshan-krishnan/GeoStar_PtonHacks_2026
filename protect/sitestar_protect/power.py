"""Data-hall power: measured laptop watts (the "servers"), a pausable AI workload, the cooling fan.

PowerMeter  - MEASURED. Reads the Mac's own power telemetry with `ioreg` (no sudo):
              on battery  -> battery voltage x discharge current
              on charger  -> SystemPowerIn (what the laptop draws from the adapter)
FlexLoad    - "flexible AI jobs": worker processes that each keep one CPU core busy. A grid event
              pauses a share of them, so the measured watts really fall; resuming brings them back.
fan_watts   - ESTIMATED cooling power of the DC-motor fan from its duty (fan law: power ~ speed^3).
"""
from __future__ import annotations

import multiprocessing as mp
import os
import re
import subprocess
import threading
import time
from collections import deque
from typing import Optional

FAN_W_MAX = 1.5          # small 5 V DC motor at full speed (~300 mA); the "cooling" in the model


def fan_watts(level: float) -> float:
    """Estimated: fan affinity law, power grows with the cube of speed."""
    level = max(0.0, min(1.0, level))
    return round(FAN_W_MAX * level ** 3, 2)


def _ioreg_power() -> Optional[float]:
    try:
        out = subprocess.run(["ioreg", "-rn", "AppleSmartBattery"], capture_output=True, text=True,
                             timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return None

    def num(key: str) -> Optional[int]:
        m = re.search(rf'"{key}"\s*=\s*(\d+)', out)
        return int(m.group(1)) if m else None

    external = re.search(r'"ExternalConnected"\s*=\s*Yes', out) is not None
    sys_in = num("SystemPowerIn")                    # mW, from PowerTelemetryData (charger)
    if external and sys_in:
        return sys_in / 1000.0
    volts, amps = num("Voltage"), num("InstantAmperage")
    if volts and amps is not None:
        if amps >= 2 ** 63:                          # reported as unsigned 64-bit: negative = discharging
            amps -= 2 ** 64
        if amps < 0:
            return volts / 1000.0 * (-amps) / 1000.0
    return None


class PowerMeter:
    """Laptop power once a second; keeps 10 minutes of history.

    Best source: `power-feed` (powermetrics, chip power every second, needs sudo in your own terminal)
    posts readings here with feed(). Without it: the battery gauge via ioreg (no sudo, but it only
    updates every ~30 s, so a grid cut shows up late).
    """

    def __init__(self, period: float = 1.0, source=_ioreg_power):
        self.source, self.period = source, period
        self.watts: Optional[float] = None
        self.history: deque = deque(maxlen=600)       # (t, watts)
        self.ok: Optional[bool] = None
        self.label = "battery gauge (updates ~30 s)"
        self._fed_at = 0.0
        self._stop = threading.Event()

    def feed(self, watts: float) -> None:
        """A 1-second chip-power reading from `protect/run.py power-feed`."""
        self._fed_at, self.ok, self.label = time.time(), True, "powermetrics, chip power every 1 s"
        self.watts = round(float(watts), 2)
        self.history.append((time.time(), self.watts))

    def start(self) -> "PowerMeter":
        threading.Thread(target=self._run, name="power", daemon=True).start()
        return self

    def _run(self) -> None:
        while not self._stop.is_set():
            if time.time() - self._fed_at < 3:            # the fast feed is live: don't mix sources
                self._stop.wait(self.period)
                continue
            self.label = "battery gauge (updates ~30 s)"
            w = self.source()
            self.ok = w is not None
            if w is not None:
                self.watts = w if self.watts is None else round(self.watts * 0.6 + w * 0.4, 2)
                self.history.append((time.time(), self.watts))
            self._stop.wait(self.period)

    def avg(self, seconds: float) -> Optional[float]:
        cutoff = time.time() - seconds
        vals = [w for t, w in self.history if t >= cutoff]
        return round(sum(vals) / len(vals), 1) if vals else None

    def stop(self) -> None:
        self._stop.set()


def _burn(paused, stop) -> None:                      # one flexible AI job = one busy core
    import signal

    signal.signal(signal.SIGINT, signal.SIG_IGN)
    x = 0.0
    while not stop.is_set():
        if paused.is_set():
            time.sleep(0.05)
            continue
        for i in range(20000):
            x = (x * 1.0000001 + i) % 1e9


class FlexLoad:
    """N worker processes. pause(fraction) idles that share of them; resume() brings them back."""

    def __init__(self, workers: Optional[int] = None):
        self.n = max(0, (os.cpu_count() or 4) - 2 if workers is None else workers)
        self._ctx = mp.get_context("spawn")
        self._stop = self._ctx.Event()
        self._paused = [self._ctx.Event() for _ in range(self.n)]
        self._procs: list = []
        self.paused_fraction = 0.0

    def start(self) -> "FlexLoad":
        for ev in self._paused:
            p = self._ctx.Process(target=_burn, args=(ev, self._stop), daemon=True)
            p.start()
            self._procs.append(p)
        return self

    @property
    def running(self) -> int:
        return sum(1 for ev in self._paused if not ev.is_set())

    def pause(self, fraction: float) -> int:
        k = round(self.n * max(0.0, min(1.0, fraction)))
        for i, ev in enumerate(self._paused):
            ev.set() if i < k else ev.clear()
        self.paused_fraction = k / self.n if self.n else 0.0
        return k

    def resume(self) -> None:
        self.pause(0.0)

    def stop(self) -> None:
        self._stop.set()
        for p in self._procs:
            p.join(timeout=1)
