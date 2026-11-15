"""Fake building ESP32 on a virtual serial port. Mirrors esp32_building.ino, including the
firmware leak reflex and the valve interlock.

Keys:  w water on the sensor (toggle)  s smoke in the beam (toggle)   p person in lounge (toggle)
       h hold the DHT11 (heat)         b breathe on the DHT11          i ice cube on the pipe
       f sump flooding (toggle)        j jam the valve (toggle)        c clear everything   q quit
"""
from __future__ import annotations

import os
import select
import sys
import threading
import time


class FakeBuildingBoard:
    def __init__(self):
        import tty

        self.master, slave = os.openpty()
        tty.setraw(slave)
        os.set_blocking(self.master, False)
        self._slave = slave
        self.port = os.ttyname(slave)
        # physical world
        self.water = False
        self.smoke_in_beam = False
        self.person = False
        self.flood = False
        self.jam = False                 # finger on the valve arm: servo told to close, switch never pressed
        self.door_open = True
        self._want_door_open = True
        self.t, self.rh, self.pipe, self.lvl = 23.5, 46.0, 21.0, 30.0
        self._heat_until = self._breath_until = self._ice_until = 0.0
        # firmware state
        self.valve_open = True
        self.wet = False
        self._dry_since = 0.0
        self.fan, self.strobe, self.buzz, self.agent = 0.0, False, 0, 0
        self.rooms = [0, 0, 0, 0]
        self.oled = [""] * 6
        self.last_cmd = 0.0
        self.cmds_rx = 0
        self.bseq = 0
        self._t0 = time.monotonic()
        self._stop = threading.Event()
        self._rx = b""

    # ------------------------------------------------------------ lifecycle
    def start(self) -> "FakeBuildingBoard":
        for fn in (self._reader, self._physics):
            threading.Thread(target=fn, daemon=True).start()
        self._write("HELLO sitestar-protect v1 oled=1 dry=80 beam=900 (sim)\n")
        return self

    def stop(self) -> None:
        self._stop.set()
        for fd in (self.master, self._slave):
            try:
                os.close(fd)
            except OSError:
                pass

    @property
    def online(self) -> bool:
        return time.monotonic() - self.last_cmd < 3.0

    def _write(self, s: str) -> None:
        try:
            os.write(self.master, s.encode())
        except OSError:
            pass

    # ------------------------------------------------------------- physics
    def _physics(self) -> None:
        while not self._stop.wait(0.05):          # 20 Hz like the firmware fast loop
            now = time.monotonic()
            # leak reflex + interlock (firmware behaviour)
            if self.water and not self.wet:
                self.wet = True
                self.valve_open = False
            elif self.wet and not self.water:
                self._dry_since = self._dry_since or now
                if now - self._dry_since > 3.0:
                    self.wet, self._dry_since = False, 0.0
            elif self.wet:
                self._dry_since = 0.0
            if self.wet and self.valve_open:
                self.valve_open = False
            if self.smoke_in_beam and self.door_open:   # fire door reflex
                self.door_open = False
            # slow environment
            target_t = 33.5 if now < self._heat_until else 23.5
            self.t += (target_t - self.t) * 0.02
            target_rh = 72.0 if now < self._breath_until else 46.0
            self.rh += (target_rh - self.rh) * (0.15 if target_rh > self.rh else 0.01)
            target_pipe = 2.5 if now < self._ice_until else 21.0
            self.pipe += (target_pipe - self.pipe) * 0.03
            self.lvl += ((5.0 if self.flood else 30.0) - self.lvl) * 0.03
            if int(now * 5) != int((now - 0.05) * 5):  # 5 Hz report
                self._report(now)

    def _report(self, now: float) -> None:
        beam = 260 if self.smoke_in_beam else 880
        self._write(f"I leak={2600 if self.water else 80} wet={int(self.wet)} beam={beam} base=900 "
                    f"smoke={int(self.smoke_in_beam)} t={self.t:.1f} rh={self.rh:.0f} pipe={self.pipe:.1f} "
                    f"pir={int(self.person)} lvl={self.lvl:.1f} valve={int(self.valve_open)} "
                    f"vsw={int(not self.valve_open and not self.jam)} door={int(self.door_open)} bseq={self.bseq} "
                    f"up={int(now - self._t0)}\n")

    # ------------------------------------------------------------ commands
    def _reader(self) -> None:
        while not self._stop.is_set():
            try:
                r, _, _ = select.select([self.master], [], [], 0.2)
                if not r:
                    continue
                chunk = os.read(self.master, 1024)
            except OSError:
                return
            self._rx += chunk
            while b"\n" in self._rx:
                raw, self._rx = self._rx.split(b"\n", 1)
                self.handle_line(raw.decode(errors="replace").strip())

    def handle_line(self, line: str) -> None:
        if line.startswith("A "):
            kv = dict(t.split("=", 1) for t in line[2:].split() if "=" in t)
            want_open = kv.get("valve") == "1"
            if not want_open:
                self.valve_open = False
            elif not self.wet:                     # interlock
                self.valve_open = True
            self.fan = float(kv.get("fan", 0))
            self.strobe = kv.get("strobe") == "1"
            self.buzz = int(kv.get("buzz", 0))
            self.agent = int(kv.get("agent", 0))
            self.rooms = [int(x) for x in kv.get("r", "0,0,0,0").split(",")[:4]]
            want_door = kv.get("door", "1") == "1"
            if not want_door:
                self.door_open = False
            elif not self.smoke_in_beam:
                self.door_open = True
            self.last_cmd = time.monotonic()
            self.cmds_rx += 1
        elif line.startswith("L "):
            rows = line[2:].split("|")[:6]
            self.oled = [x[:21] for x in rows] + [""] * (6 - len(rows))
        elif line == "TEST":
            self._write("TEST begin\nTEST done\n")
        elif line == "PING":
            self._write("PONG\n")

    # ---------------------------------------------------------------- keys
    def key(self, ch: str) -> None:
        now = time.monotonic()
        if ch == "w":
            self.water = not self.water
        elif ch == "s":
            self.smoke_in_beam = not self.smoke_in_beam
        elif ch == "p":
            self.person = not self.person
        elif ch == "f":
            self.flood = not self.flood
        elif ch == "j":
            self.jam = not self.jam
        elif ch == "h":
            self._heat_until = now + 25
        elif ch == "b":
            self._breath_until = now + 6
        elif ch == "i":
            self._ice_until = now + 30
        elif ch == "c":
            self.water = self.smoke_in_beam = self.flood = self.jam = False
            self._heat_until = self._breath_until = self._ice_until = 0.0

    def render(self) -> str:
        names = ["2F Bathroom", "B1 Mechanical", "1F Lounge", "1F Corridor"]
        led = {0: "green", 1: "AMBER blink", 2: "RED"}
        agent = {0: "off", 1: "PURPLE (thinking)", 2: "YELLOW (needs human)", 3: "GREEN (handled)"}[self.agent]
        out = [f"FAKE BUILDING BOARD  {self.port}  {'LINK OK' if self.online else 'OFFLINE'}",
               "+---------------------+", *[f"|{r:<21}|" for r in self.oled], "+---------------------+"]
        out += [f"room LEDs : " + " | ".join(f"{n} {led[s]}" for n, s in zip(names, self.rooms)),
                f"valve     : {'OPEN' if self.valve_open else 'CLOSED'}{' (JAMMED, switch open)' if self.jam else ''}"
                f"   fire door: {'open' if self.door_open else 'SHUT'}   leak sensor: {'WET' if self.wet else 'dry'}"
                f"{'  (drying...)' if self.wet and not self.water else ''}",
                f"fan       : {self.fan:.0%}   strobe: {'ON' if self.strobe else 'off'}   "
                f"buzzer: {['off', 'chirp', 'ALARM'][self.buzz]}   agent LED: {agent}",
                f"sensors   : mech {self.t:.1f}C {self.rh:.0f}%  pipe {self.pipe:.1f}C  sump {self.lvl:.0f}cm  "
                f"smoke-beam {'BLOCKED' if self.smoke_in_beam else 'clear'}  lounge {'occupied' if self.person else 'empty'}",
                "", "keys: w water  s smoke  p person  h heat  b breath  i ice  f flood  j jam valve  c clear  q quit"]
        return "\n".join(out)


def run_interactive() -> int:
    import termios
    import tty

    board = FakeBuildingBoard().start()
    print(f"\nFake building board on {board.port}\nIn another terminal:\n"
          f"  .venv/bin/python protect/run.py run --serial {board.port}\n")
    time.sleep(1.5)
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while True:
            sys.stdout.write("\x1b[H\x1b[2J" + board.render() + "\n")
            sys.stdout.flush()
            r, _, _ = select.select([sys.stdin], [], [], 0.25)
            if r:
                ch = sys.stdin.read(1)
                if ch == "q":
                    break
                board.key(ch)
    except KeyboardInterrupt:
        pass
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        board.stop()
    return 0
