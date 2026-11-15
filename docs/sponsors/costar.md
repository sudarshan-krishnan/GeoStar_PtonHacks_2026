# CoStar

**Backend** `services/api/app/sponsors/costar/` · **Frontend** `src/components/sponsors/costar/`

- `loader.py` loads the CoStar hackathon extract (unzipped outside the repo, `COSTAR_KIT_DIR`) into a local SQLite store.
  The kit is licensed and never committed.
- `tools.py` holds the 15 intelligence tools. `mcp_server.py` serves them as the **GeoStar CoStar MCP server**: stdio
  for Claude Code/Desktop (`.mcp.json` → `services/api/run_mcp.py`), and in-process for GeoStar's own agents.
- Analyses: `comps.py` / `valuation.py` / `market.py` (sale comps, value, submarket), `tenancy.py` (occupancy),
  `homes.py` (residential exposure, generator noise), `redevelop.py` (redevelopment screen), `building.py` (building facts,
  Matterport scan scope, conversion check), `deal_room.py` (notes, comp selections, scenarios, audit).
- Routes: `routes_sites.py` (parcels), `routes_building.py` (building, conversion, site walk), `routes_land.py`,
  `routes_site.py`, `routes_intel.py` (tools, MCP audit timeline, deal room, Deal-to-Design).
- UI: the CoStar dossier, Deal Desk, and Existing vs Proposed (the scan next to GeoStar's concept).

Every result carries `sources` (record references) and a `label` (Sourced, Estimated, Screening, Unknown).
Field reference: [costar-data-dictionary.md](costar-data-dictionary.md).
