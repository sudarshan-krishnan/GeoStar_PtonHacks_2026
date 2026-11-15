"""Turn the CoStar hackathon kit into AI-ready building candidates.

    python bridge/costar_sites.py                 # kit in Data/costar-kit; reuses earlier FEMA answers
    python bridge/costar_sites.py --media         # also cache scan and aerial images for the finalists
    python bridge/costar_sites.py --refresh-fema  # re-query FEMA for every site

Reads the kit (never runs anything in it), keeps the Houston industrial, flex and land
properties and, for each one:
  * screens it with the website's gates: FEMA flood zone, homes nearby, grid access
    (web/data/houston-grid.json);
  * reads the building facts a data center conversion depends on: clear height, slab,
    column spacing, sprinklers, docks, electrical service;
  * scores readiness with fixed, documented rules and places it in the funnel
    (candidate -> passes the gates -> usable shell -> heavy power = finalist).

Writes web/data/costar-sites.json and, with --media, web/data/media/<id>/ (public Matterport
snapshots and an aerial photo per finalist). Both hold CoStar-derived data: gitignored.
"""

import argparse
import base64
import collections
import csv
import json
import math
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOUSTON_MARKET = 14
KEEP_TYPES = {"Industrial", "Flex", "Land"}
FEMA = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
MATTERPORT_MODEL = "https://my.matterport.com/api/v1/player/models/{}/"
ESRI_EXPORT = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export"
USER_AGENT = "SiteStar-hackathon/0.1"
HOMES_BUFFER_KM = 0.5   # same default as the website (team assumption)
SEARCH_KM = 3
KM_LAT = 111.32
CLEAR_MIN_FT = 24       # usable shell for a data hall with overhead power and containment
CLEAR_IDEAL_FT = 30
SLAB_MIN_IN = 6
COLUMN_GOOD_FT = 40
HALL_SHARE, HALL_W_PER_SF, PHASE_CAP_MW = 0.5, 150, 30  # first-phase sizing (planning assumption)
AERIAL_M = 700          # aerial photo side, metres


def km_lon(lat):
    return 111.32 * math.cos(math.radians(lat))


class Enums:
    def __init__(self, path):
        self.e = json.loads(path.read_text())

    def __call__(self, enum, value):
        return self.e.get(enum, {}).get(str(value)) if value is not None else None


def pretty_subtype(sub, ptype):
    if not sub or sub == "Unknown":
        return ptype
    s = sub.split("_", 1)[-1]
    s = s.replace("RAndD", "R&D").replace("OrColdStorage", " or cold storage")
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s).capitalize()


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# ---------------------------------------------------------------- screening (mirrors web/js/screener.js)

