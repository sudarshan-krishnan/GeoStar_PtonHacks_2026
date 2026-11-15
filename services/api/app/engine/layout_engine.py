"""Studio layout engine: one design brief -> three distinct conceptual layouts, each measured and scored.

Deterministic geometry only. No model is involved: rack counts, room sizes, routes, cost, noise, carbon and
water are all computed here from the brief and from the planning assumptions below. Every assumption is
registered in the shared assumption sheet (GET /assumptions) with its basis, and can be overridden per request.

Coordinates are metres, x east, y north, origin at the south-west corner of the site rectangle.
This is early-stage planning evidence. It is not engineering design and certifies nothing.
"""
from __future__ import annotations

import copy
import math
import random
from typing import Any

from app.engine import assumptions as A
from app.engine.assumptions import Assumption

_T = "Team planning assumption"
STUDIO_ASSUMPTIONS = [
    Assumption("rack_width_m", 0.6, "m", f"{_T}: standard 600 mm rack."),
    Assumption("rack_depth_m", 1.2, "m", f"{_T}: 1200 mm deep rack."),
    Assumption("row_pitch_m", 2.4, "m", f"{_T}: one rack depth plus one 1.2 m aisle per row."),
    Assumption("hall_clearance_m", 1.8, "m", f"{_T}: clear perimeter inside a data hall."),
    Assumption("corridor_width_m", 4.0, "m", f"{_T}: service spine wide enough to move equipment."),
    Assumption("ups_m2_per_mw", 22.0, "m2 / MW IT / string", f"{_T} for UPS room area.", verify=True),
    Assumption("battery_m2_per_mw", 14.0, "m2 / MW IT / string", f"{_T} for battery room area.", verify=True),
    Assumption("switchgear_m2_per_mw", 12.0, "m2 / MW IT", f"{_T} for switchgear room area.", verify=True),
    Assumption("mech_m2_per_mw_air", 45.0, "m2 / MW IT", f"{_T}: air handler galleries.", verify=True),
    Assumption("mech_m2_per_mw_hybrid", 36.0, "m2 / MW IT", f"{_T}.", verify=True),
    Assumption("mech_m2_per_mw_water", 32.0, "m2 / MW IT", f"{_T}.", verify=True),
    Assumption("mech_m2_per_mw_liquid", 28.0, "m2 / MW IT", f"{_T}: coolant distribution and pump rooms.", verify=True),
    Assumption("pue_liquid", 1.15, "ratio", f"{_T} for direct liquid cooling with dry coolers.", verify=True),
    Assumption("wue_liquid", 0.05, "L / kWh IT", f"{_T} for closed-loop liquid cooling.", verify=True),
    Assumption("cooling_capex_liquid", 2_400_000, "USD / MW IT", f"{_T}.", verify=True),
    Assumption("genset_mw", 2.5, "MW", f"{_T}: one standby generator."),
    Assumption("cooling_yard_m2_per_mw", 15.0, "m2 / MW IT", f"{_T} for outdoor heat rejection.", verify=True),
    Assumption("equipment_share_of_capex", 0.75, "share",
               f"{_T}: share of the per-MW build cost that is electrical and mechanical equipment.", verify=True),
    Assumption("shell_cost_per_m2", 3000.0, "USD / m2", f"{_T} for the building shell.", verify=True),
    Assumption("busway_cost_per_m", 3500.0, "USD / m", f"{_T} for installed electrical distribution.", verify=True),
    Assumption("pipe_cost_per_m", 2200.0, "USD / m", f"{_T} for installed cooling pipework.", verify=True),
    Assumption("redundancy_cost_n", 0.92, "x", f"{_T}: equipment cost factor at N."),
    Assumption("redundancy_cost_n1", 1.0, "x", f"{_T}: equipment cost factor at N+1."),
    Assumption("redundancy_cost_2n", 1.18, "x", f"{_T}: equipment cost factor at 2N.", verify=True),
    Assumption("genset_dba_at_7m", 75.0, "dBA", f"{_T}: one enclosed generator at 7 m.", verify=True),
    Assumption("noise_limit_dba", 55.0, "dBA", f"{_T}: daytime residential guideline used as the comparison line.",
               verify=True),
    Assumption("embodied_kgco2_per_m2", 500.0, "kg CO2e / m2", f"{_T} for shell and structure.", verify=True),
    Assumption("roof_solar_usable_share", 0.6, "share", f"{_T}: roof area free of plant."),
    Assumption("roof_solar_kw_per_m2", 0.18, "kWp / m2", f"{_T}."),
    Assumption("solar_kwh_per_kwp", 1400.0, "kWh / kWp / yr", f"{_T}; use the local-conditions PVWatts figure when known.",
               verify=True),
    Assumption("bess_mwh_per_m2", 0.1, "MWh / m2", f"{_T}: containerised battery storage with access aisles.", verify=True),
    Assumption("bess_cost_per_mwh", 350_000, "USD / MWh", f"{_T} for installed battery storage.", verify=True),
    Assumption("solar_cost_per_kwp", 1400.0, "USD / kWp", f"{_T} for an installed solar canopy.", verify=True),
    Assumption("multistorey_cost_premium", 0.12, "share per extra storey", f"{_T}: heavier structure, lifts and risers.", verify=True),
    Assumption("tank_cost_per_m2", 1800.0, "USD / m2", f"{_T} for an added water tank.", verify=True),
    Assumption("paving_cost_per_m2", 120.0, "USD / m2", f"{_T} for parking and hardstand.", verify=True),
    Assumption("landscape_cost_per_m2", 60.0, "USD / m2", f"{_T} for a planted tree buffer.", verify=True),
    Assumption("gatehouse_cost_per_m2", 2500.0, "USD / m2", f"{_T} for a gatehouse.", verify=True),
    Assumption("noise_wall_cost_per_m", 1500.0, "USD / m", f"{_T} for a 6 m acoustic wall.", verify=True),
    Assumption("noise_wall_loss_dba", 8.0, "dBA", f"{_T}: reduction counted when a noise wall stands within 20 m of the "
               "generator yard. A real figure needs an acoustic study.", verify=True),
    Assumption("construction_months", 18.0, "months", f"{_T}: design and build to first hall."),
    Assumption("interconnect_base_months", 12.0, "months", "Team scenario: study and build of a grid connection next to a "
               "substation; the utility sets the real date.", label="Simulated", verify=True),
    Assumption("interconnect_months_per_km", 4.0, "months / km", "Team scenario: extra time per km of new line.",
               label="Simulated", verify=True),
    Assumption("occupancy_first_year", 0.5, "share", f"{_T}: leased share in the first year of operation."),
    Assumption("occupancy_stabilized", 0.9, "share", f"{_T}: leased share after the first year."),
    Assumption("analysis_years", 15.0, "years", f"{_T}: horizon for net present value; no terminal value is added."),
    Assumption("carbon_price_per_t", 50.0, "USD / t CO2", f"{_T}: weight given to carbon when choosing which hours "
               "flexible work runs in. It is not a cost charged to the project."),
    Assumption("max_site_coverage", 0.6, "share", f"{_T}: building plus yard may cover at most this share of the site."),
]
for _a in STUDIO_ASSUMPTIONS:
    A.ASSUMPTIONS.setdefault(_a.key, _a)

