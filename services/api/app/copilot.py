"""PlotStar copilot: a LangGraph workflow that answers questions and runs what-ifs against the live Studio state.

    plan -> act -> verify -> respond

plan     Claude (LangChain ChatAnthropic, tool calling) chooses which deterministic tools to run. Without a key, or if
         the call fails, a rule parser chooses them, so the copilot never depends on the model being reachable.
act      runs the chosen tools in parallel. Every number comes from the layout engine or the CoStar extract.
verify   checks what came back (failed checks, infeasible layouts, unknown data) and builds the fact sheet.
respond  Claude writes a short answer from the fact sheet only. Any number in its reply that is not in the fact sheet
         makes us discard the reply and use the built-in text.

What-ifs are previews. The answer carries a `proposal` (a brief patch) that the UI applies only after the user confirms.
CoStar fields reach the language model only when COPILOT_LLM_COSTAR=1 (sponsor permission to send kit data to an
outside AI provider is unconfirmed); otherwise CoStar records are returned verbatim for the UI and kept out of prompts.
"""
from __future__ import annotations

import inspect
import json
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from operator import add
from typing import Annotated, Any, Callable, Literal, TypedDict

from pydantic import BaseModel, Field

from . import assumptions as A
from . import config, layout_engine
from .db import db_ready, session
from .screening import service_capacity_mw

MODEL = os.getenv("ANTHROPIC_MODEL") or "claude-opus-5-5"
LLM_COSTAR = os.getenv("COPILOT_LLM_COSTAR", "") == "1"
TRACING = bool(os.getenv("LANGSMITH_API_KEY")) and os.getenv("LANGSMITH_TRACING", "").lower() == "true"

# --------------------------------------------------------------------------------------------------- tool schemas
# Claude sees these as tools. They only describe arguments; the functions below do the work.


class InspectObject(BaseModel):
    """Look up one object of the active layout by its code (a room such as DH-01, a yard item such as SUB-01 or GEN,
    or a generator such as G-01): size, position, capacity, the checks that involve it and why it is there."""
    code: str = Field(..., description="Object code exactly as shown in the plan, e.g. DH-01")


class WhatIf(BaseModel):
    """Re-run the layout engine with changed design inputs and return before/after consequences for geometry, cost,
    energy, water, carbon, checks and ranking. Use for any 'what if', 'switch to', 'can we fit', 'double', 'more
    compact' request. Only set the fields that change. The result is a preview; nothing is applied."""
    rack_kw: float | None = Field(None, ge=3, le=200, description="Rack density in kW per rack")
    mw_it: float | None = Field(None, gt=0.5, le=500, description="Target IT capacity in MW")
    racks_delta: int | None = Field(None, ge=-5000, le=5000, description="Add (or remove) this many racks at the current density")
    cooling: Literal["air", "hybrid", "water", "liquid"] | None = None
    redundancy: Literal["N", "N+1", "2N"] | None = None
    halls: int | None = Field(None, ge=1, le=24)
    storeys: int | None = Field(None, ge=1, le=3)
    flexible_share: float | None = Field(None, ge=0, le=0.6, description="Share of work that can move hours, 0-0.6")
    expansion_pct: float | None = Field(None, ge=0, le=80, description="Percent of the site kept open for expansion")
    setback_m: float | None = Field(None, ge=0, le=100)
    rent_kw_month: float | None = Field(None, ge=20, le=600)


class CompareConcepts(BaseModel):
    """Compare the three generated concepts side by side: rank, cost to build, ten-year cost, NPV, footprint, spare
    rack positions, energy, water, carbon, noise and failed checks."""


class ReviewRisks(BaseModel):
    """List what could break this project: failed engineering checks, site gates that did not pass, and inputs that
    are unknown or only estimated (land price, grid distance, existing electric service)."""


class CostarProperty(BaseModel):
    """The CoStar Data Extract record for the selected site (or a given parcel id): property type, size, year built,
    existing electric service, availability, asking and last sale price, Matterport scans, with source rows."""
    parcel_id: str | None = Field(None, description="e.g. costar:23296; omit for the selected site")


class CostarSearch(BaseModel):
    """Search the CoStar Data Extract for candidate properties with structured filters derived from the request.
    Returns real records only; an empty result means nothing in the extract matches."""
    market: Literal["Houston", "Los Angeles"] | None = None
    min_acres: float | None = Field(None, ge=0)
    max_acres: float | None = Field(None, ge=0)
    property_types: list[str] = Field(default_factory=list, description="CoStar property types, e.g. Industrial, Flex, Land, Office")
    heavy_power: bool | None = Field(None, description="Only properties CoStar marks as having heavy power")
    max_price: float | None = Field(None, ge=0, description="Upper bound on asking price or last sale price, USD")
    for_sale_or_lease: bool = Field(False, description="Only properties currently marketed")
    sort: Literal["acres", "price", "power"] = "acres"
    limit: int = Field(8, ge=1, le=25)


TOOLS: dict[str, type[BaseModel]] = {t.__name__: t for t in (InspectObject, WhatIf, CompareConcepts, ReviewRisks,
                                                              CostarProperty, CostarSearch)}

# --------------------------------------------------------------------------------------------------- helpers


def _usd(n: float | None) -> str:
    if n is None:
        return "unknown"
    s = "-" if n < 0 else ""
    n = abs(n)
    return f"{s}${n / 1e9:.2f}B" if n >= 1e9 else f"{s}${n / 1e6:.1f}M" if n >= 1e6 else f"{s}${n / 1e3:.0f}K"


def _n(v: float | None, d: int = 0, unit: str = "") -> str:
    if v is None:
        return "unknown"
    return f"{v:,.{d}f}{(' ' + unit) if unit else ''}"


class Ctx:
    """One request's view of the Studio: the generate body, the active concept and the selected object.
    The base generation is computed once and shared by every tool."""

    def __init__(self, req: dict[str, Any], grid_fn: Callable[[], dict]):
        self.req, self._grid_fn, self._base, self._grid = req, grid_fn, None, None
        # CoStar tool outputs live here, never in the LangGraph state, so checkpoints and LangSmith traces hold no kit data
        self.vault: dict[int, dict[str, Any]] = {}
        self.concept_id: str | None = req.get("concept_id")
        self.selected: str | None = req.get("selected")
        self.stage: str = req.get("stage") or "Explore"

    def grid(self) -> dict:
        if self._grid is None:
            self._grid = self._grid_fn()
        return self._grid

    def run(self, brief: dict[str, Any]) -> dict[str, Any]:
        r = self.req
        return layout_engine.generate(brief, r.get("site") or {}, self.grid(), r.get("priorities") or {},
                                      r.get("assumptions") or {}, r.get("edits") or {})

    @property
    def base(self) -> dict[str, Any]:
        if self._base is None:
            self._base = self.run(dict(self.req["brief"]))
        return self._base

    def concept(self, result: dict | None = None) -> dict:
        res = result or self.base
        return (next((c for c in res["concepts"] if c["id"] == self.concept_id), None)
                or next(c for c in res["concepts"] if c["rank"] == 1))

    @property
    def parcel_id(self) -> str | None:
        sid = (self.req.get("site") or {}).get("id")
        return sid if isinstance(sid, str) and sid.startswith("costar:") else None


