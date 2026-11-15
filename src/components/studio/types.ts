// Shapes returned by POST /studio/generate (services/api/app/layout_engine.py) and shared display helpers.
import type { GateResult } from '@/lib/types';

export type RoomType =
  | 'data_hall' | 'electrical' | 'battery' | 'mechanical' | 'corridor' | 'support' | 'network' | 'loading' | 'reserve'
  | 'yard_sub' | 'yard_gen' | 'yard_cool' | 'yard_water' | 'yard_bess' | 'yard_solar' | 'yard_parking' | 'yard_wall'
  | 'yard_trees' | 'yard_guard';

/** A row of rack positions. `v` marks a row that runs north-south (after the building is rotated). */
export interface RackRow { x: number; y: number; w: number; d: number; n: number; cap: number; v?: boolean }
export interface Room {
  code: string; name: string; type: RoomType; x: number; y: number; w: number; d: number; h?: number;
  area_m2?: number; need_m2?: number; added?: boolean; level?: number; z?: number; hall?: number; racks?: number; positions?: number; mw?: number; rows?: RackRow[];
}
export interface Check { name: string; ok: boolean; detail: string }
export type Factor = 'money' | 'people' | 'planet' | 'resources';

export interface Concept {
  id: string; name: string; strategy: string; feasible: boolean; rank: number; score: number;
  scores: Record<Factor, number>; advantage: string; tradeoff: string;
  building: { x: number; y: number; w: number; d: number; h: number; storeys: number; floor_h: number };
  rotated: boolean;
  rooms: Room[]; yard: Room[];
  equipment: { code: string; type: string; x: number; y: number; w: number; d: number; h: number }[];
  routes: Record<'power' | 'cooling' | 'data', [number, number][][]>;
  checks: Check[];
  metrics: {
    footprint_m2: number; gross_floor_m2: number; storeys: number; placed_racks: number; rack_positions: number; spare_positions: number;
    expansion_bay_positions: number; hall_area_m2: number; corridor_area_m2: number; corridor_share: number;
    power_route_m: number; cooling_route_m: number; data_route_m: number; site_coverage: number; yard_area_m2: number;
    generators: number;
  };
  money: {
    capex: number; shell: number; equipment: number; distribution: number; interconnect: number; added: number; energy_per_year: number;
    land: number; total_investment: number; revenue_per_year: number; npv: number; npv_p10: number; npv_p50: number; npv_p90: number;
    payback_years: number | null; months_to_power: number; analysis_years: number;
    energy_per_year_flat: number; opex_per_year: number; water_per_year: number; ten_year: number;
  };
  people: { noise_at_boundary_dba: number; noise_at_home_dba: number | null; generator_to_boundary_m: number; home_distance_m: number | null; noise_wall: boolean };
  planet: {
    co2_t_per_year: number; co2_t_per_year_flat: number; embodied_t: number; roof_solar_kwp: number; canopy_solar_kwp: number; roof_solar_mwh: number;
    roof_solar_share: number; solar_avoided_t: number;
  };
  resources: { water_m3_per_year: number; energy_mwh_per_year: number; facility_mw: number; open_land_share: number; spare_positions: number; bess_mwh: number; bess_minutes: number };
}

export interface StudioResult {
  brief: {
    storeys: number; rent_kw_month: number;
    mw_it: number; rack_kw: number; racks: number; halls: number; racks_per_hall: number[]; redundancy: string; cooling: string;
    pue: number; facility_mw: number; generators: number; site_w: number; site_d: number; setback_m: number; env_w: number;
    env_d: number; expansion_pct: number; flexible_share: number;
  };
  concepts: Concept[];
  operating: {
    price_flat: number; price_flex: number; carbon_flat: number; carbon_flex: number; price_label: string; carbon_label: string;
    price_source: string; carbon_source: string; notes: string[];
    price_days: number; price_dates: (string | null)[]; carbon_price_per_t: number; flex_note: string | null;
  };
  site: {
    home_distance_m: number | null; substation_km: number | null; gates: GateResult[]; name: string | null;
    land_cost: number | null; land_label: string | null; land_basis: string | null;
  };
  ranking: { close: boolean; spread: number; note: string; method: string };
  finance: { discount_rate: number; analysis_years: number; draws: number; label: string; note: string; uncertainty: Record<string, [number, number]> };
  assumptions: { key: string; value: number; unit: string; basis: string; label: string; verify: boolean }[];
  note: string;
}

