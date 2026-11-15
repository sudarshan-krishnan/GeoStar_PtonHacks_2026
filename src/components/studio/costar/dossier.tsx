'use client';
// CoStar dossier: everything the CoStar Data Extract says about one parcel, in five tabs.
//   Sales comparables · Occupancy & redevelopment · Community · Existing vs proposed · Market
// Every figure carries its label (Sourced / Estimated / Unknown) and its CoStar source. Nothing is computed here:
// numbers come from services/api (costar/valuation.py, tenancy.py, market.py, building.py and the community module).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Building2, CircleAlert, Home, Landmark, LineChart, Scale, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import { BarChart, Histogram } from './charts';
import { ExistingVsProposed } from './existing-vs-proposed';
import type { MapPoint } from './mini-map';
import s from './dossier.module.css';

const MiniMap = dynamic(() => import('./mini-map'), { ssr: false, loading: () => <div className={s.skelMap} /> });

type Tab = 'comps' | 'control' | 'community' | 'building' | 'market';
const TABS: { key: Tab; label: string; icon: typeof Scale }[] = [
  { key: 'comps', label: 'Sales comparables', icon: Scale }, { key: 'control', label: 'Occupancy & redevelopment', icon: Landmark },
  { key: 'community', label: 'Community', icon: Home }, { key: 'building', label: 'Existing vs proposed', icon: Building2 },
  { key: 'market', label: 'Market', icon: LineChart },
];

// ------------------------------------------------------------------------------------------------ helpers
const usd = (n: number | null | undefined, d = 1) => n == null ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: Math.abs(n) >= 1e5 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(n) >= 1e5 ? d : 0 }).format(n);
const num = (n: number | null | undefined, d = 0) => (n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(n));
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const Tag = ({ l }: { l: string | null | undefined }) => <span className={`st-tag st-tag-${(l || 'unknown').split(' ')[0].toLowerCase()}`}>{l || 'Unknown'}</span>;

