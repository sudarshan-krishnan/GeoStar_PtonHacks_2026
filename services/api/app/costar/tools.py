"""PlotStar CoStar intelligence tools: one implementation behind the MCP server, the LangGraph copilot and the HTTP API.

Every tool returns the same envelope:
    {ok: bool, tool, data: {...} | None, sources: [str], label: str | None, error: str | None, ms}
`sources` are CoStar record references ("commercial-property.jsonl row 812", "sale comp 4411237"). Tools are read-only
except `save_to_deal_room`, which requires confirm=True. Every call is written to the deal-room audit log.

The specialised analyses live in sibling modules (comps/valuation/market, tenancy/redevelop/homes, building); this
module composes them into the workflows a broker, investor or site-selection team runs: dossier, underwriting,
portfolio comparison, data gaps and an investment memo. Deterministic: no model writes any number here.
"""
from __future__ import annotations

import importlib
import math
import time
from typing import Any, Callable

from .. import assumptions as A
from .. import deal_room, layout_engine
from ..db import db_ready, session
from ..screening import haversine_m, service_capacity_mw

MAX_LIMIT = 25
TODAY_NOTE = "CoStar hackathon extract (static snapshot); not live market data."


class ToolError(RuntimeError):
    pass


def _mod(name: str):
    """A sibling analysis module, or a clear error when it is not installed yet."""
    try:
        return importlib.import_module(f"app.costar.{name}")
    except ModuleNotFoundError as e:
        raise ToolError(f"The {name} analysis is not available on this server ({e.name}).") from e


def _fn(module: str, *names: str) -> Callable[..., Any]:
    m = _mod(module)
    for n in names:
        if hasattr(m, n):
            return getattr(m, n)
    raise ToolError(f"app.costar.{module} has none of {', '.join(names)}.")


def _parcel(parcel_id: str) -> dict[str, Any]:
    if not db_ready():
        raise ToolError("The CoStar parcel store is not loaded. Run: python -m app.costar.loader")
    with session() as c:
        row = c.execute("SELECT * FROM parcels WHERE parcel_id = ?", (parcel_id,)).fetchone()
    if not row:
        raise ToolError(f"No CoStar property {parcel_id}.")
    return dict(row)


def _src(p: dict[str, Any]) -> str:
    return f"CoStar {p.get('source_file', 'commercial-property.jsonl')} row {p.get('source_row')} (property {p.get('costar_property_id')})"


def _sources_from(data: Any) -> list[str]:
    """Collect source references from an analysis result (keys named source/source_row/sources)."""
    out: list[str] = []

    def walk(o: Any) -> None:
        if len(out) > 200:
            return
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("source", "source_ref") and isinstance(v, str):
                    out.append(v)
                elif k == "source_row" and v is not None:
                    out.append(f"row {v}" + (f" ({o.get('source_file')})" if o.get("source_file") else ""))
                elif k == "sources" and isinstance(v, list):
                    out.extend(str(x) for x in v[:50])
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o[:300]:
                walk(x)
    walk(data)
    return list(dict.fromkeys(out))[:200]


def run(tool: str, via: str = "api", **args: Any) -> dict[str, Any]:
    """Call one tool by name with validation, timing, audit and a uniform envelope."""
    t0 = time.time()
    fn = TOOLS.get(tool)
    if fn is None:
        return {"ok": False, "tool": tool, "data": None, "sources": [], "label": None, "error": f"Unknown tool {tool}", "ms": 0}
    clean = {k: v for k, v in args.items() if v is not None}
    try:
        hit = deal_room.cached(tool, clean) if tool in CACHEABLE else None
        if hit is not None:
            out = {**hit, "cached": True}
        else:
            data, label = fn(**clean)
            sources = _sources_from(data)
            out = {"ok": True, "tool": tool, "data": data, "sources": sources, "label": label, "error": None}
            if tool in CACHEABLE:  # payload to the local cache, metadata to Atlas (CoStar-derived data stays local)
                deal_room.save_analysis(tool, clean, out, clean.get("parcel_id"), sources, label)
    except (ToolError, ValueError, TypeError) as e:
        out = {"ok": False, "tool": tool, "data": None, "sources": [], "label": None, "error": str(e)}
    except Exception as e:  # an unexpected failure is reported, never raised to the agent
        out = {"ok": False, "tool": tool, "data": None, "sources": [], "label": None, "error": f"{type(e).__name__}: {e}"}
    out["ms"] = round((time.time() - t0) * 1000, 1)
    deal_room.audit(tool, via, args, out["ok"], out["ms"], len(out["sources"]), out["error"])
    return out