# --------------------------------------------------------------------------------------------------- consequences
# (label, getter, unit, digits, lower_is_better). Getter takes (result, concept).
_METRICS: list[tuple[str, Callable[[dict, dict], Any], str, int, bool | None]] = [
    ("Racks", lambda r, c: r["brief"]["racks"], "", 0, None),
    ("Data halls", lambda r, c: r["brief"]["halls"], "", 0, None),
    ("Rack density", lambda r, c: r["brief"]["rack_kw"], "kW/rack", 0, None),
    ("IT capacity", lambda r, c: r["brief"]["mw_it"], "MW", 1, None),
    ("Facility load", lambda r, c: r["brief"]["facility_mw"], "MW", 1, True),
    ("PUE", lambda r, c: r["brief"]["pue"], "", 2, True),
    ("Standby generators", lambda r, c: r["brief"]["generators"], "", 0, True),
    ("Racks placed", lambda r, c: c["metrics"]["placed_racks"], "", 0, False),
    ("Spare rack positions", lambda r, c: c["resources"]["spare_positions"], "", 0, False),
    ("Data hall area", lambda r, c: c["metrics"]["hall_area_m2"], "m2", 0, True),
    ("Building footprint", lambda r, c: c["metrics"]["footprint_m2"], "m2", 0, True),
    ("Gross floor area", lambda r, c: c["metrics"]["gross_floor_m2"], "m2", 0, True),
    ("Site coverage", lambda r, c: c["metrics"]["site_coverage"] * 100, "%", 1, True),
    ("Power route", lambda r, c: c["metrics"]["power_route_m"], "m", 0, True),
    ("Cooling route", lambda r, c: c["metrics"]["cooling_route_m"], "m", 0, True),
    ("Cost to build", lambda r, c: c["money"]["capex"], "usd", 0, True),
    ("Energy per year", lambda r, c: c["money"]["energy_per_year"], "usd", 0, True),
    ("Operating cost per year", lambda r, c: c["money"]["opex_per_year"], "usd", 0, True),
    ("Ten-year cost", lambda r, c: c["money"]["ten_year"], "usd", 0, True),
    ("NPV", lambda r, c: c["money"]["npv"], "usd", 0, False),
    ("Months to power", lambda r, c: c["money"]["months_to_power"], "months", 1, True),
    ("Electricity use", lambda r, c: c["resources"]["energy_mwh_per_year"], "MWh/yr", 0, True),
    ("Water use", lambda r, c: c["resources"]["water_m3_per_year"], "m3/yr", 0, True),
    ("Operating carbon", lambda r, c: c["planet"]["co2_t_per_year"], "t/yr", 0, True),
    ("Build carbon", lambda r, c: c["planet"]["embodied_t"], "t", 0, True),
    ("Generator noise at boundary", lambda r, c: c["people"]["noise_at_boundary_dba"], "dBA", 1, True),
    ("Rank", lambda r, c: c["rank"], "", 0, True),
]

# which Studio stages a changed metric touches, for the "ripple" line in the UI
_STAGE = {"Racks": "Generate", "Data halls": "Generate", "Racks placed": "Explore", "Spare rack positions": "Explore",
          "Data hall area": "Explore", "Building footprint": "Explore", "Gross floor area": "Explore",
          "Site coverage": "Explore", "Power route": "Explore", "Cooling route": "Explore", "Rank": "Compare"}


def _fmt(v: Any, unit: str, d: int) -> str:
    if v is None:
        return "unknown"
    if unit == "usd":
        return _usd(v)
    return _n(v, d, "" if unit in ("", "%") else unit) + ("%" if unit == "%" else "")


def consequences(before: dict, after: dict, concept_id: str | None) -> dict[str, Any]:
    """Before/after for one concept between two engine runs. Pure arithmetic on engine outputs."""
    cb = next((c for c in before["concepts"] if c["id"] == concept_id), None) or before["concepts"][0]
    ca = next((c for c in after["concepts"] if c["id"] == cb["id"]), None) or after["concepts"][0]
    rows = []
    for label, get, unit, d, lower in _METRICS:
        b, a = get(before, cb), get(after, ca)
        if b is None and a is None:
            continue
        changed = b != a if not isinstance(b, float) else abs((a or 0) - (b or 0)) > 1e-9
        better = None
        if changed and lower is not None and a is not None and b is not None:
            better = (a < b) if lower else (a > b)
        rows.append(dict(metric=label, unit=unit, before=b, after=a, before_text=_fmt(b, unit, d),
                         after_text=_fmt(a, unit, d), delta=(a - b) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else None,
                         delta_text=(("+" if a - b > 0 else "") + _fmt(a - b, unit, d)) if changed and isinstance(a, (int, float)) and isinstance(b, (int, float)) else "",
                         changed=changed, better=better, stage=_STAGE.get(label, "Analyze")))
    ok_b = {k["name"]: k for k in cb["checks"]}
    flips = [dict(name=k["name"], before=ok_b[k["name"]]["ok"] if k["name"] in ok_b else None, after=k["ok"], detail=k["detail"])
             for k in ca["checks"] if k["name"] not in ok_b or ok_b[k["name"]]["ok"] != k["ok"]]
    halls_b = {r["code"]: r for r in cb["rooms"] if r["type"] == "data_hall"}
    halls = [dict(code=r["code"], name=r["name"], racks_before=halls_b.get(r["code"], {}).get("racks"), racks_after=r.get("racks"),
                  area_before=halls_b.get(r["code"], {}).get("area_m2"), area_after=r.get("area_m2"),
                  mw_before=halls_b.get(r["code"], {}).get("mw"), mw_after=r.get("mw"))
             for r in ca["rooms"] if r["type"] == "data_hall"]
    return dict(concept_id=cb["id"], concept=cb["name"], feasible_before=cb["feasible"], feasible_after=ca["feasible"],
                rows=rows, changed=[r for r in rows if r["changed"]], check_flips=flips,
                failed_after=[k for k in ca["checks"] if not k["ok"]], halls=halls,
                stages=sorted({r["stage"] for r in rows if r["changed"]} | ({"Decide"} if flips else set())))


# --------------------------------------------------------------------------------------------------- tools


def t_inspect(cx: Ctx, code: str) -> dict[str, Any]:
    c = cx.concept()
    code = code.strip().upper()
    objs = [*c["rooms"], *c["yard"], *[{**e, "name": f"Standby generator {e['code']}"} for e in c["equipment"]]]
    o = next((x for x in objs if x["code"].upper() == code), None)
    if o is None:
        near = [x["code"] for x in objs if x["code"].upper().startswith(code[:2])][:8]
        return dict(ok=False, headline=f"There is no object {code} in {c['name']}." + (f" Similar codes: {', '.join(near)}." if near else ""))
    b = cx.base["brief"]
    kind = o.get("type", "")
    area = o.get("area_m2") or round(o["w"] * o["d"], 1)
    facts = {"object": f"{o['code']} {o.get('name', '')}".strip(), "type": layout_engine_label(kind),
             "size": f"{o['w']:.1f} x {o['d']:.1f} m", "area": f"{area:,.0f} m2",
             "position": f"x {o['x']:.1f} m, y {o['y']:.1f} m from the site corner"}
    if o.get("h"):
        facts["height"] = f"{o['h']:.1f} m"
    if o.get("level") is not None and c["building"]["storeys"] > 1:
        facts["level"] = f"L{o['level'] + 1}"
    if o.get("need_m2"):
        facts["area the brief needs"] = f"{o['need_m2']:,.0f} m2"
    if kind == "data_hall":
        rows = o.get("rows") or []
        facts.update({"racks": f"{o.get('racks', 0):,}", "rack positions": f"{o.get('positions', 0):,}",
                      "rack rows": str(len(rows)), "IT load": f"{o.get('mw', 0):.2f} MW",
                      "heat to reject": f"{o.get('mw', 0):.2f} MW (all IT power becomes heat)",
                      "rack density": f"{b['rack_kw']:g} kW per rack", "cooling": b["cooling"],
                      "redundancy": b["redundancy"]})
    elif o.get("mw"):
        facts["serves"] = f"{o['mw']:.2f} MW"
    checks = [k for k in c["checks"] if o["code"] in k["detail"] or (kind.startswith("yard") and k["name"] in ("Nothing overlaps", "Inside the setback"))
              or (kind == "data_hall" and k["name"] == "All racks placed") or (kind == "yard_gen" and k["name"] == "Backup power covers the load")]
    why = WHY.get(kind, "")
    return dict(ok=True, object=o["code"], facts=facts, checks=checks, why=why,
                headline=f"{facts['object']} is {facts['size']} ({facts['area']})"
                         + (f", holding {facts['racks']} racks at {facts['IT load']}" if kind == "data_hall" else "") + f". {why}")


