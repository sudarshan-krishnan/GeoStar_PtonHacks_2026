"""Studio: design brief -> three conceptual layouts with Money / People / Planet / Resources evidence.

POST /studio/generate   brief + site + priorities -> concepts, metrics, checks, assumptions
POST /studio/explain    the same request + a concept id -> a short plain-language summary (Gemini writes, numbers are ours)
GET  /studio/defaults   sizing defaults for a capacity (halls, site size) so the form can pre-fill
"""
from __future__ import annotations

import math
import re
import threading
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
import httpx
from pydantic import BaseModel, Field

from .. import assumptions as A
from .. import config, grid, layout_engine, store

router = APIRouter(tags=["studio"])


class Brief(BaseModel):
    name: str = Field("Untitled project", max_length=120)
    mw_it: float = Field(..., gt=0.5, le=500)
    rack_kw: float = Field(20, ge=3, le=200)
    redundancy: Literal["N", "N+1", "2N"] = "N+1"
    cooling: Literal["air", "hybrid", "water", "liquid"] = "liquid"
    halls: int | None = Field(None, ge=1, le=24)
    site_w: float = Field(..., ge=60, le=5000)
    site_d: float = Field(..., ge=60, le=5000)
    setback_m: float = Field(8, ge=0, le=100)
    env_w: float | None = Field(None, ge=20, le=5000)
    env_d: float | None = Field(None, ge=20, le=5000)
    expansion_pct: float = Field(10, ge=0, le=80)
    flexible_share: float = Field(0, ge=0, le=0.6)
    storeys: int = Field(1, ge=1, le=3)
    rent_kw_month: float | None = Field(None, ge=20, le=600)


class SiteIn(BaseModel):
    id: str | None = Field(None, max_length=120)
    name: str | None = Field(None, max_length=160)
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    gates: list[dict[str, Any]] = Field(default_factory=list, max_length=12)
    land_cost: float | None = Field(None, ge=0, le=5e9)
    land_label: str | None = Field(None, max_length=20)
    land_basis: str | None = Field(None, max_length=200)


class Offset(BaseModel):
    dx: float = Field(0, ge=-3000, le=3000)
    dy: float = Field(0, ge=-3000, le=3000)


class Pos(BaseModel):
    x: float = Field(..., ge=-3000, le=8000)
    y: float = Field(..., ge=-3000, le=8000)


class Added(Pos):
    code: str = Field(..., max_length=24, pattern=r"^[A-Za-z0-9-]+$")
    type: Literal["yard_bess", "yard_solar", "yard_water", "yard_parking", "yard_wall", "yard_trees", "yard_guard"]
    w: float = Field(..., ge=1, le=800)
    d: float = Field(..., ge=1, le=800)


class ConceptEdit(BaseModel):
    building: Offset = Field(default_factory=Offset)
    rotate: bool = False
    yard: dict[str, Pos] = Field(default_factory=dict)
    added: list[Added] = Field(default_factory=list, max_length=24)


class GenerateIn(BaseModel):
    edits: dict[str, ConceptEdit] = Field(default_factory=dict)
    brief: Brief
    site: SiteIn = Field(default_factory=SiteIn)
    priorities: dict[str, float] = Field(default_factory=dict)
    assumptions: dict[str, float] = Field(default_factory=dict)


_refreshing = False


def _grid() -> dict[str, Any]:
    """The cached grid day plus every cached price day. The first call starts one background fetch of recent days."""
    global _refreshing
    out = grid.grid_day(offline=True)
    hit = grid.dam_days(offline=True)
    days = hit["payload"]["days"] if hit else []
    if len(days) < 7 and not _refreshing:
        _refreshing = True
        threading.Thread(target=lambda: grid.dam_days(7), daemon=True).start()
    if days:
        out["days"] = days
        out["price_label"] = "Sourced"
        out["price_source"] = (f"{hit['source']}, {len(days)} delivery days {days[0]['date']} to {days[-1]['date']}, "
                               f"retrieved {hit['retrieved_at']}")
        out["notes"] = [*out.get("notes", []), "Hourly carbon uses the latest fuel-mix day for every price day."]
    return out


@router.post("/studio/generate")
def generate(q: GenerateIn) -> dict[str, Any]:
    bad = [k for k in q.assumptions if k not in A.ASSUMPTIONS]
    if bad:
        raise HTTPException(422, f"Unknown assumption keys: {', '.join(bad)}")
    try:
        return layout_engine.generate(q.brief.model_dump(), q.site.model_dump(), _grid(),
                                      q.priorities, q.assumptions, {k: e.model_dump() for k, e in q.edits.items()})
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.get("/studio/defaults")
def defaults(mw_it: float = 20, acres: float | None = None) -> dict[str, Any]:
    """A site rectangle for the form. From the lot's acreage when known, otherwise sized from the capacity."""
    area = acres * 4046.86 if acres else mw_it / A.value("mw_per_acre") * 4046.86
    w = math.sqrt(area * 1.3)
    return dict(halls=layout_engine.default_halls(mw_it), site_w=round(w), site_d=round(area / w),
                basis="CoStar lot size, drawn as a 1.3 : 1 rectangle" if acres
                else f"Sized from capacity at {A.value('mw_per_acre')} MW per acre (team assumption)",
                label="Estimated")


class ExplainIn(GenerateIn):
    concept_id: str = Field(..., max_length=40)


_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _usd(n: float) -> str:
    return f"${n / 1e9:.2f}B" if n >= 1e9 else f"${n / 1e6:.1f}M"


