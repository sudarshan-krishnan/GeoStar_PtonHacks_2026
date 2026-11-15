"""SiteStar PROTECT command line.

    python protect/run.py run                    # real ESP32 + UNO R4 lobby panel (auto-detect) + dashboard on :8796
    python protect/run.py run --sim              # built-in fake board, controls on the dashboard
    python protect/run.py run --serial /dev/ttys003
    python protect/run.py fake-board             # fake board in this terminal (keyboard = sensors)
    python protect/run.py plan                   # print the sensor plan from the building model

AI model: AWS credentials -> Claude on Amazon Bedrock; else ANTHROPIC_API_KEY -> Claude API;
else the offline playbook. Force one with --llm bedrock|anthropic|offline.
"""
from __future__ import annotations

import argparse
import os
import sys
import time


def cmd_run(a) -> int:
    import uvicorn

    from .building import load_building
    from .controller import ProtectController
    from .device import NullLink, SerialLink
    from .messaging import Messenger
    from .server import create_app

    os.environ["PROTECT_LLM"] = a.llm
    building = load_building(a.building)
    print(f"[protect] building: {building.project['name']} - {len(building.rooms)} rooms, "
          f"{sum(p.count for p in building.plan)} planned sensors")
    board = None
    port = a.serial
    if a.sim:
        from .sim_board import FakeBuildingBoard

        board = FakeBuildingBoard().start()
        port = board.port
        print(f"[protect] built-in fake board on {port} (controls on the dashboard)")
    from .agent import FS_ROOT

    FS_ROOT.mkdir(parents=True, exist_ok=True)
    log_path = FS_ROOT.parent / "phone_log.jsonl"
    messenger = Messenger(None if a.bridge == "none" else a.bridge, log_path=str(log_path))
    print(f"[protect] every manager message is also saved to {log_path}")
    ref = {}
    link = NullLink() if port == "none" else SerialLink(port, on_line=lambda ln: ref["c"].on_serial_line(ln))
    lobby_port = a.lobby or ("none" if a.sim else "auto")
    lobby = NullLink() if lobby_port == "none" else SerialLink(
        lobby_port, on_line=lambda ln: ref["c"].on_lobby_line(ln), role="lobby")
    if isinstance(lobby, SerialLink):
        # The UNO R4 WiFi recovers from a RESET only while its port stays open; reopening it mid-boot
        # wedges it. So never auto-reconnect it on silence (the ESP32 keeps its watchdog).
        lobby.silent_timeout = None
    from .haven_bridge import HavenBridge

    if a.haven_facility:
        os.environ["HAVEN_FACILITY"] = a.haven_facility
    # The project the kit was last connected to from the dashboard wins over --haven-facility.
    haven = HavenBridge(None if a.haven == "none" else a.haven, link_path=FS_ROOT.parent / "haven_link.json")
    if haven.facility:
        print(f"[protect] physical model connected to: {haven.facility['name']} (saved; change it from the dashboard)")
    meter = flex = None
    if a.flex_workers != 0:
        from .power import FlexLoad, PowerMeter

        meter = PowerMeter().start()
        flex = FlexLoad(None if a.flex_workers < 0 else a.flex_workers).start()
        print(f"[protect] data hall: {flex.n} flexible AI jobs running; laptop power measured with ioreg")
    ctrl = ProtectController(building, link, messenger, lobby=lobby, haven=haven, meter=meter, flex=flex)
    print(f"[protect] team app (HAVEN command center): {a.haven}")
    ctrl.sim = board is not None
    ref["c"] = ctrl
    commander = ctrl.make_commander()
    print(f"[protect] AI incident commander: {commander.mode}"
          + ("" if commander.mode != "offline" else "  (no AWS/Anthropic credentials found: offline playbook)"))
    print(f"[protect] manager messaging: {'Photon bridge at ' + a.bridge if a.bridge != 'none' else 'dashboard phone only'}")
    link.start()
    lobby.start()
    print(f"[protect] lobby panel: {'none (badge buttons on the dashboard)' if lobby_port == 'none' else lobby_port}")
    if port not in ("none",) and not a.sim:
        time.sleep(2.5)   # opening the port resets the ESP32
    ctrl.start()
    print(f"[protect] dashboard: http://{a.host}:{a.http_port}/   (Ctrl-C to stop)")
    try:
        uvicorn.run(create_app(ctrl, board), host=a.host, port=a.http_port, log_level="warning")
    finally:
        ctrl.stop()
        link.stop()
        lobby.stop()
        if flex:
            flex.stop()
        if board:
            board.stop()
    return 0


