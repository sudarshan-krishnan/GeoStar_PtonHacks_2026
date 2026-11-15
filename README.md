<div align="center">

# GeoStar

### Find it. Design it. Protect it.

**Site intelligence for the things we are building fastest: data centers, energy, housing.**
GeoStar finds the right place to build, designs what goes on it, and watches over it once people move in.

Built at HackPrinceton Fall 2026

![GeoStar landing page](docs/screenshots/landing-hero.png)

</div>

---

## Inspiration

The country is building faster than towns are saying yes.

- **64 GW** of US data center capacity is expected by the end of 2026 (Goldman Sachs, as reported by CoStar News).
- **1,500+** data center projects are in planning nationwide (Pew Research Center).
- **About 400** cities and towns, in **14 states**, are considering moratoriums on new ones.
- ERCOT is tracking more than **438 GW** of large-load requests, nearly 89% of them data centers.

A project gets blocked when it lands in the wrong place: too close to homes, in a floodplain, on a stressed aquifer, or years from a grid connection. And once a building is up, the damage that costs the most starts quietly: a pinhole leak inside a wall, a loose connection heating up behind drywall.

Today those are three separate jobs with three separate tools. We wanted one product that follows a building through its whole life.

![Why now](docs/screenshots/landing-why.png)

## What it does

GeoStar does three things, in the order a building lives them.

![The three acts](docs/screenshots/landing-three-acts.png)

### 1. Find the right place

The best site depends on what you are building. A data center lives or dies on power and water. A family home lives on schools, parks and the walk to the river. GeoStar weighs the factors that matter for your project and shows why a parcel wins.

![Find: weigh the factors, watch the ranking change](docs/screenshots/landing-find.png)

For data centers, GeoStar screens real CoStar properties in Houston and Los Angeles against hard pass/fail gates before any score is shown:

| Gate | Rule | Source |
|---|---|---|
| Flood | Fail in FEMA zones A or V | FEMA National Flood Hazard Layer |
| Homes | Fail too close to a residential area | CoStar apartments, MLS listings, OpenStreetMap |
| Water | WRI Aqueduct water stress | WRI Aqueduct |
| Power | Distance to a 138 kV or larger substation | OpenStreetMap |

A site that fails a gate is "Not suitable" whatever it costs. Every number carries a label: **Measured, Sourced, Estimated, Simulated** or **Utility-confirmed**. Missing data is shown as Unknown, never guessed.

The original workspace does the same for other project types, with real OpenStreetMap tiles and on-demand amenity lookups:

![Workspace: candidate sites on the map, scored for a 100 MW data center](docs/screenshots/workspace-discover.png)

### 2. Design what goes on it

Start in the Studio by saying what you want to build and where.

![Studio: what are you building, and where?](docs/screenshots/studio-define.png)

For a data center, GeoStar's layout engine generates three concepts on the chosen parcel (halls, substation yard, power and cooling routes), lets you compare them, records the decision and exports a DXF for CAD. Other project types open an orbitable 3D concept model:

![Studio: wind farm concept model](docs/screenshots/studio-concept-model.png)

<table>
  <tr>
    <td><img src="docs/screenshots/concept-solar.png" alt="Solar farm concept model"><br><sub><b>Solar farm</b></sub></td>
    <td><img src="docs/screenshots/concept-commercial.png" alt="Commercial concept model"><br><sub><b>Commercial</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/concept-park.png" alt="Community park concept model"><br><sub><b>Community park</b></sub></td>
    <td><img src="docs/screenshots/concept-student-living.png" alt="Student living concept model"><br><sub><b>Student living</b></sub></td>
  </tr>
</table>

In the workspace you shape the massing directly. Width, depth, floors, landscape and parking drive the geometry, the cost and the yield together:

![Workspace: three concepts, editable in 3D](docs/screenshots/workspace-design.png)

The landing page tells this part of the story with a live model: draft it, edit it, finalize it, and take away a CAD drawing, a 3D model and a Gaussian splat to walk through.

![Design: model, edit, finalize](docs/screenshots/landing-design.png)

### 3. Protect it for life

Smoke alarms catch fires. GeoStar catches what causes them. Sensors go where buildings really fail: water risers, electrical panels, corridors.

![Protect: a hidden leak, caught and contained](docs/screenshots/landing-protect.png)

Protection takes two steps. Choose what to watch and set your limits:

![Protect: choose your alerts](docs/screenshots/protect-alerts.png)

Review the plan, place the hub, pick the exit route and deploy:

![Protect: review and deploy](docs/screenshots/protect-place.png)

### HAVEN: the command center

Once deployed, every facility gets a HAVEN command center: a digital twin, live readings against your limits, and a team of agents that explain what is happening in plain words.

![HAVEN command center, all systems healthy](docs/screenshots/haven-command.png)

Trigger a water leak. HAVEN traces the impact chain (riser, elevator, exit route), proposes a response plan, reroutes the evacuation path and waits for a person to approve before any guidance is shared with staff.

