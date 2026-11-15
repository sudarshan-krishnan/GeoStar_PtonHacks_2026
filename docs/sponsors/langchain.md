# GeoStar Deep Agents

One orchestrator, six specialist subagents, one conversation. Built on the LangChain **Deep Agents SDK**
(`create_deep_agent`, deepagents 0.7.38) on the LangGraph runtime, traced in LangSmith (project `plotstar`).
Code: `services/api/app/sponsors/langchain/deep_agents/`, API: `services/api/app/sponsors/langchain/routes_agents.py`, UI: `src/components/sponsors/langchain/`.

**Rule:** models decide what to investigate and explain it; deterministic code produces every number and the score.

## Agents

| Agent | Model | Tools |
|---|---|---|
| PlotStar Orchestrator | claude-sonnet-5-5 | `write_todos` (plan), `task` (delegate), `compute_site_score`, `dispatch_safety_alert` (needs a person's approval) |
| Property Intelligence | claude-haiku-5-5 | 11 CoStar tools over MCP (property, data gaps, comps, occupancy, submarket, neighbours, conversion, Matterport, search) |
| Financial Feasibility | claude-haiku-5-5 | `development_economics`, CoStar `underwrite_acquisition` / comps / memo (MCP), `grid_conditions`, `what_if` |
| Resource & Infrastructure | claude-haiku-5-5 | `screen_site`, `resource_demand`, `grid_conditions`, CoStar `evaluate_conversion` (MCP), `what_if` |
| Community & Sustainability | claude-haiku-5-5 | CoStar `analyze_residential_impact` (MCP), `screen_site`, `community_impact`, `grid_conditions` |
| Design & Simulation | claude-haiku-5-5 | `generate_layouts`, `compare_concepts`, `inspect_object`, `what_if` |
| Safety & Operations | claude-haiku-5-5 | `facility_protection_state`, `safety_playbook` |

Models are set by `PLOTSTAR_AGENT_MODEL` / `PLOTSTAR_SUBAGENT_MODEL`. Each subagent returns structured `Findings`
(objective, evidence ids, tools, calculations, assumptions, findings, confidence, risks, next steps) and is capped at
`PLOTSTAR_SUBAGENT_CALL_LIMIT` model calls (default 10).

## Two entry points, one graph

- **Site evaluation** (`POST /agents/site-evaluation`): plan → Property Intelligence → Financial, Resource and
  Community **in parallel** (several `task` calls in one message) → `compute_site_score` → re-delegate once on a
  conflict or closable gap → answer.
- **Conversation** (`POST /agents/chat`): the Studio's one "Ask GeoStar" agent. Each turn carries the live state
  (stage, site, brief, active concept, selected object, last score, deployed facility). The orchestrator delegates only
  to the specialists the question needs. What-ifs come back as a preview the user applies.

## The score

`app/sponsors/langchain/deep_agents/scoring.py`: four pillars (Property 20 %, Money 30 %, Power and resources 25 %, People and planet 25 %),
eleven criteria, each linear between documented anchors, read from the evidence the specialists' tools recorded. A
criterion with no evidence is a gap (its weight is shared out; coverage drops). Hard gates override the score. A
specialist whose conclusion disagrees with its own evidence is reported as a conflict. The full rule is served at
`GET /agents/architecture` and shown on `/studio/agent`.

## Seeing it

- **Agent Intelligence** panel (Studio top bar pill, "Analyze with agents" on a site, "How the agents worked it out"
  under any answer, and `/studio/agent`): live graph, timeline, and evidence and decisions. Every node is a LangChain
  callback the runtime fired (`app/sponsors/langchain/deep_agents/runtime.py` `Recorder`), so its id is the LangSmith run id.
- **LangSmith**: the root run is `PlotStar / Site Evaluation` or `PlotStar / Conversation`; subagents are chain runs
  named by their slug (`ls_agent_type=subagent`, `lc_agent_name`); models are `llm` runs named `Model / <agent>` with
  `agent_name`, `agent_role`, `model_name` metadata; tools are `tool` runs tagged `mcp`/`costar` or `geostar`;
  `Computation / Weighted Site Score` and `Verify / Evidence and numbers` are separate runs.

## CoStar over MCP and privacy

CoStar tools are called through GeoStar's own MCP server (`app/sponsors/costar/mcp_server.py`) with `mcp.Client` in-process (the
real MCP protocol over memory streams), one session per API process. `save_to_deal_room` (the only write tool) is not
given to agents. Full tool output is kept as evidence in GeoStar and shown in the UI; the model and the LangSmith trace
see a view without CoStar names, addresses, prices, rents and coordinates unless `COPILOT_LLM_COSTAR=1`.

## Verification

After every run, `verify()` checks that each number in the answer matches a tool result (allowing rounding and $M/k
scaling) and that every cited evidence id exists. It flags; it never rewrites.

## Tests

`services/api/tests/test_deep_agents.py`: delegation and attribution from real callbacks (fake models), parallel
delegations, structured findings capture, score reproducibility, gaps, gates, conflicts, CoStar redaction,
verification, the findings boundary, and the 15 MCP tools.