interface Api<T> { data: T | null; error: string | null; missing: boolean; loading: boolean; reload: (body?: unknown) => void }
function useApi<T>(path: string | null, postPath?: string): Api<T> {
  const [st, setSt] = useState<{ data: T | null; error: string | null; missing: boolean; loading: boolean }>({ data: null, error: null, missing: false, loading: !!path });
  const run = useCallback((body?: unknown) => {
    if (!path) return;
    setSt((x) => ({ ...x, loading: true, error: null }));
    fetch(`${PUBLIC_DATA_API}${body === undefined ? path : (postPath ?? path)}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.status === 404 && (!d || d.detail === 'Not Found')) return setSt({ data: null, error: null, missing: true, loading: false });
        if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `HTTP ${r.status}`);
        setSt({ data: d as T, error: null, missing: false, loading: false });
      })
      .catch((e) => setSt({ data: null, error: (e as Error).message.includes('fetch') ? `Can't reach the PlotStar API at ${PUBLIC_DATA_API}.` : (e as Error).message, missing: false, loading: false }));
  }, [path, postPath]);
  useEffect(() => { run(); }, [run]);
  return { ...st, reload: run };
}

function State<T>({ api, what, children }: { api: Api<T>; what: string; children: (d: T) => ReactNode }) {
  if (api.loading && !api.data) return <div className={s.skelBlock} aria-busy="true" aria-label={`Loading ${what}`}><i /><i /><i /><i /></div>;
  if (api.missing) return <p className={s.emptyBox}>{what} is not available on this server yet.</p>;
  if (api.error) return <p className={s.errorLine}><CircleAlert size={14} /> {api.error}</p>;
  if (!api.data) return null;
  return <>{children(api.data)}</>;
}

// ------------------------------------------------------------------------------------------------ shapes (services/api/app/costar/*)
interface Comp {
  comp_id: number; parcel_id: string | null; is_subject: boolean; name: string | null; address: string | null; lat: number; lon: number;
  property_type: string | null; sold_date: string | null; age_years: number | null; stale: boolean; price: number | null; price_status: string | null;
  building_sf: number | null; lot_acres: number | null; per_sf: number | null; land_per_acre: number | null; distance_km: number;
  similarity: number; excluded: boolean; used: boolean; source_row: number;
}
interface CompsResp {
  status: 'ok' | 'insufficient_evidence'; basis: 'sf' | 'acre'; unit: string; radius_km: number; max_age_years: number; widened_statuses?: boolean;
  estimate: { median: number; weighted_mean: number; p25: number; p75: number; n: number; unit: string } | null; reasons: string[];
  comps: Comp[]; n_used?: number; n_stale?: number; excluded?: number[]; rejected?: Record<string, number>; method?: string; source?: string;
  subject: { lat: number | null; lon: number | null; name: string | null; address: string | null; lot_acres: number | null; building_sf: number | null };
  value?: { value: number; low: number; high: number; weighted: number; size: number; size_unit: string; n: number } | null;
  underwriting?: { acquisition_value: number | null; low: number | null; high: number | null; label: string; basis_text: string };
}
interface Tenant { name: string; industry: string | null; sf: number | null; share_of_building: number | null; lease_type: string; move_in: string | null; lease_expiration: string; month_to_month: boolean }
interface ControlResp {
  building_sf: number | null; building_sf_basis?: string; states: string[]; state_evidence: { state: string; reason: string; source: string }[];
  availability?: { available_sf: number; lease_spaces: number; asking_rent_per_sf_year: number | null; for_sale: { asking_price_low: number | null; asking_price_high: number | null }[] };
  current: { tenancies: number; occupied_sf: number | null; occupied_share: number | null; vacancy_share: number | null; vacancy_basis: string; owner_occupied: boolean; largest_tenant: string | null };
  tenants: Tenant[]; expiration_ladder: { year: string; tenancies: number; sf: number; past?: boolean }[]; expirations_unknown: number;
  earliest_full_control: { date: string | null; months: number | null; basis: string }; diligence_flags: { flag: string; detail: string }[];
  coverage?: { records: number; current: number; current_with_expiry: number }; label: string; source: string;
}
type Loose = Record<string, unknown>;

const STATE_INFO: Record<string, { label: string; tone: string }> = {
  confirmed_vacant: { label: 'Confirmed vacant', tone: 'ok' }, listed_available: { label: 'Listed available', tone: 'info' },
  occupied: { label: 'Occupied', tone: 'warn' }, unknown: { label: 'Unknown', tone: 'muted' }, conflict: { label: 'Conflicting records', tone: 'bad' },
};

// ------------------------------------------------------------------------------------------------ component
export function CostarDossier({ parcelId, lotAcres, mwIt, rackKw, proposedSlot, onUseLandValue, onNote, onClose, initialTab = 'comps' }: {
  parcelId: string | null; lotAcres?: number | null; mwIt?: number; rackKw?: number; proposedSlot?: ReactNode;
  onUseLandValue?: (value: number, label: string, basis: string) => void; onNote?: (note: string) => void; onClose: () => void; initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);
  const idx = TABS.findIndex((t) => t.key === tab);
  return (
    <div className={s.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={s.modal} role="dialog" aria-modal="true" aria-label="CoStar dossier">
        <header className={s.head}>
          <div><small className={s.eyebrow}>CoStar dossier</small><h2>{parcelId ?? 'Dropped pin'}</h2></div>
          <button className={s.close} onClick={onClose} aria-label="Close the CoStar dossier"><X size={16} /></button>
        </header>
        <nav className={s.tabs} role="tablist" style={{ ['--i' as string]: idx, ['--n' as string]: TABS.length }}>
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? s.on : ''} onClick={() => setTab(t.key)}>
              <t.icon size={14} /> <span>{t.label}</span>
            </button>
          ))}
          <i className={s.ink} aria-hidden />
        </nav>
        <div className={s.body} key={tab}>
          {!parcelId ? (
            <p className={s.emptyBox}>This location was dropped on the map, so it has no CoStar record. CoStar evidence needs a CoStar property.</p>
          ) : tab === 'comps' ? <CompsTab id={parcelId} onUse={onUseLandValue} />
            : tab === 'control' ? <ControlTab id={parcelId} />
            : tab === 'community' ? <CommunityTab id={parcelId} />
            : tab === 'building' ? <ExistingVsProposed parcelId={parcelId} conceptSlot={proposedSlot} mwIt={mwIt} rackKw={rackKw} onNote={onNote} />
            : <MarketTab id={parcelId} lotAcres={lotAcres} />}
        </div>
        <footer className={s.foot}>Source: CoStar Data Extract (HackPrinceton kit, Houston and Los Angeles). Prices are nominal. A sample of each submarket, not its full inventory.</footer>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ 1 sales comparables
