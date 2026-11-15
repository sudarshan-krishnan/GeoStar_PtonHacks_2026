"""The twin's brain: replays a grid day, runs the schedule on real hardware, measures, reports.

Timeline: one replayed day lasts `day_seconds` (default 60 s), so each grid hour is 2.5 s.
Accounting: the measured chip power during a replayed hour is treated as the load level for
that whole hour ("time-compressed replay"). The laptop's watts above idle are scaled to the
facility size (facility_mw at full load) and multiplied by the cooling PUE.

Comparison: both plans are priced the same way, from the per-worker watts measured on this
chip at start-up (apples to apples). One plan also runs on the real chip (keypad D switches
which); the live meter's raw samples for that run are reported next to the model's
prediction, as a check ("live meter vs model %"). Peak-hour draw is the hour's average.
"""
from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from . import protocol
from .grid_day import GAS_FULL_MW, SOLAR_FULL_MW, WIND_FULL_MW, GridDay
from .scheduler import FLEX_LEVELS, Plan, plan_cost_first, plan_plotstar
from .sites import SiteBook

CAL_FILE = Path(__file__).resolve().parents[1] / "data" / "calibration.json"
EMERGENCY_HOURS = 3          # a grid-emergency press covers 3 replayed hours
CARBON_PRICE_RATE = 40.0     # $/t per second while the joystick is held
CARBON_PRICE_MAX = 200.0


@dataclass
class DayTotals:
    energy_mwh: float = 0.0
    carbon_t: float = 0.0
    cost_usd: float = 0.0
    water_m3: float = 0.0
    max_mw: float = 0.0
    diesel_hours: float = 0.0
    curtailed_hours: float = 0.0
    peak_mwh: float = 0.0         # energy drawn during the system-peak hour...
    peak_h: float = 0.0           # ...and the replay time spent in it

    @property
    def peak_hour_mw(self) -> float:
        """Average facility draw during the system-peak hour (what a 4CP-style charge bills)."""
        return self.peak_mwh / self.peak_h if self.peak_h else 0.0

    def rounded(self) -> dict:
        d = {k: round(v, 3) for k, v in asdict(self).items() if k not in ("peak_mwh", "peak_h")}
        d["peak_hour_mw"] = round(self.peak_hour_mw, 3)
        return d


@dataclass
class Controls:
    site: str = "B"
    cooling: str = "air"             # "air" or "water"
    flex_idx: int = 2                # index into FLEX_LEVELS
    carbon_price: float = 50.0       # $/tCO2
    physical_plan: str = "plotstar"  # which plan runs on the real chip

    @property
    def flex_pct(self) -> float:
        return FLEX_LEVELS[self.flex_idx]


