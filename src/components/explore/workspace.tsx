'use client';
// GeoStar analyst workspace: criteria -> screened candidates (table + map) -> optimizer result -> site detail.
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Activity, Bell, Bookmark, Box, Columns3, Eraser, Map as MapIcon, MapPin, PenLine, Satellite, Search, SlidersHorizontal } from 'lucide-react';
import { Brand } from '../brand';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { MapMode } from './explore-map';
import type { OptimizeResult } from './optimize-types';
import { ResultStrip } from './plan-panel';
import { ResultsTable } from './results-table';
import { SiteDetail } from './site-detail';
import { AssumptionsDrawer, CompareDrawer } from './drawers';
import { DecisionView } from './decision-view';
import type { ExploreSite } from './types';
import { verdict } from './types';

const ExploreMap = dynamic(() => import('./explore-map'), { ssr: false, loading: () => <div className="xp-map xp-loading">Loading map…</div> });
const Site3D = dynamic(() => import('./site-3d'), { ssr: false, loading: () => <div className="xp-map xp-loading">Loading 3D…</div> });
const Meters = dynamic(() => import('./meters').then((m) => m.Meters), { ssr: false, loading: () => <div className="xp-map xp-loading">Connecting…</div> });

type Ring = [number, number][];
interface SearchResult { count: number; counts: { Pass: number; 'Needs review': number; Fail: number }; in_polygon: number; sites: Omit<ExploreSite, 'letter'>[] }
interface Saved { id: number; name: string; count: number; shared_with: string[]; alerts: boolean }
interface Alert { type: string; name: string; detail: string }

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${PUBLIC_DATA_API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed (${r.status})`);
  return r.json();
}

export function Workspace() {
  // criteria
  const [market, setMarket] = useState<'Houston' | 'Los Angeles'>('Houston');
  const [mw, setMw] = useState(20);
  const [flex, setFlex] = useState(30);
  const [minAcres, setMinAcres] = useState(2);
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [needRoom, setNeedRoom] = useState(false);
  const [noFlood, setNoFlood] = useState(false);
  const [heavyPower, setHeavyPower] = useState(false);
  const [waterCooling, setWaterCooling] = useState(false);
  const [hideBad, setHideBad] = useState(false);
  const [homesM, setHomesM] = useState(300);
  const [maxWater, setMaxWater] = useState(2);
  const [subKm, setSubKm] = useState(5);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  // stage
  const [mode, setMode] = useState<MapMode>('browse');
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('map');
  const [stage, setStage] = useState<'decision' | 'map' | '3d' | 'live'>('decision');
  const [changedFrom, setChangedFrom] = useState<string | null>(null);
  const [polygon, setPolygon] = useState<Ring | null>(null);
  // data
  const [result, setResult] = useState<SearchResult | null>(null);
  const [run, setRun] = useState<OptimizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [showAssump, setShowAssump] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  const thresholds = useMemo(() => ({ min_home_distance_m: homesM, max_water_stress_cat: maxWater, max_substation_km: subKm }), [homesM, maxWater, subKm]);
  const searchReq = useMemo(() => ({
    market, polygon, thresholds, assumptions: overrides,
    filters: { min_acres: minAcres || null, max_land_cost: maxPrice === '' ? null : maxPrice, min_supportable_mw: needRoom ? mw : null, exclude_flood_zone: noFlood, heavy_power_only: heavyPower, water_cooling_required: waterCooling, hide_failed: hideBad },
    limit: 150,
  }), [market, polygon, thresholds, overrides, minAcres, maxPrice, needRoom, mw, noFlood, heavyPower, waterCooling, hideBad]);
  const optimizeReq = useMemo(() => ({ market, polygon, min_acres: minAcres, thresholds, mw_it: mw, flexible_share: flex / 100, carbon_price_per_t: 50, assumptions: overrides, limit: 150, offline: true }), [market, polygon, minAcres, thresholds, mw, flex, overrides]);

  const runAll = useCallback(async () => {
    setLoading(true); setRunBusy(true); setError(null); setChangedFrom(null);
    try {
      const d = await post<SearchResult>('/search', searchReq);
      setResult(d);
      setSelectedId((cur) => (cur && d.sites.some((s) => s.id === cur) ? cur : null));
      setLoading(false);
      const r = await post<OptimizeResult>('/optimize', optimizeReq);
      setRun({ ...r, request: optimizeReq });
    } catch (e) {
      setError((e as Error).message.includes('fetch') ? `Data service unreachable at ${PUBLIC_DATA_API}.` : (e as Error).message);
    } finally { setLoading(false); setRunBusy(false); }
  }, [searchReq, optimizeReq]);

  const whatIf = useCallback(async (changes: Record<string, unknown>) => {
    if (!run) return;
    setRunBusy(true);
    try {
      const r = await post<OptimizeResult>('/scenarios/run', { run_id: run.run_id, changes });
      setChangedFrom(run.optimized && r.optimized && run.optimized.site_id !== r.optimized.site_id ? run.optimized.site_name : null);
      setRun({ ...r, request: { ...run.request, ...changes } as OptimizeResult['request'] });
    } catch (e) { setError((e as Error).message); } finally { setRunBusy(false); }
  }, [run]);

  const loadSaved = useCallback(() => { fetch(`${PUBLIC_DATA_API}/searches`).then((r) => (r.ok ? r.json() : [])).then(setSaved).catch(() => {}); }, []);
  useEffect(() => { void runAll(); }, [polygon, market, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadSaved, [loadSaved]);
  useEffect(() => { if (run?.run_id) void post('/livegrid/plan', { run_id: run.run_id }).catch(() => {}); }, [run?.run_id]);

  const sites: ExploreSite[] = useMemo(() => (result?.sites ?? []).map((s, i) => ({ ...s, letter: String(i + 1) }) as ExploreSite), [result]);
  const selected = sites.find((s) => s.id === selectedId) ?? null;
  const compareSites = sites.filter((s) => compare.has(s.id));

  async function checkSpot(lng: number, lat: number) {
    setMode('browse'); setPinNote('Screening point…');
    try {
      const d = await post<{ screen: ExploreSite['screen'] }>('/sites/evaluate', { lat, lon: lng, market, thresholds });
      const v = verdict(d);
      setPinNote(`${lat.toFixed(4)}, ${lng.toFixed(4)}: ${v.label}. ${v.reason}.`);
    } catch { setPinNote('Could not screen that point.'); }
  }
  async function saveSearch(name: string, team: string, alertsOn: boolean) {
    await post('/searches', { name, request: searchReq, alerts: alertsOn, shared_with: team.split(',').map((x) => x.trim()).filter(Boolean) });
    setSaveOpen(false); loadSaved();
  }
  async function checkAlerts(id: number) {
    const r = await fetch(`${PUBLIC_DATA_API}/searches/${id}/alerts?update_snapshot=true`);
    const d = await r.json(); setAlerts(d.alerts ?? []); loadSaved();
  }
  const toggleCompare = (id: string) => setCompare((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else if (n.size < 5) n.add(id); return n; });

  return (
    <div className="ws">
      <header className="ws-top">
        <Brand />
        <div className="ws-top-title"><b>Data center site selection</b><span>{market} · CoStar properties · Vexcel · FEMA · WRI Aqueduct · OSM · ERCOT</span></div>
        <div className="ws-top-meta">
          {run && <span>Grid day <b>{run.grid.price_date}</b> ({run.grid.price_label}) · run <b>{run.run_id}</b></span>}
          {Object.keys(overrides).length > 0 && <span><b>{Object.keys(overrides).length}</b> assumption override{Object.keys(overrides).length > 1 ? 's' : ''}</span>}
        </div>
        <div className="ws-top-actions">
          <button className="ws-btn" onClick={() => setShowAssump(true)}><SlidersHorizontal size={14} /> Assumptions</button>
          <button className="ws-btn" onClick={() => setShowCompare(true)} disabled={compareSites.length < 2}><Columns3 size={14} /> Compare ({compareSites.length})</button>
          <button className="ws-btn" onClick={() => setSaveOpen(true)}><Bookmark size={14} /> Save search</button>
        </div>
      </header>

      <div className="ws-body">
        <aside className="ws-left">
          <h2 className="ws-section-title">Project</h2>
          <label className="ws-field"><span>Market</span><select value={market} onChange={(e) => (setPolygon(null), setMarket(e.target.value as typeof market))}><option>Houston</option><option>Los Angeles</option></select></label>
          <label className="ws-field"><span>IT capacity <span className="unit">MW</span></span><input type="number" min={1} max={500} step={1} value={mw} onChange={(e) => setMw(+e.target.value || 1)} /><input type="range" min={5} max={200} step={5} value={mw} onChange={(e) => setMw(+e.target.value)} /></label>
          <label className="ws-field"><span>Flexible load share <span className="unit">%</span></span><input type="number" min={0} max={80} step={5} value={flex} onChange={(e) => setFlex(+e.target.value)} /><input type="range" min={0} max={80} step={5} value={flex} onChange={(e) => setFlex(+e.target.value)} /></label>
          <p className="ws-help">Share of IT load (training, batch) that can shift within the day or curtail in grid-stress hours.</p>

          <div className="ws-divider" />
          <h2 className="ws-section-title">Property filters</h2>
          <label className="ws-field"><span>Min. lot size <span className="unit">acres</span></span><input type="number" min={0} step={0.5} value={minAcres} onChange={(e) => setMinAcres(+e.target.value)} /></label>
          <label className="ws-field"><span>Max. acquisition <span className="unit">$</span></span><input type="number" min={0} step={100000} placeholder="any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value === '' ? '' : +e.target.value)} /></label>
          <div className="ws-checks">
            {([[needRoom, setNeedRoom, `Lot large enough for ${mw} MW (land only, not power)`], [noFlood, setNoFlood, 'Exclude FEMA special flood hazard areas'], [heavyPower, setHeavyPower, 'Heavy power service recorded (≥ 800 A)'], [waterCooling, setWaterCooling, 'Water cooling permissible'], [hideBad, setHideBad, 'Hide sites failing a gate']] as [boolean, (b: boolean) => void, string][]).map(([v, set, label]) => (
              <label key={label} className="ws-check"><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />{label}</label>
            ))}
          </div>

          <div className="ws-divider" />
          <h2 className="ws-section-title">Gate thresholds</h2>
          <label className="ws-field"><span>Residential setback <span className="unit">m</span></span><input type="number" min={0} max={5000} step={50} value={homesM} onChange={(e) => setHomesM(+e.target.value)} /></label>
          <label className="ws-field"><span>Max. water stress <span className="unit">WRI cat.</span></span><select value={maxWater} onChange={(e) => setMaxWater(+e.target.value)}><option value={0}>0 · Low</option><option value={1}>1 · Low-medium</option><option value={2}>2 · Medium-high</option><option value={3}>3 · High</option><option value={4}>4 · Extremely high</option></select></label>
          <label className="ws-field"><span>Substation within <span className="unit">km</span></span><input type="number" min={0.5} max={50} step={0.5} value={subKm} onChange={(e) => setSubKm(+e.target.value)} /></label>
          <p className="ws-help">Gates are pass/fail. Flood uses FEMA NFHL; water stress uses WRI Aqueduct 4.0; homes use CoStar apartment communities and MLS listings.</p>

          <button className="ws-btn primary" style={{ height: 34, justifyContent: 'center' }} onClick={() => void runAll()} disabled={loading || runBusy}><Search size={14} /> {loading ? 'Screening…' : runBusy ? 'Optimizing…' : 'Run screening + optimizer'}</button>

          {saved.length > 0 && (
            <>
              <div className="ws-divider" />
              <h2 className="ws-section-title">Saved searches</h2>
              <div className="ws-saved">
                {saved.map((s) => (
                  <div key={s.id} className="ws-saved-row"><div><b>{s.name}</b><small>{s.count} sites{s.shared_with.length ? ` · ${s.shared_with.join(', ')}` : ''}</small></div><button className="ws-btn sm" title="Check for changes" onClick={() => void checkAlerts(s.id)}><Bell size={12} /></button></div>
                ))}
                {alerts && <div className="ws-alerts">{alerts.length === 0 ? <span>No changes since last check.</span> : alerts.map((a, i) => <span key={i}><b>{a.name}</b>: {a.detail}</span>)}</div>}
              </div>
            </>
          )}
        </aside>

        <main className="ws-center">
          <div className="ws-toolbar">
            <div className="ws-toolbar-left">
              <div className="ws-seg">
                <button className={mode === 'draw' ? 'on' : ''} onClick={() => (setStage('map'), setMode(mode === 'draw' ? 'browse' : 'draw'))}><PenLine size={13} /> Draw area</button>
                <button className={mode === 'pin' ? 'on' : ''} onClick={() => (setStage('map'), setMode(mode === 'pin' ? 'browse' : 'pin'))}><MapPin size={13} /> Screen a point</button>
                {polygon && <button onClick={() => setPolygon(null)}><Eraser size={13} /> Clear area</button>}
              </div>
              {polygon && result && <span className="ws-help">{result.in_polygon} properties inside the area</span>}
            </div>
            <div className="ws-seg">
              <button className={stage === 'decision' ? 'on' : ''} onClick={() => setStage('decision')}>Decision</button>
              <button className={stage === 'map' && basemap === 'map' ? 'on' : ''} onClick={() => (setStage('map'), setBasemap('map'))}><MapIcon size={13} /> Map</button>
              <button className={stage === 'map' && basemap === 'satellite' ? 'on' : ''} onClick={() => (setStage('map'), setBasemap('satellite'))}><Satellite size={13} /> Satellite</button>
              <button className={stage === '3d' ? 'on' : ''} disabled={!selected} onClick={() => setStage('3d')}><Box size={13} /> 3D site</button>
              <button className={stage === 'live' ? 'on' : ''} onClick={() => setStage('live')}><Activity size={13} /> Live grid</button>
            </div>
          </div>

          <div className={`ws-stage ${stage === 'decision' ? 'full' : ''}`}>
            {stage === 'decision' ? (
              <DecisionView run={run} sites={sites} mw={mw} busy={runBusy} changedFrom={changedFrom} onWhatIf={whatIf} onOpenSite={(id) => (setSelectedId(id), setStage('map'))} onLive={() => setStage('live')} />
            ) : stage === 'live' ? (
              <Meters priceDate={run?.grid.price_date} />
            ) : stage === '3d' && selected?.parcelId ? (
              <Site3D key={selected.id} parcelId={selected.parcelId} lat={selected.lat} lng={selected.lng} mw={mw} acres={selected.lotAcres ?? null} />
            ) : (
              <>
                <ExploreMap market={market} sites={sites} selectedId={selectedId} pickId={run?.optimized?.site_id ?? null} onSelect={setSelectedId} mode={mode} polygon={polygon} onPolygon={(r) => (setPolygon(r), setMode('browse'))} onPin={(lng, lat) => void checkSpot(lng, lat)} basemap={basemap} />
                <div className="ws-legend"><span><i style={{ background: 'var(--ws-ok)' }} />Pass</span><span><i style={{ background: 'var(--ws-warn)' }} />Review</span><span><i style={{ background: 'var(--ws-bad)' }} />Fails a gate</span><span><i style={{ background: '#fff', outline: '2px solid #1f2a24' }} />Recommended</span></div>
              </>
            )}
            {pinNote && <div className="xp-toast" onClick={() => setPinNote(null)}>{pinNote}</div>}
            {error && <div className="xp-toast xp-toast-bad">{error}</div>}
          </div>

          {stage !== 'decision' && run && <ResultStrip run={run} />}

          {stage !== 'decision' && <ResultsTable sites={sites} selectedId={selectedId} pickId={run?.optimized?.site_id} compare={compare} counts={result?.counts} onSelect={(id) => (setSelectedId(id), stage === 'live' && setStage('map'))} onToggleCompare={toggleCompare} loading={loading} />}
        </main>

        <aside className="ws-right">
          {selected ? (
            <SiteDetail site={selected} mw={mw} run={run} runBusy={runBusy} onWhatIf={whatIf} onOpen3d={() => setStage('3d')} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="ws-empty"><b>No site selected</b>Select a row or a map marker to see its screening gates with sources, power signals, the optimizer&apos;s operating plan for it, acquisition basis, aerial and interior imagery. Tick rows to compare up to five sites.</div>
          )}
        </aside>
      </div>

      {showCompare && <CompareDrawer sites={compareSites} run={run} onClose={() => setShowCompare(false)} />}
      {showAssump && <AssumptionsDrawer overrides={overrides} onApply={(o) => (setOverrides(o), setShowAssump(false))} onClose={() => setShowAssump(false)} />}
      {saveOpen && (
        <div className="ws-drawer-bg" onClick={() => setSaveOpen(false)}>
          <SaveForm onClose={() => setSaveOpen(false)} onSave={saveSearch} />
        </div>
      )}
    </div>
  );
}

function SaveForm({ onClose, onSave }: { onClose: () => void; onSave: (n: string, t: string, a: boolean) => Promise<void> }) {
  const [name, setName] = useState('Houston 20 MW screening');
  const [team, setTeam] = useState('');
  const [alertsOn, setAlertsOn] = useState(true);
  return (
    <form className="ws-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void onSave(name, team, alertsOn); }}>
      <h2>Save search</h2>
      <label className="ws-field full"><span>Name</span><input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
      <label className="ws-field full"><span>Share with (comma-separated)</span><input className="ws-input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="names" /></label>
      <label className="ws-check"><input type="checkbox" checked={alertsOn} onChange={(e) => setAlertsOn(e.target.checked)} />Alert on new sites, price or gate changes</label>
      <div className="ws-drawer-foot" style={{ padding: 0, border: 0 }}><button type="button" className="ws-btn" onClick={onClose}>Cancel</button><button className="ws-btn primary">Save</button></div>
    </form>
  );
}