class Grid:
    def __init__(self, path):
        g = json.loads(path.read_text())
        self.g = g
        self.bits = base64.b64decode(g["residential"]["bits"])

    def inside(self, lat, lon):
        b = self.g["bbox"]
        return b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]

    def homes(self, lat, lon):
        """(km, lat, lon) of the nearest residential cell edge within SEARCH_KM, else None."""
        r, b = self.g["residential"], self.g["bbox"]
        r0 = math.floor((lat - b["south"]) / r["cell_lat"])
        c0 = math.floor((lon - b["west"]) / r["cell_lon"])
        span = math.ceil(SEARCH_KM / (r["cell_lat"] * KM_LAT)) + 1
        kx = km_lon(lat)
        best = None
        for row in range(r0 - span, r0 + span + 1):
            if not 0 <= row < r["rows"]:
                continue
            for col in range(c0 - span, c0 + span + 1):
                if not 0 <= col < r["cols"]:
                    continue
                i = row * r["cols"] + col
                if not (self.bits[i >> 3] >> (i & 7)) & 1:
                    continue
                la0 = b["south"] + row * r["cell_lat"]
                lo0 = b["west"] + col * r["cell_lon"]
                py = min(max(lat, la0), la0 + r["cell_lat"])
                px = min(max(lon, lo0), lo0 + r["cell_lon"])
                d = math.hypot((px - lon) * kx, (py - lat) * KM_LAT)
                if best is None or d < best[0]:
                    best = (d, py, px)
        return best if best is not None and best[0] <= SEARCH_KM else None

    def substation(self, lat, lon):
        kx = km_lon(lat)
        best = None
        for slon, slat, kv, name, op in self.g["substations"]:
            d = math.hypot((slon - lon) * kx, (slat - lat) * KM_LAT)
            if best is None or d < best["km"]:
                best = {"km": round(d, 3), "kv": kv, "name": name, "lat": slat, "lon": slon}
        return best

    def line(self, lat, lon, kv="345"):
        """(km, lat, lon) of the closest point on a line of this voltage."""
        kx = km_lon(lat)
        best = (math.inf, None, None)
        for flat in self.g["lines"][kv]:
            for i in range(0, len(flat) - 3, 2):
                ax, ay = (flat[i] - lon) * kx, (flat[i + 1] - lat) * KM_LAT
                bx, by = (flat[i + 2] - lon) * kx, (flat[i + 3] - lat) * KM_LAT
                dx, dy = bx - ax, by - ay
                l2 = dx * dx + dy * dy
                t = max(0.0, min(1.0, -(ax * dx + ay * dy) / l2)) if l2 else 0.0
                d = math.hypot(ax + t * dx, ay + t * dy)
                if d < best[0]:
                    best = (d, lat + (ay + t * dy) / KM_LAT, lon + (ax + t * dx) / kx)
        return best


