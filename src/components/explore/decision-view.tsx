'use client';
// The decision screen: what to build, where, why, against what baseline, and what would change it.
// Every figure comes from the optimizer run; nothing here is computed by a language model.
import { useEffect, useRef, useState } from 'react';
import { Activity, MapPin, Volume2, VolumeX } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { Combo, OptimizeResult } from './optimize-types';
import type { ExploreSite } from './types';
import { fmtMoney, fmtNum } from './types';

const COOL: Record<string, string> = { air: 'Air cooled', hybrid: 'Hybrid cooled', water: 'Water cooled' };
const signed = (n: number, f: (x: number) => string) => `${n >= 0 ? '−' : '+'}${f(Math.abs(n))}`;

function drivers(run: OptimizeResult): string[] {
  const o = run.optimized, b = run.baseline, inf = run.inflexible;
  if (!o) return [];
  const out: string[] = [];
  const gated = new Set(run.rejected.map((r) => r.parcel_id)).size;
  out.push(`It passes all screening checks. ${gated} other ${gated === 1 ? 'property was' : 'properties were'} excluded by a pass/fail gate (homes, flood or water), whatever their price.`);
  if (inf !== undefined && (!inf || inf.site_id !== o.site_id)) {
    out.push(inf
      ? `It only works because ${Math.round((run.request?.flexible_share ?? 0) * 100)}% of the load is flexible: it cuts ${Math.round(o.d * 100)}% of load in grid-stress hours. Operated inflexibly, the best option is ${inf.site_name} at ${fmtMoney(inf.cost - o.cost)} more over 10 years.`
      : `It only works because the load is flexible (cuts ${Math.round(o.d * 100)}% in grid-stress hours). Operated inflexibly, no site meets the power scenario.`);
  }
  if (b && b.site_id !== o.site_id) {
    const parts: [string, number][] = [
      ['land', b.land - o.land],
      ['grid connection (scenario)', (b.interconnect ?? 0) - (o.interconnect ?? 0)],
      ['10-year operating cost', (b.cost - b.capex) - (o.cost - o.capex)],
    ];
    parts.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
    const [name, diff] = parts[0];
    out.push(`Against the cost-first choice (${b.site_name}), the biggest difference is ${name}: ${fmtMoney(Math.abs(diff))} ${diff >= 0 ? 'lower' : 'higher'} here. Total 10-year cost is ${fmtMoney(Math.abs(b.cost - o.cost))} ${b.cost >= o.cost ? 'lower' : 'higher'}.`);
  } else if (b && run.delta) {
    out.push(`Cost-first planning picks the same property. The difference is the operating plan: flexible work runs in cheaper, cleaner hours, for ${signed(run.delta.co2_est_t_year, (x) => `${fmtNum(x)} t`)} CO₂ a year and ${signed(run.delta.cost, fmtMoney)} over 10 years.`);
  }
  return out.slice(0, 3);
}