def layout_engine_label(kind: str) -> str:
    return kind.replace("yard_", "outdoor ").replace("_", " ")


# Why each kind of object exists and what sizes it (mirrors src/components/studio/types.ts WHY).
WHY = {
    "data_hall": "Sized from the rack count: rows at the assumed rack width and row pitch, with a clear perimeter.",
    "electrical": "Sized per MW of the hall it serves and placed against that hall to keep the power route short.",
    "battery": "Sized per MW and per power string (more strings at N+1 and 2N), next to its UPS room.",
    "mechanical": "Sized per MW for the chosen cooling type and placed on the hall edge facing the heat rejection yard.",
    "corridor": "A spine wide enough to move equipment between the loading area and every technical room.",
    "support": "Fixed-size support space: control room, offices and security.",
    "network": "Two separate meet-me rooms so carrier connections do not share one room.",
    "loading": "Scales with capacity; on the building edge so deliveries do not cross the halls.",
    "reserve": "An empty bay with the same dimensions as a hall, kept for future racks.",
    "yard_sub": "Sized from the facility load and placed outside the building, closest to the electrical rooms.",
    "yard_gen": "One standby generator per 2.5 MW of facility load, plus spares for the chosen redundancy.",
    "yard_cool": "Outdoor heat rejection sized per MW of IT load.",
    "yard_water": "Stored water for evaporative or hybrid cooling.",
    "generator": "One of the standby generators in the generator yard.",
}

_PATCH_KEYS = ("rack_kw", "mw_it", "cooling", "redundancy", "halls", "storeys", "flexible_share", "expansion_pct",
               "setback_m", "rent_kw_month")


def t_what_if(cx: Ctx, **args: Any) -> dict[str, Any]:
    brief0 = dict(cx.req["brief"])
    patch = {k: args[k] for k in _PATCH_KEYS if args.get(k) is not None}
    note = None
    if args.get("racks_delta"):
        n = int(args["racks_delta"])
        kw = float(patch.get("rack_kw", brief0.get("rack_kw", 20)))
        spare = cx.concept()["resources"]["spare_positions"]
        patch["mw_it"] = round(float(brief0["mw_it"]) + n * kw / 1000.0, 3)
        note = (f"{n:+,} racks at {kw:g} kW changes IT capacity to {patch['mw_it']:g} MW. The active concept has "
                f"{spare:,} spare rack positions today, so {'they fit in the existing positions' if 0 < n <= spare else 'the engine re-sizes the halls'}.")
    patch = {k: v for k, v in patch.items() if brief0.get(k) != v}
    if not patch:
        return dict(ok=False, headline="That would not change any design input, so there is nothing to recompute.")
    after = cx.run({**brief0, **patch})
    cons = consequences(cx.base, after, cx.concept()["id"])
    top = [r for r in cons["changed"] if r["metric"] in ("Racks", "Data halls", "Building footprint", "Cost to build",
                                                          "Ten-year cost", "Facility load", "Water use", "Rank")]
    head = "; ".join(f"{r['metric']} {r['before_text']} → {r['after_text']}" for r in top[:6]) or "No measured quantity changed."
    flips = "; ".join(f"{k['name']} now {'passes' if k['after'] else 'fails'}" for k in cons["check_flips"])
    return dict(ok=True, patch=patch, consequences=cons, note=note,
                headline=(f"{note} " if note else "") + f"For {cons['concept']}: {head}." + (f" {flips}." if flips else "")
                + ("" if cons["feasible_after"] else " The changed layout no longer fits the site."))


def t_compare(cx: Ctx) -> dict[str, Any]:
    rows = []
    for c in sorted(cx.base["concepts"], key=lambda k: k["rank"]):
        rows.append({"concept": c["name"], "id": c["id"], "rank": c["rank"], "feasible": c["feasible"],
                     "cost to build": _usd(c["money"]["capex"]), "ten-year cost": _usd(c["money"]["ten_year"]),
                     "NPV": _usd(c["money"]["npv"]), "footprint": f"{c['metrics']['footprint_m2']:,} m2",
                     "spare rack positions": f"{c['resources']['spare_positions']:,}",
                     "power route": f"{c['metrics']['power_route_m']:,} m",
                     "noise at boundary": f"{c['people']['noise_at_boundary_dba']} dBA",
                     "failed checks": [k["name"] for k in c["checks"] if not k["ok"]],
                     "advantage": c["advantage"], "trade-off": c["tradeoff"]})
    r = cx.base["ranking"]
    return dict(ok=True, table=rows, ranking_note=r["note"], close=r["close"],
                headline=f"{rows[0]['concept']} ranks first on your priorities ({rows[0]['ten-year cost']} over ten years). "
                         + ("The top concepts are within one point, so choose on the trade-offs. " if r["close"] else "")
                         + " ".join(f"{x['concept']}: {x['advantage']}" for x in rows))


def t_risks(cx: Ctx) -> dict[str, Any]:
    c, b = cx.concept(), cx.base
    items = [dict(kind="Engineering check", severity="high", text=f"{k['name']}: {k['detail']}") for k in c["checks"] if not k["ok"]]
    for g in b["site"]["gates"]:
        if g.get("status") != "Pass":
            items.append(dict(kind="Site gate", severity="high" if g.get("status") == "Fail" else "medium",
                              text=f"{g.get('gate')}: {g.get('reason')} ({g.get('label', 'Unknown')}, {g.get('source', 'no source')})"))
    if b["site"]["land_cost"] is None:
        items.append(dict(kind="Unknown input", severity="medium", text="No land price for this location; land is left out of every total."))
    if b["site"]["substation_km"] is None:
        items.append(dict(kind="Unknown input", severity="medium", text="Distance to high-voltage power is unknown; the interconnect cost uses a default distance."))
    items.append(dict(kind="Unverified", severity="medium",
                      text=f"Grid capacity for a {b['brief']['facility_mw']} MW facility load is not confirmed by any utility. Proximity to a substation does not mean capacity is available."))
    if b["operating"].get("flex_note"):
        items.append(dict(kind="Operating trade-off", severity="low", text=b["operating"]["flex_note"]))
    unc = b["finance"]
    items.append(dict(kind="Money range", severity="low",
                      text=f"NPV ranges from {_usd(c['money']['npv_p10'])} (P10) to {_usd(c['money']['npv_p90'])} (P90) over {unc['draws']} simulated draws."))
    return dict(ok=True, items=items,
                headline=f"{sum(1 for i in items if i['severity'] == 'high')} high and {sum(1 for i in items if i['severity'] == 'medium')} medium items for {c['name']}. "
                         + " ".join(i["text"] for i in items[:3]))


_COSTAR_FIELDS = ("parcel_id", "costar_property_id", "name", "address", "city", "state", "market", "property_type",
                  "property_subtype", "building_class", "construction_status", "year_built", "stories", "building_sf",
                  "lot_acres", "zoning", "has_heavy_power", "amps_high", "volts_high", "ceiling_height_ft", "has_rail",
                  "availability", "asking_price_low", "asking_price_high", "asking_listed_date", "last_sale_price",
                  "last_sale_status", "last_sale_date", "matterport_count", "source_file", "source_row")