COOLING = ("air", "hybrid", "water", "liquid")
REDUNDANCY = ("N", "N+1", "2N")
STRINGS = {"N": 1.0, "N+1": 1.5, "2N": 2.0}
RED_COST = {"N": "redundancy_cost_n", "N+1": "redundancy_cost_n1", "2N": "redundancy_cost_2n"}
FLOOR_H = 6.0
# outdoor items a user may add in the studio: display name and height
ADDED = {"yard_bess": ("Battery storage", 3.0), "yard_solar": ("Solar canopy", 4.5), "yard_water": ("Water storage", 8.0),
         "yard_parking": ("Parking", 0.1), "yard_wall": ("Noise wall", 6.0), "yard_trees": ("Tree buffer", 7.0),
         "yard_guard": ("Gatehouse", 3.5)}
SHARED = {"LD-01", "NOC-01", "OF-01", "MMR-A", "MMR-B", "SEC-01"}
# ranges sampled for the NPV spread (low, high around 1.0; delay in months). Team scenario values, labeled Simulated.
UNCERTAINTY = {"build_cost": (0.9, 1.25), "revenue": (0.8, 1.15), "energy_price": (0.7, 1.8), "delay_months": (0.0, 18.0)}


def default_halls(mw: float) -> int:
    return int(min(12, max(1, round(mw / 5.0))))


def _split(x: float, y: float, w: float, d: float, parts: list[tuple[str, str, str, float]], axis: str) -> list[dict]:
    """Fill a rectangle with rooms whose sizes are proportional to their required areas."""
    total = sum(p[3] for p in parts) or 1.0
    out, cur = [], 0.0
    for code, name, typ, area in parts:
        share = area / total
        if axis == "x":
            out.append(dict(code=code, name=name, type=typ, x=x + cur, y=y, w=w * share, d=d, need_m2=area))
            cur += w * share
        else:
            out.append(dict(code=code, name=name, type=typ, x=x, y=y + cur, w=w, d=d * share, need_m2=area))
            cur += d * share
    return out


