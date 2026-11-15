"""Workload controller: runs an AI-style job on this laptop and reports its measured power.

    sudo -v                                              # powermetrics needs admin; cache it first
    python bridge/controller.py --machine optimized      # SiteStar: pauses flexible work in a grid event
    python bridge/controller.py --machine baseline       # flat: ignores grid events
    python bridge/controller.py --machine optimized --bridge http://192.168.1.20:8000

The job is a fixed amount of dense matrix math on every CPU core (one numpy worker per core),
the stand-in for a training run: progress = work done / total work. During a grid event the
optimized machine stops the job (its flexible work) and keeps a light heartbeat running (its
critical work). When the event ends it resumes, so the job still finishes, just later. The
baseline machine never pauses.

Power meters (--meter):
  powermetrics   macOS chip power (CPU + GPU + ANE), once a second. Needs `sudo -v` first.
  mac-telemetry  macOS battery telemetry, no admin, but it refreshes only every 30 s or more:
                 too slow to show a pause; for a sanity check only.
  --meter-cmd    any command that prints this machine's watts (a smart plug, a USB meter).
With no working meter the controller refuses to report made-up numbers and exits.

Run one controller per machine: two on one laptop would measure the same power. With one
laptop, run --machine optimized here and start the bridge with --mock-grid; the flat machine
is then simulated and labeled as such on the page.
"""

import os

