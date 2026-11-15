'use client';
// PlotStar copilot: ask about the open project in plain words. The backend (services/api/app/copilot.py) runs a
// LangGraph plan -> act -> verify -> respond loop over deterministic tools (layout engine, CoStar extract). Every figure
// shown here comes from those tools; what-ifs are previews that change nothing until the user presses Apply.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, Check, CircleAlert, Loader2, Send, Sparkles, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import s from './copilot.module.css';

/** Brief fields the copilot may change, in the API's names (services/api/app/routers/studio.py Brief). */
export type BriefPatch = Partial<Record<'rack_kw' | 'mw_it' | 'cooling' | 'redundancy' | 'halls' | 'storeys' | 'flexible_share'
  | 'expansion_pct' | 'setback_m' | 'rent_kw_month', number | string>>;

interface Row { metric: string; before_text: string; after_text: string; delta_text: string; changed: boolean; better: boolean | null; stage: string }
interface Consequences {
  concept: string; concept_id: string; feasible_after: boolean; changed: Row[]; stages: string[];
  check_flips: { name: string; after: boolean; detail: string }[];
}
interface CostarRecord {
  parcel_id: string; name: string | null; address: string | null; city: string | null; property_type: string | null; lot_acres: number | null;
  building_sf: number | null; year_built: number | null; availability: string | null; existing_service_mw: number | null; summary: string; source: string;
  matterport_model_ids?: string[];
}
interface ToolRun {
  name: string; ok: boolean; ms: number; args: Record<string, unknown>;
  output: { headline?: string; record?: CostarRecord; records?: CostarRecord[]; total?: number; items?: { kind: string; severity: string; text: string }[]; object?: string;
    intel?: boolean; tool?: string; label?: string; sources?: string[]; data?: Record<string, unknown> };
}
interface Answer {
  answer: string; written_by: string; planned_by: string; tools: ToolRun[]; flags: string[]; ms: number;
  proposal: { patch: BriefPatch; concept_id: string; consequences: Consequences } | null;
  trace: { node: string; ms: number; by?: string; tools?: string[] }[];
}
type Msg = { role: 'user'; text: string } | { role: 'copilot'; data: Answer; applied?: boolean } | { role: 'error'; text: string };

const TOOL_LABEL: Record<string, string> = {
  WhatIf: 'Re-ran the layout engine', InspectObject: 'Inspected the object', CompareConcepts: 'Compared the concepts',
  ReviewRisks: 'Reviewed risks', CostarProperty: 'Read the CoStar record', CostarSearch: 'Searched CoStar',
};

