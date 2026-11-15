"""One grid day (24 hourly rows) to replay: real ERCOT CSV if cached, else a labelled synthetic shape."""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# Approximate direct-emission factors, gCO2 per kWh generated (typical US fleet values,
# in line with EPA eGRID; verify before quoting). Storage counted as zero because in
# ERCOT it mostly charges on midday solar.
EMISSION_FACTORS = {
    "coal_mw": 1000.0,
    "gas_mw": 440.0,
    "other_mw": 600.0,
    "wind_mw": 0.0,
    "solar_mw": 0.0,
    "nuclear_mw": 0.0,
    "hydro_mw": 0.0,
    "storage_mw": 0.0,
}
GEN_COLUMNS = list(EMISSION_FACTORS)

# Full-scale values for the model grid (turbine speed, LED brightness).
WIND_FULL_MW = 28000.0    # around ERCOT's wind record
SOLAR_FULL_MW = 32000.0   # above ERCOT's 2025-26 solar records
GAS_FULL_MW = 50000.0


@dataclass
class Hour:
    hour: int
    price: float           # $/MWh, Houston load zone real-time
    load_mw: float         # ERCOT system load
    gen: dict              # MW by fuel column
    carbon: float = 0.0    # gCO2/kWh of the generation mix

    def __post_init__(self):
        total = sum(max(0.0, v) for v in self.gen.values())
        self.carbon = (sum(max(0.0, self.gen[k]) * EMISSION_FACTORS[k] for k in self.gen) / total
                       if total > 0 else 0.0)


@dataclass
class GridDay:
    label: str             # e.g. "ERCOT 2026-11-12"
    source: str            # where the numbers came from
    real: bool             # False => synthetic, must be labelled on screen
    hours: list = field(default_factory=list)

    def at(self, h: float) -> dict:
        """Linearly interpolated values at fractional hour h (wraps at 24)."""
        h = h % 24.0
        i = int(math.floor(h))
        a, b = self.hours[i], self.hours[(i + 1) % 24]
        t = h - i

        def lerp(x, y):
            return x + (y - x) * t

        return {
            "hour": h,
            "price": lerp(a.price, b.price),
            "load_mw": lerp(a.load_mw, b.load_mw),
            "carbon": lerp(a.carbon, b.carbon),
            "wind_mw": lerp(a.gen["wind_mw"], b.gen["wind_mw"]),
            "solar_mw": lerp(a.gen["solar_mw"], b.gen["solar_mw"]),
            "gas_mw": lerp(a.gen["gas_mw"], b.gen["gas_mw"]),
        }

    def peak_hours(self, n: int = 1) -> set:
        """The n highest system-load hours (where a 4CP-style peak charge would land)."""
        ranked = sorted(self.hours, key=lambda x: x.load_mw, reverse=True)
        return {x.hour for x in ranked[:n]}

    def to_json(self) -> dict:
        return {
            "label": self.label, "source": self.source, "real": self.real,
            "hours": [{"hour": x.hour, "price": x.price, "load_mw": x.load_mw,
                       "carbon": round(x.carbon, 1), **x.gen} for x in self.hours],
        }


def load_csv(path: Path) -> GridDay:
    hours = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            gen = {k: float(row.get(k, 0) or 0) for k in GEN_COLUMNS}
            hours.append(Hour(int(row["hour"]), float(row["price_usd_mwh"]), float(row["load_mw"]), gen))
    if len(hours) != 24:
        raise ValueError(f"{path} has {len(hours)} rows, expected 24")
    date = path.stem.replace("ercot_", "")
    return GridDay(f"ERCOT {date}", "ERCOT public data via gridstatus (LZ_HOUSTON real-time price)", True, hours)


def synthetic_day() -> GridDay:
    """Plausible November ERCOT shape for development only. Never present as real."""
    hours = []
    for h in range(24):
        solar = max(0.0, math.sin(math.pi * (h - 7) / 10)) * 28000 if 7 <= h <= 17 else 0.0
        wind = 4000 + 3000 * math.cos(math.pi * h / 12)
        load = 46000 + 8000 * math.exp(-((h - 16) ** 2) / 18)
        nuclear, coal = 4900.0, 6500.0
        gas = max(8000.0, load - solar - wind - nuclear - coal)
        price = 25 + 0.0018 * max(0.0, gas - 15000) + (35 if h in (17, 18) else 0)
        gen = {k: 0.0 for k in GEN_COLUMNS}
        gen.update(wind_mw=wind, solar_mw=solar, gas_mw=gas, coal_mw=coal, nuclear_mw=nuclear)
        hours.append(Hour(h, round(price, 2), round(load, 0), gen))
    return GridDay("SYNTHETIC day", "synthetic development profile (NOT real data)", False, hours)


def load_day(path: Optional[str] = None) -> GridDay:
    if path:
        return load_csv(Path(path))
    cached = sorted(DATA_DIR.glob("ercot_*.csv"))
    return load_csv(cached[-1]) if cached else synthetic_day()
