# HAVEN in Dashboard 2

Dashboard 2 keeps its existing, independent Locate preview. Complete Locate, open Design, select
the representative model, then follow Protect → Select → Place → Deploy. Deploy opens the
simulation command center and removes the setup navigation. Edit protections returns to setup.

## Sources inspected and reused

The local HAVEN repository is `C:/Users/ksuda/Documents/Cal_Hacks_2026`. It is not modified.

| Source | Use in AFTERLIGHT |
| --- | --- |
| HAVEN `src/lib/building-layout.ts` | Configured six-level building topology, copied into the isolated `dashboard-2/haven` directory. |
| HAVEN `src/components/building-shell.tsx` | Reused static geometry and instanced `BuildingBatch` renderer. Source commit is recorded in the copied files. |
| HAVEN `backend/app/hazards.py`, `severity.py` | Inspected dependency/route-exclusion and severity architecture. The explicit demo adapter excludes paths whose location IDs intersect an active incident's configured exclusions. |
| AFTERLIGHT `src/lib/monitoring.ts` | Existing sensor defaults and incident recommendations extracted unchanged into `monitoring-rules.ts`, then reused by both the original hardware/backend pipeline and Dashboard 2. |
| HAVEN `agents/README.md`, `use-building-state.ts`, property registry and model assets | Inspected Guardian/Monitor/Operator/Dispatcher/Recovery flow, Convex/WebSocket integration and GLB options. The selected prototype facility is not falsely mapped to the live Haven Hall deployment. |

## Facility and storage boundaries

One facility ID combines the selected sample site, project type and city. Design and Protect use
that same ID and model. Protection settings, model acceptance, deployment, readings, incidents and
timeline persist in the existing SQLite database's additive `ProtectionWorkspace` table.
`/api/protection/[id]` validates commands and checks revisions to reject stale writes. Browser
mutations enforce the same origin guard as the original application. Table creation is idempotent;
the Prisma schema includes it for subsequent setup runs. The current generated client can access
it using parameterized SQL without regenerating a native DLL while the original demo is running.

Locate retains its prior refresh behavior. To resume a saved protection plan after refreshing,
complete Locate with the same site/type/city and open Protect. A different selection gets an
independent protection workspace. Model acceptance is required before configuring protections.

## Simulation contract

- `src/lib/haven/config.ts` defines every monitoring point, incident location, exit and route.
- The same representative six-level HAVEN cutaway is used in Design and Protect. It is not a
  generated parcel design. Monitoring covers the configured Level 4 points only.
- Electricity is modeled in kW and water flow in L/min. Moisture and fire use the shared existing
  sensor thresholds. Usage spikes do not invent leak or fire readings.
- Leak and fire demos exclude the East corridor/exit. The configured North route remains clear
  **within this simulation only**. Both routes use stairs and are not step-free. This is not a
  surveyed evacuation plan or verification of real-world safety.
- Active incidents are deduplicated and retained after acknowledgement or disabling a protection.
  Reset Simulation restores demo readings, resolves demo incidents and enters Recovering.
  Complete recovery succeeds only when no active threshold conditions remain.
- Guardian, Building Monitor, Maintenance, Security and Recovery timeline entries are deterministic
  response rules executed by AFTERLIGHT's backend. They are not fabricated external agent reports.
- No HAVEN uAgent service, physical sensor, lock, alarm, emergency call or equipment control is
  connected. All readings and deployment badges explicitly identify simulation mode. The original
  authenticated telemetry integration remains available in the original workspace.

WebGL uses demand rendering and instanced geometry. A selectable 2D route/sensor plan remains
available if 3D cannot initialize. Camera controls support orbit, zoom, floor isolation and reset.

## Checks

`npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, and
`npx.cmd playwright test tests/e2e/dashboard-2.spec.ts tests/e2e/haven-protect.spec.ts`.

Browser tests use the existing isolated test database. QA screenshots are under
`output/qa/dashboard-2/haven/`.
