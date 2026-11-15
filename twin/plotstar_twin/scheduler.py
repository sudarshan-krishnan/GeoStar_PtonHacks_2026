"""Flex-to-Connect: schedule the flexible compute tier for one grid day.

Load model: 1 always-on tier (inference) + a flexible tier (training/batch).
  x[t] in [0, 1] = share of the flexible tier running in hour t.

PlotStar plan (linear program, HiGHS):
  minimise  sum_t x[t] * P_flex * (price[t] + carbon_price * carbon[t] / 1000 + peak_charge * peak[t])
  s.t.      sum_t (1 - x[t]) <= B          (curtailment budget for the day)
            x[t] = 0 for grid-emergency hours (when flexibility was offered)
  B comes from the flexibility level the developer offers the utility:
  F % of the year's hours, assumed spent over STRESS_DAYS_PER_YEAR grid-stress days.
  (Duke/Norris 2025: ~76 GW of new load fits at 0.25 %, ~126 GW at 1 %.)

Cost-first plan: run everything flat out, every hour (how a cost-first developer
sizes the site) - so during a grid emergency it needs backup diesel.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .grid_day import GridDay

FLEX_LEVELS = [0.0, 0.25, 0.5, 1.0]   # % of annual hours, potentiometer zones 0..3
STRESS_DAYS_PER_YEAR = 10              # demo assumption, state it if asked
HOURS_PER_YEAR = 8760


def daily_budget_hours(flex_pct: float) -> float:
    return flex_pct / 100.0 * HOURS_PER_YEAR / STRESS_DAYS_PER_YEAR


@dataclass
class Plan:
    name: str
    flex_on: np.ndarray                      # 24 values in [0, 1]
    budget_hours: float = 0.0
    emergency_hours: set = field(default_factory=set)
    diesel_hours: set = field(default_factory=set)
    solver: str = ""

    @property
    def curtailed_hours(self) -> float:
        return float(np.sum(1.0 - self.flex_on))

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "flex_on": [round(float(v), 3) for v in self.flex_on],
            "budget_hours": round(self.budget_hours, 2),
            "curtailed_hours": round(self.curtailed_hours, 2),
            "emergency_hours": sorted(self.emergency_hours),
            "diesel_hours": sorted(self.diesel_hours),
            "solver": self.solver,
        }


def hourly_cost(day: GridDay, carbon_price: float, peak_charge: float, peak_hours: set) -> np.ndarray:
    """$ per MWh-equivalent of running the flexible tier in each hour."""
    return np.array([
        h.price + carbon_price * h.carbon / 1000.0 + (peak_charge if h.hour in peak_hours else 0.0)
        for h in day.hours
    ])


def plan_plotstar(day: GridDay, flex_pct: float, carbon_price: float, *,
                  emergency_hours: set = frozenset(), peak_charge: float = 150.0,
                  n_peak_hours: int = 1) -> Plan:
    budget = daily_budget_hours(flex_pct)
    emerg = set(emergency_hours)
    if budget <= 0:
        # Nothing offered to the grid: runs flat; any emergency hour needs diesel.
        return Plan("plotstar", np.ones(24), 0.0, emerg, set(emerg), "none (no flexibility)")

    cost = hourly_cost(day, carbon_price, peak_charge, day.peak_hours(n_peak_hours))
    budget = max(budget, float(len(emerg)))  # an emergency call is always honoured
    bounds = [(0.0, 0.0) if t in emerg else (0.0, 1.0) for t in range(24)]
    try:
        from scipy.optimize import linprog

        res = linprog(cost, A_ub=-np.ones((1, 24)), b_ub=[-(24.0 - budget)],
                      bounds=bounds, method="highs")
        if not res.success:
            raise RuntimeError(res.message)
        x, solver = np.clip(res.x, 0.0, 1.0), "scipy HiGHS LP"
    except Exception:
        x, solver = _greedy(cost, budget, emerg), "greedy fallback"
    return Plan("plotstar", x, budget, emerg, set(), solver)


def _greedy(cost: np.ndarray, budget: float, emerg: set) -> np.ndarray:
    """Same optimum as the LP: curtail emergency hours, then the most expensive hours."""
    x = np.ones(24)
    left = budget
    for t in emerg:
        x[t] = 0.0
        left -= 1.0
    for t in np.argsort(-cost):
        if left <= 1e-9:
            break
        if t in emerg:
            continue
        cut = min(1.0, left)
        x[t] -= cut
        left -= cut
    return x


def plan_cost_first(emergency_hours: set = frozenset()) -> Plan:
    emerg = set(emergency_hours)
    return Plan("cost_first", np.ones(24), 0.0, emerg, set(emerg), "none (flat out)")
