// Reused from HAVEN (285ed0ffd8c79b06c08dedef9468dffad5c40451), C:/Users/ksuda/Documents/Cal_Hacks_2026.
// Geometry and instanced rendering only; the source repository is unchanged.
/** Geometry/topology configuration only. No incident, approval or route decisions. */
export type Point3 = [number, number, number];
export type Point2 = [number, number];
export type LayoutKind = "floor" | "room" | "corridor" | "elevator" | "stairs" | "refuge" | "riser" | "utility" | "electrical" | "hvac" | "exit" | "entrance" | "sensor";
export interface LayoutEntity {
  id: string; label: string; kind: LayoutKind; floor: number | null;
  position: Point3; size: Point3; description: string;
  backendId?: string; locationIds?: string[]; sensorTypes?: string[];
  glbNodes: string[];
}
export const FLOOR_LEVELS = [1, 2, 3, 4, 5, 6];
export const floorY = (level: number) => .42 + (level - 1) * 1.45;
const entities: LayoutEntity[] = [];
function entity(id: string, label: string, kind: LayoutKind, floor: number | null, position: Point3, size: Point3, description: string, binding: Partial<LayoutEntity> = {}) {
  entities.push({ id, label, kind, floor, position, size, description, glbNodes: [id.replaceAll("-", "_")], ...binding });
}
for (const floor of FLOOR_LEVELS) {
  const y = floorY(floor);
  entity(`floor-${floor}`, `Level ${floor}`, "floor", floor, [0, y, 0], [12, .16, 6.4], "Separated floor plate. Select a floor to focus; isolate it to inspect the rooms.");
  for (const [suffix, x, z] of [[10, -2.9, -1.75], [14, -.65, -1.75], [15, 1.6, -1.75], [11, -2.9, 2.1], [12, -.65, 2.1], [13, 1.6, 2.1]]) {
    if (floor === 1 && suffix === 12) continue; // Open ground-floor lobby.
    const number = floor * 100 + suffix;
    entity(`room-${number}`, `Room ${number}`, "room", floor, [x, y + .16, z], [2.08, .08, z < 0 ? 2.35 : 1.72], "Illustrative dorm room with bed, desk and storage. Room geometry is not live occupancy telemetry.", { backendId: `room-${number}` });
  }
  entity(`corridor-${floor}`, `Level ${floor} corridor`, "corridor", floor, [0, y + .12, .55], [10.5, .06, 1.16], "Continuous shared corridor connecting rooms, cores and the refuge.");
  entity(`stairs-west-${floor}`, `West stairwell · L${floor}`, "stairs", floor, [-5, y + .5, -1.55], [1.65, .9, 2.25], "Architectural stairwell. Never part of a step-free route.");
  entity(`stairs-east-${floor}`, `East stairwell · L${floor}`, "stairs", floor, [4.7, y + .5, 2.05], [1.9, .9, 1.85], "Architectural stairwell. Never part of a step-free route.");
  entity(`service-${floor}`, `Maintenance access · L${floor}`, "utility", floor, [5.4, y + .15, -1.65], [1.05, .1, 2.5], "Service bay and utility panels. Access is illustrative; this model never authorizes entry.", { locationIds: floor === 4 ? ["riser-r3-l4", "electrical-l4", "hvac-l4"] : [] });
}
const y4 = floorY(4);
entity("elevator-e1", "Elevator E1", "elevator", null, [4, y4 + .55, -1.55], [1.4, 1.05, 1.75], "Elevator shaft, landings and illustrative car. Car position is not live telemetry.", { backendId: "E1", locationIds: ["elevator-e1-l4"], glbNodes: ["elevator_e1", "Elevator_E1"] });
entity("riser-r3", "Riser R-3", "riser", null, [5.52, y4 + .55, -2.55], [.2, 1.1, .2], "Vertical water riser, floor branches and isolation valves in the service bay.", { backendId: "R3", locationIds: ["riser-r3-l4"], glbNodes: ["riser_r3", "Riser_R3"] });
entity("panel-electrical-l4", "EP-L04 · Electrical panel", "electrical", 4, [5.65, y4 + .57, -1.45], [.23, .72, .6], "Configured electrical service panel in the Level 4 utility bay. State comes from the electrical supply report; missing telemetry is unknown.", { backendId: "POWER", locationIds: ["electrical-l4"], glbNodes: ["panel_electrical_l4", "EP_L04"] });
entity("hvac-zone-l4", "HVAC-L04 · Service zone", "hvac", 4, [5.66, y4 + .62, -1.05], [.1, .18, .18], "Configured HVAC service point for the Level 4 zone. No temperature or airflow is inferred without a reported signal.", { backendId: "HVAC", locationIds: ["hvac-l4"], glbNodes: ["hvac_zone_l4", "HVAC_L04"] });
entity("west-refuge", "West refuge", "refuge", 4, [-5, y4 + .15, 1.9], [1.65, .1, 1.75], "Same-floor refuge area in the fictional layout. Its route is usable only when published by the backend.", { backendId: "west-refuge-l4", locationIds: ["west-refuge-l4"], glbNodes: ["west_refuge", "West_Refuge"] });
entity("exit-west", "West exit", "exit", 1, [-6.1, floorY(1) + .4, -.6], [.2, .7, .8], "Illustrative ground-floor exit from the west core.");
entity("exit-east", "East exit", "exit", 1, [6.1, floorY(1) + .4, 2.1], [.2, .7, .8], "Illustrative ground-floor exit from the east core.");
entity("main-entrance", "Responder entry", "entrance", 1, [-.65, floorY(1) + .3, 3.65], [2, .6, .3], "Main entrance. Readiness/arrival are human reports, not automatic door controls.", { backendId: "main-entrance", locationIds: ["main-entrance"] });
const sensors: [string, string, string[], string, Point3][] = [
  ["sensor-moisture-r3", "Moisture / pressure · R-3", ["water", "moisture", "water_pressure"], "riser-r3-l4", [5.45, y4 + .28, -2.15]],
  ["sensor-heat-east", "Heat · east corridor", ["heat"], "east-corridor-l4", [2.7, y4 + .9, .55]],
  ["sensor-smoke-east", "Smoke · east corridor", ["smoke"], "east-corridor-l4", [1.3, y4 + .95, .55]],
  ["sensor-alarm-east", "Fire alarm · east corridor", ["fire_alarm"], "east-corridor-l4", [3.6, y4 + .65, .9]],
  ["sensor-heat-west", "Heat · west corridor", ["heat"], "west-corridor-l4", [-2.7, y4 + .9, .55]],
  ["sensor-smoke-west", "Smoke / fire · west corridor", ["smoke", "fire_alarm"], "west-corridor-l4", [-4.1, y4 + .95, .55]],
];
for (const [id, label, types, location, position] of sensors) entity(id, label, "sensor", 4, position, [.18, .1, .18], "Configured sensor anchor. Inspect for reported value, source and observation time; missing telemetry is not a healthy-device claim.", { sensorTypes: types, locationIds: [location] });

