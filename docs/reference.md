# GeoStar technical reference

Detailed notes moved here from the old README: local setup, the `/projects` workspace walkthrough, data sources and limits, hardware ingest, the calculations, the data API and the SiteStar bridge. `/dashboard-2` now redirects to `/studio`, where its Model, Protect and Deploy steps live.

## Start locally (Windows PowerShell)

Requires Node.js 22.12+ or 24 LTS and npm. Tested here with Node 24.

```powershell
cd C:\Users\ksuda\Documents\Pton_Hacks
npm.cmd install
Copy-Item .env.example .env
npm.cmd run setup
npm.cmd run dev
```

Open http://127.0.0.1:3000. If `.env` already exists, preserve it rather than copying the example again. `setup` creates the SQLite file if absent, generates Prisma, synchronizes the schema, and idempotently seeds three demonstrations. It does not overwrite saved demonstrations.

Run `setup` before the first build. If changing the Prisma schema on Windows, stop the app before regenerating the client: a running process can lock its native query-engine DLL. Regular `build` deliberately uses the client generated during setup so it also works while the development preview is running.

For a production build:

```powershell
npm.cmd run build
npm.cmd run start
```

`dev` and `start` bind to loopback intentionally. This is a local single-user studio, with no multi-user authentication or cloud deployment. Keep it local until adding authentication, authorization, TLS, managed persistence/backups, shared rate limiting and appropriate data feeds. It is a working planning prototype, not a production property or safety service.

## A judge's walkthrough

### Dashboard 2

Open **Dashboard 2** from `/projects` or `/explore`, or visit `/dashboard-2`. This separate AFTERLIGHT
Locate remains a standalone **UI prototype**: **Describe → Pick → Finalize**, using hardcoded sample
locations, scores and map artwork. Complete Locate, then open **Design → Use this model** to explore
the reused HAVEN six-level sample digital twin. Orbit, zoom, reset the camera or inspect a level.

**Protect → Select → Place → Deploy** configures electricity/water limits, leak/fire detection,
monitoring points and a predefined evacuation plan. **Confirm Deploy** opens the HAVEN command
center. Trigger deterministic leak, fire or usage demos; acknowledge incidents, reset simulation,
and complete recovery. **Edit protections** returns to configuration. Settings, deployment, incidents
and activity persist in the existing SQLite database, separately for each site/type/city.

Everything in this command center is explicitly **simulation mode**. Hardware and external HAVEN
uAgents are not connected. Routes are defined demo scenarios, use stairs, and are not real-world
safety verification. The model is representative, not a generated parcel design; monitoring points
cover Level 4 only. Locate still resets on refresh: choose the same site/type/city and reopen Protect
to resume its saved plan. The original workspaces remain available. See
[HAVEN integration and reuse notes](haven-integration.md).

### Original workspace

1. On the landing page, select **Start building** and describe a project, or select **Explore the demo**.
2. Discover shows four illustrative candidate sites around Princeton. The ranking uses distinct criteria for residential, data center, park, and commercial developments. Change scoring priorities and apply them. Select map markers or candidate cards and compare costs, operating yields, risks and assumed neighborhood context.
3. **Edit brief** exposes capacity, location, budget, rent/revenue, occupancy, expense ratio, floors, parking and setbacks. All calculations use saved assumptions. The land-price slider is an explicitly temporary scenario.
4. Optionally use **Look up live OSM amenities**. This retrieves community-mapped schools, dining and transit amenities within 1.2 km. It displays source, timestamp, mapped points and a clear fallback if the external service is unavailable. Results never silently replace illustrative ranking inputs.
5. **Select this site → Generate concepts** creates balanced, capacity-focused, and capital-efficient/green alternatives. The efficient option responds to the budget. Change dimensions, floors, green space, parking, assumed setbacks or orientation. Orbit/pan/zoom the actual WebGL model or use the interactive 2D site plan. Geometry and costs update together. Save changes.
6. **Approve & plan protection** persists the approved concept and generates sensors on each floor. Site fit warnings block approval. Approval is conceptual; no regulatory or engineering compliance is implied.
7. In Protect, inspect the twin, change floors, select a sensor, edit coordinates, assign a zone/device ID, add or remove sensors. Rings show illustrative coverage only. Smoke/fire, water, temperature and electrical monitoring are supported.
8. Trigger **Water leak**, **Overheating**, or **Fire alarm**. The threshold engine changes sensor values and zone colors, creates a deduplicated incident, and provides Guardian/maintenance recommendations. Acknowledge and resolve incidents. **Reset simulation** resets simulated readings and resolves simulated incidents while retaining hardware readings/incidents. Simulation history persists.
9. Ask GeoStar about site comparisons, a 20% land-price increase, two additional floors, design returns, development risks, or water sensor placement. The conversation persists with the project.
10. Open **Project report → Export PDF** for a downloadable, paginated report including site comparison, financial scenarios, concept, sensor plan, incidents, assumptions, sources and outstanding approvals. Reload and reopen the project to confirm persistence.