class _Ctx:
    """Everything derived from the brief that every concept shares."""

    def __init__(self, b: dict[str, Any], ov: dict[str, float]):
        v = lambda k: A.value(k, ov)  # noqa: E731
        self.v = v
        self.mw = float(b["mw_it"])
        self.rack_kw = float(b["rack_kw"])
        self.cooling = b["cooling"]
        self.red = b["redundancy"]
        self.halls = int(b.get("halls") or default_halls(self.mw))
        self.racks = int(math.ceil(self.mw * 1000.0 / self.rack_kw))
        self.per_hall = [self.racks // self.halls + (1 if i < self.racks % self.halls else 0) for i in range(self.halls)]
        self.hall_mw = self.mw / self.halls
        self.total_halls, self.all_halls, self.max_racks, self.offset = self.halls, list(self.per_hall), max(self.per_hall), 0
        self.levels = max(1, min(int(b.get("storeys") or 1), 3, self.halls))
        self.halls = math.ceil(self.total_halls / self.levels)  # hall bays on one storey
        self.per_hall = self.all_halls[:self.halls]
        self.rw, self.rd, self.pitch, self.clr, self.spine = (v("rack_width_m"), v("rack_depth_m"), v("row_pitch_m"),
                                                              v("hall_clearance_m"), v("corridor_width_m"))
        s = STRINGS[self.red]
        self.elec_parts = [("UPS-A", "UPS A", "electrical", v("ups_m2_per_mw") * self.hall_mw)]
        if s > 1:
            self.elec_parts.append(("UPS-B", "UPS B", "electrical", v("ups_m2_per_mw") * self.hall_mw * (s - 1)))
        self.elec_parts += [("BAT", "Battery", "battery", v("battery_m2_per_mw") * self.hall_mw * s),
                            ("SWG", "Switchgear", "electrical", v("switchgear_m2_per_mw") * self.hall_mw)]
        self.elec_area = sum(p[3] for p in self.elec_parts)
        self.mech_area = v(f"mech_m2_per_mw_{self.cooling}") * self.hall_mw
        self.shared_parts = [("LD-01", "Loading / staging", "loading", 200 + 6 * self.mw),
                             ("NOC-01", "NOC / control", "support", 120.0),
                             ("OF-01", "Office / welfare", "support", 260.0),
                             ("MMR-A", "Meet-me room A", "network", 70.0),
                             ("MMR-B", "Meet-me room B", "network", 70.0),
                             ("SEC-01", "Security", "support", 60.0)]
        self.shared_area = sum(p[3] for p in self.shared_parts)
        self.pue = v(f"pue_{self.cooling}")
        self.fac_mw = self.mw * self.pue
        n = math.ceil(self.fac_mw / v("genset_mw"))
        self.gens = n if self.red == "N" else n + 1 if self.red == "N+1" else 2 * n
        self.gens_needed = n

    def level(self, lvl: int) -> "_Ctx":
        """Context for one storey: its share of the halls, padded with empty bays so every storey has the same plan."""
        k = copy.copy(self)
        mine = self.all_halls[lvl * self.halls:(lvl + 1) * self.halls]
        k.per_hall, k.offset = mine + [0] * (self.halls - len(mine)), lvl * self.halls
        return k

    def hall(self, length: float) -> tuple[int, int, float] | None:
        rpr = int((length - 2 * self.clr) // self.rw)
        if rpr < 8:
            return None
        rows = math.ceil(self.max_racks / rpr)
        return rpr, rows, rows * self.pitch + 2 * self.clr

    def hall_room(self, i: int, x: float, y: float, w: float, d: float, rpr: int, rows: int) -> dict:
        placed, rws = self.per_hall[i], []  # i is the bay on this storey
        left = placed
        for j in range(rows):
            n = min(rpr, left)
            left -= n
            rws.append(dict(x=x + self.clr, y=y + self.clr + j * self.pitch, w=rpr * self.rw, d=self.rd, n=n, cap=rpr))
        i += self.offset
        return dict(code=f"DH-{i + 1:02d}", name=f"Data hall {i + 1}", type="data_hall", x=x, y=y, w=w, d=d,
                    racks=placed, positions=rows * rpr, mw=round(placed * self.rack_kw / 1000.0, 2), rows=rws)

    def tag(self, rooms: list[dict], i: int) -> list[dict]:
        for r in rooms:
            r["code"], r["hall"] = f"{r['code']}-{i + 1 + self.offset}", i + 1 + self.offset
        return rooms


def _long_halls(c: _Ctx, length: float) -> dict | None:
    """Halls stacked north-south, one service spine down the west side, technical rooms west of the spine."""
    h = c.hall(length)
    if not h:
        return None
    rpr, rows, dh = h
    if not 1.0 <= length / dh <= 7.0:
        return None
    tw, mc = max(8.0, c.elec_area / dh), max(6.0, c.mech_area / dh)
    w = tw + c.spine + length + mc
    sb = max(10.0, c.shared_area / w)
    rooms = _split(0, 0, w, sb, c.shared_parts, "x")
    for i in range(c.halls):
        y = sb + i * dh
        rooms += c.tag(_split(0, y, tw, dh, c.elec_parts, "y"), i)
        rooms.append(c.hall_room(i, tw + c.spine, y, length, dh, rpr, rows))
        rooms.append(dict(code=f"ME-{i + 1 + c.offset}", name="Mechanical plant", type="mechanical", x=tw + c.spine + length, y=y,
                          w=mc, d=dh, need_m2=c.mech_area, hall=i + 1 + c.offset))
    rooms.append(dict(code="SP-01", name="Service spine", type="corridor", x=tw, y=sb, w=c.spine, d=c.halls * dh))
    return dict(w=w, d=sb + c.halls * dh, rooms=rooms)


def _service_bands(c: _Ctx, length: float) -> dict | None:
    """Halls side by side; one shared electrical band to the north and one mechanical band to the south."""
    h = c.hall(length)
    if not h:
        return None
    rpr, rows, dh = h
    if not 0.45 <= length / dh <= 3.0:
        return None
    eb, mb = max(8.0, c.elec_area / length), max(6.0, c.mech_area / length)
    d = mb + c.spine + dh + c.spine + eb
    sw = max(10.0, c.shared_area / d)
    hw = c.halls * length
    rooms = _split(hw, 0, sw, d, c.shared_parts, "y")
    for i in range(c.halls):
        x = i * length
        rooms.append(dict(code=f"ME-{i + 1 + c.offset}", name="Mechanical plant", type="mechanical", x=x, y=0, w=length, d=mb,
                          need_m2=c.mech_area, hall=i + 1 + c.offset))
        rooms.append(c.hall_room(i, x, mb + c.spine, length, dh, rpr, rows))
        rooms += c.tag(_split(x, mb + 2 * c.spine + dh, length, eb, c.elec_parts, "x"), i)
    rooms.append(dict(code="SP-01", name="Mechanical corridor", type="corridor", x=0, y=mb, w=hw, d=c.spine))
    rooms.append(dict(code="SP-02", name="Electrical corridor", type="corridor", x=0, y=mb + c.spine + dh, w=hw, d=c.spine))
    return dict(w=hw + sw, d=d, rooms=rooms)


def _opposed_banks(c: _Ctx, length: float) -> dict | None:
    """Two banks of halls facing a central cross spine; technical rooms on the outer north and south edges."""
    h = c.hall(length)
    if not h:
        return None
    rpr, rows, dh = h
    if not 0.45 <= length / dh <= 4.0:
        return None
    nt = math.ceil(c.halls / 2)
    nb = c.halls - nt
    cs = c.spine + 1.0
    tb = max(8.0, (c.elec_area + c.mech_area) / length)
    mech = [("ME", "Mechanical plant", "mechanical", c.mech_area)]
    south = (tb + dh) if nb else 0.0
    d = south + cs + dh + tb
    sw = max(10.0, c.shared_area / d)
    hw = nt * length
    rooms = _split(hw, 0, sw, d, c.shared_parts, "y")
    for k in range(nt):  # north bank
        x = k * length
        rooms.append(c.hall_room(k, x, south + cs, length, dh, rpr, rows))
        rooms += c.tag(_split(x, south + cs + dh, length, tb, c.elec_parts + mech, "x"), k)
    for k in range(nt):  # south bank; an empty slot is kept as an expansion bay
        x = k * length
        if k < nb:
            i = nt + k
            rooms += c.tag(_split(x, 0, length, tb, c.elec_parts + mech, "x"), i)
            rooms.append(c.hall_room(i, x, tb, length, dh, rpr, rows))
        elif nb:
            rooms.append(dict(code=f"EX-{k + 1}", name="Expansion bay", type="reserve", x=x, y=0, w=length, d=south,
                              positions=rows * rpr))
    rooms.append(dict(code="SP-01", name="Central spine", type="corridor", x=0, y=south, w=hw, d=cs))
    return dict(w=hw + sw, d=d, rooms=rooms)


CONCEPTS = [
    ("long-halls", "Long halls, side spine", _long_halls,
     "Long halls stacked north to south; one service spine on the west; technical rooms beside each hall."),
    ("service-bands", "Shared service bands", _service_bands,
     "Short halls side by side; one shared electrical band to the north and a mechanical band to the south."),
    ("opposed-banks", "Opposed hall banks", _opposed_banks,
     "Two banks of halls facing a central spine; technical rooms on the outer edges; spare bay kept for growth."),
]


def _best(c: _Ctx, fn, env_w: float, env_d: float) -> tuple[dict, bool]:
    fit, over = None, None
    length = 14.4
    while length <= max(env_w, env_d) + 0.01:
        g = fn(c, length)
        if g:
            g["length"] = length
            area = g["w"] * g["d"]
            if g["w"] <= env_w + 1e-6 and g["d"] <= env_d + 1e-6:
                if fit is None or area < fit[0]:
                    fit = (area, g)
            else:
                ratio = max(g["w"] / env_w, g["d"] / env_d)
                if over is None or ratio < over[0]:
                    over = (ratio, g)
        length += c.rw * 2
    if fit:
        return fit[1], True
    if over:
        return over[1], False
    raise ValueError("The brief cannot be laid out: reduce capacity or raise rack density.")


def _yard(c: _Ctx, hmax: float) -> dict:
    """Outdoor plant east of the building: substation, standby generators, heat rejection, water storage."""
    v = c.v
    items: list[dict] = []
    sub_area = max(1200.0, 25.0 * c.fac_mw)
    items.append(dict(code="SUB-01", name="Substation", type="yard_sub", w=40.0, d=sub_area / 40.0, h=5.0))
    per_col = max(1, min(8, int(hmax // 13)))
    cols = math.ceil(c.gens / per_col)
    items.append(dict(code="GEN", name="Generator yard", type="yard_gen", w=cols * 6.0, d=min(c.gens, per_col) * 13.0,
                      h=0.3, per_col=per_col))
    cool_area = v("cooling_yard_m2_per_mw") * c.mw
    items.append(dict(code="CY-01", name="Heat rejection yard", type="yard_cool", w=30.0, d=cool_area / 30.0, h=4.0))
    if c.cooling in ("water", "hybrid"):
        items.append(dict(code="WT-01", name="Water storage", type="yard_water", w=14.0, d=14.0, h=8.0))
    x = y = colw = 0.0
    for it in items:
        if it["d"] > hmax:  # too tall for the yard strip: make it wider instead
            it["w"], it["d"] = it["w"] * it["d"] / hmax, hmax
        if y > 0 and y + it["d"] > hmax:
            x, y, colw = x + colw + 4.0, 0.0, 0.0
        it["x"], it["y"] = x, y
        y += it["d"] + 4.0
        colw = max(colw, it["w"])
    return dict(items=items, w=x + colw)


def _c(r: dict) -> tuple[float, float]:
    return r["x"] + r["w"] / 2, r["y"] + r["d"] / 2


def _route(a: tuple[float, float], b: tuple[float, float]) -> tuple[list[list[float]], float]:
    pts = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]]]
    return pts, abs(a[0] - b[0]) + abs(a[1] - b[1])


def _flex_day(price: list[float], carbon: list[float], share: float, mult: float, cprice: float) -> tuple[float, ...]:
    """One day. Flexible work runs in the hours with the lowest price plus carbon cost, so it cannot trade a small
    saving for a large rise in emissions. Returns (flat price, flexed price, flat carbon, flexed carbon)."""
    n = len(price)
    p_flat, c_flat = sum(price) / n, sum(carbon) / n
    if share <= 0:
        return p_flat, p_flat, c_flat, c_flat
    k = max(1, math.ceil(n / max(mult, 1.0)))
    idx = sorted(range(n), key=lambda i: price[i] + cprice * carbon[i] / 1000.0)[:k]
    return (p_flat, (1 - share) * p_flat + share * sum(price[i] for i in idx) / k,
            c_flat, (1 - share) * c_flat + share * sum(carbon[i] for i in idx) / k)


def _gate(site: dict, name: str) -> dict | None:
    return next((g for g in (site.get("gates") or []) if g.get("gate") == name), None)


def _gap(a: dict, b: dict) -> float:
    """Shortest distance between two rectangles (0 when they touch or overlap)."""
    dx = max(a["x"] - (b["x"] + b["w"]), b["x"] - (a["x"] + a["w"]), 0.0)
    dy = max(a["y"] - (b["y"] + b["d"]), b["y"] - (a["y"] + a["d"]), 0.0)
    return math.hypot(dx, dy)


def _storeys(c: _Ctx, fn, length: float, rotate: bool) -> list[dict]:
    """The same plan on every storey. Upper storeys keep the hall bays; their shared rooms become riser and storage space."""
    rooms: list[dict] = []
    for lvl in range(c.levels):
        lr = fn(c.level(lvl), length)["rooms"]
        if lvl:
            sh = [r for r in lr if r["code"] in SHARED]
            x0, y0 = min(r["x"] for r in sh), min(r["y"] for r in sh)
            x1, y1 = max(r["x"] + r["w"] for r in sh), max(r["y"] + r["d"] for r in sh)
            lr = [r for r in lr if r["code"] not in SHARED]
            for r in lr:
                if r.get("hall") is None and r["type"] != "data_hall":
                    r["code"] += f"-L{lvl + 1}"
            lr.append(dict(code=f"RS-L{lvl + 1}", name="Risers and storage", type="support", x=x0, y=y0, w=x1 - x0, d=y1 - y0))
        empty = {int(r["code"][-2:]) for r in lr if r["type"] == "data_hall" and not r["racks"]}
        for r in lr:
            r["level"] = lvl
            if r["type"] == "data_hall" and not r["racks"]:  # a bay with no racks yet is room to grow
                r.update(type="reserve", name="Expansion hall", code=f"EX-H{r['code'][-2:]}", rows=[])
                r.pop("mw", None)
                r.pop("racks", None)
            elif r.get("hall") in empty:
                r.update(type="reserve", name="Reserved plant space")
                r.pop("hall", None)
        rooms += lr
    if rotate:
        for r in rooms:
            r["x"], r["y"], r["w"], r["d"] = r["y"], r["x"], r["d"], r["w"]
            for w in r.get("rows", []):
                w["x"], w["y"], w["w"], w["d"], w["v"] = w["y"], w["x"], w["d"], w["w"], True
    return rooms


def _npv(v, mw: float, capex: float, land: float, energy: float, opex: float, water: float, months: float,
         capex_x: float = 1.0, rev_x: float = 1.0, energy_x: float = 1.0) -> tuple[float, float | None]:
    """Yearly cash flows for the analysis horizon -> (net present value, simple payback in years or None)."""
    rate, years = v("discount_rate"), int(v("analysis_years"))
    occ1, occ = v("occupancy_first_year"), v("occupancy_stabilized")
    rev = mw * v("revenue_per_mw_year") * rev_x
    flows = [-(capex * capex_x + land)]
    for t in range(1, years + 1):
        on = min(1.0, max(0.0, (12 * t - months) / 12))  # share of the year in operation
        first = max(0.0, min(12 * t, months + 12) - max(12 * (t - 1), months)) / 12  # share that is first-year lease-up
        load = first * occ1 + (on - first) * occ
        flows.append(rev * load - (energy * energy_x + water) * load / occ - opex * on)
    npv = sum(f / (1 + rate) ** t for t, f in enumerate(flows))
    cum, payback = 0.0, None
    for t, f in enumerate(flows):
        if payback is None and t and cum < 0 <= cum + f:
            payback = t - 1 + (-cum) / f
        cum += f
    return npv, payback


def generate(brief: dict[str, Any], site: dict[str, Any], grid: dict[str, Any], priorities: dict[str, float],
             overrides: dict[str, float] | None = None, edits: dict[str, Any] | None = None) -> dict[str, Any]:
    """`edits` holds the user's changes per concept id:
    {"building": {dx, dy}, "rotate": bool, "yard": {code: {x, y}}, "added": [{code, type, x, y, w, d}]}.
    Edited geometry is measured and checked exactly like generated geometry."""
    ov = dict(overrides or {})
    if brief.get("rent_kw_month"):
        ov["revenue_per_mw_year"] = float(brief["rent_kw_month"]) * 12_000.0
    c = _Ctx(brief, ov)
    v = c.v
    site_w, site_d, setback = float(brief["site_w"]), float(brief["site_d"]), float(brief.get("setback_m", 8.0))
    reserve = float(brief.get("expansion_pct", 10.0)) / 100.0
    usable_w, usable_d = site_w - 2 * setback, site_d - 2 * setback
    if usable_w < 40 or usable_d < 40:
        raise ValueError("The site is too small once setbacks are applied.")
    yard0 = _yard(c, usable_d)
    gap = 6.0
    env_w = float(brief.get("env_w") or max(30.0, usable_w - yard0["w"] - gap))
    env_d = float(brief.get("env_d") or usable_d)

    # operation: every sourced price day, the latest carbon shape for each
    flex, mult, cprice = float(brief.get("flexible_share", 0.0)), v("flex_rate_multiple"), v("carbon_price_per_t")
    days = grid.get("days") or [{"date": grid.get("price_date"), "prices": grid["price"]}]
    per_day = [_flex_day(d["prices"], grid["carbon"], flex, mult, cprice) for d in days]
    p_flat, p_flex, c_flat, c_flex = (sum(x[i] for x in per_day) / len(per_day) for i in range(4))
    it_mwh = c.mw * v("it_load_factor") * 8760.0
    fac_mwh = it_mwh * c.pue
    water_m3 = it_mwh * 1000.0 * v(f"wue_{c.cooling}") / 1000.0
    water_cost = water_m3 * 264.172 / 1000.0 * v("water_price_per_kgal")

    homes, gridg = _gate(site, "Residential proximity"), _gate(site, "Grid proximity")
    home_m = float(homes["value"]) if homes and isinstance(homes.get("value"), (int, float)) else None
    sub_km = float(gridg["value"]) if gridg and isinstance(gridg.get("value"), (int, float)) else None
    km = sub_km if sub_km is not None else v("default_substation_km")
    interconnect = km * v("interconnect_cost_per_km")
    land = float(site.get("land_cost") or 0.0)
    months = max(v("construction_months"), v("interconnect_base_months") + v("interconnect_months_per_km") * km)

    out = []
    for cid, name, fn, strategy in CONCEPTS:
        ed = (edits or {}).get(cid) or {}
        rotate = bool(ed.get("rotate"))
        g, fits = _best(c, fn, env_d if rotate else env_w, env_w if rotate else env_d)
        bw, bd = (g["d"], g["w"]) if rotate else (g["w"], g["d"])
        rooms = _storeys(c, fn, g["length"], rotate)
        yard = _yard(c, max(usable_d, 40.0))
        total_w = bw + gap + yard["w"]
        ox, oy = (site_w - total_w) / 2, (site_d - bd) / 2
        yx, yy = ox + bw + gap, (site_d - min(usable_d, max(i["y"] + i["d"] for i in yard["items"]))) / 2
        ox, oy = ox + float((ed.get("building") or {}).get("dx", 0)), oy + float((ed.get("building") or {}).get("dy", 0))
        for r in rooms:
            r["x"], r["y"] = r["x"] + ox, r["y"] + oy
            r["h"], r["z"] = (0.15 if r["type"] == "corridor" else FLOOR_H), r["level"] * FLOOR_H
            for rw in r.get("rows", []):
                rw["x"], rw["y"] = rw["x"] + ox, rw["y"] + oy
        equipment = []
        moved = ed.get("yard") or {}
        for it in yard["items"]:
            it["x"], it["y"] = it["x"] + yx, it["y"] + yy
            if it["code"] in moved:
                it["x"], it["y"] = float(moved[it["code"]]["x"]), float(moved[it["code"]]["y"])
            if it["type"] == "yard_gen":
                for k in range(c.gens):
                    equipment.append(dict(code=f"G-{k + 1:02d}", type="generator", x=it["x"] + (k // it["per_col"]) * 6.0 + 1.5,
                                          y=it["y"] + (k % it["per_col"]) * 13.0 + 0.5, w=3.0, d=12.0, h=3.5))
        yard_items = yard["items"] + [
            dict(code=a["code"], name=ADDED[a["type"]][0], type=a["type"], x=float(a["x"]), y=float(a["y"]), w=float(a["w"]),
                 d=float(a["d"]), h=ADDED[a["type"]][1], added=True)
            for a in ed.get("added") or [] if a.get("type") in ADDED]
        halls = [r for r in rooms if r["type"] == "data_hall"]
        by = lambda t: next(i for i in yard_items if i["type"] == t and not i.get("added"))  # noqa: E731
        sub, gen, cool = by("yard_sub"), by("yard_gen"), by("yard_cool")
        mmr = next(r for r in rooms if r["code"] == "MMR-A")
        routes: dict[str, list] = {"power": [], "cooling": [], "data": []}
        lens = {"power": 0.0, "cooling": 0.0, "data": 0.0}
        for hl in halls:
            n = int(hl["code"][-2:])
            swg = next(r for r in rooms if r.get("hall") == n and r["code"].startswith("SWG"))
            me = next(r for r in rooms if r.get("hall") == n and r["code"].startswith("ME"))
            for kind, chain in (("power", [_c(sub), _c(swg), _c(hl)]), ("cooling", [_c(cool), _c(me), _c(hl)]),
                                ("data", [_c(mmr), _c(hl)])):
                for a, b2 in zip(chain, chain[1:]):
                    pts, ln = _route(a, b2)
                    routes[kind].append(pts)
                    lens[kind] += ln
                lens[kind] += hl["level"] * FLOOR_H  # riser to an upper storey

        footprint = bw * bd
        gfa = footprint * c.levels
        area = lambda t: sum(i["w"] * i["d"] for i in yard_items if i["type"] == t and i.get("added"))  # noqa: E731
        yard_area = sum(i["w"] * i["d"] for i in yard_items if i["type"] != "yard_trees")
        coverage = (footprint + yard_area) / (site_w * site_d)
        placed = sum(hl["racks"] for hl in halls)
        positions = sum(hl["positions"] for hl in halls)
        bay = sum(r.get("positions", 0) for r in rooms if r["type"] == "reserve")
        hall_area = sum(hl["w"] * hl["d"] for hl in halls)
        corridor_area = sum(r["w"] * r["d"] for r in rooms if r["type"] == "corridor")

        # Money
        equip = c.mw * v("capex_per_mw") * v("equipment_share_of_capex") * v(RED_COST[c.red])
        cool_capex = c.mw * v(f"cooling_capex_{c.cooling}")
        shell = gfa * v("shell_cost_per_m2") * (1 + (c.levels - 1) * v("multistorey_cost_premium"))
        distribution = lens["power"] * v("busway_cost_per_m") + lens["cooling"] * v("pipe_cost_per_m")
        bess_mwh = area("yard_bess") * v("bess_mwh_per_m2")
        canopy_kwp = area("yard_solar") * v("roof_solar_kw_per_m2")
        walls = [i for i in yard_items if i["type"] == "yard_wall"]
        added_cost = (bess_mwh * v("bess_cost_per_mwh") + canopy_kwp * v("solar_cost_per_kwp")
                      + area("yard_water") * v("tank_cost_per_m2") + area("yard_parking") * v("paving_cost_per_m2")
                      + area("yard_trees") * v("landscape_cost_per_m2") + area("yard_guard") * v("gatehouse_cost_per_m2")
                      + sum(max(i["w"], i["d"]) for i in walls) * v("noise_wall_cost_per_m"))
        capex = equip + cool_capex + shell + distribution + interconnect + added_cost
        energy_flat, energy_flex = fac_mwh * p_flat, fac_mwh * p_flex
        opex = c.mw * v("opex_per_mw_year")
        ten_year = capex + land + 10 * (energy_flex + opex + water_cost)
        npv, payback = _npv(v, c.mw, capex, land, energy_flex, opex, water_cost, months)
        rng = random.Random(20261114)  # same draws for every concept so the spreads are comparable
        u = UNCERTAINTY
        draws = sorted(_npv(v, c.mw, capex, land, energy_flex, opex, water_cost,
                            months + rng.triangular(u["delay_months"][0], u["delay_months"][1], u["delay_months"][0]),
                            rng.triangular(u["build_cost"][0], u["build_cost"][1], 1.0),
                            rng.triangular(u["revenue"][0], u["revenue"][1], 1.0),
                            rng.triangular(u["energy_price"][0], u["energy_price"][1], 1.0))[0] for _ in range(400))

        # People: standby generator noise, heard only during tests and outages
        gx, gy = _c(gen)
        edge = max(1.0, min(gx, site_w - gx, gy, site_d - gy))
        walled = any(_gap(w, gen) <= 20.0 for w in walls)
        src = v("genset_dba_at_7m") + 10 * math.log10(max(1, c.gens_needed)) - (v("noise_wall_loss_dba") if walled else 0.0)
        noise_edge = src - 20 * math.log10(max(edge, 7.0) / 7.0)
        noise_home = src - 20 * math.log10(max(edge + home_m, 7.0) / 7.0) if home_m is not None else None

        # Planet
        embodied_t = gfa * v("embodied_kgco2_per_m2") / 1000.0
        solar_kwp = footprint * v("roof_solar_usable_share") * v("roof_solar_kw_per_m2") + canopy_kwp
        solar_mwh = solar_kwp * v("solar_kwh_per_kwp") / 1000.0
        co2_flat, co2_flex = fac_mwh * c_flat / 1000.0, fac_mwh * c_flex / 1000.0
        solar_t = solar_mwh * c_flat / 1000.0

        every = [dict(x=ox, y=oy, w=bw, d=bd, code="Building")] + yard_items
        margin = min(min(i["x"], i["y"], site_w - i["x"] - i["w"], site_d - i["y"] - i["d"]) for i in every)
        clash = [f"{a['code']} and {o['code']}" for n_, a in enumerate(every) for o in every[n_ + 1:]
                 if min(a["x"] + a["w"], o["x"] + o["w"]) - max(a["x"], o["x"]) > 0.05
                 and min(a["y"] + a["d"], o["y"] + o["d"]) - max(a["y"], o["y"]) > 0.05]
        gens_ok = c.gens >= c.gens_needed + (1 if c.red != "N" else 0) or c.red == "N"
        ew, edp = (env_d, env_w) if rotate else (env_w, env_d)
        checks = [
            dict(name="Fits the building envelope", ok=fits,
                 detail=f"Building {bw:.0f} x {bd:.0f} m in a {edp if rotate else ew:.0f} x {ew if rotate else edp:.0f} m envelope."),
            dict(name="Inside the setback", ok=margin >= setback - 1e-6,
                 detail=("Something sits outside the site boundary." if margin < 0 else
                         f"Closest point is {margin:.0f} m from the boundary; the setback is {setback:.0f} m.")),
            dict(name="Nothing overlaps", ok=not clash,
                 detail=f"Overlapping: {'; '.join(clash[:3])}." if clash else "Building and outdoor plant are clear of each other."),
            dict(name="All racks placed", ok=placed == c.racks, detail=f"{placed:,} of {c.racks:,} racks placed."),
            dict(name="Backup power covers the load", ok=gens_ok,
                 detail=f"{c.gens} generators of {v('genset_mw')} MW for a {c.fac_mw:.1f} MW facility load at {c.red}."),
            dict(name="Site coverage", ok=coverage <= v("max_site_coverage"),
                 detail=f"{coverage * 100:.0f}% of the site is building or yard; limit {v('max_site_coverage') * 100:.0f}%."),
            dict(name="Land kept for expansion", ok=1 - coverage >= reserve,
                 detail=f"{(1 - coverage) * 100:.0f}% of the site stays open; the brief reserves {reserve * 100:.0f}%."),
        ]
        if noise_home is not None:
            checks.append(dict(name="Generator noise at the nearest home", ok=noise_home <= v("noise_limit_dba"),
                               detail=f"{noise_home:.0f} dBA estimated during a test, against {v('noise_limit_dba'):.0f} dBA."))
        for r in rooms:
            for k in ("x", "y", "w", "d"):
                r[k] = round(r[k], 2)
            for rw in r.get("rows", []):
                for k in ("x", "y", "w", "d"):
                    rw[k] = round(rw[k], 2)
            if "need_m2" in r:
                r["need_m2"] = round(r["need_m2"], 1)
            r["area_m2"] = round(r["w"] * r["d"], 1)
        out.append(dict(
            id=cid, name=name, strategy=strategy, feasible=all(k["ok"] for k in checks[:5]), rotated=rotate,
            building=dict(x=round(ox, 2), y=round(oy, 2), w=round(bw, 2), d=round(bd, 2), h=FLOOR_H * c.levels,
                          storeys=c.levels, floor_h=FLOOR_H),
            rooms=rooms, yard=[{k: (round(val, 2) if isinstance(val, float) else val) for k, val in i.items()} for i in yard_items],
            equipment=equipment, routes=routes, checks=checks,
            metrics=dict(
                footprint_m2=round(footprint), gross_floor_m2=round(gfa), storeys=c.levels, placed_racks=placed,
                rack_positions=positions, spare_positions=positions - placed, expansion_bay_positions=bay,
                hall_area_m2=round(hall_area), corridor_area_m2=round(corridor_area), corridor_share=round(corridor_area / gfa, 3),
                power_route_m=round(lens["power"]), cooling_route_m=round(lens["cooling"]), data_route_m=round(lens["data"]),
                site_coverage=round(coverage, 3), yard_area_m2=round(yard_area), generators=c.gens),
            money=dict(capex=round(capex), shell=round(shell), equipment=round(equip + cool_capex),
                       distribution=round(distribution), interconnect=round(interconnect), added=round(added_cost),
                       land=round(land), total_investment=round(capex + land),
                       energy_per_year=round(energy_flex), energy_per_year_flat=round(energy_flat),
                       opex_per_year=round(opex), water_per_year=round(water_cost), ten_year=round(ten_year),
                       revenue_per_year=round(c.mw * v("revenue_per_mw_year") * v("occupancy_stabilized")),
                       npv=round(npv), npv_p10=round(draws[40]), npv_p50=round(draws[200]), npv_p90=round(draws[360]),
                       payback_years=round(payback, 1) if payback is not None else None, months_to_power=round(months, 1),
                       analysis_years=int(v("analysis_years"))),
            people=dict(noise_at_boundary_dba=round(noise_edge, 1),
                        noise_at_home_dba=round(noise_home, 1) if noise_home is not None else None,
                        generator_to_boundary_m=round(edge), home_distance_m=home_m, noise_wall=walled),
            planet=dict(co2_t_per_year=round(co2_flex), co2_t_per_year_flat=round(co2_flat), embodied_t=round(embodied_t),
                        roof_solar_kwp=round(solar_kwp), canopy_solar_kwp=round(canopy_kwp), roof_solar_mwh=round(solar_mwh),
                        roof_solar_share=round(solar_mwh / fac_mwh, 4), solar_avoided_t=round(solar_t)),
            resources=dict(water_m3_per_year=round(water_m3), energy_mwh_per_year=round(fac_mwh),
                           facility_mw=round(c.fac_mw, 1), open_land_share=round(1 - coverage, 3),
                           spare_positions=positions - placed + bay, bess_mwh=round(bess_mwh, 1),
                           bess_minutes=round(bess_mwh / c.fac_mw * 60.0, 1)),
        ))

    ranking = _score(out, priorities)
    flex_note = None
    if flex > 0:
        if c_flex > c_flat + 0.05:
            flex_note = ("Moving flexible work lowers the energy bill but raises emissions on these days: the cheapest hours "
                         "were not the cleanest.")
        elif p_flex > p_flat + 0.005:
            flex_note = "Moving flexible work cuts emissions but costs slightly more on these days."
    return dict(
        brief=dict(mw_it=c.mw, rack_kw=c.rack_kw, racks=c.racks, halls=c.total_halls, racks_per_hall=c.all_halls,
                   storeys=c.levels, redundancy=c.red, cooling=c.cooling, pue=c.pue, facility_mw=round(c.fac_mw, 1),
                   generators=c.gens, site_w=site_w, site_d=site_d, setback_m=setback, env_w=round(env_w, 1),
                   env_d=round(env_d, 1), expansion_pct=reserve * 100, flexible_share=flex,
                   rent_kw_month=round(v("revenue_per_mw_year") / 12_000.0, 1)),
        concepts=out, ranking=ranking,
        operating=dict(price_flat=round(p_flat, 2), price_flex=round(p_flex, 2), carbon_flat=round(c_flat, 1),
                       carbon_flex=round(c_flex, 1), price_label=grid.get("price_label"),
                       carbon_label=grid.get("carbon_label"), price_source=grid.get("price_source"),
                       carbon_source=grid.get("carbon_source"), notes=grid.get("notes", []),
                       price_days=len(days), price_dates=[d.get("date") for d in days], carbon_days=1,
                       carbon_price_per_t=cprice, flex_note=flex_note),
        finance=dict(discount_rate=v("discount_rate"), analysis_years=int(v("analysis_years")), uncertainty=UNCERTAINTY,
                     draws=400, label="Simulated",
                     note="NPV range from 400 draws over build cost, revenue, energy price and delay. Team scenario ranges."),
        site=dict(home_distance_m=home_m, substation_km=sub_km, gates=site.get("gates") or [], name=site.get("name"),
                  land_cost=land or None, land_label=site.get("land_label") if land else "Unknown",
                  land_basis=site.get("land_basis") if land else "No land price for this location; land is not in the totals."),
        assumptions=[dict(key=a.key, value=A.value(a.key, ov), unit=a.unit, basis=a.basis, label=a.label, verify=a.verify)
                     for a in STUDIO_ASSUMPTIONS]
        + [dict(key=k, value=A.value(k, ov), unit=A.ASSUMPTIONS[k].unit, basis=A.ASSUMPTIONS[k].basis,
                label=A.ASSUMPTIONS[k].label, verify=A.ASSUMPTIONS[k].verify)
           for k in ("revenue_per_mw_year", "discount_rate", "capex_per_mw", "opex_per_mw_year", "interconnect_cost_per_km",
                     "it_load_factor", "flex_rate_multiple")],
        labels=dict(geometry="Estimated", money="Estimated", people="Estimated", planet="Estimated", resources="Estimated",
                    interconnect="Simulated", npv_range="Simulated", months_to_power="Simulated"),
        note="Conceptual planning evidence computed from the brief and the listed assumptions. Not engineering design.",
    )


def _usd(n: float) -> str:
    return f"${abs(n) / 1e9:.2f}B" if abs(n) >= 1e9 else f"${abs(n) / 1e6:.1f}M" if abs(n) >= 1e6 else f"${abs(n) / 1e3:.0f}K"


FACTS = [  # what a layout actually changes, in real units: (label, getter, lower is better, formatter)
    ("build cost", lambda k: k["money"]["capex"], True, _usd),
    ("room for future racks", lambda k: k["resources"]["spare_positions"], False, lambda n: f"{n:,.0f} positions"),
    ("power route length", lambda k: k["metrics"]["power_route_m"], True, lambda n: f"{n:,.0f} m"),
    ("building footprint", lambda k: k["metrics"]["footprint_m2"], True, lambda n: f"{n:,.0f} m2"),
    ("generator noise at the boundary", lambda k: k["people"]["noise_at_boundary_dba"], True, lambda n: f"{n:.1f} dBA"),
]


def _score(concepts: list[dict], pr: dict[str, float]) -> dict[str, Any]:
    """Rank feasible concepts. Each factor score is 100 minus how many percent (or points) worse the concept is than
    the best of the three, in real units, so a small real difference stays a small score difference."""
    cap = min(k["money"]["capex"] for k in concepts)
    best_npv = max(k["money"]["npv"] for k in concepts)
    quiet = min(k["people"]["noise_at_boundary_dba"] for k in concepts)
    carbon = [k["planet"]["embodied_t"] + 10 * (k["planet"]["co2_t_per_year"] - k["planet"]["solar_avoided_t"]) for k in concepts]
    spare = [k["resources"]["spare_positions"] / max(1, k["metrics"]["placed_racks"]) for k in concepts]
    cover = [k["metrics"]["site_coverage"] for k in concepts]
    w = {f: max(0.0, float(pr.get(f, 1.0))) for f in ("money", "people", "planet", "resources")}
    tot = sum(w.values()) or 1.0
    for i, k in enumerate(concepts):
        sc = dict(
            money=100 - 100 * (best_npv - k["money"]["npv"]) / cap,
            people=100 - 5 * (k["people"]["noise_at_boundary_dba"] - quiet),
            planet=100 - 100 * (carbon[i] - min(carbon)) / max(1.0, min(carbon)),
            resources=100 - 100 * (max(spare) - spare[i]) - 100 * (cover[i] - min(cover)))
        k["scores"] = {f: round(max(0.0, x), 1) for f, x in sc.items()}
        k["score"] = round(sum(w[f] * k["scores"][f] for f in w) / tot, 1)
    order = sorted(range(len(concepts)), key=lambda i: (not concepts[i]["feasible"], -concepts[i]["score"]))
    for rank, i in enumerate(order):
        concepts[i]["rank"] = rank + 1
    for k in concepts:
        others = [o for o in concepts if o is not k]
        lead = trail = None
        for label, get, lower, fmt in FACTS:
            mine, rest = get(k), [get(o) for o in others]
            best_other, worst_other = (min(rest), max(rest)) if lower else (max(rest), min(rest))
            if lead is None and (mine < best_other if lower else mine > best_other):
                lead = f"Best on {label}: {fmt(mine)} against {fmt(worst_other)} for the weakest."
            if trail is None and (mine > worst_other if lower else mine < worst_other):
                trail = f"Weakest on {label}: {fmt(mine)} against {fmt(best_other)} for the best."
        k["advantage"] = lead or "Does not lead on anything measured."
        k["tradeoff"] = trail or "Not the weakest on anything measured."
    fit = [concepts[i] for i in order if concepts[i]["feasible"]]
    close = len(fit) >= 2 and fit[0]["score"] - fit[1]["score"] < 1.0
    spread = (fit[0]["score"] - fit[-1]["score"]) if fit else 0.0
    note = ("Too close to call: the top concepts are within one point on your priorities. For this brief the layout "
            "changes little; cooling, redundancy, storeys and how the site is run change far more. Choose on the trade-offs."
            if close else f"Ranked by your priorities. The three are {spread:.1f} points apart.")
    return dict(close=close, spread=round(spread, 1), note=note,
                method="Each factor score is 100 minus the percent (or points) worse than the best of the three, in real units.")
