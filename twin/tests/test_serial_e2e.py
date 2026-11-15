"""Full path test: TwinController -> SerialLink -> virtual serial port -> fake ESP32 and back."""
import time

import pytest

from plotstar_twin.controller import TwinController
from plotstar_twin.grid_day import load_day
from plotstar_twin.serial_link import SerialLink
from plotstar_twin.sim_device import FakeEsp32
from plotstar_twin.sites import SiteBook
from plotstar_twin.workload import FakePool


class FixedMeter:
    name, measured, label = "fixed", True, "MEASURED (fixed)"

    def read(self):
        return 20.0

    def stop(self):
        pass


def wait_for(cond, timeout=4.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def rig():
    dev = FakeEsp32().start()
    holder = {}
    link = SerialLink(dev.port, on_line=lambda ln: holder["t"].on_serial_line(ln))
    twin = TwinController(load_day(), SiteBook(), FixedMeter(), FakePool(4), link, day_seconds=60)
    twin.calib = [10.0, 18.0, 26.0, 34.0, 42.0]
    holder["t"] = twin
    twin.replan()  # first LP solve imports scipy (~1 s); keep that out of the timed checks
    link.start()
    assert wait_for(lambda: link.connected), "twin could not open the virtual port"
    yield dev, twin, link
    link.stop()
    dev.stop()


def run_ticks(twin, seconds):
    end = time.time() + seconds
    while time.time() < end:
        twin.tick()
        time.sleep(0.1)


def test_board_receives_state_and_oled(rig):
    dev, twin, link = rig
    run_ticks(twin, 0.6)
    assert wait_for(lambda: dev.state.states_rx > 2)
    assert dev.online
    assert dev.state.oled[0].startswith("PLOTSTAR")
    assert 0 < dev.state.co2 < 1000


def test_knobs_reach_the_twin(rig):
    dev, twin, link = rig
    run_ticks(twin, 0.4)
    dev.set_flex(3)
    dev.press_key("C")
    dev.joystick("x", -1)
    assert wait_for(lambda: twin.controls.flex_pct == 1.0 and twin.controls.site == "C"
                    and twin.controls.cooling == "water")
    before = twin.controls.carbon_price
    dev.joystick("y", +1, hold_s=0.5)
    run_ticks(twin, 0.8)
    assert twin.controls.carbon_price > before


def test_emergency_button_lights_diesel_only_without_flex(rig):
    dev, twin, link = rig
    dev.set_flex(0)
    run_ticks(twin, 0.4)
    dev.press_button()
    assert wait_for(lambda: twin._emerg is not None)
    run_ticks(twin, 0.4)
    assert wait_for(lambda: dev.state.diesel and dev.state.alarm)
    assert "DIESEL" in dev.state.oled[4]

    dev.set_flex(2)
    dev.press_button()
    run_ticks(twin, 0.6)
    assert wait_for(lambda: not dev.state.diesel)
    assert twin.pool.active == 1


def test_selftest_and_ping_commands(rig):
    dev, twin, link = rig
    link.write(b"TEST\n")
    link.write(b"PING\n")
    assert wait_for(lambda: dev.state.test_runs == 1)
