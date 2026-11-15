export type DevelopmentType = 'residential' | 'data-center' | 'park' | 'commercial';
export type Stage = 'discover' | 'design' | 'protect';
export interface Requirements {
  location: string;
  capacity: number;
  budget: number;
  floors: number;
  monthlyRate: number;
  occupancy: number;
  expenseRatio: number;
  parking: number;
  setback: number;
}
export interface Site {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  width: number;
  depth: number;
  landCost: number;
  metrics: Record<string, number>;
  risks: string[];
  context: string;
  amenities: {
    schools: number;
    restaurants: number;
    parks: number;
    transit: number;
    population: number;
  };
  provenance: string;
  // --- Real-data extensions (present when source === 'costar'; see services/api /sites/candidates) ---
  source?: 'costar' | 'illustrative';
  parcelId?: string;
  costarPropertyId?: number;
  lotAcres?: number;
  buildingSf?: number | null;
  availability?: string;
  photoUrl?: string | null;
  landCostBasis?: string;
  labels?: Record<string, DataLabel>;
  screen?: SiteScreen;
}
export type DataLabel = 'Measured' | 'Sourced' | 'Estimated' | 'Simulated' | 'Utility-confirmed' | 'Unknown';
export interface GateResult {
  gate: string;
  status: 'Pass' | 'Fail' | 'Needs review';
  value: string | number | null;
  limit: string | number | null;
  unit: string;
  label: DataLabel;
  reason: string;
  source: string;
  retrieved_at: string | null;
}
export interface SiteScreen {
  parcel_id: string;
  status: 'Pass' | 'Fail' | 'Needs review';
  gates: GateResult[];
  power: {
    residential_within_1mi?: number;
    residential_within_1mi_note?: string;
    water_stress_cat?: number | null;
    water_cooling_ok: boolean | null;
    building_service_mw: number | null;
    building_service_method: string | null;
    building_service_label: DataLabel;
    has_heavy_power: number | null;
    nearest_substation: {
      name: string | null;
      operator: string | null;
      max_kv: number | null;
      osm_id: string;
      distance_km: number;
      lat: number;
      lon: number;
    } | null;
    substation_source: string | null;
    substation_retrieved_at: string | null;
    requires_utility_confirmation: string[];
  };
  evidence_gaps: string[];
}
export interface Design {
  id: string;
  name: string;
  strategy: string;
  width: number;
  depth: number;
  floors: number;
  green: number;
  parking: number;
  setback: number;
  rotation: number;
}
export interface Sensor {
  id: string;
  projectId: string;
  name: string;
  type: string;
  zone: string;
  x: number;
  z: number;
  floor: number;
  value: number;
  threshold: number;
  unit: string;
  source: string;
  deviceId: string | null;
  lastSeen: string | null;
  updatedAt: string;
}
export interface Incident {
  id: string;
  projectId: string;
  sensorId: string;
  kind: string;
  zone: string;
  severity: string;
  status: string;
  message: string;
  recommendation: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface Project {
  id: string;
  name: string;
  brief: string;
  type: DevelopmentType;
  stage: Stage;
  requirements: Requirements;
  sites: Site[];
  selectedSiteId: string | null;
  designs: Design[];
  approvedDesignId: string | null;
  weights: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  sensors: Sensor[];
  incidents: Incident[];
  messages: { id: string; role: string; content: string; createdAt: string }[];
  simulations: { id: string; kind: string; summary: string; createdAt: string }[];
}
export interface AmenityResult {
  source: 'OpenStreetMap / Overpass' | 'Illustrative fallback';
  fetchedAt: string;
  message: string;
  points: { id: number; name: string; type: string; lat: number; lng: number }[];
}
