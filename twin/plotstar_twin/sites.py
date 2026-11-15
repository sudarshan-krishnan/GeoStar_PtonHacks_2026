"""Candidate sites and the people/planet pass-fail limits (values in config/sites.json)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

CONFIG = Path(__file__).resolve().parents[1] / "config" / "sites.json"


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


class SiteBook:
    def __init__(self, path: Optional[str] = None):
        with open(path or CONFIG) as fh:
            cfg = json.load(fh)
        self.facility_mw: float = float(cfg["facility_mw"])
        self.limits: dict = cfg["limits"]
        self.cooling: dict = cfg["cooling"]
        self.sites: dict = cfg["sites"]

    def pue(self, cooling: str) -> float:
        return float(self.cooling[cooling]["pue"])

    def water_l_per_kwh(self, cooling: str) -> float:
        return float(self.cooling[cooling]["water_l_per_kwh"])

    def headroom(self, site: str, flex_pct: float) -> float:
        table = self.sites[site]["headroom_mw"]
        return float(table[_flex_key(flex_pct)])

    def checks(self, site: str, cooling: str, flex_pct: float) -> list[Check]:
        s = self.sites[site]
        head = self.headroom(site, flex_pct)
        grid_ok = self.facility_mw <= head
        water_ok = not (cooling == "water" and s["water_stress"] in self.limits["water_cooling_banned_stress"])
        needs_diesel = flex_pct <= 0
        homes = int(s["homes_within_1km"])
        homes_ok = not (needs_diesel and homes > self.limits["max_homes_within_1km_with_diesel"])
        return [
            Check("grid", grid_ok, f"{self.facility_mw:.0f} MW vs {head:.0f} MW headroom at {flex_pct}% flex"),
            Check("water", water_ok, f"{cooling} cooling, water stress {s['water_stress']}"),
            Check("homes", homes_ok,
                  f"{homes} homes within 1 km" + ("; diesel backup needed with 0% flex" if needs_diesel else "")),
        ]


def _flex_key(flex_pct: float) -> str:
    return {0.0: "0", 0.25: "0.25", 0.5: "0.5", 1.0: "1"}[float(flex_pct)]
