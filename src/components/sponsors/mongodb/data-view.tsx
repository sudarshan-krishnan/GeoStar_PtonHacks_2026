'use client';
// Judge-facing view of GeoStar's MongoDB Atlas data platform. Every panel is a live call to the data service:
// schema/index status, Atlas Search with facets, Vector Search over site embeddings, $geoNear, $facet analytics,
// the decisions audit trail, and a change-stream feed over SSE. Nothing here is mocked.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, Boxes, Clock, Database, GitBranch, Layers, MapPin, Search, Sparkles, Table } from 'lucide-react';
import { Brand } from '../../brand';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import { BarChart, LineChart, OTHER, ScatterChart, SLOT } from '../../ui/charts';

interface ChartData {
  telemetry_minutes: { minute: string; machine: string; avg_watts: number }[];
  telemetry_raw: { ts: string; machine: string; watts: number | null }[];
  price_day: { date: string; prices: number[]; hub: string } | null;
  gate_fails: { gate: string; fails: number }[];
  projects: { id: string; name: string; cooling: string; capex: number; npv: number; mw_it: number; status: string }[];
}
interface TrigStatus { running: boolean; events: number; alerts: number; windows: number; rules: string[]; atlas_triggers: string[]; error: string | null; counts?: Record<string, number> }
interface Note { kind: string; source: string; message: string; at: string; by?: string | null }
const COOL: Record<string, string> = { liquid: SLOT[0], air: SLOT[1], hybrid: SLOT[2] };

interface CollInfo { documents: number; indexes: string[]; validator: boolean; timeseries: Record<string, unknown> | null; search_indexes: { name: string; type: string; status: string; queryable: boolean }[] }
interface Status { available: boolean; reason?: string; database?: string; collections?: Record<string, CollInfo>; embeddings?: { model: string; dims: number; enabled: boolean } }
// Atlas returns ids + public-source facts only; CoStar names/addresses are hydrated from the LOCAL kit by id.
interface Hit { parcel_id: string; market: string; screen_status: string; home_distance_m?: number | null; substation_km?: number | null; score: number; loc?: { coordinates: [number, number] }; distance_m?: number }
type Names = Record<string, { name: string; address: string }>;
interface SearchOut { hits: Hit[]; facets: Record<string, { _id: string; count: number }[]>; total: number }
interface SimilarOut { hits: Hit[]; model: string | null; note?: string | null }
interface Analytics {
  sites: { by_market: { _id: string; sites: number; passing: number; avg_substation_km: number | null }[]; by_status: { _id: string; n: number }[];
    substation_buckets: { _id: number | string; n: number }[]; home_buckets: { _id: number | string; n: number }[];
    gate_fails: { _id: string; fails: number }[] };
  projects: { by_cooling: { _id: string; n: number; mw: number }[]; totals: { projects: number; mw: number; capex: number; decided: number }[]; deciders: { _id: string; n: number }[] };
  grid_days: { _id: string; days: number; avg_price: number; max_peak: number; first: string; last: string }[];
  telemetry_24h: { _id: string; points: number; avg_watts: number | null; max_watts: number | null }[];
  evidence: { _id: string; fetches: number; bytes: number }[];
}
interface Decision { project_id: string; event: string; at: string; by: string | null; status: string | null; mw_it?: number }
interface Ev { type: string; collection?: string; doc?: Record<string, unknown>; at: string; error?: string }

const api = (p: string) => fetch(`${PUBLIC_DATA_API}${p}`).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail || `${r.status}`); return r.json(); });
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
const num = (n: number | null | undefined, d = 0) => (n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(n));
const SAMPLE_Q = ['greens', 'presidents park', 'navigation', 'rankin'];
const SAMPLE_SIM = ['large industrial lot near the airport with no flood risk', 'small flex building close to high-voltage power', 'land priced under a million per acre, away from homes'];

