"""Import your own design: read a CAD drawing or a blueprint, then build the brief inside its footprint.

POST /blueprint/dxf     {name, text, units?}                   -> drawing (shapes in metres, layers, texts, footprint guess)
POST /blueprint/image   {name, media_type, data(base64)}       -> drawing read by Claude vision ("Read from your drawing, verify")
POST /blueprint/build   Studio generate body + footprint + notes -> the normal Studio result laid out inside that footprint,
                        a fit report (how many racks fit) and each note as a previewed brief change (never applied)

Uploads are JSON (DXF as text, images and PDFs as base64) so no multipart parser is needed. Uploaded files are not
stored or logged; an image or PDF is sent once to the Anthropic API to be read and then discarded.
"""
from __future__ import annotations

import base64
import binascii
import os
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import cad_import, config, copilot, designs, layout_engine
from .studio import Brief, GenerateIn, _grid

router = APIRouter(tags=["blueprint"])

MAX_DXF_CHARS = 10 * 1024 * 1024
MAX_FILE_BYTES = 10 * 1024 * 1024
VISION_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf")


class DxfIn(BaseModel):
    name: str = Field("drawing.dxf", max_length=200)
    text: str = Field(..., min_length=10, max_length=MAX_DXF_CHARS)
    units: str | None = Field(None, max_length=30, description="Override the drawing's unit, e.g. millimetres")
    save: bool = Field(True, description="Keep the file and its summary in MongoDB Atlas (GridFS)")
    project_id: str | None = Field(None, max_length=60)


@router.post("/blueprint/dxf")
def read_dxf(q: DxfIn) -> dict[str, Any]:
    try:
        d = cad_import.parse_dxf(q.text, q.units)
    except cad_import.DxfError as e:
        raise HTTPException(422, str(e)) from e
    d["name"] = q.name
    d["unit_options"] = list(cad_import.UNIT_NAMES)
    d["design_id"] = None
    if q.save:
        try:
            d["design_id"] = designs.save_dxf(q.name, q.text, d, q.project_id)
        except Exception:  # storage is optional; the import itself already succeeded
            d["design_id"] = None
    return d


# --------------------------------------------------------------------------------------------- blueprint images


class _Room(BaseModel):
    name: str
    x_m: float
    y_m: float
    w_m: float
    d_m: float


class _PxBox(BaseModel):
    left: float
    top: float
    right: float
    bottom: float


class _Read(BaseModel):
    is_floor_plan: bool
    units_on_drawing: str
    scale_text: str
    building_width_m: float
    building_depth_m: float
    dimensions_basis: str
    outline_px: _PxBox
    rooms: list[_Room]
    notes: list[str]


_PROMPT = (
    "This is a building plan, blueprint or sketch uploaded by a data center developer. Read it carefully.\n"
    "1. is_floor_plan: false if this is not a plan or site drawing.\n"
    "2. units_on_drawing: the units the drawing uses (for example 'feet and inches', 'metres', 'millimetres'), or 'unknown'.\n"
    "3. scale_text: any scale note or scale bar text exactly as printed (for example '1:200' or '1/8\" = 1\\'-0\"'), or ''.\n"
    "4. building_width_m and building_depth_m: the overall outside size of the main building in METRES, converted from "
    "the dimension strings if they are printed. Width is the horizontal extent on the page, depth the vertical.\n"
    "5. dimensions_basis: one short sentence on how you got the size: printed dimensions, scale bar, or estimated from "
    "proportions because nothing was printed.\n"
    "6. outline_px: the building outline's bounding box in image pixels (left, top, right, bottom). For a PDF use 0s.\n"
    "7. rooms: every labelled room or zone you can see, as rectangles in METRES measured from the building's top-left "
    "corner, x to the right and y downward. Use the label printed on the drawing as the name. Approximate is fine.\n"
    "8. notes: anything that matters for building there (north arrow, existing columns, doors, dimension conflicts).\n"
    "Never invent dimensions: if no size is printed and there is no scale, estimate and say so in dimensions_basis.")


class ImageIn(BaseModel):
    name: str = Field("blueprint", max_length=200)
    media_type: Literal["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]
    data: str = Field(..., min_length=16, max_length=int(MAX_FILE_BYTES * 1.4))


def _vision(media_type: str, b64: str) -> _Read:
    import anthropic
    block: dict[str, Any] = ({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
                             if media_type == "application/pdf"
                             else {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}})
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, timeout=120, max_retries=1)
    r = client.messages.parse(
        model=os.getenv("ANTHROPIC_MODEL") or "claude-opus-5-5", max_tokens=16000,
        output_config={"effort": "medium"},
        messages=[{"role": "user", "content": [block, {"type": "text", "text": _PROMPT}]}],
        output_format=_Read,
    )
    if r.stop_reason == "refusal":
        raise HTTPException(422, "The model declined to read this file.")
    if r.parsed_output is None:
        raise HTTPException(502, "The drawing could not be read. Try a clearer image or a DXF export.")
    return r.parsed_output


