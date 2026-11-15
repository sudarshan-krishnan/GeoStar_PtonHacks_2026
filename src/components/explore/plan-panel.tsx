'use client';
// Operating plan for one site (from the joint optimizer) and the optimization result strip.
import { useEffect, useState } from 'react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { Combo, OptimizeResult } from './optimize-types';
import { fmtMoney, fmtNum } from './types';

const COOL: Record<string, string> = { air: 'Air', hybrid: 'Hybrid', water: 'Water' };
const hourLabel = (h: number) => (h === 0 ? '00' : String(h).padStart(2, '0'));

export function bestPlanFor(run: OptimizeResult | null, siteId: string): Combo | null {
  if (!run) return null;
  const mine = run.combinations.filter((c) => c.site_id === siteId);
  return mine.length ? mine.reduce((a, b) => (a.cost <= b.cost ? a : b)) : null;
}

/** Price ($/MWh, bars), carbon (kg/MWh, line) and the site's hourly grid load (MW, bars) with axes. */
export function DayChart({ run, plan, baseline }: { run: OptimizeResult; plan: Combo; baseline?: Combo | null }) {
  const price = run.grid.price, carbon = run.grid.carbon, sched = plan.schedule;
  const W = 372, L = 34, R = 34, T = 8, h1 = 86, gap = 22, h2 = 86, B = 18;
  const H = T + h1 + gap + h2 + B;
  const cw = (W - L - R) / 24;
  const pMax = Math.max(...price) * 1.1, cMax = Math.max(...carbon) * 1.1;
  const sMax = Math.max(...sched, ...(baseline?.schedule ?? []), 1) * 1.1;
  const y1 = (v: number, max: number) => T + h1 - (v / max) * h1;
  const y2 = (v: number) => T + h1 + gap + h2 - (v / sMax) * h2;
  const stress = new Set(plan.stress_hours);
  const carbonPath = carbon.map((c, h) => `${h === 0 ? 'M' : 'L'}${L + h * cw + cw / 2},${y1(c, cMax)}`).join(' ');
  const basePath = baseline ? baseline.schedule.map((m, h) => `${h === 0 ? 'M' : 'L'}${L + h * cw + cw / 2},${y2(m)}`).join(' ') : '';
  const tick = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ws-chart" role="img" aria-label="Hourly grid price, carbon intensity and site load">
      {/* grid price bars */}
      {price.map((p, h) => (
        <rect key={h} x={L + h * cw + 1} y={y1(p, pMax)} width={cw - 2} height={T + h1 - y1(p, pMax)} fill="#c9d3c4" />
      ))}
      <path d={carbonPath} fill="none" stroke="#8a5a2b" strokeWidth="1.5" />
      <text x={L - 4} y={T + 8} fontSize="8" textAnchor="end" fill="#76807a">{tick(pMax / 1.1)}</text>
      <text x={L - 4} y={T + h1} fontSize="8" textAnchor="end" fill="#76807a">0</text>
      <text x={L - 4} y={T + h1 / 2} fontSize="7.5" textAnchor="end" fill="#76807a">$/MWh</text>
      <text x={W - R + 4} y={T + 8} fontSize="8" fill="#8a5a2b">{tick(cMax / 1.1)}</text>
      <text x={W - R + 4} y={T + h1 / 2} fontSize="7.5" fill="#8a5a2b">kg/MWh</text>
      {/* site load */}
      {sched.map((m, h) => (
        <rect key={h} x={L + h * cw + 1} y={y2(m)} width={cw - 2} height={T + h1 + gap + h2 - y2(m)} fill={stress.has(h) ? '#b3362b' : '#264d39'} />
      ))}
      {baseline && <path d={basePath} fill="none" stroke="#76807a" strokeWidth="1.2" strokeDasharray="3 2" />}
      <text x={L - 4} y={T + h1 + gap + 8} fontSize="8" textAnchor="end" fill="#76807a">{tick(sMax / 1.1)}</text>
      <text x={L - 4} y={T + h1 + gap + h2} fontSize="8" textAnchor="end" fill="#76807a">0</text>
      <text x={L - 4} y={T + h1 + gap + h2 / 2} fontSize="7.5" textAnchor="end" fill="#76807a">MW</text>
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={L + h * cw + cw / 2} y={H - 4} fontSize="8" textAnchor="middle" fill="#76807a">{hourLabel(h)}</text>
      ))}
      <line x1={L} x2={W - R} y1={T + h1 + 0.5} y2={T + h1 + 0.5} stroke="#dde1d8" />
      <line x1={L} x2={W - R} y1={T + h1 + gap + h2 + 0.5} y2={T + h1 + gap + h2 + 0.5} stroke="#dde1d8" />
    </svg>
  );
}

