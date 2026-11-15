'use client';
// Deal desk: acquisition criteria → Deal-to-Design (services/api/app/sponsors/langchain/deal_agent.py, a LangGraph pipeline over the
// CoStar intelligence tools) → a ranked shortlist, an investment memo and the timeline of every tool call that ran.
// Every figure comes from CoStar records and GeoStar's deterministic development model; nothing is computed here.
import { useEffect, useState } from 'react';
import { Activity, Loader2, Play, Printer, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import s from './deal.module.css';

interface Row {
  rank?: number; parcel_id: string; name?: string; address?: string; lot_acres?: number; building_sf?: number; acquisition?: number | null;
  acquisition_label?: string; acquisition_basis?: string; comps_used?: number; capex?: number; npv?: number; npv_p10?: number; npv_p90?: number;
  months_to_power?: number; feasible?: boolean; over_budget?: boolean; gates_failed?: string[]; gates_review?: string[]; error?: string; source?: string;
}
interface Step { node: string; tool: string | null; ok: boolean; ms: number; sources: number; error: string | null }
interface Memo { title?: string; recommendation?: string; because?: string; rule?: string; diligence?: { area: string; gap: string; severity: string }[];
  disclaimer?: string; acquisition?: { value?: number | null; label?: string; basis?: string }; development?: Record<string, unknown>; error?: string }
interface Result { shortlist: Row[]; memo: Memo; timeline: Step[]; ms: number; rule: string; note: string }
interface Call { tool: string; via: string; ok: boolean; ms: number; n_sources: number; error: string | null; at: string }

const usd = (n: unknown) => (typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n) : 'Unknown');
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function DealDesk({ market, mwIt, rackKw, onUseSite, onClose }: {
  market: 'Houston' | 'Los Angeles'; mwIt: number; rackKw: number;
  /** Open a shortlisted CoStar property in the Studio. */
  onUseSite?: (parcelId: string) => void; onClose: () => void;
}) {
  const [c, setC] = useState({ market, mw_it: mwIt, rack_kw: rackKw, budget: '' as string, min_acres: '', candidates: 4, max_comp_age_years: 5 });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'shortlist' | 'timeline' | 'audit'>('shortlist');
  const [audit, setAudit] = useState<Call[]>([]);

  useEffect(() => {
    if (tab !== 'audit') return;
    let alive = true;
    const load = () => fetch(`${PUBLIC_DATA_API}/mcp/audit?limit=40`).then((r) => r.json()).then((d) => alive && setAudit(d.calls ?? [])).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [tab]);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const body = { market: c.market, mw_it: c.mw_it, rack_kw: c.rack_kw, candidates: c.candidates, max_comp_age_years: c.max_comp_age_years,
        budget: c.budget ? Number(c.budget) * 1e6 : null, min_acres: c.min_acres ? Number(c.min_acres) : null };
      const r = await fetch(`${PUBLIC_DATA_API}/deal/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `Deal run failed (${r.status})`);
      setRes(d); setTab('shortlist');
    } catch (e) { setErr((e as Error).message.includes('fetch') ? `Can't reach the GeoStar API at ${PUBLIC_DATA_API}.` : (e as Error).message); }
    finally { setBusy(false); }
  }

  function printMemo() {
    if (!res) return;
    const m = res.memo, w = window.open('', '_blank', 'noopener=no,width=820,height=1000');
    if (!w) return;
    const rows = res.shortlist.map((r) => `<tr><td>${esc(r.rank ?? '—')}</td><td>${esc(r.name ?? r.parcel_id)}<br><small>${esc(r.source)}</small></td><td>${esc(usd(r.acquisition))}<br><small>${esc(r.acquisition_label)}</small></td><td>${esc(usd(r.npv))}</td><td>${esc(r.gates_failed?.length ? 'Fails ' + r.gates_failed.join(', ') : 'Pass')}</td></tr>`).join('');
    const gaps = (m.diligence ?? []).map((g) => `<li><b>${esc(g.area)}</b> (${esc(g.severity)}): ${esc(g.gap)}</li>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.title ?? 'GeoStar investment memo')}</title>
<style>body{font:13px/1.5 -apple-system,Segoe UI,system-ui,sans-serif;color:#18231d;margin:40px;max-width:760px}h1{font-size:22px;margin:0 0 4px}
h2{font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:#264d39}table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid #dfe3da;text-align:left;vertical-align:top}
small{color:#747f78}.rec{font-size:16px;font-weight:600;color:#264d39}.note{color:#747f78;font-size:11.5px;margin-top:24px}</style></head><body>
<h1>${esc(m.title)}</h1><p class="rec">${esc(m.recommendation)}: ${esc(m.because)}</p><p><small>Rule: ${esc(m.rule)}</small></p>
<h2>Acquisition</h2><p>${esc(usd(m.acquisition?.value))} (${esc(m.acquisition?.label)}). ${esc(m.acquisition?.basis)}</p>
<h2>Shortlist</h2><table><tr><th>#</th><th>Property</th><th>Acquisition</th><th>NPV P50</th><th>Hard gates</th></tr>${rows}</table>
<h2>Diligence still required</h2><ul>${gaps}</ul>
<p class="note">${esc(m.disclaimer)} ${esc(res.note)} Generated by GeoStar from the CoStar hackathon extract.</p>
<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  const top = res?.shortlist.find((r) => r.rank === 1);
  return (
    <div className={s.scrim} role="dialog" aria-modal="true" aria-label="Deal desk">
      <section className={s.panel}>
        <header className={s.head}>
          <div><b>Deal desk</b><span>Deal-to-Design · CoStar intelligence tools · LangGraph</span></div>
          <button className={s.icon} onClick={onClose} aria-label="Close the deal desk"><X size={16} /></button>
        </header>
        <div className={s.criteria}>
          <label>Market<select value={c.market} onChange={(e) => setC({ ...c, market: e.target.value as typeof c.market })}><option>Houston</option><option>Los Angeles</option></select></label>
          <label>IT capacity (MW)<input type="number" min={1} max={500} value={c.mw_it} onChange={(e) => setC({ ...c, mw_it: Math.max(1, +e.target.value || 1) })} /></label>
          <label>Acquisition budget ($M)<input type="number" min={0} placeholder="No limit" value={c.budget} onChange={(e) => setC({ ...c, budget: e.target.value })} /></label>
          <label>Min lot (acres)<input type="number" min={0} placeholder="Any" value={c.min_acres} onChange={(e) => setC({ ...c, min_acres: e.target.value })} /></label>
          <label>Candidates<select value={c.candidates} onChange={(e) => setC({ ...c, candidates: +e.target.value })}>{[3, 4, 5, 6, 8].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label title="Older sales are shown but not used for value">Comp window (years)<select value={c.max_comp_age_years} onChange={(e) => setC({ ...c, max_comp_age_years: +e.target.value })}>{[3, 5, 10].map((n) => <option key={n}>{n}</option>)}</select></label>
          <button className="st-btn primary" onClick={() => void run()} disabled={busy}>{busy ? <><Loader2 size={14} className={s.spin} /> Analysing…</> : <><Play size={14} /> Find and analyse</>}</button>
        </div>
        {err && <p className={s.err}>{err}</p>}
        {busy && !res && <div className={s.skeleton}>{[0, 1, 2, 3].map((i) => <i key={i} />)}</div>}
        {res && (
          <>
            <div className={s.memo}>
              <div><small>Recommendation for the leader</small><b>{res.memo.recommendation ?? '—'}</b><span>{res.memo.because}</span></div>
              <button className="st-btn" onClick={printMemo}><Printer size={14} /> Print memo (PDF)</button>
            </div>
            <div className={s.tabs}>
              {(['shortlist', 'timeline', 'audit'] as const).map((k) => (
                <button key={k} className={tab === k ? s.on : ''} onClick={() => setTab(k)}>
                  {k === 'shortlist' ? `Shortlist (${res.shortlist.length})` : k === 'timeline' ? `This run · ${res.timeline.length} tool calls · ${(res.ms / 1000).toFixed(1)} s` : <><Activity size={12} /> Live audit</>}
                </button>
              ))}
            </div>
            {tab === 'shortlist' && (
              <div className={s.scroll}>
                <table className={s.table}>
                  <thead><tr><th>#</th><th>Property</th><th>Acquisition</th><th>Build cost</th><th>NPV P50 (P10 to P90)</th><th>Power in</th><th>Screens</th><th /></tr></thead>
                  <tbody>{res.shortlist.map((r) => (
                    <tr key={r.parcel_id} className={r === top ? s.lead : r.gates_failed?.length || r.error ? s.dim : ''}>
                      <td>{r.rank ?? '—'}</td>
                      <td><b>{r.name ?? r.parcel_id}</b><small>{r.address}{r.lot_acres ? ` · ${r.lot_acres} ac` : ''}{r.building_sf ? ` · ${Math.round(r.building_sf).toLocaleString()} sf` : ''}</small></td>
                      <td>{usd(r.acquisition)}<small>{r.acquisition == null ? 'No defensible value' : `${r.acquisition_label ?? ''}${r.comps_used != null ? ` · ${r.comps_used} comps` : ''}`}</small></td>
                      <td>{usd(r.capex)}</td>
                      <td>{usd(r.npv)}<small>{usd(r.npv_p10)} to {usd(r.npv_p90)}</small></td>
                      <td>{r.months_to_power != null ? `${r.months_to_power} mo` : '—'}</td>
                      <td>{r.error ? <span className={s.bad}>Error</span> : r.gates_failed?.length ? <span className={s.bad}>Fails {r.gates_failed.join(', ')}</span>
                        : r.gates_review?.length ? <span className={s.warn}>Review: {r.gates_review.join(', ')}</span> : <span className={s.ok}>Pass</span>}{r.over_budget ? <small>Over budget</small> : null}{r.feasible === false ? <small>Does not fit the lot</small> : null}</td>
                      <td>{onUseSite && <button className="st-btn" onClick={() => onUseSite(r.parcel_id)}>Open</button>}</td>
                    </tr>))}</tbody>
                </table>
                <p className={s.note}>Rule: {res.rule} {res.note}</p>
              </div>
            )}
            {tab === 'timeline' && (
              <ol className={s.timeline}>{res.timeline.map((t, i) => (
                <li key={i} className={t.ok ? '' : s.badRow}><b>{t.node}</b><span>{t.tool ?? 'ranking rule'}</span><em>{t.ms} ms{t.sources ? ` · ${t.sources} sources` : ''}</em>{t.error && <small>{t.error}</small>}</li>))}</ol>
            )}
            {tab === 'audit' && (
              <ol className={s.timeline}>{audit.map((t, i) => (
                <li key={i} className={t.ok ? '' : s.badRow}><b>{t.tool}</b><span>{t.via}</span><em>{t.ms} ms · {t.n_sources} sources · {new Date(t.at).toLocaleTimeString()}</em>{t.error && <small>{t.error}</small>}</li>))}
                {audit.length === 0 && <li><span>No calls recorded yet.</span></li>}</ol>
            )}
          </>
        )}
        {!res && !busy && <p className={s.empty}>GeoStar searches the CoStar extract for your criteria, values each candidate from real sale comps, runs the development model on it, checks occupancy and nearby homes, then ranks them by a stated rule and drafts a memo. Every tool call is logged and shown.</p>}
      </section>
    </div>
  );
}