def _property_card(p: dict) -> dict[str, Any]:
    mw, method = service_capacity_mw(p.get("amps_high"), p.get("volts_high"))
    rec = {k: p.get(k) for k in _COSTAR_FIELDS}
    rec["existing_service_mw"] = round(mw, 2) if mw is not None else None
    rec["existing_service_method"] = method
    price = p.get("asking_price_high") or p.get("asking_price_low")
    rec["summary"] = (f"{p.get('name') or 'Unnamed'} at {p.get('address')}, {p.get('city')}: {p.get('property_type') or 'type unknown'}"
                      f"{' (' + p['property_subtype'] + ')' if p.get('property_subtype') else ''}, "
                      f"{_n(p.get('lot_acres'), 1, 'acres')}, {_n(p.get('building_sf'), 0, 'sf')} building"
                      f"{', built ' + str(p['year_built']) if p.get('year_built') else ''}. "
                      f"Availability: {p.get('availability') or 'not marketed'}"
                      f"{', asking ' + _usd(price) if price else ''}. "
                      f"Last sale: {_usd(p['last_sale_price']) + ' on ' + str(p['last_sale_date']) if p.get('last_sale_price') else 'none recorded'}. "
                      f"Existing electric service: {str(round(mw, 2)) + ' MW (' + method + ', Estimated)' if mw is not None else 'not recorded'}.")
    rec["source"] = f"CoStar Data Extract, {p.get('source_file')} row {p.get('source_row')}"
    return rec


def t_costar_property(cx: Ctx, parcel_id: str | None = None) -> dict[str, Any]:
    pid = parcel_id or cx.parcel_id
    if not pid:
        return dict(ok=False, headline="The selected site is a dropped pin, not a CoStar property, so there is no CoStar record for it.")
    if not db_ready():
        return dict(ok=False, headline="The CoStar parcel store is not loaded on this server.")
    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (pid,)).fetchone()
        if not row:
            return dict(ok=False, headline=f"No CoStar record {pid}.")
        p = dict(row)
        models = [r["model_id"] for r in c.execute(
            "SELECT model_id FROM matterport_models WHERE costar_property_id = ? ORDER BY model_id", (p["costar_property_id"],))]
    card = _property_card(p)
    card["matterport_model_ids"] = models
    return dict(ok=True, costar=True, record=card,
                headline=card["summary"] + " Only the last recorded sale is loaded; earlier sale comps are not in the parcel store.")


def t_costar_search(cx: Ctx, **a: Any) -> dict[str, Any]:
    if not db_ready():
        return dict(ok=False, headline="The CoStar parcel store is not loaded on this server.")
    market = a.get("market") or (cx.req.get("market") if cx.req.get("market") in ("Houston", "Los Angeles") else None)
    where, args = ["lat IS NOT NULL"], []
    if market:
        where.append("market = ?"); args.append(market)
    if a.get("min_acres") is not None:
        where.append("lot_acres >= ?"); args.append(a["min_acres"])
    if a.get("max_acres") is not None:
        where.append("lot_acres <= ?"); args.append(a["max_acres"])
    if a.get("heavy_power"):
        where.append("has_heavy_power = 1")
    if a.get("for_sale_or_lease"):
        where.append("availability IS NOT NULL")
    types = [t for t in a.get("property_types") or [] if t]
    if types:
        where.append("(" + " OR ".join("lower(property_type) LIKE ?" for _ in types) + ")")
        args += [f"%{t.lower()}%" for t in types]
    if a.get("max_price") is not None:
        where.append("COALESCE(asking_price_high, asking_price_low, last_sale_price) <= ?"); args.append(a["max_price"])
    order = {"acres": "lot_acres IS NULL, lot_acres DESC",
             "price": "COALESCE(asking_price_high, asking_price_low, last_sale_price) IS NULL, COALESCE(asking_price_high, asking_price_low, last_sale_price) ASC",
             "power": "amps_high IS NULL, amps_high * COALESCE(volts_high, 480) DESC"}[a.get("sort") or "acres"]
    limit = int(a.get("limit") or 8)
    with session() as c:
        total = c.execute(f"SELECT COUNT(*) FROM parcels WHERE {' AND '.join(where)}", args).fetchone()[0]
        rows = [dict(r) for r in c.execute(f"SELECT * FROM parcels WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?", (*args, limit))]
    cards = [_property_card(r) for r in rows]
    filt = {k: v for k, v in {**a, "market": market}.items() if v not in (None, [], False) and k not in ("limit", "sort")}
    return dict(ok=True, costar=True, filters=filt, total=total, records=cards,
                headline=(f"{total:,} CoStar properties match {json.dumps(filt)}. Showing {len(cards)}, sorted by {a.get('sort') or 'acres'}: "
                          + "; ".join(f"{r['name'] or r['address']} ({_n(r['lot_acres'], 1, 'acres')})" for r in cards[:5]))
                if total else f"No CoStar property in the extract matches {json.dumps(filt)}.")


RUN: dict[str, Callable[..., dict[str, Any]]] = {
    "InspectObject": t_inspect, "WhatIf": t_what_if, "CompareConcepts": t_compare, "ReviewRisks": t_risks,
    "CostarProperty": t_costar_property, "CostarSearch": t_costar_search,
}


# --------------------------------------------------------------------------------------------------- CoStar intelligence
# The same tools as the MCP server (app/costar/tools.py), adapted for the graph: schemas come from the functions'
# signatures, results are CoStar data (kept in the per-run vault, out of prompts and traces), and every result gets a
# deterministic headline so the answer can quote it without a model touching the numbers.
def _intel_models() -> dict[str, type[BaseModel]]:
    import typing
    from pydantic import create_model
    from .costar import tools as T
    out: dict[str, type[BaseModel]] = {}
    for name in sorted(T.READ_ONLY):
        fn = T.TOOLS[name]
        hints = typing.get_type_hints(fn)
        fields = {p: (hints.get(p, Any), (... if v.default is inspect.Parameter.empty else v.default))
                  for p, v in inspect.signature(fn).parameters.items() if v.kind not in (v.VAR_KEYWORD, v.VAR_POSITIONAL)}
        out[name] = create_model(name, __doc__=(fn.__doc__ or name.replace("_", " ")).strip().split("\n\n")[0], **fields)
    out["deal_to_design"] = create_model(
        "deal_to_design", __doc__="Run the Deal-to-Design pipeline: search CoStar properties for the criteria, analyse each "
        "candidate in parallel (comps, underwriting, occupancy, community), rank them by a stated rule and write a memo.",
        market=(Literal["Houston", "Los Angeles"], "Houston"), mw_it=(float, 20.0), rack_kw=(float, 20.0),
        budget=(float | None, None), min_acres=(float | None, None), candidates=(int, 4), max_comp_age_years=(float | None, None))
    return out


def _m(n: Any) -> str:
    return _usd(n) if isinstance(n, (int, float)) else "unknown"


