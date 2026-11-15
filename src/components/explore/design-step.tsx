'use client';
// Design step: Claude arranges the facility on the accepted site; this renders it as our own 3D model on the
// real Vexcel aerial, lets the user edit it, and tests it (deterministic checks + operating modes).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { PUBLIC_DATA_API, vexcelOrthoUrl } from '@/lib/plotstar-api';
import type { SiteScreen } from '@/lib/types';
import { CommunitySheet } from './community-sheet';

export type CType = 'data_hall' | 'cooling' | 'generator_yard' | 'substation' | 'battery' | 'water_tank' | 'solar' | 'office' | 'parking';
export interface Comp { id: string; type: CType; label: string; x: number; z: number; w: number; d: number; h: number; rot: 0 | 90 }
interface Layout { site_w: number; site_d: number; components: Comp[]; notes: string[] }
interface Analysis {
  metrics: { it_mw_supported: number; facility_mw: number; gensets: number; backup_mw: number; battery_mwh: number; battery_minutes_at_full_load: number; solar_mwp: number; water_storage_kgal: number; site_coverage: number; hall_gfa_m2: number };
  checks: { check: string; ok: boolean; detail: string }[];
}
export interface DesignSite { id: string; name: string; lat: number; lng: number; acres: number; aerialId: string; screen?: SiteScreen }
type Mode = 'normal' | 'event' | 'outage';
type Src<T> = ({ available: true; source: string } & T) | { available: false; why: string };
export interface LocalContext {
  climate: Src<{ mean_c: number; hottest_c: number; days_above_35c: number; cool_days_below_18c: number; year: number }>;
  solar: Src<{ mwh_per_mwp_year: number; capacity_factor_pct: number }>;
  households: Src<{ households_within_1mi_est: number | null; tract_households: number; tract: string }>;
  retail_price: Src<{ cents_per_kwh: number; period: string; state: string }>;
}

