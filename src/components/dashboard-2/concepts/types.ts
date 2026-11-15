// Subset of HAVEN's PropertyConfig (Cal_Hacks_2026 src/lib/properties.ts) that the concept
// geometry reads. The JSON in ./data is trimmed from HAVEN's buildings.json to these fields.
export type Point3 = [number, number, number];

export interface PropertyLevel {
  id: number;
  label: string;
  shortLabel: string;
  y: number;
  height: number;
  color: string;
  cameraTarget?: Point3;
  cameraOffset?: Point3;
}
export interface PropertyAsset {
  id: string;
  name: string;
  kind: string;
  location: string;
  position: Point3;
  node: string;
  detail: string;
  floor: number;
  floors: number[];
}
export interface PropertyConfig {
  id: string;
  name: string;
  subtitle: string;
  model: string;
  outdoor?: {
    kind: 'community-park' | 'solar-farm' | 'wind-farm';
    ground: { size: [number, number]; color: string };
    features: {
      id: string;
      kind: string;
      position: Point3;
      size: Point3;
      rotation?: Point3;
      assetId?: string;
    }[];
    paths: { id: string; points: Point3[]; width: number; kind: string }[];
    inventoryTitle: string;
    inventoryNote: string;
  };
  spatial?: {
    slabs: { floor: number; center: [number, number]; size: [number, number] }[];
    rooms: {
      id: string;
      name: string;
      floor: number;
      center: [number, number];
      size: [number, number];
      kind: string;
    }[];
  };
  levels: PropertyLevel[];
  assets: PropertyAsset[];
  nodes: { id: string; name: string; position: Point3; kind: string; node: string; floor: number }[];
  sensors: { id: string; type: string; location: string; node: string; floor: number; assetId: string }[];
  geometry: { camera: Point3; target: Point3; maxDistance?: number };
  infrastructureLines: {
    id: string;
    floor: number;
    kind: string;
    systemId: string;
    points: Point3[];
    radius: number;
  }[];
}
