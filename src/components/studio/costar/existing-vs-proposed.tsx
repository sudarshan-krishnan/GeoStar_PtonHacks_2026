'use client';
// Existing building (CoStar Matterport scan, observed) next to PlotStar's proposed concept (generated, conceptual).
// The two are never mixed: each half carries its own strict label, and the scan's coverage is stated from measured area.
import { useEffect, useState, type ReactNode } from 'react';
import { Box, CircleAlert, Play } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import s from './dossier.module.css';

export interface ScanModel {
  model_id: string; name: string | null; created: string | null; visibility: string | null; floors: number; rooms: number;
  named_rooms: string[]; scanned_sf: number | null; scope: 'whole building' | 'partial' | 'suite or room' | 'unknown';
  ratio: number | null; reason: string; embed_url: string | null; error: string | null;
}
export interface Fact { key: string; label: string; value: string | number | null; tag: string; basis?: string | null }
export interface BuildingResp {
  parcel_id: string; name: string | null; address: string | null; city: string | null; facts: Fact[]; building_sf: number | null;
  matterport: ScanModel[]; scan_summary: { count: number; enriched: number; scanned_sf: number | null; share_of_building: number | null; note: string };
  embed_note: string; source: string;
}
export interface ConversionResp {
  status: 'fits' | 'tight' | 'does not fit' | 'unknown'; racks_needed: number; racks_that_fit_by_area: number | null; concept: string;
  checks: { name: string; status: string; need: number | null; have: number | null; unit: string; basis: string }[];
  missing: { item: string; why: string }[]; note: string; source: string;
}

/** Uncertainties that follow from what CoStar does not record for this building. */
export function uncertainties(facts: Fact[]): string[] {
  const v = (k: string) => facts.find((f) => f.key === k)?.value;
  const out = [
    'No structural information: floor and slab load capacity are not in CoStar.',
    'No column grid or bay spacing: rack rows may not fit around existing columns.',
    'No roof structure data: roof-mounted heat rejection or solar is unverified.',
    'No fire-protection details: data halls usually need a different suppression system.',
  ];
  if (v('ceiling_height_ft') == null) out.unshift('No clear height recorded: floor-to-floor height is unknown.');
  if (v('amps_high') == null) out.unshift('No electric service recorded: the existing supply is unknown.');
  if (v('building_sf') == null) out.unshift('No building area recorded: the usable floor area is unknown.');
  if (v('year_built') == null) out.push('No year built: code compliance and condition are unknown.');
  return out;
}

const SCOPE_TONE: Record<ScanModel['scope'], string> = { 'whole building': 'ok', partial: 'warn', 'suite or room': 'warn', unknown: 'muted' };
export function ScopeBadge({ scope }: { scope: ScanModel['scope'] }) {
  return <span className={`${s.badge} ${s[`badge_${SCOPE_TONE[scope]}`]}`}>Covers: {scope}</span>;
}

