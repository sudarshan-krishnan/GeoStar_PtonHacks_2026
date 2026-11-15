"""Development projects (PRD section 6, step 1: 'Create project').

A project holds the user's own inputs. Financial assumptions start unset; the UI blocks NPV until they
are set with a value and a source or a 'team assumption' tag (PRD section 10, assumption parameters).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import session

router = APIRouter(tags=["projects"])

DDL = """
CREATE TABLE IF NOT EXISTS projects (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    capacity_mw        REAL NOT NULL,
    region             TEXT NOT NULL,
    max_land_cost      REAL,
    target_cod         TEXT,
    flexible_share     REAL NOT NULL,
    assumptions_json   TEXT NOT NULL DEFAULT '{}',
    created_at         TEXT NOT NULL
)
"""

# Parameters the optimizer and underwriting model need. None of them has a default value on purpose.
ASSUMPTION_KEYS = [
    "construction_cost_per_mw", "cooling_capex_per_mw", "cooling_opex_per_mw", "interconnection_upgrade_cost",
    "discount_rate", "revenue_per_mw_year", "delay_penalty_per_month", "risk_adjustment",
    "water_use_per_mwh", "firm_capacity_mw",
]


def init() -> None:
    with session() as c:
        c.execute(DDL)


class Assumption(BaseModel):
    value: float
    source: str = Field(..., min_length=1, description="Citation, or 'team assumption'")


class ProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    capacity_mw: float = Field(..., gt=0, le=5000)
    region: str = Field(..., min_length=1)
    max_land_cost: float | None = Field(None, ge=0)
    target_cod: date | None = None
    flexible_share: float = Field(..., ge=0, le=1, description="Share of load that can be deferred (0-1)")
    assumptions: dict[str, Assumption] = Field(default_factory=dict)


def _out(row: Any) -> dict[str, Any]:
    d = dict(row)
    set_ = json.loads(d.pop("assumptions_json") or "{}")
    d["assumptions"] = {k: set_.get(k) for k in ASSUMPTION_KEYS}
    d["assumptions_unset"] = [k for k in ASSUMPTION_KEYS if k not in set_]
    return d


@router.post("/projects", status_code=201)
def create_project(p: ProjectIn) -> dict[str, Any]:
    unknown = set(p.assumptions) - set(ASSUMPTION_KEYS)
    if unknown:
        raise HTTPException(422, f"Unknown assumption keys: {sorted(unknown)}")
    with session() as c:
        cur = c.execute(
            "INSERT INTO projects (name, capacity_mw, region, max_land_cost, target_cod, flexible_share, "
            "assumptions_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (p.name, p.capacity_mw, p.region, p.max_land_cost, p.target_cod.isoformat() if p.target_cod else None,
             p.flexible_share, json.dumps({k: v.model_dump() for k, v in p.assumptions.items()}),
             datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        row = c.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _out(row)


@router.get("/projects")
def list_projects() -> list[dict[str, Any]]:
    with session() as c:
        return [_out(r) for r in c.execute("SELECT * FROM projects ORDER BY id DESC")]


@router.get("/projects/{project_id}")
def get_project(project_id: int) -> dict[str, Any]:
    with session() as c:
        row = c.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    return _out(row)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int) -> None:
    with session() as c:
        c.execute("DELETE FROM projects WHERE id = ?", (project_id,))
