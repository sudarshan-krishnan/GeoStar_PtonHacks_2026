"""Import your own design: DXF parsing, round trip with the Studio's own DXF export, building inside a footprint,
and notes turned into previewed brief changes. No paid model calls."""
from __future__ import annotations

import base64
import math

import pytest
from fastapi.testclient import TestClient

from app.engine import cad_import as X
from app import config
from app.engine import layout_engine as L
from app.main import app
from app.routers import blueprint as B

GRID = {"price": [30 + (i % 12) * 3 for i in range(24)], "carbon": [350 + (i % 6) * 20 for i in range(24)]}
SITE = {"gates": [{"gate": "Residential proximity", "status": "Pass", "value": 400},
                  {"gate": "Grid proximity", "status": "Pass", "value": 1.5}]}
BRIEF = dict(mw_it=20, rack_kw=20, redundancy="N+1", cooling="liquid", site_w=320, site_d=240, setback_m=8,
             expansion_pct=10, flexible_share=0, storeys=1)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(B, "_grid", lambda: GRID)


client = TestClient(app)


def dxf(entities: list[str], insunits: int | None = None) -> str:
    head = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", str(insunits), "0", "ENDSEC"] if insunits is not None else []
    return "\n".join(head + ["0", "SECTION", "2", "ENTITIES", *entities, "0", "ENDSEC", "0", "EOF"])


def lw(layer: str, pts: list[tuple[float, float]], closed: bool = True) -> list[str]:
    out = ["0", "LWPOLYLINE", "8", layer, "90", str(len(pts)), "70", "1" if closed else "0"]
    for x, y in pts:
        out += ["10", f"{x}", "20", f"{y}"]
    return out


def line(layer: str, a: tuple[float, float], b: tuple[float, float]) -> list[str]:
    return ["0", "LINE", "8", layer, "10", str(a[0]), "20", str(a[1]), "11", str(b[0]), "21", str(b[1])]


def to_dxf(c: dict, site_w: float, site_d: float) -> str:
    """Python mirror of toDxf in src/components/studio/types.ts (R12, POLYLINE per room, layer = room type)."""
    out = ["0", "SECTION", "2", "ENTITIES"]

    def rect(layer, x, y, w, d):
        out.extend(["0", "POLYLINE", "8", layer, "66", "1", "70", "1"])
        for px, py in [(x, y), (x + w, y), (x + w, y + d), (x, y + d)]:
            out.extend(["0", "VERTEX", "8", layer, "10", f"{px:.3f}", "20", f"{py:.3f}", "30", "0"])
        out.extend(["0", "SEQEND"])
    rect("SITE", 0, 0, site_w, site_d)
    rect("BUILDING", c["building"]["x"], c["building"]["y"], c["building"]["w"], c["building"]["d"])
    for r in [*c["rooms"], *c["yard"]]:
        rect(r["type"].upper(), r["x"], r["y"], r["w"], r["d"])
        out.extend(["0", "TEXT", "8", "LABELS", "10", f"{r['x'] + 0.5:.3f}", "20", f"{r['y'] + 0.5:.3f}", "30", "0", "40", "1.00", "1", f"{r['code']} {r['name']}"])
    for kind in ("power", "cooling", "data"):
        for ln in c["routes"][kind]:
            for i in range(len(ln) - 1):
                out.extend(["0", "LINE", "8", f"ROUTE_{kind.upper()}", "10", f"{ln[i][0]:.3f}", "20", f"{ln[i][1]:.3f}",
                            "11", f"{ln[i + 1][0]:.3f}", "21", f"{ln[i + 1][1]:.3f}"])
    out.extend(["0", "ENDSEC", "0", "EOF"])
    return "\n".join(out)


def test_units_from_header_scale_to_metres():
    d = X.parse_dxf(dxf(lw("WALLS", [(0, 0), (10000, 0), (10000, 5000), (0, 5000)]), insunits=4))
    assert d["units"] == "millimetres" and d["units_assumed"] is False
    s = d["polygons"][0]
    assert s["closed"] and s["area_m2"] == pytest.approx(50.0)
    assert d["footprint"]["w"] == pytest.approx(10.0) and d["footprint"]["d"] == pytest.approx(5.0)


def test_unitless_is_assumed_metres_and_can_be_overridden():
    text = dxf(lw("A", [(0, 0), (100, 0), (100, 50), (0, 50)]))
    d = X.parse_dxf(text)
    assert d["units_assumed"] and d["footprint"]["w"] == pytest.approx(100) and d["warnings"]
    ft = X.parse_dxf(text, units="feet")
    assert ft["units_assumed"] is False and ft["footprint"]["w"] == pytest.approx(30.48)


def test_layers_open_closed_texts_and_line_chaining():
    ents = [*lw("WALLS", [(0, 0), (40, 0), (40, 20), (0, 20)]),
            *lw("ROUTE", [(0, 0), (5, 5), (9, 5)], closed=False),
            *line("ROOM", (2, 2), (8, 2)), *line("ROOM", (8, 2), (8, 6)), *line("ROOM", (8, 6), (2, 6)), *line("ROOM", (2, 6), (2, 2)),
            "0", "TEXT", "8", "LABELS", "10", "3", "20", "3", "40", "0.5", "1", "Data hall",
            "0", "MTEXT", "8", "LABELS", "10", "1", "20", "1", "40", "0.5", "1", r"{\fArial|b1;Plant}\PRoom",
            "0", "CIRCLE", "8", "COLS", "10", "20", "20", "10", "40", "0.5",
            "0", "INSERT", "8", "BLOCKS", "2", "DOOR", "10", "0", "20", "0"]
    d = X.parse_dxf(dxf(ents, insunits=6))
    by_layer = {p["layer"]: p for p in d["polygons"]}
    assert {l["name"] for l in d["layers"]} == {"WALLS", "ROUTE", "ROOM", "COLS"}
    assert by_layer["ROUTE"]["closed"] is False and by_layer["ROUTE"]["area_m2"] is None
    assert by_layer["ROOM"]["closed"] and by_layer["ROOM"]["from_lines"] and by_layer["ROOM"]["area_m2"] == pytest.approx(24.0)
    assert by_layer["COLS"]["area_m2"] == pytest.approx(math.pi * 0.25, rel=0.02)
    assert [t["text"] for t in d["texts"]] == ["Data hall", "Plant Room"]
    assert d["footprint"]["shape_id"] == by_layer["WALLS"]["id"] and d["footprint"]["area_m2"] == pytest.approx(800)
    assert any("INSERT" in w for w in d["warnings"])


