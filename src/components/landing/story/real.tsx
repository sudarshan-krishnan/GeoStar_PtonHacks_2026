'use client';
// The real-data threads woven through the story. The acts teach with illustrative figures; these sections show the
// same ideas on an actual CoStar parcel in Houston: the Vexcel aerial, the public-data gates, the layout engine's plan,
// its numbers, and the decisions stored in MongoDB Atlas. When the API is down they say so; nothing is mocked.
import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight, Check, CircleAlert, Database, Satellite, ShieldCheck } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import { Plan2D, type Layers } from '@/components/studio/plan2d';
import type { StudioResult } from '@/components/studio/types';
import { TypeChips } from './acts';
import type { TypeStory } from './data';

/** A Houston parcel from the CoStar extract with Vexcel coverage; its name and address stay on this machine. */
export const PARCEL = 'costar:9220364';
const LAT = 29.9287658, LON = -95.3390666;
const AERIAL = `${PUBLIC_DATA_API}/vexcel/ortho/${PARCEL}.jpg?buffer_m=500`;
const BRIEF = { name: 'Houston 20 MW', mw_it: 20, rack_kw: 20, redundancy: 'N+1', cooling: 'liquid', halls: null, site_w: 320, site_d: 240,
  setback_m: 8, expansion_pct: 10, flexible_share: 0.3, storeys: 1, rent_kw_month: null };
const LAYERS: Layers = { racks: true, labels: false, power: true, cooling: true, data: false, yard: true, site: true, tags: false,
  aerial: true, roof: 1, level: null, explode: 0, context: false };

type Gate = { gate: string; status: 'Pass' | 'Fail' | 'Needs review'; value: string | number | null; unit?: string | null };
type Decision = { event: string; at: string; mw_it: number; summary?: { concept?: string; capex?: number } };
export interface Live { result: StudioResult | null; gates: Gate[]; decisions: Decision[] | null; down: boolean }

const m$ = (n: number) => `$${(n / 1e6).toFixed(0)}M`;