# ============================================================================================ tools
def search_costar_properties(market: str | None = None, min_acres: float | None = None, max_acres: float | None = None,
                             property_types: list[str] | None = None, heavy_power: bool | None = None,
                             max_price: float | None = None, available_only: bool = False,
                             min_building_sf: float | None = None, max_building_sf: float | None = None,
                             dc_candidates_only: bool = False, sort: str = "acres", limit: int = 10):
    if not db_ready():
        raise ToolError("The CoStar parcel store is not loaded.")
    where, args = ["lat IS NOT NULL", "lon IS NOT NULL"], []
    if market:
        if market not in ("Houston", "Los Angeles"):
            raise ValueError("market must be Houston or Los Angeles (the markets in the CoStar extract)")
        where.append("market = ?"); args.append(market)
    for col, op, v in (("lot_acres", ">=", min_acres), ("lot_acres", "<=", max_acres),
                       ("building_sf", ">=", min_building_sf), ("building_sf", "<=", max_building_sf)):
        if v is not None:
            where.append(f"{col} {op} ?"); args.append(float(v))
    if heavy_power:
        where.append("has_heavy_power = 1")
    if available_only:
        where.append("availability IS NOT NULL AND availability != ''")
    if dc_candidates_only:
        where.append("dc_candidate = 1")
    types = [t for t in (property_types or []) if t][:6]
    if types:
        where.append("(" + " OR ".join("lower(property_type) LIKE ?" for _ in types) + ")")
        args += [f"%{t.lower()}%" for t in types]
    price = "COALESCE(asking_price_high, asking_price_low, last_sale_price)"
    if max_price is not None:
        where.append(f"{price} <= ?"); args.append(float(max_price))
    order = {"acres": "lot_acres IS NULL, lot_acres DESC", "price": f"{price} IS NULL, {price} ASC",
             "power": "amps_high IS NULL, amps_high * COALESCE(volts_high, 480) DESC",
             "building": "building_sf IS NULL, building_sf DESC"}.get(sort)
    if order is None:
        raise ValueError("sort must be acres, price, power or building")
    limit = max(1, min(MAX_LIMIT, int(limit)))
    w = " AND ".join(where)
    with session() as c:
        total = c.execute(f"SELECT COUNT(*) FROM parcels WHERE {w}", args).fetchone()[0]
        rows = [dict(r) for r in c.execute(f"SELECT * FROM parcels WHERE {w} ORDER BY {order} LIMIT ?", (*args, limit))]
    props = []
    for p in rows:
        mw, _ = service_capacity_mw(p.get("amps_high"), p.get("volts_high"))
        props.append({"parcel_id": p["parcel_id"], "name": p.get("name"), "address": p.get("address"), "city": p.get("city"),
                      "market": p.get("market"), "property_type": p.get("property_type"), "subtype": p.get("property_subtype"),
                      "lot_acres": p.get("lot_acres"), "building_sf": p.get("building_sf"), "year_built": p.get("year_built"),
                      "availability": p.get("availability") or None,
                      "asking_price": p.get("asking_price_high") or p.get("asking_price_low"),
                      "last_sale_price": p.get("last_sale_price"), "last_sale_date": p.get("last_sale_date"),
                      "existing_service_mw": round(mw, 2) if mw else None, "matterport_scans": p.get("matterport_count") or 0,
                      "lat": p["lat"], "lon": p["lon"], "source": _src(p)})
    return ({"total": total, "returned": len(props), "properties": props, "sort": sort,
             "note": f"Searches the CoStar extract only. {TODAY_NOTE} Availability is CoStar's listing status, not a vacancy measure."},
            "Sourced")


