"""Evaluation harness: are the optimizer's decisions sound against the baseline, and are explanations grounded?

Optimizer checks (per scenario):
  no_gated_site          the recommended site never fails a hard gate
  not_worse_than_baseline  joint optimization costs no more than cost-first planning on the same gates
  flexibility_never_hurts  with flexible load, cost is no higher than operated inflexibly
  same_energy            shifting work does not change annual energy (same site and cooling)
  within_envelope        the hourly schedule never exceeds the requested grid power

Explanation check (optional, calls the explainer): every number in the explanation must be traceable to a number
in the tool outputs (allowing unit conversions and rounding). Reports the grounded share and the stragglers.

Run:  python -m app.evals [--agent N]     -> prints a table and writes docs/eval_report.md
"""
from __future__ import annotations

import itertools
import json
import re
import sys
from datetime import datetime, timezone
from typing import Any

from . import agent as AG
from . import assumptions as A
from . import config
from .routers.optimize import OptimizeIn, _run

EPS = 1.0  # dollars


def scenarios() -> list[dict[str, Any]]:
    out = []
    for mw, flex, price, carbon in itertools.product([10, 20, 40], [0.0, 0.3], [1.0, 1.5], [0.0, 50.0]):
        out.append({"mw_it": mw, "flexible_share": flex, "price_multiplier": price, "carbon_price_per_t": carbon})
    return out


def check_run(res: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    o, b, inf = res.get("optimized"), res.get("baseline"), res.get("inflexible")
    gated = {r["parcel_id"] for r in res.get("rejected", [])}
    checks: dict[str, bool | None] = {}
    checks["no_gated_site"] = None if not o else o["site_id"] not in gated
    checks["not_worse_than_baseline"] = None if not (o and b) else o["cost"] <= b["cost"] + EPS
    checks["flexibility_never_hurts"] = None if not (o and inf) else o["cost"] <= inf["cost"] + EPS
    same = o and b and o["site_id"] == b["site_id"] and o["cooling"] == b["cooling"] and o["f"] == 0
    checks["same_energy"] = None if not same else abs(o["energy_mwh_year"] - b["energy_mwh_year"]) <= 1e-6 * b["energy_mwh_year"]
    checks["within_envelope"] = None if not o else max(o["schedule"]) <= req["mw_it"] * o["pue"] + 1e-6
    return checks


def _numbers(obj: Any, acc: set[float]) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        acc.add(float(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _numbers(v, acc)
    elif isinstance(obj, str):
        for m in re.findall(r"-?\d+(?:\.\d+)?", obj):
            acc.add(float(m))


def grounded(answer: str, sources: list[Any]) -> dict[str, Any]:
    base: set[float] = set()
    for s in sources:
        _numbers(s, base)
    pool = set(base)
    for v in base:  # unit conversions an honest explanation may use
        pool.update({v * 100, v / 1e6, v / 1e3, v * 8760, abs(v), round(v), v * 12})
    vals = sorted(pool)
    pairs = [abs(a - b) for a in vals[:400] for b in vals[:400]] if len(vals) <= 400 else []
    text = answer.replace(",", "")
    found = [float(x) for x in re.findall(r"(?<![\w.])\d+(?:\.\d+)?", text)]
    ok, bad = 0, []
    for n in found:
        tol = max(0.006 * abs(n), 0.51 if n >= 10 else 0.06)
        hit = any(abs(n - v) <= tol for v in vals) or any(abs(n - p) <= tol for p in pairs) or n in (1, 2, 3, 4, 10, 24, 100)
        ok += hit
        if not hit:
            bad.append(n)
    return {"numbers": len(found), "grounded": ok, "share": round(ok / len(found), 3) if found else 1.0, "ungrounded": bad[:12]}


def run(agent_samples: int = 0) -> dict[str, Any]:
    rows, fails = [], 0
    for sc in scenarios():
        req = OptimizeIn(market="Houston", min_acres=2, offline=True, **sc)
        res = _run(req)
        checks = check_run(res, sc)
        fails += sum(1 for v in checks.values() if v is False)
        rows.append({"scenario": sc, "run_id": res["run_id"], "recommended": (res["optimized"] or {}).get("site_name"),
                     "cost_first": (res["baseline"] or {}).get("site_name"),
                     "delta_cost": (res["delta"] or {}).get("cost"), "checks": checks})
    expl = []
    for row in rows[: max(0, agent_samples)]:
        out = AG.explain(row["run_id"], None)
        srcs = [AG.tool_get_run(row["run_id"]), AG.tool_grid_day(), A.as_list()]
        expl.append({"run_id": row["run_id"], "model": out["model"], **grounded(out["answer"], srcs)})
    names = list(rows[0]["checks"].keys())
    summary = {n: {"pass": sum(r["checks"][n] is True for r in rows), "fail": sum(r["checks"][n] is False for r in rows),
                   "n/a": sum(r["checks"][n] is None for r in rows)} for n in names}
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "scenarios": len(rows),
            "failures": fails, "summary": summary, "rows": rows, "explanations": expl}


def to_markdown(rep: dict[str, Any]) -> str:
    L = [f"# PlotStar evaluation report\n\nGenerated {rep['generated_at']} · {rep['scenarios']} scenarios (Houston, real CoStar sites, cached ERCOT day).\n",
         "## Optimizer decisions vs baseline\n", "| Check | Pass | Fail | Not applicable |", "|---|---|---|---|"]
    for n, s in rep["summary"].items():
        L.append(f"| {n} | {s['pass']} | {s['fail']} | {s['n/a']} |")
    bad = [r for r in rep["rows"] if any(v is False for v in r["checks"].values())]
    if bad:
        L.append("\n### Failing scenarios\n")
        for r in bad:
            L.append(f"- {json.dumps(r['scenario'])}: failed {[k for k, v in r['checks'].items() if v is False]}; "
                     f"recommended {r['recommended']}, cost-first {r['cost_first']}, delta cost {r['delta_cost']}")
    if rep["explanations"]:
        L += ["\n## Explanation groundedness\n", "| Run | Explainer | Numbers | Grounded | Share | Ungrounded |", "|---|---|---|---|---|---|"]
        for e in rep["explanations"]:
            L.append(f"| {e['run_id']} | {e['model']} | {e['numbers']} | {e['grounded']} | {e['share']:.0%} | {e['ungrounded']} |")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    n = int(sys.argv[sys.argv.index("--agent") + 1]) if "--agent" in sys.argv else 0
    report = run(n)
    md = to_markdown(report)
    (config.REPO_ROOT / "docs" / "eval_report.md").write_text(md, encoding="utf-8")
    sys.stdout.buffer.write(md.encode("utf-8"))
