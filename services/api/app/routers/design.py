"""Facility design: Claude arranges the data center on the parcel; deterministic code sizes and tests it.

POST /design/generate  site + MW + cooling (+ instruction + current layout) -> layout, metrics, checks
POST /design/check     layout -> metrics, checks   (after the user edits the model)

The model only ARRANGES components using the sizing rules we give it. Every number shown (capacity, backup,
storage, checks) is computed here from the geometry with stated team assumptions, never taken from the model.
If no key is set or the model fails, a rule-based layout is returned and labeled as such.
"""
from __future__ import annotations

import json
import math
import os
import re
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import assumptions as A
from .. import config

router = APIRouter(tags=["design"])

CType = Literal["data_hall", "cooling", "generator_yard", "substation", "battery", "water_tank", "solar", "office", "parking"]
SETBACK_M = 10.0
RULES = {  # team planning assumptions, shown in the UI
    "hall_gfa_m2_per_mw": 230.0, "floor_height_m": 6.0, "genset_mw": 2.5, "genset_pad_m2": 30.0,
    "cooling_yard_m2_per_mw": 15.0, "battery_mwh_per_m2": 0.1, "solar_mw_per_m2": 0.0001,
    "substation_min_m2": 1200.0, "setback_m": SETBACK_M,
}


class Component(BaseModel):
    id: str = Field(..., max_length=40)
    type: CType
    label: str = Field("", max_length=60)
    x: float = Field(..., ge=-1000, le=1000)     # metres east of parcel centre
    z: float = Field(..., ge=-1000, le=1000)     # metres south of parcel centre
    w: float = Field(..., ge=2, le=800)
    d: float = Field(..., ge=2, le=800)
    h: float = Field(6, ge=0.2, le=40)
    rot: Literal[0, 90] = 0


class Layout(BaseModel):
    site_w: float = Field(..., gt=10, le=3000)
    site_d: float = Field(..., gt=10, le=3000)
    components: list[Component] = Field(..., max_length=60)
    notes: list[str] = Field(default_factory=list, max_length=8)


class GenerateIn(BaseModel):
    site_name: str = Field("Site", max_length=120)
    acres: float = Field(..., gt=0.2, le=2000)
    mw: float = Field(..., gt=0, le=1000)
    cooling: Literal["air", "hybrid", "water"] = "air"
    instruction: str | None = Field(None, max_length=600)
    current: Layout | None = None


class CheckIn(BaseModel):
    layout: Layout
    mw: float = Field(..., gt=0, le=1000)
    cooling: Literal["air", "hybrid", "water"] = "air"


def _dims(c: Component) -> tuple[float, float]:
    return (c.d, c.w) if c.rot == 90 else (c.w, c.d)