def get_property_intelligence(parcel_id: str):
    """The dossier: every analysis for one property, each section independent so one gap does not hide the rest."""
    p = _parcel(parcel_id)
    sections: dict[str, Any] = {}
    for name, call in (
        ("building", lambda: _fn("building", "building", "building_facts")(parcel_id)),
        ("valuation", lambda: _fn("valuation", "valuation")(parcel_id)),
        ("occupancy", lambda: _fn("tenancy", "occupancy_status")(parcel_id)),
        ("redevelopment", lambda: _fn("redevelop", "redevelopment")(parcel_id)),
        ("community", lambda: _fn("homes", "community")(parcel_id)),
        ("market", lambda: _fn("market", "market_for_parcel")(parcel_id)),
    ):
        try:
            sections[name] = {"ok": True, "data": call()}
        except Exception as e:
            sections[name] = {"ok": False, "error": str(e)}
    return ({"parcel_id": parcel_id, "name": p.get("name"), "address": p.get("address"), "city": p.get("city"),
             "market": p.get("market"), "property": _src(p), "sections": sections, "note": TODAY_NOTE}, "Sourced and estimated")


def find_sales_comps(parcel_id: str, exclude: list[str] | None = None, max_age_years: float | None = None,
                     radius_km: float | None = None, basis: str | None = None):
    _parcel(parcel_id)
    opts = {k: v for k, v in {"exclude": exclude, "max_age_years": max_age_years, "radius_km": radius_km, "basis": basis}.items() if v is not None}
    data = _fn("valuation", "find_comps")(parcel_id, **opts)
    return data, (data.get("label") if isinstance(data, dict) else None) or "Estimated from CoStar sale comps"


def _underwrite_brief(p: dict[str, Any], mw_it: float, rack_kw: float) -> dict[str, Any]:
    acres = p.get("lot_acres") or mw_it / A.value("mw_per_acre")
    area = acres * 4046.86
    w = math.sqrt(area * 1.3)
    return dict(name=p.get("name") or p["parcel_id"], mw_it=mw_it, rack_kw=rack_kw, redundancy="N+1", cooling="liquid",
                halls=None, site_w=max(60.0, round(w)), site_d=max(60.0, round(area / w)), setback_m=8.0, expansion_pct=10.0,
                flexible_share=0.0, storeys=1, rent_kw_month=None)


def _gates(p: dict[str, Any]) -> list[dict[str, Any]]:
    """The same hard-gate screen the Studio shows for this property."""
    try:
        from .. import external
        from ..screening import Thresholds, load_homes, screen_parcel
        s = screen_parcel(p, load_homes(external.MARKET_BBOX.get(p.get("market"))), external.osm_substations(p.get("market")),
                          Thresholds(), offline=True)
        return s.as_dict().get("gates", [])
    except Exception:
        return []