Three seeded demonstrations: `demo-1` student dormitory, `demo-2` 100 MW data center, and `demo-3` community park. Dashboard projects can also be compared side by side. Newly created projects are independent of seeded examples.

## Phone app (iPhone)

`mobile/` is a native SwiftUI app for HAVEN incident response: site list, new-incident alerts, plan approval, acknowledgement, exit routes and team progress. It reaches this laptop through `npm run mobile:gateway`, which exposes only the token-checked `/api/mobile/*` routes while the web app stays on 127.0.0.1. See [mobile/README.md](../mobile/README.md).

## Data honesty and external dependencies

| Feature                                | Implementation / limitation                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidate sites                        | Four **illustrative** candidates in the Princeton/West Windsor/Plainsboro demonstration region. Names are concepts, not verified properties. No listing availability, title or asking price is verified.                                                                                               |
| Other locations                        | The requested location is retained and an outside-demo-coverage warning appears. Candidates are still the Princeton demonstration; worldwide parcel discovery is not claimed.                                                                                                                          |
| Prices, demographics, risks and scores | Explicit demo assumptions. No verified utility capacity, market rents, FEMA flood layer, cadastral boundaries or population feed.                                                                                                                                                                      |
| Basemap                                | Real OpenStreetMap raster tiles through MapLibre. Visible attribution; standard browser caching; no prefetch/bulk downloads. Requires network access. Replacement tiles can be configured with `NEXT_PUBLIC_MAP_TILE_URL` (rebuild after changing).                                                    |
| Live amenities                         | On-demand Overpass / OpenStreetMap query; 24-hour server cache; request timeout and clearly labeled fallback. Community data may be incomplete. No credentials required.                                                                                                                               |
| Design                                 | Actual Three.js/React Three Fiber geometry, editable dimensions, pan/orbit/zoom and SVG site plan. Generic massing and conceptual zones, not detailed interior plans or permit drawings. WebGL unavailable → useful 2D fallback.                                                                       |
| HAVEN agents                           | Deterministic event pipeline and response rules, not autonomous human-equivalent agents. No physical equipment control.                                                                                                                                                                                |
| Telemetry                              | Authenticated HTTP ingestion plus SSE updates. Starts in simulation mode. Hardware is marked live only after an accepted reading received within 30 seconds.                                                                                                                                           |
| AI without credentials                 | Keyword/number brief interpretation plus useful deterministic project answers and scenarios. Always works without a key.                                                                                                                                                                               |
| Optional AI                            | OpenAI Responses API for schema-validated brief interpretation and contextual explanations. Server-side key, `store:false`, timeout and deterministic fallback. Full deterministic reference is retained alongside explanations. A configured call sends the brief/question/project context to OpenAI. |
| PDF                                    | Direct download generated server-side with `pdf-lib`, embedded standard fonts, pagination and conceptual footprint. No printer dialog or third-party conversion service required.                                                                                                                      |