export function PlanPanel({ run, siteId, mw, busy, onWhatIf }: { run: OptimizeResult | null; siteId: string; mw: number; busy: boolean; onWhatIf: (c: Record<string, number>) => void }) {
  const [priceX, setPriceX] = useState(run?.request?.price_multiplier ?? 1);
  const [carbonP, setCarbonP] = useState(run?.request?.carbon_price_per_t ?? 50);
  const firmNow = () => Math.round((run?.request?.firm_capacity?.[siteId] ?? bestPlanFor(run, siteId)?.firm_capacity_share ?? 1) * 100);
  const [firmPct, setFirmPct] = useState(firmNow());
  useEffect(() => {
    setPriceX(run?.request?.price_multiplier ?? 1);
    setCarbonP(run?.request?.carbon_price_per_t ?? 50);
    setFirmPct(firmNow());
  }, [run?.run_id, siteId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!run) return <div className="ws-block"><h3>Operating plan</h3><p className="ws-note">Optimizer has not run for this search yet.</p></div>;
  const plan = bestPlanFor(run, siteId);
  const base = run.baseline;
  const reasons = Array.from(new Set(run.infeasible.filter((x) => x.site_id === siteId).map((x) => x.reason)));
  const d = (a: number, b: number | undefined, f: (n: number) => string, lowerBetter = true) =>
    b == null ? null : { text: `${a <= b ? '−' : '+'}${f(Math.abs(b - a))}`, good: lowerBetter ? a <= b : a >= b };

  return (
    <div className="ws-block">
      <div className="ws-block-head"><h3>Operating plan · {mw} MW IT</h3><span className="ws-tag estimated">Estimated</span></div>
      {!plan ? (
        <div className="ws-warnbox"><b>Not feasible at {mw} MW.</b> {reasons.slice(0, 3).join(' ')}</div>
      ) : (
        <>
          <table className="ws-kv">
            <tbody>
              <tr><th>Cooling</th><td>{COOL[plan.cooling]} · PUE {plan.pue}</td></tr>
              <tr><th>Flexibility</th><td>{plan.f > 0 ? `${(plan.f * 100).toFixed(2)}% of hours · ${Math.round(plan.d * 100)}% depth` : 'none required'}</td></tr>
              <tr><th>Firm capacity scenario</th><td>{Math.round(plan.firm_capacity_share * 100)}% of request <span className="ws-tag simulated">Simulated</span></td></tr>
              <tr><th>Interconnection scenario</th><td>{fmtMoney(plan.capex - plan.land - 0)} total capex incl. land</td></tr>
            </tbody>
          </table>
          <DayChart run={run} plan={plan} baseline={base} />
          <p className="ws-note">Top: ERCOT {run.grid.hub} day-ahead price {run.grid.price_date} (bars, {run.grid.price_label}) and fuel-mix carbon (line, {run.grid.carbon_label}). Bottom: this site&apos;s hourly grid load; red = stress hours it curtails; dashed = cost-first flat schedule.</p>
          <div className="ws-plan-nums">
            {(() => { const x = d(plan.energy_cost_year, base?.energy_cost_year, (n) => fmtMoney(n)); return (<div><small>Energy cost / yr</small><b>{fmtMoney(plan.energy_cost_year)}</b>{x && <span className={x.good ? 'good' : 'bad'}>{x.text} vs cost-first</span>}</div>); })()}
            {(() => { const x = d(plan.co2_est_t_year, base?.co2_est_t_year, (n) => `${fmtNum(n)} t`); return (<div><small>CO₂ / yr</small><b>{fmtNum(plan.co2_est_t_year)} t</b>{x && <span className={x.good ? 'good' : 'bad'}>{x.text}</span>}</div>); })()}
            {(() => { const x = d(plan.peak_mw, base?.peak_mw, (n) => `${fmtNum(n, 1)} MW`); return (<div><small>Load at grid peak</small><b>{fmtNum(plan.peak_mw, 1)} MW</b>{x && <span className={x.good ? 'good' : 'bad'}>{x.text}</span>}</div>); })()}
          </div>
          <table className="ws-kv">
            <tbody>
              <tr><th>Capex (land + build + cooling + interconnection)</th><td>{fmtMoney(plan.capex)}</td></tr>
              <tr><th>Water / yr</th><td>{fmtNum(plan.water_gal_year / 1e6, 1)} M gal</td></tr>
              <tr><th>10-year total cost (ranking metric)</th><td>{fmtMoney(plan.cost)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      <div className="ws-whatif">
        <label>Electricity price multiplier
          <input type="number" min={0.5} max={3} step={0.1} value={priceX} onChange={(e) => setPriceX(+e.target.value)} onBlur={() => onWhatIf({ price_multiplier: priceX })} />
        </label>
        <label>Carbon price ($/t CO₂)
          <input type="number" min={0} max={300} step={10} value={carbonP} onChange={(e) => setCarbonP(+e.target.value)} onBlur={() => onWhatIf({ carbon_price_per_t: carbonP })} />
        </label>
        <label>Utility firm capacity here (% of request)
          <input type="number" min={20} max={100} step={5} value={firmPct} onChange={(e) => setFirmPct(+e.target.value)} onBlur={() => onWhatIf({ firm_capacity: { ...(run.request?.firm_capacity ?? {}), [siteId]: firmPct / 100 } } as unknown as Record<string, number>)} />
        </label>
      </div>
      <p className="ws-note">Public data cannot establish spare grid capacity. Enter what the utility offers for this site (scenario, Simulated). A shortfall can only be covered by curtailing flexible load, which is how operating flexibility changes which site is feasible.</p>
      <p className="ws-note">{busy ? 'Re-optimizing…' : 'Changing a value re-runs the optimizer for the whole search (about 1 s).'} Moving work between hours changes cost, carbon and peak, not energy.</p>
    </div>
  );
}

export function ResultStrip({ run }: { run: OptimizeResult }) {
  const o = run.optimized, b = run.baseline, d = run.delta, inf = run.inflexible;
  const flexChangesSite = !!o && inf !== undefined && (!inf || inf.site_id !== o.site_id);
  const [why, setWhy] = useState<{ answer: string; model: string } | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => setWhy(null), [run.run_id]);
  async function explain() {
    setAsking(true);
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/agent/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_id: run.run_id }) });
      setWhy(await r.json());
    } catch {
      setWhy({ answer: 'Explainer unavailable.', model: 'none' });
    } finally {
      setAsking(false);
    }
  }
  return (
    <>
      <div className="ws-result">
        <div><small>Recommended</small><b>{o ? o.site_name : 'No feasible site'}</b><span>{o ? `${COOL[o.cooling]} cooled · ${o.f > 0 ? `${Math.round(o.d * 100)}% curtailment in stress hours` : 'no curtailment'}` : 'loosen a constraint'}</span></div>
        <div className={flexChangesSite ? 'flip' : ''}><small>Without flexibility</small><b>{inf === undefined ? '—' : inf ? inf.site_name : 'No feasible site'}</b><span>{inf ? `${fmtMoney(inf.cost)} 10-yr · ${inf.site_id === o?.site_id ? 'same site' : 'different site'}` : inf === null ? 'shortfall needs curtailment' : 'flexible share is 0'}</span></div>
        <div><small>Cost-first (same gates)</small><b>{b ? b.site_name : 'none'}</b><span>{b ? `${COOL[b.cooling]} cooled · flat schedule · lowest capex` : 'no site has full firm capacity'}</span></div>
        <div className="delta"><small>Δ CO₂ / yr</small><b className={d && d.co2_est_t_year < 0 ? 'neg' : ''}>{d ? `${d.co2_est_t_year >= 0 ? '−' : '+'}${fmtNum(Math.abs(d.co2_est_t_year))} t` : '—'}</b><span>Estimated</span></div>
        <div className="delta"><small>Δ 10-yr cost</small><b className={d && d.cost < 0 ? 'neg' : ''}>{d ? `${d.cost >= 0 ? '−' : '+'}${fmtMoney(Math.abs(d.cost))}` : '—'}</b><span>Estimated</span></div>
        <div className="delta"><small>Δ load at grid peak</small><b className={d && d.peak_mw < 0 ? 'neg' : ''}>{d ? `${d.peak_mw >= 0 ? '−' : '+'}${fmtNum(Math.abs(d.peak_mw), 1)} MW` : '—'}</b><span>{run.combinations.length} plans · {run.rejected.length} gated out · {run.elapsed_s}s</span></div>
        <div><button className="ws-btn sm" onClick={() => (why ? setWhy(null) : void explain())} disabled={asking || !o}>{asking ? 'Explaining…' : why ? 'Hide explanation' : 'Explain decision'}</button></div>
      </div>
      {flexChangesSite && o && (
        <div className="ws-flip">Flexibility changes the site. With {Math.round((run.request?.flexible_share ?? 0) * 100)}% flexible load the recommendation is {o.site_name} ({fmtMoney(o.cost)} over 10 years); operated inflexibly it is {inf ? `${inf.site_name} (${fmtMoney(inf.cost)}, ${fmtMoney(inf.cost - o.cost)} more)` : 'no site, because every option needs curtailment'}.</div>
      )}
      {why && (
        <div className="ws-explain">
          {why.answer}
          <small>{why.model === 'deterministic' ? 'Generated from the optimizer outputs without a language model.' : `LangChain agent (${why.model}); numbers restricted to tool results.`} Run {run.run_id}.</small>
        </div>
      )}
    </>
  );
}