def underwrite_acquisition(parcel_id: str, mw_it: float = 20.0, rack_kw: float = 20.0, price_change_pct: float = 0.0,
                           acquisition_value: float | None = None, max_comp_age_years: float | None = None):
    """Acquisition evidence (comps) → PlotStar's deterministic development model (capex, energy, NPV range, payback)."""
    p = _parcel(parcel_id)
    if not (0.5 < mw_it <= 500) or not (3 <= rack_kw <= 200):
        raise ValueError("mw_it must be in (0.5, 500] and rack_kw in [3, 200]")
    val: dict[str, Any] | None = None
    basis_text, label = "", "Unknown"
    if acquisition_value is None:
        try:
            val = _fn("valuation", "valuation")(parcel_id, **({"max_age_years": max_comp_age_years} if max_comp_age_years else {}))
        except ToolError:
            val = None
        uw = (val or {}).get("underwriting") or {}
        acquisition_value = uw.get("acquisition_value")
        basis_text, label = uw.get("basis_text") or "", uw.get("label") or "Estimated"
        if acquisition_value is None:
            asking = p.get("asking_price_high") or p.get("asking_price_low")
            if asking:
                acquisition_value, label, basis_text = float(asking), "Sourced", f"CoStar asking price ({_src(p)})"
    else:
        label, basis_text = "User assumption", "Acquisition value supplied by the user"
    base_value = acquisition_value
    if acquisition_value is not None and price_change_pct:
        acquisition_value = acquisition_value * (1 + price_change_pct / 100.0)
    from ..routers.studio import _grid
    grid = _grid()
    gates = _gates(p)
    site = {"id": parcel_id, "name": p.get("name"), "lat": p["lat"], "lon": p["lon"], "gates": gates,
            "land_cost": acquisition_value, "land_label": label if acquisition_value else None, "land_basis": basis_text or None}
    brief = _underwrite_brief(p, mw_it, rack_kw)
    r = layout_engine.generate(brief, site, grid, {}, {}, {})
    best = min((c for c in r["concepts"] if c["feasible"]), key=lambda c: c["rank"], default=r["concepts"][0])
    m = best["money"]
    out = {"parcel_id": parcel_id, "property": _src(p), "brief": {"mw_it": mw_it, "rack_kw": rack_kw, "site_w": brief["site_w"],
                                                                  "site_d": brief["site_d"], "lot_acres": p.get("lot_acres")},
           "acquisition": {"value": acquisition_value, "base_value": base_value, "price_change_pct": price_change_pct,
                           "label": label, "basis": basis_text or "No CoStar price or comp estimate; land left out of totals",
                           "valuation": (val or {}).get("estimate") if val else None,
                           "comps_used": (val or {}).get("n_used"), "comps_stale": (val or {}).get("n_stale"),
                           "comp_window_years": (val or {}).get("max_age_years"), "valuation_status": (val or {}).get("status")},
           "concept": best["name"], "feasible": best["feasible"],
           "money": {k: m.get(k) for k in ("capex", "land", "total_investment", "energy_per_year", "opex_per_year",
                                           "revenue_per_year", "npv", "npv_p10", "npv_p50", "npv_p90", "payback_years",
                                           "months_to_power", "ten_year", "analysis_years")},
           "failed_checks": [k["name"] for k in best["checks"] if not k["ok"]],
           "gates": [{"gate": g.get("gate"), "status": g.get("status")} for g in gates],
           "finance": r["finance"], "assumptions_note": r["note"],
           "irr": None, "irr_note": "The development model reports NPV (P10/P50/P90) and payback; it does not compute IRR."}
    return out, "Estimated (conceptual underwriting)"


def find_off_market_candidates(market: str = "Houston", category: str = "data_center_redevelopment", limit: int = 10, **filters: Any):
    data = _fn("redevelop", "find_candidates")(market, category, max(1, min(MAX_LIMIT, int(limit))), **filters)
    if isinstance(data, dict):
        data.setdefault("note", "Screening candidates from CoStar attributes. Nothing here implies a property is for sale.")
    return data, "Screening (CoStar attributes)"


def analyze_occupancy(parcel_id: str):
    _parcel(parcel_id)
    out: dict[str, Any] = {"status": _fn("tenancy", "occupancy_status")(parcel_id)}
    try:
        out["control"] = _fn("tenancy", "control")(parcel_id)
    except ToolError as e:
        out["control"] = {"error": str(e)}
    out["note"] = "A property with no tenant record is 'unknown', not vacant. Lease dates are only shown when CoStar records them."
    return out, "Sourced (CoStar tenancy and listings)"


def analyze_submarket(parcel_id: str | None = None, market: str | None = None, compare: str | None = None):
    if parcel_id:
        return _fn("market", "market_for_parcel")(parcel_id), "Sourced aggregates (sample)"
    if compare == "markets":
        return _fn("market", "compare_markets")(), "Sourced aggregates (sample)"
    if not market:
        raise ValueError("Give a parcel_id, or a market (Houston or Los Angeles), or compare='markets'")
    return _fn("market", "compare_submarkets")(market), "Sourced aggregates (sample)"