def intel_headline(tool: str, d: dict[str, Any] | None) -> str:
    """One deterministic sentence per tool, quoting only computed values."""
    if not d:
        return "No result."
    if tool == "find_sales_comps":
        if d.get("status") != "ok" or not d.get("estimate"):
            return "Not enough usable comparable sales for an indicative value: " + "; ".join((d.get("reasons") or [])[:2])
        e, v = d["estimate"], d.get("value") or {}
        if v.get("value") is None and (d.get("underwriting") or {}).get("acquisition_value") is not None:
            v = {"value": d["underwriting"]["acquisition_value"]}
        top = sorted([c for c in d.get("comps", []) if c.get("used")], key=lambda c: -(c.get("similarity") or 0))[:3]
        return (f"{d['n_used']} usable comps within {d.get('radius_km')} km give a median {e['unit']} of {e['median']:,.0f} "
                f"(P25 {e['p25']:,.0f} to P75 {e['p75']:,.0f}), an indicative value of {_m(v.get('value'))}. Most similar: "
                + "; ".join(f"{c.get('name') or c.get('address')} sold {str(c.get('sold_date'))[:10]} for {_m(c.get('price'))} "
                            f"({c.get('price_status')}), similarity {c.get('similarity'):.0f}" for c in top) + ".")
    if tool == "underwrite_acquisition":
        a, m = d["acquisition"], d["money"]
        return (f"Acquisition {_m(a.get('value'))} ({a.get('label')}{', +' + str(a['price_change_pct']) + '% scenario' if a.get('price_change_pct') else ''}). "
                f"{d['concept']}: build cost {_m(m.get('capex'))}, NPV {_m(m.get('npv'))} (P10 {_m(m.get('npv_p10'))} to P90 "
                f"{_m(m.get('npv_p90'))}), {m.get('months_to_power')} months to power. IRR is not computed by the model.")
    if tool == "search_costar_properties":
        ps = d.get("properties", [])
        return f"{d.get('total', 0):,} CoStar properties match. Top: " + "; ".join(
            f"{p.get('name') or p.get('address')} ({p.get('lot_acres') or '?'} acres, {p.get('property_type')})" for p in ps[:4]) + "."
    if tool == "find_adjacent_properties":
        return (f"{len(d.get('neighbours', []))} CoStar properties within range; all together about {d.get('combined_lot_acres_if_all')} acres. "
                "Distances are between recorded points; no parcel boundaries or ownership are in the data.")
    if tool == "compare_property_portfolio":
        rows = sorted([r for r in d.get("properties", []) if r.get("rank")], key=lambda r: r["rank"])
        return "Ranking (" + d.get("ranking_rule", "") + "): " + "; ".join(
            f"{r['rank']}. {r.get('name') or r['parcel_id']}: acquisition {_m(r.get('acquisition'))}, NPV {_m(r.get('npv'))}"
            + (f", fails {', '.join(r['gates_failed'])}" if r.get("gates_failed") else "") for r in rows[:5]) + "."
    if tool == "identify_data_gaps":
        c = d.get("counts", {})
        return f"{c.get('high', 0)} high and {c.get('medium', 0)} medium diligence gaps: " + "; ".join(g["gap"] for g in d.get("gaps", [])[:3])
    if tool == "generate_investment_memo":
        return f"{d.get('title')}: {d.get('recommendation')}, because {d.get('because')}. ({d.get('rule')})"
    if tool == "deal_to_design":
        rows = [r for r in d.get("shortlist", []) if r.get("rank")]
        memo = d.get("memo") or {}
        return (f"Analysed {len(d.get('shortlist', []))} CoStar candidates in parallel. "
                + "; ".join(f"{r['rank']}. {r.get('name') or r['parcel_id']} (NPV {_m(r.get('npv'))}, acquisition {_m(r.get('acquisition'))})" for r in rows[:4])
                + (f". Leader: {memo.get('recommendation')}, because {memo.get('because')}." if memo.get("recommendation") else "."))
    if tool == "analyze_occupancy":
        st, ctl = d.get("status") or {}, d.get("control") or {}
        cur, av = ctl.get("current") or {}, st.get("availability") or {}
        ec = ctl.get("earliest_full_control") or {}
        parts = [f"Occupancy evidence: {', '.join(x.replace('_', ' ') for x in st.get('states', [])) or 'unknown'}."]
        if cur.get("tenancies"):
            share = cur.get("occupied_share")
            parts.append(f"{cur['tenancies']} current tenancies" + (f", {share * 100:.1f}% of the building by area" if isinstance(share, (int, float)) else "") + ".")
        if av.get("available_sf"):
            parts.append(f"{av['available_sf']:,.0f} sf listed for lease" + (f" at ${av['asking_rent_per_sf_year']:g}/sf/yr" if av.get("asking_rent_per_sf_year") else "") + ".")
        basis = str(ec.get("basis") or "lease expiries are not all recorded").rstrip(".")
        parts.append(f"Full control: {ec['date']} ({basis})." if ec.get("date") else f"Full control date unknown: {basis}.")
        flags = [f["flag"] for f in ctl.get("diligence_flags", [])][:3]
        if flags:
            parts.append("Diligence: " + "; ".join(flags) + ".")
        parts.append("No tenant record does not mean vacant.")
        return " ".join(parts)
    if tool == "analyze_residential_impact":
        within_1km = [b for b in d.get("bands", []) if str(b.get("band")) in ("0-250 m", "250-500 m", "500-1000 m")]
        b1 = {"band": "within 1 km", "homes_listed": sum(b.get("homes_listed") or 0 for b in within_1km),
              "apartment_units": sum(b.get("apartment_units") or 0 for b in within_1km)} if within_1km else None
        rec = ((d.get("noise") or {}).get("receptors") or [None])[0]
        return (f"Nearest listed home {d.get('nearest_home_listing_m') or 'unknown'} m; nearest apartment community "
                f"{d.get('nearest_apartment_community_m') or 'unknown'} m."
                + (f" Band {b1['band']}: {b1.get('homes_listed', 0)} home listings and {b1.get('apartment_units', 0):,} apartment units." if b1 else "")
                + (f" Estimated generator noise at the nearest receptor ({rec['distance_m']} m): {rec['dba']} dBA." if rec else "")
                + " Listings and units are a sample, not population.")
    if tool == "evaluate_conversion":
        miss = d.get("missing") or []
        bad = [k for k in d.get("checks", []) if isinstance(k, dict) and k.get("status") not in ("pass", "ok", True)]
        return (f"Conversion screen for {d.get('mw_it')} MW at {d.get('rack_kw')} kW per rack: {d.get('status')}. "
                f"{d.get('racks_needed')} racks needed; about {d.get('racks_that_fit_by_area')} fit by floor area."
                + (" Concerns: " + "; ".join(str(k.get("item") or k.get("name") or k.get("check")) for k in bad[:3]) + "." if bad else "")
                + (f" Missing: {', '.join(str(m.get('item') if isinstance(m, dict) else m) for m in miss[:4])}." if miss else "")
                + " Conceptual screening, not engineering feasibility.")
    if tool == "get_matterport_model":
        mp = d.get("matterport") or []
        if not mp:
            return "CoStar records no Matterport scan for this property."
        return (f"{len(mp)} Matterport scan(s) recorded by CoStar: " + "; ".join(
            f"{m.get('name') or m.get('model_id')} covers {m.get('scope')} ({m.get('reason')})" for m in mp[:3])
            + " These show the existing building, not PlotStar's proposed design.")
    if tool == "find_off_market_candidates":
        cs = d.get("candidates", [])
        return (f"{d.get('screened', len(cs))} properties screened. Top: " + "; ".join(
            f"{c['parcel_id']} passes {c.get('passes')} of {c.get('known')} checks ({c.get('market_status') or 'not marketed'})" for c in cs[:4])
            + ". Screening only; nothing here implies a property is for sale.")
    for k in ("headline", "summary", "verdict"):
        if isinstance(d.get(k), str):
            return d[k]
    return f"{tool.replace('_', ' ').capitalize()}: results are in the evidence card."


