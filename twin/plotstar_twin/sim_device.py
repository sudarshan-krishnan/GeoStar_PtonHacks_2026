"""A fake ESP32 on a virtual serial port (pty), speaking exactly the firmware's protocol.

Lets you run the full twin -> serial -> "board" path with no hardware:

    terminal 1:  python twin/run.py fake-esp32          # prints its port, e.g. /dev/ttys012
    terminal 2:  python twin/run.py run --serial /dev/ttys012

Keys in the fake-board terminal (mirror the real knobs):
    0 1 2 3   flex dial zone (0, 0.25, 0.5, 1 %)
    i / k     joystick up / down  (carbon price; tap repeatedly or hold)
    j / l     joystick left / right (water / air cooling)
    a b c     keypad A / B / C (site)      p  keypad D (swap plan on chip)
    e         red GRID EMERGENCY button    q  quit
"""
from __future__ import annotations

import os
import select
import sys
import threading
import time
from dataclasses import dataclass, field

LINK_TIMEOUT_S = 3.0


@dataclass
class BoardState:
    hour: float = 0.0
    wind: float = 0.0
    solar: float = 0.0
    gas: float = 0.0
    co2: float = 0.0
    diesel: bool = False
    alarm: bool = False
    oled: list = field(default_factory=lambda: [""] * 6)
    last_state: float = 0.0
    states_rx: int = 0
    test_runs: int = 0


