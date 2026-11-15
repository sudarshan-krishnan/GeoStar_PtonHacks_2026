export interface Combo {
  site_id: string;
  site_name: string;
  cooling: 'air' | 'hybrid' | 'water';
  f: number;
  d: number;
  firm_capacity_share: number;
  firm_capacity_basis: string;
  stress_hours: number[];
  pue: number;
  land: number;
  interconnect?: number;
  capex: number;
  energy_cost_year: number;
  water_gal_year: number;
  cost: number;
  co2_est_t_year: number;
  peak_mw: number;
  max_mw: number;
  schedule: number[];
  schedule_stress: number[];
}

export interface OptimizeResult {
  run_id: string;
  parent_run_id?: string | null;
  elapsed_s: number;
  baseline: Combo | null;
  optimized: Combo | null;
  inflexible?: Combo | null;
  inflexible_feasible_plans?: number;
  delta: { cost: number; npv: number; co2_est_t_year: number; peak_mw: number; same_site: boolean } | null;
  combinations: Combo[];
  infeasible: { site_id: string; name: string; cooling: string; f: number; reason: string }[];
  rejected: { parcel_id: string; name: string; gate: string; value: unknown; limit: unknown; reason: string }[];
  feasibility_notes: string[];
  grid: {
    price: number[];
    carbon: number[];
    mix?: Record<string, number>[] | null;
    price_label: string;
    carbon_label: string;
    price_date: string | null;
    carbon_date: string | null;
    hub: string;
    source: string;
  };
  sites: { id: string; name: string; status: string }[];
  request?: { price_multiplier?: number; carbon_price_per_t?: number; flexible_share?: number; mw_it?: number; firm_capacity?: Record<string, number> };
}
