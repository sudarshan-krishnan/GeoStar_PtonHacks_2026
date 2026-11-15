'use client';
// Live grid: two machines run the same fixed job. Baseline runs flat; PlotStar follows the optimizer's hourly plan
// and curtails to the plan's depth during a grid event. One chart, one table, one event, one verdict.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { DataLabel } from '@/lib/types';
import { fmtNum } from './types';

type M = 'baseline' | 'plotstar';
interface Tick {
  t: number;
  replay: { hour: number; hour_idx: number; price: number; carbon: number; mix: Record<string, number> | null; day_s: number };
  machines: Record<M, { watts: number | null; progress: number | null; state: string | null; source: string; meter: string | null; jobs_done: number | null }>;
  totals: Record<M, { wh: number; g_co2: number; cents: number; seconds: number }>;
  plan: { run_id: string; site: string; d: number; f: number; flexible_share: number } | null;
  plan_duty: number | null;
  emergency: { active: boolean; remaining_s: number | null; facility_depth: number };
  labels: Record<M, DataLabel>;
  telemetry_configured: boolean;
}
interface Passport {
  created_at: string; duration_s: number; response_time_s: number | null; requested_depth: number;
  pre_watts: Record<string, number>; watts_during: Record<string, number>; reduction_measured: Record<string, number | null>;
  verified: boolean | null; job_state: Record<string, string>; source: Record<string, string>; plan: { site: string } | null;
}
type Sample = { t: number; b: number; p: number; e: boolean; hour: number };
const WINDOW_S = 60;

function Chart({ samples, maxW }: { samples: Sample[]; maxW: number }) {
  const W = 760, H = 190, L = 36, R = 12, T = 10, B = 26;
  const now = samples.length ? samples[samples.length - 1].t : 0;
  const x = (t: number) => L + ((t - (now - WINDOW_S)) / WINDOW_S) * (W - L - R);
  const y = (w: number) => T + (1 - w / maxW) * (H - T - B);
  const path = (k: 'b' | 'p') => samples.filter((s) => s.t >= now - WINDOW_S).map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ');
  // emergency shading: contiguous runs
  const bands: [number, number][] = [];
  let start: number | null = null;
  samples.forEach((s, i) => {
    if (s.e && start == null) start = s.t;
    if ((!s.e || i === samples.length - 1) && start != null) { bands.push([start, s.t]); start = null; }
  });
  const ticks = [0, 10, 20, 30, 40, 50, 60];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lg-chart" role="img" aria-label="Power draw of both machines over the last 60 seconds">
      {bands.map(([a, b], i) => <rect key={i} x={Math.max(L, x(a))} y={T} width={Math.max(0, x(b) - Math.max(L, x(a)))} height={H - T - B} fill="#b3362b" opacity={0.12} />)}
      {[0, 0.5, 1].map((f) => <line key={f} x1={L} x2={W - R} y1={y(maxW * f)} y2={y(maxW * f)} stroke="#e6e9e2" />)}
      {[0, 0.5, 1].map((f) => <text key={f} x={L - 5} y={y(maxW * f) + 3} fontSize="9" textAnchor="end" fill="#76807a">{Math.round(maxW * f)}</text>)}
      <text x={L - 5} y={T + 2} fontSize="8" textAnchor="end" fill="#76807a">W</text>
      <path d={path('b')} fill="none" stroke="#8a8f88" strokeWidth="1.6" />
      <path d={path('p')} fill="none" stroke="#264d39" strokeWidth="2" />
      {ticks.map((s) => <text key={s} x={x(now - WINDOW_S + s)} y={H - 8} fontSize="9" textAnchor="middle" fill="#76807a">{s === 60 ? 'now' : `−${60 - s}s`}</text>)}
      <line x1={L} x2={W - R} y1={H - B + 0.5} y2={H - B + 0.5} stroke="#dde1d8" />
    </svg>
  );
}

