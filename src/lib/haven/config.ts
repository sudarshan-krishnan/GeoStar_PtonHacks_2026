// Explicit simulation topology, in the coordinate system of HAVEN's six-level sample twin.
// Routes use stairs and are not step-free. No surveyed or approved real-world route is implied.
export type Point3 = [number, number, number];
export const MODEL_ID = 'haven-six-level-sample-v1';
export const MODEL_NAME = 'HAVEN six-level cutaway';
export const MODEL_NOTE = 'Representative sample model · configured monitoring on Level 4 only';
export const levelY = (floor: number) => 0.42 + (floor - 1) * 1.45;
const y = levelY(4) + 0.3;
export const monitoringPoints = [
  {
    id: 'meter-electric',
    label: 'Electricity meter',
    protection: 'electricity' as const,
    zone: 'Electrical service bay',
    floor: 4,
    position: [5.65, y + 0.25, -1.45] as Point3,
  },
  {
    id: 'meter-water',
    label: 'Water flow meter',
    protection: 'waterUsage' as const,
    zone: 'R-3 utility bay',
    floor: 4,
    position: [5.52, y + 0.25, -2.55] as Point3,
  },
  {
    id: 'leak-r3',
    label: 'R-3 moisture sensor',
    protection: 'leak' as const,
    zone: 'R-3 utility bay',
    floor: 4,
    position: [5.05, y, -1.7] as Point3,
  },
  {
    id: 'leak-east',
    label: 'East corridor moisture',
    protection: 'leak' as const,
    zone: 'East operations corridor',
    floor: 4,
    position: [2.7, y, 0.55] as Point3,
  },
  {
    id: 'fire-east',
    label: 'East smoke / heat sensor',
    protection: 'fire' as const,
    zone: 'East operations corridor',
    floor: 4,
    position: [2.2, y + 0.5, 0.55] as Point3,
  },
  {
    id: 'fire-west',
    label: 'West smoke / heat sensor',
    protection: 'fire' as const,
    zone: 'West operations corridor',
    floor: 4,
    position: [-3.1, y + 0.5, 0.55] as Point3,
  },
];
export const evacuationPlans = {
  east: {
    id: 'east',
    name: 'East Exit',
    exit: 'east-exit',
    stepFree: false,
    description: 'Level 4 corridor → east stairwell → ground-floor East Exit',
    locationIds: ['room-start', 'east-corridor-l4', 'east-stairwell', 'east-exit'],
    points: [
      [-0.65, y, 1.35],
      [-0.65, y, 0.55],
      [4.7, y, 0.55],
      [4.7, y, 2.05],
      ...[3, 2, 1].map((floor) => [4.7, levelY(floor) + 0.3, 2.05]),
      [6.1, levelY(1) + 0.3, 2.1],
      [8, levelY(1) + 0.3, 2.1],
    ] as Point3[],
    exitPosition: [6.1, levelY(1) + 0.5, 2.1] as Point3,
  },
  north: {
    id: 'north',
    name: 'North Exit',
    exit: 'north-exit',
    stepFree: false,
    description: 'Level 4 corridor → west stairwell → configured ground-floor North Exit',
    locationIds: ['room-start', 'west-corridor-l4', 'west-stairwell', 'north-exit'],
    points: [
      [-0.65, y, 1.35],
      [-0.65, y, 0.55],
      [-5, y, 0.55],
      [-5, y, -1.55],
      ...[3, 2, 1].map((floor) => [-5, levelY(floor) + 0.3, -1.55]),
      [-5, levelY(1) + 0.3, -3.6],
      [-0.65, levelY(1) + 0.3, -3.6],
      [-0.65, levelY(1) + 0.3, -5],
    ] as Point3[],
    exitPosition: [-0.65, levelY(1) + 0.5, -3.6] as Point3,
  },
} as const;
export type PlanId = keyof typeof evacuationPlans;
export const demoScenarios = {
  leak: {
    label: 'Water leak',
    zone: 'East operations corridor',
    blockedLocations: ['east-corridor-l4', 'east-exit'],
    sensor: 'leak-east',
    value: 88,
    hazardPosition: [2.7, y - 0.1, 0.55] as Point3,
  },
  fire: {
    label: 'Fire alarm',
    zone: 'East operations corridor',
    blockedLocations: ['east-corridor-l4', 'east-exit'],
    sensor: 'fire-east',
    value: 1,
    hazardPosition: [2.2, y, 0.55] as Point3,
  },
} as const;

// Where the single DataBot sensor unit can sit on Level 4 of the sample twin (plan x/z, metres).
// Placement is recorded with the deployment. Simulated readings do not depend on it.
export const databotPlacements = {
  utility: {
    name: 'Utility & electrical bay',
    detail: 'Beside the water riser and main meter.',
    bestFor: 'Best for leaks, water and power use',
    plan: [5.3, -1.9] as [number, number],
  },
  east: {
    name: 'East operations corridor',
    detail: 'On the route to the east stairwell.',
    bestFor: 'Best for smoke, heat and corridor leaks',
    plan: [2.4, 0.55] as [number, number],
  },
  core: {
    name: 'Operations room',
    detail: 'The centre of Level 4, where people work.',
    bestFor: 'Best for an overall view of the floor',
    plan: [-0.65, 1.35] as [number, number],
  },
  west: {
    name: 'West operations corridor',
    detail: 'On the route to the west stairwell.',
    bestFor: 'Best for watching the north exit route',
    plan: [-3.1, 0.55] as [number, number],
  },
} as const;
export type PlacementId = keyof typeof databotPlacements;
export const placementIds = Object.keys(databotPlacements) as [PlacementId, ...PlacementId[]];