def cmd_power_feed(a) -> int:
    """Run with sudo in your own terminal: streams chip power (CPU+GPU+ANE) once a second to PROTECT."""
    import json
    import re
    import subprocess
    import urllib.request

    if os.geteuid() != 0:
        print("powermetrics needs root. Run:  sudo .venv/bin/python protect/run.py power-feed")
        return 1
    url = a.server.rstrip("/") + "/api/power/feed"
    proc = subprocess.Popen(["powermetrics", "-i", "1000", "--samplers", "cpu_power"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    # Apple Silicon: "Combined Power (CPU + GPU + ANE): 5123 mW"; Intel: "... package power (...): 12.3W"
    pats = [re.compile(r"Combined Power \(CPU \+ GPU \+ ANE\):\s*([\d.]+)\s*(mW|W)", re.I),
            re.compile(r"package power[^:]*:\s*([\d.]+)\s*(mW|W)", re.I)]
    print(f"[power-feed] chip power every second -> {url}   (Ctrl-C to stop)")
    try:
        for line in proc.stdout:
            m = next((m for m in (p.search(line) for p in pats) if m), None)
            if not m:
                continue
            w = float(m.group(1)) / (1000.0 if m.group(2).lower() == "mw" else 1.0)
            try:
                req = urllib.request.Request(url, data=json.dumps({"watts": w}).encode(), method="POST",
                                             headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=2).read()
                print(f"\r[power-feed] {w:6.1f} W   ", end="", flush=True)
            except OSError:
                print(f"\r[power-feed] {w:6.1f} W   (PROTECT not running at {a.server}?)", end="", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()
    return 0


def cmd_plan(a) -> int:
    from .building import load_building

    b = load_building(a.building)
    print(f"{b.project['name']} - sensor plan (conceptual; confirm against NFPA 72 / IFC / local AHJ)\n")
    for p in b.plan:
        print(f"  {b.room_name(p.room):<22} {p.kind:<14} x{p.count:<3} {'[on model] ' if p.physical else ''}{p.reason}")
    return 0


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(prog="sitestar_protect")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run PROTECT (board + AI commander + dashboard)")
    r.add_argument("--serial", default="auto", help="serial port, 'auto' or 'none'")
    r.add_argument("--sim", action="store_true", help="use the built-in fake board")
    r.add_argument("--lobby", default=None, help="lobby panel (UNO R4) port, 'auto' or 'none' "
                                                 "(default: auto, or none with --sim)")
    r.add_argument("--llm", default="auto", choices=["auto", "bedrock", "anthropic", "offline"])
    r.add_argument("--bridge", default="http://127.0.0.1:8797", help="Photon bridge URL or 'none'")
    r.add_argument("--building", default=None, help="building JSON from DESIGN")
    r.add_argument("--haven", default="http://127.0.0.1:3000",
                   help="team main app URL (events go to its HAVEN command center), or 'none'")
    r.add_argument("--flex-workers", type=int, default=-1,
                   help="flexible AI jobs (busy cores) a grid event can pause; -1 = cores-2, 0 = off")
    r.add_argument("--haven-facility", default=None, help="facility id in the main app (default: newest deployed)")
    r.add_argument("--host", default="127.0.0.1")
    r.add_argument("--http-port", type=int, default=8796)
    r.set_defaults(func=cmd_run)
    f = sub.add_parser("fake-board", help="fake building board in this terminal")
    f.set_defaults(func=lambda a: __import__("sitestar_protect.sim_board", fromlist=["x"]).run_interactive())
    pf = sub.add_parser("power-feed", help="(sudo) stream chip power to PROTECT once a second")
    pf.add_argument("--server", default="http://127.0.0.1:8796")
    pf.set_defaults(func=cmd_power_feed)
    p = sub.add_parser("plan", help="print the sensor plan")
    p.add_argument("--building", default=None)
    p.set_defaults(func=cmd_plan)
    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
