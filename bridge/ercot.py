"""Real ERCOT grid data for SiteStar, from public ercot.com endpoints (no API key).

    python bridge/ercot.py           # save a snapshot to web/data/ercot.json
    python bridge/ercot.py --print   # just print a summary

The bridge serves a fresh copy at /api/ercot (refreshed every 5 minutes); the
website falls back to the snapshot when no bridge is running.

What it collects, all in ERCOT local time (Central):
  * fuel mix, 5-minute, yesterday + today      (dashboards/fuel-mix.json)
  * system demand, 5-minute, today             (dashboards/supply-demand.json)
  * real-time prices, 15-minute, LZ_HOUSTON    (cdr/html/<date>_real_time_spp.html)
  * day-ahead prices, hourly, LZ_HOUSTON       (cdr/html/<date>_dam_spp.html)

Prices are wholesale settlement point prices in $/MWh, not a contracted rate.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE = "https://www.ercot.com"
FUEL_URL = BASE + "/api/1/services/read/dashboards/fuel-mix.json"
DEMAND_URL = BASE + "/api/1/services/read/dashboards/supply-demand.json"
RT_URL = BASE + "/content/cdr/html/{ymd}_real_time_spp.html"
DAM_URL = BASE + "/content/cdr/html/{ymd}_dam_spp.html"
ZONE = "LZ_HOUSTON"
USER_AGENT = "SiteStar-hackathon/0.1"
SNAPSHOT = Path(__file__).resolve().parent.parent / "web" / "data" / "ercot.json"

# Stack order, bottom to top. Hydro and "Other" are folded into Other (< 1%).
FUELS = ["Coal", "Nuclear", "Gas", "Wind", "Batteries", "Solar", "Other"]
FUEL_MAP = {"Coal and Lignite": "Coal", "Nuclear": "Nuclear", "Natural Gas": "Gas",
            "Wind": "Wind", "Solar": "Solar", "Hydro": "Other", "Other": "Other"}
FOSSIL = ("Coal", "Gas")


def fetch(url: str, timeout: float = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def html_rows(html: str) -> list[dict]:
    """Rows of the first data table on an ERCOT cdr page, as dicts keyed by header."""
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
    cells = [[re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
             for r in rows]
    cells = [r for r in cells if r]
    if not cells:
        return []
    head = cells[0]
    return [dict(zip(head, r)) for r in cells[1:] if len(r) == len(head)]


def minute_of(ts: str) -> int:
    """'2026-11-13 18:05:00-0600' -> 1085 (minutes after local midnight)."""
    return int(ts[11:13]) * 60 + int(ts[14:16])


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def r1(x):
    return None if x is None else round(x, 1)


# ---------- sources ----------

def fuel_mix() -> dict:
    """{date: {'minutes': [...], fuel: [MW...], 'charging': [MW...]}}"""
    raw = json.loads(fetch(FUEL_URL))
    out = {}
    for day, intervals in raw["data"].items():
        d = {"minutes": [], "charging": [], **{f: [] for f in FUELS}}
        for ts in sorted(intervals):
            v = intervals[ts]
            gen = {k: (x or {}).get("gen") or 0.0 for k, x in v.items()}
            d["minutes"].append(minute_of(ts))
            sums = {f: 0.0 for f in FUELS}
            for name, fuel in FUEL_MAP.items():
                sums[fuel] += max(gen.get(name, 0.0), 0.0)
            net = gen.get("Power Storage", 0.0)
            sums["Batteries"] = max(gen.get("Power Storage Discharging", max(net, 0.0)), 0.0)
            d["charging"].append(round(max(-gen.get("Power Storage Charging", min(net, 0.0)), 0.0)))
            for f in FUELS:
                d[f].append(round(sums[f]))
        out[day] = d
    return out


def demand_today() -> dict:
    raw = json.loads(fetch(DEMAND_URL))
    pts = [p for p in raw.get("data", []) if not p.get("forecast")]
    return {
        "date": pts[0]["timestamp"][:10] if pts else None,
        "minutes": [minute_of(p["timestamp"]) for p in pts],
        "demand": [p.get("demand") for p in pts],
        "capacity": [p.get("capacity") for p in pts],
    }


def rt_prices(day: date) -> dict | None:
    """15-minute real-time prices; minutes are interval-ending (15 .. 1440)."""
    try:
        rows = html_rows(fetch(RT_URL.format(ymd=day.strftime("%Y%m%d"))))
    except urllib.error.HTTPError:
        return None
    rows = [r for r in rows if r.get(ZONE)]
    if not rows:
        return None
    return {"minutes": [int(r["Interval Ending"][:2]) * 60 + int(r["Interval Ending"][2:]) for r in rows],
            "price": [float(r[ZONE]) for r in rows]}


def dam_prices(day: date) -> list | None:
    """24 hourly day-ahead prices, index 0 = hour beginning midnight."""
    try:
        rows = html_rows(fetch(DAM_URL.format(ymd=day.strftime("%Y%m%d"))))
    except urllib.error.HTTPError:
        return None
    prices = [None] * 24
    for r in rows:
        if r.get(ZONE):
            prices[int(r["Hour Ending"]) - 1] = float(r[ZONE])
    return prices if all(p is not None for p in prices) else None


# ---------- assembly ----------

def hourly_from_rt(rt: dict) -> list:
    """Mean of the four 15-minute intervals in each hour (index = hour beginning)."""
    buckets = [[] for _ in range(24)]
    for m, p in zip(rt["minutes"], rt["price"]):
        buckets[min((m - 1) // 60, 23)].append(p)
    return [r1(mean(b)) for b in buckets]


def hourly_from_fuel(fm: dict) -> dict:
    out = {}
    for f in FUELS:
        buckets = [[] for _ in range(24)]
        for m, mw in zip(fm["minutes"], fm[f]):
            buckets[m // 60].append(mw)
        out[f] = [None if not b else round(mean(b)) for b in buckets]
    return out


def fossil_share(mix: dict, i: int) -> float | None:
    vals = {f: mix[f][i] for f in FUELS}
    if any(v is None for v in vals.values()):
        return None
    total = sum(vals.values())
    return round(sum(vals[f] for f in FOSSIL) / total, 4) if total else None


def build() -> dict:
    now_utc = datetime.now(timezone.utc)
    fm = fuel_mix()
    dem = demand_today()
    local_days = sorted(fm)                     # e.g. ['2026-11-13', '2026-11-14']
    today = date.fromisoformat(local_days[-1])
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    days = []
    for d, kind in ((yesterday, "actual"), (today, "today"), (tomorrow, "dayahead")):
        key = d.isoformat()
        entry = {"date": key, "kind": kind}
        rt = rt_prices(d) if kind != "dayahead" else None
        dam = dam_prices(d)
        if key in fm:
            entry["fuel"] = fm[key]
            entry["hourly_fuel"] = hourly_from_fuel(fm[key])
            entry["hourly_fossil_share"] = [fossil_share(entry["hourly_fuel"], i) for i in range(24)]
        if rt:
            entry["rt"] = rt
        if kind == "actual" and rt and len(rt["price"]) >= 96:
            entry["hourly_price"] = hourly_from_rt(rt)
            entry["price_kind"] = "real-time"
            entry["complete"] = True
        elif dam:
            entry["hourly_price"] = dam
            entry["price_kind"] = "day-ahead"
            entry["complete"] = True
        else:
            entry["complete"] = False
        if dam:
            entry["dam"] = dam
        if kind == "dayahead" and not dam:
            continue  # tomorrow's day-ahead market not published yet
        days.append(entry)

    # "Right now": latest 5-minute fuel interval, demand point and 15-minute price.
    latest_fm = fm[local_days[-1]] if fm[local_days[-1]]["minutes"] else fm[local_days[0]]
    mix_now = {f: latest_fm[f][-1] for f in FUELS}
    total_now = sum(mix_now.values())
    prices = []
    for e in days:
        if e.get("rt"):
            prices += [(e["date"], m, p) for m, p in zip(e["rt"]["minutes"], e["rt"]["price"])]
    last_day, last_min, last_price = prices[-1]
    window = [p for _, _, p in prices[-96:]]
    cheaper_than = sum(1 for p in window if p > last_price) / len(window)

    return {
        "retrieved_at": now_utc.isoformat(timespec="seconds"),
        "zone": ZONE,
        "timezone": "America/Chicago",
        "fuels": FUELS,
        "fossil": list(FOSSIL),
        "sources": {
            "fuel_mix": FUEL_URL,
            "demand": DEMAND_URL,
            "rt_price": RT_URL.format(ymd="YYYYMMDD"),
            "dam_price": DAM_URL.format(ymd="YYYYMMDD"),
        },
        "days": days,
        "demand_today": dem,
        "now": {
            "fuel_date": local_days[-1] if fm[local_days[-1]]["minutes"] else local_days[0],
            "fuel_minute": latest_fm["minutes"][-1],
            "mix": mix_now,
            "total_mw": total_now,
            "charging_mw": latest_fm["charging"][-1],
            "fossil_share": round(sum(mix_now[f] for f in FOSSIL) / total_now, 4) if total_now else None,
            "renewable_share": round((mix_now["Wind"] + mix_now["Solar"]) / total_now, 4) if total_now else None,
            "demand_mw": dem["demand"][-1] if dem["demand"] else None,
            "demand_minute": dem["minutes"][-1] if dem["minutes"] else None,
            "price": last_price,
            "price_date": last_day,
            "price_minute_ending": last_min,
            "price_cheaper_than_share": round(cheaper_than, 3),
            "price_window_intervals": len(window),
        },
    }


def summary(d: dict) -> str:
    n = d["now"]
    lines = [f"Retrieved {d['retrieved_at']}  ({d['zone']})",
             f"Now: demand {n['demand_mw']} MW, price ${n['price']}/MWh "
             f"(cheaper than {n['price_cheaper_than_share']:.0%} of the last 24 h), "
             f"wind+solar {n['renewable_share']:.0%}, fossil {n['fossil_share']:.0%}"]
    for e in d["days"]:
        hp = e.get("hourly_price") or []
        rng = f"${min(hp):.0f}-${max(hp):.0f}/MWh" if hp else "no complete prices"
        lines.append(f"  {e['date']} [{e['kind']}] {e.get('price_kind', '-')}: {rng}, "
                     f"fuel intervals {len(e.get('fuel', {}).get('minutes', []))}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch real ERCOT data for the SiteStar site")
    ap.add_argument("--out", type=Path, default=SNAPSHOT)
    ap.add_argument("--print", action="store_true", help="print a summary without saving")
    args = ap.parse_args()
    data = build()
    print(summary(data))
    if not args.print:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(data, separators=(",", ":")))
        print(f"Saved {args.out} ({args.out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
