"""Pause budget: the hours a flexible AI site in Houston would have paused in 2025.

    python bridge/pause_budget.py                       # downloads ERCOT's 2025 hourly load archive
    python bridge/pause_budget.py --xlsx Native_Load_2025.xlsx

Writes web/data/pause-budget.json (public ERCOT data, safe to commit).

Two reasons to pause, both read from ERCOT's own hourly load ("Native Load", by weather zone):

  * 4CP. CenterPoint bills transmission on a customer's load during ERCOT's system peak in
    each of June, July, August and September ("four coincident peaks"). Load that pauses then
    cuts the next year's transmission charge. Nobody knows in advance which day will set the
    month's peak, so we count every summer day whose system peak came within MARGIN of that
    month's peak as an alert day, and pause the peak hour and the hour on each side.
  * Houston stress. Hours when the COAST weather zone (Houston) was within MARGIN of its own
    annual peak.

Standard library only: the .xlsx is read as zipped XML.
"""

import argparse
import io
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

YEAR = 2025
ARCHIVE = "https://www.ercot.com/files/docs/2025/02/11/Native_Load_2025.zip"
ARCHIVE_PAGE = "https://www.ercot.com/gridinfo/load/load_hist"
USER_AGENT = "SiteStar-hackathon/0.1"
MARGIN = 0.02            # within 2% of the peak counts as "could be the peak"
SUMMER = (6, 7, 8, 9)    # 4CP months
# CenterPoint Transmission Cost Recovery Factor, Primary Service (IDR), $ per 4CP kVA per month.
# As listed on CenterPoint's Houston Electric rates page (date not shown there): check the
# current tariff before relying on it. Billed monthly on last summer's average 4CP demand.
TCRF_PER_KVA_MONTH = 5.357490
OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "pause-budget.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_xlsx(data: bytes) -> list[list[str | None]]:
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    rows = []
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    for row in sheet.find("m:sheetData", NS).findall("m:row", NS):
        vals = []
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            if v is None:
                t = c.find("m:is/m:t", NS)
                vals.append(t.text if t is not None else None)
            else:
                vals.append(shared[int(v.text)] if c.get("t") == "s" else v.text)
        rows.append(vals)
    return rows


def load_hours(rows) -> list[dict]:
    """[{day: date, hour: 0-23 (hour beginning), ercot, coast}] in file order."""
    head = rows[0]
    i_he, i_coast, i_ercot = head.index("Hour Ending"), head.index("COAST"), head.index("ERCOT")
    out = []
    for r in rows[1:]:
        if not r or r[i_he] is None or r[i_ercot] is None:
            continue
        stamp = str(r[i_he]).strip()
        d, hh = stamp.split()[:2]
        he = int(hh.split(":")[0])          # hour ending 1..24 ("02:00DST" -> 2)
        m, dd, y = (int(x) for x in d.split("/"))
        out.append({"day": date(y, m, dd), "hour": he - 1, "ercot": float(r[i_ercot]), "coast": float(r[i_coast])})
    return out


