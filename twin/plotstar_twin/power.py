"""Power meters for the machine running the AI workload.

MEASURED sources (chip's own energy counters):
  mac   - macOS `powermetrics` (needs sudo: run `sudo -v` in the same terminal first)
  rapl  - Linux Intel/AMD RAPL counters (/sys/class/powercap)
  pi5   - Raspberry Pi 5 PMIC rails (`vcgencmd pmic_read_adc`)
ESTIMATED fallback:
  estimate - CPU utilisation x a linear power model. Always labelled ESTIMATED.
"""
from __future__ import annotations

import platform
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional


class PowerMeter:
    name = "base"
    measured = True

    def __init__(self):
        self._watts: Optional[float] = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.error: Optional[str] = None

    def start(self) -> "PowerMeter":
        self._thread = threading.Thread(target=self._run, name=f"meter-{self.name}", daemon=True)
        self._thread.start()
        return self

    def _set(self, w: float) -> None:
        with self._lock:
            self._watts = w

    def read(self) -> Optional[float]:
        with self._lock:
            return self._watts

    def wait_ready(self, timeout: float = 8.0) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if self.read() is not None:
                return True
            if self.error:
                return False
            time.sleep(0.1)
        return False

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:  # pragma: no cover - overridden
        raise NotImplementedError

    @property
    def label(self) -> str:
        return f"{'MEASURED' if self.measured else 'ESTIMATED'} ({self.name})"


class MacPowermetrics(PowerMeter):
    name = "macOS powermetrics"
    # Highest priority first. Apple Silicon prints CPU then Combined; Intel prints package power.
    PATTERNS = [
        re.compile(r"Combined Power \(CPU \+ GPU \+ ANE\):\s*([\d.]+)\s*(mW|W)", re.I),
        re.compile(r"package power[^:]*:\s*([\d.]+)\s*(mW|W)", re.I),
        re.compile(r"^CPU Power:\s*([\d.]+)\s*(mW|W)", re.I),
    ]

    def __init__(self, interval_ms: int = 500):
        super().__init__()
        self.interval_ms = interval_ms
        self._proc: Optional[subprocess.Popen] = None
        self._best = len(self.PATTERNS)

    @staticmethod
    def available() -> bool:
        return platform.system() == "Darwin" and shutil.which("powermetrics") is not None

    def _run(self) -> None:
        if subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode != 0:
            self.error = "sudo needs a password: run `sudo -v` in this terminal, then start again"
            return
        self._proc = subprocess.Popen(
            ["sudo", "-n", "powermetrics", "--samplers", "cpu_power", "-i", str(self.interval_ms)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        assert self._proc.stdout
        for line in self._proc.stdout:
            if self._stop.is_set():
                break
            for prio, pat in enumerate(self.PATTERNS):
                if prio > self._best:
                    break
                m = pat.search(line.strip())
                if m:
                    self._best = prio
                    v = float(m.group(1))
                    self._set(v / 1000.0 if m.group(2).lower() == "mw" else v)
                    break
        if not self._stop.is_set():
            self.error = "powermetrics exited"

    def stop(self) -> None:
        super().stop()
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()


class LinuxRapl(PowerMeter):
    name = "Linux RAPL"
    ROOT = Path("/sys/class/powercap/intel-rapl:0")

    @classmethod
    def available(cls) -> bool:
        f = cls.ROOT / "energy_uj"
        try:
            f.read_text()
            return True
        except OSError:
            return False

    def _run(self) -> None:
        energy = self.ROOT / "energy_uj"
        wrap = int((self.ROOT / "max_energy_range_uj").read_text())
        last_e, last_t = int(energy.read_text()), time.monotonic()
        while not self._stop.wait(0.5):
            e, t = int(energy.read_text()), time.monotonic()
            de = (e - last_e) % wrap
            self._set(de / 1e6 / (t - last_t))
            last_e, last_t = e, t


class Pi5Pmic(PowerMeter):
    name = "Pi 5 PMIC"
    CUR = re.compile(r"(\S+)_A current\(\d+\)=([\d.]+)A")
    VOLT = re.compile(r"(\S+)_V volt\(\d+\)=([\d.]+)V")

    @staticmethod
    def available() -> bool:
        if not shutil.which("vcgencmd"):
            return False
        out = subprocess.run(["vcgencmd", "pmic_read_adc"], capture_output=True, text=True)
        return out.returncode == 0 and "current" in out.stdout

    @classmethod
    def parse(cls, text: str) -> float:
        amps = {m.group(1): float(m.group(2)) for m in cls.CUR.finditer(text)}
        volts = {m.group(1): float(m.group(2)) for m in cls.VOLT.finditer(text)}
        return sum(a * volts[r] for r, a in amps.items() if r in volts)

    def _run(self) -> None:
        while not self._stop.is_set():
            out = subprocess.run(["vcgencmd", "pmic_read_adc"], capture_output=True, text=True)
            if out.returncode == 0:
                self._set(self.parse(out.stdout))
            self._stop.wait(0.5)


class EstimatedCpu(PowerMeter):
    name = "CPU-utilisation model"
    measured = False

    def __init__(self, idle_w: float = 10.0, full_w: float = 45.0):
        super().__init__()
        self.idle_w, self.full_w = idle_w, full_w

    def _run(self) -> None:
        import psutil

        psutil.cpu_percent(None)
        while not self._stop.wait(0.5):
            frac = psutil.cpu_percent(None) / 100.0
            self._set(self.idle_w + (self.full_w - self.idle_w) * frac)


def make_meter(kind: str = "auto") -> PowerMeter:
    kinds = {"mac": MacPowermetrics, "rapl": LinuxRapl, "pi5": Pi5Pmic, "estimate": EstimatedCpu}
    if kind != "auto":
        return kinds[kind]().start()
    for cls in (MacPowermetrics, Pi5Pmic, LinuxRapl):
        if cls.available():
            meter = cls().start()
            if meter.wait_ready():
                return meter
            print(f"[power] {cls.name} unavailable: {meter.error or 'no reading'}; trying next")
            meter.stop()
    print("[power] no hardware power counter found: using ESTIMATED power (label it on screen)")
    return EstimatedCpu().start()
