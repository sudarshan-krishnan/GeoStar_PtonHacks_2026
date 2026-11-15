'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { OptimizeResult } from './optimize-types';
import { bestPlanFor } from './plan-panel';
import type { ExploreSite } from './types';
import { fmtMoney, fmtNum, verdict } from './types';

export function CompareDrawer({ sites, run, onClose }: { sites: ExploreSite[]; run: OptimizeResult | null; onClose: () => void }) {
  const g = (s: ExploreSite, name: string) => s.screen?.gates.find((x) => x.gate === name);
  const plans = sites.map((s) => bestPlanFor(run, s.id));
  type R = { label: string; get: (s: ExploreSite, i: number) => string | number | null; best?: 'min' | 'max'; fmt?: (v: number) => string };
  const rows: R[] = [
    { label: 'Screen', get: (s) => verdict(s).label },
    { label: 'Score (M · P · Pl)', get: (s) => `${Math.round(s.pillars.money)} · ${Math.round(s.pillars.people)} · ${Math.round(s.pillars.planet)}` },
    { label: 'Acres', get: (s) => s.lotAcres ?? null, best: 'max', fmt: (v) => fmtNum(v, 1) },
    { label: 'Supportable MW', get: (s) => s.supportableMw ?? null, best: 'max', fmt: (v) => fmtNum(v, 0) },
    { label: 'Acquisition', get: (s) => s.landCost || null, best: 'min', fmt: (v) => fmtMoney(v) },
    { label: '$ / acre', get: (s) => (s.landCost && s.lotAcres ? s.landCost / s.lotAcres : null), best: 'min', fmt: (v) => fmtMoney(v) },
    { label: 'Nearest home (m)', get: (s) => (g(s, 'Residential proximity')?.value as number) ?? null, best: 'max', fmt: (v) => fmtNum(v) },
    { label: 'Homes within 1 mi', get: (s) => s.screen?.power.residential_within_1mi ?? null, best: 'min', fmt: (v) => fmtNum(v) },
    { label: 'FEMA zone', get: (s) => (g(s, 'Flood exposure')?.value as string) ?? '—' },
    { label: 'Water stress', get: (s) => (g(s, 'Water stress')?.value as string) ?? '—' },
    { label: 'Substation (km)', get: (s) => s.screen?.power.nearest_substation?.distance_km ?? null, best: 'min', fmt: (v) => fmtNum(v, 1) },
    { label: 'Building service (MW)', get: (s) => s.screen?.power.building_service_mw ?? null, best: 'max', fmt: (v) => fmtNum(v, 1) },
    { label: 'Plan: cooling / curtailment', get: (_s, i) => (plans[i] ? `${plans[i]!.cooling} / ${plans[i]!.f > 0 ? `${Math.round(plans[i]!.d * 100)}%` : 'none'}` : 'not feasible') },
    { label: 'Energy cost / yr', get: (_s, i) => plans[i]?.energy_cost_year ?? null, best: 'min', fmt: (v) => fmtMoney(v) },
    { label: 'CO₂ / yr (t)', get: (_s, i) => plans[i]?.co2_est_t_year ?? null, best: 'min', fmt: (v) => fmtNum(v) },
    { label: 'Load at grid peak (MW)', get: (_s, i) => plans[i]?.peak_mw ?? null, best: 'min', fmt: (v) => fmtNum(v, 1) },
    { label: 'Capex', get: (_s, i) => plans[i]?.capex ?? null, best: 'min', fmt: (v) => fmtMoney(v) },
    { label: '10-year total cost', get: (_s, i) => plans[i]?.cost ?? null, best: 'min', fmt: (v) => fmtMoney(v) },
  ];
  return (
    <div className="ws-drawer-bg" onClick={onClose}>
      <div className="ws-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ws-drawer-head"><h2>Compare {sites.length} sites</h2><button className="ws-btn sm" onClick={onClose}><X size={12} /> Close</button></div>
        <div className="ws-drawer-body">
          <table className="ws-compare">
            <thead><tr><th></th>{sites.map((s) => <th key={s.id}>{s.name}<div style={{ fontWeight: 400, color: 'var(--ws-muted)', fontSize: 11 }}>{s.area}</div></th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const vals = sites.map((s, i) => r.get(s, i));
                const nums = vals.map((v) => (typeof v === 'number' ? v : null));
                const bestVal = r.best && nums.some((n) => n != null) ? (r.best === 'min' ? Math.min(...(nums.filter((n) => n != null) as number[])) : Math.max(...(nums.filter((n) => n != null) as number[]))) : null;
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={bestVal != null && v === bestVal ? 'best' : ''}>{v == null ? '—' : typeof v === 'number' && r.fmt ? r.fmt(v) : String(v)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="ws-note" style={{ marginTop: 10 }}>Plan rows come from the current optimizer run (Estimated). Acquisition basis and gate sources are in each site&apos;s detail panel.</p>
        </div>
      </div>
    </div>
  );
}

interface Assumption { key: string; value: number; unit: string; basis: string; label: string; verify: boolean }

export function AssumptionsDrawer({ overrides, onApply, onClose }: { overrides: Record<string, number>; onApply: (o: Record<string, number>) => void; onClose: () => void }) {
  const [list, setList] = useState<Assumption[]>([]);
  const [draft, setDraft] = useState<Record<string, number>>(overrides);
  useEffect(() => {
    fetch(`${PUBLIC_DATA_API}/assumptions`).then((r) => r.json()).then(setList).catch(() => setList([]));
  }, []);
  return (
    <div className="ws-drawer-bg" onClick={onClose}>
      <div className="ws-drawer narrow" onClick={(e) => e.stopPropagation()}>
        <div className="ws-drawer-head"><h2>Assumptions</h2><button className="ws-btn sm" onClick={onClose}><X size={12} /> Close</button></div>
        <div className="ws-drawer-body">
          <p className="ws-note" style={{ marginBottom: 10 }}>Every modeled figure traces to these values. Edit a value and apply to re-run the optimizer with your overrides; the basis column says where each default comes from. Items marked verify should be source-checked before external use.</p>
          <table className="ws-assump">
            <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Basis</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.key}>
                  <td><code style={{ fontSize: 11 }}>{a.key}</code><div><span className={`ws-tag ${a.label.toLowerCase()}`}>{a.label}</span>{a.verify && <span className="ws-tag" style={{ marginLeft: 4 }}>verify</span>}</div></td>
                  <td><input type="number" step="any" className={draft[a.key] != null && draft[a.key] !== a.value ? 'changed' : ''} value={draft[a.key] ?? a.value} onChange={(e) => setDraft({ ...draft, [a.key]: +e.target.value })} /></td>
                  <td style={{ fontSize: 11.5, color: 'var(--ws-muted)' }}>{a.unit}</td>
                  <td className="basis">{a.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ws-drawer-foot">
          <button className="ws-btn" onClick={() => setDraft({})}>Reset to defaults</button>
          <button className="ws-btn primary" onClick={() => onApply(Object.fromEntries(Object.entries(draft).filter(([k, v]) => list.find((a) => a.key === k)?.value !== v)))}>Apply and re-run</button>
        </div>
      </div>
    </div>
  );
}
