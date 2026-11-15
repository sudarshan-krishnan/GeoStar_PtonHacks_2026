'use client';
// Guided flow: one question per screen, one primary button. Same backend as before.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Brand } from '../brand';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import { DecisionView } from './decision-view';
import { DesignStep, type DesignSite } from './design-step';
import type { MapMode } from './explore-map';
import { AssumptionsDrawer } from './drawers';
import { AgentDrawer } from './agent-drawer';
import type { OptimizeResult } from './optimize-types';
import { SiteDetail } from './site-detail';
import type { ExploreSite } from './types';
import { fmtMoney, fmtNum, verdict } from './types';

const ExploreMap = dynamic(() => import('./explore-map'), { ssr: false, loading: () => <div className="xp-map xp-loading">Loading map…</div> });
const Site3D = dynamic(() => import('./site-3d'), { ssr: false, loading: () => <div className="xp-map xp-loading">Loading 3D…</div> });
const Meters = dynamic(() => import('./meters').then((m) => m.Meters), { ssr: false });

interface SearchResult { count: number; counts: { Pass: number; 'Needs review': number; Fail: number }; sites: Omit<ExploreSite, 'letter'>[] }
const STEPS = ['Your project', 'Sites', 'Recommendation', 'Design', 'What if', 'Live test'];

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${PUBLIC_DATA_API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed (${r.status})`);
  return r.json();
}

export function Flow() {
  const [step, setStep] = useState(0);
  // step 1
  const [market, setMarket] = useState<'Houston' | 'Los Angeles'>('Houston');
  const [mw, setMw] = useState(20);
  const [flex, setFlex] = useState(30);
  const [homesM, setHomesM] = useState(300);
  const [minAcres, setMinAcres] = useState(2);
  const [advanced, setAdvanced] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [showAssump, setShowAssump] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  // data
  const [result, setResult] = useState<SearchResult | null>(null);
  const [baseRun, setBaseRun] = useState<OptimizeResult | null>(null);
  const [run, setRun] = useState<OptimizeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // step 2
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'good' | 'bad'>('all');
  const [view3d, setView3d] = useState(false);
  const [mode, setMode] = useState<MapMode>('browse');
  const [ring, setRing] = useState<[number, number][] | null>(null);
  const [pinAcres, setPinAcres] = useState(20);
  const [custom, setCustom] = useState<ExploreSite[]>([]);
  const [accepted, setAccepted] = useState<DesignSite | null>(null);
  // step 3
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // step 4
  const [firm70, setFirm70] = useState(false);
  const [noFlex, setNoFlex] = useState(false);
  const [price30, setPrice30] = useState(false);

  const thresholds = useMemo(() => ({ min_home_distance_m: homesM }), [homesM]);
  const optimizeReq = useMemo(() => ({ market, min_acres: minAcres, thresholds, mw_it: mw, flexible_share: flex / 100, carbon_price_per_t: 50, assumptions: overrides, limit: 150, offline: true }), [market, minAcres, thresholds, mw, flex, overrides]);

  const findSites = useCallback(async () => {
    setBusy(true); setError(null); setSelectedId(null); setAnswer(null); setFirm70(false); setNoFlex(false); setPrice30(false);
    try {
      const d = await post<SearchResult>('/search', { market, thresholds, assumptions: overrides, filters: { min_acres: minAcres || null }, limit: 150 });
      setResult(d);
      const r = await post<OptimizeResult>('/optimize', optimizeReq);
      const full = { ...r, request: optimizeReq };
      setBaseRun(full); setRun(full);
      setStep(1);
    } catch (e) {
      setError((e as Error).message.includes('fetch') ? `Can't reach the PlotStar data service at ${PUBLIC_DATA_API}. Start it and try again.` : (e as Error).message);
    } finally { setBusy(false); }
  }, [market, thresholds, overrides, minAcres, optimizeReq]);

  // step 4: every toggle re-runs the optimizer from the original run
  const basePick = baseRun?.optimized?.site_id;
  useEffect(() => {
    if (!baseRun || step !== 4) return;
    if (!firm70 && !noFlex && !price30) { setRun(baseRun); return; }
    let alive = true;
    setBusy(true);
    const changes = { firm_capacity: firm70 && basePick ? { [basePick]: 0.7 } : {}, flexible_share: noFlex ? 0 : flex / 100, price_multiplier: price30 ? 1.3 : 1 };
    post<OptimizeResult>('/scenarios/run', { run_id: baseRun.run_id, changes })
      .then((r) => alive && setRun({ ...r, request: { ...baseRun.request, ...changes } }))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [firm70, noFlex, price30, step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (run?.run_id) void post('/livegrid/plan', { run_id: run.run_id }).catch(() => {}); }, [run?.run_id]);

  const sites: ExploreSite[] = useMemo(() => [...custom, ...(result?.sites ?? []).map((s, i) => ({ ...s, letter: String(i + 1) }) as ExploreSite)], [result, custom]);
  const selected = sites.find((s) => s.id === selectedId) ?? null;
  const listed = sites.filter((s) => show === 'all' || (show === 'bad' ? s.screen?.status === 'Fail' : s.screen?.status !== 'Fail'));
  const c = result?.counts;

  // a location the user picked or drew: screened with the same gates as CoStar properties
  async function addCustom(lat: number, lng: number, acres: number, label: string) {
    setMode('browse'); setBusy(true);
    try {
      const d = await post<{ id: string; screen: ExploreSite['screen'] }>('/sites/evaluate', { lat, lon: lng, acres, market, thresholds, name: label });
      const s = { id: d.id, name: label, area: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, lotAcres: acres, landCost: 0, screen: d.screen, letter: '★', source: 'user',
        pillars: { money: 0, people: 0, planet: 0, overall: 0 }, supportableMw: acres, width: 0, depth: 0, metrics: {}, risks: [], context: '', provenance: 'Location chosen by the user; no CoStar record.', amenities: { schools: 0, restaurants: 0, parks: 0, transit: 0, population: 0 } } as unknown as ExploreSite;
      setCustom((c) => [s, ...c.filter((x) => x.id !== s.id)]); setSelectedId(s.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function onRing(r: [number, number][] | null) {
    setRing(r); setMode('browse');
    if (!r || r.length < 3) return;
    const lat0 = r.reduce((a, p) => a + p[1], 0) / r.length, lng0 = r.reduce((a, p) => a + p[0], 0) / r.length;
    const pts = r.map(([lo, la]) => [(lo - lng0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (la - lat0) * 110540]);
    let a2 = 0;
    pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; a2 += x * y2 - x2 * y; });
    void addCustom(lat0, lng0, Math.max(0.5, Math.abs(a2) / 2 / 4046.86), 'My drawn area');
  }
  function accept(s: ExploreSite | null) {
    const pick = s ?? sites.find((x) => x.id === baseRun?.optimized?.site_id) ?? null;
    if (!pick) return;
    setAccepted({ id: pick.id, name: pick.name, lat: pick.lat, lng: pick.lng, acres: pick.lotAcres ?? 10, aerialId: pick.parcelId ?? `pt:${pick.lat.toFixed(6)},${pick.lng.toFixed(6)}`, screen: pick.screen });
    setStep(3);
  }
  const planFor = (id: string | undefined) => {
    const mine = (run?.combinations ?? []).filter((x) => x.site_id === id);
    return mine.length ? mine.reduce((a, b2) => (a.cost <= b2.cost ? a : b2)) : null;
  };

  async function ask() {
    if (!run) return;
    setAsking(true); setAnswer(null);
    try {
      const r = await post<{ answer: string; model: string; trace: { tool: string; args?: unknown }[] }>('/agent/explain', { run_id: run.run_id, question: question || null });
      const used = r.trace.map((t) => (t.tool === 'run_what_if' ? `re-ran the optimizer (${JSON.stringify((t.args as { changes_json?: string })?.changes_json ?? t.args)})` : t.tool)).join(' → ');
      setAnswer(`${r.answer}\n\n— ${r.model === 'deterministic' ? 'Built from the optimizer outputs (no model).' : `LangChain agent (${r.model}).`} Tools used: ${used || 'none'}`);
    } catch { setAnswer('The explainer is not reachable.'); } finally { setAsking(false); }
  }

  const o = run?.optimized, b0 = baseRun?.optimized;
  const moved = o && b0 && o.site_id !== b0.site_id;

  return (
    <div className="fl">
      <header className="fl-top">
        <Brand />
        <ol className="fl-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} onClick={() => (i < step || (i > 0 && run)) && setStep(i)}>
              <span>{i < step ? <Check size={12} /> : i + 1}</span>{s}
            </li>
          ))}
        </ol>
        <Link href="/dashboard-2" className="ws-btn">Open Dashboard 2</Link>
        <button className="ws-btn primary" onClick={() => setShowAgent(true)}>Ask the agent</button>
      </header>
      {error && <div className="fl-error">{error}</div>}

      {step === 0 && (
        <main className="fl-narrow">
          <h1>What do you want to build?</h1>
          <p className="fl-lede">PlotStar checks every real CoStar property in the city, rules out the ones that would harm neighbours or flood, and recommends where to build and how to run it.</p>
          <label className="fl-q"><b>City</b>
            <select value={market} onChange={(e) => setMarket(e.target.value as typeof market)}><option>Houston</option><option>Los Angeles</option></select>
          </label>
          <label className="fl-q"><b>Data center size: {mw} MW</b>
            <input type="range" min={5} max={100} step={5} value={mw} onChange={(e) => setMw(+e.target.value)} />
            <small>The computing power you need. 20 MW is a mid-size facility.</small>
          </label>
          <label className="fl-q"><b>Work that can wait: {flex}%</b>
            <input type="range" min={0} max={60} step={5} value={flex} onChange={(e) => setFlex(+e.target.value)} />
            <small>The share of computing (AI training, batch jobs) that can be delayed a few hours. It lets the facility ease off when the grid is stressed.</small>
          </label>
          <button className="fl-link" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'Show'} advanced settings</button>
          {advanced && (
            <div className="fl-adv">
              <label>Keep at least <input type="number" min={0} step={50} value={homesM} onChange={(e) => setHomesM(+e.target.value)} /> m from homes</label>
              <label>Lot at least <input type="number" min={0} step={1} value={minAcres} onChange={(e) => setMinAcres(+e.target.value)} /> acres</label>
              <button className="ws-btn" onClick={() => setShowAssump(true)}>Edit cost assumptions{Object.keys(overrides).length ? ` (${Object.keys(overrides).length} changed)` : ''}</button>
            </div>
          )}
          <button className="fl-next" onClick={() => void findSites()} disabled={busy}>{busy ? 'Checking every property…' : 'Find sites'} <ArrowRight size={16} /></button>
        </main>
      )}

      {step === 1 && result && (
        <main className="fl-wide">
          <div className="fl-titlebar">
            <div>
              <h1>We checked {result.count} properties in {market}</h1>
              <p className="fl-lede">{c!.Pass + c!['Needs review']} could work. {c!.Fail} are ruled out because they are too close to homes or in a flood zone. Click any property to see why.</p>
            </div>
            <button className="fl-next" onClick={() => setStep(2)}>See the recommendation <ArrowRight size={16} /></button>
          </div>
          <div className="fl-split">
            <div className="ws-stage" style={{ flex: 1, minHeight: 0, border: '1px solid var(--ws-line)', borderRadius: 8, overflow: 'hidden' }}>
              {view3d && selected?.parcelId ? (
                <Site3D key={selected.id} parcelId={selected.parcelId} lat={selected.lat} lng={selected.lng} mw={mw} acres={selected.lotAcres ?? null} />
              ) : (
                <ExploreMap market={market} sites={sites} selectedId={selectedId} pickId={run?.optimized?.site_id ?? null} onSelect={(id) => (setSelectedId(id), setView3d(false))} mode={mode} polygon={ring} onPolygon={onRing} onPin={(lng, lat) => void addCustom(lat, lng, pinAcres, 'My chosen spot')} basemap="map" />
              )}
              <div className="fl-own">
                <b>Or choose your own:</b>
                <button className={mode === 'pin' ? 'on' : ''} onClick={() => (setView3d(false), setMode(mode === 'pin' ? 'browse' : 'pin'))}>Click a spot</button>
                <label>of <input type="number" min={1} max={500} value={pinAcres} onChange={(e) => setPinAcres(+e.target.value || 1)} /> acres</label>
                <button className={mode === 'draw' ? 'on' : ''} onClick={() => (setView3d(false), setMode(mode === 'draw' ? 'browse' : 'draw'))}>Draw an area</button>
              </div>
              <div className="ws-legend" style={{ top: 'auto', bottom: 34 }}><span><i style={{ background: 'var(--ws-ok)' }} />Could work</span><span><i style={{ background: 'var(--ws-warn)' }} />Needs a closer look</span><span><i style={{ background: 'var(--ws-bad)' }} />Ruled out</span></div>
            </div>
            <aside className="fl-side">
              {selected ? (
                <>
                  <button className="fl-back" onClick={() => (setSelectedId(null), setView3d(false))}><ArrowLeft size={13} /> All properties</button>
                  {selected.screen?.status === 'Fail'
                    ? <div className="fl-accept no">This location fails a check, so it can&apos;t be accepted: {verdict(selected).reason}.</div>
                    : <button className="fl-next fl-accept" onClick={() => accept(selected)}>Accept this site and design it <ArrowRight size={16} /></button>}
                  {selected.source === ('user' as unknown) ? (
                    <div className="fl-custom">
                      <h2>{selected.name}</h2>
                      <p>{selected.area} · {fmtNum(selected.lotAcres, 1)} acres · your own location (no CoStar record or price)</p>
                      {selected.screen?.gates.map((g) => (
                        <div key={g.gate} className={`ds-check ${g.status === 'Pass' ? 'ok' : g.status === 'Fail' ? 'bad' : 'warn'}`}><i /><div><b>{g.gate}: {g.status}</b><span>{g.reason}</span></div></div>
                      ))}
                    </div>
                  ) : (
                    <SiteDetail site={selected} mw={mw} run={run} runBusy={busy} onWhatIf={() => {}} onOpen3d={() => setView3d(true)} onClose={() => (setSelectedId(null), setView3d(false))} />
                  )}
                </>
              ) : (
                <>
                  <div className="fl-filter">
                    {([['all', `All ${result.count}`], ['good', `Could work ${c!.Pass + c!['Needs review']}`], ['bad', `Ruled out ${c!.Fail}`]] as const).map(([k, label]) => (
                      <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{label}</button>
                    ))}
                  </div>
                  {listed.map((s) => {
                    const v = verdict(s);
                    return (
                      <button key={s.id} className="fl-row" onClick={() => setSelectedId(s.id)}>
                        <i className={v.tone} />
                        <div>
                          <b>{s.name}{s.id === run?.optimized?.site_id ? ' · recommended' : ''}</b>
                          <span>{fmtNum(s.lotAcres, 1)} acres · {fmtMoney(s.landCost)} · {v.reason}</span>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </aside>
          </div>
        </main>
      )}

      {step === 2 && (
        <main className="fl-doc">
          <div className="fl-stage">
            <DecisionView run={baseRun} sites={sites} mw={mw} busy={busy} changedFrom={null} hideExtras onWhatIf={() => {}} onOpenSite={(id) => (setSelectedId(id), setStep(1))} onLive={() => setStep(5)} />
          </div>
          <div className="fl-footer">
            <div className="fl-ask">
              <input placeholder="Ask about this decision, e.g. Why not the cheapest site?" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ask()} />
              <button className="ws-btn" onClick={() => void ask()} disabled={asking}>{asking ? 'Thinking…' : 'Ask'}</button>
            </div>
            <button className="fl-next" onClick={() => accept(null)}>Design this site <ArrowRight size={16} /></button>
          </div>
          {answer && <div className="fl-answer">{answer}</div>}
        </main>
      )}

      {step === 3 && accepted && (
        <DesignStep site={accepted} mw={mw} cooling={(planFor(accepted.id)?.cooling ?? 'air') as 'air' | 'hybrid' | 'water'} depth={planFor(accepted.id)?.d || 0.3} onNext={() => setStep(4)} />
      )}
      {step === 3 && !accepted && <main className="fl-narrow"><h1>Pick a site first</h1><p className="fl-lede">Accept a site in step 2, or use the recommendation.</p><button className="fl-next" onClick={() => accept(null)}>Use the recommended site</button></main>}

      {step === 4 && baseRun && (
        <main className="fl-narrow wide">
          <h1>What could change this decision?</h1>
          <p className="fl-lede">Switch a condition on. PlotStar recalculates every property and tells you if the recommendation moves.</p>
          <div className="fl-toggles">
            <label className={firm70 ? 'on' : ''}><input type="checkbox" checked={firm70} onChange={(e) => setFirm70(e.target.checked)} /><div><b>The utility can only supply 70% of the power</b><span>At the recommended site. The rest must be covered by easing off in grid-stress hours.</span></div></label>
            <label className={noFlex ? 'on' : ''}><input type="checkbox" checked={noFlex} onChange={(e) => setNoFlex(e.target.checked)} /><div><b>None of the work can wait</b><span>The facility must run at full power all the time.</span></div></label>
            <label className={price30 ? 'on' : ''}><input type="checkbox" checked={price30} onChange={(e) => setPrice30(e.target.checked)} /><div><b>Electricity costs 30% more</b><span>Every hour of the ERCOT day is 30% dearer.</span></div></label>
          </div>
          <div className={`fl-outcome ${moved ? 'moved' : ''}`}>
            {busy ? <b>Recalculating…</b> : !o ? (
              <><small>Result</small><b>No property works under these conditions</b><span>Every option needs flexibility or more power than is available.</span></>
            ) : (
              <>
                <small>{moved ? 'The recommendation moved' : firm70 || noFlex || price30 ? 'The recommendation holds' : 'Current recommendation'}</small>
                <b>{o.site_name}</b>
                <span>
                  {fmtMoney(o.cost)} over 10 years{b0 && run !== baseRun ? ` (was ${fmtMoney(b0.cost)}${moved ? ` at ${b0.site_name}` : ''})` : ''}.
                  {o.f > 0 ? ` It eases off ${Math.round(o.d * 100)}% of load for about ${Math.round(o.f * 8760)} hours a year.` : ' It runs at full power all year.'}
                </span>
              </>
            )}
          </div>
          <p className="fl-lede small">Try this: switch on the 70% limit (the site still works, by easing off). Then also switch on &quot;none of the work can wait&quot;: the site stops working and the recommendation moves. The 70% is a scenario; only the utility can confirm real capacity.</p>
          <div className="fl-footer plain">
            <button className="fl-back" onClick={() => setStep(3)}><ArrowLeft size={13} /> Design</button>
            <button className="fl-next" onClick={() => setStep(5)}>Test it on real machines <ArrowRight size={16} /></button>
          </div>
        </main>
      )}

      {step === 5 && (
        <main className="fl-doc">
          <div className="fl-stage"><Meters priceDate={run?.grid.price_date} /></div>
          <div className="fl-footer plain"><button className="fl-back" onClick={() => setStep(4)}><ArrowLeft size={13} /> What if</button><span className="ws-note">This test uses the plan from the previous step{o ? ` (${o.site_name})` : ''}.</span></div>
        </main>
      )}

      {showAgent && <AgentDrawer runId={run?.run_id ?? null} onClose={() => setShowAgent(false)} />}
      {showAssump && <AssumptionsDrawer overrides={overrides} onApply={(v) => (setOverrides(v), setShowAssump(false))} onClose={() => setShowAssump(false)} />}
    </div>
  );
}