def build(hours: list[dict]) -> dict:
    by_day = defaultdict(list)
    for h in hours:
        by_day[h["day"]].append(h)

    # 4CP: monthly system peaks and alert days
    peaks, alert_days, pause = [], [], {}
    for month in SUMMER:
        days = [d for d in by_day if d.month == month]
        top = max((h for d in days for h in by_day[d]), key=lambda h: h["ercot"])
        peaks.append({"date": top["day"].isoformat(), "hour": top["hour"], "mw": round(top["ercot"])})
        for d in sorted(days):
            dmax = max(by_day[d], key=lambda h: h["ercot"])
            if dmax["ercot"] >= (1 - MARGIN) * top["ercot"]:
                alert_days.append({"date": d.isoformat(), "peak_hour": dmax["hour"], "mw": round(dmax["ercot"]),
                                   "share_of_month_peak": round(dmax["ercot"] / top["ercot"], 4)})
                for hr in (dmax["hour"] - 1, dmax["hour"], dmax["hour"] + 1):
                    if 0 <= hr <= 23:
                        pause.setdefault((d, hr), set()).add("4cp")

    # Houston stress hours
    coast_peak = max(hours, key=lambda h: h["coast"])
    for h in hours:
        if h["coast"] >= (1 - MARGIN) * coast_peak["coast"]:
            pause.setdefault((h["day"], h["hour"]), set()).add("houston")

    caught = sum(1 for p in peaks if (date.fromisoformat(p["date"]), p["hour"]) in pause)

    # calendar: one row per day, ERCOT load per hour (MW, rounded) and pause flags
    days_sorted = sorted(by_day)
    calendar = []
    for d in days_sorted:
        loads = [None] * 24
        for h in by_day[d]:
            loads[h["hour"]] = round(h["ercot"]) if loads[h["hour"]] is None else loads[h["hour"]]
        flags = []
        for hr in range(24):
            kinds = pause.get((d, hr))
            flags.append(0 if not kinds else 3 if len(kinds) == 2 else 1 if "4cp" in kinds else 2)
        calendar.append({"date": d.isoformat(), "load": loads, "pause": flags})

    # the replay day: ERCOT's annual system peak
    annual = max(hours, key=lambda h: h["ercot"])
    rday = annual["day"]
    replay = {
        "date": rday.isoformat(),
        "peak_hour": annual["hour"],
        "peak_mw": round(annual["ercot"]),
        "ercot": [round(h["ercot"]) for h in sorted(by_day[rday], key=lambda h: h["hour"])],
        "coast": [round(h["coast"]) for h in sorted(by_day[rday], key=lambda h: h["hour"])],
        "pause_hours": sorted(hr for (d, hr) in pause if d == rday),
    }

    n = len(pause)
    return {
        "year": YEAR,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "dataset": f"ERCOT Native Load {YEAR}, hourly by weather zone",
            "url": ARCHIVE,
            "page": ARCHIVE_PAGE,
            "hours_in_file": len(hours),
        },
        "method": {
            "margin": MARGIN,
            "four_cp": "Each June-September day whose ERCOT system peak came within 2% of that month's peak is an "
                       "alert day; pause the day's peak hour and the hour on each side.",
            "houston": "Pause any hour the COAST weather zone (Houston) was within 2% of its annual peak.",
            "caveat": "Hourly data: ERCOT's official 4CP intervals are 15 minutes. Alert days are picked after the "
                      "fact; in practice operators act on day-ahead 4CP alerts, so real pause hours are similar but not identical.",
        },
        "peaks": peaks,
        "peaks_caught": caught,
        "alert_days": alert_days,
        "coast_peak": {"date": coast_peak["day"].isoformat(), "hour": coast_peak["hour"], "mw": round(coast_peak["coast"])},
        "summary": {
            "pause_hours": n,
            "share_of_year": round(n / len(hours), 5),
            "four_cp_hours": sum(1 for k in pause.values() if "4cp" in k),
            "houston_hours": sum(1 for k in pause.values() if "houston" in k),
            "pause_days": len({d for (d, _) in pause}),
        },
        "tcrf": {
            "per_kva_month": TCRF_PER_KVA_MONTH,
            "per_kw_year": round(TCRF_PER_KVA_MONTH * 12, 2),
            "basis": "CenterPoint Transmission Cost Recovery Factor, Primary Service (IDR), $ per 4CP kVA per month, "
                     "as listed on CenterPoint's Houston Electric rates page (no date shown). Assumes power factor 1.",
            "label": "Estimated",
        },
        "replay_day": replay,
        "calendar": calendar,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Build web/data/pause-budget.json from ERCOT's hourly load archive")
    ap.add_argument("--xlsx", type=Path, help="a local Native_Load_2025.xlsx instead of downloading")
    args = ap.parse_args()
    if args.xlsx:
        data = args.xlsx.read_bytes()
    else:
        req = urllib.request.Request(ARCHIVE, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as resp:
            z = zipfile.ZipFile(io.BytesIO(resp.read()))
        data = z.read(next(n for n in z.namelist() if n.lower().endswith(".xlsx")))
    hours = load_hours(read_xlsx(data))
    out = build(hours)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    s = out["summary"]
    print(f"{len(hours)} hours read. Pause {s['pause_hours']} h ({s['share_of_year']:.2%} of the year) on {s['pause_days']} days: "
          f"{s['four_cp_hours']} for 4CP alerts, {s['houston_hours']} for Houston stress. "
          f"4CP peaks caught: {out['peaks_caught']}/4.")
    for p in out["peaks"]:
        print(f"  4CP {p['date']} hour {p['hour']}:00-{p['hour'] + 1}:00  {p['mw']:,} MW")
    print(f"Replay day {out['replay_day']['date']} (annual peak {out['replay_day']['peak_mw']:,} MW at {out['replay_day']['peak_hour']}:00)")
    print(f"Saved {OUT} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