def find_adjacent_properties(parcel_id: str, radius_m: float = 400, limit: int = 10):
    """Assemblage screen: other CoStar properties whose recorded points are within radius_m of this one."""
    p = _parcel(parcel_id)
    radius_m = max(50.0, min(3000.0, float(radius_m)))
    dlat = radius_m / 111_320.0
    dlon = radius_m / (111_320.0 * max(0.2, math.cos(math.radians(p["lat"]))))
    with session() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM parcels WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND parcel_id != ?",
            (p["lat"] - dlat, p["lat"] + dlat, p["lon"] - dlon, p["lon"] + dlon, parcel_id))]
    near = sorted(({**r, "_d": haversine_m(p["lat"], p["lon"], r["lat"], r["lon"])} for r in rows), key=lambda r: r["_d"])
    near = [r for r in near if r["_d"] <= radius_m][: max(1, min(MAX_LIMIT, int(limit)))]
    combined = (p.get("lot_acres") or 0) + sum(r.get("lot_acres") or 0 for r in near)
    return ({"subject": {"parcel_id": parcel_id, "lot_acres": p.get("lot_acres"), "source": _src(p)},
             "neighbours": [{"parcel_id": r["parcel_id"], "name": r.get("name"), "address": r.get("address"),
                             "distance_m": round(r["_d"]), "lot_acres": r.get("lot_acres"), "property_type": r.get("property_type"),
                             "availability": r.get("availability") or None, "source": _src(r)} for r in near],
             "combined_lot_acres_if_all": round(combined, 2) if combined else None,
             "supportable_mw_at_team_density": round(combined * A.value("mw_per_acre"), 1) if combined else None,
             "limits": ["The kit has no parcel boundaries or ownership, so 'adjacent' means the recorded property points are "
                        f"within {radius_m:.0f} m, not that the lots touch.",
                        "An assemblage needs a title search, parcel geometry and willing sellers before it is feasible."]},
            "Screening (CoStar locations)")


def analyze_residential_impact(parcel_id: str, gen_offset_m: float | None = None):
    _parcel(parcel_id)
    kw = {"gen_offset_m": gen_offset_m} if gen_offset_m is not None else {}
    return _fn("homes", "community")(parcel_id, **kw), "Sourced locations, estimated noise"


def compare_property_portfolio(parcel_ids: list[str], mw_it: float = 20.0, rack_kw: float = 20.0):
    ids = list(dict.fromkeys(parcel_ids))[:8]
    if len(ids) < 2:
        raise ValueError("Give 2 to 8 CoStar parcel ids to compare")
    rows = []
    for pid in ids:
        row: dict[str, Any] = {"parcel_id": pid}
        try:
            uw, _ = underwrite_acquisition(pid, mw_it, rack_kw)
            row.update(name=_parcel(pid).get("name"), acquisition=uw["acquisition"]["value"], acquisition_label=uw["acquisition"]["label"],
                       capex=uw["money"]["capex"], npv=uw["money"]["npv"], npv_p10=uw["money"]["npv_p10"], npv_p90=uw["money"]["npv_p90"],
                       months_to_power=uw["money"]["months_to_power"], feasible=uw["feasible"], failed_checks=uw["failed_checks"],
                       gates_failed=[g["gate"] for g in uw["gates"] if g["status"] == "Fail"])
        except Exception as e:
            row["error"] = str(e)
        for key, call in (("occupancy", lambda: _fn("tenancy", "occupancy_status")(pid)),
                          ("community", lambda: _fn("homes", "community")(pid))):
            try:
                row[key] = _summary(call())
            except Exception as e:
                row[key] = {"error": str(e)}
        rows.append(row)
    ok = [r for r in rows if "npv" in r]
    ranked = sorted(ok, key=lambda r: (bool(r["gates_failed"]), not r["feasible"], -(r["npv"] or -1e18)))
    for i, r in enumerate(ranked):
        r["rank"] = i + 1
    return ({"brief": {"mw_it": mw_it, "rack_kw": rack_kw}, "properties": rows,
             "ranking_rule": "Properties failing a hard gate rank last; then infeasible layouts; then by NPV (P50).",
             "note": "NPV uses each property's comp-based or CoStar-sourced acquisition value where available; otherwise land is left out and the row says so."},
            "Estimated (conceptual)")