def _intel_runner(name: str) -> Callable[..., dict[str, Any]]:
    def run(cx: Ctx, **args: Any) -> dict[str, Any]:
        if name == "deal_to_design":
            from . import deal_agent
            t0 = time.time()
            data = deal_agent.run(args)
            env = {"ok": True, "data": data, "sources": [], "label": "Estimated (conceptual)", "error": None}
            env["ms"] = round((time.time() - t0) * 1000)
        else:
            from .costar import tools as T
            if "parcel_id" in T.TOOLS[name].__code__.co_varnames and not args.get("parcel_id") and cx.parcel_id:
                args = {**args, "parcel_id": cx.parcel_id}
            env = T.run(name, via="copilot", **args)
        if not env["ok"]:
            return dict(ok=False, costar=True, tool=name, headline=f"{name.replace('_', ' ')} failed: {env['error']}")
        return dict(ok=True, costar=True, intel=True, tool=name, data=env["data"], sources=env["sources"][:60],
                    label=env["label"], headline=intel_headline(name, env["data"]))
    return run


try:
    INTEL = _intel_models()
except Exception:  # the intelligence layer is optional; the copilot keeps working without it
    INTEL = {}
TOOLS.update(INTEL)
RUN.update({n: _intel_runner(n) for n in INTEL})

# --------------------------------------------------------------------------------------------------- rule planner
_WORD_NUM = {"double": 2.0, "twice": 2.0, "triple": 3.0, "half": 0.5, "halve": 0.5}


def rule_plan(q: str, cx: Ctx) -> list[dict[str, Any]]:
    """Deterministic fallback planner. Covers the demo questions; the model handles anything phrased differently."""
    s = q.lower()
    b = cx.req["brief"]
    calls: list[dict[str, Any]] = []
    wi: dict[str, Any] = {}
    m = re.search(r"(\d+(?:\.\d+)?)\s*kw", s)
    if re.search(r"densit|kw\s*(per|/)\s*rack|kw racks?", s):
        mult = next((v for k, v in _WORD_NUM.items() if k in s), None)
        if m:
            wi["rack_kw"] = float(m.group(1))
        elif mult:
            wi["rack_kw"] = round(float(b.get("rack_kw", 20)) * mult, 1)
    m = re.search(r"(\d[\d,]*)\s*(?:more|extra|additional|another)?\s*racks", s) or re.search(r"(?:another|more|extra)\s+(\d[\d,]*)\s*racks", s)
    if m and re.search(r"fit|add|another|more|extra", s):
        wi["racks_delta"] = int(m.group(1).replace(",", "")) * (-1 if re.search(r"remove|fewer|less", s) else 1)
    for k in ("liquid", "air", "hybrid", "water"):
        if re.search(rf"\b{k}\b[- ]?cool|switch to {k}|{k} cooling|evaporat" if k == "water" else rf"\b{k}\b[- ]?cool|switch to {k}|{k} cooling", s):
            wi["cooling"] = k
            break
    m = re.search(r"\b(2n|n\+1)\b", s)
    if m:
        wi["redundancy"] = m.group(1).upper()
    m = re.search(r"(\d)\s*(?:storeys?|stories|floors?|levels?)", s)
    if m:
        wi["storeys"] = int(m.group(1))
    if re.search(r"compact|smaller footprint", s):
        wi["storeys"] = min(3, int(b.get("storeys", 1)) + 1)
    if re.search(r"more expansion|room to grow|expansion space", s):
        wi["expansion_pct"] = min(80, float(b.get("expansion_pct", 10)) + 15)
    m = re.search(r"(\d+(?:\.\d+)?)\s*mw", s)
    if m and re.search(r"what if|change|make it|go to|instead", s):
        wi["mw_it"] = float(m.group(1))
    if wi:
        calls.append({"name": "WhatIf", "args": wi})
    if re.search(r"find|search|look for|properties|propert(y|ies) (near|in)", s) and not wi:
        a: dict[str, Any] = {"market": "Los Angeles" if "los angeles" in s or " la " in f" {s} " else "Houston" if "houston" in s else None}
        m = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*acres", s)
        if m:
            a["min_acres"] = float(m.group(1))
        types = [t for t in ("industrial", "flex", "office", "retail") if t in s]
        if re.search(r"vacant land|raw land|land parcels?|\bland sites?", s):
            types.append("land")
        a["property_types"] = [t.title() for t in types]
        if "heavy power" in s or "power" in s:
            a["sort"] = "power"
        if re.search(r"cheap|low (land )?cost|low price|affordable", s):
            a["sort"] = "price"
        if re.search(r"for sale|for lease|available", s):
            a["for_sale_or_lease"] = True
        mw = re.search(r"(\d+(?:\.\d+)?)\s*mw", s)
        if mw and "min_acres" not in a:
            a["min_acres"] = round(float(mw.group(1)) / A.value("mw_per_acre"), 1)  # same MW-per-acre assumption as the engine
        calls.append({"name": "CostarSearch", "args": a})
    pid = cx.parcel_id
    intel = [
        (r"comparab|\bcomps?\b|transactions?|priced|valu(e|ation)|sold for", "find_sales_comps"),
        (r"acquisition|purchase price|underwrit|price (rises|increases|goes up)|investment case", "underwrite_acquisition"),
        (r"tenant|occupan|vacan|lease|available space", "analyze_occupancy"),
        (r"candidates? for (conversion|redevelopment)|conversion candidates|redevelopment candidates|off.market|adaptive reuse", "find_off_market_candidates"),
        (r"residential|homes?|apartments?|neighbo|community", "analyze_residential_impact"),
        (r"submarket|market (stats|context|compar)|houston and|los angeles", "analyze_submarket"),
        (r"assembl|adjacent|next door|neighbouring parcels", "find_adjacent_properties"),
        (r"matterport|\bscans?\b|walk ?through|virtual tour", "get_matterport_model"),
        (r"(could|can) (this|the) (building|property)|convert (this|it)|be converted|conversion (check|screen)", "evaluate_conversion"),
        (r"diligence|data gaps|missing (data|evidence)", "identify_data_gaps"),
        (r"memo|recommend|worth pursuing|investment committee", "generate_investment_memo"),
        (r"dossier|everything about", "get_property_intelligence"),
    ]
    if INTEL and re.search(r"find the best|shortlist|deal to design|under a \$|budget", s):
        a = {"market": "Los Angeles" if "los angeles" in s else "Houston"}
        m = re.search(r"(\d+(?:\.\d+)?)\s*mw", s)
        if m:
            a["mw_it"] = float(m.group(1))
        b = re.search(r"\$\s*(\d+(?:\.\d+)?)\s*(m|million|b|billion)", s)
        if b:
            a["budget"] = float(b.group(1)) * (1e9 if b.group(2).startswith("b") else 1e6)
        return [{"name": "deal_to_design", "args": a}]
    picked: list[dict[str, Any]] = []
    calls_before, calls = calls, picked  # CoStar intelligence answers replace the generic search when one matches
    for rx, tool in intel:
        if tool in INTEL and re.search(rx, s) and not wi:
            if tool == "find_off_market_candidates":
                calls.append({"name": tool, "args": {"market": "Los Angeles" if "los angeles" in s else "Houston",
                                                     "category": "industrial_conversion" if "conversion" in s else "data_center_redevelopment"}})
            elif tool == "analyze_submarket" and not pid:
                calls.append({"name": tool, "args": {"compare": "markets"} if "los angeles" in s and "houston" in s else {"market": "Houston"}})
            elif pid:
                args: dict[str, Any] = {"parcel_id": pid}
                pm = re.search(r"(\d+(?:\.\d+)?)\s*%", s)
                if tool == "underwrite_acquisition":
                    args.update(mw_it=float(b.get("mw_it", 20)), rack_kw=float(b.get("rack_kw", 20)))
                    if pm:
                        args["price_change_pct"] = float(pm.group(1)) * (-1 if re.search(r"drop|fall|lower|decreas", s) else 1)
                if tool == "evaluate_conversion":
                    mm = re.search(r"(\d+(?:\.\d+)?)\s*mw", s)
                    args["mw_it"] = float(mm.group(1)) if mm else 10.0
                calls.append({"name": tool, "args": args})
            if len(calls) >= 2:
                break
    if picked:
        return picked
    calls = calls_before
    if re.search(r"compar|which (concept|layout|option)|cheaper|best|rank", s) and not wi:
        calls.append({"name": "CompareConcepts", "args": {}})
    if re.search(r"risk|go wrong|concern|issue|fail|unknown", s):
        calls.append({"name": "ReviewRisks", "args": {}})
    code = re.search(r"\b([a-z]{1,5}-\d{1,2}[a-z]?|gen)\b", s)
    if code:
        calls.append({"name": "InspectObject", "args": {"code": code.group(1).upper()}})
    elif cx.selected and re.search(r"\b(this|here|it|selected|why)\b", s) and not wi and not re.search(r"costar|propert", s):
        calls.append({"name": "InspectObject", "args": {"code": cx.selected}})
    if re.search(r"costar|property|building|land price|sale|listing|matterport|site", s) and not any(c["name"].startswith("Costar") for c in calls) and cx.parcel_id:
        calls.append({"name": "CostarProperty", "args": {}})
    if not calls:
        calls = [{"name": "InspectObject", "args": {"code": cx.selected}}] if cx.selected else [{"name": "CompareConcepts", "args": {}}]
    return calls


