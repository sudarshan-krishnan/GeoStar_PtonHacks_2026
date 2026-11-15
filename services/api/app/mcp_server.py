"""PlotStar CoStar Intelligence MCP server.

Exposes the CoStar intelligence tools (app/costar/tools.py) to any MCP client: Claude Code, Claude Desktop, or an
agent. It is PlotStar's own server over the CoStar hackathon extract, not an official CoStar product; it reads the
licensed kit loaded locally and never sends kit data anywhere except back to the calling client.

    stdio (local clients):   python -m app.mcp_server
    HTTP (streamable):       python -m app.mcp_server --http --port 8020   (requires PLOTSTAR_MCP_TOKEN; binds 127.0.0.1)

Every tool is read-only except save_to_deal_room, which needs confirm=true. Every call is written to the audit log
(GET /mcp/audit on the PlotStar API shows the timeline), with inputs, status, timing and source counts.
"""
from __future__ import annotations

import argparse
import hmac
import os
from typing import Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from .costar import tools as T

server = MCPServer(
    name="plotstar-costar",
    title="PlotStar CoStar Intelligence",
    version="1.0.0",
    instructions=(
        "Tools over the CoStar hackathon extract (Houston and Los Angeles commercial properties, sale comps, tenancy, "
        "residential listings, Matterport references) plus PlotStar's deterministic data center development model. "
        "Start with search_costar_properties to get parcel ids (format costar:<propertyId>). Every result carries "
        "`sources` (CoStar record references) and a `label` (Sourced / Estimated / Screening). Treat 'unknown' as unknown: "
        "no tenant record does not mean vacant, and no comps means no value. Ask the user before save_to_deal_room."),
)

RO = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def _r(tool: str, **args: Any) -> dict[str, Any]:
    return T.run(tool, via="mcp", **args)


@server.tool(annotations=RO, description="Search CoStar commercial properties by market, size, type, price, availability and power.")
def search_costar_properties(market: Literal["Houston", "Los Angeles"] | None = None, min_acres: float | None = None,
                             max_acres: float | None = None, property_types: list[str] | None = None,
                             heavy_power: bool | None = None, max_price: float | None = None, available_only: bool = False,
                             min_building_sf: float | None = None, max_building_sf: float | None = None,
                             dc_candidates_only: bool = False, sort: Literal["acres", "price", "power", "building"] = "acres",
                             limit: int = 10) -> dict[str, Any]:
    return _r("search_costar_properties", market=market, min_acres=min_acres, max_acres=max_acres, property_types=property_types,
              heavy_power=heavy_power, max_price=max_price, available_only=available_only, min_building_sf=min_building_sf,
              max_building_sf=max_building_sf, dc_candidates_only=dc_candidates_only, sort=sort, limit=limit)


@server.tool(annotations=RO, description="Full property dossier: building, valuation, occupancy, redevelopment, community, submarket.")
def get_property_intelligence(parcel_id: str) -> dict[str, Any]:
    return _r("get_property_intelligence", parcel_id=parcel_id)


@server.tool(annotations=RO, description="Comparable sales for a property, ranked by similarity, with stale and rejected comps explained. "
                                         "Pass exclude=[comp ids] to recalculate without them.")
def find_sales_comps(parcel_id: str, exclude: list[str] | None = None, max_age_years: float | None = None,
                     radius_km: float | None = None, basis: Literal["sf", "acre"] | None = None) -> dict[str, Any]:
    return _r("find_sales_comps", parcel_id=parcel_id, exclude=exclude, max_age_years=max_age_years, radius_km=radius_km, basis=basis)


@server.tool(annotations=RO, description="Acquisition underwriting: comp-based (or CoStar asking) acquisition value fed into PlotStar's "
                                         "development model for capex, NPV P10/P50/P90, payback and months to power. "
                                         "price_change_pct tests a higher or lower purchase price.")
def underwrite_acquisition(parcel_id: str, mw_it: float = 20.0, rack_kw: float = 20.0, price_change_pct: float = 0.0,
                           acquisition_value: float | None = None, max_comp_age_years: float | None = None) -> dict[str, Any]:
    return _r("underwrite_acquisition", parcel_id=parcel_id, mw_it=mw_it, rack_kw=rack_kw, price_change_pct=price_change_pct,
              acquisition_value=acquisition_value, max_comp_age_years=max_comp_age_years)


@server.tool(annotations=RO, description="Redevelopment screening candidates from CoStar attributes (data center, industrial conversion, "
                                         "expansion, adaptive reuse, land). Does not imply anything is for sale.")
def find_off_market_candidates(market: Literal["Houston", "Los Angeles"] = "Houston",
                               category: Literal["data_center_redevelopment", "industrial_conversion", "expansion", "adaptive_reuse",
                                                 "land_acquisition"] = "data_center_redevelopment",
                               limit: int = 10) -> dict[str, Any]:
    return _r("find_off_market_candidates", market=market, category=category, limit=limit)


