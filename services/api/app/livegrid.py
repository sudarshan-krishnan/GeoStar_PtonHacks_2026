"""Live grid: two machines run the same fixed job continuously; the PlotStar machine follows the optimizer's
hourly plan (and curtails to the plan's depth during a grid event), the baseline runs flat. Real machines post
watts to POST /telemetry; when none has reported in 10 s the stream shows a labeled SIMULATION.

The ERCOT day replays in REPLAY_S seconds. Energy, CO2 and cost are accumulated server-side per machine from
watts x time, using the grid price and carbon at the replayed hour, so both machines are costed identically.
"""
from __future__ import annotations

import json
import secrets
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from . import config
from .db import session

DDL = """
CREATE TABLE IF NOT EXISTS telemetry (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        REAL NOT NULL,
    machine   TEXT NOT NULL,
    watts     REAL,
    progress  REAL,
    state     TEXT,
    source    TEXT NOT NULL,
    meter     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tel_machine_ts ON telemetry(machine, ts);
CREATE TABLE IF NOT EXISTS passports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
"""

MACHINES = ("baseline", "plotstar")
STALE_S = 10.0
REPLAY_S = 60.0
IDLE_W, LOAD_W = 10.0, 40.0         # PRD laptop figures; simulation only
JOB_S = 25.0                        # CPU-seconds of fixed work per job (simulation)
GAP_S = 0.8                         # idle between jobs


def init() -> None:
    with session() as c:
        c.executescript(DDL)


def _now() -> float:
    return time.time()


@dataclass
class Emergency:
    active: bool = False
    started: float | None = None
    until: float | None = None
    facility_depth: float = 0.3        # share of facility load to shed (the plan's d)
    source: str = "software"


@dataclass
class SimMachine:
    progress: float = 0.0
    state: str = "running"
    watts: float = LOAD_W
    jobs_done: int = 0
    idle_until: float | None = None


@dataclass
class Totals:
    wh: float = 0.0
    g_co2: float = 0.0
    cents: float = 0.0
    seconds: float = 0.0


@dataclass
class State:
    emergency: Emergency = field(default_factory=Emergency)
    replay_start: float = field(default_factory=_now)
    plan: dict[str, Any] | None = None              # run_id, site, d, f, flexible_share, schedule[24]
    sim: dict[str, SimMachine] = field(default_factory=lambda: {m: SimMachine() for m in MACHINES})
    sim_last: float = field(default_factory=_now)
    totals: dict[str, Totals] = field(default_factory=lambda: {m: Totals() for m in MACHINES})
    account_last: dict[str, float] = field(default_factory=dict)
    pre_emergency_watts: dict[str, float] = field(default_factory=dict)
    during_watts: dict[str, float] = field(default_factory=dict)
    response_logged_at: float | None = None
    live_passport: dict[str, Any] | None = None


STATE = State()


# ----------------------------------------------------------------------------- plan + replay

def set_plan(plan: dict[str, Any] | None) -> None:
    STATE.plan = plan


def replay_hour() -> float:
    return ((_now() - STATE.replay_start) % REPLAY_S) / REPLAY_S * 24.0


def plan_duty(hour_idx: int, price: list[float]) -> float:
    """PlotStar machine duty for a replay hour: the plan's hourly load as a share of its maximum."""
    sched = (STATE.plan or {}).get("schedule")
    if sched and max(sched) > 0:
        return max(0.2, sched[hour_idx] / max(sched))
    dear = sorted(range(24), key=lambda h: -price[h])[:6]   # no plan yet: ease off in the 6 dearest hours
    return 0.55 if hour_idx in dear else 1.0


# ----------------------------------------------------------------------------- telemetry in

def check_token(auth_header: str | None) -> bool:
    key = config.TELEMETRY_API_KEY
    if not key or not auth_header or not auth_header.startswith("Bearer "):
        return False
    return secrets.compare_digest(auth_header[7:].strip(), key)


def record(machine: str, watts: float | None, progress: float | None, state: str | None, source: str, meter: str | None) -> None:
    with session() as c:
        c.execute("INSERT INTO telemetry (ts, machine, watts, progress, state, source, meter) VALUES (?,?,?,?,?,?,?)",
                  (_now(), machine, watts, progress, state, source, meter))
    try:  # mirror into the Atlas time-series collection, off-thread, best-effort
        from . import atlas
        atlas.telemetry_point(machine, watts, progress, state, source, meter)
    except Exception:
        pass