function CompsTab({ id, onUse }: { id: string; onUse?: (v: number, l: string, b: string) => void }) {
  const api = useApi<CompsResp>(`/costar/land/${encodeURIComponent(id)}`, `/costar/comps/${encodeURIComponent(id)}`);
  const [confirm, setConfirm] = useState(false);
  const [used, setUsed] = useState(false);
  const [kept, setKept] = useState<'idle' | 'saved' | 'error'>('idle');
  async function keepSelection(d: CompsResp) {
    try {
      const r = await fetch(`${PUBLIC_DATA_API}/deal-room`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'comp_selection', parcel_id: id, confirm: true,
          payload: { excluded: (d.excluded ?? d.comps.filter((c) => c.excluded).map((c) => c.comp_id)).map(String), basis: d.basis } }) });
      setKept(r.ok ? 'saved' : 'error');
    } catch { setKept('error'); }
  }
  const toggle = (d: CompsResp, cid: number) => {
    const ex = new Set(d.excluded ?? d.comps.filter((c) => c.excluded).map((c) => c.comp_id));
    if (ex.has(cid)) ex.delete(cid); else ex.add(cid);
    api.reload({ exclude: [...ex] });
    setUsed(false); setKept('idle');
  };
  return (
    <State api={api} what="Sales comparables">{(d) => {
      const pts: MapPoint[] = [
        ...(d.subject.lat != null && d.subject.lon != null ? [{ id: 'subject', lat: d.subject.lat, lon: d.subject.lon, label: `Subject · ${d.subject.name ?? d.subject.address ?? id}`, subject: true }] : []),
        ...d.comps.filter((c) => !c.is_subject).map((c) => ({ id: String(c.comp_id), lat: c.lat, lon: c.lon, score: c.similarity / 100, muted: !c.used,
          label: `${c.name ?? c.address ?? 'Sale'} · ${c.sold_date?.slice(0, 10) ?? 'no date'} · similarity ${c.similarity}${c.used ? '' : c.excluded ? ' · excluded' : ' · stale'}` })),
      ];
      const uw = d.underwriting;
      return (
        <div className={s.grid}>
          <div className={s.col}>
            <div className={`${s.card} ${s.hero}`}>
              {d.estimate ? (
                <>
                  <small>Median {d.unit} · {d.estimate.n} comps <Tag l="Estimated" /></small>
                  <b className={s.big}>{d.unit === '$/SF' ? `$${num(d.estimate.median, 2)}` : usd(d.estimate.median)}</b>
                  <span>Similarity-weighted {d.unit === '$/SF' ? `$${num(d.estimate.weighted_mean, 2)}` : usd(d.estimate.weighted_mean)} · range {d.unit === '$/SF' ? `$${num(d.estimate.p25, 2)}–$${num(d.estimate.p75, 2)}` : `${usd(d.estimate.p25)}–${usd(d.estimate.p75)}`} (P25–P75)</span>
                  {d.value && <span>Indicative value {usd(d.value.value)} ({usd(d.value.low)}–{usd(d.value.high)}) for {num(d.value.size)} {d.value.size_unit}</span>}
                </>
              ) : (
                <>
                  <small>Estimate <Tag l="Unknown" /></small>
                  <b className={s.bigMuted}>Insufficient evidence</b>
                  <ul className={s.bullets}>{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </>
              )}
              {uw && uw.acquisition_value != null && onUse && (
                used ? <span className={s.okLine}>Using {usd(uw.acquisition_value)} as the acquisition value. The numbers are being re-run.</span>
                  : confirm ? (
                    <div className={s.confirm}>
                      <span>Replace the site&apos;s land cost with {usd(uw.acquisition_value)} and re-run every number?</span>
                      <button className="st-btn primary" onClick={() => { onUse(uw.acquisition_value!, uw.label, uw.basis_text); setUsed(true); setConfirm(false); }}>Yes, use it</button>
                      <button className="st-btn" onClick={() => setConfirm(false)}>Cancel</button>
                    </div>
                  ) : <button className="st-btn primary" onClick={() => setConfirm(true)}>Use as acquisition value</button>
              )}
            </div>
            <div className={s.confirm}>
              <button className="st-btn" onClick={() => void keepSelection(d)}>Save this comp selection</button>
              <span>{kept === 'saved' ? 'Saved to the deal room (MongoDB Atlas): the excluded comp ids, not CoStar data.' : kept === 'error' ? 'Could not save the selection.' : 'Keeps which comps you excluded, so the estimate can be reproduced.'}</span>
            </div>
            <MiniMap points={pts} height={250} legend="Comps: darker = more similar; grey = stale or excluded" />
            <p className={s.note}>
              Within {d.radius_km} km, sold in the last {d.max_age_years} years{d.widened_statuses ? ', price statuses widened beyond confirmed sales' : ''}. Nominal prices, not time-adjusted.
              {d.rejected && Object.keys(d.rejected).length > 0 && <> Left out: {Object.entries(d.rejected).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k}`).join('; ')}.</>}
            </p>
          </div>
          <div className={s.col}>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Use</th><th>Sale</th><th className={s.num}>km</th><th>Sold</th><th className={s.num}>Price</th><th className={s.num}>{d.unit}</th><th className={s.num}>Size</th><th className={s.num}>Similar</th></tr></thead>
                <tbody>{d.comps.filter((c) => !c.is_subject).map((c) => (
                  <tr key={c.comp_id} className={c.used ? '' : s.dim}>
                    <td><input type="checkbox" checked={!c.excluded} disabled={api.loading} onChange={() => toggle(d, c.comp_id)} aria-label={`Use comp ${c.comp_id}`} /></td>
                    <td><b>{c.name ?? c.address ?? `Comp ${c.comp_id}`}</b><small>{c.property_type ?? 'Type unknown'} · row {c.source_row}</small></td>
                    <td className={s.num}>{num(c.distance_km, 1)}</td>
                    <td>{c.sold_date?.slice(0, 10) ?? '—'} <span className={`${s.chip} ${c.stale ? s.chipStale : s.chipFresh}`}>{c.age_years != null ? `${num(c.age_years, 1)} y` : 'no date'}{c.stale ? ' · stale' : ''}</span></td>
                    <td className={s.num}>{usd(c.price)}<br /><Tag l={c.price_status} /></td>
                    <td className={s.num}>{d.basis === 'sf' ? (c.per_sf != null ? `$${num(c.per_sf, 2)}` : '—') : usd(c.land_per_acre)}</td>
                    <td className={s.num}>{d.basis === 'sf' ? `${num(c.building_sf)} sf` : `${num(c.lot_acres, 1)} ac`}</td>
                    <td className={s.num}><span className={s.sim} style={{ ['--v' as string]: c.similarity / 100 }}>{num(c.similarity)}</span></td>
                  </tr>
                ))}</tbody>
              </table>
              {d.comps.length === 0 && <p className={s.emptyBox}>No sales of land, industrial or flex property found nearby.</p>}
            </div>
            {d.method && <details className={s.method}><summary>How comps are chosen and scored</summary><p>{d.method}</p></details>}
            <small className={s.src}>{d.source ?? 'CoStar Data Extract, data/commercial-sale-comp.jsonl'}</small>
          </div>
        </div>
      );
    }}</State>
  );
}

// ------------------------------------------------------------------------------------------------ 2 occupancy & redevelopment
function ControlTab({ id }: { id: string }) {
  const api = useApi<ControlResp>(`/costar/control/${encodeURIComponent(id)}`);
  const red = useApi<RedevResp>(`/costar/redevelopment/${encodeURIComponent(id)}`);
  return (
    <div className={s.stack}>
      <State api={api} what="Occupancy">{(d) => {
        const occ = d.current.occupied_share;
        return (
          <>
            <div className={s.badges}>
              {(d.states.length ? d.states : ['unknown']).map((st) => <span key={st} className={`${s.badge} ${s[`badge_${STATE_INFO[st]?.tone ?? 'muted'}`]}`}>{STATE_INFO[st]?.label ?? st}</span>)}
              {d.current.owner_occupied && <span className={`${s.badge} ${s.badge_info}`}>Owner-occupied</span>}
              <span className={s.helper}>No tenant record does not mean vacant: CoStar may simply not track this building&apos;s tenants.</span>
            </div>
            <ul className={s.evidence}>{d.state_evidence.map((e, i) => <li key={i}><b>{STATE_INFO[e.state]?.label ?? e.state}.</b> {e.reason}</li>)}</ul>
            <div className={s.twoCol}>
              <div className={s.card}>
                <div className={s.cardHead}><b>Occupied vs not occupied</b><Tag l={occ != null ? 'Sourced' : 'Unknown'} /></div>
                <div className={s.occBar} aria-label={`Occupied ${pct(occ)}`}><i style={{ width: `${(occ ?? 0) * 100}%` }} /></div>
                <p className={s.note}>{occ != null ? `${pct(occ)} occupied (${num(d.current.occupied_sf)} of ${num(d.building_sf)} sf). ` : ''}{d.current.vacancy_basis}</p>
                {d.availability && <p className={s.note}>Marketed now: {num(d.availability.available_sf)} sf for lease in {d.availability.lease_spaces} space(s){d.availability.asking_rent_per_sf_year ? ` at about $${num(d.availability.asking_rent_per_sf_year, 2)}/sf/yr` : ''}{d.availability.for_sale.length ? `; for sale${d.availability.for_sale[0].asking_price_high ? ` asking ${usd(d.availability.for_sale[0].asking_price_high)}` : ''}` : ''}.</p>}
              </div>
              <div className={s.card}>
                <div className={s.cardHead}><b>Earliest full control</b><Tag l={d.earliest_full_control.date ? 'Estimated' : 'Unknown'} /></div>
                <b className={d.earliest_full_control.date ? s.big : s.bigMuted}>{d.earliest_full_control.date ? `${d.earliest_full_control.date.slice(0, 10)}` : 'Unknown'}</b>
                {d.earliest_full_control.months != null && <span className={s.muted}>{num(d.earliest_full_control.months, 0)} months from today</span>}
                <p className={s.note}>{d.earliest_full_control.basis}</p>
              </div>
            </div>
            {d.expiration_ladder.length > 0 && (
              <BarChart title={`Lease expirations by year (sf)${d.expirations_unknown ? ` · ${d.expirations_unknown} with no recorded expiry` : ''}`}
                bars={d.expiration_ladder.map((y) => ({ label: y.year, value: Math.round(y.sf), tip: `${y.tenancies} lease(s), ${num(y.sf)} sf${y.past ? ' · already passed' : ''}` }))} unit=" sf" />
            )}
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Tenant</th><th>Industry</th><th className={s.num}>sf</th><th className={s.num}>Share</th><th>Type</th><th>Moved in</th><th>Expires</th></tr></thead>
                <tbody>{d.tenants.slice(0, 40).map((t, i) => (
                  <tr key={i}><td><b>{t.name}</b>{t.month_to_month && <small>Month to month</small>}</td><td>{t.industry ?? '—'}</td><td className={s.num}>{num(t.sf)}</td>
                    <td className={s.num}>{pct(t.share_of_building)}</td><td>{t.lease_type}</td><td>{t.move_in?.slice(0, 10) ?? '—'}</td><td>{t.lease_expiration?.slice(0, 10) ?? 'unknown'}</td></tr>
                ))}</tbody>
              </table>
              {d.tenants.length === 0 && <p className={s.emptyBox}>No current tenants on record. That is not proof the building is empty.</p>}
            </div>
            {d.diligence_flags.length > 0 && (
              <div className={s.card}><div className={s.cardHead}><b>Leasing due diligence</b></div>
                <ul className={s.bullets}>{d.diligence_flags.map((f) => <li key={f.flag + f.detail}>{f.detail}</li>)}</ul></div>
            )}
            <small className={s.src}>{d.label}. {d.source}</small>
          </>
        );
      }}</State>
      <State api={red} what="Redevelopment potential">{(d) => <Redevelopment d={d} />}</State>
    </div>
  );
}

/** Redevelopment potential (services/api: costar redevelopment screen): five categories of pass / flag / unknown checks. */
interface RedevItem { item: string; status: 'pass' | 'flag' | 'fail' | 'unknown'; value: unknown; threshold: string | null; reason: string; source: string }
interface RedevCat { label: string; items: RedevItem[]; passes: number; known: number; unknown: number; score: number | null; summary: string }
interface RedevResp { market_status?: string; categories: Record<string, RedevCat> | RedevCat[]; threshold_basis?: string; label?: string; note?: string; source?: string; source_row?: number }
const TONE: Record<string, string> = { pass: 'ok', flag: 'warn', fail: 'bad', unknown: 'muted' };
function Redevelopment({ d }: { d: RedevResp }) {
  const cats = Array.isArray(d.categories) ? d.categories : Object.values(d.categories ?? {});
  const show = (v: unknown) => (v == null ? 'unknown' : typeof v === 'number' ? num(v, 2) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
  return (
    <div className={s.card}>
      <div className={s.cardHead}><b>Redevelopment potential</b><Tag l={d.label ?? 'Screening'} />{d.market_status && <span className={s.muted}>{d.market_status}</span>}</div>
      <div className={s.checkGrid}>{cats.map((c) => (
        <section key={c.label}>
          <h4>{c.label}</h4>
          <div className={s.scoreLine}><span className={s.scoreBar}><i style={{ width: `${Math.round((c.score ?? 0) * 100)}%` }} /></span><small>{c.summary}</small></div>
          <ul className={s.checks}>{c.items.map((it) => (
            <li key={it.item}><span className={s.statusDot} data-s={TONE[it.status] ?? 'muted'} /><div>
              <b>{it.item}: {show(it.value)}{it.threshold ? <span className={s.thr}> · needs {it.threshold}</span> : null}</b>
              <small>{it.reason}</small></div></li>
          ))}</ul>
        </section>
      ))}</div>
      {cats.length === 0 && <p className={s.note}>No checklist returned.</p>}
      <p className={s.note}>{d.note} {d.threshold_basis}</p>
      {d.source && <small className={s.src}>{d.source}{d.source_row ? `, row ${d.source_row}` : ''}</small>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ 3 community
interface Band { band: string; homes_listed: number; for_sale_active: number; median_asking_price: number | null; sold_last_year: number;
  median_sold_price: number | null; sold_price_undisclosed: number; for_rent_active: number; median_asking_rent_month: number | null;
  apartment_communities: number; apartment_units: number; apartment_units_unknown: number; apartment_units_available: number }
interface CommunityResp {
  name: string | null; lat: number; lon: number; radius_m: number; nearest_home_listing_m: number | null; nearest_apartment_community_m: number | null;
  engine_gate_home_m: number | null; engine_gate_note: string; bands: Band[];
  nearest_homes: { street: string | null; city: string | null; distance_m: number; transaction: string; status: string; asking_price: number | null; sold_price: number | null; price_undisclosed: boolean; beds: number | null; sqft: number | null; home_type: string | null }[];
  noise: { receptors: { kind: string; distance_m: number; dba: number; over_limit: boolean }[]; assumptions: Record<string, unknown>; label: string; basis: string };
  points: { kind: string; lat: number; lon: number; distance_m: number; status?: string; units?: number | null }[]; points_total: number;
  wording: string; label: string; source: string;
}
function CommunityTab({ id }: { id: string }) {
  const api = useApi<CommunityResp>(`/costar/community/${encodeURIComponent(id)}`);
  return (
    <State api={api} what="Community evidence">{(d) => {
      const pts: MapPoint[] = [{ id: 'subject', lat: d.lat, lon: d.lon, label: `Subject · ${d.name ?? id}`, subject: true },
        ...d.points.map((p, i) => ({ id: `p${i}`, lat: p.lat, lon: p.lon, score: Math.max(0, 1 - p.distance_m / d.radius_m),
          label: `${p.kind === 'home' ? `Home${p.status ? ` · ${p.status}` : ''}` : `Apartment community${p.units ? ` · ${p.units} units` : ''}`} · ${num(p.distance_m)} m` }))];
      const limit = d.noise.assumptions.limit_dba as number | undefined;
      return (
        <div className={s.stack}>
          <div className={s.twoCol}>
            <MiniMap points={pts} height={270} legend={`Homes and apartment communities within ${num(d.radius_m)} m: darker = closer`} />
            <div className={s.card}>
              <div className={s.cardHead}><b>Nearest residents</b><Tag l={d.label} /></div>
              <p className={s.note}>Nearest public home listing <b>{d.nearest_home_listing_m != null ? `${num(d.nearest_home_listing_m)} m` : 'none within range'}</b> · nearest apartment community <b>{d.nearest_apartment_community_m != null ? `${num(d.nearest_apartment_community_m)} m` : 'none within range'}</b>.</p>
              <p className={s.note}>The site screen&apos;s residential gate measured {d.engine_gate_home_m != null ? `${num(d.engine_gate_home_m)} m` : 'no home'}. {d.engine_gate_note}</p>
              <h4 className={s.h4}>Generator noise at the nearest receptors <Tag l="Estimated" /></h4>
              <ul className={s.bullets}>{d.noise.receptors.map((r, i) => (
                <li key={i}>{r.kind === 'home' ? 'Home' : 'Apartment community'} at {num(r.distance_m)} m: <b>{num(r.dba, 1)} dBA</b>{r.over_limit ? ` · above the ${limit ?? ''} dBA limit` : ''}</li>
              ))}</ul>
              <small className={s.muted}>{d.noise.label}. {d.noise.basis}</small>
            </div>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th rowSpan={2}>Distance</th><th colSpan={4} className={s.groupTh}>Home listings (Homes.com)</th><th colSpan={3} className={s.groupTh}>Apartments (Apartments.com)</th></tr>
                <tr><th className={s.num}>Listed</th><th className={s.num}>For sale · median ask</th><th className={s.num}>Sold last year · median</th><th className={s.num}>For rent · median/mo</th>
                  <th className={s.num}>Communities</th><th className={s.num}>Units</th><th className={s.num}>Units available</th></tr>
              </thead>
              <tbody>{d.bands.map((b) => (
                <tr key={b.band}><td><b>{b.band}</b></td><td className={s.num}>{num(b.homes_listed)}</td>
                  <td className={s.num}>{num(b.for_sale_active)} · {usd(b.median_asking_price)}</td>
                  <td className={s.num}>{num(b.sold_last_year)} · {b.median_sold_price != null ? usd(b.median_sold_price) : b.sold_price_undisclosed ? 'undisclosed' : '—'}</td>
                  <td className={s.num}>{num(b.for_rent_active)} · {b.median_asking_rent_month != null ? `$${num(b.median_asking_rent_month)}` : '—'}</td>
                  <td className={s.num}>{num(b.apartment_communities)}</td><td className={s.num}>{num(b.apartment_units)}{b.apartment_units_unknown ? ` (+${b.apartment_units_unknown} unknown)` : ''}</td>
                  <td className={s.num}>{num(b.apartment_units_available)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {d.nearest_homes.length > 0 && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Nearest homes</th><th className={s.num}>m</th><th>Status</th><th className={s.num}>Price</th><th className={s.num}>Beds</th><th className={s.num}>sqft</th></tr></thead>
                <tbody>{d.nearest_homes.map((h, i) => (
                  <tr key={i}><td><b>{h.street ?? 'Address withheld'}</b><small>{h.city ?? ''}{h.home_type ? ` · ${h.home_type}` : ''}</small></td><td className={s.num}>{num(h.distance_m)}</td>
                    <td>{h.transaction === 'ForRent' ? 'For rent' : 'For sale'} · {h.status}</td>
                    <td className={s.num}>{h.sold_price != null ? usd(h.sold_price) : h.price_undisclosed ? 'undisclosed' : usd(h.asking_price)}</td>
                    <td className={s.num}>{num(h.beds)}</td><td className={s.num}>{num(h.sqft)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className={s.card}><div className={s.cardHead}><b>Coverage and limitations</b></div>
            <p className={s.note}>{d.wording} {d.points_total > d.points.length ? `Showing ${d.points.length} of ${d.points_total} points on the map.` : ''}</p></div>
          <small className={s.src}>{d.source}</small>
        </div>
      );
    }}</State>
  );
}

// ------------------------------------------------------------------------------------------------ 5 market
interface Dist { n: number; p25: number | null; median: number | null; p75: number | null }
interface MarketResp {
  subject: { name: string | null; property_type: string | null; lot_acres: number | null; building_sf: number | null; asking_price: number | null;
    availability: string | null; percentiles: Record<string, number | null>; percentile_note: string };
  submarket: { market: string; submarket_id: number | null; label: string; inventory: { n: number; by_type: Record<string, number>; note: string }; availability: { n: number; available: number };
    lot_acres: Dist; building_sf: Dist; asking_price: Dist & { per_acre: Dist }; heavy_power: { n: number; yes: number; share: number | null };
    transactions: { by_year: { year: number; deals: number; priced: number; volume: number }[]; deals: number; note: string };
    recent_sales: { years: number; n: number; per_sf: Dist; land_per_acre: Dist; note: string; values_per_sf?: number[] };
    freshness: { latest_sale: string | null; latest_listing: string | null }; sources: string[] };
  compare?: { rows: Loose[]; note: string };
}
/** Every year between the first and last deal, so gaps read as zero deals instead of being squeezed out of the axis. */
function yearsFilled(ys: { year: number; deals: number; priced: number; volume: number }[]) {
  if (!ys.length) return ys;
  const by = new Map(ys.map((y) => [y.year, y]));
  const out = [];
  for (let y = ys[0].year; y <= ys[ys.length - 1].year; y++) out.push(by.get(y) ?? { year: y, deals: 0, priced: 0, volume: 0 });
  return out;
}
function MarketTab({ id, lotAcres }: { id: string; lotAcres?: number | null }) {
  const api = useApi<MarketResp>(`/costar/market/${encodeURIComponent(id)}`);
  const comps = useApi<CompsResp>(`/costar/land/${encodeURIComponent(id)}`);
  const mk = api.data?.submarket.market;
  const subs = useApi<{ rows: Loose[]; note: string }>(mk ? `/costar/submarkets?market=${encodeURIComponent(mk)}` : null);
  return (
    <State api={api} what="Market context">{(d) => {
      const m = d.submarket, sub = d.subject;
      const rows: [string, string, string, number | null | undefined][] = [
        ['Lot size', `${num(sub.lot_acres ?? lotAcres, 1)} acres`, `median ${num(m.lot_acres.median, 1)} (n ${m.lot_acres.n})`, sub.percentiles.lot_acres],
        ['Building area', `${num(sub.building_sf)} sf`, `median ${num(m.building_sf.median)} (n ${m.building_sf.n})`, sub.percentiles.building_sf],
        ['Asking price', usd(sub.asking_price), `median ${usd(m.asking_price.median)} (n ${m.asking_price.n})`, sub.percentiles.asking_price],
        ['Asking $/acre', sub.asking_price && sub.lot_acres ? usd(sub.asking_price / sub.lot_acres) : '—', `median ${usd(m.asking_price.per_acre.median)} (n ${m.asking_price.per_acre.n})`, sub.percentiles.asking_per_acre],
      ];
      const ps = (comps.data?.comps ?? []).filter((c) => !c.is_subject && c.used).map((c) => (comps.data!.basis === 'sf' ? c.per_sf : c.land_per_acre)).filter((x): x is number => x != null);
      const psUnit = comps.data?.unit ?? '$/SF';
      const compare = subs.data ?? d.compare;
      return (
        <div className={s.stack}>
          <div className={s.cardHead}><b>{m.label}</b><Tag l="Sourced" /><span className={s.muted}>{m.inventory.n} kit properties · {m.availability.available} marketed now · heavy power {pct(m.heavy_power.share)} (n {m.heavy_power.n})</span></div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Measure</th><th>This site</th><th>Submarket</th><th className={s.num}>Percentile</th></tr></thead>
              <tbody>{rows.map(([k, a, b, p]) => (
                <tr key={k}><td>{k}</td><td><b>{a}</b></td><td>{b}</td><td className={s.num}>{p != null ? <span className={s.pctl} style={{ ['--v' as string]: p / (p > 1 ? 100 : 1) }}>{num(p > 1 ? p : p * 100)}th</span> : '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className={s.twoCol}>
            <BarChart title={`Sale transactions by year · ${m.transactions.deals} deals`} bars={yearsFilled(m.transactions.by_year).map((y) => ({ label: String(y.year), value: y.deals, tip: `${y.deals} deal(s), ${y.priced} with a disclosed price${y.volume ? `, ${usd(y.volume)}` : ''}` }))} unit=" deals" />
            {ps.length >= 3 ? <Histogram title={`Nearby sale comps · ${psUnit} distribution (n ${ps.length})`} values={ps} fmt={(n) => (psUnit === '$/SF' ? `$${Math.round(n)}` : usd(n, 0))} />
              : <div className={s.card}><div className={s.cardHead}><b>Recent sales, last {m.recent_sales.years} years</b><Tag l="Sourced" /></div>
                <p className={s.note}>$/SF median {m.recent_sales.per_sf.median != null ? `$${num(m.recent_sales.per_sf.median, 2)}` : '—'} (P25 {m.recent_sales.per_sf.p25 != null ? `$${num(m.recent_sales.per_sf.p25, 2)}` : '—'}, P75 {m.recent_sales.per_sf.p75 != null ? `$${num(m.recent_sales.per_sf.p75, 2)}` : '—'}, n {m.recent_sales.per_sf.n}). Land $/acre median {usd(m.recent_sales.land_per_acre.median)} (n {m.recent_sales.land_per_acre.n}).</p>
                <p className={s.note}>{m.recent_sales.note}</p></div>}
          </div>
          {compare && compare.rows.length > 0 && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Submarket</th><th className={s.num}>Properties</th><th className={s.num}>Available</th><th className={s.num}>Median lot</th><th className={s.num}>Median asking</th><th className={s.num}>Deals</th><th className={s.num}>Recent $/SF</th></tr></thead>
                <tbody>{[...compare.rows.slice(0, 10), ...compare.rows.slice(10).filter((r) => r.label === m.label)].map((r, i) => (
                  <tr key={i} className={r.label === m.label ? s.hiRow : ''}><td>{String(r.label)}</td><td className={s.num}>{num(r.properties as number)}</td><td className={s.num}>{num(r.available as number)}</td>
                    <td className={s.num}>{num(r.median_lot_acres as number, 1)}</td><td className={s.num}>{usd(r.median_asking_price as number)}</td><td className={s.num}>{num(r.deals as number)}</td>
                    <td className={s.num}>{r.recent_median_per_sf != null ? `$${num(r.recent_median_per_sf as number, 2)}` : '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className={s.note}>{m.inventory.note} {m.transactions.note} {sub.percentile_note}</p>
          <small className={s.src}>{m.sources.join(' · ')} · latest sale {m.freshness.latest_sale?.slice(0, 10) ?? '—'}</small>
        </div>
      );
    }}</State>
  );
}

export default CostarDossier;
