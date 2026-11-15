# MongoDB Atlas in PlotStar

PlotStar uses Atlas (cluster `PlotStar`, database `plotstar`) as its data platform. Everything below is
built and verified from code in `services/api/app/atlas.py` and `store.py`; the last section lists the
console-only Atlas features and exactly how to turn them on.

## Data governance: the CoStar kit stays local

Atlas holds **app state and derived facts keyed by CoStar ids**, never CoStar's descriptive payloads. Concretely:
`sites` stores `parcel_id`, the location, the screening gates (FEMA NFHL, WRI Aqueduct, OpenStreetMap — public
sources), distance-to-homes and distance-to-power, and an embedding of those facts; project documents store the
site's id and coordinates only (`store.save` strips `name`/`address` for `costar:` ids). The UI hydrates names and
addresses by id from the local data service (`GET /sites/{id}`), which reads the kit on this machine.
`POST /atlas/scrub` applies this retroactively and reports any remaining CoStar fields (expected: 0).

## Collections and schema

| Collection | What | Schema | Indexes |
|---|---|---|---|
| `studio_projects` | one document per Studio project: brief, site (GeoJSON point), priorities, edits, preferred concept, reasons, decider, history, summary, embedding | `$jsonSchema` (status enum, MW range, point) | `updated_at`, `site.loc` 2dsphere, `status+updated_at`, `market`, Vector Search `projects_vec` |
| `sites` | every screened CoStar parcel in both markets (126): location, lot, land price with label, gates with sources, power signals, provenance, embedding | `$jsonSchema` (gate status enum, label enum, point) | `loc` 2dsphere, `market+screen_status`, `lot_acres`, unique `parcel_id`, Atlas Search `sites_search`, Vector Search `sites_vec` |
| `decisions` | append-only audit event per project save (who, what, when, summary) | `$jsonSchema` | `project_id+at`, `at` |
| `grid_telemetry` | **time-series** collection (timeField `ts`, metaField `meta`, seconds, 7-day TTL) of live hardware watts/progress | time-series options | automatic bucketing |
| `grid_days` | cached ERCOT day-ahead price days (24 hourly prices) + hourly carbon shape | `$jsonSchema` (24 prices) | unique `hub+date` |
| `evidence` | metadata of every external evidence fetch (FEMA, WRI Aqueduct, OSM, PVWatts…) | `$jsonSchema` | unique `key`, `source+retrieved_at` |
| `meta` | which embedding model the stored vectors use | — | — |

Validation level is `moderate` so older documents are not rejected on update; new writes must conform.

## Embeddings

Documents are embedded with Gemini `gemini-embedding-001` (768-d, cosine). The free tier throttles batches
(HTTP 429); the embedder paces 8 at a time with backoff. If Gemini is unavailable, it falls back to a local
signed-hash n-gram embedding and records that in `meta` — queries then use the same fallback so the index
stays consistent, and the UI labels results "lexical fallback". Re-run `POST /atlas/seed?sites=true&projects=true`
once quota resets to replace them with Gemini vectors.

## Endpoints (`/atlas/*`)

| Endpoint | Atlas feature |
|---|---|
| `GET /atlas/status` | collections, counts, indexes, validators, time-series, search-index build status |
| `POST /atlas/setup` · `POST /atlas/seed` | idempotent create/upgrade and data load |
| `GET /atlas/search?q=&market=&status=` | **Atlas Search**: fuzzy `compound` query + `$searchMeta` facets |
| `GET /atlas/similar?q=` | **Vector Search**: embed the question, `$vectorSearch` with market/status filters |
| `GET /atlas/projects/{id}/similar` | `$vectorSearch` over project embeddings |
| `GET /atlas/near?lat&lon&km` | `$geoNear` on the 2dsphere index, real distances |
| `GET /atlas/analytics` | `$facet` / `$bucket` / `$group` pipelines over sites, projects, grid days, telemetry, evidence |
| `GET /atlas/decisions` | audit trail |
| `GET /atlas/stream` | **change stream** over projects/decisions/sites as Server-Sent Events |