def latest(machine: str) -> dict[str, Any] | None:
    with session() as c:
        row = c.execute("SELECT * FROM telemetry WHERE machine = ? ORDER BY ts DESC LIMIT 1", (machine,)).fetchone()
    return dict(row) if row else None


def history(machine: str, seconds: float = 120.0) -> list[dict[str, Any]]:
    with session() as c:
        rows = c.execute("SELECT ts, watts, progress, state, source FROM telemetry WHERE machine = ? AND ts >= ? ORDER BY ts",
                         (machine, _now() - seconds)).fetchall()
    return [dict(r) for r in rows]


# ----------------------------------------------------------------------------- emergency + passport

def start_emergency(duration_s: float, facility_depth: float, source: str) -> Emergency:
    e = STATE.emergency
    now = _now()
    STATE.pre_emergency_watts = {m: _current_watts(m) for m in MACHINES}
    STATE.during_watts = {}
    STATE.response_logged_at = None
    e.active, e.started, e.until, e.facility_depth, e.source = True, now, now + duration_s, facility_depth, source
    STATE.live_passport = {
        "requested_at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"),
        "requested_depth": facility_depth, "requested_duration_s": duration_s, "trigger": source,
        "pre_watts": dict(STATE.pre_emergency_watts),
        "plan": STATE.plan and {k: STATE.plan.get(k) for k in ("run_id", "site", "d", "f", "flexible_share")},
    }
    return e


def _state_of(machine: str) -> tuple[str | None, str]:
    row = latest(machine)
    if row and _now() - row["ts"] <= STALE_S:
        return row["state"], row["source"]
    return STATE.sim[machine].state, "simulated"


def end_emergency() -> dict[str, Any] | None:
    e = STATE.emergency
    if not e.active:
        return None
    e.active = False
    now = _now()
    p = STATE.live_passport or {}
    pre = STATE.pre_emergency_watts
    during = {m: STATE.during_watts.get(m, pre.get(m)) for m in MACHINES}
    states = {m: _state_of(m) for m in MACHINES}
    measured = {m: (None if not pre.get(m) or during[m] is None else round(1 - during[m] / pre[m], 3)) for m in MACHINES}
    need = float(p.get("requested_depth") or 0)
    p.update({
        "ended_at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"),
        "duration_s": round(now - (e.started or now), 1),
        "response_time_s": None if STATE.response_logged_at is None else round(STATE.response_logged_at - (e.started or now), 1),
        "watts_during": during, "reduction_measured": measured,
        "verified": None if measured["plotstar"] is None else bool(measured["plotstar"] + 1e-6 >= need * 0.9),
        "source": {m: states[m][1] for m in MACHINES}, "job_state": {m: states[m][0] for m in MACHINES},
        "methodology": "Reduction = 1 - (lowest reading during the event / reading just before it), per machine. "
                       "Simulated readings model the plan and are not measurements.",
    })
    with session() as c:
        c.execute("INSERT INTO passports (created_at, payload_json) VALUES (?,?)",
                  (datetime.now(timezone.utc).isoformat(timespec="seconds"), json.dumps(p)))
    STATE.live_passport = None
    STATE.during_watts = {}
    return p


def command() -> dict[str, Any]:
    e = STATE.emergency
    if e.active and e.until and _now() > e.until:
        end_emergency()
    return {"emergency": e.active, "until": e.until, "facility_depth": e.facility_depth,
            "requested_reduction": e.facility_depth, "replay_hour": replay_hour()}


def latest_passport() -> dict[str, Any] | None:
    with session() as c:
        row = c.execute("SELECT * FROM passports ORDER BY id DESC LIMIT 1").fetchone()
    return {"created_at": row["created_at"], **json.loads(row["payload_json"])} if row else None


# ----------------------------------------------------------------------------- simulation + accounting

