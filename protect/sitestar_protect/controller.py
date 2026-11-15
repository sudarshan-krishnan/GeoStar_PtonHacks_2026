"""PROTECT controller: readings -> incidents -> instant reflexes -> AI commander; drives the board."""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Optional

from . import device, power
from .building import Building
from .detector import Detector, History, Incident
from .device import Reading
from .messaging import Messenger

AGENT_LED = {"queued": 1, "thinking": 1, "waiting_approval": 2, "done": 3, "offline": 0, "error": 0}
COOL_NORMAL, COOL_GRID = 0.35, 0.2  # cooling-fan duty: normal (slow, visibly turning) / approved grid event
COOL_HUMID = 1.0                    # breath on the DHT11 (humidity spike): full blast, an obvious jump
GRID_DEPTH_DEFAULT = 40             # % of flexible AI jobs paused in a grid event
JOY_DEADZONE = 700                  # joystick ADC counts from centre before it counts as pushed
JOY_STEP_S = 0.35                   # hold the stick: one 5 % step every this many seconds
SILENCE_S = 60                      # joystick press: silence the alarm buzzer this long
LEAK_LPM = 12.0   # assumed flow from a failed bathroom supply line, litres/minute ("water saved" counter)
BADGES = Path(__file__).resolve().parents[1] / "config" / "badges.json"


def load_badges(path: Path = BADGES) -> dict:
    try:
        cfg = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        cfg = {}
    return {"managers": [str(u).upper() for u in cfg.get("managers", [])]}