class TwinController:
    def __init__(self, day: GridDay, sites: SiteBook, meter, pool, link, *,
                 day_seconds: float = 60.0, peak_charge: float = 150.0, tick_hz: float = 10.0):
        self.day, self.sites, self.meter, self.pool, self.link = day, sites, meter, pool, link
        self.day_seconds, self.peak_charge, self.dt = day_seconds, peak_charge, 1.0 / tick_hz
        self.n_workers = pool.n
        self.controls = Controls()
        self.lock = threading.RLock()
        self.calib: list[float] = []          # watts with 0..n workers active
        self.phase = "starting"
        self.temp_c: Optional[float] = None
        self._inputs: Optional[protocol.Inputs] = None
        self._jy = 0
        self._emerg: Optional[tuple[float, float]] = None   # absolute replay hours [start, end)
        self._t0 = time.monotonic()
        self._abs_hour = 0.0
        self._day_idx = 0
        self._dirty = True
        self.plans: dict[str, Plan] = {}
        self.totals = {"plotstar": DayTotals(), "cost_first": DayTotals()}
        self.measured = DayTotals()            # live meter, for whatever plan runs on the chip
        self._measured_model_mwh = 0.0         # what the calibration model predicted for the same run
        self.last_day: Optional[dict] = None
        self.measured_wh_real = 0.0
        self._watts = 0.0
        self._snapshot: dict = {}
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------ calibration
    def calibrate(self, use_cache: bool = False, settle: float = 2.0, sample: float = 3.0) -> list[float]:
        key = f"{self.meter.name}|{self.n_workers}"
        if use_cache and CAL_FILE.exists():
            cached = json.loads(CAL_FILE.read_text()).get(key)
            if cached:
                self.calib = cached
                print(f"[calib] using cached calibration: {cached}")
                return cached
        self.phase = "calibrating"
        out = []
        for n in range(self.n_workers + 1):
            self.pool.set_active(n)
            self._oled([f"PLOTSTAR CALIBRATE", f"workers on: {n}/{self.n_workers}",
                        "measuring power...", "", "keep laptop idle", self.meter.label[:21]])
            time.sleep(settle)
            readings, end = [], time.monotonic() + sample
            while time.monotonic() < end:
                w = self.meter.read()
                if w is not None:
                    readings.append(w)
                time.sleep(0.1)
            w = sum(readings) / len(readings) if readings else (out[-1] + 5.0 if out else 10.0)
            if out:
                w = max(w, out[-1] + 0.1)   # power must not drop when adding work
            out.append(round(w, 2))
            print(f"[calib] {n} worker(s): {w:.2f} W")
        self.pool.set_active(1)
        self.calib = out
        CAL_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = json.loads(CAL_FILE.read_text()) if CAL_FILE.exists() else {}
        data[key] = out
        CAL_FILE.write_text(json.dumps(data, indent=2))
        return out

    @property
    def idle_w(self) -> float:
        return self.calib[0] if self.calib else 0.0

    @property
    def it_mw_per_w(self) -> float:
        span = (self.calib[-1] - self.calib[0]) if len(self.calib) > 1 else 1.0
        return self.sites.facility_mw / max(span, 1e-3)

    # ---------------------------------------------------------------- inputs
    def on_serial_line(self, line: str) -> None:
        inp = protocol.parse_inputs(line)
        if inp:
            self.apply_inputs(inp)

    def apply_inputs(self, inp: protocol.Inputs) -> None:
        with self.lock:
            prev = self._inputs
            self._inputs = inp
            self.temp_c = inp.temp_c
            self._jy = inp.jy
            if prev is None:              # first message after (re)connect: adopt the dial, no events
                self._set_flex(inp.flex)
                return
            if inp.flex != prev.flex:
                self._set_flex(inp.flex)
            if inp.jx != prev.jx and inp.jx != 0:
                self._set("cooling", "water" if inp.jx < 0 else "air")
            if inp.kseq != prev.kseq:
                if inp.key in ("A", "B", "C"):
                    self._set("site", inp.key)
                elif inp.key == "D":
                    self._set("physical_plan",
                              "cost_first" if self.controls.physical_plan == "plotstar" else "plotstar")
            if inp.bseq != prev.bseq:
                self.trigger_emergency()

    def _set_flex(self, idx: int) -> None:
        self._set("flex_idx", max(0, min(len(FLEX_LEVELS) - 1, int(idx))))

    def _set(self, name: str, value) -> None:
        if getattr(self.controls, name) != value:
            setattr(self.controls, name, value)
            self._dirty = True

    def control(self, **kw) -> dict:
        """Dashboard / API entry point. Same effect as the physical knobs."""
        with self.lock:
            if "site" in kw and kw["site"] in self.sites.sites:
                self._set("site", kw["site"])
            if kw.get("cooling") in ("air", "water"):
                self._set("cooling", kw["cooling"])
            if "flex_pct" in kw and float(kw["flex_pct"]) in FLEX_LEVELS:
                self._set_flex(FLEX_LEVELS.index(float(kw["flex_pct"])))
            if "carbon_price" in kw:
                self._set("carbon_price", max(0.0, min(CARBON_PRICE_MAX, float(kw["carbon_price"]))))
            if kw.get("physical_plan") in ("plotstar", "cost_first"):
                self._set("physical_plan", kw["physical_plan"])
            if kw.get("emergency"):
                self.trigger_emergency()
            return asdict(self.controls)

    def trigger_emergency(self) -> None:
        with self.lock:
            start = math.floor(self._abs_hour)
            self._emerg = (float(start), float(start + EMERGENCY_HOURS))
            self._dirty = True
            print(f"[grid] emergency call for hours {start % 24:02d}-{(start + EMERGENCY_HOURS) % 24:02d}")

    def _emergency_hours_today(self) -> set:
        if not self._emerg:
            return set()
        base = self._day_idx * 24
        return {h - base for h in range(int(self._emerg[0]), int(self._emerg[1])) if base <= h < base + 24}

    def emergency_now(self) -> bool:
        return bool(self._emerg) and self._emerg[0] <= self._abs_hour < self._emerg[1]

    # -------------------------------------------------------------- planning
    def replan(self) -> None:
        c = self.controls
        emerg = self._emergency_hours_today()
        self.plans = {
            "plotstar": plan_plotstar(self.day, c.flex_pct, c.carbon_price, emergency_hours=emerg,
                                      peak_charge=self.peak_charge),
            "cost_first": plan_cost_first(emerg),
        }
        self._dirty = False

    def _active_workers(self, plan: Plan, hour: int) -> int:
        n_flex = self.n_workers - 1
        return 1 + int(round(plan.flex_on[hour] * n_flex))

    # ------------------------------------------------------------------ loop
    def tick(self, now: Optional[float] = None) -> dict:
        now = time.monotonic() if now is None else now
        with self.lock:
            c = self.controls
            # carbon price follows the joystick while it is held
            if self._jy:
                self._set("carbon_price", max(0.0, min(CARBON_PRICE_MAX,
                                                       c.carbon_price + self._jy * CARBON_PRICE_RATE * self.dt)))
            self._abs_hour = (now - self._t0) / self.day_seconds * 24.0
            day_idx = int(self._abs_hour // 24)
            if day_idx != self._day_idx:
                self._close_day()
                self._day_idx = day_idx
                self._dirty = True
            if self._dirty or not self.plans:
                self.replan()

            h = self._abs_hour % 24.0
            hi = int(h)
            grid = self.day.at(h)
            hour_row = self.day.hours[hi]
            phys_name = c.physical_plan
            cf_name = "cost_first" if phys_name == "plotstar" else "plotstar"
            phys, cf = self.plans[phys_name], self.plans[cf_name]

            active = self._active_workers(phys, hi)
            self.pool.set_active(active)
            emergency = self.emergency_now()
            diesel = emergency and hi in phys.diesel_hours

            raw = self.meter.read()
            if raw is None:
                raw = self.calib[active] if self.calib else 0.0
            self._watts = raw if self._watts == 0 else 0.7 * self._watts + 0.3 * raw   # display only
            above = max(0.0, self._watts - self.idle_w)
            pue = self.sites.pue(c.cooling)
            replay_h = self.dt * 24.0 / self.day_seconds          # grid hours per tick
            raw_above = max(0.0, raw - self.idle_w)
            self.measured_wh_real += raw_above * self.dt / 3600.0
            peak = hi in self.day.peak_hours(1)

            # Headline comparison: BOTH plans priced the same way, from the per-worker watts
            # measured on this chip at calibration. Apples to apples.
            for name, plan in ((phys_name, phys), (cf_name, cf)):
                w_model = self._model_above_w(self._active_workers(plan, hi))
                self._accumulate(self.totals[name], w_model * self.it_mw_per_w * pue, w_model * self.it_mw_per_w,
                                 hour_row, replay_h, peak, emergency and hi in plan.diesel_hours, c.cooling)
                self.totals[name].curtailed_hours = plan.curtailed_hours
            # Validation: the live meter (raw samples, no smoothing) for whatever runs on the chip.
            self._accumulate(self.measured, raw_above * self.it_mw_per_w * pue, raw_above * self.it_mw_per_w,
                             hour_row, replay_h, peak, diesel, c.cooling)
            self._measured_model_mwh += self._model_above_w(active) * self.it_mw_per_w * pue * replay_h

            checks = self.sites.checks(c.site, c.cooling, c.flex_pct)
            facility_mw = above * self.it_mw_per_w * pue
            snap = {
                "phase": self.phase,
                "hour": round(h, 3),
                "clock": f"{hi:02d}:{int((h - hi) * 60):02d}",
                "day": {"label": self.day.label, "real": self.day.real, "source": self.day.source},
                "grid": {k: round(v, 2) for k, v in grid.items()},
                "controls": {**asdict(c), "flex_pct": c.flex_pct},
                "emergency": emergency,
                "emergency_hours": sorted(self._emergency_hours_today()),
                "diesel": diesel,
                "workers": {"active": active, "total": self.n_workers, "batches": self.pool.batches()},
                "power": {"watts": round(self._watts, 2), "idle_w": round(self.idle_w, 2),
                          "above_idle_w": round(above, 2), "label": self.meter.label,
                          "measured": self.meter.measured, "calibration_w": self.calib,
                          "measured_wh_real": round(self.measured_wh_real, 4)},
                "facility": {"mw": round(facility_mw, 1), "pue": pue, "nameplate_mw": self.sites.facility_mw},
                "temp_c": self.temp_c,
                "checks": [asdict(x) for x in checks],
                "plans": {k: p.to_json() for k, p in self.plans.items()},
                "totals_today": {k: t.rounded() for k, t in self.totals.items()},
                "measured_today": self._measured_summary(),
                "last_day": self.last_day,
                "hardware": {"connected": self.link.connected, "port": self.link.port, "hello": self.link.hello},
            }
            self._snapshot = snap
            self._drive_hardware(snap, grid, diesel, checks)
            return snap

    def _accumulate(self, t: DayTotals, mw: float, it_mw: float, row, replay_h: float,
                    peak: bool, diesel: bool, cooling: str) -> None:
        mwh = mw * replay_h
        t.energy_mwh += mwh
        t.carbon_t += mwh * row.carbon / 1000.0          # MWh x g/kWh = kg; /1000 = t
        t.cost_usd += mwh * row.price
        t.water_m3 += it_mw * replay_h * 1000.0 * self.sites.water_l_per_kwh(cooling) / 1000.0
        t.max_mw = max(t.max_mw, mw)
        if peak:
            t.peak_mwh += mwh
            t.peak_h += replay_h
        if diesel:
            t.diesel_hours += replay_h

    def _model_above_w(self, n_active: int) -> float:
        return max(0.0, self.calib[n_active] - self.idle_w) if self.calib else 0.0

    def _measured_summary(self) -> dict:
        m = self.measured.rounded()
        model = self._measured_model_mwh
        m["model_mwh"] = round(model, 3)
        m["model_error_pct"] = round((self.measured.energy_mwh - model) / model * 100.0, 1) if model > 0 else None
        m["plan"] = self.controls.physical_plan
        return m

    def _close_day(self) -> None:
        self.last_day = {
            "day_index": self._day_idx,
            "physical_plan": self.controls.physical_plan,
            "controls": {**asdict(self.controls), "flex_pct": self.controls.flex_pct},
            "totals": {k: t.rounded() for k, t in self.totals.items()},
            "measured": self._measured_summary(),
        }
        self.totals = {"plotstar": DayTotals(), "cost_first": DayTotals()}
        self.measured, self._measured_model_mwh = DayTotals(), 0.0
        p, c, m = (self.last_day["totals"]["plotstar"], self.last_day["totals"]["cost_first"],
                   self.last_day["measured"])
        print(f"[day] replay day {self._day_idx}: PlotStar vs cost-first | "
              f"carbon {p['carbon_t']:.0f} vs {c['carbon_t']:.0f} t | cost ${p['cost_usd']:,.0f} vs ${c['cost_usd']:,.0f} | "
              f"peak-hour {p['peak_hour_mw']:.0f} vs {c['peak_hour_mw']:.0f} MW | "
              f"diesel {p['diesel_hours']:.1f} vs {c['diesel_hours']:.1f} h | "
              f"live meter vs model {m['model_error_pct']}%")
        err = m["model_error_pct"]
        if err is not None and abs(err) > 15:
            print(f"[twin] WARNING: the chip is drawing {err:+.0f}% vs its calibration (laptop warmer, on battery, "
                  f"or other apps busy). Before judging: plug in, close apps, restart WITHOUT --skip-calibration.")

    # -------------------------------------------------------------- hardware
    def _oled(self, lines: list[str]) -> None:
        self.link.write(protocol.encode_lines(lines))

    def _drive_hardware(self, s: dict, grid: dict, diesel: bool, checks) -> None:
        c = self.controls
        self.link.write(protocol.encode_state(
            s["hour"], grid["wind_mw"] / WIND_FULL_MW, grid["solar_mw"] / SOLAR_FULL_MW,
            grid["gas_mw"] / GAS_FULL_MW, grid["carbon"], diesel, diesel))
        failed = [x for x in checks if not x.ok]
        if diesel:
            status = "!! DIESEL BACKUP ON"
        elif s["emergency"]:
            status = "GRID CALL: CURTAILED"
        elif failed:
            status = "FAIL: " + ",".join(x.name for x in failed)
        else:
            status = ("PLOTSTAR" if c.physical_plan == "plotstar" else "COST-1ST") + f" OK {s['facility']['mw']:.0f}MW"
        p = s["power"]
        self._oled([
            f"PLOTSTAR {s['clock']} SITE {c.site}",
            f"{c.cooling.upper():<5} F{c.flex_pct:g}% C${c.carbon_price:.0f}",
            f"IT{p['watts']:5.1f}W +{p['above_idle_w']:4.1f} {s['workers']['active']}/{self.n_workers}",
            f"CO2 {grid['carbon']:3.0f}g ${grid['price']:4.0f}/MWh",
            status,
            f"{self.day.label[:16]} {'MEAS' if self.meter.measured else 'EST'}",
        ])

    def run_forever(self) -> None:
        self.phase = "running"
        self._t0 = time.monotonic()
        next_t = time.monotonic()
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception as exc:  # keep the demo alive; log and continue
                print(f"[twin] tick error: {exc!r}")
            next_t += self.dt
            self._stop.wait(max(0.0, next_t - time.monotonic()))

    def start(self) -> "TwinController":
        self._thread = threading.Thread(target=self.run_forever, name="twin", daemon=True)
        self._thread.start()
        return self

    def snapshot(self) -> dict:
        with self.lock:
            return dict(self._snapshot)

    def day_json(self) -> dict:
        with self.lock:
            return {"day": self.day.to_json(), "plans": {k: p.to_json() for k, p in self.plans.items()},
                    "peak_hours": sorted(self.day.peak_hours(1))}

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        self.link.write(protocol.encode_state(0, 0, 0, 0, 0, False, False))
        self._oled(["PLOTSTAR  STOPPED", "", "twin not running"])
        self.pool.stop()
        self.meter.stop()