/** One fetch for the whole page: screen the parcel, lay it out, and read the latest stored decisions. */
export function useLive(): Live {
  const [live, setLive] = useState<Live>({ result: null, gates: [], decisions: null, down: false });
  useEffect(() => {
    const ctl = new AbortController();
    const post = (path: string, body: unknown) => fetch(`${PUBLIC_DATA_API}${path}`, { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    post('/sites/evaluate', { lat: LAT, lon: LON, acres: 20, market: 'Houston', thresholds: { min_home_distance_m: 300 }, name: 'Landing parcel' })
      .then((s) => {
        const gates = (s?.screen?.gates ?? []) as Gate[];
        setLive((l) => ({ ...l, gates }));
        return post('/studio/generate', { brief: BRIEF, site: { id: PARCEL, lat: LAT, lon: LON, gates }, priorities: {}, edits: {} });
      })
      .then((result) => setLive((l) => ({ ...l, result })))
      .catch(() => setLive((l) => ({ ...l, down: true })));
    fetch(`${PUBLIC_DATA_API}/atlas/decisions`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLive((l) => ({ ...l, decisions: (d.decisions ?? []).slice(0, 5) })))
      .catch(() => setLive((l) => ({ ...l, decisions: [] })));
    return () => ctl.abort();
  }, []);
  return live;
}

/* ---------------------------------------------------------------- the opening */

export function RealHero({ type, onType, live }: { type: TypeStory; onType: (id: TypeStory['id']) => void; live: Live }) {
  const homes = live.result?.site.home_distance_m, power = live.result?.site.substation_km;
  const pass = live.gates.filter((g) => g.status === 'Pass').length;
  return (
    <section className="ps-rhero" data-hero aria-labelledby="ps-hero-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="ps-rhero-img" src={AERIAL} alt="" aria-hidden="true" />
      <div className="ps-rhero-wash" aria-hidden="true" />
      <div className="ps-rhero-copy">
        <p className="ps-kicker" data-reveal><i />For commercial builders and developers</p>
        <h1 id="ps-hero-title" data-reveal>Site intelligence for<br /><em>AI infrastructure.</em></h1>
        <p className="ps-lede" data-reveal>
          GeoStar finds the right place to build, designs what goes on it, and protects it once people move in. Every
          number is traced to its source, from the first map to the last alarm that never had to ring.
        </p>
        <div className="ps-ask" data-reveal>
          <span className="ps-ask-q">What are you building?</span>
          <TypeChips type={type} onType={onType} />
          <p className="ps-ask-a" aria-live="polite"><span key={type.id}>{type.question}</span></p>
        </div>
        <div className="ps-actions" data-reveal>
          <Link href="/studio" className="ps-btn ps-btn-ink">Start a project <ArrowRight size={16} /></Link>
          <Link href="/explore" className="ps-btn ps-btn-soft">Explore the map</Link>
        </div>
      </div>
      <aside className="ps-rhero-card ps-glass" aria-label="This parcel, screened live" data-reveal style={{ '--i': 3 } as CSSProperties}>
        <span className="ps-live"><i />Screened live</span>
        <b>A real Houston parcel</b>
        <dl>
          <div><dt>Hard gates</dt><dd>{live.gates.length ? `${pass} of ${live.gates.length} pass` : live.down ? 'API offline' : '…'}</dd></div>
          <div><dt>Nearest home</dt><dd>{homes != null ? `${Math.round(homes).toLocaleString()} m` : '…'}</dd></div>
          <div><dt>To ≥138 kV power</dt><dd>{power != null ? `${power.toFixed(1)} km` : '…'}</dd></div>
        </dl>
        <small>CoStar parcel · FEMA · WRI Aqueduct · OpenStreetMap</small>
      </aside>
      <span className="ps-rhero-credit"><Satellite size={12} /> Aerial · Vexcel Imaging · Houston, TX</span>
    </section>
  );
}

/* ---------------------------------------------------------------- why now */

// CoStar News, Lou Hirsh, 5 Oct 2026: "Data center growth expected to hold steady in face of project protests".
const STATS_SRC = 'https://www.costar.com/article/1532454970/goldman-reports-data-center-capacity-growth-holds-firm-despite-rising-project-resistance';
const STATS = [
  ['64 GW', 'US data center capacity Goldman Sachs expects by the end of 2026'],
  ['1,500+', 'data center projects in planning nationwide (Pew Research Center)'],
  ['~400', 'US cities and towns considering moratoriums on new data centers'],
  ['14', 'states considering the same'],
] as const;

export function WhyNow() {
  return (
    <section className="ps-why" aria-labelledby="ps-why-title">
      <header className="ps-why-head">
        <p className="ps-eyebrow" data-reveal><b>Why now</b><i />The context</p>
        <h2 id="ps-why-title" data-reveal>The country is building faster than<br /><em>towns are saying yes.</em></h2>
      </header>
      <ul className="ps-stats">
        {STATS.map(([v, d], i) => (
          <li key={v} className="ps-neu ps-stat" data-reveal style={{ '--i': i } as CSSProperties}><b>{v}</b><span>{d}</span></li>
        ))}
      </ul>
      <p className="ps-why-src" data-reveal>
        Source: <a href={STATS_SRC} target="_blank" rel="noreferrer">CoStar News, “Data center growth expected to hold steady in face of project protests,” 5 Oct 2026 <ArrowUpRight size={12} /></a>.
        Figures as reported by CoStar from Goldman Sachs and the Pew Research Center.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- the real plan, between Find and Design */

export function LivePlan({ live }: { live: Live }) {
  const r = live.result;
  const best = useMemo(() => r?.concepts.find((c) => c.rank === 1) ?? r?.concepts[0] ?? null, [r]);
  return (
    <section className="ps-real" aria-labelledby="ps-real-title">
      <header className="ps-real-head">
        <p className="ps-eyebrow" data-reveal><b>Interlude</b><i />The real thing</p>
        <h2 id="ps-real-title" data-reveal>Act I was a lesson.<br /><em>This parcel is real.</em></h2>
        <p className="ps-act-lede" data-reveal>
          A CoStar parcel in north Houston, screened against public data, then laid out by GeoStar&apos;s engine on the
          Vexcel aerial. The halls, the substation yard and the power and cooling routes below are computed, not drawn.
        </p>
      </header>
      <div className="ps-real-grid">
        <figure className="ps-real-plan ps-neu" data-reveal>
          {best && r ? (
            <Plan2D concept={best} siteW={r.brief.site_w} siteD={r.brief.site_d} setback={r.brief.setback_m} layers={LAYERS} aerialId={PARCEL} />
          ) : <div className="ps-real-wait">{live.down ? 'The layout engine is offline. Start the API to see the live plan.' : 'Laying out three concepts…'}</div>}
          <figcaption>{best ? `${best.name} · ${r!.brief.racks.toLocaleString()} racks in ${r!.brief.halls} halls · ${r!.brief.facility_mw} MW facility` : 'Layout engine'}</figcaption>
        </figure>
        <ol className="ps-real-gates" aria-label="Hard gates on this parcel">
          {(live.gates.length ? live.gates : Array.from({ length: 5 }, () => null)).map((g, i) => (
            // rows arrive with the data, after the page's reveal observer has run, so they animate in with CSS instead
            <li key={g?.gate ?? `wait-${i}`} className={`ps-glass ${g ? `g-${g.status.replace(/\s/g, '-')}` : 'g-wait'}`} style={{ '--i': i } as CSSProperties}>
              {g ? (g.status === 'Pass' ? <Check size={15} /> : <CircleAlert size={15} />) : <i />}
              <span>{g?.gate ?? 'Checking…'}</span>
              <b>{g ? `${g.status}${g.value != null && typeof g.value === 'number' ? ` · ${g.value.toLocaleString()} ${g.unit ?? ''}` : ''}` : ''}</b>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- live numbers, after Design */

export function LiveNumbers({ live }: { live: Live }) {
  const r = live.result;
  const best = r?.concepts.find((c) => c.rank === 1) ?? null;
  return (
    <section className="ps-nums" aria-labelledby="ps-nums-title">
      <header className="ps-real-head">
        <p className="ps-eyebrow" data-reveal><b>Proof</b><i />Live from the engine</p>
        <h2 id="ps-nums-title" data-reveal>Three ways to build it,<br /><em>weighed honestly.</em></h2>
      </header>
      <div className="ps-nums-grid">
        <div className="ps-card ps-glass" data-reveal>
          <header><b>Compare</b><small>{r ? `${r.finance.label} · ${r.finance.analysis_years}-year NPV` : 'Layout engine'}</small></header>
          {r ? (
            <table>
              <thead><tr><th>Concept</th><th>Build</th><th>NPV P50</th><th>Noise at edge</th></tr></thead>
              <tbody>{r.concepts.map((c) => (
                <tr key={c.id} className={c.rank === 1 ? 'lead' : ''}><td>{c.rank === 1 && <Check size={12} />}{c.name}</td><td>{m$(c.money.capex)}</td>
                  <td>{m$(c.money.npv_p50)}</td><td>{c.people.noise_at_boundary_dba.toFixed(0)} dBA</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="ps-dim">{live.down ? 'API offline' : 'Computing…'}</p>}
          {r?.ranking.close && <footer>{r.ranking.note}</footer>}
        </div>
        <div className="ps-card ps-glass" data-reveal style={{ '--i': 1 } as CSSProperties}>
          <header><b>Scores</b><small>{best?.name ?? 'Best concept'}</small></header>
          {best ? (['money', 'people', 'planet', 'resources'] as const).map((f) => {
            const v = Math.round(best.scores[f] <= 1 ? best.scores[f] * 100 : best.scores[f]);
            return <div key={f} className="ps-bar"><span>{f}</span><i><b style={{ width: `${v}%` }} /></i><em>{v}</em></div>;
          }) : <p className="ps-dim">{live.down ? 'API offline' : 'Computing…'}</p>}
        </div>
        <div className="ps-card ps-glass" data-reveal style={{ '--i': 2 } as CSSProperties}>
          <header><b>Decisions</b><small><Database size={11} /> MongoDB Atlas · live</small></header>
          {live.decisions === null ? <p className="ps-dim">Loading…</p> : live.decisions.length === 0 ? <p className="ps-dim">No decisions stored yet.</p> : (
            <ul className="ps-feed-list">{live.decisions.map((d, i) => (
              <li key={i}><i className={d.event.endsWith('decided') ? 'ok' : ''} /><span>{d.event.replace('project.', '')} · {d.summary?.concept ?? '—'} · {d.mw_it} MW</span>
                <time>{new Date(d.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></li>
            ))}</ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- sources, before the close */

const SOURCES = [
  ['CoStar', 'Parcels, comps, tenancy, the MCP server'], ['Vexcel', 'Aerial photos and 3D city meshes'],
  ['Matterport', 'Scans, pinned notes, measurements'], ['ERCOT', 'Prices and grid carbon'], ['FEMA', 'Flood zones'],
  ['WRI Aqueduct', 'Water stress'], ['OpenStreetMap', 'Homes, schools, power lines'], ['MongoDB Atlas', 'Projects, decisions, telemetry'],
] as const;
const DEEPER = [
  ['/studio/agent', 'How the AI works', 'Watch the Deep Agents evaluate a parcel, live.'],
  ['/studio/data', 'The data platform', 'Search, vectors, geo and change streams in Atlas.'],
  ['/explore', 'Explore the map', 'Real CoStar parcels, gated by public data.'],
] as const;

export function Sources() {
  return (
    <section className="ps-srcs" aria-labelledby="ps-srcs-title">
      <header className="ps-real-head light">
        <p className="ps-eyebrow" data-reveal><b>Trust</b><i />Every number has a source</p>
        <h2 id="ps-srcs-title" data-reveal>Nothing typed in by hand.<br /><em>Everything labelled.</em></h2>
      </header>
      <ul className="ps-srcs-grid">
        {SOURCES.map(([n, d], i) => <li key={n} data-reveal style={{ '--i': i % 4 } as CSSProperties}><ShieldCheck size={14} /><b>{n}</b><span>{d}</span></li>)}
      </ul>
      <div className="ps-deeper">
        {DEEPER.map(([h, t, d], i) => (
          <Link key={h} href={h} className="ps-deeper-card ps-glass-dark" data-reveal style={{ '--i': i } as CSSProperties}>
            <b>{t}</b><span>{d}</span><ArrowUpRight size={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}