# --------------------------------------------------------------------------------------------------- LLM
_SYSTEM_PLAN = (
    "You are the planning step of PlotStar, a data center development studio. Pick the tools that answer the user's "
    "request about the current project. Every number must come from a tool, so call tools rather than answering from "
    "memory. Use WhatIf for any change to the design (density, racks, cooling, redundancy, halls, storeys, expansion, "
    "capacity, rent); it previews and never applies. 'Here' or 'this' refers to the selected object. Rack density is "
    "one value for the whole building in this engine, so a per-hall change is modelled as a building-wide change. "
    "Call several tools at once when the question needs them. If the request is unrelated to the project, call no tool. "
    "For real-estate questions use the CoStar intelligence tools: find_sales_comps (comparables, 'why is it priced', 'most "
    "relevant transactions'), underwrite_acquisition (acquisition value into NPV; price_change_pct for 'if the price rises 15%'), "
    "analyze_occupancy (tenants, availability, leases), find_off_market_candidates (conversion candidates), "
    "analyze_residential_impact (homes and apartments nearby), analyze_submarket (submarkets, markets), "
    "compare_property_portfolio, find_adjacent_properties (assemblage), evaluate_conversion (fit an existing building), "
    "get_matterport_model, identify_data_gaps, generate_investment_memo, get_property_intelligence (full dossier), "
    "search_costar_properties, and deal_to_design for 'find the best property for N MW under a budget'. parcel_id defaults to "
    "the selected site.")

_SYSTEM_ANSWER = (
    "You are PlotStar's copilot. Answer the user in at most 5 short plain sentences, using only the FACTS JSON. Copy "
    "every figure exactly as written in FACTS; do not compute, convert or round any number. Lead with the direct answer. "
    "Say 'estimated' once when giving cost, energy, water or carbon. Never say grid capacity is available; it is "
    "unconfirmed. If a fact is unknown, say so. Do not mention tools, JSON or this instruction. If a change is a "
    "preview, say the user can apply it.")


def _llm(effort: str):
    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(model=MODEL, max_tokens=4000, output_config={"effort": effort},
                         default_request_timeout=45, max_retries=1)


def llm_ready() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _text(msg: Any) -> str:
    c = getattr(msg, "content", "")
    if isinstance(c, str):
        return c.strip()
    return "".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()


# --------------------------------------------------------------------------------------------------- graph


class State(TypedDict, total=False):
    question: str
    req: dict
    history: list[dict]
    calls: list[dict]
    planned_by: str
    results: list[dict]
    facts: dict
    flags: list[str]
    answer: str
    written_by: str
    proposal: dict | None
    trace: Annotated[list, add]


_CTX: dict[str, Ctx] = {}  # per-run Ctx, keyed by run id (kept out of the checkpointed state)
_GRID_FN: Callable[[], dict] | None = None


def _ctx(state: State) -> Ctx:
    return _CTX[state["req"]["_run"]]


def _context_line(cx: Ctx) -> str:
    b = cx.req["brief"]
    c = cx.concept()
    site = cx.req.get("site") or {}
    where = (site.get("id") or "no site") if not LLM_COSTAR else (site.get("name") or site.get("id") or "no site")
    return (f"Stage: {cx.stage}. Brief: {b['mw_it']:g} MW IT, {b.get('rack_kw', 20):g} kW/rack, {b.get('redundancy')}, "
            f"{b.get('cooling')} cooling, {b.get('storeys', 1)} storey(s), halls {b.get('halls') or 'auto'}. "
            f"Active concept: {c['name']} (rank {c['rank']}). Selected object: {cx.selected or 'none'}. Site: {where}.")


def n_plan(state: State) -> dict:
    t0 = time.time()
    cx = _ctx(state)
    calls, by = None, "Rule planner (no model key)"
    if llm_ready():
        try:
            from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
            msgs: list[Any] = [SystemMessage(_SYSTEM_PLAN + "\n\n" + _context_line(cx))]
            for h in (state.get("history") or [])[-4:]:
                msgs += [HumanMessage(h["q"]), AIMessage(h["a"])]
            msgs.append(HumanMessage(state["question"]))
            ai = _llm("low").bind_tools(list(TOOLS.values())).invoke(msgs)
            calls = [{"name": tc["name"], "args": TOOLS[tc["name"]](**tc["args"]).model_dump(exclude_none=True)}
                     for tc in ai.tool_calls if tc["name"] in TOOLS]
            by = f"Claude ({MODEL}) via LangChain tool calling"
            if not calls:
                calls = []
        except Exception as e:  # unreachable, quota, invalid args: fall back, never fail the request
            calls, by = None, f"Rule planner ({type(e).__name__} from the model)"
    if calls is None:
        calls = rule_plan(state["question"], cx)
    return dict(calls=calls[:4], planned_by=by,
                trace=[dict(node="plan", by=by, ms=round((time.time() - t0) * 1000), tools=[c["name"] for c in calls[:4]])])


def n_act(state: State) -> dict:
    t0 = time.time()
    cx = _ctx(state)
    _ = cx.base  # compute the shared base run once before fanning out

    def one(call: dict) -> dict:
        t = time.time()
        try:
            out = RUN[call["name"]](cx, **call["args"])
        except Exception as e:  # a tool error is reported, not raised
            out = dict(ok=False, error=f"{type(e).__name__}: {e}", headline=f"{call['name']} failed: {e}")
        return dict(name=call["name"], args=call["args"], output=out, ms=round((time.time() - t) * 1000))

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(one, state["calls"]))
    for i, r in enumerate(results):
        if r["output"].get("costar") and r["output"].get("ok"):  # failures carry only an error message, no kit data
            cx.vault[i] = r["output"]
            r["output"] = dict(ok=r["output"].get("ok", False), costar=True, vault=i, headline="[CoStar record held outside the trace]")
    return dict(results=results, trace=[dict(node="act", ms=round((time.time() - t0) * 1000),
                                             tools=[f"{r['name']} ({r['ms']} ms{'' if r['output'].get('ok') else ', no result'})" for r in results])])


