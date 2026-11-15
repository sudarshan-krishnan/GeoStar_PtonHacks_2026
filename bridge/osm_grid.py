"""Build the Houston grid map layer for the SiteStar site from OpenStreetMap.

    python bridge/osm_grid.py                  # query Overpass (2-4 minutes)
    python bridge/osm_grid.py --raw-dir DIR    # reuse saved Overpass responses

Writes web/data/houston-grid.json with:
  * substations  [lon, lat, kV, name, operator]
  * lines        high-voltage transmission (138 kV and 345 kV), simplified
  * residential  OSM landuse=residential areas (their real outlines),
                 rasterized to ~110 m cells

Data (c) OpenStreetMap contributors, ODbL. A nearby substation is not
available capacity; OSM land-use coverage is incomplete.
"""

import argparse
import base64
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "SiteStar-hackathon/0.1"
BBOX = (29.45, -95.85, 30.15, -94.95)  # south, west, north, east (Greater Houston)
OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "houston-grid.json"
CELL_LAT, CELL_LON = 0.001, 0.00115   # ~110 m x ~110 m at 29.8 N

BB = "({},{},{},{})".format(*BBOX)
QUERIES = {
    "substations": f'[out:json][timeout:120];(node["power"="substation"]{BB};way["power"="substation"]{BB};);out center tags;',
    "lines": f'[out:json][timeout:180];way["power"="line"]["voltage"~"(138000|345000)"]{BB};out geom tags;',
    "residential": f'[out:json][timeout:240];(way["landuse"="residential"]{BB};relation["landuse"="residential"]{BB};);out geom qt;',
}


def overpass(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.load(resp)


def max_kv(tag: str | None) -> int | None:
    vals = []
    for part in (tag or "").replace(",", ";").split(";"):
        part = part.strip()
        if part.isdigit():
            vals.append(int(part) // 1000)
    return max(vals) if vals else None


def simplify(pts: list, tol: float) -> list:
    """Douglas-Peucker on (lon, lat) points."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    worst, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
        if d > worst:
            worst, idx = d, i
    if worst <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def build(raw: dict) -> dict:
    subs = []
    for e in raw["substations"]["elements"]:
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        if lat is None:
            continue
        t = e.get("tags", {})
        subs.append([round(lon, 5), round(lat, 5), max_kv(t.get("voltage")), t.get("name"), t.get("operator")])

    lines = {"345": [], "138": []}
    for e in raw["lines"]["elements"]:
        kv = max_kv(e.get("tags", {}).get("voltage"))
        key = "345" if kv and kv >= 300 else "138" if kv and kv >= 100 else None
        if not key or not e.get("geometry"):
            continue
        pts = [(round(g["lon"], 4), round(g["lat"], 4)) for g in e["geometry"]]
        pts = simplify([p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]], 0.00025)
        lines[key].append([c for p in pts for c in p])

    s, w, n, e_ = BBOX
    rows, cols = round((n - s) / CELL_LAT), round((e_ - w) / CELL_LON)
    bits = bytearray((rows * cols + 7) // 8)

    def mark(r, c):
        if 0 <= r < rows and 0 <= c < cols:
            i = r * cols + c
            bits[i >> 3] |= 1 << (i & 7)

    used = 0
    for el in raw["residential"]["elements"]:
        # Rings: a closed way, or every member way of a multipolygon (inner rings
        # make holes, which the even-odd fill below handles).
        rings = []
        if el["type"] == "way" and el.get("geometry"):
            rings.append([(g["lon"], g["lat"]) for g in el["geometry"]])
        for m in el.get("members", []):
            if m.get("type") == "way" and m.get("geometry") and m.get("role") in ("outer", "inner", ""):
                rings.append([(g["lon"], g["lat"]) for g in m["geometry"]])
        segs = [(a, b) for ring in rings for a, b in zip(ring, ring[1:]) if a != b]
        if not segs:
            continue
        used += 1
        for ring in rings:  # areas smaller than a cell still count
            for lon, lat in ring:
                mark(int((lat - s) / CELL_LAT), int((lon - w) / CELL_LON))
        lats = [p[1] for ring in rings for p in ring]
        r0 = max(int((min(lats) - s) / CELL_LAT), 0)
        r1 = min(int((max(lats) - s) / CELL_LAT), rows - 1)
        for r in range(r0, r1 + 1):  # scanline, even-odd fill at cell centers
            y = s + (r + 0.5) * CELL_LAT
            xs = sorted(
                a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                for a, b in segs if (a[1] <= y) != (b[1] <= y)
            )
            for x0, x1 in zip(xs[::2], xs[1::2]):
                c0 = max(int((x0 - w) / CELL_LON - 0.5) + 1, 0) if x0 > w else 0
                c1 = min(int((x1 - w) / CELL_LON - 0.5), cols - 1)
                for c in range(c0, c1 + 1):
                    mark(r, c)
    marked = sum(bin(x).count("1") for x in bits)
    skipped = 0

    return {
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "OpenStreetMap contributors (ODbL), via the Overpass API",
        "bbox": {"south": s, "west": w, "north": n, "east": e_},
        "substations": subs,
        "lines": lines,
        "residential": {
            "rows": rows, "cols": cols, "cell_lat": CELL_LAT, "cell_lon": CELL_LON,
            "bits": base64.b64encode(bytes(bits)).decode(),
            "areas_used": used, "areas_skipped_too_large": skipped, "cells_marked": marked,
            "method": "OSM landuse=residential outlines rasterized to ~110 m cells",
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Build web/data/houston-grid.json from OpenStreetMap")
    ap.add_argument("--raw-dir", type=Path, help="folder with substations.json, lines.json, residential.json")
    ap.add_argument("--save-raw", type=Path, help="save the Overpass responses here for reuse")
    args = ap.parse_args()

    raw = {}
    for key, query in QUERIES.items():
        if args.raw_dir:
            raw[key] = json.loads((args.raw_dir / f"{key}.json").read_text())
            continue
        t0 = time.time()
        print(f"Querying Overpass for {key}…", flush=True)
        raw[key] = overpass(query)
        print(f"  {len(raw[key]['elements'])} elements in {time.time() - t0:.0f}s")
        if args.save_raw:
            args.save_raw.mkdir(parents=True, exist_ok=True)
            (args.save_raw / f"{key}.json").write_text(json.dumps(raw[key]))

    data = build(raw)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    r = data["residential"]
    print(f"{len(data['substations'])} substations, {len(data['lines']['345'])} x 345 kV and "
          f"{len(data['lines']['138'])} x 138 kV lines, {r['cells_marked']} residential cells "
          f"({r['areas_used']} areas, {r['areas_skipped_too_large']} skipped as too large)")
    print(f"Saved {OUT} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