class ProtectController:
    def __init__(self, building: Building, link, messenger: Messenger, *, tick_hz: float = 10.0,
                 commander=None, lobby=None, badges_path: Path = BADGES, haven=None, meter=None, flex=None):
        from .haven_bridge import HavenBridge

        self.building, self.link, self.messenger = building, link, messenger
        self.haven = haven or HavenBridge(None)          # team's main app (HAVEN command center)
        self.lobby = lobby or device.NullLink()          # board 2: RFID + LED matrix
        self.badges_path = Path(badges_path)
        self.badges = load_badges(self.badges_path)
        self.last_badge: Optional[dict] = None
        self._panel_override: Optional[tuple] = None    # (icon, text, until)
        self._panel_sent: Optional[tuple] = None
        self._panel_sent_at = 0.0
        self.want_door_open = True
        # data-hall power: measured laptop watts (servers), pausable AI jobs, cooling fan
        self.meter, self.flex = meter, flex
        self.grid = {"state": "normal", "depth": GRID_DEPTH_DEFAULT, "typed": "", "since": None,
                     "before_w": None, "result": None}
        self._fan_override_until = 0.0
        self._joy_center: Optional[int] = None
        self._joy_step_at = 0.0
        self._joy_show_until = 0.0
        self._joy_was_pressed = False
        self._silenced_until = 0.0
        self._console_at = 0.0
        self._console_seen = 0.0
        self._console_up = -1                       # console's own uptime from its heartbeat
        self._leak_t0: Optional[float] = None            # valve shut on a leak at
        self._leak_t1: Optional[float] = None            # valve reopened at
        self._valve_was_open = True
        self.history = History()
        self.detector = Detector(building, self.history)
        self.lock = threading.RLock()
        self.reading: Optional[Reading] = None
        self.want_valve_open = True
        self.fan = 0.0
        self.strobe = False
        self.buzz = 0
        self.agent_led = 0
        self.room_state = {r: 0 for r in building.led_rooms}
        self.actions: list[dict] = []
        self.dt = 1.0 / tick_hz
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.commander = commander  # set by make_commander() or tests

    def make_commander(self, **kw):
        from .agent import IncidentCommander

        self.commander = IncidentCommander(self, self.messenger, **kw)
        return self.commander

    # --------------------------------------------------------------- intake
    def on_serial_line(self, line: str) -> None:
        r = device.parse_reading(line)
        if r:
            self.ingest(r)
            return
        uid = device.parse_badge(line)        # RC522 on the ESP32 itself
        if uid:
            self.on_badge(uid)

    def on_lobby_line(self, line: str) -> None:
        """Board 2 (UNO R4 operator console): keypad keys, or badge taps if a reader is fitted there."""
        self._console_seen = time.time()           # any line (incl. the 2 s heartbeat) = console alive
        if line.startswith("I console up="):
            try:
                self._console_up = int(line.rsplit("=", 1)[1])
            except ValueError:
                pass
        uid = device.parse_badge(line)
        if uid:
            self.on_badge(uid)
            return
        key = device.parse_key(line)
        if key:
            self.on_key(key)

    # ------------------------------------------------------------ grid events
    def on_key(self, key: str) -> None:
        g = self.grid
        if key.isdigit():
            g["typed"] = (g["typed"] + key)[-2:]
        elif key == "*":
            g["typed"] = ""
        elif key in "#A" and g["state"] == "requested" and g["typed"]:
            g["typed"] = ""                       # the manager is approving a specific cut: keep it fixed
            self._log(f"cut stays {g['depth']}% until the manager answers (B cancels)", "keypad")
        elif key == "#":
            if g["typed"]:
                g["depth"] = max(10, min(90, int(g["typed"])))
                g["typed"] = ""
                self._log(f"grid cut depth set to {g['depth']}%", "keypad")
                if g["state"] == "active" and self.flex:
                    self.flex.pause(g["depth"] / 100)
        elif key == "A":
            if g["typed"]:
                g["depth"] = max(10, min(90, int(g["typed"])))
                g["typed"] = ""
            self.grid_request(source="keypad")
        elif key == "B":
            self.grid_end(source="keypad")

    def total_watts(self) -> Optional[float]:
        it = self.meter.watts if self.meter else None
        return None if it is None else round(it + power.fan_watts(self.fan), 1)

    def grid_request(self, source: str = "operator", depth: Optional[int] = None) -> str:
        g = self.grid
        if depth:
            g["depth"] = max(10, min(90, int(depth)))
        if g["state"] != "normal":
            return f"grid event already {g['state']}"
        g["state"], g["since"], g["result"] = "requested", time.time(), None
        g["before_w"] = self.meter.avg(20) if self.meter else None
        self._log(f"grid event requested ({source}): pause {g['depth']}% of flexible AI jobs", source)
        if self.commander:
            self.commander.request_grid(g["depth"], g["before_w"])
        else:
            self.grid_decide(True)
        return "requested"

    def grid_decide(self, approve: bool, by: str = "manager") -> None:
        g = self.grid
        if g["state"] != "requested":
            return
        if not approve:
            g["state"], g["since"] = "normal", None
            self._log("grid event declined", by)
            return
        g["state"], g["since"] = "active", time.time()
        if self.flex:
            self.flex.pause(g["depth"] / 100)
        self._log(f"grid event ACTIVE: {g['depth']}% of AI jobs paused, cooling to {COOL_GRID:.0%}", by)

    def grid_end(self, source: str = "operator") -> str:
        g = self.grid
        if g["state"] == "normal":
            return "no grid event"
        was_active = g["state"] == "active"
        dur = time.time() - (g["since"] or time.time())
        # average over the second half of the event, so the meter's settling time doesn't dilute it
        during = self.meter.avg(min(dur / 2, 60)) if (self.meter and was_active and dur > 6) else None
        if self.flex:
            self.flex.resume()
        if self.commander:
            self.commander.pending.pop("GRID", None)
        g["state"], g["since"] = "normal", None
        if was_active and g["before_w"] and during:
            cut = max(0.0, g["before_w"] - during)
            g["result"] = {"before_w": g["before_w"], "during_w": during, "cut_w": round(cut, 1),
                           "cut_pct": round(100 * cut / g["before_w"]), "minutes": round(dur / 60, 1)}
            self.messenger.send(f"Grid event over after {dur / 60:.1f} min. Measured draw fell from "
                                f"{g['before_w']:.0f} W to {during:.0f} W ({g['result']['cut_pct']}% less); "
                                f"paused AI jobs are back and will finish.", kind="info")
        self._log("grid event ended", source)
        return "ended"

    def on_badge(self, uid: str) -> None:
        uid = uid.upper()
        role = "manager" if uid in self.badges["managers"] else "other"
        print(f"[lobby] badge {uid} tapped ({'manager card' if role == 'manager' else 'not a manager card'})")
        self.last_badge = {"uid": uid, "role": role, "t": time.time(), "result": "..."}
        self._log(f"badge {uid} tapped at the lobby", "lobby")
        if role == "manager":
            self.acknowledge_alarm("manager card")
        if self.commander:
            self.commander.handle_badge(uid, role)

    def _alarm_needs_sounder(self) -> bool:
        """Smoke and a jammed valve keep the sounder on whatever a manager says."""
        return any(i.kind in ("smoke", "valve_fault") for i in self.detector.active.values())

    def acknowledge_alarm(self, by: str) -> None:
        """A manager has seen the leak: stop the sounder (the valve stays shut, the incident stays open)."""
        with self.lock:
            if self.buzz and not self._alarm_needs_sounder():
                self.buzz = 0
                self._log(f"leak alarm acknowledged ({by})", by)

    def badge_result(self, uid: str, result: str, icon: str, text: str, secs: float = 6.0) -> None:
        """Called by the commander once it has decided what a tap means."""
        if self.last_badge and self.last_badge["uid"] == uid:
            self.last_badge["result"] = result
        self.show_panel(icon, text, secs)

    def make_manager_card(self, uid: str) -> None:
        uid = uid.upper()
        if uid not in self.badges["managers"]:
            self.badges["managers"].append(uid)
        try:
            cfg = json.loads(self.badges_path.read_text())
        except (OSError, ValueError):
            cfg = {}
        cfg["managers"] = self.badges["managers"]
        self.badges_path.write_text(json.dumps(cfg, indent=2) + "\n")
        self._log(f"badge {uid} registered as the manager card", "operator")

    def show_panel(self, icon: str, text: str, secs: float = 6.0) -> None:
        self._panel_override = (icon, text, time.time() + secs)

    def water_saved_l(self) -> float:
        if self._leak_t0 is None:
            return 0.0
        end = self._leak_t1 or time.time()
        return max(0.0, (end - self._leak_t0) / 60.0 * LEAK_LPM)

    def _joystick(self, r: Reading) -> None:
        """Operator override: push the stick to step the grid cut 5 % (live during an event);
        press it to silence the alarm buzzer for a minute."""
        if r.jy is None:
            return
        now = time.time()
        if self._joy_center is None:
            self._joy_center = r.jy                          # first reading = stick at rest
        d = r.jy - self._joy_center
        if abs(d) > JOY_DEADZONE and now - self._joy_step_at > JOY_STEP_S:
            self._joy_step_at = now
            g = self.grid
            if g["state"] != "requested":                  # the manager is approving a fixed cut
                g["depth"] = max(10, min(90, g["depth"] + (5 if d < 0 else -5)))
                self._joy_show_until = now + 2.0
                if g["state"] == "active" and self.flex:
                    self.flex.pause(g["depth"] / 100)
        if r.jsw and not self._joy_was_pressed:
            self._silenced_until = now + SILENCE_S
            self._log(f"alarm silenced for {SILENCE_S} s (joystick ACK)", "operator")
        self._joy_was_pressed = r.jsw

    def ingest(self, r: Reading) -> None:
        self._joystick(r)
        with self.lock:
            prev = self.reading
            self.history.add(r)
            self.reading = r
            new, cleared = self.detector.update(r)
            if prev and prev.valve_open and not r.valve_open:
                self._log("valve closed (firmware)", "board")
            if prev and not prev.valve_open and r.valve_open and self._leak_t0 and not self._leak_t1:
                self._leak_t1 = r.ts                     # water back on: freeze the "saved" counter
            if prev and prev.door_open and not r.door_open:
                self._log("fire door shut (firmware)", "board")
        for inc in new:
            self._reflex(inc, r)
            self.haven.incident(inc.kind, inc.title)
            if self.commander:
                self.commander.handle(inc)
        for inc in cleared:
            self._cleared(inc)

    # -------------------------------------------------------------- reflexes
    def _reflex(self, inc: Incident, r: Reading) -> None:
        t0 = time.time()
        acts: list[str] = []
        with self.lock:
            if inc.kind == "leak":
                self.want_valve_open = False
                self._leak_t0, self._leak_t1 = inc.started, None
                acts.append("water valve CLOSED by firmware reflex" if not r.valve_open else "close-valve command sent")
                self._room(inc.room, 2)
                below = self.building.below.get(inc.room)
                if below in self.room_state:
                    self._room(below, 1)
                # Full alarm, not a chirp: it keeps sounding until the probe is wiped dry or a
                # manager acknowledges (card tap, or Approve / Decline on the dashboard).
                self.buzz = 2
                acts.append("leak alarm ON until the probe is dry or a manager card is tapped")
            elif inc.kind == "smoke":
                self.strobe, self.buzz, self.fan = True, 2, 0.0
                acts += ["strobe ON", "alarm sounder ON", "cooling fan OFF (stop smoke spread)",
                         "fire door SHUT by firmware reflex" if not r.door_open else "fire door close command sent"]
                self.want_door_open = False
                self._room(inc.room, 2)
                if "1F-CORR" in self.room_state:
                    self._room("1F-CORR", 2)
            elif inc.kind == "overheat":
                self.fan = 1.0
                acts.append("cooling fan 100% (hot aisle)")
                self._room(inc.room, 1)
            elif inc.kind == "humidity_spike":
                self.fan = max(self.fan, COOL_HUMID)
                acts.append(f"cooling fan {COOL_HUMID:.0%} (dry the air)")
                self._room(inc.room, 1)
            elif inc.kind == "freeze_risk":
                self._room(inc.room, 1)
                acts.append("flagged for heat-trace check")
            elif inc.kind == "valve_fault":
                self.want_valve_open = False
                self.buzz = 2
                self._room(inc.room, 2)
                acts += ["alarm sounder ON", "valve close re-sent"]
            elif inc.kind == "sump_high":
                self.buzz = max(self.buzz, 1)
                self._room(inc.room, 2)
                acts.append("sump alarm")
        latency = int((time.time() - t0) * 1000)
        for a in acts:
            inc.reflex.append({"t": t0, "action": a, "latency_ms": 0 if "firmware" in a else latency})
            self._log(a, f"reflex {inc.id}")
        # The fast human alert goes out before the AI has thought about anything.
        self.messenger.send(f"SiteStar ALERT {time.strftime('%H:%M:%S', time.localtime(inc.started))}: "
                            f"{inc.title} - {inc.room_name}. Auto: {', '.join(acts) or 'monitoring'}. "
                            f"AI is investigating.", kind="alert", incident=inc.id)

    def _cleared(self, inc: Incident) -> None:
        with self.lock:
            still = [i for i in self.detector.active.values() if i.room == inc.room]
            if not still:
                self._room(inc.room, 0)
            if inc.kind == "smoke":
                self.strobe, self.buzz = False, 0
                self.want_door_open = True
                if "1F-CORR" in self.room_state and not still:
                    self._room("1F-CORR", 0)
            if inc.kind == "leak":
                below = self.building.below.get(inc.room)
                if below in self.room_state:
                    self._room(below, 0)
                if not self._alarm_needs_sounder():
                    self.buzz = 0                        # probe wiped dry: leak alarm off
            if not self.detector.active:
                self.buzz = 0
                if self.fan > 0 and inc.kind in ("overheat", "humidity_spike"):
                    self.fan = 0.0
        self._log(f"{inc.title} cleared", inc.id)
        if not self.detector.active:
            self.haven.all_clear()
        if inc.kind == "leak" and self.commander:
            self.commander.offer_reopen(inc)
        else:
            self.messenger.send(f"Cleared: {inc.title} - {inc.room_name}.", kind="info", incident=inc.id)

    def _room(self, room: str, state: int) -> None:
        if room in self.room_state:
            self.room_state[room] = state

    # ------------------------------------------------- actions (agent + API)
    def set_fan(self, level: float, by: str = "operator") -> str:
        self._fan_override_until = time.time() + 60
        with self.lock:
            if any(i.kind == "smoke" for i in self.detector.active.values()) and level > 0:
                return "refused: smoke incident active (fans stay off)"
            self.fan = max(0.0, min(1.0, float(level)))
        self._log(f"fan {self.fan:.0%}", by)
        return f"fan set to {self.fan:.0%}"

    def request_valve(self, open_: bool, by: str = "operator") -> str:
        with self.lock:
            if open_ and self.reading and self.reading.wet:
                self._log("valve reopen REFUSED (probe wet, firmware interlock)", by)
                return "refused: leak probe still wet (firmware interlock)"
            self.want_valve_open = bool(open_)
        self._log(f"valve {'OPEN' if open_ else 'CLOSE'} requested", by)
        return f"valve {'opening' if open_ else 'closing'}"

    def on_agent_state(self, state: str) -> None:
        self.agent_led = AGENT_LED.get(state, 0)

    def _log(self, action: str, by: str) -> None:
        self.actions.append({"t": time.time(), "action": action, "by": by})
        del self.actions[:-200]

    def live_status(self) -> dict:
        r = self.reading
        base = {"valve_open": self.want_valve_open if r is None else r.valve_open, "fan": self.fan,
                "strobe": self.strobe, "buzz": self.buzz, "water_saved_l": round(self.water_saved_l(), 1)}
        if r is None:
            return {**base, "board": "no data yet"}
        return {**base, "leak_wet": r.wet, "leak_adc": r.leak, "smoke": r.smoke, "smoke_beam_pct": round(r.beam_pct, 1),
                "valve_switch_confirms_shut": r.vsw, "fire_door_open": r.door_open,
                "mech_temp_c": r.t, "mech_rh_pct": r.rh, "pipe_c": r.pipe, "lounge_occupied": r.pir, "sump_cm": r.lvl,
                "at": time.strftime("%H:%M:%S", time.localtime(r.ts))}

    # ------------------------------------------------------------- hardware
    def oled_lines(self) -> list[str]:
        r = self.reading
        active = list(self.detector.active.values())
        if active:
            top = sorted(active, key=lambda i: (i.severity != "critical", i.started))[0]
            status = f"{top.title[:12].upper()} {top.room}"[:21]
        else:
            status = "ALL CLEAR"
        agent = {0: "AI idle", 1: "AI investigating", 2: "AI: awaiting mgr", 3: "AI: handled"}[self.agent_led]
        valve = "OPEN" if (r.valve_open if r else self.want_valve_open) else "SHUT"
        mech = "--" if not r or r.t is None else f"{r.t:.1f}C {r.rh or 0:.0f}%"
        pipe = "--" if not r or r.pipe is None else f"{r.pipe:.0f}C"
        beam = "--" if not r else f"{r.beam_pct:.0f}%"
        saved = self.water_saved_l()
        total = self.total_watts()
        g = self.grid
        pw = "--" if total is None else f"{total:.1f}W"
        grid = {"normal": "", "requested": " GRID?", "active": f" GRID-{g['depth']}%"}[g["state"]]
        last = f"water saved {saved:.0f} L" if saved >= 1 else f"power {pw}{grid}"
        return ["SITESTAR PROTECT", status, f"valve {valve} fan {self.fan:.0%}", agent, f"hall {mech}", last]

    def panel_state(self) -> tuple[str, str]:
        """What the lobby LED matrix shows: (icon, scrolling text)."""
        if self._panel_override and time.time() < self._panel_override[2]:
            return self._panel_override[0], self._panel_override[1]
        active = {i.kind: i for i in self.detector.active.values()}
        saved = self.water_saved_l()
        if "smoke" in active:
            return "fire", "FIRE ALARM - USE THE STAIRS"
        if "valve_fault" in active:
            return "cross", "VALVE STUCK - SHUT IT BY HAND"
        if "leak" in active:
            return "drop", f"LEAK {active['leak'].room_name}  VALVE SHUT  SAVED {saved:.0f} L"
        if active:
            return "wait", next(iter(active.values())).title
        g = self.grid
        if g["state"] == "active":
            return "bolt", f"GRID EVENT  AI JOBS -{g['depth']}%  COOLING {COOL_GRID:.0%}"
        if g["state"] == "requested":
            return "wait", f"GRID EVENT - TAP BADGE TO PAUSE {g['depth']}%"
        cmd = self.commander
        if cmd and cmd.pending:
            return "wait", "WAITING FOR MANAGER"
        expected = cmd.expected_vendor() if cmd else None
        if expected:
            return "wrench", f"{expected['short']} ON THE WAY  ETA {expected['eta']}"
        return "idle", f"ALL CLEAR  SAVED {saved:.0f} L WATER" if saved >= 1 else "ALL CLEAR"

    def _cooling(self) -> None:
        """Base cooling: the fan always runs; slower during an approved grid event. Incidents override."""
        kinds = {i.kind for i in self.detector.active.values()}
        if "smoke" in kinds:
            self.fan = 0.0
        elif kinds & {"overheat", "humidity_spike"} or time.time() < self._fan_override_until:
            return
        else:
            self.fan = COOL_GRID if self.grid["state"] == "active" else COOL_NORMAL

    def tick(self) -> None:
        with self.lock:
            if self.meter is not None:
                self._cooling()
            rooms = [self.room_state.get(r, 0) for r in self.building.led_rooms]
            buzz = 0 if time.time() < self._silenced_until else self.buzz
            self.link.write(device.encode_command(self.want_valve_open, self.fan, self.strobe, buzz,
                                                  rooms, self.agent_led, self.want_door_open))
            self.link.write(device.encode_lines(self.oled_lines()))
            panel = self.panel_state()
        # Board 2 (UNO R4): write nothing until it has said hello itself (2 s heartbeat) and has been up
        # for 6 s. Data arriving in its first seconds after a reset wedges the R4 WiFi's USB bridge until
        # it is unplugged; waiting for its own heartbeat makes that impossible.
        if not self.lobby.connected:
            self._console_up, self._panel_sent = -1, None
        elif self._console_up < 6 or time.time() - self._console_seen > 5:
            return
        # LED matrix: send on change, and every 3 s as a heartbeat (same icon never restarts the scroll).
        if panel != self._panel_sent or time.time() - self._panel_sent_at > 3.0:
            if self.lobby.write(device.encode_panel(*panel)):
                self._panel_sent, self._panel_sent_at = panel, time.time()
        if time.time() - self._console_at > 0.5:        # 7-segment: live total watts, flashing in a grid event
            self._console_at = time.time()
            shown = str(self.grid["depth"]) if time.time() < self._joy_show_until else self.grid["typed"]
            self.lobby.write(device.encode_console(self.total_watts(), self.grid["state"] == "active",
                                                   shown, self.fan))

    def _loop(self) -> None:
        nxt = time.monotonic()
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception as exc:  # noqa: BLE001
                print(f"[protect] tick error: {exc!r}")
            nxt += self.dt
            self._stop.wait(max(0.0, nxt - time.monotonic()))

    def start(self) -> "ProtectController":
        self._thread = threading.Thread(target=self._loop, name="protect", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        self.link.write(device.encode_command(self.want_valve_open, 0, False, 0, [0, 0, 0, 0], 0, self.want_door_open))
        self.lobby.write(device.encode_panel("idle", "OFFLINE"))
        self.link.write(device.encode_lines(["SITESTAR PROTECT", "stopped"]))

    def power_snapshot(self) -> dict:
        m, f, g = self.meter, self.flex, self.grid
        hist = list(m.history)[-180:] if m else []
        return {"it_w": m.watts if m else None, "it_measured": bool(m and m.ok),
                "it_source": getattr(m, "label", None), "fan": self.fan,
                "fan_w": power.fan_watts(self.fan), "total_w": self.total_watts(),
                "jobs_running": f.running if f else None, "jobs_total": f.n if f else None,
                "grid": {k: g[k] for k in ("state", "depth", "typed", "since", "before_w", "result")},
                "history": [[round(t, 1), w] for t, w in hist]}

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "live": self.live_status(),
                "rooms": self.room_state,
                "incidents": [i.to_json() for i in reversed(self.detector.all[-30:])],
                "active": [i.id for i in self.detector.active.values()],
                "actions": self.actions[-40:],
                "agent": self.commander.snapshot() if self.commander else None,
                "phone": self.messenger.snapshot(),
                "hardware": {"connected": self.link.connected, "port": self.link.port, "hello": self.link.hello},
                "lobby": {"connected": self.lobby.connected, "alive": time.time() - self._console_seen < 5, "port": self.lobby.port, "hello": self.lobby.hello,
                          "panel": self.panel_state(), "last_badge": self.last_badge,
                          "managers": self.badges["managers"]},
                "oled": self.oled_lines(),
                "team_app": self.haven.snapshot(),
                "power": self.power_snapshot(),
                "sim": getattr(self, "sim", False),
            }
