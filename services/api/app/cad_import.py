"""Read a user's own CAD drawing (ASCII DXF) into plain geometry the Studio can show, edit and build inside.

No dependencies. Handles LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND, CIRCLE, ARC, TEXT and MTEXT from the ENTITIES
section, in any ASCII DXF version. Everything is converted to metres using $INSUNITS; a unitless drawing is read as
metres and flagged `units_assumed` so the user can pick the right unit. Loose LINEs on the same layer are chained into
polylines, and chains that return to their start become closed shapes (walls drawn as separate lines are common).
Blocks (INSERT), hatches, dimensions, splines and 3D entities are counted and skipped with a warning.

The footprint guess is the largest closed shape, with its minimum-area rectangle (width, depth, angle), or the bounding
box of everything when nothing is closed. It is a guess and is labelled as one.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from typing import Any

# $INSUNITS code -> metres per drawing unit (AutoCAD DXF reference)
UNITS: dict[int, tuple[str, float]] = {
    1: ("inches", 0.0254), 2: ("feet", 0.3048), 3: ("miles", 1609.344), 4: ("millimetres", 0.001), 5: ("centimetres", 0.01),
    6: ("metres", 1.0), 7: ("kilometres", 1000.0), 8: ("microinches", 2.54e-8), 9: ("mils", 2.54e-5), 10: ("yards", 0.9144),
    14: ("decimetres", 0.1), 15: ("decametres", 10.0), 16: ("hectometres", 100.0), 21: ("US survey feet", 1200 / 3937),
}
UNIT_NAMES = {name: m for name, m in UNITS.values()}

MAX_ENTITIES = 60_000
MAX_POINTS = 400_000
ARC_STEPS = 24
JOIN_TOL = 1e-6  # in drawing units, relative tolerance is applied below


class DxfError(ValueError):
    pass


def _pairs(text: str) -> list[tuple[int, str]]:
    lines = text.splitlines()
    if len(lines) < 2:
        raise DxfError("This file is empty or is not a DXF drawing.")
    out: list[tuple[int, str]] = []
    for i in range(0, len(lines) - 1, 2):
        code = lines[i].strip()
        try:
            out.append((int(code), lines[i + 1].strip()))
        except ValueError as e:
            raise DxfError(f"Not a readable ASCII DXF (bad group code on line {i + 1}).") from e
    return out


def _f(v: str) -> float:
    try:
        return float(v)
    except ValueError:
        return 0.0


def _section(pairs: list[tuple[int, str]], name: str) -> list[tuple[int, str]]:
    """The pairs between `0 SECTION / 2 <name>` and the matching `0 ENDSEC`."""
    inside, out = False, []
    for i, (c, v) in enumerate(pairs):
        if not inside:
            if c == 0 and v == "SECTION" and i + 1 < len(pairs) and pairs[i + 1] == (2, name):
                inside = True
            continue
        if c == 0 and v == "ENDSEC":
            break
        out.append((c, v))
    return out[1:] if out and out[0] == (2, name) else out


def _header_units(pairs: list[tuple[int, str]]) -> int | None:
    head = _section(pairs, "HEADER")
    for i, (c, v) in enumerate(head):
        if c == 9 and v == "$INSUNITS":
            for c2, v2 in head[i + 1:i + 3]:
                if c2 == 70:
                    try:
                        return int(v2)
                    except ValueError:
                        return None
    return None


def _entities(pairs: list[tuple[int, str]]) -> list[tuple[str, list[tuple[int, str]]]]:
    ents = _section(pairs, "ENTITIES")
    out: list[tuple[str, list[tuple[int, str]]]] = []
    cur: tuple[str, list[tuple[int, str]]] | None = None
    for c, v in ents:
        if c == 0:
            if cur:
                out.append(cur)
            cur = (v, [])
            if len(out) > MAX_ENTITIES:
                raise DxfError(f"The drawing has more than {MAX_ENTITIES:,} entities; export only the plan you need.")
        elif cur:
            cur[1].append((c, v))
    if cur:
        out.append(cur)
    return out


def _get(g: list[tuple[int, str]], code: int, default: str = "") -> str:
    return next((v for c, v in g if c == code), default)


def _arc(cx: float, cy: float, r: float, a0: float, a1: float, closed: bool) -> list[list[float]]:
    if closed:
        return [[cx + r * math.cos(2 * math.pi * k / 32), cy + r * math.sin(2 * math.pi * k / 32)] for k in range(32)]
    if a1 < a0:
        a1 += 360.0
    n = max(2, int(ARC_STEPS * (a1 - a0) / 360.0) + 1)
    return [[cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / (n - 1))),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / (n - 1)))] for k in range(n)]


def _mtext(s: str) -> str:
    s = re.sub(r"\\[PpNn]", " ", s)
    s = re.sub(r"\\[A-Za-z][^;\\]*;", "", s)
    return re.sub(r"[{}]", "", s).replace("\\~", " ").strip()


def area(pts: list[list[float]]) -> float:
    n = len(pts)
    return abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2.0


def _hull(pts: list[list[float]]) -> list[tuple[float, float]]:
    p = sorted({(round(x, 6), round(y, 6)) for x, y in pts})
    if len(p) <= 2:
        return p

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0:
            hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]


def min_rect(pts: list[list[float]]) -> dict[str, Any]:
    """Minimum-area enclosing rectangle (rotating the hull edges). Width is the longer side; angle in degrees."""
    h = _hull(pts)
    if len(h) < 3:
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        return dict(cx=(min(xs) + max(xs)) / 2, cy=(min(ys) + max(ys)) / 2, w=max(xs) - min(xs), d=max(ys) - min(ys), angle_deg=0.0)
    best = None
    for i in range(len(h)):
        x0, y0 = h[i]
        x1, y1 = h[(i + 1) % len(h)]
        a = math.atan2(y1 - y0, x1 - x0)
        ca, sa = math.cos(-a), math.sin(-a)
        rx = [x * ca - y * sa for x, y in h]
        ry = [x * sa + y * ca for x, y in h]
        w, d = max(rx) - min(rx), max(ry) - min(ry)
        if best is None or w * d < best[0] - 1e-9:
            mx, my = (max(rx) + min(rx)) / 2, (max(ry) + min(ry)) / 2
            cb, sb = math.cos(a), math.sin(a)
            best = (w * d, w, d, a, mx * cb - my * sb, mx * sb + my * cb)
    _, w, d, a, cx, cy = best
    if d > w:  # report the long side as width
        w, d, a = d, w, a + math.pi / 2
    deg = (math.degrees(a) + 90) % 180 - 90
    if abs(deg) < 0.05:
        deg = 0.0
    return dict(cx=cx, cy=cy, w=w, d=d, angle_deg=round(deg, 2))


def _chain(segs: list[tuple[tuple[float, float], tuple[float, float]]], tol: float) -> list[tuple[list[list[float]], bool]]:
    """Join line segments that share endpoints into polylines; a chain that returns to its start is closed."""
    key = lambda p: (round(p[0] / tol), round(p[1] / tol))  # noqa: E731
    ends: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (a, b) in enumerate(segs):
        ends[key(a)].append(i)
        ends[key(b)].append(i)
    used = [False] * len(segs)
    out = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        pts = [list(segs[i][0]), list(segs[i][1])]
        for grow_front in (False, True):
            while True:
                tip = pts[0] if grow_front else pts[-1]
                nxt = next((j for j in ends[key(tip)] if not used[j]), None)
                if nxt is None:
                    break
                used[nxt] = True
                a, b = segs[nxt]
                other = list(b) if key(a) == key(tip) else list(a)
                if grow_front:
                    pts.insert(0, other)
                else:
                    pts.append(other)
        closed = len(pts) > 3 and key(pts[0]) == key(pts[-1])
        out.append((pts[:-1] if closed else pts, closed))
    return out


def parse_dxf(text: str, units: str | None = None) -> dict[str, Any]:
    """Parse ASCII DXF text. `units` (e.g. 'millimetres') overrides the header, for drawings saved without units."""
    if text.startswith("AutoCAD Binary DXF"):
        raise DxfError("This is a binary DXF. Save it as ASCII DXF and import again.")
    if text[:6] in ("AC1015", "AC1018", "AC1021", "AC1024", "AC1027", "AC1032") or text.startswith("AC10"):
        raise DxfError("This looks like a DWG file. Export it as DXF (ASCII) from your CAD tool and import that.")
    pairs = _pairs(text)
    code = _header_units(pairs)
    warnings: list[str] = []
    if units:
        if units not in UNIT_NAMES:
            raise DxfError(f"Unknown unit '{units}'. Use one of: {', '.join(UNIT_NAMES)}.")
        unit_name, scale, assumed = units, UNIT_NAMES[units], False
    elif code in UNITS:
        unit_name, scale = UNITS[code]
        assumed = False
    else:
        unit_name, scale, assumed = "metres", 1.0, True
        warnings.append("The drawing does not say which unit it uses, so it was read as metres. Pick the right unit if the sizes look wrong.")

    polys: list[dict[str, Any]] = []
    texts: list[dict[str, Any]] = []
    loose: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = defaultdict(list)
    skipped: Counter[str] = Counter()
    counts: Counter[str] = Counter()
    ents = _entities(pairs)
    i = 0
    npts = 0
    bulges = False
    while i < len(ents):
        kind, g = ents[i]
        layer = _get(g, 8, "0")
        if kind == "LINE":
            loose[layer].append(((_f(_get(g, 10)), _f(_get(g, 20))), (_f(_get(g, 11)), _f(_get(g, 21)))))
        elif kind == "LWPOLYLINE":
            xs = [_f(v) for c, v in g if c == 10]
            ys = [_f(v) for c, v in g if c == 20]
            bulges |= any(c == 42 and _f(v) != 0 for c, v in g)
            closed = bool(int(_f(_get(g, 70, "0"))) & 1)
            polys.append(dict(layer=layer, points=[[x, y] for x, y in zip(xs, ys)], closed=closed))
        elif kind == "POLYLINE":
            closed = bool(int(_f(_get(g, 70, "0"))) & 1)
            flags = int(_f(_get(g, 70, "0")))
            pts = []
            i += 1
            while i < len(ents) and ents[i][0] == "VERTEX":
                vg = ents[i][1]
                bulges |= any(c == 42 and _f(v) != 0 for c, v in vg)
                pts.append([_f(_get(vg, 10)), _f(_get(vg, 20))])
                i += 1
            if flags & (16 | 64):  # polygon mesh / polyface mesh: 3D, not a plan outline
                skipped["POLYLINE mesh"] += 1
            else:
                polys.append(dict(layer=layer, points=pts, closed=closed))
            if i < len(ents) and ents[i][0] == "SEQEND":
                pass
            else:
                i -= 1
        elif kind in ("CIRCLE", "ARC"):
            cx, cy, r = _f(_get(g, 10)), _f(_get(g, 20)), _f(_get(g, 40))
            if kind == "CIRCLE":
                polys.append(dict(layer=layer, points=_arc(cx, cy, r, 0, 360, True), closed=True))
            else:
                polys.append(dict(layer=layer, points=_arc(cx, cy, r, _f(_get(g, 50)), _f(_get(g, 51)), False), closed=False))
        elif kind in ("TEXT", "MTEXT"):
            raw = _get(g, 1) if kind == "TEXT" else "".join(v for c, v in g if c in (3, 1))
            t = _mtext(raw) if kind == "MTEXT" else raw.strip()
            if t:
                texts.append(dict(layer=layer, x=_f(_get(g, 10)), y=_f(_get(g, 20)), h=_f(_get(g, 40, "1")), text=t[:200]))
        elif kind in ("SEQEND", "VERTEX"):
            pass
        else:
            skipped[kind] += 1
        counts[kind] += 1
        i += 1

    tol = 1e-6 + 1e-9
    allpts = [p for pl in polys for p in pl["points"]] + [list(p) for segs in loose.values() for s in segs for p in s]
    if allpts:
        span = max(max(p[0] for p in allpts) - min(p[0] for p in allpts), max(p[1] for p in allpts) - min(p[1] for p in allpts))
        tol = max(tol, span * 1e-6)
    for layer, segs in loose.items():
        for pts, closed in _chain(segs, tol):
            polys.append(dict(layer=layer, points=pts, closed=closed, from_lines=True))

    # scale to metres, drop degenerate shapes, number them
    out_polys = []
    for k, pl in enumerate(polys):
        pts = [[round(x * scale, 4), round(y * scale, 4)] for x, y in pl["points"]]
        if len(pts) < 2:
            continue
        npts += len(pts)
        if npts > MAX_POINTS:
            raise DxfError(f"The drawing has more than {MAX_POINTS:,} points; export only the plan you need.")
        closed = pl["closed"] and len(pts) >= 3
        out_polys.append(dict(id=f"s{k + 1}", layer=pl["layer"], points=pts, closed=closed,
                              area_m2=round(area(pts), 2) if closed else None, from_lines=pl.get("from_lines", False)))
    for t in texts:
        t["x"], t["y"], t["h"] = round(t["x"] * scale, 4), round(t["y"] * scale, 4), round(t["h"] * scale, 4)

    if not out_polys:
        raise DxfError("No plan geometry found (lines, polylines, circles or arcs) in the ENTITIES section.")
    if bulges:
        warnings.append("Some polylines have curved segments; they were drawn as straight lines.")
    if skipped:
        warnings.append("Skipped: " + ", ".join(f"{n} {k}" for k, n in skipped.most_common()) +
                        (". Blocks (INSERT) are not expanded; explode them in your CAD tool to import their contents." if skipped.get("INSERT") else "."))

    xs = [p[0] for pl in out_polys for p in pl["points"]]
    ys = [p[1] for pl in out_polys for p in pl["points"]]
    bbox = dict(x=min(xs), y=min(ys), w=max(xs) - min(xs), d=max(ys) - min(ys))
    closed = [pl for pl in out_polys if pl["closed"] and (pl["area_m2"] or 0) > 0]
    if closed:
        big = max(closed, key=lambda pl: pl["area_m2"])
        r = min_rect(big["points"])
        footprint = dict(source="largest closed shape", shape_id=big["id"], layer=big["layer"], area_m2=big["area_m2"], **_round(r))
    else:
        footprint = dict(source="bounding box of all geometry", shape_id=None, layer=None, area_m2=round(bbox["w"] * bbox["d"], 2),
                         cx=bbox["x"] + bbox["w"] / 2, cy=bbox["y"] + bbox["d"] / 2, w=bbox["w"], d=bbox["d"], angle_deg=0.0)
        warnings.append("No closed outline found, so the footprint is the bounding box of the whole drawing.")
    layers = Counter(pl["layer"] for pl in out_polys)
    return dict(kind="dxf", label="Your drawing", units=unit_name, units_assumed=assumed, scale_to_m=scale,
                layers=[dict(name=k, shapes=n) for k, n in sorted(layers.items())],
                polygons=out_polys, texts=texts, bbox=_round(bbox), footprint=footprint, warnings=warnings,
                entity_counts=dict(counts), footprint_label="Estimated")


def _round(d: dict[str, Any]) -> dict[str, Any]:
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items()}
