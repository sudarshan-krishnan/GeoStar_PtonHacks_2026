import numpy as np
import pytest

from plotstar_twin import protocol
from plotstar_twin.controller import TwinController
from plotstar_twin.grid_day import Hour, load_day, synthetic_day
from plotstar_twin.power import Pi5Pmic
from plotstar_twin.scheduler import _greedy, daily_budget_hours, hourly_cost, plan_cost_first, plan_plotstar
from plotstar_twin.serial_link import NullLink
from plotstar_twin.sites import SiteBook
from plotstar_twin.workload import FakePool


class FixedMeter:
    name, measured, label = "fixed", True, "MEASURED (fixed)"

    def __init__(self, w=20.0):
        self.w = w

    def read(self):
        return self.w

    def stop(self):
        pass


class RecLink(NullLink):
    def __init__(self):
        self.sent = []

    def write(self, data):
        self.sent.append(data.decode())
        return True


def make_twin(link=None):
    pool = FakePool(4)
    t = TwinController(synthetic_day(), SiteBook(), FixedMeter(), pool, link or NullLink(), day_seconds=60)
    t.calib = [10.0, 18.0, 26.0, 34.0, 42.0]
    return t


# ---------------------------------------------------------------- protocol
def test_state_encoding_clamps():
    s = protocol.encode_state(25.5, 1.4, -0.2, 0.5, 412.4, True, False).decode()
    assert s == "S h=1.500 wind=1.000 solar=0.000 gas=0.500 co2=412 diesel=1 alarm=0\n"


def test_lines_are_sanitised_and_padded():
    msg = protocol.encode_lines(["a|b", "x" * 40]).decode()
    rows = msg[2:-1].split("|")
    assert len(rows) == 6 and rows[0] == "a b" and len(rows[1]) == 21


def test_parse_inputs():
    i = protocol.parse_inputs("I flex=2 jx=-1 jy=1 key=B kseq=4 bseq=1 temp=33.1 up=9")
    assert (i.flex, i.jx, i.jy, i.key, i.kseq, i.bseq, i.temp_c) == (2, -1, 1, "B", 4, 1, 33.1)
    assert protocol.parse_inputs("I flex=0 temp=-").temp_c is None
    assert protocol.parse_inputs("HELLO plotstar") is None


# ---------------------------------------------------------------- grid day
def test_carbon_intensity_is_weighted_mix():
    gen = {k: 0.0 for k in ("coal_mw", "gas_mw", "other_mw", "wind_mw", "solar_mw",
                            "nuclear_mw", "hydro_mw", "storage_mw")}
    gen.update(gas_mw=50.0, wind_mw=50.0)
    assert Hour(0, 30.0, 100.0, gen).carbon == pytest.approx(220.0)


def test_real_ercot_csv_loads():
    day = load_day()
    assert len(day.hours) == 24
    assert all(0 < h.carbon < 1000 for h in day.hours)


# ---------------------------------------------------------------- scheduler
def test_budget_mapping():
    assert daily_budget_hours(0) == 0
    assert daily_budget_hours(0.5) == pytest.approx(4.38)


def test_no_flex_runs_flat_and_needs_diesel_in_emergency():
    p = plan_plotstar(synthetic_day(), 0.0, 50, emergency_hours={17, 18})
    assert np.all(p.flex_on == 1) and p.diesel_hours == {17, 18}


def test_lp_respects_budget_and_cuts_most_expensive_hours():
    day = synthetic_day()
    p = plan_plotstar(day, 0.5, 50)
    assert p.curtailed_hours == pytest.approx(daily_budget_hours(0.5), abs=1e-6)
    cost = hourly_cost(day, 50, 150.0, day.peak_hours(1))
    cut = {t for t in range(24) if p.flex_on[t] < 1}
    worst = set(np.argsort(-cost)[:len(cut)])
    assert cut == worst
    assert np.allclose(p.flex_on, _greedy(cost, p.budget_hours, set()))


def test_emergency_hours_forced_off_and_no_diesel():
    p = plan_plotstar(synthetic_day(), 0.25, 50, emergency_hours={3, 4, 5})
    assert all(p.flex_on[t] == 0 for t in (3, 4, 5)) and not p.diesel_hours