def fema(lat, lon):
    q = urllib.parse.urlencode({
        "geometry": f"{lon:.6f},{lat:.6f}", "geometryType": "esriGeometryPoint", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
        "returnGeometry": "false", "f": "json",
    })
    try:
        j = json.loads(get(f"{FEMA}?{q}", timeout=20))
        feats = sorted((f["attributes"] for f in j.get("features", [])), key=lambda a: a.get("SFHA_TF") != "T")
        a = feats[0] if feats else {}
        return {"zone": a.get("FLD_ZONE"), "subtype": a.get("ZONE_SUBTY"), "sfha": a.get("SFHA_TF"),
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    except Exception as exc:  # network trouble: leave it for review
        return {"error": str(exc)}


def flood_status(f):
    if f is None or "error" in f or not f.get("zone"):
        return "review"
    z, sub = f["zone"].upper(), (f.get("subtype") or "").upper()
    if "FLOODWAY" in sub or z.startswith(("A", "V")) or f.get("sfha") == "T" or z == "OPEN WATER":
        return "fail"
    return "review" if z == "D" else "pass"


# ---------------------------------------------------------------- building facts and readiness

def service_kva(el):
    """Electrical service size from amps and volts. Returns (kVA, volts_assumed) or (None, False)."""
    amps = el.get("ampsHigh") or el.get("ampsLow")
    volts = el.get("voltsHigh") or el.get("voltsLow")
    if not amps:
        return None, False
    assumed = not volts
    volts = volts or 480
    three = (el.get("numElectricCurrentPhases") or 3) == 3
    return round((math.sqrt(3) if three else 1) * volts * amps / 1000), assumed


def known(v):
    return None if v in (None, "Unknown") else {"Esfr": "ESFR"}.get(v, v)


def building_facts(r, en):
    block = r.get("propertyIndustrial") or r.get("propertyFlex") or {}
    st = block.get("structural") or {}
    clear = st.get("ceilingHeightFeet")
    if clear is None and st.get("ceilingHeightInches"):
        clear = round(st["ceilingHeightInches"] / 12, 1)
    years = [e.get("year") for e in r.get("constructionEvents") or [] if e.get("year")]
    cw = st.get("columnWidthFeet") or st.get("maxColumnWidthFeet")
    cd = st.get("columnDepthFeet") or st.get("maxColumnDepthFeet")
    return {
        "clear_ft": clear,
        "slab_in": st.get("floorThicknessInches") or st.get("maxFloorThicknessInches"),
        "columns_ft": [cw, cd] if cw or cd else None,
        "sprinklers": known(en("SprinklerType", r.get("sprinklerType"))) if r.get("sprinklerType") else ("Yes" if r.get("hasSprinklers") else None),
        "docks": block.get("hasLoadingDocks"),
        "dock_count": block.get("numExternalLoadingDocks"),
        "cranes": block.get("hasCranes"),
        "stories": r.get("numStoriesAboveGrade"),
        "construction": known(en("BuildingConstructionMaterialType", r.get("buildingConstructionMaterial"))),
        "class": known(en("BuildingClass", r.get("buildingClass"))),
        "gross_sf": r.get("grossBuildingAreaSquareFeet"),
        "tenancy": known(en("TenancyType", block.get("tenancyType"))),
        "owner_occupied": block.get("isOwnerOccupied"),
        "year_built": min(years) if years else None,
        "year_latest_work": max(years) if len(years) > 1 else None,
    }


def first_phase_mw(sf):
    if not sf:
        return None
    return round(min(PHASE_CAP_MW, sf * HALL_SHARE * HALL_W_PER_SF / 1e6), 1)


def item(key, name, status, value, label, note=None):
    return {"key": key, "name": name, "status": status, "value": value, "label": label, "note": note}


def readiness(s):
    """Fixed rules. status: pass | work | fail | unknown. Returns (items, stage, verdict)."""
    b, p, sc = s["building"], s["power"], s["screen"]
    items = []
    z = (sc.get("flood") or {}).get("zone")
    items.append(item("flood", "Flood zone", sc["flood_status"] if sc["flood_status"] != "review" else "unknown",
                      f"Zone {z}" if z else "Not checked", "Sourced",
                      "FEMA 100-year floodplain (zones A and V) fails." if sc["flood_status"] == "fail" else None))
    hk = sc.get("homes_km")
    items.append(item("homes", "Nearest homes", {"pass": "pass", "fail": "fail"}.get(sc["homes_status"], "unknown"),
                      "None within 3 km" if hk is None and sc["inside_map"] else f"{hk:.1f} km" if hk is not None else "Outside the map",
                      "Estimated", f"Fails within {int(HOMES_BUFFER_KM * 1000)} m (team assumption)."))
    c = b["clear_ft"]
    items.append(item("clear", "Clear height", "unknown" if c is None else "pass" if c >= CLEAR_MIN_FT else "work" if c >= 18 else "fail",
                      "Not recorded" if c is None else f"{c:g} ft", "Sourced",
                      f"{CLEAR_MIN_FT} ft fits overhead busway and hot-aisle containment; {CLEAR_IDEAL_FT}+ ft is ideal."))
    sl = b["slab_in"]
    items.append(item("slab", "Floor slab", "unknown" if sl is None else "pass" if sl >= SLAB_MIN_IN else "work",
                      "Not recorded: verify on site" if sl is None else f"{sl:g} in", "Sourced" if sl else "Unknown",
                      "AI racks weigh 1.5 to 3 tonnes; core-test the slab before committing."))
    col = b["columns_ft"]
    if col and all(col):
        items.append(item("columns", "Column spacing", "pass" if min(col) >= COLUMN_GOOD_FT else "work",
                          f"{col[0]:g} × {col[1]:g} ft", "Sourced", "Wide bays fit long rows of racks."))
    kva, assumed = service_kva(p)
    heavy = p["heavy"]
    amps = p.get("amps")
    val = ("Heavy" if heavy else "Standard" if heavy is False else "Not recorded") + (f" · {amps:,} A" if amps else "")
    if kva:
        val += f" · ≈{kva / 1000:.1f} MVA"
    items.append(item("service", "Electrical service", "pass" if heavy else "work" if heavy is False else "unknown", val,
                      "Sourced" if not assumed else "Estimated",
                      "Size assumes 480 V, three-phase (CoStar records no voltage)." if assumed and kva else None))
    l345 = sc.get("line345_km")
    sub = sc.get("substation") or {}
    near_grid = (l345 is not None and l345 <= 3) or (sub.get("km") is not None and sub["km"] <= 2)
    items.append(item("grid", "High-voltage grid", "pass" if near_grid else "work",
                      f"345 kV line {l345:.1f} km" + (f" · substation {sub['km']:.1f} km" if sub.get("km") is not None else "") if l345 is not None else "Outside the map",
                      "Estimated", "Distance is not capacity: the utility's study decides what it can deliver."))
    if b["sprinklers"]:
        items.append(item("sprinklers", "Fire suppression", "work", f"{b['sprinklers']} sprinklers", "Sourced",
                          "A data hall needs pre-action or clean-agent suppression."))
    if b["docks"] is not None:
        items.append(item("docks", "Loading docks", "pass" if b["docks"] else "work",
                          f"{b['dock_count']} docks" if b["dock_count"] else "Yes" if b["docks"] else "None", "Sourced",
                          "Racks and switchgear arrive by truck."))
    listed = s["listing"]["active"]
    items.append(item("listing", "Availability", "pass" if listed else "unknown",
                      " and ".join(listed).capitalize() if listed else "Not listed now", "Sourced"))
    items.append(item("scan", "3D scan", "pass" if s["matterport"] else "unknown",
                      f"{len(s['matterport'])} Matterport scan{'s' if len(s['matterport']) != 1 else ''}" if s["matterport"] else "None", "Sourced"))

    gates_pass = sc["verdict"] == "pass"
    shell = gates_pass and c is not None and c >= CLEAR_MIN_FT
    finalist = shell and heavy is True
    stage = 3 if finalist else 2 if shell else 1 if gates_pass else 0
    fails = [i for i in items if i["status"] == "fail"]
    verdict = "not_suitable" if fails else "strong" if finalist else "possible"
    return items, stage, verdict


# ---------------------------------------------------------------- media for finalists

def mercator_box(lat, lon, side_m):
    R = 6378137.0
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    h = side_m / 2 / math.cos(math.radians(lat))
    return x - h, y - h, x + h, y + h


def mercator_to_ll(x, y):
    R = 6378137.0
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)