def _flatten(results: list[dict], allow_costar: bool, vault: dict[int, dict] | None = None) -> dict[str, Any]:
    facts: dict[str, Any] = {}
    for r in results:
        o = r["output"]
        if o.get("costar") and not allow_costar:
            facts[r["name"]] = "A CoStar record is shown to the user next to this answer; refer to it without quoting its figures."
            continue
        if o.get("costar"):
            o = (vault or {}).get(o.get("vault"), o)
        keep = {k: v for k, v in o.items() if k in ("headline", "facts", "why", "checks", "note", "table", "ranking_note",
                                                    "items", "record", "records", "total", "filters")}
        if r["name"] == "WhatIf" and o.get("ok"):
            cons = o["consequences"]
            keep["changed"] = [f"{x['metric']}: {x['before_text']} → {x['after_text']}" for x in cons["changed"]]
            keep["checks that changed"] = [f"{k['name']}: {'pass' if k['after'] else 'fail'} ({k['detail']})" for k in cons["check_flips"]]
            keep["still fits the site"] = cons["feasible_after"]
        facts[r["name"]] = keep
    return facts


def n_verify(state: State) -> dict:
    t0 = time.time()
    flags: list[str] = []
    proposal = None
    for r in state["results"]:
        o = r["output"]
        if not o.get("ok"):
            flags.append(o.get("headline") or o.get("error") or f"{r['name']} returned nothing")
        if r["name"] == "WhatIf" and o.get("ok"):
            cons = o["consequences"]
            if not cons["feasible_after"]:
                flags.append("The changed layout does not fit the site; applying it would leave this concept infeasible.")
            for k in cons["check_flips"]:
                if not k["after"]:
                    flags.append(f"New failed check after the change: {k['name']}.")
            proposal = dict(patch=o["patch"], concept_id=cons["concept_id"], consequences=cons)
    facts = _flatten(state["results"], LLM_COSTAR, _ctx(state).vault)
    return dict(facts=facts, flags=flags, proposal=proposal,
                trace=[dict(node="verify", ms=round((time.time() - t0) * 1000), flags=len(flags))])


_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "").rstrip(".") for n in _NUM.findall(text)}


def n_respond(state: State) -> dict:
    t0 = time.time()
    fallback = " ".join(r["output"].get("headline", "") for r in state["results"] if not r["output"].get("costar")).strip()
    if state.get("flags"):
        fallback += " Note: " + " ".join(state["flags"])
    answer, by = fallback, "Built from the computed numbers (no model)."
    # CoStar records stay out of the prompt unless allowed, so their summary is quoted as computed, never reworded
    held = [] if LLM_COSTAR else [r for r in state["results"] if r["output"].get("costar") and r["output"].get("ok")]
    rest = [r for r in state["results"] if r not in held]
    if held and not rest:
        return dict(answer=fallback, written_by="Quoted from the CoStar Data Extract (CoStar fields are not sent to the model or traces).",
                    trace=[dict(node="respond", by="CoStar record", ms=round((time.time() - t0) * 1000))])
    if llm_ready() and rest:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            payload = json.dumps({"facts": state["facts"], "warnings": state.get("flags") or []}, ensure_ascii=False, default=str)
            ai = _llm("low").invoke([SystemMessage(_SYSTEM_ANSWER),
                                     HumanMessage(f"QUESTION: {state['question']}\n\nFACTS:\n{payload}")])
            text = _text(ai)
            allowed = _numbers(payload) | _numbers(state["question"]) | {"1", "2", "3", "10"}
            stray = sorted(_numbers(text) - allowed)
            if text and not stray:
                answer, by = text, f"Written by Claude ({MODEL}) from the computed facts; every figure was checked against them."
                if held:
                    by += " The CoStar summary is quoted from the record."
            elif stray:
                by += f" A model draft was discarded because it used numbers that were not computed ({', '.join(stray[:4])})."
        except Exception as e:
            by += f" The model was not reachable ({type(e).__name__})."
    return dict(answer=answer, written_by=by, trace=[dict(node="respond", by=by.split(';')[0], ms=round((time.time() - t0) * 1000))])


def _route_after_plan(state: State) -> str:
    return "act" if state.get("calls") else "respond"


def build_graph():
    from langgraph.graph import END, START, StateGraph
    g = StateGraph(State)
    g.add_node("plan", n_plan)
    g.add_node("act", n_act)
    g.add_node("verify", n_verify)
    g.add_node("respond", n_respond)
    g.add_edge(START, "plan")
    g.add_conditional_edges("plan", _route_after_plan, {"act": "act", "respond": "respond"})
    g.add_edge("act", "verify")
    g.add_edge("verify", "respond")
    g.add_edge("respond", END)
    from . import mongo
    saver, where = mongo.checkpointer()  # conversation memory on Atlas when reachable, else process memory
    MEMORY["backend"] = where
    return g.compile(checkpointer=saver)


_GRAPH = None
MEMORY: dict[str, Any] = {"backend": None}


def ask(question: str, req: dict[str, Any], thread_id: str, grid_fn: Callable[[], dict]) -> dict[str, Any]:
    """Run one copilot turn. `thread_id` keeps the conversation (LangGraph checkpointer) for follow-up questions."""
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    run = uuid.uuid4().hex
    cx = _CTX[run] = Ctx(req, grid_fn)
    trace_id = uuid.uuid4()  # the LangSmith root run id, so the UI can name the exact trace
    cfg = {"configurable": {"thread_id": thread_id}, "run_name": "plotstar-copilot", "tags": ["plotstar", "studio"],
           "run_id": trace_id}
    prev = _GRAPH.get_state(cfg).values if thread_id else {}
    history = list(prev.get("history") or [])
    seen = len(prev.get("trace") or [])  # the checkpointed trace accumulates; report only this turn
    t0 = time.time()
    try:
        out = _GRAPH.invoke({"question": question, "req": {"_run": run}, "history": history, "trace": [],
                             "calls": [], "results": [], "flags": [], "proposal": None}, cfg)
    finally:
        _CTX.pop(run, None)
    history.append({"q": question, "a": out["answer"]})  # no CoStar text, so later turns' traces stay clean
    _GRAPH.update_state(cfg, {"history": history[-8:]})
    results = [{**r, "output": cx.vault.get(r["output"].get("vault"), r["output"])} if r["output"].get("costar") else r
               for r in out["results"]]
    costar_text = " ".join(r["output"]["headline"] for r in results if r["output"].get("costar") and r["output"].get("headline"))
    answer = " ".join(x for x in (out["answer"], costar_text) if x).strip()
    return dict(answer=answer, written_by=out["written_by"], planned_by=out["planned_by"],
                tools=[dict(name=r["name"], args=r["args"], ms=r["ms"], ok=bool(r["output"].get("ok")),
                            output={k: v for k, v in r["output"].items() if k not in ("consequences",)}) for r in results],
                proposal=out.get("proposal"), flags=out.get("flags") or [], trace=out["trace"][seen:],
                ms=round((time.time() - t0) * 1000), thread_id=thread_id,
                langsmith=dict(run_id=str(trace_id), project=os.getenv("LANGSMITH_PROJECT") or "default") if TRACING else None)


def status() -> dict[str, Any]:
    return dict(model=MODEL if llm_ready() else None, llm=llm_ready(),
                framework=f"LangGraph StateGraph (plan, act, verify, respond); memory: {MEMORY['backend'] or 'not started'}",
                tools=list(TOOLS), costar_to_llm=LLM_COSTAR, langsmith=TRACING, costar_store=db_ready(),
                note=("CoStar records are shown to the user but kept out of model prompts (set COPILOT_LLM_COSTAR=1 once the "
                      "sponsor confirms kit data may go to an outside AI provider).") if not LLM_COSTAR else "CoStar fields may be sent to the model.")