def analyse(layout: Layout, mw: float, cooling: str) -> dict[str, Any]:
    by: dict[str, list[Component]] = {}
    for c in layout.components:
        by.setdefault(c.type, []).append(c)
    area = lambda t: sum(c.w * c.d for c in by.get(t, []))  # noqa: E731
    gfa = sum(c.w * c.d * max(1, round(c.h / RULES["floor_height_m"])) for c in by.get("data_hall", []))
    it_mw = gfa / RULES["hall_gfa_m2_per_mw"]
    gensets = int(area("generator_yard") // RULES["genset_pad_m2"])
    backup = gensets * RULES["genset_mw"]
    facility = mw * A.value(f"pue_{cooling}")
    battery = area("battery") * RULES["battery_mwh_per_m2"]
    tank_m3 = sum(0.785 * c.w * c.d * c.h for c in by.get("water_tank", []))
    metrics = {
        "it_mw_supported": round(it_mw, 1), "hall_gfa_m2": round(gfa), "facility_mw": round(facility, 1),
        "gensets": gensets, "backup_mw": round(backup, 1), "battery_mwh": round(battery, 1),
        "battery_minutes_at_full_load": round(battery / facility * 60, 1) if facility else 0,
        "solar_mwp": round(area("solar") * RULES["solar_mw_per_m2"], 2), "water_storage_kgal": round(tank_m3 * 264.172 / 1000),
        "site_coverage": round(sum(c.w * c.d for c in layout.components if c.type != "parking") / (layout.site_w * layout.site_d), 3),
        "cooling_yard_m2": round(area("cooling")), "label": "Estimated",
    }
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    hw, hd = layout.site_w / 2 - SETBACK_M, layout.site_d / 2 - SETBACK_M
    outside = [c.label or c.id for c in layout.components if abs(c.x) + _dims(c)[0] / 2 > hw + 1e-6 or abs(c.z) + _dims(c)[1] / 2 > hd + 1e-6]
    add("Inside the parcel with a 10 m setback", not outside, "all components fit" if not outside else "outside: " + ", ".join(outside[:4]))
    overlaps = []
    comps = [c for c in layout.components if c.type != "solar"]   # solar may sit on roofs
    for i, a in enumerate(comps):
        for b in comps[i + 1:]:
            aw, ad = _dims(a); bw, bd = _dims(b)
            if abs(a.x - b.x) < (aw + bw) / 2 - 0.5 and abs(a.z - b.z) < (ad + bd) / 2 - 0.5:
                overlaps.append(f"{a.label or a.id} / {b.label or b.id}")
    add("No overlapping structures", not overlaps, "none" if not overlaps else "; ".join(overlaps[:3]))
    add(f"Data halls hold {mw:g} MW of IT", it_mw + 1e-6 >= mw, f"{it_mw:.1f} MW at {RULES['hall_gfa_m2_per_mw']:.0f} m² per MW")
    add("Backup generators cover the full facility load", backup + 1e-6 >= facility, f"{gensets} x {RULES['genset_mw']} MW = {backup:.1f} MW vs {facility:.1f} MW load")
    need_cool = mw * RULES["cooling_yard_m2_per_mw"]
    add("Cooling yard is large enough", area("cooling") + 1e-6 >= need_cool, f"{area('cooling'):.0f} m² vs {need_cool:.0f} m² needed")
    add("On-site substation", area("substation") >= RULES["substation_min_m2"], f"{area('substation'):.0f} m² (min {RULES['substation_min_m2']:.0f})")
    if cooling != "air":
        add("Water storage for the cooling system", tank_m3 > 0, f"{metrics['water_storage_kgal']}k gal on site")
    return {"metrics": metrics, "checks": checks, "rules": RULES}


def rule_based(site_w: float, site_d: float, mw: float, cooling: str) -> Layout:
    comps: list[Component] = []
    n_halls = max(1, math.ceil(mw / 12))
    per = mw / n_halls
    usable_w = site_w - 2 * SETBACK_M - 60
    hall_w = min(usable_w / n_halls - 8, math.sqrt(per * 115 * 2.0))
    hall_w = max(20, hall_w)
    hall_d = per * 115 / hall_w                       # two floors: 230 / 2 m2 of footprint per MW
    total = n_halls * hall_w + (n_halls - 1) * 8
    x0 = -total / 2 + hall_w / 2 - 20
    for i in range(n_halls):
        x = x0 + i * (hall_w + 8)
        comps.append(Component(id=f"hall{i+1}", type="data_hall", label=f"Data hall {i+1}", x=x, z=-10, w=hall_w, d=hall_d, h=12))
        comps.append(Component(id=f"cool{i+1}", type="cooling", label=f"Cooling yard {i+1}", x=x, z=-10 - hall_d / 2 - 9,
                               w=hall_w, d=max(8, per * 15 / hall_w + 1), h=4))
    gens = math.ceil(mw * A.value(f"pue_{cooling}") / 2.5)
    gw = min(total, max(20, gens * 30 / 12))
    comps.append(Component(id="gen", type="generator_yard", label="Generator yard", x=x0 + total / 2 - hall_w / 2, z=-10 + hall_d / 2 + 12,
                           w=gw, d=max(10, gens * 30 / gw + 0.5), h=3.5))
    ex = site_w / 2 - SETBACK_M - 25
    comps.append(Component(id="sub", type="substation", label="Substation", x=ex, z=-site_d / 2 + SETBACK_M + 22, w=45, d=35, h=8))
    comps.append(Component(id="bat", type="battery", label="Battery storage", x=ex, z=-site_d / 2 + SETBACK_M + 62, w=36, d=14, h=3))
    if cooling != "air":
        comps.append(Component(id="tank1", type="water_tank", label="Water tank", x=ex, z=-site_d / 2 + SETBACK_M + 92, w=16, d=16, h=10))
    comps.append(Component(id="office", type="office", label="Operations building", x=ex - 5, z=site_d / 2 - SETBACK_M - 14, w=34, d=16, h=8))
    comps.append(Component(id="park", type="parking", label="Parking", x=ex - 50, z=site_d / 2 - SETBACK_M - 14, w=40, d=18, h=0.2))
    return Layout(site_w=site_w, site_d=site_d, components=comps,
                  notes=["Rule-based arrangement: halls in a row with cooling behind and generators in front; power and storage on the east edge."])


SYSTEM = """You are a data center site planner. Arrange a facility on a rectangular parcel and return ONLY JSON.
Coordinates: metres, origin at the parcel centre, x east (+) and z south (+). Each component is an axis-aligned
rectangle given by centre (x, z), size (w along x, d along z), height h, rot 0 or 90.
Hard rules: every component stays inside the parcel with a 10 m setback; no overlaps (except solar, which may sit on
a data hall roof with the same x, z and smaller w, d); leave at least 8 m lanes between buildings.
Sizing rules (use these, do not invent others): data halls 230 m2 of floor area per MW IT, floors are 6 m high
(h=12 is two floors); cooling yard 15 m2 per MW next to its hall; generator yard 30 m2 per 2.5 MW generator and
enough generators for MW x PUE; substation at least 45 x 35 m near a parcel edge; battery 0.1 MWh per m2;
water tanks only for hybrid or water cooling; one operations building near the entrance; parking beside it.
Types allowed: data_hall, cooling, generator_yard, substation, battery, water_tank, solar, office, parking.
JSON shape: {"components":[{"id","type","label","x","z","w","d","h","rot"}], "notes":["up to 4 short reasons for the arrangement"]}"""


def _claude(q: GenerateIn, site_w: float, site_d: float) -> Layout:
    import anthropic

    pue = A.value(f"pue_{q.cooling}")
    user = (f"Parcel: {site_w:.0f} m (x) by {site_d:.0f} m (z), {q.acres:.1f} acres, named {q.site_name}. "
            f"Target: {q.mw:g} MW IT, {q.cooling} cooling, PUE {pue}. Facility load {q.mw * pue:.1f} MW.")
    if q.current and q.instruction:
        user += ("\nCurrent layout JSON:\n" + json.dumps([c.model_dump() for c in q.current.components]) +
                 f"\nRevise it to satisfy this request, keeping everything else where it is: {q.instruction}")
    elif q.instruction:
        user += f"\nExtra request: {q.instruction}"
    if config.ANTHROPIC_API_KEY:
        client, model = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY), os.getenv("ANTHROPIC_DESIGN_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"))
    else:  # Amazon Bedrock (uses the AWS credential chain)
        client, model = anthropic.AnthropicBedrock(aws_region=config.AWS_REGION), config.BEDROCK_MODEL_ID
    msg = client.messages.create(model=model,
                                 max_tokens=6000, system=SYSTEM, messages=[{"role": "user", "content": user}])
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        raise ValueError("no JSON in model reply")
    data = json.loads(m.group(0))
    seen: set[str] = set()
    comps = []
    for i, c in enumerate(data.get("components", [])):
        c["id"] = str(c.get("id") or f"c{i}")
        if c["id"] in seen:
            c["id"] = f"{c['id']}_{i}"
        seen.add(c["id"])
        # tolerate small slips (zero height, odd rotation, missing label) instead of discarding the design
        c["h"] = min(40.0, max(0.2, float(c.get("h") or 0.2)))
        c["w"] = min(800.0, max(2.0, float(c.get("w") or 2)))
        c["d"] = min(800.0, max(2.0, float(c.get("d") or 2)))
        c["rot"] = 90 if int(float(c.get("rot") or 0)) % 180 == 90 else 0
        c["label"] = str(c.get("label") or "")[:60]
        comps.append(Component.model_validate(c))
    if not comps:
        raise ValueError("model returned no components")
    return Layout(site_w=site_w, site_d=site_d, components=comps, notes=[str(n)[:240] for n in data.get("notes", [])][:4])


@router.post("/design/generate")
def generate(q: GenerateIn) -> dict[str, Any]:
    side = math.sqrt(q.acres * 4046.8564224)
    site_w = q.current.site_w if q.current else side
    site_d = q.current.site_d if q.current else side
    source, error = "rule-based", None
    layout = None
    if config.ANTHROPIC_API_KEY or config.BEDROCK_MODEL_ID:
        try:
            layout = _claude(q, site_w, site_d)
            source = "Claude (Anthropic API)" if config.ANTHROPIC_API_KEY else "Claude (Amazon Bedrock)"
        except Exception as e:  # fall back, and say so
            error = f"{type(e).__name__}: {str(e)[:160]}"
    if layout is None:
        layout = q.current if (q.current and q.instruction) else rule_based(site_w, site_d, q.mw, q.cooling)
    return {"layout": layout.model_dump(), "source": source, "model_error": error,
            "parcel_note": "Parcel drawn as a square of the recorded acreage; the CoStar extract has no parcel boundary.",
            **analyse(layout, q.mw, q.cooling)}


@router.post("/design/check")
def check(q: CheckIn) -> dict[str, Any]:
    return analyse(q.layout, q.mw, q.cooling)
