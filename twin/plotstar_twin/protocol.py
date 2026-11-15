"""Wire format between the laptop and the ESP32 (see esp32_grid.ino header)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

OLED_COLS = 21
OLED_ROWS = 6


def encode_state(hour: float, wind: float, solar: float, gas: float, co2: float,
                 diesel: bool, alarm: bool) -> bytes:
    def f(v: float) -> str:
        return f"{max(0.0, min(1.0, v)):.3f}"

    return (f"S h={hour % 24:.3f} wind={f(wind)} solar={f(solar)} gas={f(gas)} "
            f"co2={max(0.0, co2):.0f} diesel={int(bool(diesel))} alarm={int(bool(alarm))}\n").encode()


def _clean(line: str) -> str:
    s = "".join(ch if 32 <= ord(ch) < 127 and ch != "|" else " " for ch in line)
    return s[:OLED_COLS]


def encode_lines(lines: list[str]) -> bytes:
    rows = [_clean(x) for x in lines[:OLED_ROWS]]
    rows += [""] * (OLED_ROWS - len(rows))
    return ("L " + "|".join(rows) + "\n").encode()


@dataclass
class Inputs:
    flex: int = 0          # potentiometer zone 0..3
    jx: int = 0            # -1 left (water) / 0 / +1 right (air)
    jy: int = 0            # -1 down / 0 / +1 up (carbon price)
    key: str = "-"
    kseq: int = 0
    bseq: int = 0
    temp_c: Optional[float] = None
    uptime_s: int = 0


def parse_inputs(line: str) -> Optional[Inputs]:
    line = line.strip()
    if not line.startswith("I "):
        return None
    kv = {}
    for tok in line[2:].split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            kv[k] = v
    try:
        temp = kv.get("temp", "-")
        return Inputs(
            flex=max(0, min(3, int(kv.get("flex", 0)))),
            jx=int(kv.get("jx", 0)),
            jy=int(kv.get("jy", 0)),
            key=kv.get("key", "-")[:1],
            kseq=int(kv.get("kseq", 0)),
            bseq=int(kv.get("bseq", 0)),
            temp_c=None if temp == "-" else float(temp),
            uptime_s=int(kv.get("up", 0)),
        )
    except ValueError:
        return None