export function Copilot({ body, conceptId, selected, stage, market, onApply, onSelectSite, busy }: {
  /** The same body the Studio sends to POST /studio/generate. */
  body: Record<string, unknown>;
  conceptId: string | null; selected: string | null; stage: string; market: string;
  /** Apply a previewed change to the brief. Called only after the user confirms. */
  onApply: (patch: BriefPatch) => void;
  onSelectSite?: (parcelId: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [thread] = useState(() => `c${Math.random().toString(36).slice(2, 12)}`);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, waiting]);

  const suggestions = [
    ...(selected?.startsWith('DH') ? [`What if I double the rack density in ${selected}?`, `Why is ${selected} sized like this?`] : selected ? [`Why is ${selected} placed here?`] : []),
    'Can we fit another 200 racks?', 'What happens if we switch to air cooling?', 'Show me the biggest risks',
    'Which concept is cheaper over 10 years?', 'Tell me about this CoStar property',
  ].slice(0, 5);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || waiting) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]); setQ(''); setWaiting(true);
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/copilot/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, question, concept_id: conceptId, selected, stage, market, thread_id: thread }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `The copilot is not available (${r.status}).`);
      setMsgs((m) => [...m, { role: 'copilot', data: d as Answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'error', text: (e as Error).message.includes('fetch') ? `Can't reach the PlotStar API at ${PUBLIC_DATA_API}.` : (e as Error).message }]);
    } finally { setWaiting(false); }
  }

  function apply(i: number, patch: BriefPatch) {
    onApply(patch);
    setMsgs((m) => m.map((x, j) => (j === i && x.role === 'copilot' ? { ...x, applied: true } : x)));
  }

  if (!open) return <button className={s.fab} onClick={() => setOpen(true)} aria-label="Open the PlotStar copilot"><Sparkles size={15} /> Ask PlotStar</button>;

  return (
    <section className={s.panel} aria-label="PlotStar copilot">
      <header className={s.head}>
        <div><b><Sparkles size={14} /> Ask PlotStar</b><span>{stage}{conceptId ? ' · active concept' : ''}{selected ? ` · ${selected} selected` : ''}</span></div>
        <button className={s.icon} onClick={() => setOpen(false)} aria-label="Close the copilot"><X size={15} /></button>
      </header>
      <div className={s.body}>
        {msgs.length === 0 && (
          <div className={s.empty}>
            <p>Ask about this project. Answers are computed by the layout engine and the CoStar extract; changes are previewed before anything is applied.</p>
            <div className={s.chips}>{suggestions.map((t) => <button key={t} onClick={() => void ask(t)}>{t}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? <div key={i} className={s.user}>{m.text}</div>
          : m.role === 'error' ? <div key={i} className={s.error}><CircleAlert size={14} /> {m.text}</div>
          : <Reply key={i} a={m.data} applied={!!m.applied} busy={!!busy} onApply={(p) => apply(i, p)} onSelectSite={onSelectSite} />)}
        {waiting && <div className={s.thinking}><Loader2 size={14} className={s.spin} /> Planning, running the engine, checking the numbers…</div>}
        <div ref={end} />
      </div>
      <form className={s.input} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={selected ? `Ask about ${selected} or the project…` : 'Ask about the project…'} maxLength={600} aria-label="Question" />
        <button className="st-btn primary" type="submit" disabled={!q.trim() || waiting} aria-label="Send"><Send size={14} /></button>
      </form>
    </section>
  );
}

function Reply({ a, applied, busy, onApply, onSelectSite }: { a: Answer; applied: boolean; busy: boolean; onApply: (p: BriefPatch) => void; onSelectSite?: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const p = a.proposal;
  const rows = p ? (showAll ? p.consequences.changed : p.consequences.changed.slice(0, 7)) : [];
  const card = a.tools.find((t) => t.name === 'CostarProperty' && t.ok)?.output.record;
  const search = a.tools.find((t) => t.name === 'CostarSearch' && t.ok)?.output;
  const risks = a.tools.find((t) => t.name === 'ReviewRisks' && t.ok)?.output.items;
  const intel = a.tools.filter((t) => t.ok && t.output.intel);
  return (
    <div className={s.reply}>
      <p className={s.text}>{a.answer}</p>
      {a.flags.length > 0 && <ul className={s.flags}>{a.flags.map((f) => <li key={f}><CircleAlert size={12} /> {f}</li>)}</ul>}

      {p && (
        <div className={s.cons}>
          <div className={s.consHead}><b>Preview · {p.consequences.concept}</b><span>Ripples into {p.consequences.stages.join(', ')}</span></div>
          <table>
            <thead><tr><th>Measure</th><th>Now</th><th>After</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.metric}><td>{r.metric}</td><td>{r.before_text}</td><td><b>{r.after_text}</b></td>
                <td className={r.better === true ? s.good : r.better === false ? s.bad : s.neutral}>
                  {r.better === true ? <ArrowDown size={11} /> : r.better === false ? <ArrowUp size={11} /> : null}{r.delta_text}</td></tr>
            ))}</tbody>
          </table>
          {p.consequences.changed.length > 7 && <button className={s.link} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${p.consequences.changed.length} changes`}</button>}
          {p.consequences.check_flips.length > 0 && (
            <ul className={s.flips}>{p.consequences.check_flips.map((k) => <li key={k.name} className={k.after ? s.good : s.bad}>{k.after ? <Check size={12} /> : <CircleAlert size={12} />} {k.name}: {k.detail}</li>)}</ul>
          )}
          <div className={s.actions}>
            {applied ? <span className={s.applied}><Check size={13} /> Applied. The layouts were regenerated.</span>
              : confirm ? (<>
                <span className={s.ask}>Replace the current brief with this change? The first run stays as the comparison.</span>
                <button className="st-btn primary" disabled={busy} onClick={() => { onApply(p.patch); setConfirm(false); }}>Yes, apply</button>
                <button className="st-btn" onClick={() => setConfirm(false)}>Cancel</button>
              </>) : <button className="st-btn primary" disabled={busy} onClick={() => setConfirm(true)}>Apply this change</button>}
          </div>
        </div>
      )}

      {card && <CostarCard r={card} />}
      {search?.records && search.records.length > 0 && (
        <div className={s.results}>
          <small>{search.total?.toLocaleString()} CoStar matches · showing {search.records.length}</small>
          <ul>{search.records.map((r) => (
            <li key={r.parcel_id}><div><b>{r.name || r.address}</b><span>{r.address}, {r.city} · {r.property_type ?? 'Type unknown'} · {r.lot_acres?.toFixed(1) ?? '?'} acres</span></div>
              {onSelectSite && <button className="st-btn" onClick={() => onSelectSite(r.parcel_id)}>Use site</button>}</li>
          ))}</ul>
          <small className={s.src}><span className="st-tag st-tag-sourced">Sourced</span> CoStar Data Extract</small>
        </div>
      )}
      {intel.map((t) => <IntelCard key={t.name} t={t} />)}
      {risks && (
        <ul className={s.risks}>{risks.map((r) => <li key={r.text} className={s[`sev_${r.severity}`]}><b>{r.kind}</b> {r.text}</li>)}</ul>
      )}

      <details className={s.how}>
        <summary>How this was answered · {(a.ms / 1000).toFixed(1)} s</summary>
        <ol>{a.trace.map((t, i) => <li key={i}><b>{t.node}</b> {t.by ?? ''} {t.tools?.length ? `· ${t.tools.join(', ')}` : ''} <em>{t.ms} ms</em></li>)}</ol>
        <p>{a.tools.map((t) => `${TOOL_LABEL[t.name] ?? t.name}${t.ok ? '' : ' (no result)'}`).join(' · ')}</p>
        <p>{a.written_by}</p>
      </details>
    </div>
  );
}

function CostarCard({ r }: { r: CostarRecord }) {
  return (
    <div className={s.costar}>
      <div className={s.consHead}><b><Building2 size={13} /> {r.name || r.address}</b><span className="st-tag st-tag-sourced">Sourced</span></div>
      <dl>
        <dt>Type</dt><dd>{r.property_type ?? 'Unknown'}</dd>
        <dt>Lot</dt><dd>{r.lot_acres != null ? `${r.lot_acres.toFixed(1)} acres` : 'Unknown'}</dd>
        <dt>Building</dt><dd>{r.building_sf != null ? `${r.building_sf.toLocaleString()} sf` : 'Unknown'}{r.year_built ? ` · built ${r.year_built}` : ''}</dd>
        <dt>Availability</dt><dd>{r.availability ?? 'Not marketed'}</dd>
        <dt>Electric service</dt><dd>{r.existing_service_mw != null ? <>{r.existing_service_mw} MW <span className="st-tag">Estimated</span></> : 'Not recorded'}</dd>
        {r.matterport_model_ids && r.matterport_model_ids.length > 0 && <><dt>Matterport</dt><dd>{r.matterport_model_ids.length} scan{r.matterport_model_ids.length > 1 ? 's' : ''}</dd></>}
      </dl>
      <small className={s.src}>{r.source}</small>
    </div>
  );
}



// ---------------------------------------------------------------- CoStar intelligence evidence (same tools as the MCP server)
type Comp = { comp_id: string; name?: string; address?: string; sold_date?: string; price?: number; price_status?: string; per_sf?: number;
  land_per_acre?: number; distance_km?: number; similarity?: number; stale?: boolean; used?: boolean; is_subject?: boolean };
type Short = { rank?: number; parcel_id: string; name?: string; acquisition?: number | null; acquisition_label?: string; npv?: number;
  npv_p10?: number; npv_p90?: number; gates_failed?: string[]; feasible?: boolean; error?: string };
const usd = (n: unknown) => (typeof n === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n) : 'Unknown');
const TITLE: Record<string, string> = {
  find_sales_comps: 'Sales comparables', underwrite_acquisition: 'Acquisition underwriting', analyze_occupancy: 'Occupancy evidence',
  analyze_residential_impact: 'Residential exposure', analyze_submarket: 'Submarket', find_off_market_candidates: 'Redevelopment candidates',
  compare_property_portfolio: 'Property comparison', find_adjacent_properties: 'Assemblage screen', evaluate_conversion: 'Conversion screen',
  get_matterport_model: 'Matterport scans', identify_data_gaps: 'Diligence gaps', generate_investment_memo: 'Investment memo',
  get_property_intelligence: 'Property dossier', search_costar_properties: 'CoStar search', deal_to_design: 'Deal-to-Design shortlist',
};

function IntelCard({ t }: { t: ToolRun }) {
  const d = (t.output.data ?? {}) as Record<string, unknown>;
  const comps = t.name === 'find_sales_comps' ? ((d.comps as Comp[] | undefined) ?? []).filter((c) => !c.is_subject).slice(0, 6) : [];
  const short = t.name === 'deal_to_design' ? ((d.shortlist as Short[] | undefined) ?? []).slice(0, 6) : [];
  const unit = ((d.estimate as { unit?: string } | null)?.unit) ?? '$/SF';
  return (
    <div className={s.costar}>
      <div className={s.consHead}><b>{TITLE[t.name] ?? t.name}</b><span className="st-tag st-tag-sourced">{t.output.label ?? 'CoStar'}</span></div>
      {comps.length > 0 && (
        <table className={s.mini}><thead><tr><th>Sale</th><th>Date</th><th>Price</th><th>{unit}</th><th>Sim.</th></tr></thead>
          <tbody>{comps.map((c) => (
            <tr key={c.comp_id} className={c.stale || !c.used ? s.muted : ''}>
              <td>{c.name || c.address}{c.stale ? ' · stale' : ''}</td><td>{(c.sold_date ?? '').slice(0, 10)}</td>
              <td>{usd(c.price)}<small> {c.price_status}</small></td><td>{c.per_sf != null ? c.per_sf.toFixed(0) : c.land_per_acre != null ? usd(c.land_per_acre) : '—'}</td>
              <td>{c.similarity != null ? c.similarity.toFixed(0) : '—'}</td></tr>))}</tbody></table>
      )}
      {short.length > 0 && (
        <table className={s.mini}><thead><tr><th>#</th><th>Property</th><th>Acquisition</th><th>NPV P50</th><th>Gates</th></tr></thead>
          <tbody>{short.map((r) => (
            <tr key={r.parcel_id} className={r.gates_failed?.length ? s.muted : ''}><td>{r.rank ?? '—'}</td><td>{r.name ?? r.parcel_id}</td>
              <td>{usd(r.acquisition)}</td><td>{usd(r.npv)}</td><td>{r.error ? 'Error' : r.gates_failed?.length ? `Fails ${r.gates_failed.join(', ')}` : 'Pass'}</td></tr>))}</tbody></table>
      )}
      <small className={s.src}>{(t.output.sources?.length ?? 0) > 0 ? `${t.output.sources!.length} CoStar record references · ` : ''}{t.ms} ms · same tool as the PlotStar CoStar MCP server</small>
    </div>
  );
}
