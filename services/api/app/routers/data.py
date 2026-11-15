"""Data inventory: what was ingested, when, and how complete it is."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..config import COSTAR_KIT_DIR
from ..db import db_ready, session

router = APIRouter(tags=["data"])


@router.get("/data/summary")
def summary() -> dict[str, Any]:
    if not db_ready():
        return {"ready": False, "kit_found": (COSTAR_KIT_DIR / "index.md").exists(), "ingest_runs": []}
    with session() as c:
        runs = [dict(r) for r in c.execute("SELECT * FROM ingest_runs ORDER BY dataset")]
        by_market = [dict(r) for r in c.execute("""
            SELECT market, COUNT(*) AS properties, SUM(dc_candidate) AS candidates,
                   SUM(dc_candidate AND asking_price_low IS NOT NULL) AS candidates_with_asking_price,
                   SUM(dc_candidate AND last_sale_price IS NOT NULL) AS candidates_with_sale_price,
                   SUM(dc_candidate AND has_heavy_power = 1) AS candidates_with_heavy_power,
                   SUM(dc_candidate AND matterport_count > 0) AS candidates_with_matterport
            FROM parcels GROUP BY market ORDER BY market""")]
        by_type = [dict(r) for r in c.execute("""
            SELECT market, property_type, COUNT(*) AS n FROM parcels
            WHERE dc_candidate = 1 GROUP BY 1, 2 ORDER BY 1, 3 DESC""")]
    return {"ready": True, "kit_found": True, "ingest_runs": runs, "by_market": by_market,
            "candidates_by_type": by_type}