![HAVEN: water leak detected, response plan awaiting approval](docs/screenshots/haven-leak.png)

A fire is a confirmed emergency. The twin shows the affected zone, the blocked exit and the clear one.

![HAVEN: fire hazard detected](docs/screenshots/haven-fire.png)

Every deployed project sits in one view, the ones that need attention first.

![HAVEN: every deployed project in one view](docs/screenshots/haven-deployed.png)

HAVEN speaks to each person differently. An owner gets the cost. A resident gets the way out. An engineer gets the breaker number.

![HAVEN: five agents, three audiences](docs/screenshots/landing-haven.png)

### Agents that show their work

One orchestrator and six specialists, built with the LangChain Deep Agents SDK on LangGraph. The orchestrator writes a plan and delegates to specialists in isolated contexts, in parallel when their work is independent. Models choose what to investigate and explain it. Code produces every number and the score.

![Agent Intelligence](docs/screenshots/agents-top.png)

The page reports its own architecture from the running server: each agent, its model, its tools, and the scoring rule as code.

![Agent architecture, as the server reports it](docs/screenshots/agents-architecture.png)

| Agent | Model | Job |
|---|---|---|
| Orchestrator | `claude-sonnet-5-5` | Plans, delegates, scores, answers |
| Property Intelligence | `claude-haiku-5-5` | CoStar record over MCP: building, land, comps, occupancy |
| Financial Feasibility | `claude-haiku-5-5` | Acquisition, cost to build, operating cost, what-ifs |
| Resource & Infrastructure | `claude-haiku-5-5` | Power, water, flood, the ERCOT grid day |
| Community & Sustainability | `claude-haiku-5-5` | Homes nearby, noise, carbon, water use |
| Design & Simulation | `claude-haiku-5-5` | Layouts, concept comparison, what-ifs |
| Safety & Operations | `claude-haiku-5-5` | The deployed facility's protection state and playbook |

The score has four pillars (Property 20%, Money 30%, Power and resources 25%, People and planet 25%) and eleven criteria. A criterion with no evidence is reported as a gap. Hard gates override the score. Sending a safety alert needs a person's approval.

### One project, start to finish

The workspace keeps the whole journey in one persisted project: discover, design, protect, and a report you can export as a PDF.

![Workspace: all projects](docs/screenshots/workspace-projects.png)

![Workspace: protect, with a sensor plan on the twin](docs/screenshots/workspace-open.png)

![Workspace: investment and planning report](docs/screenshots/workspace-report.png)

### A landing page that tells the story

The landing page is the pitch: an inverted pyramid (the answer first, then the three acts, then the detail), a global action bar that follows you down the page, and a command menu on <kbd>Ctrl</kbd> <kbd>K</kbd>.

![Command menu](docs/screenshots/landing-command-menu.png)

### Also in the repo

- **iPhone app** (`mobile/`): native SwiftUI. HAVEN incident response away from the laptop, and a tab to fly the Tello drone. See [mobile/README.md](mobile/README.md).
- **Drone site survey** (`bridge/`): a Tello flies the site; its live feed and captured frames appear in the Studio's Discover step.
- **Live grid twin** (`hardware/`, `twin/`): a laptop runs a real AI training job and measures its own power while an ESP32 tabletop grid replays a real ERCOT day. Press the grid emergency button and the flexible work pauses. See [hardware/README.md](hardware/README.md).
- **SiteStar** (`web/`): a companion site that screens existing Houston buildings for conversion into AI data centers.

> **Not pictured.** The site map, generated layouts, deal desk, Matterport site walk and MongoDB data page show licensed CoStar records or need an Atlas cluster. CoStar data stays on the demo machine, so those screens are left out of this README.

## How we built it

| Layer | What we used |
|---|---|
| Web app | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| 3D | three.js, React Three Fiber, drei, 3D Tiles renderer |
| Maps | MapLibre GL with OpenStreetMap tiles, Overpass for amenities |
| Data API | Python, FastAPI, SQLite |
| Agents | LangChain Deep Agents SDK, LangGraph, LangSmith, Anthropic Claude, MCP |
| Data | CoStar (properties, comps, listings), FEMA, WRI Aqueduct, OpenStreetMap, ERCOT |
| Imagery and scans | Vexcel aerials and 3D meshes, Matterport scans |
| Storage | Prisma with SQLite locally, MongoDB Atlas (search, vector search, geo, change streams) |
| Voice | ElevenLabs |
| Reports | pdf-lib, generated on the server |
| Hardware | ESP32 firmware, Tello drone bridge |
| Mobile | SwiftUI |
| Tests | Node test runner, Playwright, pytest |

Each sponsor integration has its own folder on both sides of the app. The map is in [docs/sponsors/](docs/sponsors/README.md).

**Two rules shaped the build.**