export function Meters({ priceDate }: { priceDate?: string | null }) {
  const [tick, setTick] = useState<Tick | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seenEvent = useRef(false);

  useEffect(() => {
    const es = new EventSource(`${PUBLIC_DATA_API}/telemetry/stream`);
    es.addEventListener('tick', (ev) => {
      const d: Tick = JSON.parse((ev as MessageEvent).data);
      setTick(d);
      setErr(null);
      setSamples((s) => [...s, { t: d.t, b: d.machines.baseline.watts ?? 0, p: d.machines.plotstar.watts ?? 0, e: d.emergency.active, hour: d.replay.hour }].slice(-WINDOW_S * 2));
      if (d.emergency.active) seenEvent.current = true;
      else if (seenEvent.current) {
        seenEvent.current = false;
        fetch(`${PUBLIC_DATA_API}/passport/latest`).then((r) => (r.ok ? r.json() : null)).then((p) => p && setPassport(p)).catch(() => {});
      }
    });
    es.onerror = () => setErr(`No stream from ${PUBLIC_DATA_API}`);
    fetch(`${PUBLIC_DATA_API}/passport/latest`).then((r) => (r.ok ? r.json() : null)).then((p) => p && setPassport(p)).catch(() => {});
    return () => es.close();
  }, []);

  async function triggerEvent() {
    await fetch(`${PUBLIC_DATA_API}/hardware/emergency`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration_s: 20, source: 'software' }) });
  }
  async function reset() {
    await fetch(`${PUBLIC_DATA_API}/hardware/reset`, { method: 'POST' });
    setSamples([]); setPassport(null);
  }

  if (err) return <div className="lg-wrap"><div className="ws-warnbox">{err}</div></div>;
  if (!tick) return <div className="lg-wrap"><div className="ws-note">Connecting to the telemetry stream…</div></div>;

  const maxW = Math.max(50, ...samples.map((s) => Math.max(s.b, s.p))) * 1.1;
  const tb = tick.totals.baseline, tp = tick.totals.plotstar;
  const mix = tick.replay.mix ?? {};
  const clean = (mix['Wind'] ?? 0) + (mix['Solar'] ?? 0) + (mix['Nuclear'] ?? 0) + (mix['Hydro'] ?? 0);
  const hh = Math.floor(tick.replay.hour) % 24;
  const depthPct = Math.round((tick.plan?.d || tick.emergency.facility_depth) * 100);
  const sim = tick.labels.plotstar === 'Simulated';

  return (
    <div className="lg-wrap">
      <div className="lg-head">
        <div>
          <b>Live test: the same fixed job on two machines</b>
          <span>Baseline runs flat. PlotStar follows the optimizer&apos;s hourly plan{tick.plan ? ` for ${tick.plan.site}` : ''} and cuts {depthPct}% of facility load during a grid event{tick.plan && !tick.plan.d ? ' (the plan itself needs no curtailment; the event shows the capability)' : ' (the depth the plan relies on)'}. ERCOT {priceDate ?? ''} replayed every {tick.replay.day_s} s.</span>
        </div>
        <div className="lg-grid-now">
          <span><small>Replay hour</small><b>{String(hh).padStart(2, '0')}:00</b></span>
          <span><small>Price</small><b>${tick.replay.price.toFixed(0)}<em>/MWh</em></b></span>
          <span><small>Carbon</small><b>{tick.replay.carbon.toFixed(0)}<em> kg/MWh</em></b></span>
          <span><small>Clean share</small><b>{Math.round(clean * 100)}%</b></span>
        </div>
      </div>

      <Chart samples={samples} maxW={maxW} />

      <table className="lg-table">
        <thead>
          <tr><th></th><th>Now</th><th>State</th><th className="r">Jobs done</th><th className="r">Energy</th><th className="r">CO₂</th><th className="r">Cost</th><th>Reading</th></tr>
        </thead>
        <tbody>
          {(['baseline', 'plotstar'] as M[]).map((m) => {
            const x = tick.machines[m], t = tick.totals[m];
            return (
              <tr key={m} className={m}>
                <td><i className="lg-swatch" />{m === 'baseline' ? 'Baseline (flat)' : 'PlotStar (plan)'}</td>
                <td className="ws-num"><b>{x.watts == null ? '—' : x.watts.toFixed(0)} W</b></td>
                <td>{x.state}</td>
                <td className="r ws-num">{x.jobs_done ?? '—'}</td>
                <td className="r ws-num">{fmtNum(t.wh, 2)} Wh</td>
                <td className="r ws-num">{fmtNum(t.g_co2, 2)} g</td>
                <td className="r ws-num">{(t.cents).toFixed(3)} ¢</td>
                <td><span className={`ws-tag ${tick.labels[m].toLowerCase()}`}>{tick.labels[m]}</span>{x.meter ? ` ${x.meter}` : ''}</td>
              </tr>
            );
          })}
          <tr className="delta">
            <td>PlotStar vs baseline</td><td></td><td></td>
            <td className="r ws-num">{(tick.machines.plotstar.jobs_done ?? 0) - (tick.machines.baseline.jobs_done ?? 0)}</td>
            <td className="r ws-num">{fmtNum(tp.wh - tb.wh, 2)} Wh</td>
            <td className="r ws-num">{fmtNum(tp.g_co2 - tb.g_co2, 2)} g</td>
            <td className="r ws-num">{(tp.cents - tb.cents).toFixed(3)} ¢</td>
            <td><span className="ws-note">over {fmtNum(tb.seconds, 0)} s</span></td>
          </tr>
        </tbody>
      </table>

      <div className="lg-event">
        <button className="ws-btn danger" onClick={() => void triggerEvent()} disabled={tick.emergency.active}>
          <AlertTriangle size={14} /> {tick.emergency.active ? `Grid event in progress · ${tick.emergency.remaining_s ?? 0} s` : `Trigger grid event (plan requires a ${depthPct}% cut for 20 s)`}
        </button>
        <button className="ws-btn" onClick={() => void reset()}><RotateCcw size={13} /> Reset counters</button>
        {passport && (
          <div className={`lg-verdict ${passport.verified ? 'ok' : 'bad'}`}>
            <b>{passport.verified ? 'Plan verified' : 'Plan not met'}</b>
            <span>
              Required a {Math.round(passport.requested_depth * 100)}% cut; PlotStar cut {Math.round((passport.reduction_measured.plotstar ?? 0) * 100)}% ({passport.pre_watts.plotstar} → {passport.watts_during.plotstar} W) in {passport.response_time_s ?? '—'} s, held {passport.duration_s} s. Baseline changed {Math.round((passport.reduction_measured.baseline ?? 0) * 100)}%. Readings: {passport.source.plotstar}.
            </span>
          </div>
        )}
      </div>

      <p className="ws-note">
        {sim ? 'Simulation (no machine has reported in 10 s). Set TELEMETRY_API_KEY and run services/controller/run.py on each machine for measured watts.' : 'Measured readings from the machines.'}{' '}
        Energy = watts × time. CO₂ and cost use the ERCOT carbon and price at the replayed hour (Estimated). Both machines are costed identically; the difference is the schedule. Scaling to a 20 MW site is modeled.
      </p>
    </div>
  );
}