The judge-facing page `/studio/data` shows all of it live.

## Writes from the app

- `store.save` (every Studio save) → upsert project, push `history`, append a `decisions` event, refresh the embedding.
- `livegrid.record` (every hardware telemetry POST) → one time-series point, written off-thread.

## MongoDB MCP server for Claude Code

Registered locally (not committed) as `mongodb` with `MDB_MCP_READ_ONLY=true`, using `npx -y mongodb-mcp-server`.
Claude Code can then run `find`, `aggregate`, `count`, `list-collections`, `collection-schema` and friends
against the cluster in a new session. To re-register: `claude mcp add --scope local mongodb -e MDB_MCP_CONNECTION_STRING=<uri> -e MDB_MCP_READ_ONLY=true -- npx -y mongodb-mcp-server`.

## Triggers — real Atlas Triggers, created from code

`services/api/scripts/atlas_triggers.py` creates (idempotently, through the App Services admin API) an app
`plotstar-triggers` linked to the cluster with three enabled triggers, each running a function **inside Atlas**:

| Trigger | Type | Fires on | Function writes |
|---|---|---|---|
| `decisions_insert` | DATABASE | `plotstar.decisions` insert | a `notifications` document (`source: atlas-trigger`) |
| `projects_change` | DATABASE | `studio_projects` insert/update/replace/delete | `portfolio_snapshot` (totals via `$group`) |
| `grid_minutes_rollup` | SCHEDULED, every minute | cron | one-minute windows per machine over `grid_telemetry` → `grid_minutes` (`$dateTrunc` + `$group`) |

Verified: a project save produced an Atlas-written notification within seconds and refreshed the snapshot.
The script records the trigger names in `meta.atlas_triggers`; the API's in-app worker (`app/triggers.py`)
reads that and only runs the rules Atlas does not own. One rule can never be an Atlas Trigger: MongoDB does
not support change streams on time-series collections, so the **high-watts alert (> 900 W) runs at ingest**
in `atlas.telemetry_point`. `GET /atlas/triggers` shows which rule runs where; `/atlas/notifications`,
`/atlas/alerts`, `/atlas/grid_minutes`, `/atlas/portfolio_snapshot` expose what they wrote.

## Charts

Atlas Charts has no API for creating dashboards, so the Data page draws the charts itself from the same
aggregations (`GET /atlas/charts`): hardware watts over time (two series), the latest ERCOT day-ahead day,
why sites fail, and project cost-to-build vs NPV by cooling — each with hover and a table view. To add the
same views in Atlas Charts: Data Visualization → dashboard on `plotstar` → `grid_minutes` avg_watts by minute
(line, series `machine`), `sites` unwind `gates` filter `status: Fail` count by `gates.gate` (bar),
`studio_projects` `summary.capex` × `summary.npv` colour `brief.cooling` (scatter).

## Stream Processing

The minute-window rollup is the Stream Processing pattern (`$tumblingWindow` over `grid_telemetry`) and runs
as the scheduled Atlas Trigger above. A dedicated Stream Processing Instance (paid tier; processors are created
with `sp.createStreamProcessor` in mongosh, not REST) would replace it with true sub-second windows — the
pipeline would be `$source: grid_telemetry` → `$tumblingWindow {interval: 1 minute, pipeline: [$group avg/max]}`
→ `$merge: grid_minutes`.

## Not built, and why

- **Data Federation** needs an S3/Azure/GCS bucket as the federated source; AWS is out of scope for this build,
  and the CoStar kit is licensed and stays off cloud storage.
- **Agent Engine / AI Model APIs** are console preview features with no admin API I could verify; nothing is
  claimed for them.
- **Search & Vector Search** are already created from code (three indexes, the free-tier maximum).