class FakeEsp32:
    """Owns the master side of a pty. The twin opens `self.port` like a real USB serial port."""

    def __init__(self, temp_c: float | None = 31.0):
        import tty

        self.master, slave = os.openpty()
        tty.setraw(slave)                    # no echo / line editing, like a real UART
        os.set_blocking(self.master, False)  # never stall if nobody is reading yet
        self.port = os.ttyname(slave)
        self._slave = slave            # keep open so the port exists until we stop
        self.state = BoardState()
        self.flex, self.jx, self.jy = 2, 0, 0
        self.key, self.kseq, self.bseq = "-", 0, 0
        self.temp_c = temp_c
        self._jy_until = 0.0
        self._jx_until = 0.0
        self._t0 = time.monotonic()
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._rx = b""
        self._threads = [threading.Thread(target=self._reader, daemon=True),
                         threading.Thread(target=self._sender, daemon=True)]

    # ------------------------------------------------------------- lifecycle
    def start(self) -> "FakeEsp32":
        for t in self._threads:
            t.start()
        self._write("HELLO plotstar-grid v1 oled=1 core=sim\n")
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
        return time.monotonic() - self.state.last_state < LINK_TIMEOUT_S

    # ------------------------------------------------------------- "knobs"
    def set_flex(self, zone: int) -> None:
        self.flex = max(0, min(3, zone))

    def joystick(self, axis: str, direction: int, hold_s: float = 0.35) -> None:
        if axis == "y":
            self.jy, self._jy_until = direction, time.monotonic() + hold_s
        else:
            self.jx, self._jx_until = direction, time.monotonic() + hold_s

    def press_key(self, k: str) -> None:
        self.key, self.kseq = k.upper(), self.kseq + 1

    def press_button(self) -> None:
        self.bseq += 1

    # ------------------------------------------------------------- serial I/O
    def _write(self, s: str) -> None:
        try:
            os.write(self.master, s.encode())
        except OSError:
            pass

    def _sender(self) -> None:
        while not self._stop.wait(0.1):
            now = time.monotonic()
            if now > self._jy_until:
                self.jy = 0
            if now > self._jx_until:
                self.jx = 0
            t = "-" if self.temp_c is None else f"{self.temp_c:.1f}"
            self._write(f"I flex={self.flex} jx={self.jx} jy={self.jy} key={self.key} kseq={self.kseq} "
                        f"bseq={self.bseq} temp={t} up={int(now - self._t0)}\n")

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
        """Same parsing rules as esp32_grid.ino."""
        s = self.state
        with self._lock:
            if line.startswith("S "):
                for tok in line[2:].split():
                    if "=" not in tok:
                        continue
                    k, v = tok.split("=", 1)
                    try:
                        f = float(v)
                    except ValueError:
                        continue
                    if k == "h": s.hour = f
                    elif k == "wind": s.wind = f
                    elif k == "solar": s.solar = f
                    elif k == "gas": s.gas = f
                    elif k == "co2": s.co2 = f
                    elif k == "diesel": s.diesel = f > 0.5
                    elif k == "alarm": s.alarm = f > 0.5
                s.last_state = time.monotonic()
                s.states_rx += 1
            elif line.startswith("L "):
                rows = line[2:].split("|")[:6]
                s.oled = [r[:21] for r in rows] + [""] * (6 - len(rows))
            elif line == "TEST":
                s.test_runs += 1
                self._write("TEST begin\nTEST done\n")
            elif line == "ZERO":
                self._write("ZERO ok\n")
            elif line == "PING":
                self._write("PONG\n")

    # ------------------------------------------------------------- display
    def render(self) -> str:
        s = self.state

        def bar(v: float, n: int = 20) -> str:
            k = int(round(max(0.0, min(1.0, v)) * n))
            return "#" * k + "." * (n - k)

        h = s.hour % 24
        needle = int(round(max(0.0, min(1.0, s.co2 / 700.0)) * 30))
        lines = [
            "FAKE ESP32  port " + self.port + ("   LINK OK" if self.online else "   OFFLINE (no S for 3 s)"),
            "+---------------------+",
            *[f"|{row:<21}|" for row in s.oled],
            "+---------------------+",
            f"clock     {int(h):02d}:{int((h % 1) * 60):02d}",
            f"turbine   [{bar(s.wind)}] {s.wind:4.2f}",
            f"solar     [{bar(s.solar)}] {s.solar:4.2f}",
            f"gas       [{bar(s.gas)}] {s.gas:4.2f}",
            f"co2 dial  0|{'-' * needle}^{' ' * (30 - needle)}|700  {s.co2:3.0f} g/kWh",
            f"DIESEL    {'*** BACKUP DIESEL ON ***' if s.diesel else 'dark'}"
            f"{'   BEEP BEEP' if s.alarm and int(time.monotonic() * 2) % 2 else ''}",
            "",
            f"knobs: flex zone {self.flex} | joy x{self.jx:+d} y{self.jy:+d} | key {self.key}#{self.kseq} "
            f"| button #{self.bseq} | S msgs {s.states_rx}",
            "keys: 0-3 flex  i/k carbon  j/l water/air  a/b/c site  p swap plan  e EMERGENCY  q quit",
        ]
        return "\n".join(lines)


def run_interactive(temp_c: float | None = 31.0) -> int:
    import termios
    import tty

    dev = FakeEsp32(temp_c).start()
    print(f"\nFake ESP32 ready on {dev.port}\nIn another terminal run:\n"
          f"  .venv/bin/python twin/run.py run --serial {dev.port}\n")
    time.sleep(1.5)
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while True:
            sys.stdout.write("\x1b[H\x1b[2J" + dev.render() + "\n")
            sys.stdout.flush()
            r, _, _ = select.select([sys.stdin], [], [], 0.2)
            if not r:
                continue
            ch = sys.stdin.read(1)
            if ch == "q":
                break
            if ch in "0123":
                dev.set_flex(int(ch))
            elif ch == "i":
                dev.joystick("y", +1)
            elif ch == "k":
                dev.joystick("y", -1)
            elif ch == "j":
                dev.joystick("x", -1)
            elif ch == "l":
                dev.joystick("x", +1)
            elif ch in "abc":
                dev.press_key(ch)
            elif ch == "p":
                dev.press_key("D")
            elif ch == "e":
                dev.press_button()
    except KeyboardInterrupt:
        pass
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        dev.stop()
    return 0