1. **Models explain, code computes.** Scores, costs and gates come from deterministic functions. Agents decide what to look at and say what it means.
2. **Licensed data stays local.** CoStar names, addresses, prices and coordinates do not go to MongoDB Atlas, to embeddings, or into model prompts and traces by default.

## Challenges we ran into

- **Keeping licensed data on the machine while using cloud models.** Agents work with redacted records and evidence ids; the app fills names back in locally.
- **Making an agent's answer checkable.** Every number has to come from a tool, every tool call is a visible event, and a specialist whose conclusion disagrees with its own evidence is flagged as a conflict.
- **Being honest about what is real.** Much of a hackathon demo is simulated. We labelled every value by where it came from and marked every simulation on screen.
- **One product from three ideas.** Site selection, concept design and building protection started as separate builds. They now share one project, one visual language and one story.

## Accomplishments that we're proud of

- A site that fails a hard gate cannot be rescued by a good price.
- The agent page draws its graph from real runtime events, and reports its own architecture and scoring rule from the server.
- HAVEN proposes, a person approves. Nothing reaches staff until someone says yes.
- The whole Protect flow works with no hardware, and says so; with an ESP32 attached, real readings enter the same incident pipeline.
- A landing page a first-time visitor can play with: move a slider, finalize a building, spring a leak.

## What we learned

- Provenance is a feature. People trust a number more when they can click it.
- Agents are most useful when they are narrow, and when the arithmetic is taken away from them.
- The quiet failures (water, wiring) are a better story than the alarm.

## What's next for GeoStar

- Utility-confirmed capacity and interconnection timelines in place of distance-to-substation.
- More markets than Houston and Los Angeles.
- Real sensor deployments, starting with moisture and panel temperature.
- Layout generation for housing, solar and wind, to match what data centers have today.
- Accounts, roles and hosting. Today GeoStar is a local, single-user studio.

## Run it

Requires Node.js 22.12+ and npm.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run setup
```

```bash
npm run dev
```

Open http://127.0.0.1:3000.

| Route | What it is |
|---|---|
| `/` | Landing page: the story |
| `/studio` | The Studio: define, discover, explore, analyze, deliver, then model, protect and deploy |
| `/studio/agent` | Agent Intelligence: how the AI works |
| `/studio/data` | MongoDB Atlas, live |
| `/explore` | Live operations: where should it go, how should it run |
| `/projects` | The original workspace: discover, design, protect, report |

The landing page, the Studio's concept models, Protect, the HAVEN command center and the `/projects` workspace run with nothing else installed. Real sites, layouts and agents need the data API:

```bash
cd services/api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m app.sponsors.costar.loader
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

On macOS or Linux the virtual environment's programs are in `.venv/bin/`. The loader needs the CoStar kit extracted outside the repo, with `COSTAR_KIT_DIR` set in `.env`. Agents need `ANTHROPIC_API_KEY`. MongoDB, Vexcel, Matterport and ElevenLabs are optional and switch on when their keys are set.

Setup detail, hardware ingest, the calculations and the data API are in the [technical reference](docs/reference.md).

### Tests

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

### Retake the screenshots

With the app running:

```bash
node scripts/readme-shots.mjs http://127.0.0.1:3000
```

## What is real and what is simulated

| Part | Status |
|---|---|
| Site screening | Real CoStar properties and public data (FEMA, WRI Aqueduct, OpenStreetMap). Runs locally with the CoStar kit. |
| Grid prices | Real ERCOT day-ahead prices. Carbon is estimated from the fuel mix. |
| Grid capacity | A scenario until a utility confirms it. Distance to a substation is not capacity. |
| Layouts and concept models | Conceptual. Not engineering or permit drawings. |
| Workspace candidates | Illustrative sites around Princeton, on a real OpenStreetMap basemap. |
| HAVEN incidents | Simulated readings through a deterministic rules engine. No physical equipment is controlled. |
| Exit routes | Predefined demo routes. Not a real-world safety verification. |
| Hardware | ESP32 firmware and a telemetry endpoint are included. A reading is marked live only when one arrives. |
| Landing page numbers | Illustrative, and labelled so on the page. |

GeoStar is a planning prototype. It is not a property listing service, an engineering tool or a life-safety system.

## Repository map

```text
src/app/                         Next.js pages and API routes
src/components/landing/          landing page
src/components/studio/           the Studio: brief, plan, 3D model, import, design
src/components/dashboard-2/      Protect, deploy and the HAVEN command center
src/components/sponsors/<name>/  sponsor UI: langchain, costar, matterport, vexcel, mongodb, elevenlabs
src/components/workspace/        the /projects workspace
src/lib/                         engine, monitoring, report, HAVEN store
services/api/                    FastAPI data service: engines, sponsors, agents
prisma/                          local SQLite schema and seed
mobile/                          iPhone app
bridge/, web/                    Tello drone and grid bridge; SiteStar site
twin/, protect/, hardware/       live grid twin, building protection module, ESP32 firmware
docs/                            sponsor notes, technical reference, screenshots
tests/                           unit and browser tests
```
