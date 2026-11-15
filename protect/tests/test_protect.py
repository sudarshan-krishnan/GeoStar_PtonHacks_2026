import time

import pytest

from sitestar_protect.agent import IncidentCommander
from sitestar_protect.building import load_building
from sitestar_protect.controller import ProtectController
from sitestar_protect.device import (NullLink, Reading, encode_command, encode_panel, parse_badge,
                                     parse_reading)
from sitestar_protect.messaging import Messenger, parse_decision


class RecLink(NullLink):
    def __init__(self):
        self.sent = []

    def write(self, data):
        self.sent.append(data.decode())
        return True


def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def rig(tmp_path, link=None, lobby=None):
    b = load_building()
    m = Messenger(None)
    c = ProtectController(b, link or NullLink(), m, lobby=lobby, badges_path=tmp_path / "badges.json")
    c.commander = IncidentCommander(c, m, fs_root=tmp_path, model=None, mode="offline")
    return c, m


def reading(**kw):
    base = dict(leak=80, wet=False, beam=880, base=900, smoke=False, t=23.5, rh=46.0, pipe=21.0, pir=False,
                lvl=30.0, valve_open=True)
    base.update(kw)
    return Reading(**base)


# ----------------------------------------------------------------- protocol
def test_parse_reading_and_missing_sensors():
    r = parse_reading("I leak=2600 wet=1 beam=260 base=900 smoke=1 t=- rh=- pipe=3.5 pir=1 lvl=- valve=0 bseq=2 up=9")
    assert r.wet and r.smoke and r.t is None and r.pipe == 3.5 and r.pir and not r.valve_open
    assert round(r.beam_pct) == 29


def test_encode_command():
    assert encode_command(False, 1.4, True, 2, [2, 0, 1], 1).decode() == \
        "A valve=0 fan=1.00 strobe=1 buzz=2 r=2,0,1,0 agent=1 door=1\n"


def test_parse_door_switch_badge_panel():
    r = parse_reading("I leak=80 wet=0 beam=880 base=900 smoke=0 t=- rh=- pipe=- pir=0 lvl=- valve=0 vsw=1 door=0 bseq=0 up=1")
    assert r.vsw is True and r.door_open is False
    old = parse_reading("I leak=80 wet=0 beam=880 base=900 smoke=0 t=- rh=- pipe=- pir=0 lvl=- valve=1 bseq=0 up=1")
    assert old.vsw is None and old.door_open is True          # v1 firmware still parses
    assert parse_badge("C uid=20111b5c") == "20111B5C" and parse_badge("I lobby up=3") is None
    assert encode_panel("drop", "Leak 2F Bathroom, saved 12 L").decode() == \
        "P icon=drop text=LEAK 2F BATHROOM  SAVED 12 L\n"


def test_parse_decision():
    assert parse_decision("YES") == "approve" and parse_decision("yes please") == "approve"
    assert parse_decision("no, wait") == "reject" and parse_decision("what happened?") is None


# --------------------------------------------------------------- building
def test_sensor_plan_uses_floor_plan():
    b = load_building()
    kinds = {(p.room, p.kind) for p in b.plan}
    assert ("2F-BATH", "shutoff_valve") in kinds and ("1F-KITCH", "heat") in kinds
    assert ("1F-KITCH", "smoke") not in kinds                  # heat, not smoke, in kitchens
    valve = next(p for p in b.plan if p.room == "2F-BATH" and p.kind == "shutoff_valve")
    assert "1F Lounge" in valve.reason and valve.physical       # knows what is below
    assert all("NFPA 72" in p.code_note for p in b.plan)


# ---------------------------------------------------------------- reflexes
def test_leak_reflex_alerts_before_ai(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading())
    c.ingest(reading(leak=2600, wet=True, valve_open=False, pir=True))
    inc = c.detector.all[0]
    assert inc.kind == "leak" and inc.room == "2F-BATH"
    assert c.want_valve_open is False
    assert c.room_state["2F-BATH"] == 2 and c.room_state["1F-LOUNGE"] == 1   # room below flagged
    assert m.transcript[0]["kind"] == "alert" and "AI is investigating" in m.transcript[0]["text"]
    assert any("firmware" in r["action"] for r in inc.reflex)


def test_smoke_turns_fan_off_and_refuses_fan(tmp_path):
    c, _ = rig(tmp_path)
    c.fan = 0.8
    c.ingest(reading(beam=260, smoke=True, pir=True))
    assert c.strobe and c.buzz == 2 and c.fan == 0.0
    assert c.set_fan(1.0).startswith("refused")