def _summary(d: Any) -> Any:
    """A compact view of a nested analysis for tables."""
    if not isinstance(d, dict):
        return d
    keep = {k: v for k, v in d.items() if not isinstance(v, (list, dict)) or k in ("states", "rings", "bands")}
    return keep


def get_matterport_model(parcel_id: str):
    data = _fn("building", "building", "building_facts")(parcel_id)
    mp = data.get("matterport") if isinstance(data, dict) else None
    return ({"parcel_id": parcel_id, "matterport": mp, "note": "Existing-building scans recorded by CoStar. Scope says how much of the building a scan covers."},
            "Sourced (CoStar Matterport references)")


def evaluate_conversion(parcel_id: str, mw_it: float = 10.0, rack_kw: float = 20.0):
    return _fn("building", "conversion")(parcel_id, mw_it, rack_kw), "Conceptual screening, not engineering feasibility"


def identify_data_gaps(parcel_id: str):
    p = _parcel(parcel_id)
    intel, _ = get_property_intelligence(parcel_id)
    gaps: list[dict[str, str]] = []

    def gap(area: str, text: str, severity: str = "medium") -> None:
        gaps.append({"area": area, "gap": text, "severity": severity})
    for name, sec in intel["sections"].items():
        if not sec["ok"]:
            gap(name, f"Analysis unavailable: {sec['error']}", "high")
    if not p.get("building_sf"):
        gap("building", "Building size not recorded in CoStar.")
    if not p.get("amps_high"):
        gap("power", "Existing electric service (amps) not recorded in CoStar.", "high")
    gap("power", "Utility interconnection capacity is not in any dataset; a utility study is required.", "high")
    gap("title", "Ownership, title and parcel boundaries are not in the CoStar extract.", "high")
    gap("zoning", "Zoning permission for a data center is not verified." + (f" CoStar zoning field: {p['zoning']}." if p.get("zoning") and p["zoning"] != "None" else ""), "high")
    gap("structure", "Slab load, roof structure and floor-to-floor height are not in CoStar; a structural survey is required.")
    gap("environment", "No Phase I environmental site assessment in the data.")
    val = intel["sections"].get("valuation", {})
    if val.get("ok") and not ((val.get("data") or {}).get("estimate")):
        gap("valuation", "Too few usable sale comps for an indicative value.", "high")
    occ = intel["sections"].get("occupancy", {})
    if occ.get("ok") and "unknown" in str((occ.get("data") or {})).lower():
        gap("occupancy", "Occupancy is unknown for part or all of the building; leasing diligence is needed.")
    return {"parcel_id": parcel_id, "property": _src(p), "gaps": gaps,
            "counts": {s: sum(1 for g in gaps if g["severity"] == s) for s in ("high", "medium", "low")}}, "Diligence checklist"


