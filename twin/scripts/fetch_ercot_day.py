"""Download one real ERCOT day and cache it as an hourly CSV for the digital twin.

    python twin/scripts/fetch_ercot_day.py 2026-11-12

Writes twin/data/ercot_<date>.csv with columns:
    hour, price_usd_mwh, load_mw, wind_mw, solar_mw, gas_mw, coal_mw, nuclear_mw,
    hydro_mw, storage_mw, other_mw

Price is the real-time settlement point price for the Houston load zone (LZ_HOUSTON),
averaged to hourly. Fuel mix and load are ERCOT system-wide. Source: ERCOT public data
via the open-source `gridstatus` library.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
TZ = "US/Central"

FUEL_COLUMNS = {
    "wind_mw": ["Wind"],
    "solar_mw": ["Solar"],
    "gas_mw": ["Natural Gas", "Gas", "Gas-CC", "Gas CC"],
    "coal_mw": ["Coal and Lignite", "Coal"],
    "nuclear_mw": ["Nuclear"],
    "hydro_mw": ["Hydro"],
    "storage_mw": ["Power Storage", "Storage"],
    "other_mw": ["Other", "Biomass"],
}


def _time_col(df: pd.DataFrame) -> str:
    for c in ("Interval Start", "Time", "Interval End"):
        if c in df.columns:
            return c
    raise KeyError(f"no time column in {list(df.columns)}")


def _hourly(df: pd.DataFrame, value_cols: list[str]) -> pd.DataFrame:
    t = pd.to_datetime(df[_time_col(df)])
    if t.dt.tz is None:
        t = t.dt.tz_localize(TZ)
    out = df[value_cols].copy()
    out.index = t.dt.tz_convert(TZ)
    return out.resample("1h").mean()


def fetch(date: str) -> pd.DataFrame:
    import gridstatus

    iso = gridstatus.Ercot()
    day = pd.Timestamp(date)

    mix = iso.get_fuel_mix(day)
    mix_h = _hourly(mix, [c for c in mix.columns if mix[c].dtype.kind in "fi"])
    out = pd.DataFrame(index=mix_h.index)
    for name, candidates in FUEL_COLUMNS.items():
        cols = [c for c in candidates if c in mix_h.columns]
        out[name] = mix_h[cols].sum(axis=1) if cols else 0.0
    out["storage_mw"] = out["storage_mw"].clip(lower=0)  # charging is not generation

    load = iso.get_load(day)
    load_col = "Load" if "Load" in load.columns else [c for c in load.columns if load[c].dtype.kind in "fi"][0]
    out["load_mw"] = _hourly(load, [load_col])[load_col]

    spp = iso.get_spp(day, market="REAL_TIME_15_MIN", location_type="Load Zone")
    spp = spp[spp["Location"] == "LZ_HOUSTON"]
    price_col = "SPP" if "SPP" in spp.columns else "LMP"
    out["price_usd_mwh"] = _hourly(spp, [price_col])[price_col]

    out = out[out.index.normalize() == day.tz_localize(TZ)]
    out = out.reset_index(drop=True)
    out.insert(0, "hour", range(len(out)))
    if len(out) != 24 or out.isna().any().any():
        raise RuntimeError(f"incomplete day: {len(out)} hours, NaNs:\n{out.isna().sum()}")
    return out.round(2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("date", help="YYYY-MM-DD (US/Central)")
    args = ap.parse_args()
    try:
        df = fetch(args.date)
    except Exception as exc:  # network / API shape problems: say so plainly
        print(f"FAILED to fetch ERCOT {args.date}: {exc}", file=sys.stderr)
        return 1
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / f"ercot_{args.date}.csv"
    df.to_csv(path, index=False)
    print(f"wrote {path}")
    print(df.to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