export type AddedType = 'yard_bess' | 'yard_solar' | 'yard_water' | 'yard_parking' | 'yard_wall' | 'yard_trees' | 'yard_guard';
/** The user's changes to one concept. Sent with every request so the engine re-measures the edited layout. */
export interface ConceptEdit {
  building: { dx: number; dy: number };
  rotate: boolean;
  yard: Record<string, { x: number; y: number }>;
  added: { code: string; type: AddedType; x: number; y: number; w: number; d: number }[];
}
export type Edits = Record<string, ConceptEdit>;

export interface Brief {
  name: string; market: 'Houston' | 'Los Angeles'; mw: number; rackKw: number; redundancy: 'N' | 'N+1' | '2N';
  cooling: 'air' | 'hybrid' | 'water' | 'liquid'; halls: number | null; siteW: number; siteD: number; setback: number;
  expansion: number; flex: number; storeys: number; rent: number | null;
}

export const COOLING_LABEL: Record<Brief['cooling'], string> = {
  liquid: 'Liquid cooled (closed loop)', air: 'Air cooled', hybrid: 'Hybrid (adiabatic)', water: 'Evaporative water',
};

export const TYPE_STYLE: Record<RoomType, { fill: string; stroke: string; label: string }> = {
  data_hall: { fill: '#eef3ec', stroke: '#264d39', label: 'Data hall' },
  electrical: { fill: '#f6e7c6', stroke: '#a8731c', label: 'Electrical' },
  battery: { fill: '#f3d9cf', stroke: '#a5533a', label: 'Battery' },
  mechanical: { fill: '#d5e6ef', stroke: '#3d7391', label: 'Mechanical' },
  corridor: { fill: '#dfe9d9', stroke: '#9db59a', label: 'Circulation' },
  support: { fill: '#ece9f4', stroke: '#6f6596', label: 'Support' },
  network: { fill: '#e2dbf0', stroke: '#6f5aa6', label: 'Network' },
  loading: { fill: '#efeade', stroke: '#8a8062', label: 'Loading' },
  reserve: { fill: '#f7f8f4', stroke: '#9aa69d', label: 'Expansion' },
  yard_sub: { fill: '#dcdfda', stroke: '#5c665f', label: 'Substation' },
  yard_gen: { fill: '#f3e6c4', stroke: '#a8731c', label: 'Generators' },
  yard_cool: { fill: '#d5e6ef', stroke: '#3d7391', label: 'Heat rejection' },
  yard_water: { fill: '#c3deec', stroke: '#2f6f93', label: 'Water storage' },
  yard_bess: { fill: '#e3ece2', stroke: '#3b8f5e', label: 'Battery storage' },
  yard_solar: { fill: '#cfd9e8', stroke: '#1f3a5f', label: 'Solar canopy' },
  yard_parking: { fill: '#d9dbd7', stroke: '#565b58', label: 'Parking' },
  yard_wall: { fill: '#b5bcb4', stroke: '#4d564f', label: 'Noise wall' },
  yard_trees: { fill: '#cfe0c6', stroke: '#4f7f55', label: 'Tree buffer' },
  yard_guard: { fill: '#efe6cf', stroke: '#8a8062', label: 'Gatehouse' },
};

export const ROUTE_COLOR = { power: '#c26a12', cooling: '#2f7fb0', data: '#7a5fc0' } as const;

