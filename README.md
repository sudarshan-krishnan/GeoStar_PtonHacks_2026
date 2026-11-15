# PlotStar 

**Find it. Design it. Protect it.** A complete local hackathon application connecting development-specific site intelligence, editable conceptual architecture, and HAVEN sensor monitoring through one persisted project.

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
[HAVEN integration and reuse notes](docs/haven-integration.md).

### Original workspace

1. On the landing page, select **Start building** and describe a project, or select **Explore the demo**.
2. Discover shows four illustrative candidate sites around Princeton. The ranking uses distinct criteria for residential, data center, park, and commercial developments. Change scoring priorities and apply them. Select map markers or candidate cards and compare costs, operating yields, risks and assumed neighborhood context.
3. **Edit brief** exposes capacity, location, budget, rent/revenue, occupancy, expense ratio, floors, parking and setbacks. All calculations use saved assumptions. The land-price slider is an explicitly temporary scenario.
4. Optionally use **Look up live OSM amenities**. This retrieves community-mapped schools, dining and transit amenities within 1.2 km. It displays source, timestamp, mapped points and a clear fallback if the external service is unavailable. Results never silently replace illustrative ranking inputs.
5. **Select this site → Generate concepts** creates balanced, capacity-focused, and capital-efficient/green alternatives. The efficient option responds to the budget. Change dimensions, floors, green space, parking, assumed setbacks or orientation. Orbit/pan/zoom the actual WebGL model or use the interactive 2D site plan. Geometry and costs update together. Save changes.
6. **Approve & plan protection** persists the approved concept and generates sensors on each floor. Site fit warnings block approval. Approval is conceptual; no regulatory or engineering compliance is implied.
7. In Protect, inspect the twin, change floors, select a sensor, edit coordinates, assign a zone/device ID, add or remove sensors. Rings show illustrative coverage only. Smoke/fire, water, temperature and electrical monitoring are supported.
8. Trigger **Water leak**, **Overheating**, or **Fire alarm**. The threshold engine changes sensor values and zone colors, creates a deduplicated incident, and provides Guardian/maintenance recommendations. Acknowledge and resolve incidents. **Reset simulation** resets simulated readings and resolves simulated incidents while retaining hardware readings/incidents. Simulation history persists.
9. Ask PlotStar about site comparisons, a 20% land-price increase, two additional floors, design returns, development risks, or water sensor placement. The conversation persists with the project.
10. Open **Project report → Export PDF** for a downloadable, paginated report including site comparison, financial scenarios, concept, sensor plan, incidents, assumptions, sources and outstanding approvals. Reload and reopen the project to confirm persistence.

Three seeded demonstrations: `demo-1` student dormitory, `demo-2` 100 MW data center, and `demo-3` community park. Dashboard projects can also be compared side by side. Newly created projects are independent of seeded examples.

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

```text
src/app/                   Next.js pages and API routes
src/components/            Landing, dashboard, Discover, Design, Protect, report, map, 2D/3D
src/components/ui/         shadcn-style reusable Button with Radix Slot and CVA
src/lib/engine.ts          Validated brief, ranking, geometry, financial and assistant calculations
src/lib/monitoring.ts      Sensor plan, threshold processing, incident response and reset
src/lib/llm.ts             Optional schema-validated language interpretation
src/lib/report.ts          Shared HTML/PDF report content
prisma/schema.prisma      Project, Sensor, Incident, Simulation, Message and amenity cache
prisma/seed.ts             Idempotent demonstrations
hardware/                 ESP32 example firmware
tests/                    Calculation, API, SSE, hardware, browser and mobile tests
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
(day-ahead prices, Sourced; carbon from the fuel mix, Estimated). It shows **PlotStar pick vs cost-first pick**
with CO2, cost and MW-at-grid-peak deltas, and re-runs in about a second when you move the price or carbon slider.
"Why this pick?" explains the decision from the run's own numbers (a LangChain deep agent when a model key is set).

**Prove it.** Two machines run the same job, cost-first and PlotStar. The grid day replays in 60 s; press
**Grid emergency** and the PlotStar machine eases off while the cost-first one does not. The Grid Passport records
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
.venv\Scripts\python -m app.costar.loader      # builds data/cache/plotstar.db (~3 s)
.venv\Scripts\python -m pytest -q
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000   # http://localhost:8000/docs
```

Endpoints: `POST /search` (polygon + filters), `POST /sites/evaluate` (any point), `POST /impact` (MW + cooling ->
energy / water / carbon / capex), `GET /assumptions`, `/searches` (saved searches + alerts), `GET /sites`, `GET /sites/{id}`,
`GET /audit/parcel/{id}/{field}` (evidence chain), `GET /data/summary`, `GET /matterport/models/{id}`
(server-side proxy; the token never reaches the browser), `GET /vexcel/ortho/{id}.jpg` and `GET /vexcel/3d/root`
(Vexcel key stays server-side; 3D Tiles are pruned to the cells around the site). Kit findings and schema:
[docs/costar_data_dictionary.md](docs/costar_data_dictionary.md).

Every number carries a label: Measured, Sourced, Estimated, Simulated or Utility-confirmed. Missing data is
Unknown, never guessed. The CoStar kit, `.env` and SQLite caches are gitignored.