def shrink(path, max_px):
    if shutil.which("sips"):
        subprocess.run(["sips", "-Z", str(max_px), str(path)], capture_output=True, check=False)


def cache_media(site, media_root):
    d = media_root / str(site["id"])
    d.mkdir(parents=True, exist_ok=True)
    out = {"aerial": None, "scans": []}

    x0, y0, x1, y1 = mercator_box(site["lat"], site["lon"], AERIAL_M)
    q = urllib.parse.urlencode({"bbox": f"{x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f}", "bboxSR": 3857, "imageSR": 3857,
                                "size": "1000,1000", "format": "jpg", "f": "image"})
    try:
        (d / "aerial.jpg").write_bytes(get(f"{ESRI_EXPORT}?{q}"))
        s_lat, w_lon = mercator_to_ll(x0, y0)
        n_lat, e_lon = mercator_to_ll(x1, y1)
        out["aerial"] = {"file": f"data/media/{site['id']}/aerial.jpg", "side_m": AERIAL_M,
                         "bounds": [[round(s_lat, 6), round(w_lon, 6)], [round(n_lat, 6), round(e_lon, 6)]],
                         "source": "Esri World Imagery", "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    except Exception as exc:
        print(f"    aerial failed for {site['id']}: {exc}")

    for model in site["matterport"][:2]:
        try:
            meta = json.loads(get(MATTERPORT_MODEL.format(model)))
        except Exception as exc:
            print(f"    matterport {model} failed: {exc}")
            continue
        if not meta.get("is_public"):
            continue
        imgs = meta.get("images") or []
        label = lambda i: i.get("vision_generated_label") or i.get("name") or ""  # noqa: E731
        doll = [i for i in imgs if label(i) == "Dollhouse View"][:1]
        rest = [i for i in imgs if label(i) != "Dollhouse View" and not re.match(r"^\d{2}\.\d{2}\.\d{4}", label(i))
                and label(i) not in ("thumbnail",)][:3]
        shots = []
        for n, img in enumerate(doll + rest):
            f = d / f"scan-{model}-{n}.jpg"
            try:
                f.write_bytes(get(img["src"], timeout=60))
                shrink(f, 1600)
                shots.append({"file": f"data/media/{site['id']}/{f.name}", "label": label(img),
                              "kind": "dollhouse" if img in doll else "photo"})
            except Exception as exc:
                print(f"    image failed ({model}): {exc}")
            time.sleep(0.2)
        out["scans"].append({"model": model, "name": meta.get("name"), "sweeps": len(meta.get("sweeps") or {}),
                             "embed": f"https://my.matterport.com/show/?m={model}&play=1&qs=1&brand=0&help=0",
                             "images": shots, "presented_by": meta.get("presented_by")})
    return out


# ---------------------------------------------------------------- build

def build(kit: Path, grid: Grid, use_fema: bool, previous: dict):
    en = Enums(kit / "schemas" / "enums.json")

    props = []
    with open(kit / "data" / "commercial-property.jsonl") as f:
        for line in f:
            r = json.loads(line)
            a = r.get("primaryAddress") or {}
            ptype = en("PropertyType", r.get("propertyType"))
            if a.get("researchMarketId") == HOUSTON_MARKET and ptype in KEEP_TYPES and a.get("latitude"):
                props.append(r)
    ids = {r["id"] for r in props}

    listings = collections.defaultdict(list)
    with open(kit / "data" / "commercial-listing-summary.jsonl") as f:
        for line in f:
            l = json.loads(line)
            if l.get("propertyId") in ids:
                listings[l["propertyId"]].append(l)

    models = collections.defaultdict(list)
    with open(kit / "commercial-properties.csv", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("MatterportModelId") and row.get("PropertyId", "").isdigit() and int(row["PropertyId"]) in ids:
                models[int(row["PropertyId"])].append(row["MatterportModelId"])

    sites, queried = [], 0
    for n, r in enumerate(props, 1):
        a = r["primaryAddress"]
        lat, lon = a["latitude"], a["longitude"]
        ptype = en("PropertyType", r.get("propertyType"))
        block = r.get("propertyIndustrial") or r.get("propertyFlex") or {}
        el = block.get("electric") or {}
        unit = str(en("MeasurementUnit", r.get("lotSizeMeasurementType")) or "")
        lot = r.get("lotSize")
        acres = lot if "Acre" in unit else lot / 43560 if lot and "Feet" in unit else None
        street = " ".join(str(p) for p in (a.get("streetNumber"), a.get("streetName"), a.get("streetType")) if p)
        b = building_facts(r, en)

        active = [l for l in listings.get(r["id"], []) if en("ListingStatus", l.get("listingStatus")) == "Active"]
        kinds = sorted({"for sale" if "Sale" in str(en("ListingType", l.get("listingType"))) or "Auction" in str(en("ListingType", l.get("listingType"))) else "for lease" for l in active})
        asking = [p for l in active for p in ((l.get("forSaleSummary") or {}).get("askingPriceLow"), (l.get("forSaleSummary") or {}).get("askingPriceHigh")) if p]

        inside = grid.inside(lat, lon)
        homes = grid.homes(lat, lon) if inside else None
        flood = (previous.get(r["id"]) or {}).get("flood")
        if use_fema or not flood or "error" in flood:
            flood = fema(lat, lon)
            queried += 1
            time.sleep(0.15)  # be polite to FEMA's server
        fstat = flood_status(flood)
        hstat = "review" if not inside else "fail" if homes is not None and homes[0] <= HOMES_BUFFER_KM else "pass"
        verdict = "fail" if "fail" in (fstat, hstat) else "review" if "review" in (fstat, hstat) else "pass"
        l345 = grid.line(lat, lon) if inside else None
        kva, assumed = service_kva(el)

        s = {
            "id": r["id"],
            "name": r.get("buildingName") or street or f"Property {r['id']}",
            "address": f"{street}, {a.get('city')}, {a.get('state')}".strip(", "),
            "city": a.get("city"),
            "lat": lat, "lon": lon,
            "type": ptype,
            "use": pretty_subtype(en("PropertySubtype", r.get("propertySubtype")), ptype),
            "lot_acres": round(acres, 2) if acres else None,
            "building_sf": r.get("rentableBuildingAreaSquareFeet") or r.get("grossBuildingAreaSquareFeet"),
            "year_built": b["year_built"],
            "zoning": r.get("zoningDescription"),
            "building": b,
            "power": {
                "heavy": el.get("hasHeavyPower"),
                "amps": el.get("ampsHigh") or el.get("ampsLow"),
                "volts": el.get("voltsHigh") or el.get("voltsLow"),
                "phases": el.get("numElectricCurrentPhases"),
                "service_kva": kva, "volts_assumed": assumed,
            },
            "first_phase_mw": first_phase_mw(b["gross_sf"] or r.get("rentableBuildingAreaSquareFeet")),
            "listing": {"active": kinds, "asking_low": min(asking) if asking else None, "asking_high": max(asking) if asking else None},
            "parcels": (r.get("parcelNumbers") or [])[:3],
            "matterport": models.get(r["id"], []),
            "matterport_models": len(models.get(r["id"], [])),
            "screen": {
                "inside_map": inside,
                "flood": flood, "flood_status": fstat,
                "homes_km": None if homes is None else round(homes[0], 3), "homes_status": hstat,
                "homes_point": None if homes is None else [round(homes[1], 6), round(homes[2], 6)],
                "substation": grid.substation(lat, lon) if inside else None,
                "line345_km": None if l345 is None else round(l345[0], 3),
                "line345_point": None if l345 is None else [round(l345[1], 6), round(l345[2], 6)],
                "verdict": verdict,
            },
            "source": {"dataset": "CoStar Data Extract (HackPrinceton kit)", "file": "data/commercial-property.jsonl", "property_id": r["id"]},
        }
        s["ready"] = dict(zip(("items", "stage", "verdict"), readiness(s)))
        sites.append(s)
        if n % 40 == 0:
            print(f"  read {n}/{len(props)}", flush=True)

    # Order: furthest along the funnel, then known electrical service (bigger first), then distance to a
    # 345 kV line, then clear height. Power is the bottleneck, so recorded service size leads.
    sites.sort(key=lambda s: (
        -s["ready"]["stage"],
        -(s["power"]["service_kva"] or 0),
        s["screen"]["line345_km"] if s["screen"]["line345_km"] is not None else 99,
        -(s["building"]["clear_ft"] or 0),
    ))
    for i, s in enumerate(sites, 1):
        s["rank"] = i

    stages = collections.Counter(s["ready"]["stage"] for s in sites)
    lots = [s["lot_acres"] for s in sites if s["lot_acres"]]
    summary = {
        "houston_properties_in_kit": None,
        "sites": len(sites),
        "by_type": dict(collections.Counter(s["type"] for s in sites)),
        "funnel": {
            "candidates": len(sites),
            "pass_gates": sum(v for k, v in stages.items() if k >= 1),
            "usable_shell": sum(v for k, v in stages.items() if k >= 2),
            "finalists": stages.get(3, 0),
        },
        "clear_height_recorded": sum(1 for s in sites if s["building"]["clear_ft"] is not None),
        "slab_recorded": sum(1 for s in sites if s["building"]["slab_in"] is not None),
        "heavy_power": sum(1 for s in sites if s["power"]["heavy"] is True),
        "lots_10_acres_plus": sum(1 for a in lots if a >= 10),
        "largest_lot_acres": max(lots) if lots else None,
        "median_lot_acres": sorted(lots)[len(lots) // 2] if lots else None,
        "listed_now": sum(1 for s in sites if s["listing"]["active"]),
        "with_3d_scan": sum(1 for s in sites if s["matterport"]),
        "flood_fails": sum(1 for s in sites if s["screen"]["flood_status"] == "fail"),
        "homes_fails": sum(1 for s in sites if s["screen"]["homes_status"] == "fail"),
        "fema_queried_this_run": queried,
    }
    return sites, summary


def main():
    ap = argparse.ArgumentParser(description="Find CoStar's Houston buildings that could become AI data centers")
    ap.add_argument("--kit", type=Path, default=ROOT / "Data" / "costar-kit")
    ap.add_argument("--grid", type=Path, default=ROOT / "web" / "data" / "houston-grid.json")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "data" / "costar-sites.json")
    ap.add_argument("--refresh-fema", action="store_true", help="query FEMA again for every site")
    ap.add_argument("--media", action="store_true", help="cache Matterport snapshots and an aerial photo for each finalist")
    args = ap.parse_args()

    if not (args.kit / "data" / "commercial-property.jsonl").exists():
        sys.exit(f"CoStar kit not found at {args.kit} (unzip it there first)")
    previous = {}
    if args.out.exists() and not args.refresh_fema:
        try:
            previous = {s["id"]: s["screen"] for s in json.loads(args.out.read_text())["sites"]}
        except Exception:
            previous = {}
    sites, summary = build(args.kit, Grid(args.grid), args.refresh_fema, previous)

    houston = 0
    with open(args.kit / "data" / "commercial-property.jsonl") as f:
        for line in f:
            if '"researchMarketId": 14' in line or '"researchMarketId":14' in line:
                houston += 1
    summary["houston_properties_in_kit"] = houston

    if args.media:
        media_root = args.out.parent / "media"
        for s in [s for s in sites if s["ready"]["stage"] == 3]:
            print(f"  media for #{s['rank']} ({s['id']})", flush=True)
            s["media"] = cache_media(s, media_root)
    elif args.out.exists():  # keep media found by an earlier --media run
        try:
            old = {s["id"]: s.get("media") for s in json.loads(args.out.read_text())["sites"]}
            for s in sites:
                if old.get(s["id"]):
                    s["media"] = old[s["id"]]
        except Exception:
            pass

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "CoStar Data Extract, HackPrinceton Fall 2026 kit (Houston research market)",
        "screening": {
            "flood": "FEMA National Flood Hazard Layer, queried when this file was built",
            "homes": f"OpenStreetMap residential areas; fail within {int(HOMES_BUFFER_KM * 1000)} m (team assumption)",
            "grid": "OpenStreetMap substations and 345 kV lines (straight-line distance)",
            "shell": f"Clear height at least {CLEAR_MIN_FT} ft (CoStar)",
            "power": "CoStar's heavy-power flag (800 A or more)",
            "first_phase": f"{int(HALL_SHARE * 100)}% of the floor as data hall at {HALL_W_PER_SF} W per sq ft, capped at {PHASE_CAP_MW} MW (planning assumption)",
            "order": "furthest along the funnel, then recorded electrical service (bigger first), then distance to a 345 kV line, then clear height",
        },
        "summary": summary,
        "sites": sites,
    }
    args.out.write_text(json.dumps(out, separators=(",", ":")))
    print(json.dumps(summary, indent=1))
    print(f"Saved {args.out} ({args.out.stat().st_size // 1024} KB). It holds CoStar data: keep it out of git.")


if __name__ == "__main__":
    main()