# one BLAS thread per worker process: the workers themselves fill the cores
for _var in ("VECLIB_MAXIMUM_THREADS", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse  # noqa: E402
import json  # noqa: E402
import multiprocessing as mp  # noqa: E402
import re  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import urllib.request  # noqa: E402

import numpy as np  # noqa: E402

UNIT = 384  # matrix size of one work unit


# ---------------------------------------------------------------- meters

class PowermetricsMeter:
    """Chip power from `sudo powermetrics --samplers cpu_power`, one sample per second."""

    name = "chip"
    COMBINED = re.compile(r"Combined Power \(CPU \+ GPU \+ ANE\):\s*(\d+)\s*mW")
    CPU = re.compile(r"^CPU Power:\s*(\d+)\s*mW", re.M)

    def __init__(self):
        self.latest = None
        self.proc = subprocess.Popen(["sudo", "-n", "powermetrics", "--samplers", "cpu_power", "-i", "1000"],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        threading.Thread(target=self._pump, daemon=True).start()
        for _ in range(40):  # wait up to 4 s for the first sample
            if self.latest is not None:
                return
            if self.proc.poll() is not None:
                err = (self.proc.stderr.read() or "").strip()
                raise RuntimeError(f"powermetrics didn't start ({err or 'exit ' + str(self.proc.returncode)}). Run `sudo -v` first.")
            time.sleep(0.1)
        raise RuntimeError("powermetrics gave no reading within 4 s")

    def _pump(self):
        for line in self.proc.stdout:
            v = self.parse(line)
            if v is not None:
                self.latest = v

    @classmethod
    def parse(cls, text):
        m = cls.COMBINED.search(text) or cls.CPU.search(text)
        return int(m.group(1)) / 1000 if m else None

    def read(self):
        return self.latest

    def close(self):
        self.proc.terminate()


class MacTelemetryMeter:
    """Whole-system load from macOS battery telemetry. No admin, but it refreshes slowly."""

    name = "system"

    def __init__(self):
        self.acc = self.n = None
        if self.read() is None:
            raise RuntimeError("this Mac doesn't expose PowerTelemetryData")
        print("Warning: macOS battery telemetry refreshes every 30 s or more; it will not show a short pause.")

    def read(self):
        out = subprocess.run(["ioreg", "-rn", "AppleSmartBattery"], capture_output=True, text=True, timeout=5).stdout
        m = re.search(r'"PowerTelemetryData" = \{([^}]*)\}', out)
        if not m:
            return None
        kv = {k: int(v) for k, v in re.findall(r'"(\w+)"=(\d+)', m.group(1))}
        acc, n = kv.get("AccumulatedSystemLoad"), kv.get("SystemLoadAccumulatorCount")
        watts = None
        if acc is not None and n is not None and self.n is not None and n > self.n:
            watts = (acc - self.acc) / (n - self.n) / 1000
        self.acc, self.n = acc, n
        return watts if watts is not None else (kv["SystemLoad"] / 1000 if "SystemLoad" in kv else None)

    def close(self):
        pass


class CmdMeter:
    name = "wall"

    def __init__(self, cmd):
        self.cmd = cmd
        if self.read() is None:
            raise RuntimeError(f"`{cmd}` printed no number")

    def read(self):
        out = subprocess.run(self.cmd, shell=True, capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"\d+(\.\d+)?", out)
        return float(m.group()) if m else None

    def close(self):
        pass


# ---------------------------------------------------------------- the job (one process per core)

def work(run, stop, counter):
    rng = np.random.default_rng(os.getpid())
    a = rng.random((UNIT, UNIT))
    b = rng.random((UNIT, UNIT))
    while not stop.is_set():
        if not run.is_set():
            time.sleep(0.05)
            continue
        a @ b
        with counter.get_lock():
            counter.value += 1


class Job:
    def __init__(self, seconds: float, workers: int):
        self.run, self.stop, self.counter = mp.Event(), mp.Event(), mp.Value("q", 0)
        self.run.set()
        self.procs = [mp.Process(target=work, args=(self.run, self.stop, self.counter), daemon=True) for _ in range(workers)]
        for p in self.procs:
            p.start()
        # calibrate on the real thing: every worker running at once (fast and efficiency cores differ)
        time.sleep(1.0)
        c0, t0 = self.counter.value, time.perf_counter()
        time.sleep(2.0)
        rate = (self.counter.value - c0) / (time.perf_counter() - t0)
        self.total = max(1, int(rate * seconds))

    @property
    def progress(self):
        return min(1.0, self.counter.value / self.total)

    @property
    def done(self):
        return self.counter.value >= self.total

    def pause(self, yes: bool):
        (self.run.clear if yes else self.run.set)()

    def end(self):
        self.stop.set()
        for p in self.procs:
            p.join(timeout=2)


# ---------------------------------------------------------------- bridge

def http(method, url, body=None, timeout=3):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def main() -> int:
    ap = argparse.ArgumentParser(description="SiteStar workload controller")
    ap.add_argument("--machine", choices=["optimized", "baseline"], required=True)
    ap.add_argument("--bridge", default="http://127.0.0.1:8000")
    ap.add_argument("--job-seconds", type=float, default=240, help="job length at full speed (default 4 min)")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--meter", choices=["powermetrics", "mac-telemetry"], default="powermetrics")
    ap.add_argument("--meter-cmd", help="command that prints this machine's watts (overrides --meter)")
    ap.add_argument("--loop", action="store_true", help="start a new job when one finishes")
    args = ap.parse_args()
    base = args.bridge.rstrip("/")

    try:
        meter = CmdMeter(args.meter_cmd) if args.meter_cmd else PowermetricsMeter() if args.meter == "powermetrics" else MacTelemetryMeter()
    except Exception as exc:
        print(f"No power meter: {exc}\nNot reporting made-up watts.")
        return 1

    heartbeat = np.random.default_rng(2).random((96, 96))
    try:
        while True:
            print(f"Calibrating a {args.job_seconds:.0f}-second job on {args.workers} cores…", flush=True)
            job = Job(args.job_seconds, args.workers)
            finished_at = None
            while True:
                t0 = time.time()
                emergency = None
                try:
                    emergency = bool(http("GET", f"{base}/api/grid")["emergency"])
                except Exception as exc:
                    print(f"  bridge unreachable ({exc}); keep running", flush=True)
                paused = args.machine == "optimized" and bool(emergency)
                job.pause(paused)
                if paused:
                    heartbeat @ heartbeat  # critical work keeps going
                done = job.done
                watts = meter.read()
                if watts is not None:
                    try:
                        http("POST", f"{base}/api/grid/telemetry", {"machine": args.machine, "watts": round(watts, 2),
                                                                    "progress": round(job.progress, 4), "done": done, "measure": meter.name})
                    except Exception as exc:
                        print(f"  couldn't post a reading ({exc})", flush=True)
                state = "PAUSED (grid event)" if paused else "done" if done else "running"
                print(f"  {args.machine}: {'—' if watts is None else f'{watts:.1f}'} W · job {job.progress:5.1%} · {state}", flush=True)
                if done and finished_at is None:
                    finished_at = time.time()
                    job.pause(True)
                if finished_at and time.time() - finished_at > 15:
                    break
                time.sleep(max(0.0, 1.0 - (time.time() - t0)))
            job.end()
            if not args.loop:
                print("Job finished.")
                return 0
    except KeyboardInterrupt:
        return 0
    finally:
        meter.close()


if __name__ == "__main__":
    sys.exit(main())
