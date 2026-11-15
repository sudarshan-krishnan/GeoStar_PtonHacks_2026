"""`python twin/run.py doctor`: one command that checks everything the demo needs, with fixes."""
from __future__ import annotations

import importlib
import json
import platform
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIRMWARE = ROOT / "hardware" / "firmware" / "esp32_grid"

OK, WARN, FAIL = "PASS", "WARN", "FAIL"


class Report:
    def __init__(self):
        self.rows: list[tuple[str, str, str, str]] = []

    def add(self, status: str, name: str, detail: str, fix: str = "") -> None:
        self.rows.append((status, name, detail, fix))
        mark = {"PASS": "\033[32mPASS\033[0m", "WARN": "\033[33mWARN\033[0m", "FAIL": "\033[31mFAIL\033[0m"}[status]
        print(f"  {mark}  {name:<16} {detail}")
        if fix and status != OK:
            print(f"        {'':<16} -> {fix}")

    @property
    def failed(self) -> bool:
        return any(r[0] == FAIL for r in self.rows)


def check_python(r: Report) -> None:
    v = sys.version_info
    r.add(OK if v >= (3, 10) else FAIL, "python", platform.python_version(), "use Python 3.10+")
    missing = []
    for mod in ("fastapi", "uvicorn", "serial", "numpy", "scipy", "psutil", "pydantic"):
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(mod)
    r.add(FAIL if missing else OK, "packages", "missing: " + ", ".join(missing) if missing else "all installed",
          ".venv/bin/pip install -r twin/requirements.txt")


def check_data(r: Report) -> None:
    from .grid_day import load_day
    from .sites import CONFIG

    day = load_day()
    r.add(OK if day.real else WARN, "grid data", f"{day.label} ({day.source})",
          ".venv/bin/python twin/scripts/fetch_ercot_day.py 2026-11-12")
    cfg = json.loads(CONFIG.read_text())
    placeholder = "PLACEHOLDER" in cfg.get("_README", "")
    r.add(WARN if placeholder else OK, "sites.json",
          "placeholder site values" if placeholder else "real site values",
          "fill twin/config/sites.json from CoStar / Aqueduct / OSM, then remove PLACEHOLDER from _README")


def check_power(r: Report) -> None:
    from .power import LinuxRapl, MacPowermetrics, Pi5Pmic

    for cls in (MacPowermetrics, Pi5Pmic, LinuxRapl):
        if not cls.available():
            continue
        m = cls().start()
        ok = m.wait_ready(8)
        w = m.read()
        m.stop()
        if ok:
            r.add(OK, "power meter", f"{cls.name}: {w:.2f} W now (MEASURED)")
        else:
            r.add(FAIL, "power meter", f"{cls.name}: {m.error or 'no reading'}",
                  "run `sudo -v` in this same terminal, then rerun doctor" if cls is MacPowermetrics else "")
        return
    r.add(WARN, "power meter", "no hardware counter: twin will show ESTIMATED power",
          "fine for rehearsal; on stage use a Mac (powermetrics), Linux (RAPL) or Pi 5")


def check_serial(r: Report, port: str) -> None:
    from serial.tools import list_ports

    from .protocol import parse_inputs
    from .serial_link import SerialLink, find_port

    ports = [p.device for p in list_ports.comports()]
    target = find_port() if port == "auto" else port
    if not target:
        r.add(FAIL, "ESP32 USB", f"no ESP32-like port found (ports: {', '.join(ports) or 'none'})",
              "plug in with a DATA cable; Mac may need the CP210x or CH34x driver; close Arduino Serial Monitor")
        return
    got = {"hello": None, "inp": None}

    def on_line(ln: str):
        if ln.startswith("HELLO"):
            got["hello"] = ln
        i = parse_inputs(ln)
        if i:
            got["inp"] = i

    link = SerialLink(target, on_line=on_line).start()
    end = time.time() + 6
    while time.time() < end and not got["inp"]:
        time.sleep(0.1)
    link.stop()
    if not link.port:
        r.add(FAIL, "ESP32 USB", f"could not open {target}", "close Arduino IDE Serial Monitor / other twin")
    elif not got["inp"]:
        r.add(FAIL, "ESP32 firmware", f"{target} opened but no data from the board",
              "flash hardware/firmware/esp32_grid (see hardware/README.md section 4)")
    else:
        i = got["inp"]
        r.add(OK, "ESP32 firmware", f"{target}: {got['hello'] or 'talking'}")
        t = "not connected" if i.temp_c is None else f"{i.temp_c:.1f} C"
        r.add(OK, "ESP32 inputs", f"flex zone {i.flex}, joystick x{i.jx:+d} y{i.jy:+d}, thermistor {t}")
        if i.jx or i.jy:
            r.add(WARN, "joystick", "reads off-centre with nobody touching it",
                  "don't touch the joystick while the ESP32 boots; press EN/RST to re-learn centre")


def check_arduino(r: Report) -> None:
    cli = shutil.which("arduino-cli")
    if not cli:
        r.add(WARN, "arduino-cli", "not installed (Arduino IDE 2 works too)", "brew install arduino-cli")
        return
    cores = subprocess.run([cli, "core", "list"], capture_output=True, text=True).stdout
    libs = subprocess.run([cli, "lib", "list"], capture_output=True, text=True).stdout
    r.add(OK if "esp32:esp32" in cores else FAIL, "esp32 core", "installed" if "esp32:esp32" in cores else "missing",
          "arduino-cli core install esp32:esp32")
    has_libs = "Adafruit SSD1306" in libs and "Adafruit GFX" in libs
    r.add(OK if has_libs else FAIL, "OLED libraries", "installed" if has_libs else "missing",
          'arduino-cli lib install "Adafruit SSD1306" "Adafruit GFX Library"')


def check_http_port(r: Report, port: int) -> None:
    with socket.socket() as s:
        busy = s.connect_ex(("127.0.0.1", port)) == 0
    r.add(FAIL if busy else OK, "http port", f"{port} {'in use' if busy else 'free'}",
          f"stop whatever uses {port}, or run with --http-port 8791")


def run(port: str = "auto", http_port: int = 8790, skip_serial: bool = False) -> int:
    r = Report()
    print("\nPlotStar twin doctor\n")
    check_python(r)
    check_data(r)
    check_arduino(r)
    check_http_port(r, http_port)
    check_power(r)
    if skip_serial:
        r.add(WARN, "ESP32 USB", "skipped (--no-serial)")
    else:
        check_serial(r, port)
    print("\n" + ("Something needs fixing (FAIL lines above)." if r.failed else "Ready. Start the demo with: "
                  ".venv/bin/python twin/run.py run") + "\n")
    return 1 if r.failed else 0
