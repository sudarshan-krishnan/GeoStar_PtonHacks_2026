"""Vexcel imagery + 3D proxy (PRD S-3). The API key stays server-side (x-api-key header).

GET /vexcel/ortho/{parcel_id}.jpg   orthophoto around a parcel (resized, disk-cached)
GET /vexcel/ortho/{parcel_id}/meta  capture dates, GSD, collection, camera (from the image's XMP)
GET /vexcel/3d/root?lat=&lon=       which 3D-cities collection covers a point -> proxied tileset URL
GET /vexcel/3d/{tileset|tile}?...   OGC 3D Tiles proxy; JSON root links are rewritten to this proxy

Everything fetched is cached under data/cache/vexcel so the demo works offline after one warm-up.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import re
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from app import config
from app.db import session

router = APIRouter(prefix="/vexcel", tags=["vexcel"])

BASE = "https://api.vexcelgroup.com/v2"
CACHE = config.CACHE_DIR / "vexcel"
LABEL_SOURCE = "Vexcel Imaging US, Inc. via Vexcel API v2"


def _headers() -> dict[str, str]:
    if not config.VEXCEL_API_KEY:
        raise HTTPException(503, "VEXCEL_API_KEY is not configured")
    return {"x-api-key": config.VEXCEL_API_KEY}


def _cache_path(kind: str, key: str, ext: str) -> Path:
    h = hashlib.sha1(key.encode()).hexdigest()[:20]
    p = CACHE / kind / f"{h}{ext}"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _upstream(url: str, params: dict[str, Any] | None = None, timeout: float = 60) -> httpx.Response:
    try:
        r = httpx.get(url, params=params, headers=_headers(), timeout=timeout)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Vexcel unreachable: {type(e).__name__}") from e
    if r.status_code != 200:
        msg = r.text[:200] if "json" in r.headers.get("content-type", "") else ""
        raise HTTPException(502 if r.status_code >= 500 else r.status_code, f"Vexcel HTTP {r.status_code} {msg}")
    return r


def parse_xmp(jpeg: bytes) -> dict[str, str]:
    head = jpeg[:60000].decode("latin1", errors="ignore")
    return {k: v for k, v in re.findall(r"<Vexcel:([\w-]+)>([^<]*)<", head) if k != "geometry"}


def _parcel_point(parcel_id: str) -> tuple[float, float]:
    if parcel_id.startswith("pt:"):  # user-chosen location: pt:<lat>,<lon>
        try:
            la, lo = (float(v) for v in parcel_id[3:].split(","))
        except ValueError as e:
            raise HTTPException(422, "bad point id") from e
        if not (-90 <= la <= 90 and -180 <= lo <= 180):
            raise HTTPException(422, "bad point id")
        return la, lo
    with session() as c:
        row = c.execute("SELECT lat, lon FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not row or row["lat"] is None:
        raise HTTPException(404, f"Unknown parcel {parcel_id}")
    return row["lat"], row["lon"]


def _ortho(parcel_id: str, buffer_m: int) -> tuple[bytes, dict[str, str]]:
    lat, lon = _parcel_point(parcel_id)
    raw_path = _cache_path("ortho", f"{parcel_id}:{buffer_m}", ".jpg")
    meta_path = raw_path.with_suffix(".json")
    if raw_path.exists() and meta_path.exists():
        return raw_path.read_bytes(), json.loads(meta_path.read_text())
    r = _upstream(f"{BASE}/ortho/extract",
                  {"wkt": f"POINT({lon} {lat})", "srid": "4326", "buffer-meter": str(buffer_m)}, timeout=90)
    meta = parse_xmp(r.content)
    meta.update({"center_lat": lat, "center_lon": lon, "buffer_m": buffer_m, "source": LABEL_SOURCE,
                 "label": "Sourced"})
    # Store a web-sized copy (originals are ~4,500 px / 5 MB at 7 cm GSD).
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(r.content))
        im.thumbnail((1600, 1600))
        buf = io.BytesIO()
        im.convert("RGB").save(buf, "JPEG", quality=85)
        data = buf.getvalue()
    except Exception:  # Pillow missing or decode issue: serve the original
        data = r.content
    raw_path.write_bytes(data)
    meta_path.write_text(json.dumps(meta))
    return data, meta


@router.get("/ortho/{parcel_id}.jpg")
def ortho_image(parcel_id: str, buffer_m: int = 200) -> Response:
    buffer_m = max(50, min(buffer_m, 600))
    data, meta = _ortho(parcel_id, buffer_m)
    return Response(data, media_type="image/jpeg", headers={
        "Cache-Control": "public, max-age=86400",
        "X-Vexcel-Collection": meta.get("collection", ""),
        "X-Vexcel-Capture": meta.get("last-capture-date", ""),
    })


@router.get("/ortho/{parcel_id}/meta")
def ortho_meta(parcel_id: str, buffer_m: int = 200) -> dict[str, Any]:
    buffer_m = max(50, min(buffer_m, 600))
    return _ortho(parcel_id, buffer_m)[1]


# ---------------------------------------------------------------- 3D Tiles

def _region_contains(region: list[float], lat: float, lon: float) -> bool:
    w, s, e, n = region[:4]
    la, lo = math.radians(lat), math.radians(lon)
    return w <= lo <= e and s <= la <= n


def _cached_json(kind: str, url: str, params: dict[str, Any]) -> dict[str, Any]:
    key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    p = _cache_path(kind, key, ".json")
    if p.exists():
        return json.loads(p.read_text())
    body = _upstream(url, params).json()
    p.write_text(json.dumps(body))
    return body


def _region_intersects_box(region: list[float], lat: float, lon: float, radius_m: float) -> bool:
    w, s_, e, n = region[:4]
    dlat = math.radians(radius_m / 111_320.0)
    dlon = math.radians(radius_m / (111_320.0 * max(0.2, math.cos(math.radians(lat)))))
    la, lo = math.radians(lat), math.radians(lon)
    return not (e < lo - dlon or w > lo + dlon or n < la - dlat or s_ > la + dlat)


def _collection_for(lat: float, lon: float) -> tuple[str, dict[str, Any]] | None:
    top = _cached_json("3d", f"{BASE}/3d/tileset", {})
    for child in top.get("root", {}).get("children", []):
        region = (child.get("boundingVolume") or {}).get("region")
        uri = (child.get("content") or {}).get("uri", "")
        m = re.search(r"collection=([^&]+)", uri)
        if region and m and _region_contains(region, lat, lon):
            return m.group(1), child
    return None


def _site_tileset(collection: str, lat: float, lon: float, radius_m: float) -> dict[str, Any]:
    """The collection tileset pruned to the zoom-13 cells within radius_m of the site (the full one has ~120)."""
    full = _cached_json("3d", f"{BASE}/3d/tileset", {"collection": collection, "layer": "3d-cities"})
    root = full.get("root", {})
    kept = []
    for ch in root.get("children", []):
        region = (ch.get("boundingVolume") or {}).get("region")
        if region and _region_intersects_box(region, lat, lon, radius_m):
            c = dict(ch)
            uri = (c.get("content") or {}).get("uri", "")
            c["content"] = {"uri": uri.replace("./tileset?", "./tileset.json?").replace("./tile?", "./tile.glb?")}
            kept.append(c)
    if not kept:
        raise HTTPException(404, "No Vexcel 3D cells within the requested radius")
    regions = [c["boundingVolume"]["region"] for c in kept]
    union = [min(r[0] for r in regions), min(r[1] for r in regions), max(r[2] for r in regions),
             max(r[3] for r in regions), min(r[4] for r in regions), max(r[5] for r in regions)]
    return {
        "asset": full.get("asset", {"version": "1.1"}),
        "geometricError": root.get("geometricError", 96),
        "root": {"boundingVolume": {"region": union}, "geometricError": root.get("geometricError", 96),
                 "refine": root.get("refine", "REPLACE"), "children": kept},
        "extras": {"source": LABEL_SOURCE, "pruned_from": len(root.get("children", [])), "kept": len(kept),
                   "radius_m": radius_m},
    }


@router.get("/3d/root")
def tileset_root(lat: float, lon: float, request: Request, radius_m: float = 1500) -> dict[str, Any]:
    """3D coverage at a point -> URL of a site-pruned tileset served by this proxy."""
    found = _collection_for(lat, lon)
    if not found:
        raise HTTPException(404, "No Vexcel 3D coverage at this point")
    collection, _ = found
    ts = _site_tileset(collection, lat, lon, radius_m)
    base = str(request.base_url).rstrip("/")
    return {"tileset_url": f"{base}/vexcel/3d/site.json?collection={collection}&lat={lat:.6f}&lon={lon:.6f}&radius_m={radius_m:g}",
            "collection": collection, "cells": ts["extras"]["kept"], "cells_total": ts["extras"]["pruned_from"],
            "source": LABEL_SOURCE, "label": "Sourced"}


@router.get("/3d/site.json")
def site_tileset(collection: str, lat: float, lon: float, radius_m: float = 1500) -> Response:
    if not re.match(r"^[a-z0-9_-]+$", collection):
        raise HTTPException(422, "bad collection")
    body = json.dumps(_site_tileset(collection, lat, lon, max(200.0, min(radius_m, 8000.0))))
    return Response(body, media_type="application/json",
                    headers={"Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*"})


_ENDPOINTS = {"tileset": "tileset", "tileset.json": "tileset", "tile": "tile", "tile.glb": "tile"}


def _rewrite_tileset(data: bytes, own_base: str) -> bytes:
    """Point every link at this proxy, with file extensions the 3D Tiles renderer can classify."""
    text = data.decode("utf-8")
    text = text.replace(f"{BASE}/3d/tileset?", "./tileset.json?").replace(f"{BASE}/3d/tile?", "./tile.glb?")
    text = text.replace(f"{BASE}/3d/", own_base)
    text = text.replace('"./tileset?', '"./tileset.json?').replace('"./tile?', '"./tile.glb?')
    return text.encode("utf-8")


@router.get("/3d/{endpoint}", name="tiles_proxy")
def tiles_proxy(endpoint: str, request: Request) -> Response:
    upstream = _ENDPOINTS.get(endpoint)
    if upstream is None:
        raise HTTPException(404, "Unknown 3D endpoint")
    params = dict(request.query_params)
    key = upstream + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    path = _cache_path("3d", key, ".json" if upstream == "tileset" else ".glb")
    if path.exists():
        data = path.read_bytes()
    else:
        data = _upstream(f"{BASE}/3d/{upstream}", params).content
        path.write_bytes(data)
    if upstream == "tileset":
        data = _rewrite_tileset(data, f"{str(request.base_url).rstrip('/')}/vexcel/3d/")
    media = "application/json" if upstream == "tileset" else "model/gltf-binary"
    return Response(data, media_type=media, headers={"Cache-Control": "public, max-age=86400",
                                                     "Access-Control-Allow-Origin": "*"})