def generate_investment_memo(parcel_id: str, mw_it: float = 20.0, rack_kw: float = 20.0):
    """A sourced memo assembled from the other tools. The recommendation follows fixed rules, stated in the memo."""
    p = _parcel(parcel_id)
    uw, _ = underwrite_acquisition(parcel_id, mw_it, rack_kw)
    intel, _ = get_property_intelligence(parcel_id)
    gaps, _ = identify_data_gaps(parcel_id)
    s = intel["sections"]
    gates_failed = [g["gate"] for g in uw["gates"] if g["status"] == "Fail"]
    m = uw["money"]
    if gates_failed:
        rec = "Do not pursue"
        why = f"fails hard gate(s): {', '.join(gates_failed)}"
    elif not uw["feasible"]:
        rec = "Do not pursue at this size"
        why = "the brief does not fit the lot"
    elif m.get("npv_p90") is not None and m["npv_p90"] < 0:
        rec = "Do not pursue on current assumptions"
        why = "even the optimistic (P90) NPV is negative"
    elif uw["acquisition"]["value"] is None or gaps["counts"]["high"] > 4:
        rec = "Proceed to diligence only"
        why = "economics depend on evidence that is still missing"
    else:
        rec = "Proceed to diligence"
        why = "passes the screens with a defensible acquisition basis"

    def section(name: str) -> Any:
        sec = s.get(name, {})
        return sec.get("data") if sec.get("ok") else {"unavailable": sec.get("error")}
    memo = {
        "title": f"{mw_it:g} MW data center at {p.get('address') or p.get('name')}, {p.get('city')}",
        "recommendation": rec, "because": why,
        "rule": "Hard-gate failure > layout infeasible > P90 NPV < 0 > missing acquisition basis or >4 high gaps > proceed to diligence.",
        "property": {"parcel_id": parcel_id, "type": p.get("property_type"), "lot_acres": p.get("lot_acres"),
                     "building_sf": p.get("building_sf"), "year_built": p.get("year_built"), "source": _src(p)},
        "acquisition": uw["acquisition"], "development": {"concept": uw["concept"], **m}, "irr_note": uw["irr_note"],
        "occupancy": section("occupancy"), "community": _summary(section("community")), "market": _summary(section("market")),
        "redevelopment": _summary(section("redevelopment")), "diligence": gaps["gaps"],
        "disclaimer": "Conceptual screening from the CoStar hackathon extract and PlotStar's planning model. Not an appraisal, "
                      "not engineering, not investment advice.",
    }
    return memo, "Recommendation by fixed rules from sourced and estimated inputs"


def save_to_deal_room(kind: str, parcel_id: str | None = None, project_id: str | None = None, payload: dict[str, Any] | None = None,
                      confirm: bool = False):
    """The only write tool. Requires confirm=True."""
    if not confirm:
        raise ToolError("Saving changes the deal record. Ask the user, then call again with confirm=true.")
    payload = payload or {}
    if kind == "comp_selection":
        res = deal_room.save_comp_selection(parcel_id or "", list(payload.get("excluded") or []), payload.get("basis"),
                                            payload.get("estimate"), project_id)
    elif kind == "scenario":
        if not project_id:
            raise ValueError("A scenario needs a project_id")
        res = deal_room.save_scenario(project_id, parcel_id, dict(payload.get("assumptions") or {}), str(payload.get("note") or ""))
    else:
        raise ValueError("kind must be comp_selection or scenario")
    return res, "Saved"


TOOLS: dict[str, Callable[..., tuple[Any, str | None]]] = {
    "search_costar_properties": search_costar_properties,
    "get_property_intelligence": get_property_intelligence,
    "find_sales_comps": find_sales_comps,
    "underwrite_acquisition": underwrite_acquisition,
    "find_off_market_candidates": find_off_market_candidates,
    "analyze_occupancy": analyze_occupancy,
    "analyze_submarket": analyze_submarket,
    "find_adjacent_properties": find_adjacent_properties,
    "analyze_residential_impact": analyze_residential_impact,
    "compare_property_portfolio": compare_property_portfolio,
    "get_matterport_model": get_matterport_model,
    "evaluate_conversion": evaluate_conversion,
    "identify_data_gaps": identify_data_gaps,
    "generate_investment_memo": generate_investment_memo,
    "save_to_deal_room": save_to_deal_room,
}
READ_ONLY = {k for k in TOOLS if k != "save_to_deal_room"}
# Deterministic for the same arguments within the cache window (6 h); search is cheap and stays uncached.
CACHEABLE = {"find_sales_comps", "underwrite_acquisition", "analyze_occupancy", "analyze_residential_impact",
             "analyze_submarket", "evaluate_conversion", "get_matterport_model", "get_property_intelligence",
             "identify_data_gaps", "find_off_market_candidates", "find_adjacent_properties"}
