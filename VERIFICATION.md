# PlotStar verification

## Dashboard 2 HAVEN integration — November 14, 2026

- Locate's existing UI preview remains independent; its no-API browser regression check passes.
- Design and Protect reuse HAVEN's six-level geometry and instanced renderer. Shared monitoring
  defaults/recommendations were extracted unchanged so the original telemetry pipeline uses the same rules.
- Type checking, production build and all 18 unit tests pass.
- The full browser suite passes all 11 tests (2.6 minutes), including the original project,
  design, monitoring, telemetry/SSE, report-export and mobile journeys.
- All five focused Dashboard 2 browser checks pass: real WebGL, desktop/mobile layouts, configured
  thresholds, sensor points, route exclusion, leak/fire/usage simulation, acknowledgement without clearing
  hazards, reset/recovery, persisted deployment, returning to setup, independent facilities, stale-write
  rejection and same-origin validation. The tests use the isolated SQLite test database.
- Sample model and simulation labels are explicit. No hardware or external HAVEN agents are connected.
  Evacuation paths come from the configured demo topology, use stairs and are not step-free.
- Desktop/mobile QA: `output/qa/dashboard-2/haven/`. Source inventory and operation notes:
  `docs/haven-integration.md`. The separate HAVEN repository was read but not edited.

## Original verification record

Verified locally on November 14, 2026 (America/New_York).

- `npm.cmd run build`: passes; production compilation, static rendering, API route generation and TypeScript checking complete.
- `npm.cmd run typecheck`: passes independently.
- `npm.cmd test`: 13 tests pass for parsing, distinct rankings, normalized weights, geometry, site bounds, budget response, financial arithmetic, park economics, data center allowances, sensor placement, event rules and contextual reports/assistant responses.
- `npm.cmd run test:e2e`: 6 tests pass against a production server with an isolated SQLite test database, including all three demonstration journeys, authenticated telemetry/device binding/SSE, validation/origin handling, a complete desktop browser journey, mobile landing/dashboard, and mobile project workflow through sensor creation and report export.
- `npm.cmd audit`: zero known vulnerabilities at verification time.
- Generated and parsed report samples for residential, data center and park projects. Rendered all 13 pages, inspected the contact sheet and representative pages, and checked text bounds programmatically: zero blocks outside safe page bounds.
- Browser tests exercise actual React Three Fiber/WebGL rendering using Chromium software WebGL. Desktop model geometry, incident highlighting, mobile layouts and saved edits were inspected. No page errors occurred in the desktop end-to-end journey.
- Main local preview returned HTTP 200 at `http://127.0.0.1:3000`; the normal database contains the three seeded demonstrations. Automated checks use a separate test database.
- The on-demand external Overpass lookup was attempted. It was unavailable in this environment, and the endpoint correctly returned `Illustrative fallback` with zero live points and a visible explanation. Base map tiles are network dependent.

Not verified with external services/equipment: optional LLM calls with a real OpenAI key, flashing the example firmware onto an ESP32, physical sensor calibration and real device connectivity. Hardware HTTP ingestion was verified with authenticated test submissions; this is not a claim of physical hardware connectivity. All site metrics remain illustrative and all designs/safety plans conceptual.

Reviewable outputs: `output/qa/` contains browser captures and rendered report QA; `output/pdf/` contains three sample reports. These files were generated from isolated automated test projects. The application's own **Export PDF** action always uses the current saved project.