export function ExistingVsProposed({ parcelId, conceptSlot, mwIt, rackKw, onNote, data: given }: {
  parcelId: string; conceptSlot?: ReactNode; mwIt?: number; rackKw?: number; onNote?: (note: string) => void; data?: BuildingResp | null;
}) {
  const [data, setData] = useState<BuildingResp | null>(given ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [play, setPlay] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<{ note: string; created_at?: string }[]>([]);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => {
    let alive = true;
    fetch(`${PUBLIC_DATA_API}/deal-room?parcel_id=${encodeURIComponent(parcelId)}`).then((r) => r.json())
      .then((d) => alive && setSaved(d.inspection_notes ?? [])).catch(() => {});
    return () => { alive = false; };
  }, [parcelId]);
  async function saveNote() {
    if (!note.trim()) return;
    setSaving('saving');
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/deal-room/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_id: parcelId, note }) });
      if (!r.ok) throw new Error();
      setSaved((x) => [{ note, created_at: new Date().toISOString() }, ...x]); setSaving('saved');
    } catch { setSaving('error'); }
  }
  const [conv, setConv] = useState<ConversionResp | null>(null);

  useEffect(() => {
    if (given) { setData(given); return; }
    let alive = true;
    setData(null); setErr(null);
    fetch(`${PUBLIC_DATA_API}/costar/building/${encodeURIComponent(parcelId)}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d?.detail ?? r.status); return d; })
      .then((d) => alive && setData(d)).catch((e) => alive && setErr(String(e.message ?? e)));
    return () => { alive = false; };
  }, [parcelId, given]);

  useEffect(() => {
    if (!mwIt) return;
    let alive = true;
    fetch(`${PUBLIC_DATA_API}/costar/conversion/${encodeURIComponent(parcelId)}?mw_it=${mwIt}&rack_kw=${rackKw ?? 20}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => alive && setConv(d)).catch(() => {});
    return () => { alive = false; };
  }, [parcelId, mwIt, rackKw]);

  if (err) return <p className={s.errorLine}><CircleAlert size={14} /> {err}</p>;
  if (!data) return <div className={s.skelBlock} aria-busy="true"><i /><i /><i /></div>;
  const models = data.matterport;
  const m = models[pick];
  return (
    <div className={s.evp}>
      <div className={s.evpGrid}>
        <section className={s.evpHalf}>
          <header><b>Existing building scan</b><span className="st-tag st-tag-sourced">Observed</span>{m && <ScopeBadge scope={m.scope} />}</header>
          {models.length === 0 ? (
            <div className={s.evpEmpty}><Box size={18} /> CoStar has no Matterport scan of this building.</div>
          ) : (
            <>
              {models.length > 1 && (
                <select className={s.select} value={pick} onChange={(e) => { setPick(+e.target.value); setPlay(false); }} aria-label="Choose a scan">
                  {models.map((x, i) => <option key={x.model_id} value={i}>{x.name ?? x.model_id} · {x.scope}</option>)}
                </select>
              )}
              <div className={s.evpFrame}>
                {play && m.embed_url ? (
                  <iframe src={m.embed_url} title={`Matterport scan ${m.name ?? m.model_id}`} allow="xr-spatial-tracking; fullscreen" loading="lazy" />
                ) : (
                  <button className={s.evpPlay} onClick={() => setPlay(true)} disabled={!m.embed_url}>
                    <Play size={18} /> {m.embed_url ? 'Open the 3D scan' : 'This scan is private'}
                  </button>
                )}
              </div>
              <p className={s.caption}>Existing building scan · observed · covers {m.scope}{m.scanned_sf ? ` (${m.scanned_sf.toLocaleString()} sf scanned${data.building_sf ? ` of ${data.building_sf.toLocaleString()} sf` : ''})` : ''}. {m.reason}</p>
            </>
          )}
        </section>
        <section className={s.evpHalf}>
          <header><b>Proposed design</b><span className="st-tag st-tag-simulated">Generated by PlotStar</span><span className={`${s.badge} ${s.badge_muted}`}>Conceptual</span></header>
          <div className={s.evpFrame}>{conceptSlot ?? <div className={s.evpEmpty}>Generate layouts and open Explore to see PlotStar&apos;s proposed concept here.</div>}</div>
          <p className={s.caption}>Proposed design · generated by PlotStar · conceptual. Not a survey of the existing building.</p>
        </section>
      </div>

      {conv && (
        <div className={s.card}>
          <div className={s.cardHead}><b>Conversion check</b><span className={`${s.badge} ${s[`badge_${conv.status === 'fits' ? 'ok' : conv.status === 'unknown' ? 'muted' : conv.status === 'tight' ? 'warn' : 'bad'}`]}`}>{conv.status}</span></div>
          <table className={s.table}><tbody>{conv.checks.map((k) => (
            <tr key={k.name}><td>{k.name}</td><td className={s.num}>{k.need != null ? `${k.need.toLocaleString()} ${k.unit}` : '—'} needed</td>
              <td className={s.num}>{k.have != null ? `${k.have.toLocaleString()} ${k.unit}` : 'unknown'}</td><td><span className={s.statusDot} data-s={k.status} />{k.status}</td></tr>
          ))}</tbody></table>
          <p className={s.caption}>{conv.racks_that_fit_by_area != null ? `By floor area about ${conv.racks_that_fit_by_area.toLocaleString()} of ${conv.racks_needed.toLocaleString()} racks fit. ` : ''}{conv.note} <span className="st-tag st-tag-estimated">Estimated</span></p>
        </div>
      )}

      <div className={s.twoCol}>
        <div className={s.card}>
          <div className={s.cardHead}><b>Engineering uncertainties</b></div>
          <ul className={s.bullets}>{(conv?.missing.map((x) => `${x.item}: ${x.why}`) ?? uncertainties(data.facts)).map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
        <div className={s.card}>
          <div className={s.cardHead}><b>Inspection notes</b></div>
          <textarea className={s.textarea} rows={5} value={note} maxLength={2000} placeholder="What you saw in the scan or on site: columns, slab cracks, dock doors, roof…"
            onChange={(e) => setNote(e.target.value)} onBlur={() => onNote?.(note)} aria-label="Inspection notes" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="st-btn" onClick={() => void saveNote()} disabled={!note.trim() || saving === 'saving'}>{saving === 'saving' ? 'Saving…' : 'Save to deal room'}</button>
            <small className={s.muted}>{saving === 'saved' ? 'Saved to the deal room (MongoDB Atlas).' : saving === 'error' ? 'Could not save; the note stays here.' : 'Your notes; they are not CoStar data.'}</small>
          </div>
          {saved.length > 0 && <ul className={s.bullets}>{saved.slice(0, 5).map((n, i) => <li key={i}>{n.note}{n.created_at ? <small className={s.muted}> · {new Date(n.created_at).toLocaleString()}</small> : null}</li>)}</ul>}
        </div>
      </div>
      <small className={s.src}>{data.source}. {data.embed_note}</small>
    </div>
  );
}