def test_rotated_building_gets_its_true_width_depth_and_angle():
    a = math.radians(30)
    pts = [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)) for x, y in [(0, 0), (60, 0), (60, 25), (0, 25)]]
    f = X.parse_dxf(dxf(lw("B", pts), insunits=6))["footprint"]
    assert f["w"] == pytest.approx(60, abs=0.01) and f["d"] == pytest.approx(25, abs=0.01) and f["angle_deg"] == pytest.approx(30, abs=0.1)


@pytest.mark.parametrize("text, msg", [("AutoCAD Binary DXF\r\n\x1a\x00", "binary"), ("AC1027\x00\x00garbage", "DWG"),
                                       (dxf(["0", "TEXT", "8", "A", "10", "0", "20", "0", "1", "hi"]), "No plan geometry")])
def test_unreadable_files_explain_themselves(text, msg):
    with pytest.raises(X.DxfError, match=msg):
        X.parse_dxf(text)


def test_round_trip_with_the_studio_dxf_export():
    r = L.generate(BRIEF, SITE, GRID, {})
    c = r["concepts"][0]
    d = X.parse_dxf(to_dxf(c, 320, 240))
    assert d["units_assumed"]  # the Studio export is in metres but writes no $INSUNITS header
    layers = {l["name"]: l["shapes"] for l in d["layers"]}
    assert layers["DATA_HALL"] == sum(1 for x in c["rooms"] if x["type"] == "data_hall")
    building = next(p for p in d["polygons"] if p["layer"] == "BUILDING")
    assert building["area_m2"] == pytest.approx(c["building"]["w"] * c["building"]["d"], rel=1e-3)
    assert d["footprint"]["w"] == pytest.approx(320) and d["footprint"]["d"] == pytest.approx(240)  # the site is the largest shape
    assert any(t["text"].startswith("DH-01") for t in d["texts"])


def test_dxf_endpoint():
    ok = client.post("/blueprint/dxf", json={"name": "plan.dxf", "text": dxf(lw("A", [(0, 0), (90, 0), (90, 60), (0, 60)]), insunits=6)})
    assert ok.status_code == 200 and ok.json()["footprint"]["w"] == pytest.approx(90) and "metres" in ok.json()["unit_options"]
    assert client.post("/blueprint/dxf", json={"text": "hello world, not a dxf"}).status_code == 422


def body(**kw):
    return {"brief": {**BRIEF, **kw}, "site": {}, "priorities": {}}


def test_build_lays_the_brief_out_inside_the_footprint():
    r = client.post("/blueprint/build", json={**body(), "footprint": {"w": 140, "d": 110}, "notes": []}).json()
    assert r["fit"]["fits"] is True
    best = next(c for c in r["result"]["concepts"] if c["name"] == r["fit"]["concept"])
    b = best["building"]
    assert max(b["w"], b["d"]) <= 140 + 1e-6 and min(b["w"], b["d"]) <= 110 + 1e-6
    assert r["result"]["brief"]["env_w"] == 140 and r["result"]["imported"]["label"] == "Your drawing"


def test_small_footprint_reports_how_many_racks_fit():
    r = client.post("/blueprint/build", json={**body(), "footprint": {"w": 40, "d": 30}}).json()
    f = r["fit"]
    assert f["fits"] is False and 0 < f["max_racks"] < 1000
    again = L.generate({**BRIEF, "mw_it": f["max_mw"], "env_w": 40, "env_d": 30}, SITE, GRID, {})
    assert B._fits(again) is not None


def test_notes_become_previewed_changes_and_nothing_is_applied():
    notes = [{"id": "1", "text": "Use air cooling here"}, {"id": "2", "text": "Can we fit another 200 racks?"},
             {"id": "3", "text": "Paint the loading dock blue"}]
    r = client.post("/blueprint/build", json={**body(), "footprint": {"w": 160, "d": 120}, "notes": notes}).json()
    by = {n["note_id"]: n for n in r["notes"]}
    assert by["1"]["understood"] and by["1"]["patch"] == {"cooling": "air"} and by["1"]["changed"]
    assert by["2"]["patch"] == {"mw_it": 24.0}
    assert by["3"]["understood"] is False and by["3"]["patch"] is None
    assert r["result"]["brief"]["cooling"] == "liquid" and r["result"]["brief"]["mw_it"] == 20  # previews only


def test_image_endpoint_validates_and_needs_a_key(monkeypatch):
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()
    assert client.post("/blueprint/image", json={"media_type": "image/png", "data": "not base64!!!" * 3}).status_code == 422
    assert client.post("/blueprint/image", json={"media_type": "image/jpeg", "data": png}).status_code == 422  # content mismatch
    assert client.post("/blueprint/image", json={"media_type": "image/tiff", "data": png}).status_code == 422
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    r = client.post("/blueprint/image", json={"media_type": "image/png", "data": png})
    assert r.status_code == 503 and "DXF files work without it" in r.json()["detail"]