export const WHY: Record<RoomType, string> = {
  data_hall: 'Sized from the rack count: rows at the assumed rack width and row pitch, with a clear perimeter.',
  electrical: 'Sized per MW of the hall it serves and placed against that hall to keep the power route short.',
  battery: 'Sized per MW and per power string (more strings at N+1 and 2N), next to its UPS room.',
  mechanical: 'Sized per MW for the chosen cooling type and placed on the hall edge facing the heat rejection yard.',
  corridor: 'A spine wide enough to move equipment between the loading area and every technical room.',
  support: 'Fixed-size support space: control room, offices and security.',
  network: 'Two separate meet-me rooms so carrier connections do not share one room.',
  loading: 'Scales with capacity; on the building edge so deliveries do not cross the halls.',
  reserve: 'An empty bay with the same dimensions as a hall, kept for future racks.',
  yard_sub: 'Sized from the facility load and placed outside the building, closest to the electrical rooms.',
  yard_gen: 'One standby generator per 2.5 MW of facility load, plus spares for the chosen redundancy.',
  yard_cool: 'Outdoor heat rejection sized per MW of IT load.',
  yard_water: 'Stored water for evaporative or hybrid cooling.',
  yard_bess: 'Battery storage you added. Its energy is estimated from its footprint and it adds to the build cost.',
  yard_solar: 'A solar canopy you added. Its output is estimated from its area and it adds to the build cost.',
  yard_parking: 'Parking you added. It counts as covered land and adds paving cost.',
  yard_wall: 'A noise wall you added. Within 20 m of the generator yard it is counted as an 8 dBA reduction (a team assumption).',
  yard_trees: 'A planted buffer you added. It stays open land and adds landscaping cost.',
  yard_guard: 'A gatehouse you added at the site entrance.',
};

export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const num = (n: number | null | undefined, d = 0) =>
  n == null ? 'Unknown' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(n);
export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;

/** Minimal ASCII DXF (R12): one closed polyline per room on a layer named after its type, plus a text label. */
export function toDxf(c: Concept, siteW: number, siteD: number): string {
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const rect = (layer: string, x: number, y: number, w: number, d: number) => {
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + d], [x, y + d]])
      out.push('0', 'VERTEX', '8', layer, '10', px.toFixed(3), '20', py.toFixed(3), '30', '0');
    out.push('0', 'SEQEND');
  };
  const text = (layer: string, x: number, y: number, h: number, s: string) =>
    out.push('0', 'TEXT', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3), '30', '0', '40', h.toFixed(2), '1', s);
  rect('SITE', 0, 0, siteW, siteD);
  rect('BUILDING', c.building.x, c.building.y, c.building.w, c.building.d);
  for (const r of [...c.rooms, ...c.yard]) {
    const layer = r.type.toUpperCase() + (c.building.storeys > 1 && r.level != null ? `_L${r.level + 1}` : '');
    rect(layer, r.x, r.y, r.w, r.d);
    text('LABELS', r.x + 0.5, r.y + 0.5, Math.min(1.2, r.d / 4), `${r.code} ${r.name}`);
    for (const row of r.rows ?? []) rect('RACK_ROWS', row.x, row.y, row.v ? row.w : (row.w * row.n) / row.cap, row.v ? (row.d * row.n) / row.cap : row.d);
  }
  for (const e of c.equipment) rect('GENERATORS', e.x, e.y, e.w, e.d);
  for (const kind of ['power', 'cooling', 'data'] as const)
    for (const line of c.routes[kind])
      for (let i = 0; i < line.length - 1; i++)
        out.push('0', 'LINE', '8', `ROUTE_${kind.toUpperCase()}`, '10', line[i][0].toFixed(3), '20', line[i][1].toFixed(3),
          '11', line[i + 1][0].toFixed(3), '21', line[i + 1][1].toFixed(3));
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

export function download(name: string, body: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