async function speak(text: string, audioRef: React.MutableRefObject<HTMLAudioElement | null>): Promise<string> {
  try {
    const r = await fetch(`${PUBLIC_DATA_API}/voice/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (r.ok) {
      const a = new Audio(URL.createObjectURL(await r.blob()));
      audioRef.current = a;
      await a.play();
      return 'ElevenLabs voice';
    }
  } catch { /* fall through */ }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    return 'Browser voice (no ElevenLabs key set)';
  }
  return 'No voice available';
}

export function DecisionView({ run, sites, mw, busy, changedFrom, hideExtras = false, onWhatIf, onOpenSite, onLive }: {
  run: OptimizeResult | null; sites: ExploreSite[]; mw: number; busy: boolean; changedFrom: string | null; hideExtras?: boolean;
  onWhatIf: (c: Record<string, unknown>) => void; onOpenSite: (id: string) => void; onLive: () => void;
}) {
  const req = run?.request;
  const o = run?.optimized ?? null;
  const [priceX, setPriceX] = useState(1);
  const [carbonP, setCarbonP] = useState(50);
  const [flexPct, setFlexPct] = useState(30);
  const [firmPct, setFirmPct] = useState(100);
  const [voice, setVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    setPriceX(req?.price_multiplier ?? 1);
    setCarbonP(req?.carbon_price_per_t ?? 50);
    setFlexPct(Math.round((req?.flexible_share ?? 0.3) * 100));
    setFirmPct(Math.round((o ? (req?.firm_capacity?.[o.site_id] ?? o.firm_capacity_share) : 1) * 100));
  }, [run?.run_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!run) return <div className="dv"><p className="ws-note">Screening properties and running the optimizer…</p></div>;
  if (!o) return <div className="dv"><h1>No feasible development plan</h1><p>No property meets the gates and the power scenario for {mw} MW. Relax a threshold or lower the capacity, then run again.</p></div>;

  const b = run.baseline, inf = run.inflexible, d = run.delta;
  const site = sites.find((s) => s.id === o.site_id);
  const why = drivers(run);
  const cols: [string, Combo | null | undefined][] = [['Cost-first planning', b], ['PlotStar (joint optimization)', o]];
  if (inf !== undefined) cols.push(['Without flexibility', inf]);
  const row = (label: string, f: (c: Combo) => string, tag: string) => (
    <tr><td>{label} <span className={`ws-tag ${tag.toLowerCase()}`}>{tag}</span></td>{cols.map(([k, c]) => <td key={k} className="ws-num">{c ? f(c) : 'not feasible'}</td>)}</tr>
  );

  async function readAloud() {
    if (voice) { audioRef.current?.pause(); window.speechSynthesis?.cancel(); setVoice(null); return; }
    setVoice('Loading…');
    let text = why.join(' ');
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/agent/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: run!.run_id }) });
      if (r.ok) text = (await r.json()).answer || text;
    } catch { /* keep local text */ }
    setVoice(await speak(text, audioRef));
  }

  return (
    <div className="dv">
      {changedFrom && <div className="ws-flip" style={{ borderRadius: 6, border: '1px solid #c9dccb' }}>The recommendation changed: it was {changedFrom}, it is now {o.site_name}.</div>}
      <div className="dv-head">
        <div>
          <small>Our recommendation for {mw} MW</small>
          <h1>{o.site_name}</h1>
          <p>{site?.area ?? ''}{site?.lotAcres ? ` · ${fmtNum(site.lotAcres, 1)} acres` : ''} · {COOL[o.cooling]} · {o.f > 0 ? `cuts ${Math.round(o.d * 100)}% of load for about ${Math.round(o.f * 8760)} hours a year` : 'runs at full power all year'}</p>
        </div>
        <div className="dv-head-actions">
          <button className="ws-btn" onClick={() => onOpenSite(o.site_id)}><MapPin size={13} /> Open site</button>
          <button className="ws-btn" onClick={() => void readAloud()}>{voice ? <VolumeX size={13} /> : <Volume2 size={13} />} {voice ? 'Stop' : 'Read aloud'}</button>
        </div>
      </div>
      {voice && voice !== 'Loading…' && <p className="ws-note">{voice}</p>}

      <div className="dv-kpis">
        <div><small>10-year cost</small><b>{fmtMoney(o.cost)}</b><span>Modeled</span></div>
        <div><small>vs cost-first</small><b className={d && d.cost < 0 ? 'neg' : 'pos'}>{d ? signed(d.cost, fmtMoney) : '—'}</b><span>{d?.same_site ? 'same property' : b ? `instead of ${b.site_name}` : 'no cost-first option'}</span></div>
        <div><small>CO₂ per year</small><b className={d && d.co2_est_t_year < 0 ? 'neg' : 'pos'}>{d ? signed(d.co2_est_t_year, (x) => `${fmtNum(x)} t`) : '—'}</b><span>Modeled</span></div>
        <div><small>Load at grid peak</small><b className={d && d.peak_mw < 0 ? 'neg' : 'pos'}>{d ? signed(d.peak_mw, (x) => `${fmtNum(x, 1)} MW`) : '—'}</b><span>Modeled</span></div>
        <div className="warn"><small>Grid connection</small><b>Unverified</b><span>utility study required</span></div>
      </div>

      <section>
        <h2>Why this recommendation</h2>
        <ol className="dv-why">{why.map((w, i) => <li key={i}>{w}</li>)}</ol>
      </section>

      <section>
        <h2>Cost-first planning vs PlotStar</h2>
        <table className="ws-compare">
          <thead><tr><th></th>{cols.map(([k]) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>
            {row('Property', (c) => c.site_name, 'Sourced')}
            {row('Land acquisition', (c) => fmtMoney(c.land), 'Estimated')}
            {row('Total capex', (c) => fmtMoney(c.capex), 'Modeled')}
            {row('Energy cost per year', (c) => fmtMoney(c.energy_cost_year), 'Modeled')}
            {row('10-year lifecycle cost', (c) => fmtMoney(c.cost), 'Modeled')}
            {row('Load at grid peak', (c) => `${fmtNum(c.peak_mw, 1)} MW`, 'Modeled')}
            {row('CO₂ per year', (c) => `${fmtNum(c.co2_est_t_year)} t`, 'Modeled')}
            {row('Water per year', (c) => `${fmtNum(c.water_gal_year / 1e6, 1)} M gal`, 'Modeled')}
            {row('Cooling', (c) => COOL[c.cooling], 'Modeled')}
            {row('Curtailment needed', (c) => (c.f > 0 ? `${Math.round(c.d * 100)}% for ~${Math.round(c.f * 8760)} h/yr` : 'none'), 'Modeled')}
            {row('Firm grid capacity', (c) => `${Math.round(c.firm_capacity_share * 100)}% of request`, 'Simulated')}
          </tbody>
        </table>
        <p className="ws-note">All three use the same properties, gates, capacity and 10-year horizon. Land is CoStar asking or sale price where recorded, otherwise an estimate from the market median. Costs use the editable assumptions sheet. Firm grid capacity is a scenario: a nearby substation does not show that power is available.</p>
      </section>

      {!hideExtras && (<>
      <section>
        <h2>What would change this decision</h2>
        <div className="dv-controls">
          <label>Electricity price ×<input type="number" min={0.5} max={3} step={0.1} value={priceX} onChange={(e) => setPriceX(+e.target.value)} /></label>
          <label>Carbon price $/t<input type="number" min={0} max={300} step={10} value={carbonP} onChange={(e) => setCarbonP(+e.target.value)} /></label>
          <label>Flexible load %<input type="number" min={0} max={80} step={5} value={flexPct} onChange={(e) => setFlexPct(+e.target.value)} /></label>
          <label>Utility firm capacity at this site %<input type="number" min={20} max={100} step={5} value={firmPct} onChange={(e) => setFirmPct(+e.target.value)} /></label>
          <button className="ws-btn primary" disabled={busy} onClick={() => onWhatIf({ price_multiplier: priceX, carbon_price_per_t: carbonP, flexible_share: flexPct / 100, firm_capacity: { ...(req?.firm_capacity ?? {}), [o.site_id]: firmPct / 100 } })}>{busy ? 'Recalculating…' : 'Recalculate'}</button>
        </div>
        <p className="ws-note">Each change re-runs the optimizer on every property (about a second). Flexible load is the share of computing that can be delayed within the day; it does not mean total demand can always drop by that much. Try a utility offer of 70% at this site, with and without flexible load.</p>
      </section>

      <section className="dv-validate">
        <div><h2>Validate the operating plan</h2><p className="ws-note">The test machines follow this plan&apos;s hourly schedule. A grid event asks for {o.d > 0 ? `the ${Math.round(o.d * 100)}% cut this plan relies on` : 'a 30% cut (this plan needs none; the test shows the capability)'}. The hardware shows a workload can respond to a control signal. It does not show that a utility will approve the connection.</p></div>
        <button className="ws-btn primary" onClick={onLive}><Activity size={13} /> Open live grid test</button>
      </section>
      </>)}
    </div>
  );
}