export function DataView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [q, setQ] = useState('greens');
  const [search, setSearch] = useState<SearchOut | null>(null);
  const [simQ, setSimQ] = useState(SAMPLE_SIM[0]);
  const [sim, setSim] = useState<SimilarOut | null>(null);
  const [near, setNear] = useState<{ around: Hit; sites: Hit[] } | null>(null);
  const [an, setAn] = useState<Analytics | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [feed, setFeed] = useState<Ev[]>([]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [charts, setCharts] = useState<ChartData | null>(null);
  const [trig, setTrig] = useState<TrigStatus | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [alerts, setAlerts] = useState<Note[]>([]);
  const [names, setNames] = useState<Names>({});
  const [maxKm, setMaxKm] = useState('5');
  const [minHome, setMinHome] = useState('300');
  // hydrate CoStar names/addresses from the local data service (they are deliberately not stored in Atlas)
  const hydrate = useCallback((hits: Hit[]) => {
    hits.filter((h) => !names[h.parcel_id]).forEach((h) => {
      api(`/sites/${encodeURIComponent(h.parcel_id)}`).then((d) => {
        const p = d?.parcel ?? {};
        setNames((n) => ({ ...n, [h.parcel_id]: { name: p.name || p.address || h.parcel_id, address: [p.address, p.city].filter(Boolean).join(', ') } }));
      }).catch(() => setNames((n) => ({ ...n, [h.parcel_id]: { name: h.parcel_id, address: '' } })));
    });
  }, [names]);
  const nm = (h: Hit) => names[h.parcel_id]?.name ?? h.parcel_id;
  const addr = (h: Hit) => names[h.parcel_id]?.address ?? '';
  const facts = (h: Hit) => `${h.home_distance_m != null ? `${num(h.home_distance_m)} m to homes` : 'homes: unknown'} · ${h.substation_km != null ? `${h.substation_km} km to power` : 'power: unknown'}`;
  const es = useRef<EventSource | null>(null);

  const fail = (k: string) => (e: Error) => setErr((x) => ({ ...x, [k]: e.message }));
  const doSearch = useCallback((km: string, home: string) => {
    const qs = new URLSearchParams({ limit: '6' });
    if (km) qs.set('max_substation_km', km);
    if (home) qs.set('min_home_m', home);
    api(`/atlas/search?${qs}`).then((d) => { setSearch(d); hydrate(d.hits); }).catch(fail('search'));
  }, [hydrate]);
  // passing_only: show sites a developer could actually use, not just the closest wording
  const doSim = useCallback((text: string) => { setSim(null); api(`/atlas/similar?q=${encodeURIComponent(text)}&limit=5&passing_only=true`).then((d) => { setSim(d); hydrate(d.hits); }).catch(fail('similar')); }, [hydrate]);
  const doNear = useCallback((h: Hit) => {
    if (!h.loc) return;
    const [lon, lat] = h.loc.coordinates;
    api(`/atlas/near?lat=${lat}&lon=${lon}&km=5&limit=6`).then((d) => { const s = d.sites.filter((x: Hit) => x.parcel_id !== h.parcel_id); setNear({ around: h, sites: s }); hydrate(s); }).catch(fail('near'));
  }, [hydrate]);

  useEffect(() => {
    api('/atlas/status').then(setStatus).catch(() => setStatus({ available: false, reason: 'data service unreachable' }));
    api('/atlas/analytics').then(setAn).catch(fail('analytics'));
    api('/atlas/decisions?limit=12').then((d) => setDecisions(d.decisions)).catch(fail('decisions'));
    api('/atlas/charts').then(setCharts).catch(fail('charts'));
    const pollTrig = () => { api('/atlas/triggers').then(setTrig).catch(() => {}); api('/atlas/notifications?limit=8').then((d) => setNotes(d.notifications)).catch(() => {}); api('/atlas/alerts?limit=6').then((d) => setAlerts(d.alerts)).catch(() => {}); };
    pollTrig();
    const tmr = setInterval(pollTrig, 8000);
    const stopTimer = () => clearInterval(tmr);
    window.addEventListener('beforeunload', stopTimer);
    doSearch('5', '300'); doSim(SAMPLE_SIM[0]);
    const s = new EventSource(`${PUBLIC_DATA_API}/atlas/stream`);
    es.current = s;
    const on = (e: MessageEvent) => { try { const ev = JSON.parse(e.data) as Ev; if (ev.type !== 'heartbeat') setFeed((f) => [ev, ...f].slice(0, 12)); } catch { /* ignore */ } };
    for (const t of ['open', 'insert', 'update', 'replace', 'delete', 'error', 'unavailable']) s.addEventListener(t, on as EventListener);
    return () => { s.close(); stopTimer(); window.removeEventListener('beforeunload', stopTimer); };
  }, [doSearch, doSim]);

  const wattSeries = (() => {
    if (!charts) return [];
    const byMachine = (rows: { key: string; machine: string; v: number | null }[]) =>
      ['baseline', 'plotstar'].map((m, i) => ({ name: m === 'plotstar' ? 'geostar' : m, color: SLOT[i], points: rows.filter((r) => r.machine === m && r.v != null).map((r) => ({ x: Date.parse(r.key), y: r.v as number })) })).filter((s) => s.points.length);
    const mins = byMachine(charts.telemetry_minutes.map((r) => ({ key: r.minute, machine: r.machine, v: r.avg_watts })));
    return mins.some((s) => s.points.length >= 2) ? mins : byMachine(charts.telemetry_raw.map((r) => ({ key: r.ts, machine: r.machine, v: r.watts })));
  })();
  const hhmm = (x: number) => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const colls = Object.entries(status?.collections ?? {}).filter(([n]) => !n.startsWith('system.'));
  const totalDocs = colls.reduce((a, [, c]) => a + c.documents, 0);
  const searchIdx = colls.flatMap(([n, c]) => c.search_indexes.map((i) => ({ coll: n, ...i })));
  const tot = an?.projects.totals[0];

  return (
    <div className="st dt">
      <header className="st-top">
        <Brand />
        <div className="st-top-title"><b>Data</b><span>MongoDB Atlas, live</span></div>
        <nav className="st-top-nav">
          <Link href="/studio/agent">How the AI works</Link>
          <Link href="/studio">Open the studio</Link>
          <Link href="/">Home</Link>
        </nav>
      </header>

      <main className="dt-main">
        <section className="dt-hero">
          <small className="st-eyebrow">MongoDB Atlas · {status?.database ?? '…'}</small>
          <h1>Every site, decision and watt, queryable.</h1>
          <p className="dt-lede">GeoStar keeps its CoStar parcels, Studio projects, audit trail, grid prices and live hardware telemetry in Atlas:
            JSON-schema-validated collections, a time-series collection, 2dsphere geo, Atlas Search, Vector Search and change streams.
            Everything on this page is a live query.</p>
          {status && !status.available && <p className="dt-err">Atlas is not reachable: {status.reason}</p>}
        </section>

        {/* schema + index status */}
        <section className="dt-cards">
          <Card icon={Database} label="Collections" value={`${colls.length}`} sub={`${num(totalDocs)} documents`} />
          <Card icon={Layers} label="Schema" value={`${colls.filter(([, c]) => c.validator).length} validated`} sub="$jsonSchema on every app collection" />
          <Card icon={Clock} label="Time-series" value={colls.some(([, c]) => c.timeseries) ? 'On' : 'Off'} sub="grid_telemetry · seconds · 7-day TTL" />
          <Card icon={Search} label="Atlas Search" value={`${searchIdx.filter((i) => i.type === 'search' && i.queryable).length} index`} sub="fuzzy text + facets" />
          <Card icon={Sparkles} label="Vector Search" value={`${searchIdx.filter((i) => i.type === 'vectorSearch' && i.queryable).length} indexes`} sub={`${status?.embeddings?.dims ?? 768}-d cosine`} />
          <Card icon={Activity} label="Change streams" value={feed.some((e) => e.type === 'open') ? 'Live' : '…'} sub="projects · decisions · sites" />
        </section>

        <section className="dt-grid">
          <div className="st-card dt-coll">
            <h3><Table size={15} /> Collections</h3>
            <table className="dt-table"><thead><tr><th>Collection</th><th className="n">Docs</th><th className="n">Indexes</th><th>Validator</th><th>Special</th></tr></thead><tbody>
              {colls.sort((a, b) => b[1].documents - a[1].documents).map(([n, c]) => (
                <tr key={n}><td><code>{n}</code></td><td className="n">{num(c.documents)}</td><td className="n">{c.indexes.length}</td>
                  <td>{c.validator ? <span className="dt-ok">$jsonSchema</span> : <span className="dt-muted">—</span>}</td>
                  <td>{c.timeseries ? <span className="dt-tag">time-series</span> : null}{c.search_indexes.map((i) => <span key={i.name} className={`dt-tag ${i.queryable ? '' : 'dt-tag-wait'}`}>{i.type === 'vectorSearch' ? 'vector' : 'search'}: {i.name}</span>)}
                    {c.indexes.some((i) => i.includes('2dsphere')) && <span className="dt-tag">2dsphere</span>}</td></tr>
              ))}
            </tbody></table>
          </div>

          <div className="st-card dt-feed">
            <h3><Activity size={15} /> Live change stream</h3>
            <ul>
              {feed.length === 0 && <li className="dt-muted">Waiting for events… save a project in the Studio and it appears here.</li>}
              {feed.map((e, i) => (
                <li key={i}><span className={`dt-ev dt-ev-${e.type}`}>{e.type}</span><code>{e.collection ?? ''}</code>
                  <span className="dt-evdoc">{e.error ?? (e.doc ? Object.entries(e.doc).filter(([k]) => ['name', 'event', 'status', 'mw_it', 'parcel_id'].includes(k)).map(([k, v]) => `${k}=${String(v)}`).join(' · ') : (e.type === 'open' ? 'watching' : ''))}</span>
                  <small>{e.at.slice(11, 19)}</small></li>
              ))}
            </ul>
          </div>
        </section>

        {/* Atlas Search */}
        <section className="st-card dt-search">
          <h3><Search size={15} /> Atlas Search <span className="dt-muted">range filters + facets over public-source facts; CoStar names hydrate locally by id</span></h3>
          <form onSubmit={(e) => { e.preventDefault(); doSearch(maxKm, minHome); }}>
            <label className="dt-inline">within <input className="dt-num" inputMode="decimal" value={maxKm} onChange={(e) => setMaxKm(e.target.value)} /> km of a ≥138 kV substation</label>
            <label className="dt-inline">and at least <input className="dt-num" inputMode="numeric" value={minHome} onChange={(e) => setMinHome(e.target.value)} /> m from homes</label>
            <button className="st-btn primary" type="submit">Search</button>
            {[['2', '500'], ['5', '300'], ['10', '0']].map(([k, h]) => <button key={k + h} type="button" className="dt-chip" onClick={() => { setMaxKm(k); setMinHome(h); doSearch(k, h); }}>≤{k} km · ≥{h} m</button>)}
          </form>
          {err.search && <p className="dt-err">{err.search}</p>}
          {search && (
            <div className="dt-two">
              <ul className="dt-hits">{search.hits.map((h) => (
                <li key={h.parcel_id} onClick={() => doNear(h)} title="Click: what else is near this parcel">
                  <b>{nm(h)}</b><span>{addr(h) || <code>{h.parcel_id}</code>}</span>
                  <small>{facts(h)} · <em className={`dt-st dt-st-${h.screen_status.replace(/\s/g, '')}`}>{h.screen_status}</em>{h.score > 0 ? ` · score ${h.score.toFixed(2)}` : ''}</small>
                </li>))}</ul>
              <div className="dt-facets">{Object.entries(search.facets).map(([k, v]) => (
                <div key={k}><small>{k.replace('_', ' ')}</small>{v.map((b) => <span key={b._id} className="dt-chip static">{b._id} <b>{b.count}</b></span>)}</div>))}
                <p className="dt-muted">{search.total} matching parcels · index <code>sites_search</code> · Atlas stores ids, locations and FEMA/WRI/OSM facts; the CoStar record stays on this machine</p></div>
            </div>
          )}
        </section>

        {/* Vector Search + geoNear */}
        <section className="dt-two">
          <div className="st-card">
            <h3><Sparkles size={15} /> Vector Search <span className="dt-muted">describe the site you want</span></h3>
            <form onSubmit={(e) => { e.preventDefault(); doSim(simQ); }}>
              <input value={simQ} onChange={(e) => setSimQ(e.target.value)} />
              <button className="st-btn primary" type="submit">Find similar</button>
            </form>
            <div className="dt-chips">{SAMPLE_SIM.map((s) => <button key={s} className="dt-chip" onClick={() => { setSimQ(s); doSim(s); }}>{s}</button>)}</div>
            {err.similar && <p className="dt-err">{err.similar}</p>}
            {sim && (
              <>
                <ul className="dt-hits">{sim.hits.map((h) => (
                  <li key={h.parcel_id} onClick={() => doNear(h)}><b>{nm(h)}</b><span>{addr(h) || <code>{h.parcel_id}</code>}</span>
                    <small>{facts(h)} · <em className={`dt-st dt-st-${h.screen_status.replace(/\s/g, '')}`}>{h.screen_status}</em> · similarity {h.score.toFixed(3)}</small></li>))}</ul>
                <p className="dt-muted">$vectorSearch on <code>sites_vec</code> · embeddings: <code>{sim.model ?? 'none'}</code>{sim.note ? ` · ${sim.note}` : ''}</p>
              </>
            )}
          </div>
          <div className="st-card">
            <h3><MapPin size={15} /> Nearby <span className="dt-muted">$geoNear on the 2dsphere index</span></h3>
            {!near ? <p className="dt-muted">Click any parcel on this page to list what is within 5 km of it, with real distances.</p> : (
              <>
                <p className="dt-around">Around <b>{nm(near.around)}</b>{addr(near.around) ? `, ${addr(near.around)}` : ''}</p>
                <ul className="dt-hits">{near.sites.map((h) => (
                  <li key={h.parcel_id}><b>{nm(h)}</b><span>{addr(h) || <code>{h.parcel_id}</code>}</span><small>{num(h.distance_m)} m away · {facts(h)} · <em className={`dt-st dt-st-${h.screen_status.replace(/\s/g, '')}`}>{h.screen_status}</em></small></li>))}</ul>
              </>
            )}
          </div>
        </section>

        {/* analytics */}
        {an && (
          <section className="st-card">
            <h3><Boxes size={15} /> Analytics <span className="dt-muted">computed by Atlas $facet, $bucket, $group pipelines, not in the browser</span></h3>
            <div className="dt-an">
              <div><small>Sites by market</small>{an.sites.by_market.map((m) => <p key={m._id}><b>{m._id}</b> {m.sites} parcels · <span className="dt-ok">{m.passing} pass</span> · avg {m.avg_substation_km != null ? `${m.avg_substation_km.toFixed(1)} km` : '—'} to power</p>)}</div>
              <div><small>Why sites fail</small>{an.sites.gate_fails.map((g) => <Bar key={g._id} label={g._id} value={g.fails} max={Math.max(...an.sites.gate_fails.map((x) => x.fails))} />)}</div>
              <div><small>Distance to ≥138 kV power (km)</small>{an.sites.substation_buckets.map((b) => <Bar key={String(b._id)} label={b._id === 'unknown' ? 'unknown' : `${b._id}+`} value={b.n} max={Math.max(...an.sites.substation_buckets.map((x) => x.n))} />)}</div>
              <div><small>Distance to nearest home (m)</small>{an.sites.home_buckets.map((b) => <Bar key={String(b._id)} label={b._id === 'unknown' ? 'unknown' : `${b._id}+`} value={b.n} max={Math.max(...an.sites.home_buckets.map((x) => x.n))} />)}</div>
              <div><small>Projects</small>{tot && <p><b>{tot.projects}</b> projects · {num(tot.mw)} MW · {money(tot.capex)} capex · {tot.decided} decided</p>}{an.projects.by_cooling.map((c) => <Bar key={c._id} label={`${c._id} · ${num(c.mw)} MW`} value={c.n} max={Math.max(...an.projects.by_cooling.map((x) => x.n))} />)}</div>
              <div><small>ERCOT day-ahead (grid_days)</small>{an.grid_days.map((g) => <p key={g._id}><b>{g._id}</b> {g.days} days {g.first}–{g.last} · avg ${g.avg_price.toFixed(1)}/MWh · peak ${g.max_peak.toFixed(0)}</p>)}</div>
              <div><small>Hardware telemetry, last 24 h (time-series)</small>{an.telemetry_24h.length === 0 ? <p className="dt-muted">no points yet</p> : an.telemetry_24h.map((t) => <p key={t._id}><b>{t._id === 'plotstar' ? 'geostar' : t._id}</b> {t.points} points · avg {num(t.avg_watts)} W · max {num(t.max_watts)} W</p>)}</div>
              <div><small>Evidence fetches on record</small>{an.evidence.slice(0, 6).map((e) => <p key={e._id}><b>{e._id}</b> {e.fetches} · {num(e.bytes / 1024)} KB</p>)}</div>
            </div>
          </section>
        )}

        {/* charts: the same aggregations, drawn */}
        {charts && (
          <section className="st-card">
            <h3><Activity size={15} /> Charts <span className="dt-muted">drawn from Atlas aggregations; every chart has a table view</span></h3>
            <div className="dt-charts">
              <LineChart title="Hardware watts" sub={wattSeries.length ? 'baseline vs GeoStar machine, last 6 h' : 'last 6 h'} series={wattSeries} xFmt={hhmm} yFmt={(v) => `${Math.round(v)} W`} />
              <LineChart title={`ERCOT day-ahead price, ${charts.price_day?.date ?? '—'}`} sub={charts.price_day ? `${charts.price_day.hub}, $/MWh by hour ending` : undefined} labelPeak
                series={charts.price_day ? [{ name: 'price', color: SLOT[0], points: charts.price_day.prices.map((p, i) => ({ x: i + 1, y: p })) }] : []} xFmt={(x) => `${x}:00`} yFmt={(v) => `$${v.toFixed(0)}`} />
              <BarChart title="Why sites fail" sub="parcels failing each hard gate" rows={charts.gate_fails.map((g) => ({ label: g.gate, value: g.fails }))} />
              <ScatterChart title="Projects: cost to build vs NPV" sub="colour = cooling; grey = other" xLabel="Cost to build ($)" yLabel="NPV, 15 yr ($)"
                series={[{ name: 'liquid', color: SLOT[0] }, { name: 'air', color: SLOT[1] }, { name: 'hybrid', color: SLOT[2] }]}
                points={charts.projects.map((p) => ({ x: p.capex, y: p.npv, label: p.name, series: COOL[p.cooling] ? p.cooling : 'other', extra: `${p.mw_it} MW · ${p.status}` }))}
                xFmt={(v) => `$${(v / 1e6).toFixed(0)}M`} yFmt={(v) => `${v < 0 ? '−' : ''}$${Math.abs(v / 1e6).toFixed(0)}M`} />
            </div>
          </section>
        )}

        {/* triggers: real Atlas Triggers + the in-app worker */}
        <section className="dt-two">
          <div className="st-card">
            <h3><GitBranch size={15} /> Triggers <span className="dt-muted">Atlas Triggers (App Services) and the in-app change-stream worker</span></h3>
            {!trig ? <p className="dt-muted">Loading…</p> : (
              <>
                <ul className="dt-rules">{trig.rules.map((r) => <li key={r}><span className={`dt-tag ${/Atlas/.test(r) ? '' : 'dt-tag-wait'}`}>{/Atlas/.test(r) ? 'Atlas' : 'in-app'}</span>{r.replace(/\s*\((Atlas[^)]*|in-app[^)]*)\)/, '')}</li>)}</ul>
                <p className="dt-muted">Atlas-side triggers: <code>{trig.atlas_triggers.join(', ') || 'none'}</code> · worker {trig.running ? 'running' : 'stopped'} · {trig.events} events seen{trig.counts ? ` · ${trig.counts.notifications} notifications · ${trig.counts.alerts} alerts · ${trig.counts.grid_minutes} minute windows` : ''}{trig.error ? ` · ${trig.error}` : ''}</p>
              </>
            )}
          </div>
          <div className="st-card">
            <h3><Activity size={15} /> Notifications &amp; alerts <span className="dt-muted">written by the triggers</span></h3>
            {notes.length === 0 && alerts.length === 0 ? <p className="dt-muted">Nothing yet — save a decision in the Studio, or push telemetry above {'>'}900 W.</p> : (
              <ul className="dt-notes">
                {alerts.map((a, i) => <li key={`a${i}`}><span className="dt-ev dt-ev-delete">alert</span><span>{a.message}</span><small>{a.at.slice(11, 19)}</small></li>)}
                {notes.map((n, i) => <li key={`n${i}`}><span className={`dt-ev ${n.source === 'atlas-trigger' ? 'dt-ev-insert' : 'dt-ev-open'}`}>{n.source === 'atlas-trigger' ? 'Atlas' : 'in-app'}</span><span>{n.message}</span><small>{n.at.slice(11, 19)}</small></li>)}
              </ul>
            )}
          </div>
        </section>

        {/* audit */}
        <section className="st-card">
          <h3><GitBranch size={15} /> Decision audit trail <span className="dt-muted">append-only <code>decisions</code> collection</span></h3>
          {decisions.length === 0 ? <p className="dt-muted">No events yet.</p> : (
            <table className="dt-table"><tbody>{decisions.map((d, i) => (
              <tr key={i}><td><code>{d.event}</code></td><td>{d.project_id}</td><td>{d.mw_it ? `${d.mw_it} MW` : ''}</td><td>{d.by ?? <span className="dt-muted">—</span>}</td><td className="n">{d.at.replace('T', ' ').slice(0, 19)}</td></tr>))}</tbody></table>
          )}
        </section>

        <footer className="dt-foot">
          <span>Schema, indexes and queries live in <code>services/api/app/sponsors/mongodb/atlas.py</code>. Claude Code can query this cluster directly through the MongoDB MCP server.</span>
          <Link href="/studio" className="st-btn">Open the studio <ArrowRight size={14} /></Link>
        </footer>
      </main>
    </div>
  );
}

function Card({ icon: Icon, label, value, sub }: { icon: typeof Database; label: string; value: string; sub: string }) {
  return <div className="dt-card"><span className="dt-card-ic"><Icon size={16} /></span><small>{label}</small><b>{value}</b><span>{sub}</span></div>;
}
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div className="dt-bar"><span>{label}</span><i><b style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></i><em>{value}</em></div>;
}