@router.post("/blueprint/image")
def read_image(q: ImageIn) -> dict[str, Any]:
    try:
        raw = base64.b64decode(q.data, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(422, "The file data is not valid base64.") from e
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(413, "The file is larger than 10 MB.")
    magic = {"image/png": raw[:8] == b"\x89PNG\r\n\x1a\n", "image/jpeg": raw[:3] == b"\xff\xd8\xff",
             "image/webp": raw[:4] == b"RIFF" and raw[8:12] == b"WEBP", "image/gif": raw[:4] == b"GIF8",
             "application/pdf": raw[:5] == b"%PDF-"}
    if not magic[q.media_type]:
        raise HTTPException(422, f"The file content does not match {q.media_type}.")
    if not config.ANTHROPIC_API_KEY:
        raise HTTPException(503, "Reading images and PDFs needs ANTHROPIC_API_KEY on the PlotStar API. DXF files work without it.")
    try:
        read = _vision(q.media_type, q.data)
    except HTTPException:
        raise
    except Exception as e:  # network, quota, bad file: no file content in the message
        raise HTTPException(502, f"The drawing could not be read ({type(e).__name__}).") from e
    if not read.is_floor_plan:
        raise HTTPException(422, "This does not look like a floor plan or site drawing.")
    W, D = max(1.0, read.building_width_m), max(1.0, read.building_depth_m)
    # model coordinates: metres from the top-left corner, y down -> plan coordinates with y up, like a DXF
    outline = [[0.0, 0.0], [W, 0.0], [W, D], [0.0, D]]
    polys = [dict(id="s1", layer="Outline", points=outline, closed=True, area_m2=round(W * D, 2), from_lines=False)]
    for k, rm in enumerate(read.rooms):
        x, w, d = max(0.0, rm.x_m), max(0.1, rm.w_m), max(0.1, rm.d_m)
        y = D - max(0.0, rm.y_m) - d
        pts = [[round(x, 3), round(y, 3)], [round(x + w, 3), round(y, 3)], [round(x + w, 3), round(y + d, 3)], [round(x, 3), round(y + d, 3)]]
        polys.append(dict(id=f"s{k + 2}", layer="Rooms", points=pts, closed=True, area_m2=round(w * d, 2), from_lines=False, label=rm.name[:60]))
    texts = [dict(layer="Rooms", x=p["points"][0][0] + 0.5, y=p["points"][0][1] + 0.5, h=1.0, text=p["label"]) for p in polys[1:]]
    warnings = ["Sizes and rooms were read from your drawing by Claude. Check them against the printed dimensions before building."]
    if "estimat" in read.dimensions_basis.lower():
        warnings.append("No printed dimensions or scale were found, so the overall size is an estimate.")
    return dict(kind="image" if q.media_type != "application/pdf" else "pdf", name=q.name, label="Read from your drawing, verify",
                units="metres", units_assumed=False, scale_to_m=1.0, units_on_drawing=read.units_on_drawing,
                scale_text=read.scale_text, dimensions_basis=read.dimensions_basis,
                outline_px=read.outline_px.model_dump() if q.media_type != "application/pdf" else None,
                layers=[dict(name="Outline", shapes=1), dict(name="Rooms", shapes=len(read.rooms))],
                polygons=polys, texts=texts, bbox=dict(x=0.0, y=0.0, w=W, d=D),
                footprint=dict(source="building outline read from your drawing", shape_id="s1", layer="Outline", area_m2=round(W * D, 2),
                               cx=W / 2, cy=D / 2, w=max(W, D), d=min(W, D), angle_deg=0.0 if W >= D else 90.0),
                footprint_label="Read from your drawing, verify", notes=read.notes[:20], warnings=warnings,
                model=os.getenv("ANTHROPIC_MODEL") or "claude-opus-5-5")


# --------------------------------------------------------------------------------------------- build inside the footprint


class Footprint(BaseModel):
    w: float = Field(..., ge=20, le=5000, description="Long side in metres")
    d: float = Field(..., ge=20, le=5000, description="Short side in metres")
    angle_deg: float = Field(0, ge=-180, le=180)
    source: str = Field("", max_length=120)


class Note(BaseModel):
    id: str = Field(..., max_length=20)
    text: str = Field(..., min_length=1, max_length=400)
    x: float | None = None
    y: float | None = None


class BuildIn(GenerateIn):
    footprint: Footprint
    notes: list[Note] = Field(default_factory=list, max_length=40)
    drawing_name: str = Field("", max_length=200)
    design_id: str | None = Field(None, max_length=40)
    project_id: str | None = Field(None, max_length=60)


def _fits(r: dict[str, Any]) -> dict | None:
    """The best concept that places every rack inside the envelope, if any."""
    ok = [c for c in r["concepts"] if c["feasible"] and c["metrics"]["placed_racks"] >= r["brief"]["racks"]]
    return min(ok, key=lambda c: c["rank"]) if ok else None


def _max_mw(brief: dict, site: dict, grid: dict, pr: dict, ov: dict) -> float | None:
    """Largest IT capacity (same density, halls on auto) whose layout fits the footprint. Bisection on the engine."""
    lo, hi = 0.5, float(brief["mw_it"])
    b = {**brief, "halls": None}
    best = None
    for _ in range(9):
        mid = round((lo + hi) / 2, 2)
        try:
            ok = _fits(layout_engine.generate({**b, "mw_it": mid}, site, grid, pr, ov)) is not None
        except ValueError:
            ok = False
        if ok:
            best, lo = mid, mid
        else:
            hi = mid
        if hi - lo < 0.1:
            break
    return best


@router.post("/blueprint/build")
def build(q: BuildIn) -> dict[str, Any]:
    fp = q.footprint
    brief = {**q.brief.model_dump(), "env_w": round(fp.w, 2), "env_d": round(fp.d, 2)}
    Brief(**brief)  # same limits as the Studio
    site, grid = q.site.model_dump(), _grid()
    edits = {k: e.model_dump() for k, e in q.edits.items()}
    try:
        result = layout_engine.generate(brief, site, grid, q.priorities, q.assumptions, edits)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

    best = _fits(result)
    racks = result["brief"]["racks"]
    if best:
        fit = dict(fits=True, concept=best["name"], racks=racks, max_racks=None, max_mw=None,
                   text=f"Your {fp.w:.0f} x {fp.d:.0f} m footprint holds the whole brief: {racks:,} racks in {best['name']} "
                        f"uses {best['metrics']['footprint_m2']:,} of {fp.w * fp.d:,.0f} m2.")
    else:
        mw = _max_mw(brief, site, grid, q.priorities, q.assumptions)
        kw = result["brief"]["rack_kw"]
        n = int(mw * 1000 / kw) if mw else 0
        fit = dict(fits=False, concept=None, racks=racks, max_racks=n, max_mw=mw,
                   text=(f"Your {fp.w:.0f} x {fp.d:.0f} m footprint is too small for {racks:,} racks. At {kw:g} kW per rack it holds "
                         f"about {n:,} racks ({mw:g} MW IT)." if mw else
                         f"Your {fp.w:.0f} x {fp.d:.0f} m footprint is too small for even 0.5 MW at {kw:g} kW per rack."))
    if fp.angle_deg not in (0, 90, -90, 180, -180):
        fit["text"] += f" Your building sits at {fp.angle_deg:g} degrees; PlotStar lays it out square to the site and keeps your width and depth."

    # each note -> a previewed brief change through the copilot's rule planner; never applied here
    req = dict(brief=brief, site=site, priorities=q.priorities, assumptions=q.assumptions, edits=edits,
               concept_id=(best or result["concepts"][0])["id"], selected=None, stage="Generate")
    cx = copilot.Ctx(req, lambda: grid)
    cx._base = result
    previews = []
    for note in q.notes:
        wi = next((c for c in copilot.rule_plan(note.text, cx) if c["name"] == "WhatIf"), None)
        if not wi:
            previews.append(dict(note_id=note.id, text=note.text, understood=False, patch=None,
                                 summary="Kept as a design note. PlotStar could not turn it into a change to the brief."))
            continue
        try:
            out = copilot.t_what_if(cx, **wi["args"])
        except (ValueError, TypeError) as e:
            out = dict(ok=False, headline=f"Could not preview this change: {e}")
        previews.append(dict(note_id=note.id, text=note.text, understood=bool(out.get("ok")), patch=out.get("patch"),
                             summary=out.get("headline", ""),
                             changed=[dict(metric=r["metric"], before=r["before_text"], after=r["after_text"], better=r["better"])
                                      for r in (out.get("consequences") or {}).get("changed", [])][:10]))
    result["imported"] = dict(drawing=q.drawing_name, footprint=fp.model_dump(), label="Your drawing",
                              generated_label="Generated by PlotStar inside your footprint")
    try:
        design_id = designs.save_build(q.design_id, q.drawing_name, fp.model_dump(),
                                       [n.model_dump() for n in q.notes], fit, q.project_id)
    except Exception:
        design_id = q.design_id
    return dict(result=result, fit=fit, notes=previews, design_id=design_id)


@router.get("/blueprint/designs")
def list_designs(limit: int = 30) -> dict[str, Any]:
    rows = designs.listing(max(1, min(100, limit)))
    if rows is None:
        raise HTTPException(503, "MongoDB Atlas is not reachable, so saved designs are unavailable.")
    return {"designs": rows}


@router.get("/blueprint/designs/{design_id}")
def get_design(design_id: str) -> dict[str, Any]:
    d = designs.get(design_id)
    if d is None:
        raise HTTPException(404, "No such design")
    return d


@router.get("/blueprint/designs/{design_id}/file")
def get_design_file(design_id: str) -> dict[str, Any]:
    t = designs.file_text(design_id)
    if t is None:
        raise HTTPException(404, "No stored file for this design")
    return {"design_id": design_id, "text": t}