export const BUILDING_LAYOUT = {
  id: "haven-hall", name: "Haven Hall", scaleNote: "Illustrative layout · approximately 2 m per scene unit",
  floors: FLOOR_LEVELS, entities,
  attentionTargets: { R3: "riser-r3", E1: "elevator-e1", accessible_route: "corridor-4", "room-412": "room-412", "proposed-route": "west-refuge" } as Record<string, string>,
  geometry: { provider: "procedural" as "procedural" | "glb", url: "/models/haven.glb", scale: [1, 1, 1] as Point3, position: [0, 0, 0] as Point3 },
  routes: [
    { id: "route-normal-e1", backendId: "normal-e1", floor: 4, stepFree: true, points: [[-.65, 1.35], [-.65, .55], [4, .55], [4, -.75]] as Point2[] },
    { id: "route-west-refuge", backendId: "west-refuge", floor: 4, stepFree: true, points: [[-.65, 1.35], [-.65, .55], [-5, .55], [-5, 1.45]] as Point2[] },
  ],
  zones: [
    { id: "zone-east", label: "East corridor", locationId: "east-corridor-l4", floor: 4, center: [2.4, .55] as Point2, size: [3.8, 1.2] as Point2 },
    { id: "zone-west", label: "West corridor", locationId: "west-corridor-l4", floor: 4, center: [-3.2, .55] as Point2, size: [3.9, 1.2] as Point2 },
    { id: "zone-water", label: "R-3 service zone", locationId: "riser-r3-l4", floor: 4, center: [5.05, -1.7] as Point2, size: [1.8, 2.8] as Point2 },
  ],
};
export const LAYOUT_BY_ID = Object.fromEntries(entities.map(e => [e.id, e])) as Record<string, LayoutEntity>;
export const BACKEND_TO_LAYOUT = Object.fromEntries(entities.filter(e => e.backendId).map(e => [e.backendId!, e.id]));
export const routePoints3D = (id: string): Point3[] => {
  const route = BUILDING_LAYOUT.routes.find(r => r.id === id)!;
  return route.points.map(([x, z]) => [x, floorY(route.floor) + .21, z]);
};
export const mapPoint = ([x, z]: Point2): Point2 => [340 + x * 47, 202 + z * 47];
export const mapPath = (points: Point2[]) => points.map((p, i) => `${i ? "L" : "M"}${mapPoint(p).join(" ")}`).join(" ");