@server.tool(annotations=RO, description="Occupancy evidence: confirmed vacant / listed available / occupied / unknown, tenants, lease "
                                         "expiries and time to full control.")
def analyze_occupancy(parcel_id: str) -> dict[str, Any]:
    return _r("analyze_occupancy", parcel_id=parcel_id)


@server.tool(annotations=RO, description="Submarket statistics for a property, a submarket comparison for a market, or Houston vs Los Angeles "
                                         "(compare='markets'). Aggregates of the extract, which is a sample, not total inventory.")
def analyze_submarket(parcel_id: str | None = None, market: Literal["Houston", "Los Angeles"] | None = None,
                      compare: Literal["markets"] | None = None) -> dict[str, Any]:
    return _r("analyze_submarket", parcel_id=parcel_id, market=market, compare=compare)


@server.tool(annotations=RO, description="Nearby CoStar properties for a possible land assemblage, with combined acreage. Point distance only: "
                                         "no parcel boundaries or ownership in the data.")
def find_adjacent_properties(parcel_id: str, radius_m: float = 400, limit: int = 10) -> dict[str, Any]:
    return _r("find_adjacent_properties", parcel_id=parcel_id, radius_m=radius_m, limit=limit)


@server.tool(annotations=RO, description="Residential exposure: CoStar home listings and apartment communities by distance band, nearest "
                                         "receptors and modelled generator noise. Listings are not population.")
def analyze_residential_impact(parcel_id: str, gen_offset_m: float | None = None) -> dict[str, Any]:
    return _r("analyze_residential_impact", parcel_id=parcel_id, gen_offset_m=gen_offset_m)


@server.tool(annotations=RO, description="Compare 2-8 properties on acquisition value, development economics, occupancy and community "
                                         "exposure, ranked by a stated rule.")
def compare_property_portfolio(parcel_ids: list[str], mw_it: float = 20.0, rack_kw: float = 20.0) -> dict[str, Any]:
    return _r("compare_property_portfolio", parcel_ids=parcel_ids, mw_it=mw_it, rack_kw=rack_kw)


@server.tool(annotations=RO, description="Matterport scans CoStar recorded for a property, with how much of the building each covers.")
def get_matterport_model(parcel_id: str) -> dict[str, Any]:
    return _r("get_matterport_model", parcel_id=parcel_id)


@server.tool(annotations=RO, description="Could this existing building hold a data center of mw_it? Conceptual screening against the "
                                         "building's recorded size, with the missing structural and electrical facts listed.")
def evaluate_conversion(parcel_id: str, mw_it: float = 10.0, rack_kw: float = 20.0) -> dict[str, Any]:
    return _r("evaluate_conversion", parcel_id=parcel_id, mw_it=mw_it, rack_kw=rack_kw)


@server.tool(annotations=RO, description="The diligence checklist: what is unknown or unverified for this property.")
def identify_data_gaps(parcel_id: str) -> dict[str, Any]:
    return _r("identify_data_gaps", parcel_id=parcel_id)


@server.tool(annotations=RO, description="A sourced investment memo with a rule-based recommendation (the rule is included).")
def generate_investment_memo(parcel_id: str, mw_it: float = 20.0, rack_kw: float = 20.0) -> dict[str, Any]:
    return _r("generate_investment_memo", parcel_id=parcel_id, mw_it=mw_it, rack_kw=rack_kw)


@server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False),
             description="Save a comp selection or a scenario to the deal room. Ask the user first; requires confirm=true.")
def save_to_deal_room(kind: Literal["comp_selection", "scenario"], parcel_id: str | None = None, project_id: str | None = None,
                      payload: dict[str, Any] | None = None, confirm: bool = False) -> dict[str, Any]:
    return _r("save_to_deal_room", kind=kind, parcel_id=parcel_id, project_id=project_id, payload=payload, confirm=confirm)


def http_app():
    """The streamable-HTTP app behind a bearer-token check (constant-time compare)."""
    token = os.getenv("PLOTSTAR_MCP_TOKEN", "")
    if len(token) < 16:
        raise SystemExit("Set PLOTSTAR_MCP_TOKEN (16+ characters) to serve MCP over HTTP.")
    inner = server.streamable_http_app(host="127.0.0.1")

    async def app(scope, receive, send):
        if scope["type"] == "http":
            auth = dict(scope.get("headers") or []).get(b"authorization", b"").decode()
            if not hmac.compare_digest(auth, f"Bearer {token}"):
                await send({"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"text/plain")]})
                await send({"type": "http.response.body", "body": b"Unauthorized"})
                return
        await inner(scope, receive, send)
    return app


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--http", action="store_true", help="serve streamable HTTP on 127.0.0.1 instead of stdio")
    ap.add_argument("--port", type=int, default=8020)
    a = ap.parse_args()
    if a.http:
        import uvicorn
        uvicorn.run(http_app(), host="127.0.0.1", port=a.port, log_level="warning")
    else:
        server.run("stdio")


if __name__ == "__main__":
    main()
