"""Command line entry point.

    python -m plotstar_twin run                 # full demo: ESP32 + real workload + API on :8790
    python -m plotstar_twin run --serial none   # no ESP32 attached (software team)
    python -m plotstar_twin selftest            # ESP32 runs its hardware self-test
    python -m plotstar_twin monitor             # print knob/keypad/button readings live
    python -m plotstar_twin doctor              # check everything the demo needs, with fixes
    python -m plotstar_twin fake-esp32          # a fake board on a virtual serial port (no hardware)
"""
from __future__ import annotations

import argparse
import signal
import sys
import time


def cmd_run(args) -> int:
    import uvicorn

    from .controller import TwinController
    from .grid_day import load_day
    from .power import EstimatedCpu, make_meter
    from .serial_link import NullLink, SerialLink
    from .server import create_app
    from .sites import SiteBook
    from .workload import FakePool, WorkerPool

    day = load_day(args.data)
    print(f"[twin] grid day: {day.label} ({day.source})")
    if not day.real:
        print("[twin] WARNING: synthetic grid data. Run twin/scripts/fetch_ercot_day.py before the demo.")
    sites = SiteBook(args.sites)

    meter = EstimatedCpu().start() if args.fake_load else make_meter(args.meter)
    print(f"[twin] power: {meter.label}")
    pool = (FakePool(args.workers) if args.fake_load else WorkerPool(args.workers)).start()

    twin_ref = {}
    link = (NullLink() if args.serial == "none"
            else SerialLink(args.serial, on_line=lambda ln: twin_ref["t"].on_serial_line(ln)))
    twin = TwinController(day, sites, meter, pool, link, day_seconds=args.day_seconds,
                          peak_charge=args.peak_charge)
    twin_ref["t"] = twin
    link.start()
    if args.serial != "none":
        time.sleep(2.5)  # opening the port resets the ESP32; give it time to boot

    if args.fake_load:
        twin.calib = [10.0 + 8.0 * n for n in range(args.workers + 1)]
    else:
        twin.calibrate(use_cache=args.skip_calibration)
    twin.start()

    def shutdown(*_):
        print("\n[twin] stopping...")
        twin.stop()
        link.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    print(f"[twin] running. Status page: http://{args.host}:{args.http_port}/   (Ctrl-C to stop)")
    uvicorn.run(create_app(twin), host=args.host, port=args.http_port, log_level="warning")
    shutdown()
    return 0


def _open_link(port: str, on_line):
    from .serial_link import SerialLink

    link = SerialLink(port, on_line=on_line).start()
    for _ in range(50):
        if link.connected:
            break
        time.sleep(0.1)
    if not link.connected:
        print("ESP32 not found. Check the USB cable (must be a data cable) and close Arduino Serial Monitor.")
        link.stop()
        sys.exit(1)
    time.sleep(2.5)
    return link


def cmd_selftest(args) -> int:
    link = _open_link(args.serial, lambda ln: print(ln) if not ln.startswith("I ") else None)
    link.write(b"TEST\n")
    time.sleep(12)
    link.stop()
    return 0


def cmd_monitor(args) -> int:
    from .protocol import parse_inputs

    def show(ln: str):
        i = parse_inputs(ln)
        if i:
            t = "-" if i.temp_c is None else f"{i.temp_c:.1f}C"
            print(f"\rflex zone {i.flex} | joy x{i.jx:+d} y{i.jy:+d} | key {i.key} #{i.kseq} "
                  f"| button #{i.bseq} | therm {t}      ", end="", flush=True)

    link = _open_link(args.serial, show)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        link.stop()
    return 0


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(line_buffering=True)  # logs show up live even when piped
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(prog="plotstar_twin")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="run the live digital twin")
    r.add_argument("--serial", default="auto", help="serial port, 'auto' or 'none'")
    r.add_argument("--meter", default="auto", choices=["auto", "mac", "rapl", "pi5", "estimate"])
    r.add_argument("--workers", type=int, default=4, help="1 always-on + N-1 flexible (default 4)")
    r.add_argument("--day-seconds", type=float, default=60.0, help="length of one replayed day")
    r.add_argument("--peak-charge", type=float, default=150.0, help="$/MWh added in the system-peak hour")
    r.add_argument("--data", default=None, help="grid day CSV (default: newest twin/data/ercot_*.csv)")
    r.add_argument("--sites", default=None, help="sites JSON (default: twin/config/sites.json)")
    r.add_argument("--skip-calibration", action="store_true", help="reuse the cached calibration")
    r.add_argument("--fake-load", action="store_true", help="no CPU load, estimated power (UI dev only)")
    r.add_argument("--host", default="127.0.0.1")
    r.add_argument("--http-port", type=int, default=8790)
    r.set_defaults(func=cmd_run)

    for name, fn, helptext in (("selftest", cmd_selftest, "run the ESP32 hardware self-test"),
                               ("monitor", cmd_monitor, "show live knob/keypad/button readings")):
        p = sub.add_parser(name, help=helptext)
        p.add_argument("--serial", default="auto")
        p.set_defaults(func=fn)

    d = sub.add_parser("doctor", help="check everything the demo needs")
    d.add_argument("--serial", default="auto")
    d.add_argument("--http-port", type=int, default=8790)
    d.add_argument("--no-serial", action="store_true", help="skip the ESP32 check (no board yet)")
    d.set_defaults(func=lambda a: __import__("plotstar_twin.doctor", fromlist=["run"]).run(
        a.serial, a.http_port, a.no_serial))

    f = sub.add_parser("fake-esp32", help="fake ESP32 on a virtual serial port, controlled from the keyboard")
    f.add_argument("--no-thermistor", action="store_true")
    f.set_defaults(func=lambda a: __import__("plotstar_twin.sim_device", fromlist=["run_interactive"])
                   .run_interactive(None if a.no_thermistor else 31.0))

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