const TYPES: Record<CType, { name: string; color: string; w: number; d: number; h: number }> = {
  data_hall: { name: 'Data hall', color: '#e9ece6', w: 60, d: 40, h: 12 },
  cooling: { name: 'Cooling yard', color: '#9fb3bf', w: 50, d: 10, h: 4 },
  generator_yard: { name: 'Generator yard', color: '#6b5e4e', w: 40, d: 12, h: 3.5 },
  substation: { name: 'Substation', color: '#4d6f8f', w: 45, d: 35, h: 8 },
  battery: { name: 'Battery storage', color: '#3f7a5c', w: 30, d: 12, h: 3 },
  water_tank: { name: 'Water tank', color: '#5aa0c8', w: 16, d: 16, h: 10 },
  solar: { name: 'Solar array', color: '#27384f', w: 40, d: 25, h: 0.6 },
  office: { name: 'Operations building', color: '#cdbfa6', w: 30, d: 15, h: 8 },
  parking: { name: 'Parking', color: '#8d918a', w: 40, d: 18, h: 0.2 },
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${PUBLIC_DATA_API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed (${r.status})`);
  return r.json();
}

function Ground({ aerialId, half }: { aerialId: string; half: number }) {
  const tex = useLoader(THREE.TextureLoader, vexcelOrthoUrl(aerialId, Math.round(half)));
  tex.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
      <planeGeometry args={[half * 2, half * 2]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

function grid(n: number, w: number, d: number, cell: number) {
  const cols = Math.max(1, Math.floor(w / cell)), rows = Math.max(1, Math.floor(d / cell));
  const out: [number, number][] = [];
  for (let r = 0; r < rows && out.length < n; r++) for (let c = 0; c < cols && out.length < n; c++) out.push([(c + 0.5) * (w / cols) - w / 2, (r + 0.5) * (d / rows) - d / 2]);
  return out;
}

function Part({ c, selected, mode, load, baseY, onSelect }: { c: Comp; selected: boolean; mode: Mode; load: number; baseY: number; onSelect: () => void }) {
  const t = TYPES[c.type];
  const w = c.rot === 90 ? c.d : c.w, d = c.rot === 90 ? c.w : c.d;
  const click = (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect(); };
  const edge = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.6, c.h + 0.6, d + 0.6)), [w, d, c.h]);
  let body: React.ReactNode;
  if (c.type === 'data_hall') {
    const glow = mode === 'outage' ? 0.25 : 0.15 + 0.5 * load;
    body = (
      <>
        <mesh position={[0, c.h / 2, 0]} castShadow receiveShadow><boxGeometry args={[w, c.h, d]} /><meshStandardMaterial color={t.color} roughness={0.8} /></mesh>
        <mesh position={[0, c.h * 0.55, d / 2 + 0.06]}><planeGeometry args={[w * 0.96, 1.2]} /><meshStandardMaterial color="#7bd88f" emissive="#3fbf6a" emissiveIntensity={glow * 2} /></mesh>
        {grid(Math.min(40, Math.round((w * d) / 220)), w * 0.9, d * 0.85, 12).map(([x, z], i) => (
          <mesh key={i} position={[x, c.h + 0.9, z]} castShadow><boxGeometry args={[6, 1.8, 3.5]} /><meshStandardMaterial color="#b9c2bb" /></mesh>
        ))}
      </>
    );
  } else if (c.type === 'generator_yard') {
    const n = Math.floor((c.w * c.d) / 30);
    body = (
      <>
        <mesh position={[0, 0.1, 0]} receiveShadow><boxGeometry args={[w, 0.2, d]} /><meshStandardMaterial color="#b7b9b2" /></mesh>
        {grid(n, w * 0.95, d * 0.9, 5.4).map(([x, z], i) => (
          <mesh key={i} position={[x, 1.7, z]} castShadow><boxGeometry args={[3, 3, 4.6]} /><meshStandardMaterial color={t.color} emissive="#ff7a1a" emissiveIntensity={mode === 'outage' ? 1.4 : 0} /></mesh>
        ))}
      </>
    );
  } else if (c.type === 'cooling') {
    body = (
      <>
        <mesh position={[0, 0.1, 0]} receiveShadow><boxGeometry args={[w, 0.2, d]} /><meshStandardMaterial color="#c5c9c2" /></mesh>
        {grid(Math.min(30, Math.round((w * d) / 40)), w * 0.95, d * 0.85, 6).map(([x, z], i) => (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, c.h / 2, 0]} castShadow><boxGeometry args={[4.4, c.h, 4.4]} /><meshStandardMaterial color={t.color} /></mesh>
            <mesh position={[0, c.h + 0.15, 0]}><cylinderGeometry args={[1.7, 1.7, 0.3, 16]} /><meshStandardMaterial color="#39444b" /></mesh>
          </group>
        ))}
      </>
    );
  } else if (c.type === 'substation') {
    body = (
      <>
        <mesh position={[0, 0.15, 0]} receiveShadow><boxGeometry args={[w, 0.3, d]} /><meshStandardMaterial color="#b3b8b0" /></mesh>
        {[-0.28, 0, 0.28].map((f, i) => (
          <mesh key={i} position={[f * w, 3, -d * 0.15]} castShadow><boxGeometry args={[6, 6, 6]} /><meshStandardMaterial color={t.color} emissive="#3fa7ff" emissiveIntensity={mode === 'outage' ? 0 : 0.5} /></mesh>
        ))}
        {[-0.4, -0.13, 0.13, 0.4].map((f, i) => (
          <mesh key={`p${i}`} position={[f * w, c.h / 2 + 1, d * 0.3]}><cylinderGeometry args={[0.25, 0.35, c.h + 2, 8]} /><meshStandardMaterial color="#7c8580" /></mesh>
        ))}
      </>
    );
  } else if (c.type === 'battery') {
    body = <>{grid(Math.round((w * d) / 36), w, d, 6).map(([x, z], i) => (
      <mesh key={i} position={[x, c.h / 2, z]} castShadow><boxGeometry args={[5.2, c.h, 2.6]} /><meshStandardMaterial color={t.color} emissive="#35d08a" emissiveIntensity={mode === 'outage' ? 0.9 : 0.1} /></mesh>
    ))}</>;
  } else if (c.type === 'water_tank') {
    body = <mesh position={[0, c.h / 2, 0]} castShadow><cylinderGeometry args={[Math.min(w, d) / 2, Math.min(w, d) / 2, c.h, 24]} /><meshStandardMaterial color={t.color} roughness={0.5} /></mesh>;
  } else if (c.type === 'solar') {
    const rows = Math.max(1, Math.floor(d / 4));
    body = <>{Array.from({ length: rows }).map((_, i) => (
      <mesh key={i} position={[0, 0.9, (i + 0.5) * (d / rows) - d / 2]} rotation={[-0.35, 0, 0]}><boxGeometry args={[w, 0.12, 2.6]} /><meshStandardMaterial color={t.color} metalness={0.4} roughness={0.3} /></mesh>
    ))}</>;
  } else {
    body = <mesh position={[0, c.h / 2, 0]} castShadow receiveShadow><boxGeometry args={[w, c.h, d]} /><meshStandardMaterial color={t.color} /></mesh>;
  }
  return (
    <group position={[c.x, baseY, c.z]} onClick={click}>
      <group>{body}</group>
      {/* invisible pick box so thin parts are easy to click */}
      <mesh position={[0, Math.max(1, c.h) / 2, 0]}><boxGeometry args={[w, Math.max(1, c.h), d]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
      {selected && <lineSegments position={[0, c.h / 2, 0]}><primitive object={edge} attach="geometry" /><lineBasicMaterial color="#ffb020" /></lineSegments>}
    </group>
  );
}

export function DesignStep({ site, mw, cooling, depth, onNext }: { site: DesignSite; mw: number; cooling: 'air' | 'hybrid' | 'water'; depth: number; onNext: () => void }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [an, setAn] = useState<Analysis | null>(null);
  const [source, setSource] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('normal');
  const [ask, setAsk] = useState('');
  const [addType, setAddType] = useState<CType>('solar');
  const [sheet, setSheet] = useState(false);
  const [ctx, setCtx] = useState<LocalContext | null>(null);
  useEffect(() => {
    let alive = true;
    setCtx(null);
    fetch(`${PUBLIC_DATA_API}/context?lat=${site.lat}&lon=${site.lng}&state=${site.lng < -110 ? 'CA' : 'TX'}`).then((r) => (r.ok ? r.json() : null)).then((d) => alive && setCtx(d)).catch(() => {});
    return () => { alive = false; };
  }, [site.lat, site.lng]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generate = useCallback(async (instruction?: string, current?: Layout | null) => {
    setBusy(true); setNote(null);
    try {
      const r = await post<Analysis & { layout: Layout; source: string; model_error: string | null }>('/design/generate', { site_name: site.name, acres: site.acres, mw, cooling, instruction: instruction || null, current: instruction ? current : null });
      setLayout(r.layout); setAn(r); setSource(r.source); setSel(null);
      if (r.model_error) setNote(`Claude was not used (${r.model_error}); showing a rule-based layout.`);
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }, [site.name, site.acres, mw, cooling]);

  useEffect(() => { void generate(); }, [site.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(next: Layout) {
    setLayout(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { post<Analysis>('/design/check', { layout: next, mw, cooling }).then(setAn).catch(() => {}); }, 350);
  }
  const patch = (id: string, p: Partial<Comp>) => layout && edit({ ...layout, components: layout.components.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const remove = (id: string) => { if (layout) { edit({ ...layout, components: layout.components.filter((c) => c.id !== id) }); setSel(null); } };
  const add = () => {
    if (!layout) return;
    const t = TYPES[addType], id = `${addType}_${Date.now().toString(36)}`;
    edit({ ...layout, components: [...layout.components, { id, type: addType, label: t.name, x: 0, z: layout.site_d / 2 - 10 - t.d / 2 - 2, w: t.w, d: t.d, h: t.h, rot: 0 }] });
    setSel(id);
  };

  const cur = layout?.components.find((c) => c.id === sel) ?? null;
  const m = an?.metrics;
  const load = mode === 'event' ? 1 - depth : 1;
  const draw = m ? m.facility_mw * load : 0;
  const half = layout ? Math.min(600, Math.max(120, Math.max(layout.site_w, layout.site_d) / 2 + 70)) : 200;
  const failed = an?.checks.filter((c) => !c.ok).length ?? 0;

  return (
    <main className="ds">
      <div className="ds-head">
        <div>
          <h1>Design: {site.name}</h1>
          <p className="fl-lede">{busy ? 'Claude is laying out the facility…' : `${mw} MW, ${cooling} cooled, on ${site.acres.toFixed(1)} acres. Laid out by ${source || '…'}; every number below is calculated from the model. Click a part to edit it.`}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ws-btn" style={{ height: 46 }} onClick={() => setSheet(true)}>Community sheet</button>
          <button className="fl-next" onClick={onNext}>Test what could change <span>→</span></button>
        </div>
      </div>
      {note && <div className="fl-error" style={{ borderRadius: 6 }}>{note}</div>}
      <div className="ds-body">
        <div className="ds-canvas">
          {layout && (
            <Canvas shadows camera={{ position: [half * 0.9, half * 0.8, half * 1.1], fov: 40, near: 1, far: 8000 }} onPointerMissed={() => setSel(null)}>
              <color attach="background" args={['#dfe3da']} />
              <hemisphereLight args={['#ffffff', '#aab3a4', mode === 'outage' ? 0.55 : 1]} />
              <directionalLight position={[200, 400, 150]} intensity={mode === 'outage' ? 0.5 : 1.3} castShadow />
              <Suspense fallback={null}><Ground aerialId={site.aerialId} half={half} /></Suspense>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><planeGeometry args={[layout.site_w, layout.site_d]} /><meshStandardMaterial color="#e8ebe3" transparent opacity={0.35} /></mesh>
              <lineLoop position={[0, 0.1, 0]}>
                <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3((a * layout.site_w) / 2, 0, (b * layout.site_d) / 2)))} />
                <lineBasicMaterial color="#264d39" />
              </lineLoop>
              {layout.components.map((c) => {
                const under = c.type === 'solar' ? layout.components.find((h) => h.type === 'data_hall' && Math.abs(h.x - c.x) < h.w / 2 && Math.abs(h.z - c.z) < h.d / 2) : undefined;
                return <Part key={c.id} c={c} selected={c.id === sel} mode={mode} load={load} baseY={under ? under.h + 0.1 : 0} onSelect={() => setSel(c.id)} />;
              })}
              <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={40} maxDistance={half * 5} />
            </Canvas>
          )}
          <div className="ds-modes">
            {([['normal', 'Normal operation'], ['event', `Grid event (ease off ${Math.round(depth * 100)}%)`], ['outage', 'Utility outage']] as const).map(([k, label]) => (
              <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{label}</button>
            ))}
          </div>
          {m && (
            <div className="ds-readout">
              {mode === 'outage'
                ? (m.backup_mw >= m.facility_mw
                  ? `Grid is down. ${m.gensets} generators supply ${m.facility_mw} MW; the battery bridges the first ${m.battery_minutes_at_full_load} min.`
                  : `Grid is down. Generators supply ${m.backup_mw} MW of the ${m.facility_mw} MW load: ${(m.facility_mw - m.backup_mw).toFixed(1)} MW short. Add generators.`)
                : `Drawing ${draw.toFixed(1)} MW from the grid${mode === 'event' ? ` (down from ${m.facility_mw} MW; flexible work is paused)` : ''}.`}
            </div>
          )}
        </div>

        <aside className="ds-side">
          <section>
            <h3>Design checks {an && <span className={failed ? 'bad' : 'ok'}>{failed ? `${failed} failing` : 'all pass'}</span>}</h3>
            {an?.checks.map((c) => (
              <div key={c.check} className={`ds-check ${c.ok ? 'ok' : 'bad'}`}><i />
                <div><b>{c.check}</b><span>{c.detail}</span></div>
              </div>
            ))}
          </section>
          {m && (
            <section>
              <h3>What this design provides <span className="ws-tag estimated">Estimated</span></h3>
              <table className="ws-kv"><tbody>
                <tr><th>IT capacity</th><td>{m.it_mw_supported} MW</td></tr>
                <tr><th>Backup generation</th><td>{m.gensets} × 2.5 MW = {m.backup_mw} MW</td></tr>
                <tr><th>Battery</th><td>{m.battery_mwh} MWh · {m.battery_minutes_at_full_load} min</td></tr>
                <tr><th>Solar</th><td>{m.solar_mwp} MWp</td></tr>
                <tr><th>Water storage</th><td>{m.water_storage_kgal}k gal</td></tr>
                <tr><th>Site covered</th><td>{Math.round(m.site_coverage * 100)}%</td></tr>
              </tbody></table>
            </section>
          )}
          {ctx && (
            <section>
              <h3>Local conditions</h3>
              <table className="ws-kv"><tbody>
                <tr><th>Climate ({ctx.climate.available ? ctx.climate.year : '—'})</th><td>{ctx.climate.available ? `${ctx.climate.mean_c} °C average · ${ctx.climate.days_above_35c} days above 35 °C · ${ctx.climate.cool_days_below_18c} cool days` : `unavailable (${ctx.climate.why})`}</td></tr>
                <tr><th>Solar yield here</th><td>{ctx.solar.available ? `${ctx.solar.mwh_per_mwp_year.toLocaleString()} MWh per MWp a year${m && m.solar_mwp ? ` → this design: ${Math.round(m.solar_mwp * ctx.solar.mwh_per_mwp_year).toLocaleString()} MWh/yr, ${(100 * m.solar_mwp * ctx.solar.mwh_per_mwp_year / (m.facility_mw * 0.8 * 8760)).toFixed(1)}% of its use` : ''}` : `unavailable (${ctx.solar.why})`}</td></tr>
                <tr><th>Households within 1 mile</th><td>{ctx.households.available ? `≈ ${ctx.households.households_within_1mi_est?.toLocaleString() ?? '—'} (estimate from census tract ${ctx.households.tract})` : ctx.households.why}</td></tr>
                <tr><th>Industrial power price</th><td>{ctx.retail_price.available ? `${ctx.retail_price.cents_per_kwh} ¢/kWh, ${ctx.retail_price.state} average, ${ctx.retail_price.period}` : `unavailable (${ctx.retail_price.why})`}</td></tr>
              </tbody></table>
              <p className="ws-note">Open-Meteo, NREL PVWatts, US Census, US EIA. The optimizer still prices energy at the ERCOT wholesale day; the retail average is shown for comparison.</p>
            </section>
          )}
          <section>
            <h3>{cur ? `Edit: ${cur.label || TYPES[cur.type].name}` : 'Edit the design'}</h3>
            {cur ? (
              <>
                <div className="ds-fields">
                  {(['x', 'z', 'w', 'd', 'h'] as const).map((k) => (
                    <label key={k}>{{ x: 'East–west (m)', z: 'North–south (m)', w: 'Width (m)', d: 'Depth (m)', h: 'Height (m)' }[k]}
                      <input type="number" step={k === 'h' ? 1 : 2} value={Math.round(cur[k] * 10) / 10} onChange={(e) => patch(cur.id, { [k]: +e.target.value } as Partial<Comp>)} />
                    </label>
                  ))}
                </div>
                <div className="ds-row">
                  <button className="ws-btn" onClick={() => patch(cur.id, { rot: cur.rot === 90 ? 0 : 90 })}><RotateCw size={13} /> Rotate</button>
                  <button className="ws-btn" onClick={() => remove(cur.id)}><Trash2 size={13} /> Remove</button>
                </div>
              </>
            ) : <p className="ws-note">Click any part of the model to move, resize, rotate or remove it. Checks update as you edit.</p>}
            <div className="ds-row">
              <select value={addType} onChange={(e) => setAddType(e.target.value as CType)}>{(Object.keys(TYPES) as CType[]).map((k) => <option key={k} value={k}>{TYPES[k].name}</option>)}</select>
              <button className="ws-btn" onClick={add}>Add</button>
            </div>
          </section>
          <section>
            <h3>Ask Claude to change it</h3>
            <textarea rows={2} placeholder="e.g. Add rooftop solar on both halls and move the generators to the north edge" value={ask} onChange={(e) => setAsk(e.target.value)} />
            <div className="ds-row">
              <button className="ws-btn primary" disabled={busy || !ask.trim()} onClick={() => void generate(ask, layout)}><Sparkles size={13} /> {busy ? 'Working…' : 'Apply'}</button>
              <button className="ws-btn" disabled={busy} onClick={() => void generate()}>Start over</button>
            </div>
            {layout?.notes.length ? <ul className="ds-notes">{layout.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
          </section>
          <p className="ws-note">A concept layout for planning, not an engineering design. The parcel is drawn as a square of the recorded acreage on the real Vexcel aerial. Sizing rules are team assumptions.</p>
        </aside>
      </div>
      {sheet && m && <CommunitySheet site={site} mw={mw} cooling={cooling} depth={depth} gensets={m.gensets} batteryMin={m.battery_minutes_at_full_load} solarMwp={m.solar_mwp} censusHouseholds={ctx?.households.available ? ctx.households.households_within_1mi_est : null} onClose={() => setSheet(false)} />}
    </main>
  );
}