def test_cost_first_is_flat():
    p = plan_cost_first({9})
    assert np.all(p.flex_on == 1) and p.diesel_hours == {9}


# ---------------------------------------------------------------- sites
def test_site_limits():
    sb = SiteBook()
    a = {c.name: c.ok for c in sb.checks("A", "water", 0.0)}
    assert a == {"grid": False, "water": False, "homes": False}
    b = {c.name: c.ok for c in sb.checks("B", "air", 0.5)}
    assert all(b.values())


# ---------------------------------------------------------------- power
def test_pi5_pmic_parse():
    text = ("  VDD_CORE_A current(7)=2.00000000A\n  VDD_CORE_V volt(15)=0.80000000V\n"
            "  EXT5V_V volt(24)=5.10000000V\n")
    assert Pi5Pmic.parse(text) == pytest.approx(1.6)


# ---------------------------------------------------------------- controller
def test_emergency_with_no_flex_lights_diesel():
    t = make_twin()
    t.control(flex_pct=0.0)
    t.tick(now=t._t0 + 0.01)
    t.control(emergency=True)
    s = t.tick(now=t._t0 + 0.02)
    assert s["emergency"] and s["diesel"] and s["workers"]["active"] == 4


def test_emergency_with_flex_curtails_instead():
    t = make_twin()
    t.control(flex_pct=0.5)
    t.tick(now=t._t0 + 0.01)
    t.control(emergency=True)
    s = t.tick(now=t._t0 + 0.02)
    assert s["emergency"] and not s["diesel"] and s["workers"]["active"] == 1


def test_hardware_inputs_drive_controls():
    t = make_twin()
    t.on_serial_line("I flex=1 jx=0 jy=0 key=- kseq=0 bseq=0 temp=- up=1")
    assert t.controls.flex_pct == 0.25
    t.on_serial_line("I flex=3 jx=-1 jy=0 key=C kseq=1 bseq=0 temp=30.0 up=2")
    assert (t.controls.flex_pct, t.controls.cooling, t.controls.site) == (1.0, "water", "C")
    t.on_serial_line("I flex=3 jx=-1 jy=0 key=D kseq=2 bseq=1 temp=30.0 up=3")
    assert t.controls.physical_plan == "cost_first" and t._emerg is not None


def test_tick_sends_state_and_oled_lines():
    link = RecLink()
    t = make_twin(link)
    t.tick(now=t._t0 + 1.0)
    assert link.sent[0].startswith("S h=") and link.sent[1].startswith("L PLOTSTAR")
    for row in link.sent[1][2:-1].split("|"):
        assert len(row) <= 21


class SpikyMeter(FixedMeter):
    """Turbo spikes + background noise, like an Intel laptop under powermetrics."""

    def __init__(self):
        self.i = 0

    def read(self):
        self.i += 1
        return 30.0 + (25.0 if self.i % 7 == 0 else 0.0) + (self.i % 3)


def test_noisy_meter_cannot_flip_the_comparison():
    t = TwinController(load_day(), SiteBook(), SpikyMeter(), FakePool(4), NullLink(), day_seconds=60)
    t.calib = [20.84, 25.89, 31.11, 34.95, 41.16]   # Sid's real Nov 13 calibration
    t.control(flex_pct=0.5)
    for k in range(1, 605):
        t.tick(now=t._t0 + k * 0.1)
    p, c = t.last_day["totals"]["plotstar"], t.last_day["totals"]["cost_first"]
    assert p["energy_mwh"] < c["energy_mwh"]
    assert p["carbon_t"] < c["carbon_t"] and p["cost_usd"] < c["cost_usd"]
    assert p["peak_hour_mw"] < 0.5 * c["peak_hour_mw"]       # PlotStar curtails the system-peak hour
    assert c["peak_hour_mw"] == pytest.approx(420.0, rel=1e-3)  # 300 MW IT x PUE 1.4, flat
    assert t.last_day["measured"]["model_error_pct"] is not None


def test_day_rollover_records_summary():
    t = make_twin()
    for k in range(1, 700):
        t.tick(now=t._t0 + k * 0.1)
    assert t.last_day is not None
    tot = t.last_day["totals"]
    assert tot["plotstar"]["energy_mwh"] < tot["cost_first"]["energy_mwh"]