def _advance_sim(price: list[float]) -> None:
    now = _now()
    dt = max(0.0, min(5.0, now - STATE.sim_last))
    STATE.sim_last = now
    e = STATE.emergency
    if e.active and e.until and now > e.until:
        end_emergency()
    hour_idx = int(replay_hour()) % 24
    for m, s in STATE.sim.items():
        if s.idle_until and now < s.idle_until:
            s.state, s.watts = "between jobs", IDLE_W
            continue
        duty = 1.0 if m == "baseline" else plan_duty(hour_idx, price)
        state = "running" if duty >= 0.95 else "eased off (plan)"
        if m == "plotstar" and e.active:
            # a facility-level cut of depth d means TOTAL draw falls by d from the pre-event reading
            pre = STATE.pre_emergency_watts.get(m) or s.watts
            duty = max(0.0, min(duty, (pre * (1.0 - e.facility_depth) - IDLE_W) / (LOAD_W - IDLE_W)))
            state = "curtailed (grid event)"
            if STATE.response_logged_at is None:
                STATE.response_logged_at = now
        s.state = state
        s.watts = IDLE_W + (LOAD_W - IDLE_W) * duty
        s.progress += dt * duty / JOB_S
        if s.progress >= 1.0:
            s.jobs_done += 1
            s.progress = 0.0
            s.idle_until = now + GAP_S


def _account(m: str, watts: float, price: list[float], carbon: list[float]) -> None:
    now = _now()
    last = STATE.account_last.get(m)
    STATE.account_last[m] = now
    if last is None:
        return
    dt = max(0.0, min(5.0, now - last))
    i = int(replay_hour()) % 24
    wh = watts * dt / 3600.0
    t = STATE.totals[m]
    t.wh += wh
    t.g_co2 += wh / 1000.0 * carbon[i]          # kWh x g/kWh
    t.cents += wh / 1e6 * price[i] * 100.0      # MWh x $/MWh x 100
    t.seconds += dt


def _current_watts(m: str) -> float:
    row = latest(m)
    if row and _now() - row["ts"] <= STALE_S and row["watts"] is not None:
        return float(row["watts"])
    return STATE.sim[m].watts


def current(machine: str, price: list[float]) -> dict[str, Any]:
    row = latest(machine)
    if row and _now() - row["ts"] <= STALE_S:
        w = row["watts"]
        if STATE.emergency.active and w is not None:
            STATE.during_watts[machine] = min(STATE.during_watts.get(machine, w), w)
            if machine == "plotstar" and STATE.response_logged_at is None and STATE.pre_emergency_watts.get(machine) \
               and w < 0.9 * STATE.pre_emergency_watts[machine]:
                STATE.response_logged_at = row["ts"]
        return {"watts": w, "progress": row["progress"], "state": row["state"], "source": row["source"],
                "meter": row["meter"], "jobs_done": None}
    _advance_sim(price)
    s = STATE.sim[machine]
    if STATE.emergency.active:
        STATE.during_watts[machine] = min(STATE.during_watts.get(machine, s.watts), s.watts)
    return {"watts": round(s.watts, 1), "progress": round(s.progress, 3), "state": s.state, "source": "simulated",
            "meter": None, "jobs_done": s.jobs_done}


def reset_simulation() -> None:
    STATE.sim = {m: SimMachine() for m in MACHINES}
    STATE.totals = {m: Totals() for m in MACHINES}
    STATE.account_last = {}
    STATE.sim_last = _now()
    STATE.replay_start = _now()
    STATE.emergency = Emergency()
    STATE.live_passport = None


def snapshot(price: list[float], carbon: list[float], mix: list[dict[str, float]] | None) -> dict[str, Any]:
    cmd = command()
    machines = {m: current(m, price) for m in MACHINES}
    for m in MACHINES:
        if machines[m]["watts"] is not None:
            _account(m, float(machines[m]["watts"]), price, carbon)
    h = replay_hour()
    i = int(h) % 24
    e = STATE.emergency
    return {
        "t": _now(),
        "replay": {"hour": round(h, 2), "hour_idx": i, "price": price[i], "carbon": carbon[i], "mix": mix[i] if mix else None,
                   "day_s": REPLAY_S},
        "machines": machines,
        "totals": {m: asdict(STATE.totals[m]) for m in MACHINES},
        "plan": STATE.plan and {k: STATE.plan.get(k) for k in ("run_id", "site", "d", "f", "flexible_share")},
        "plan_duty": None if STATE.plan is None else round(plan_duty(i, price), 2),
        "emergency": {**asdict(e), "remaining_s": None if not cmd["emergency"] or not cmd["until"] else round(max(0.0, cmd["until"] - _now()), 1)},
        "labels": {m: ("Measured" if machines[m]["source"] == "measured" else "Estimated" if machines[m]["source"] == "estimated" else "Simulated") for m in MACHINES},
        "telemetry_configured": bool(config.TELEMETRY_API_KEY),
    }