Useful source references: [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [OpenStreetMap attribution](https://www.openstreetmap.org/copyright), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API), [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction), [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).

## Configuration

Copy `.env.example` to `.env`. `.env` is ignored by Git.

```dotenv
DATABASE_URL="file:./plotstar.db"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-4.1-mini"
TELEMETRY_API_KEY=""
OVERPASS_URL="https://overpass-api.de/api/interpreter"
NEXT_PUBLIC_MAP_TILE_URL="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
```

`DATABASE_URL` is relative to the Prisma schema directory: default persisted file `prisma/plotstar.db`. Back up this file with the application stopped. Project data, geometry, sensors, incidents, simulations and assistant history are stored in SQLite, not browser localStorage. Internet access is optional for the core demo; map tiles, live amenity lookups and optional LLM calls need it. No keys ship with this repository.

## Hardware integration

`POST /api/telemetry` accepts:

```json
{
  "projectId": "your-project-id",
  "sensorId": "your-saved-sensor-id",
  "deviceId": "esp32-lab-01",
  "value": 24.5
}
```

Headers: `Content-Type: application/json`, `Authorization: Bearer <TELEMETRY_API_KEY>`.

1. Generate your own long random secret and set `TELEMETRY_API_KEY` in `.env`; restart the server. Ingestion is disabled with HTTP 503 when no key is configured.
2. Approve a concept. In Protect, select a temperature or water sensor. Its stable ID is displayed. Bind **device ID** to `esp32-lab-01` and save.
3. Configure `hardware/plotstar_esp32.ino` with WiFi, server, project and sensor IDs. It supports a DS18B20 temperature sensor and calibrated analog moisture input. See firmware header for libraries and GPIO connections.
4. A physical ESP32 cannot use the PC's loopback address. In a trusted lab, explicitly expose the app with `npx.cmd next dev --hostname 0.0.0.0 --port 3000` and use the PC's LAN IP in the firmware. Configure any needed firewall access yourself. This exposes the local studio to the LAN; only use it on a trusted isolated demo network. Use HTTPS with a valid CA and proper application authentication for any wider use. The example does not disable TLS verification.
5. Accepted readings update the bound sensor, source, device identification and server receipt timestamp. Threshold crossings enter the same Guardian incident pipeline and appear in Protect via SSE. Readings must be temperature -50 to 150 °C, water/electrical 0 to 100%, or fire 0/1. Up to 120 readings/device/minute; keep a five-second interval in the example firmware.

The example firmware is supplied for an ESP32 lab demonstration. It has not been flashed onto physical hardware during this build. No physical sensor connection is claimed. Sensor location, detection radius and emergency guidance are conceptual; qualified professionals must validate real installations.

## Calculations

- Each type has its own weighted criteria in `src/lib/engine.ts`; weights are normalized, not interpreted as probabilities.
- Footprint = width × depth. GFA = footprint × floors; 3.5 m floor height.
- Residential capacity = floor(GFA / 34 m²). Data center capacity = floor(GFA / 230 m²), an area model with **no confirmed power entitlement**. Commercial capacity converts m² to sq ft. Park service capacity = floor(green area / 18 m²).
- Hard costs: residential $2,650/m², commercial $2,100/m², data center shell $2,800/m² plus $5.5m per modeled whole MW for equipment, park pavilion $1,800/m² plus green-space establishment at $55/m². Parking: $7,000/space. Soft cost / contingency: 22% of hard costs. These are illustrative modeling constants, not quotes.
- Total investment = land + development. Gross revenue = min(target capacity, concept capacity) × monthly rate × 12 × occupancy. Expenses = gross revenue × expense ratio. NOI = gross revenue − expenses. Unlevered operating yield = NOI / investment. Simple payback = investment / NOI for positive NOI.
- Parks have no rental revenue; annual upkeep = green area × $7 + pavilion GFA × $35. Compare public access, green area, community service and maintenance budgets.
- Revenue is capacity-capped, so adding floors beyond the program can reduce yield. Financing, tax, appreciation and exit proceeds are excluded. Operating yield is not IRR.
- Fit checks reserve the footprint, landscape allocation, 30 m² per parking space and 10% site area for access, and check the assumed setback envelope including 90° rotation. No legal zoning inference.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

The browser suite launches its own production server on **3100** and uses a separate `prisma/plotstar-test.db`. It creates test-only projects and a fresh in-memory telemetry secret. It never edits the normal demo database. Build first after changing source. Do not run two copies of this suite on the same port. The test database may retain previous test projects; subsequent runs create independent projects.

Tests cover distinct scoring, brief parsing, dimensions and bounds, cost arithmetic, budget-sensitive alternatives, hardware validation/authentication/device binding, SSE delivery, project persistence, sensor CRUD, incident deduplication and acknowledgement/resolution, simulation reset isolation, assistant scenarios, PDF parsing, browser end-to-end and mobile overflow. Browser tests use software WebGL to exercise the real 3D renderer. Visual QA outputs are written to `output/qa/` and three generated report samples to `output/pdf/`.

## Project layout

Every sponsor has its own folder on both sides; see **[docs/sponsors/](sponsors/README.md)** for the map.

```text
services/api/app/                FastAPI backend (Python)
  main.py, config.py, db.py        app wiring and settings
  routers/                         GeoStar's own endpoints: studio, screening, projects, design import, optimizer, live grid
  engine/                          GeoStar's deterministic engines: layout, screening, public data, ERCOT grid, optimizer
  sponsors/costar/                 CoStar extract, intelligence tools, the CoStar MCP server, deal room, CoStar routes
  sponsors/matterport/             site walk: notes pinned in 3D and measurements inside Matterport scans
  sponsors/vexcel/                 aerial imagery and 3D city meshes
  sponsors/langchain/              Deep Agents orchestrator + specialists (deep_agents/), copilot, research and deal agents
  sponsors/mongodb/                Atlas: schema, search, vectors, geo, change streams, triggers, project store
  sponsors/gemini/                 embeddings and concept summaries
  sponsors/elevenlabs/             voice guide and text-to-speech
  sponsors/amazon/                 Bedrock (optional model provider)
services/api/tests/              backend tests (pytest)
src/app/                         Next.js pages and API routes (/, /studio, /studio/agent, /studio/data, /explore, /dashboard-2)
src/components/studio/           the Studio: brief, plan, 3D model, import, design
src/components/sponsors/<name>/  sponsor UI: langchain (Agent Intelligence, Ask GeoStar), costar, matterport, vexcel,
                                 mongodb (Data page), elevenlabs (voice guide)
src/components/dashboard-2/      Smart Blocks: locate, design, protect, deploy (HAVEN command center)
src/components/explore/          Live operations (/explore)
src/components/workspace/        the original /projects workspace
src/components/landing/, ui/     landing page; shared UI and charts
src/lib/                         engine, monitoring, report, HAVEN store, API client
prisma/                          local SQLite schema and seed
bridge/, web/                    Tello drone and live grid bridge; SiteStar website
twin/, protect/, hardware/       digital twin, PROTECT building module, ESP32 firmware
mobile/                          iPhone app
docs/sponsors/, docs/planning/   per-sponsor notes; product planning documents
tests/                           frontend unit and browser tests
```

Local mutation routes enforce same-origin browser requests and Zod input bounds; telemetry uses a constant-time bearer-token comparison and explicit device bindings. These measures do not replace multi-user identity and access control. `npm audit` is clean at verification time; the pinned Prisma 6 toolchain uses a patched `deepmerge-ts` override, checked through schema setup and builds.

## The product: one screen, two questions (`/explore`)

**Where should it go?** Every real CoStar property in Houston (or Los Angeles) is scored three ways, Money, People,
Planet, and checked against pass/fail gates: homes nearby (CoStar apartment communities + MLS listings), FEMA flood
zone, WRI Aqueduct water stress, distance to a >= 138 kV substation (OpenStreetMap). A site that fails a gate is
"Not suitable" whatever it costs. Draw an area, check any spot, filter by MW and must-haves, save a search and get
alerts when a site, price or risk changes.

**How should it run?** One optimizer picks the site, the cooling and the hourly schedule together (`POST /optimize`):
it enumerates site x cooling x flexibility, drops anything that fails a gate or needs more curtailment than the
flexible share allows, and places the day's flexible work into the cleanest, cheapest hours of the real ERCOT day
(day-ahead prices, Sourced; carbon from the fuel mix, Estimated). It shows **GeoStar pick vs cost-first pick**
with CO2, cost and MW-at-grid-peak deltas, and re-runs in about a second when you move the price or carbon slider.
"Why this pick?" explains the decision from the run's own numbers (a LangChain deep agent when a model key is set).

**Prove it.** Two machines run the same job, cost-first and GeoStar. The grid day replays in 60 s; press
**Grid emergency** and the GeoStar machine eases off while the cost-first one does not. The Grid Passport records
response time, measured reduction, duration and whether the job finished. Without hardware the screen shows a
simulation, labeled as such.

Run the real machines with `services/controller/run.py` (standard library only):

```powershell
# in .env: TELEMETRY_API_KEY=<long random secret>  (restart the API)
python services/controller/run.py --machine baseline --token <key>
python services/controller/run.py --machine plotstar --token <key> --meter-cmd "<command printing watts>"
```

Every number carries a label: Measured, Sourced, Estimated or Simulated. Grid capacity and interconnection cost are
scenarios until a utility confirms them. The older multi-use workspace (`/projects`: dorms, parks) is still in the
repo but is no longer the product path.

## Real property data: CoStar backend (`services/api`)

The CoStar track kit (Houston + Los Angeles) is served by a Python FastAPI service next to the web app.
It replaces illustrative candidates with real CoStar properties; every value traces to its source file and line.

```powershell
# one-time: extract the CoStar kit OUTSIDE the repo and set COSTAR_KIT_DIR in .env
cd services/api
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m app.sponsors.costar.loader      # builds data/cache/plotstar.db (~3 s)
.venv\Scripts\python -m pytest -q
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000   # http://localhost:8000/docs
```

Endpoints: `POST /search` (polygon + filters), `POST /sites/evaluate` (any point), `POST /impact` (MW + cooling ->
energy / water / carbon / capex), `GET /assumptions`, `/searches` (saved searches + alerts), `GET /sites`, `GET /sites/{id}`,
`GET /audit/parcel/{id}/{field}` (evidence chain), `GET /data/summary`, `GET /matterport/models/{id}`
(server-side proxy; the token never reaches the browser), `GET /vexcel/ortho/{id}.jpg` and `GET /vexcel/3d/root`
(Vexcel key stays server-side; 3D Tiles are pruned to the cells around the site). Kit findings and schema:
[docs/sponsors/costar-data-dictionary.md](sponsors/costar-data-dictionary.md).

Every number carries a label: Measured, Sourced, Estimated, Simulated or Utility-confirmed. Missing data is
Unknown, never guessed. The CoStar kit, `.env` and SQLite caches are gitignored.

---

## SiteStar website and live bridge (`web/`, `bridge/`)

_Merged from the `website-live-feeds` branch. The bridge runs on port 8010 (8000 is the GeoStar API); start it with `--drone` to fly the Tello._

SiteStar finds the existing Houston buildings that can become AI data centers soonest. It inspects each one across CoStar's records, 3D scans and aerial photos, and proves on real hardware the grid flexibility that gets it powered.

Built at HackPrinceton Fall 2026.

### Why

- **Power is the bottleneck.** ERCOT is tracking more than 438 GW of large-load requests, nearly 89% of them data centers ([ERCOT, June 2026](https://www.ercot.com/files/docs/2026/06/18/ERCOT-Trending-Topic-New-Batch-Connection-Process-for-Large-Electricity-Users.pdf)). New campuses wait years.
- **The fastest AI sites are conversions.** Prologis turned a warehouse into a 32 MW data center with Skybox; Lambda is converting a Kansas City building into a 24 MW AI factory.
- **Picking the building takes a site visit today.** It needs the records, the inside, the outside and the power picture together.

### What it does

1. **Find.** Fixed rules cut CoStar's 121 Houston industrial, flex and land buildings to **8 finalists**:
   - 121 → **38** outside FEMA's 100-year floodplain and at least 500 m from homes
   - → **14** with a clear height of 24 ft or more
   - → **8** that also have heavy electrical service on site
2. **Inspect.** An agent (Claude) works through each building with tools:
   - CoStar's record
   - the public Matterport 3D scan (it reads the images)
   - an aerial photo (it reads this image too)
   - the flood map and the high-voltage grid
   - the power gap and the pause budget

   It writes a passport. The rules decide pass or fail; the agent explains what it sees and flags what to verify on site.
3. **Power.** The building's own service is a fraction of what AI racks draw, so it needs grid power, and utilities can connect load sooner when it pauses during the tightest hours. From ERCOT's 2025 hourly load:
   - **110 pause hours a year (1.3%) on 37 days**, catching all four summer peaks that set Texas transmission charges (June 19, July 30, August 18 and September 4, 4–6 PM).
   - **About $64 per kW-year** in transmission charges avoided (estimated).
4. **Prove.** Two machines run the same job. On a grid event (website or ESP32 button), the SiteStar machine pauses its flexible work, its measured power falls, and the job still finishes. The Grid Passport record attaches to the building's passport.

The top finalist is a 1.23M sq ft warehouse built in 2022: 40 ft clear height, 3,000 A service, 470 m from a 345 kV line, listed for lease. Its gap is about 2.5 MVA of service today against a 30 MW first phase.

### How it decides

| Check | Rule | Data | Label |
|---|---|---|---|
| Flood | Fail in FEMA zones A or V | FEMA National Flood Hazard Layer (point query) | Sourced |
| Homes | Fail within 500 m of a mapped residential area | OpenStreetMap residential outlines (~110 m cells) | Estimated |
| Shell | Clear height of at least 24 ft | CoStar | Sourced |
| Power | Heavy electrical service (800 A or more) | CoStar | Sourced |
| Also shown | Slab, column spacing, sprinklers, docks, service size, 345 kV and substation distance, listing, 3D scan | CoStar, OpenStreetMap | Sourced or Estimated |

**Agent.** Claude Opus 5.5 (`claude-opus-5-5`, effort medium) runs a tool-use loop over SiteStar's own data (`bridge/agent.py`):
- Tool results carry the aerial photo and the scan snapshots as images.
- Numbers must come from tools.
- The final `submit_passport` call has a strict schema.
- Server-side refusal fallback is on (`fallbacks: "default"`).
- Each run is saved to `bridge/.cache/agent/` and can be replayed if the network fails.
- Without credentials, the page runs the same inspection with rules only and says so.

**Every number is labeled** Measured, Sourced, Estimated, Simulated or Utility-confirmed (none yet). Click any underlined number for its source and formula.

### Run it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r bridge/requirements.txt

# data (once): CoStar kit unzipped into Data/costar-kit
python bridge/costar_sites.py --media    # screen 121 buildings; cache scans and aerials for the finalists (~1 min)
python bridge/pause_budget.py            # ERCOT 2025 hourly load -> web/data/pause-budget.json (committed)

python bridge/server.py --mock-grid      # open http://localhost:8000
```

- **Claude agent.** Put `ANTHROPIC_API_KEY=...` in `bridge/.env` (gitignored) and restart the bridge.
  - Before a demo, warm the replay cache with `python bridge/agent.py --all`.
  - Another model: `SITESTAR_MODEL=...`.
- **Real machine.** Run `sudo -v`, then `python bridge/controller.py --machine optimized`.
  - It runs a numpy job on every core and reports chip power from `powermetrics` once a second.
  - On a second laptop: `python bridge/controller.py --machine baseline --bridge http://<demo-laptop-ip>:8000`, with the bridge started using `--host 0.0.0.0`.
  - With one laptop, the flat machine stays simulated and labeled as such.
- **ESP32 button.** `POST /api/grid/emergency` with `{"active": true, "source": "esp32"}`.
- **Drone.** `python bridge/server.py --tello-ip 172.20.10.14 --mock-grid` (the drone on your hotspot; see `bridge/tello_wifi.py`). The Inspect section's Drone tab shows its live feed, and captured frames go on the building's passport.
- **No hardware at all:** `python bridge/server.py --mock` (simulated drone and machines, labeled).

Presenter keys: **1–5** jump between sections, **0** to the top. `?site=<CoStar id>` opens a finalist; `&inspect=1` starts its inspection.

### Status

| Part | Status |
|---|---|
| Funnel, map, finalists, readiness checklist | Working, on CoStar's data (local only) |
| Inspection, rules-only | Working; includes a live FEMA check |
| Inspection, Claude agent | Built and tested with a scripted client; **not yet run against the live API** (no key on the build laptop) |
| 3D scans and aerial photos | Working: Esri World Imagery for all 8 finalists, public Matterport snapshots for the 7 that have a scan; Vexcel and the Matterport SDK need their keys |
| Pause budget (ERCOT 2025) | Working |
| Grid event, Grid Passport, passport attachment | Working |
| Real power measurement | Controller tested with a test meter; `powermetrics` needs `sudo -v` at demo time |
| Printable passport (`passport.html`) | Working |
| Drone | Working: the Inspect tab's on-site check shows the live Tello feed under a HUD, with take off, land and frame capture; frames land on the passport. Start the bridge with `--drone` (or `--tello-ip`) |

### What we don't claim

- Distance to a substation is not capacity. Only CenterPoint's study says what it can deliver, and when.
- Slab thickness is recorded for 9 of 121 buildings, and service size for 24. Both need a site visit.
- Pause hours are picked after the fact from 2025 data. Operators act on day-ahead peak alerts.
- The transmission rate is CenterPoint's listed Primary-service TCRF; the listing shows no date, so check the current tariff.
- Laptop watts show how a workload responds to a grid signal. They don't prove a multi-megawatt interconnection.

### Data handling

CoStar's data stays on the demo laptop. The kit (`/Data/`), the screened buildings (`web/data/costar-sites.json`) and the cached scans and aerials (`web/data/media/`) are gitignored. So are API keys (`bridge/.env`) and agent runs (`bridge/.cache/`).

### Bridge endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/agent/status` | Is the Claude agent available, which runs are saved |
| `GET /api/agent/inspect/<id>?mode=live\|replay&pod=&flex=` | The inspection as Server-Sent Events |
| `GET /api/grid` | Machines, grid event, Grid Passport records |
| `POST /api/grid/telemetry` | `{"machine": "baseline"\|"optimized", "watts": 31.2, "progress": 0.4, "done": false, "measure": "chip"\|"wall"\|"system"}` |
| `POST /api/grid/emergency` | `{"active": true, "source": "web"\|"esp32"}` |