@router.post("/studio/explain")
def explain(q: ExplainIn) -> dict[str, Any]:
    """Plain-language summary of one concept. The model may only restate figures computed by the layout engine:
    any number in its reply that is not in the fact sheet makes us discard the reply and use the built-in text."""
    r = generate(q)
    c = next((k for k in r["concepts"] if k["id"] == q.concept_id), None)
    if c is None:
        raise HTTPException(404, "Unknown concept")
    b, m = r["brief"], c["metrics"]
    facts = {
        "concept": c["name"], "layout": c["strategy"],
        "capacity": f"{b['mw_it']:g} MW IT", "racks": f"{b['racks']:,} racks", "halls": f"{b['halls']} halls",
        "building footprint": f"{m['footprint_m2']:,} m2", "cost to build": _usd(c["money"]["capex"]),
        "ten-year total": _usd(c["money"]["ten_year"]), "energy cost per year": _usd(c["money"]["energy_per_year"]),
        "carbon from electricity per year": f"{c['planet']['co2_t_per_year']:,} t",
        "water per year": f"{c['resources']['water_m3_per_year']:,} m3",
        "room for future racks": f"{c['resources']['spare_positions']:,} rack positions",
        "site left open": f"{c['resources']['open_land_share'] * 100:.0f}%",
        "generator noise at the site boundary": f"{c['people']['noise_at_boundary_dba']} dBA",
        "rank among the three concepts": str(c["rank"]), "advantage": c["advantage"], "trade-off": c["tradeoff"],
        "failed checks": "; ".join(k["name"] for k in c["checks"] if not k["ok"]) or "none",
    }
    fallback = (f"{c['name']} places {facts['racks']} in {facts['halls']} on a {facts['building footprint']} building. "
                f"It is estimated at {facts['cost to build']} to build and {facts['ten-year total']} over ten years. "
                f"{c['advantage']} {c['tradeoff']}")
    out = dict(text=fallback, model="none", written_by="Built from the computed numbers (no model).", facts=facts)
    if not config.GEMINI_API_KEY:
        return out
    prompt = ("You explain one conceptual data center layout to a developer in 3 short plain sentences. "
              "Use only the facts below. Quote figures exactly as written and do not add, convert or round any number. "
              "Say what it costs, what it is good at, and its main trade-off. All figures are estimates; say so once.\n\n"
              + "\n".join(f"- {k}: {v}" for k, v in facts.items()))
    try:
        res = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{config.GEMINI_MODEL}:generateContent",
                         headers={"x-goog-api-key": config.GEMINI_API_KEY},
                         json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=25)
        res.raise_for_status()
        text = "".join(part.get("text", "") for part in res.json()["candidates"][0]["content"]["parts"]).strip()
    except Exception as e:  # network, quota or an unexpected response shape: keep the built-in text
        out["written_by"] += f" Gemini was not reachable ({type(e).__name__})."
        return out
    allowed = {n.replace(",", "") for v in facts.values() for n in _NUM.findall(v)} | {"3", "10"}
    stray = [n for n in _NUM.findall(text) if n.replace(",", "") not in allowed]
    if not text or stray:
        out["written_by"] += " A Gemini draft was discarded because it used a number that was not computed."
        return out
    return dict(text=text, model=config.GEMINI_MODEL, facts=facts,
                written_by=f"Written by Google Gemini ({config.GEMINI_MODEL}) from the computed numbers; "
                           "every figure was checked against them.")


class ProjectIn(BaseModel):
    """A saved Studio project. The analysis is not stored: it is recomputed from the brief, site and edits."""
    name: str = Field(..., max_length=120)
    market: str = Field(..., max_length=40)
    mw_it: float = Field(..., gt=0, le=500)
    status: Literal["draft", "generated", "decided"] = "draft"
    site: dict[str, Any] = Field(default_factory=dict)
    brief: dict[str, Any] = Field(default_factory=dict)
    priorities: dict[str, float] = Field(default_factory=dict)
    edits: dict[str, Any] = Field(default_factory=dict)
    preferred: str | None = Field(None, max_length=40)
    reasons: str = Field("", max_length=1200)
    decided_by: str = Field("", max_length=80)
    decided_at: str | None = Field(None, max_length=40)
    summary: dict[str, Any] = Field(default_factory=dict)


def _need(value: Any) -> Any:
    if value is None:
        raise HTTPException(503, store.status()["reason"] or "Project storage is not available.")
    return value


@router.get("/studio/store")
def store_status() -> dict[str, Any]:
    return store.status()


@router.get("/studio/projects")
def projects() -> dict[str, Any]:
    return {"projects": _need(store.listing())}


@router.get("/studio/portfolio")
def portfolio() -> dict[str, Any]:
    """Rollup across every saved project (one Atlas aggregation). Also projects near a point when lat/lon are given."""
    return _need(store.portfolio())


@router.get("/studio/projects/near")
def projects_near(lat: float, lon: float, km: float = 50) -> dict[str, Any]:
    return {"projects": _need(store.near(lat, lon, km))}


@router.put("/studio/projects/{project_id}")
def save_project(project_id: str, q: ProjectIn) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,40}", project_id):
        raise HTTPException(422, "Invalid project id")
    return _need(store.save(project_id, q.model_dump()))


@router.get("/studio/projects/{project_id}")
def load_project(project_id: str) -> dict[str, Any]:
    _need(store.listing(1))
    found = store.get(project_id)
    if not found:
        raise HTTPException(404, "No such project")
    return found


@router.delete("/studio/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, Any]:
    return {"deleted": _need(store.delete(project_id))}