def test_valve_interlock_refuses_reopen_while_wet(tmp_path):
    c, _ = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    assert c.request_valve(True).startswith("refused")
    assert c.want_valve_open is False


def test_humidity_spike_from_breath(tmp_path):
    c, _ = rig(tmp_path)
    for rh in (46, 47, 50, 55, 61):
        c.ingest(reading(rh=float(rh)))
    assert any(i.kind == "humidity_spike" for i in c.detector.all)
    assert c.fan >= 0.6


# ------------------------------------------------------- offline commander
def test_offline_flow_dossier_approval_dispatch(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False, pir=True))
    inc = c.detector.all[0]
    assert wait_for(lambda: inc.agent_state == "waiting_approval")
    report = (tmp_path / "incidents" / inc.id / "report.md").read_text()
    assert "1F Lounge" in report and "OCCUPIED" in report
    assert (tmp_path / "incidents" / inc.id / "work_order.md").exists()
    assert m.transcript[-1]["kind"] == "approval"
    m.receive("YES", channel="imessage")
    assert wait_for(lambda: c.commander.dispatches)
    assert wait_for(lambda: inc.agent_state == "done")
    assert "dispatched" in m.transcript[-1]["text"]


def test_leak_cleared_offers_reopen_needs_approval(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    inc = c.detector.all[0]
    assert wait_for(lambda: inc.agent_state == "waiting_approval")
    m.receive("no")                                   # decline the vendor
    assert wait_for(lambda: inc.agent_state == "done")
    c.ingest(reading(valve_open=False))               # probe dry -> cleared
    assert wait_for(lambda: any("REOPEN" in x["text"] for x in m.transcript))
    assert c.want_valve_open is False                 # still shut until approved
    m.receive("yes")
    assert wait_for(lambda: c.want_valve_open is True)


def test_question_gets_an_answer(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    inc = c.detector.all[0]
    assert wait_for(lambda: inc.agent_state == "waiting_approval")
    m.receive("what's going on?")                    # not yes/no while approval pending
    assert wait_for(lambda: "Reply YES or NO" in m.transcript[-1]["text"])


def test_yes_with_nothing_pending_says_so(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    inc = c.detector.all[0]
    assert wait_for(lambda: inc.agent_state == "waiting_approval")
    m.receive("YES")
    assert wait_for(lambda: c.commander.dispatches)
    n = len(c.commander.dispatches)
    m.receive("YES")                                          # extra tap
    assert wait_for(lambda: "Nothing needs your approval" in m.transcript[-1]["text"])
    assert len(c.commander.dispatches) == n                   # no double dispatch


def test_restart_continues_numbering_and_keeps_old_dossiers(tmp_path):
    old = tmp_path / "incidents" / "INC-0007"
    old.mkdir(parents=True)
    (old / "report.md").write_text("evidence from an earlier run")
    c, _ = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    assert c.detector.all[0].id == "INC-0008"
    assert (old / "report.md").read_text() == "evidence from an earlier run"


def test_phone_log_survives_restart(tmp_path):
    import json

    log = tmp_path / "phone.jsonl"
    m = Messenger(None, log_path=str(log))
    m.send("hello", kind="alert")
    m.receive("YES")
    lines = [json.loads(x) for x in log.read_text().splitlines()]
    assert [x["dir"] for x in lines] == ["out", "in"] and lines[1]["text"] == "YES"


def test_reopen_decision_recorded_in_dossier(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    inc = c.detector.all[0]
    assert wait_for(lambda: inc.agent_state == "waiting_approval")
    m.receive("yes")
    assert wait_for(lambda: inc.agent_state == "done")
    c.ingest(reading(valve_open=False))
    assert wait_for(lambda: any("REOPEN" in x["text"] for x in m.transcript))
    m.receive("yes")
    assert wait_for(lambda: c.want_valve_open is True)
    report = (tmp_path / "incidents" / inc.id / "report.md").read_text()
    assert wait_for(lambda: "Valve reopen" in (tmp_path / "incidents" / inc.id / "report.md").read_text())
    assert "Vendor dispatch" in report


# ------------------------------------------------------------- hardware out
def test_tick_drives_board(tmp_path):
    link = RecLink()
    c, _ = rig(tmp_path, link)
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    c.tick()
    assert link.sent[0].startswith("A valve=0") and "r=2,0,1,0" in link.sent[0]
    assert link.sent[1].startswith("L SITESTAR PROTECT|WATER LEAK")


# ------------------------------------------------- new parts: door, switch, lobby
def test_smoke_shuts_fire_door_and_reopens_after(tmp_path):
    link = RecLink()
    c, _ = rig(tmp_path, link)
    c.ingest(reading(beam=260, smoke=True, door_open=False))
    assert c.want_door_open is False
    assert any("fire door SHUT" in r["action"] for r in c.detector.all[0].reflex)
    c.tick()
    assert "door=0" in link.sent[0]
    c.ingest(reading(door_open=False))                        # smoke cleared
    assert c.want_door_open is True


def test_valve_switch_catches_a_jammed_valve(tmp_path):
    c, m = rig(tmp_path)
    t0 = time.time()
    c.ingest(reading(valve_open=False, vsw=False, ts=t0 - 10))
    c.ingest(reading(valve_open=False, vsw=False, ts=t0 - 7))
    assert not c.detector.all                                 # switch never pressed yet: not mounted, no alarm
    c.ingest(reading(valve_open=False, vsw=True, ts=t0 - 5))  # now it has been seen pressed: trust it
    c.ingest(reading(valve_open=True, vsw=False, ts=t0 - 3))
    c.ingest(reading(valve_open=False, vsw=False, ts=t0))
    assert not c.detector.all                                 # grace period while the servo moves
    c.ingest(reading(valve_open=False, vsw=False, ts=t0 + 2.0))
    inc = c.detector.all[0]
    assert inc.kind == "valve_fault" and inc.severity == "critical" and c.buzz == 2
    assert c.panel_state()[0] == "cross"
    c2, _ = rig(tmp_path / "b")
    c2.ingest(reading(valve_open=False, vsw=True, ts=t0))
    c2.ingest(reading(valve_open=False, vsw=True, ts=t0 + 2.0))
    assert not c2.detector.all                                # switch pressed: valve really shut


def test_water_saved_counts_while_valve_shut(tmp_path):
    c, _ = rig(tmp_path)
    t0 = time.time() - 120
    c.ingest(reading(leak=2600, wet=True, valve_open=False, ts=t0))
    assert 23 <= c.water_saved_l() <= 25                      # 2 min x 12 L/min
    icon, text = c.panel_state()
    assert icon == "drop" and "SAVED 24 L" in text
    assert "water saved 24 L" in c.oled_lines()[-1]


def test_unknown_badge_refused_when_no_vendor_expected(tmp_path):
    lobby = RecLink()
    c, m = rig(tmp_path, lobby=lobby)
    c.on_lobby_line("C uid=DEADBEEF")
    assert wait_for(lambda: c.last_badge and c.last_badge["result"].startswith("refused"))
    assert "Door stayed locked" in m.transcript[-1]["text"]
    c.tick()
    assert any(x.startswith("P icon=cross text=NO WORK ORDER") for x in lobby.sent)


def test_plumber_badge_checks_in_and_manager_card_approves_reopen(tmp_path):
    c, m = rig(tmp_path)
    c.make_manager_card("20111B5C")
    assert "20111B5C" in (tmp_path / "badges.json").read_text()
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    inc = c.detector.all[0]
    assert wait_for(lambda: inc.agent_state == "waiting_approval")
    c.on_badge("20111B5C")                                    # manager taps: approves the plumber
    assert wait_for(lambda: c.commander.dispatches)
    assert c.panel_state()[0] in ("check", "wrench")
    c.on_badge("A1B2C3D4")                                    # plumber arrives
    assert wait_for(lambda: c.commander.dispatches[0].get("arrived"))
    assert wait_for(lambda: "checked in at the lobby" in m.transcript[-1]["text"])
    assert "valve stays shut" in m.transcript[-1]["text"]
    assert wait_for(lambda: "Site visit" in (tmp_path / "incidents" / inc.id / "report.md").read_text())
    c.ingest(reading(valve_open=False))                       # sensor dry -> reopen offered
    assert wait_for(lambda: any("REOPEN" in x["text"] for x in m.transcript))
    c.on_badge("20111B5C")
    assert wait_for(lambda: c.want_valve_open is True)
    assert any(x["channel"] == "badge" for x in m.transcript if x["dir"] == "in")


def test_badge_line_from_the_esp32_itself(tmp_path):
    c, m = rig(tmp_path)
    c.on_serial_line("C uid=DEADBEEF")
    assert wait_for(lambda: c.last_badge and c.last_badge["result"].startswith("refused"))


def test_events_are_forwarded_to_the_team_app(tmp_path):
    class FakeHaven:
        def __init__(self): self.calls = []
        def incident(self, kind, title): self.calls.append(("incident", kind))
        def approved(self): self.calls.append(("approved",))
        def all_clear(self): self.calls.append(("clear",))
        def snapshot(self): return {}
    b = load_building(); m = Messenger(None); h = FakeHaven()
    c = ProtectController(b, NullLink(), m, badges_path=tmp_path / "badges.json", haven=h)
    c.commander = IncidentCommander(c, m, fs_root=tmp_path, model=None, mode="offline")
    c.make_manager_card("AA11")
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    assert ("incident", "leak") in h.calls
    assert wait_for(lambda: c.detector.all[0].agent_state == "waiting_approval")
    c.on_badge("AA11")
    assert wait_for(lambda: ("approved",) in h.calls)
    c.ingest(reading(valve_open=False))
    assert ("clear",) in h.calls


# ------------------------------------------------------------ data-hall power + grid events
class FakeMeter:
    def __init__(self, w=40.0): self.watts, self.ok, self.history = w, True, []
    def avg(self, seconds): return self.watts


class FakeFlex:
    n = 8
    def __init__(self): self.paused = 0.0
    @property
    def running(self): return round(self.n * (1 - self.paused))
    def pause(self, f): self.paused = f; return round(self.n * f)
    def resume(self): self.paused = 0.0


def power_rig(tmp_path):
    b = load_building(); m = Messenger(None); meter, flex = FakeMeter(), FakeFlex()
    c = ProtectController(b, NullLink(), m, badges_path=tmp_path / "badges.json", meter=meter, flex=flex)
    c.commander = IncidentCommander(c, m, fs_root=tmp_path, model=None, mode="offline")
    return c, m, meter, flex


def test_keypad_grid_event_needs_badge_then_cuts_load_and_cooling(tmp_path):
    from sitestar_protect.device import encode_console, parse_key
    assert parse_key("K A") == "A" and parse_key("K x") is None
    c, m, meter, flex = power_rig(tmp_path)
    c.make_manager_card("AA11")
    c.tick(); assert c.fan == 0.35                              # normal cooling
    for k in "50":
        c.on_key(k)
    c.on_key("A")                                               # "50 then A": grid event, 50 % cut
    assert c.grid["state"] == "requested" and c.grid["depth"] == 50 and flex.paused == 0.0
    assert "PAUSE 50%" in m.transcript[-1]["text"]
    c.on_badge("AA11")                                          # manager approves with the card
    assert wait_for(lambda: c.grid["state"] == "active")
    assert flex.paused == 0.5
    c.tick(); assert c.fan == 0.2                               # cooling slowed
    assert c.panel_state()[0] == "check"                       # "MANAGER APPROVED" for a few seconds
    c._panel_override = None
    assert c.panel_state()[0] == "bolt"
    assert encode_console(41.4, True, fan=0.3).decode() == "W 41 F 1 T - S 30\n"
    meter.watts = 30.0
    c.grid["since"] -= 30
    c.on_key("B")                                               # end the event
    assert c.grid["state"] == "normal" and flex.paused == 0.0
    assert c.grid["result"]["cut_w"] == 10.0 and "back" in m.transcript[-1]["text"]


def test_grid_event_declined_keeps_full_power(tmp_path):
    c, m, meter, flex = power_rig(tmp_path)
    c.grid_request(source="dashboard")
    m.receive("NO")
    assert wait_for(lambda: c.grid["state"] == "normal")
    assert flex.paused == 0.0


def test_smoke_beats_grid_cooling(tmp_path):
    c, m, meter, flex = power_rig(tmp_path)
    c.ingest(reading(beam=260, smoke=True))
    c.tick()
    assert c.fan == 0.0


def test_fan_watts_follow_the_fan_law():
    from sitestar_protect.power import fan_watts
    assert fan_watts(1.0) == 1.5 and fan_watts(0.0) == 0.0 and fan_watts(0.6) > 2 * fan_watts(0.3)


def test_depth_is_locked_while_waiting_for_approval(tmp_path):
    c, m, meter, flex = power_rig(tmp_path)
    for k in "20A":
        c.on_key(k)
    for k in "56A":                                   # typed after the request: ignored
        c.on_key(k)
    assert c.grid["depth"] == 20
    m.receive("YES")
    assert wait_for(lambda: c.grid["state"] == "active")
    assert flex.paused == 0.25 or flex.paused == 0.2  # 20 % of 8 jobs rounds to 2 (0.25)


def test_joystick_steps_cut_live_and_silences_alarm(tmp_path):
    c, m, meter, flex = power_rig(tmp_path)
    t0 = time.time()
    c.ingest(reading(jy=2050, ts=t0))                         # at rest: learns the centre
    c.grid_request(source="test"); m.receive("YES")
    assert wait_for(lambda: c.grid["state"] == "active")
    c.ingest(reading(jy=200, ts=t0 + 1))                      # pushed: +5 %, applied live
    assert c.grid["depth"] == 45 and flex.paused == 0.45
    c.buzz = 2
    c.ingest(reading(jy=2050, jsw=True, ts=t0 + 2))           # press = ACK
    link = RecLink(); c.link = link; c.tick()
    assert "buzz=0" in link.sent[0]


def test_warnings_need_no_approval(tmp_path):
    c, m = rig(tmp_path)
    for rh in (46, 47, 50, 55, 61):
        c.ingest(reading(rh=float(rh)))
    inc = next(i for i in c.detector.all if i.kind == "humidity_spike")
    assert wait_for(lambda: inc.agent_state == "done")
    assert not c.commander.pending


def test_leak_alarm_sounds_until_probe_is_dry(tmp_path):
    c, m = rig(tmp_path)
    c.ingest(reading())
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    assert c.buzz == 2                                        # full alarm, not a chirp
    for _ in range(5):                                        # still wet: keeps sounding
        c.ingest(reading(leak=2600, wet=True, valve_open=False))
    assert c.buzz == 2
    c.ingest(reading(valve_open=False))                       # probe wiped dry
    assert c.buzz == 0


def test_manager_card_acknowledges_leak_alarm_while_still_wet(tmp_path):
    c, m = rig(tmp_path)
    c.make_manager_card("20111B5C")
    c.ingest(reading(leak=2600, wet=True, valve_open=False))
    assert c.buzz == 2
    c.on_badge("A1B2C3D4")                                    # not a manager card: keeps sounding
    assert c.buzz == 2
    c.on_badge("20111B5C")
    assert c.buzz == 0
    assert c.want_valve_open is False                         # valve stays shut, incident stays open
    assert c.detector.active
    c.ingest(reading(leak=2600, wet=True, valve_open=False))  # still wet: stays quiet once acknowledged
    assert c.buzz == 0


def test_manager_card_does_not_silence_smoke(tmp_path):
    c, m = rig(tmp_path)
    c.make_manager_card("20111B5C")
    c.ingest(reading())
    c.ingest(reading(beam=200, smoke=True))
    c.on_badge("20111B5C")
    assert c.buzz == 2


# ------------------------------------------------- one kit, any deployed project
def test_physical_model_connects_to_any_project_and_remembers_it(tmp_path):
    from sitestar_protect.haven_bridge import HavenBridge
    path = tmp_path / "haven_link.json"
    h = HavenBridge(None, link_path=path)
    assert h.facility is None and h.snapshot()["facility_id"] in (None, "")
    f = h.link({"id": "studio-hempstead-hwy", "name": "14518 Hempstead Hwy", "city": "Houston", "type": "Student housing"})
    assert f["id"] == "studio-hempstead-hwy"
    snap = h.snapshot()
    assert snap["facility_id"] == "studio-hempstead-hwy" and snap["facility_type"] == "Student housing"
    assert snap["linked_by"] == "dashboard"
    again = HavenBridge(None, link_path=path)                 # PROTECT restarted
    assert again.facility["name"] == "14518 Hempstead Hwy" and again.linked_by == "saved"
    again.link({"id": "portfolio-riverside-compute", "name": "Riverside Compute Hall", "type": "Data center"}, by="deploy")
    assert HavenBridge(None, link_path=path).facility["id"] == "portfolio-riverside-compute"


def test_connect_rejects_a_bad_project(tmp_path):
    from sitestar_protect.haven_bridge import HavenBridge
    h = HavenBridge(None, link_path=tmp_path / "link.json")
    for bad in ({"id": "../etc", "name": "x"}, {"id": "ok-id", "name": "  "}, {"name": "no id"}):
        with pytest.raises(ValueError):
            h.link(bad)
    assert h.facility is None and not (tmp_path / "link.json").exists()


def test_connect_endpoint(tmp_path):
    from fastapi.testclient import TestClient
    from sitestar_protect.haven_bridge import HavenBridge
    from sitestar_protect.server import create_app
    b = load_building(); m = Messenger(None)
    c = ProtectController(b, NullLink(), m, badges_path=tmp_path / "badges.json",
                          haven=HavenBridge(None, link_path=tmp_path / "link.json"))
    client = TestClient(create_app(c))
    r = client.post("/api/haven/link", json={"id": "studio-wind-1", "name": "Ridgeway Wind", "type": "Wind farm"})
    assert r.status_code == 200 and r.json()["facility"]["id"] == "studio-wind-1"
    assert client.get("/api/state").json()["team_app"]["facility_id"] == "studio-wind-1"
    assert client.post("/api/haven/link", json={"id": "Bad Id", "name": "x"}).status_code == 400
