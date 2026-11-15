"""External public datasets used by screening, cached with source and retrieval time (PRD section 9).

- FEMA National Flood Hazard Layer (NFHL): flood zone at a point.
- OpenStreetMap via Overpass: power substations in a market bounding box.

Every fetch is stored in `evidence_cache` so the demo runs offline after one warm-up, and so the audit
trail can show exactly what was retrieved and when. Failures are recorded as Unknown, never guessed.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import time

import httpx

from app.db import session

USER_AGENT = "GeoStar-hackathon/0.1"
FEMA_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

MARKET_BBOX = {  # south, west, north, east
    "Houston": (29.45, -95.95, 30.15, -94.95),
    "Los Angeles": (33.65, -118.75, 34.35, -117.85),
}

DDL = """
CREATE TABLE IF NOT EXISTS evidence_cache (
    key           TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    url           TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    retrieved_at  TEXT NOT NULL
)
"""


def init() -> None:
    with session() as c:
        c.execute(DDL)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _cached(key: str) -> dict[str, Any] | None:
    with session() as c:
        row = c.execute("SELECT * FROM evidence_cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    return {"payload": json.loads(row["payload_json"]), "source": row["source"], "url": row["url"],
            "retrieved_at": row["retrieved_at"]}


def _store(key: str, source: str, url: str, payload: Any) -> dict[str, Any]:
    now = _now()
    with session() as c:
        c.execute("INSERT OR REPLACE INTO evidence_cache VALUES (?,?,?,?,?)",
                  (key, source, url, json.dumps(payload), now))
    return {"payload": payload, "source": source, "url": url, "retrieved_at": now}


def fema_flood_zone(lat: float, lon: float, *, offline: bool = False) -> dict[str, Any] | None:
    """FEMA NFHL flood zone at a point. Returns cached evidence, or None if unavailable."""
    key = f"fema:{lat:.6f},{lon:.6f}"
    hit = _cached(key)
    if hit or offline:
        return hit
    params = {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID",
        "returnGeometry": "false", "f": "json",
    }
    try:
        r = httpx.get(FEMA_URL, params=params, timeout=30, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    if "error" in body:
        return None
    feats = [f["attributes"] for f in body.get("features", [])]
    return _store(key, "FEMA National Flood Hazard Layer (NFHL)", FEMA_URL, {"zones": feats})


AQUEDUCT_URL = ("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
                "aqueduct_water_risk/FeatureServer/1/query")  # Aqueduct 4.0 Baseline Annual (Esri Living Atlas)


def aqueduct_water_stress(lat: float, lon: float, *, offline: bool = False) -> dict[str, Any] | None:
    """WRI Aqueduct 4.0 baseline annual water stress (bws) for the sub-basin containing the point."""
    key = f"aqueduct:{lat:.5f},{lon:.5f}"
    hit = _cached(key)
    if hit or offline:
        return hit
    params = {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "false", "f": "json",
        "outFields": "string_id,pfaf_id,name_1,bws_raw,bws_score,bws_cat,bws_label",
    }
    try:
        r = httpx.get(AQUEDUCT_URL, params=params, timeout=30, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    if "error" in body or not body.get("features"):
        return None
    return _store(key, "WRI Aqueduct 4.0 Baseline Annual (CC BY 4.0) via Esri Living Atlas", AQUEDUCT_URL,
                  body["features"][0]["attributes"])


def osm_substations(market: str, *, offline: bool = False) -> dict[str, Any] | None:
    """All OSM power=substation nodes/ways in the market bbox (one query, cached)."""
    if market not in MARKET_BBOX:
        return None
    key = f"osm-substations:{market}"
    hit = _cached(key)
    if hit or offline:
        return hit
    s, w, n, e = MARKET_BBOX[market]
    q = (f'[out:json][timeout:90];(node["power"="substation"]({s},{w},{n},{e});'
         f'way["power"="substation"]({s},{w},{n},{e}););out center tags;')
    try:
        r = httpx.post(OVERPASS_URL, data={"data": q}, timeout=120,
                       headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    subs = []
    for el in body.get("elements", []):
        lat = el.get("lat", (el.get("center") or {}).get("lat"))
        lon = el.get("lon", (el.get("center") or {}).get("lon"))
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        volts = [int(v) for v in str(tags.get("voltage", "")).split(";") if v.strip().isdigit()]
        subs.append({"osm_id": f"{el['type']}/{el['id']}", "lat": lat, "lon": lon, "name": tags.get("name"),
                     "operator": tags.get("operator"), "max_kv": max(volts) / 1000 if volts else None})
    payload = {"osm_base": body.get("osm3s", {}).get("timestamp_osm_base"), "substations": subs}
    return _store(key, "OpenStreetMap contributors via Overpass API (ODbL)", OVERPASS_URL, payload)


# Places a data center should not sit next to. OSM `amenity` values, plus playgrounds.
SENSITIVE_AMENITIES = ("place_of_worship", "school", "kindergarten", "childcare", "hospital", "college", "university",
                       "community_centre", "nursing_home")
OSM_SOURCE = "OpenStreetMap contributors via Overpass API (ODbL)"


def _overpass(q: str, timeout: float = 200) -> dict[str, Any] | None:
    try:
        r = httpx.post(OVERPASS_URL, data={"data": q}, timeout=timeout,
                       headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError):
        return None


def _center(el: dict[str, Any]) -> tuple[float | None, float | None]:
    c = el.get("center") or {}
    return el.get("lat", c.get("lat")), el.get("lon", c.get("lon"))


def osm_sensitive(market: str, *, offline: bool = False) -> dict[str, Any] | None:
    """Schools, places of worship, hospitals, childcare and playgrounds in the market bbox (one query, cached)."""
    if market not in MARKET_BBOX:
        return None
    key = f"osm-sensitive:{market}"
    hit = _cached(key)
    if hit or offline:
        return hit
    # the metro bbox is too large for one Overpass request, so ask for it in tiles and merge
    s0, w0, n0, e0 = MARKET_BBOX[market]
    elements, seen, base, k = [], set(), None, 3
    for i in range(k):
        for j in range(k):
            box = f"({s0 + (n0 - s0) * i / k},{w0 + (e0 - w0) * j / k},{s0 + (n0 - s0) * (i + 1) / k},{w0 + (e0 - w0) * (j + 1) / k})"
            q = (f'[out:json][timeout:120];(nwr["amenity"~"^({"|".join(SENSITIVE_AMENITIES)})$"]{box};'
                 f'nwr["leisure"="playground"]{box};);out center tags;')
            tkey = f"osm-sensitive-tile:{market}:{k}:{i}:{j}"  # finished tiles are kept, so a retry only asks for the rest
            done = _cached(tkey)
            tile = done["payload"] if done else None
            for attempt in range(4):
                if tile is not None:
                    break
                if attempt:
                    time.sleep(12 * attempt)  # the public server throttles bursts
                tile = _overpass(q, timeout=140)
                if tile is not None:
                    _store(tkey, OSM_SOURCE, OVERPASS_URL, tile)
            if tile is None:
                return None  # a partial map would let sites pass wrongly
            base = tile.get("osm3s", {}).get("timestamp_osm_base") or base
            for el in tile.get("elements", []):
                if (el["type"], el["id"]) not in seen:
                    seen.add((el["type"], el["id"]))
                    elements.append(el)
    body = {"elements": elements, "osm3s": {"timestamp_osm_base": base}}
    places = []
    for el in body.get("elements", []):
        lat, lon = _center(el)
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        places.append({"osm_id": f"{el['type']}/{el['id']}", "lat": lat, "lon": lon, "name": tags.get("name"),
                       "kind": (tags.get("amenity") or tags.get("leisure") or "place").replace("_", " ")})
    return _store(key, OSM_SOURCE, OVERPASS_URL,
                  {"osm_base": body.get("osm3s", {}).get("timestamp_osm_base"), "places": places})


def osm_land(lat: float, lon: float, radius_m: float, *, offline: bool = False) -> dict[str, Any] | None:
    """What is mapped at and around one point: building footprints within radius_m, and the areas the point sits in."""
    radius = int(min(max(radius_m, 50), 2000))
    key = f"osm-land:{lat:.5f},{lon:.5f}:{radius}"
    hit = _cached(key)
    if hit or offline:
        return hit
    body = _overpass(f'[out:json][timeout:60];way["building"](around:{radius},{lat},{lon});out center tags;'
                     f'is_in({lat},{lon})->.a;area.a[~"^(building|landuse|amenity|leisure)$"~"."];out tags;', timeout=80)
    if body is None:
        return None
    buildings, here = [], []
    for el in body.get("elements", []):
        tags = el.get("tags", {})
        keep = {k: tags.get(k) for k in ("name", "building", "amenity", "landuse", "leisure") if tags.get(k)}
        if el.get("type") == "area":
            here.append(keep)
            continue
        blat, blon = _center(el)
        if blat is not None and blon is not None:
            buildings.append({"osm_id": f"{el['type']}/{el['id']}", "lat": blat, "lon": blon, **keep})
    return _store(key, OSM_SOURCE, OVERPASS_URL, {"radius_m": radius, "buildings": buildings, "here": here})
