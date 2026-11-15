"""Modeling assumptions (PRD section 10). Each has a value, a unit, a basis and a label.

Nothing here is presented as measured. "team assumption" values are editable in the UI and in every
what-if request; values marked verify=True must be source-checked before they appear in the pitch.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Assumption:
    key: str
    value: float
    unit: str
    basis: str
    label: str = "Estimated"
    verify: bool = False


ASSUMPTIONS: dict[str, Assumption] = {a.key: a for a in [
    # site
    Assumption("mw_per_acre", 1.0, "MW IT / acre",
               "Team assumption: single-story campus density used to size a site's supportable IT load."),
    Assumption("site_fit_tolerance", 0.5, "share",
               "Team assumption: a lot is usable if it supports at least this share of the requested MW (phased build)."),
    # facility
    Assumption("pue", 1.4, "ratio", "Team assumption (air/hybrid new build); used by the quick impact view.", verify=True),
    Assumption("pue_air", 1.4, "ratio", "Team assumption for closed-loop air cooling.", verify=True),
    Assumption("pue_hybrid", 1.3, "ratio", "Team assumption for hybrid (adiabatic) cooling.", verify=True),
    Assumption("pue_water", 1.2, "ratio", "Team assumption for evaporative water cooling.", verify=True),
    Assumption("it_load_factor", 0.8, "share", "Team assumption: average IT utilization over the year."),
    Assumption("wue_water", 1.8, "L / kWh IT", "Team assumption for evaporative (water) cooling.", verify=True),
    Assumption("wue_hybrid", 0.7, "L / kWh IT", "Team assumption for hybrid cooling.", verify=True),
    Assumption("wue_air", 0.1, "L / kWh IT", "Team assumption for closed-loop air cooling.", verify=True),
    # capital
    Assumption("capex_per_mw", 11_000_000, "USD / MW IT",
               "Team assumption for shell, electrical and mechanical build cost, excluding cooling plant.", verify=True),
    Assumption("cooling_capex_air", 1_500_000, "USD / MW IT", "Team assumption.", verify=True),
    Assumption("cooling_capex_hybrid", 1_800_000, "USD / MW IT", "Team assumption.", verify=True),
    Assumption("cooling_capex_water", 2_000_000, "USD / MW IT", "Team assumption.", verify=True),
    Assumption("interconnect_cost_per_km", 1_500_000, "USD / km",
               "Team scenario for a transmission tap to the nearest >= 138 kV substation; a utility study sets the real figure.",
               label="Simulated", verify=True),
    Assumption("default_substation_km", 10.0, "km", "Used when no substation was found within the search radius."),
    # operations
    Assumption("opex_per_mw_year", 250_000, "USD / MW IT / yr",
               "Team assumption: staffing, maintenance, insurance, excluding energy and water.", verify=True),
    Assumption("water_price_per_kgal", 6.0, "USD / 1,000 gal", "Team assumption for Houston industrial water.", verify=True),
    Assumption("revenue_per_mw_year", 1_440_000, "USD / MW IT / yr",
               "Team assumption: $120k per MW-month wholesale colocation; verify against market reports.", verify=True),
    Assumption("discount_rate", 0.09, "ratio / yr", "Team assumption for an infrastructure developer."),
    Assumption("delay_penalty_per_month_per_mw", 120_000, "USD / MW / month",
               "Team assumption: one month of lost revenue per MW of delayed capacity."),
    # flexibility and grid
    Assumption("flex_rate_multiple", 2.0, "x average",
               "Team assumption: deferred jobs can run at up to twice their average rate to catch up."),
    Assumption("firm_capacity_near_km", 2.0, "km",
               "Team scenario: sites within this distance of a >= 138 kV substation get full firm capacity.",
               label="Simulated"),
    Assumption("firm_capacity_far_share", 0.75, "share of request",
               "Team scenario: farther sites get this share as firm capacity until an upgrade; flexibility covers the rest.",
               label="Simulated"),
    Assumption("grid_kg_co2_per_mwh", 400.0, "kg CO2 / MWh",
               "Placeholder average used only when no ERCOT fuel-mix day is cached.", label="Simulated", verify=True),
    Assumption("jobs_construction_per_mw", 0.0, "jobs / MW", "Not modeled: no sourced jobs factor loaded.", label="Unknown"),
]}

COOLING_WUE = {"water": "wue_water", "hybrid": "wue_hybrid", "air": "wue_air"}
LITERS_PER_GALLON = 3.785411784


def as_list() -> list[dict[str, Any]]:
    return [asdict(a) for a in ASSUMPTIONS.values()]


def value(key: str, overrides: dict[str, float] | None = None) -> float:
    if overrides and key in overrides:
        return float(overrides[key])
    return ASSUMPTIONS[key].value


def impact(mw_it: float, cooling: str = "air", overrides: dict[str, float] | None = None,
           grid_kg_per_mwh: float | None = None) -> dict[str, Any]:
    """Annual energy, water, carbon and capex for an IT load. Pure function; every output is Estimated."""
    if cooling not in COOLING_WUE:
        raise ValueError(f"cooling must be one of {sorted(COOLING_WUE)}")
    lf, pue = value("it_load_factor", overrides), value(f"pue_{cooling}", overrides)
    it_mwh = mw_it * lf * 8760
    facility_mwh = it_mwh * pue
    wue = value(COOLING_WUE[cooling], overrides)
    water_l_per_day = it_mwh * 1000 * wue / 365
    intensity = grid_kg_per_mwh if grid_kg_per_mwh is not None else value("grid_kg_co2_per_mwh", overrides)
    capex = mw_it * (value("capex_per_mw", overrides) + value(f"cooling_capex_{cooling}", overrides))
    return {
        "mw_it": mw_it,
        "cooling": cooling,
        "energy_gwh_per_year": round(facility_mwh / 1000, 1),
        "water_gal_per_day": round(water_l_per_day / LITERS_PER_GALLON),
        "co2_t_per_year": round(facility_mwh * intensity / 1000),
        "capex_usd": round(capex),
        "peak_mw_facility": round(mw_it * pue, 1),
        "label": "Estimated",
        "carbon_label": "Estimated" if grid_kg_per_mwh is not None else "Simulated",
        "formula": {
            "energy": f"MW_IT x load factor {lf} x 8760 h x PUE {pue} ({cooling})",
            "water": f"IT MWh x {wue} L/kWh ({cooling}) / 365 / {LITERS_PER_GALLON:.3f} L per gal",
            "carbon": f"facility MWh x {intensity:.0f} kg CO2/MWh",
            "capex": f"MW_IT x (${value('capex_per_mw', overrides):,.0f} + ${value(f'cooling_capex_{cooling}', overrides):,.0f} cooling) per MW",
        },
    }
