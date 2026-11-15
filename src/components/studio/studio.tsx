'use client';
// GeoStar Studio: define -> discover -> explore -> analyze (compare · analyze · decide) -> deliver -> design (model · protect · deploy).
// Geometry and every number come from POST /studio/generate; nothing is computed or invented in the browser.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Box as BoxIcon, LoaderCircle, Check, CircleAlert, CircleCheck, Coins, Columns2, Download, Droplets, Leaf, Lock,
  Briefcase, Building2, Database, FileText, FileUp, House, MapPin, Move, Network, Plus, Radio, RotateCcw, RotateCw, Sparkles, Square, Star, Trash2, Users,
} from 'lucide-react';
import { Star as GeoStarMark } from '../brand';
import { PUBLIC_DATA_API, siteDetailUrl, vexcel3dRootUrl, vexcelMetaUrl, vexcelOrthoUrl } from '@/lib/plotstar-api';
import type { GateResult } from '@/lib/types';
import type { ExploreSite } from '../explore/types';
import { verdict } from '../explore/types';
import type { MapMode } from '../explore/explore-map';
import { Plan2D, type Layers } from './plan2d';
import type { MoveEdit, ViewPreset } from './model3d';
import { Copilot, type BriefPatch } from '../sponsors/langchain/copilot';
import { AgentIntel } from '../sponsors/langchain/agent-intel';
import { SiteWalk } from '../sponsors/matterport/site-walk';
import { AgentStatusPill } from '../sponsors/langchain/status-pill';
import { isActive, useAgentRun } from '../sponsors/langchain/use-agent-run';
import { Guide } from '../sponsors/elevenlabs/guide';
import { ImportDesign, type NotePreview } from './import/import-design';
import { CostarDossier } from '../sponsors/costar/dossier';
import { ExistingVsProposed } from '../sponsors/costar/existing-vs-proposed';
import { DealDesk } from '../sponsors/costar/deal/deal-desk';
import { KindPicker } from './kind-picker';
import { DroneSurvey } from './discover/drone-survey';
import { FacilityModel } from './design/facility-model';
import { KINDS } from './kind-picker';
import { ProtectModule } from '../dashboard-2/protection-workspace';
import { DeployedProjects, ProjectCommandCenter } from '../dashboard-2/deployed-projects';
import { useProtection } from '../dashboard-2/use-protection';
import type { Facility } from '@/lib/haven/engine';
import { openInvestmentMemo } from '../sponsors/costar/deal/memo';
import type { AddedType, Brief, Concept, ConceptEdit, Edits, Factor, Room, StudioResult } from './types';
import { COOLING_LABEL, ROUTE_COLOR, TYPE_STYLE, WHY, download, money, num, pct, toDxf } from './types';

const ExploreMap = dynamic(() => import('../explore/explore-map'), { ssr: false, loading: () => <div className="st-loading">Loading map…</div> });
const Model3D = dynamic(() => import('./model3d'), { ssr: false, loading: () => <div className="st-loading">Loading 3D model…</div> });

// Pages keep their own numbers (each screen and its logic is keyed to one); the rail groups them into steps.
const PAGES = ['Define', 'Discover', 'Explore', 'Analyze', 'Compare', 'Decide', 'Deliver', 'Design', 'Protect', 'Deploy'] as const;
const STEPS: { key: string; hint: string; pages: number[] }[] = [
  { key: 'Define', hint: 'Brief and site', pages: [0] }, { key: 'Discover', hint: 'Survey the site', pages: [1] },
  { key: 'Explore', hint: 'Inspect the plans', pages: [2] }, { key: 'Analyze', hint: 'Compare and decide', pages: [4, 3, 5] },
  { key: 'Deliver', hint: 'Export the concept', pages: [6] }, { key: 'Design', hint: 'Model, protect, deploy', pages: [7, 8, 9] },
];
/** Sub-tab names for steps that group several pages (Analyze: Compare first; Design: Model first). */
const TAB_LABEL: Record<number, string> = { 4: 'Compare', 3: 'Analyze', 5: 'Decide', 7: 'Model', 8: 'Protect', 9: 'Deploy' };
/** Page order for Next and Back. */
const ORDER = [0, 1, 2, 4, 3, 5, 6, 7, 8, 9];
const railOf = (page: number) => STEPS.findIndex((st) => st.pages.includes(page));
const FACTORS: { key: Factor; label: string; icon: typeof Coins; ask: string }[] = [
  { key: 'money', label: 'Money', icon: Coins, ask: 'Lowest cost to build and run for ten years' },
  { key: 'people', label: 'People', icon: Users, ask: 'Standby generators kept far from the boundary' },
  { key: 'planet', label: 'Planet', icon: Leaf, ask: 'Less build carbon, more usable roof for solar' },
  { key: 'resources', label: 'Resources', icon: Droplets, ask: 'Less land used, more room for future racks' },
];
const GATE_FACTOR: Record<string, Factor> = {
  'Residential proximity': 'people', 'Sensitive places': 'people', 'Land in use': 'people', 'Flood exposure': 'planet', 'Water stress': 'resources', 'Grid proximity': 'resources',
};
const DEFAULT: Brief = { kind: 'data-center', vision: '', name: 'Houston 20 MW', market: 'Houston', mw: 20, rackKw: 20, redundancy: 'N+1', cooling: 'liquid', halls: null, siteW: 320, siteD: 240, setback: 8, expansion: 10, flex: 30, storeys: 1, rent: null };
const SAVE_KEY = 'plotstar-studio-v1';
const NO_EDIT: ConceptEdit = { building: { dx: 0, dy: 0 }, rotate: false, yard: {}, added: [] };
const ADD: Record<AddedType, { prefix: string; w: number; d: number; label: string }> = {
  yard_bess: { prefix: 'BESS', w: 26, d: 12, label: 'Battery storage' }, yard_solar: { prefix: 'PV', w: 36, d: 24, label: 'Solar canopy' },
  yard_water: { prefix: 'TANK', w: 14, d: 14, label: 'Water tank' }, yard_parking: { prefix: 'PARK', w: 42, d: 17, label: 'Parking' },
  yard_wall: { prefix: 'WALL', w: 1, d: 40, label: 'Noise wall' }, yard_trees: { prefix: 'TREES', w: 48, d: 12, label: 'Tree buffer' },
  yard_guard: { prefix: 'GATE', w: 6, d: 5, label: 'Gatehouse' },
};
interface SavedProject { id: string; name: string; mw_it: number; status: string; decided_by?: string; updated_at?: string; site?: { id?: string; name?: string; address?: string } }
type SiteExtra = { landCost?: number; landCostBasis?: string; labels?: { landCost?: string } };
// copilot patches use the engine's field names; map them back to Brief
const API_TO_BRIEF = { rack_kw: 'rackKw', mw_it: 'mw', cooling: 'cooling', redundancy: 'redundancy', halls: 'halls', storeys: 'storeys', expansion_pct: 'expansion', setback_m: 'setback', rent_kw_month: 'rent' } as const;
/** CoStar building names are often generic ("Bldg 2", "G"), so lead with the street address. */
const siteLabel = (s: ExploreSite) => (s.area && (s.source as string | undefined) !== 'user' ? s.area : s.name);
const isUser = (s: ExploreSite) => (s.source as string | undefined) === 'user';
// a site resolved by id (reload, saved project) rather than from the market search
const isFallback = (s: ExploreSite) => !!(s as { fallback?: boolean }).fallback;

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(`${PUBLIC_DATA_API}${path}`, body === undefined ? undefined
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw new Error(typeof d?.detail === 'string' ? d.detail : `${path} failed (${r.status})`);
  }
  return r.json();
}

function Tag({ label }: { label: string }) {
  return <span className={`st-tag st-tag-${label.toLowerCase()}`}>{label}</span>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="st-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Stat({ label, value, sub, tag }: { label: string; value: string; sub?: string; tag?: string }) {
  return <div className="st-stat"><small>{label}{tag && <Tag label={tag} />}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>;
}

const SESSION_KEY = 'geostar.studio.v1';
const UNREACHABLE = "Can't reach the GeoStar data service";
type Session = { step: number; sub: number; brief: Brief; siteId: string | null; prio: Record<Factor, number> };
function readSession(): Session | null {
  try { const raw = sessionStorage.getItem(SESSION_KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}

export function Studio() {
  // A reload keeps the brief, the chosen site and the step; the layouts regenerate from them. The session is read
  // after mount (not during render) so the server and client render the same first frame.
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState(0);
  const [sub, setSub] = useState(0);
  const [brief, setBrief] = useState<Brief>(DEFAULT);
  const [sites, setSites] = useState<ExploreSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [mode, setMode] = useState<MapMode>('browse');
  const [prio, setPrio] = useState<Record<Factor, number>>({ money: 2, people: 2, planet: 2, resources: 2 });
  const [result, setResult] = useState<StudioResult | null>(null);
  const [base, setBase] = useState<StudioResult | null>(null);
  const [activeId, setActiveId] = useState<string>('');
  const [view, setView] = useState<'2d' | '3d' | 'split' | 'existing'>('split');
  const [layers, setLayers] = useState<Layers>({ racks: true, labels: true, power: false, cooling: false, data: false, yard: true, site: false, tags: true, aerial: true, roof: 0, level: null, explode: 0, context: false });
  const [sel, setSel] = useState<string | null>(null);
  const [edits, setEdits] = useState<Edits>({});
  const [editMode, setEditMode] = useState(false);
  const [cam, setCam] = useState<ViewPreset>({ preset: 'iso', n: 0 });
  const [tours, setTours] = useState<string[]>([]);
  const [decidedBy, setDecidedBy] = useState('');
  const [importing, setImporting] = useState(false);
  const [dossier, setDossier] = useState<null | 'comps' | 'building'>(null);
  const [dealDesk, setDealDesk] = useState(false);
  const [inspection, setInspection] = useState('');
  const [landDirty, setLandDirty] = useState(false);
  const [projectId, setProjectId] = useState(() => `p-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`);
  const [store, setStore] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [saved, setSaved] = useState<SavedProject[]>([]);
  const [reopen, setReopen] = useState(false);
  const [ctx, setCtx] = useState<{ url: string; lat: number; lon: number } | null>(null);
  const [aerialMeta, setAerialMeta] = useState<{ collection?: string; 'last-capture-date'?: string; 'min-gsd'?: string } | null>(null);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [reasons, setReasons] = useState('');
  const [decidedAt, setDecidedAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ id: string; text: string; by: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setBrief((b) => ({ ...b, [k]: v }));
  const site = sites.find((s) => s.id === siteId) ?? null;
  const racks = Math.ceil((brief.mw * 1000) / brief.rackKw);
  const halls = brief.halls ?? Math.min(12, Math.max(1, Math.round(brief.mw / 5)));
  const concept = result?.concepts.find((c) => c.id === activeId) ?? result?.concepts[0] ?? null;
  const chosen = result?.concepts.find((c) => c.id === preferred) ?? null;

  // CoStar candidates for the market, already screened by the hard gates
  useEffect(() => {
    let alive = true;
    setSitesLoading(true);
    const load = async (attempt: number): Promise<void> => {
      try {
        const d = await api<{ sites: Omit<ExploreSite, 'letter'>[] }>('/search', { market: brief.market, thresholds: { min_home_distance_m: 300 }, assumptions: {}, filters: { min_acres: 5 }, limit: 150 });
        if (!alive) return;
        setSites((own) => [...own.filter((s) => isUser(s) || (isFallback(s) && !d.sites.some((x) => x.id === s.id))), ...d.sites.map((s, i) => ({ ...s, letter: String(i + 1) }) as ExploreSite)]);
        setSitesLoading(false); setError((e) => (e?.startsWith(UNREACHABLE) ? null : e));
      } catch {
        if (!alive) return;
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); if (alive) return load(attempt + 1); }
        setSitesLoading(false); setError(`${UNREACHABLE} at ${PUBLIC_DATA_API}. Start it and reload.`);
      }
    };
    void load(1);
    return () => { alive = false; };
  }, [brief.market]);

  // The chosen site must exist even when the market search is slow, failed, or does not list it (reload, saved
  // project): resolve it by CoStar id from the local kit and screen it, so the address and the aerial show.
  useEffect(() => {
    if (!siteId || !siteId.startsWith('costar:') || sites.some((s) => s.id === siteId)) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(siteDetailUrl(siteId));
        const d = r.ok ? await r.json() : null;
        const p = d?.parcel;
        if (!alive || !p || typeof p.lat !== 'number') return;
        const acres = typeof p.lot_acres === 'number' ? p.lot_acres : Math.max(5, brief.mw);
        const ev = await api<{ screen: ExploreSite['screen'] }>('/sites/evaluate', { lat: p.lat, lon: p.lon, acres, market: brief.market, thresholds: { min_home_distance_m: 300 }, name: p.name ?? siteId }).catch(() => null);
        if (!alive) return;
        const s = { id: siteId, parcelId: siteId, name: p.name ?? siteId, area: [p.address, p.city].filter(Boolean).join(', '), lat: p.lat, lng: p.lon, lotAcres: acres,
          source: 'costar', letter: '•', screen: ev?.screen, fallback: true } as unknown as ExploreSite;
        setSites((all) => (all.some((x) => x.id === siteId) ? all : [...all, s]));
      } catch { /* the search list may still bring it */ }
    })();
    return () => { alive = false; };
  }, [siteId, sites, brief.market, brief.mw]);

  // start over: forget the saved place and reload to a clean studio
  const resetStudio = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    window.location.assign('/studio');
  };

  // restore the saved place once, on mount
  useEffect(() => {
    const ss = readSession();
    if (ss) {
      setSession(ss);
      setStep(Math.min(ss.step, 1)); // deeper steps need a result, regenerated below
      setSub(ss.sub ?? 0);
      if (ss.brief) setBrief({ ...DEFAULT, ...ss.brief });
      if (ss.siteId) setSiteId(ss.siteId);
      if (ss.prio) setPrio(ss.prio);
    }
    setHydrated(true);
  }, []);

  // remember where you are, so a reload comes back to the same brief, site and step
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ step, sub, brief, siteId, prio } satisfies Session)); } catch { /* private mode */ }
  }, [hydrated, step, sub, brief, siteId, prio]);

  // after a reload past Define with a site chosen, regenerate the layouts and return to that step
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !session || !site || sitesLoading) return;
    restored.current = true;
    if (session.step >= 2) void generate(brief, false).then((r) => { if (r) setStep(session.step); });
  }, [session, site, sitesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Matterport scans of the existing building, when CoStar recorded any for this property
  const parcelId = site?.parcelId ?? null; // 'costar:<id>'; null for a dropped pin
  useEffect(() => {
    setTours([]);
    if (!parcelId) return;
    let alive = true;
    fetch(siteDetailUrl(parcelId)).then((r) => (r.ok ? r.json() : null)).then((d) => alive && setTours(d?.matterport_model_ids ?? [])).catch(() => {});
    return () => { alive = false; };
  }, [parcelId]);

  const pickSite = useCallback(async (id: string, list?: ExploreSite[]) => {
    setSiteId(id);
    const s = (list ?? sites).find((x) => x.id === id);
    if (!s) return;
    try {
      const d = await api<{ site_w: number; site_d: number }>(`/studio/defaults?mw_it=${brief.mw}${s.lotAcres ? `&acres=${s.lotAcres}` : ''}`);
      setBrief((b) => ({ ...b, siteW: d.site_w, siteD: d.site_d }));
    } catch { /* keep the current dimensions */ }
  }, [sites, brief.mw]);

  async function onPin(lng: number, lat: number) {
    setMode('browse'); setBusy(true);
    try {
      const acres = Math.max(5, brief.mw);
      const d = await api<{ id: string; screen: ExploreSite['screen'] }>('/sites/evaluate', { lat, lon: lng, acres, market: brief.market, thresholds: { min_home_distance_m: 300 }, name: 'My location' });
      const s = { id: d.id, name: 'My location', area: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, lotAcres: acres, screen: d.screen, letter: '★', source: 'user' } as unknown as ExploreSite;
      const next = [s, ...sites.filter((x) => x.id !== s.id)];
      setSites(next); void pickSite(s.id, next);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const body = useCallback((b: Brief, ed: Edits = edits) => ({
    brief: { name: b.name, mw_it: b.mw, rack_kw: b.rackKw, redundancy: b.redundancy, cooling: b.cooling, halls: b.halls, site_w: b.siteW, site_d: b.siteD, setback_m: b.setback, expansion_pct: b.expansion, flexible_share: b.flex / 100, storeys: b.storeys, rent_kw_month: b.rent },
    site: site ? { id: site.id, name: site.name, lat: site.lat, lon: site.lng, gates: site.screen?.gates ?? [], land_cost: (site as SiteExtra).landCost || null,
      land_label: (site as SiteExtra).labels?.landCost ?? null, land_basis: (site as SiteExtra).landCostBasis ?? null } : {},
    priorities: prio,
    edits: ed,
  }), [site, prio, edits]);

  const generate = useCallback(async (b: Brief, keepBase: boolean, ed?: Edits) => {
    setBusy(true); setError(null);
    try {
      const r = await api<StudioResult>('/studio/generate', body(b, keepBase ? ed : {}));
      setResult(r); setSummary(null);
      if (!keepBase) { setBase(r); setPreferred(null); setDecidedAt(null); setSel(null); setEdits({}); }
      setActiveId((cur) => (keepBase && r.concepts.some((c) => c.id === cur) ? cur : r.concepts.find((c) => c.rank === 1)!.id));
      return r;
    } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }, [body]);

  async function summarize(id: string) {
    setSummary({ id, text: '', by: '' });
    try {
      const r = await api<{ text: string; written_by: string }>('/studio/explain', { ...body(brief), concept_id: id });
      setSummary({ id, text: r.text, by: r.written_by });
    } catch (e) { setSummary(null); setError((e as Error).message); }
  }

  // what-if controls on Analyze: change the brief, regenerate, keep the first run as the comparison
  function whatIf<K extends keyof Brief>(k: K, v: Brief[K]) {
    const b = { ...brief, [k]: v };
    setBrief(b); void generate(b, true);
  }

  // edits to the active concept: each one is sent back so the engine re-measures and re-checks the layout
  function commitEdits(all: Edits) { setEdits(all); void generate(brief, true, all); }
  const applyMove = useCallback((m: MoveEdit) => {
    if (!concept) return;
    const cur = edits[concept.id] ?? NO_EDIT;
    let next: ConceptEdit;
    if (m.code === 'BUILDING') next = { ...cur, building: { dx: cur.building.dx + m.dx, dy: cur.building.dy + m.dy } };
    else {
      const it = concept.yard.find((y) => y.code === m.code);
      if (!it) return;
      next = it.added ? { ...cur, added: cur.added.map((a) => (a.code === m.code ? { ...a, x: a.x + m.dx, y: a.y + m.dy } : a)) }
        : { ...cur, yard: { ...cur.yard, [m.code]: { x: it.x + m.dx, y: it.y + m.dy } } };
    }
    const all = { ...edits, [concept.id]: next };
    setEdits(all); void generate(brief, true, all);
  }, [concept, edits, brief, generate]);
  function addItem(type: AddedType) {
    if (!concept || !result) return;
    const cur = edits[concept.id] ?? NO_EDIT, a = ADD[type], sb = result.brief.setback_m;
    let n = 1;
    while (cur.added.some((x) => x.code === `${a.prefix}-${n}`)) n++;
    // first free strip west of the building, stacking northwards
    const x = Math.max(sb + 1, concept.building.x - a.w - 8);
    const y = Math.min(result.brief.site_d - sb - a.d - 1, Math.max(sb + 1, concept.building.y) + cur.added.reduce((s, i) => s + i.d + 4, 0));
    commitEdits({ ...edits, [concept.id]: { ...cur, added: [...cur.added, { code: `${a.prefix}-${n}`, type, x: Math.round(x), y: Math.round(y), w: a.w, d: a.d }] } });
    setSel(`${a.prefix}-${n}`);
  }
  function removeItem(code: string) {
    if (!concept) return;
    const cur = edits[concept.id] ?? NO_EDIT;
    commitEdits({ ...edits, [concept.id]: { ...cur, added: cur.added.filter((x) => x.code !== code) } });
    setSel(null);
  }
  function rotateBuilding() {
    if (!concept) return;
    const cur = edits[concept.id] ?? NO_EDIT;
    commitEdits({ ...edits, [concept.id]: { ...cur, rotate: !cur.rotate, building: { dx: 0, dy: 0 } } });
  }
  function setGeom(code: string, patch: Partial<Record<'x' | 'y' | 'w' | 'd', number>>) {
    if (!concept) return;
    const it = concept.yard.find((y) => y.code === code);
    if (!it) return;
    const cur = edits[concept.id] ?? NO_EDIT;
    const safe = { ...patch, ...(patch.w != null ? { w: Math.max(1, Math.min(800, patch.w)) } : {}), ...(patch.d != null ? { d: Math.max(1, Math.min(800, patch.d)) } : {}) };
    commitEdits({ ...edits, [concept.id]: it.added ? { ...cur, added: cur.added.map((a) => (a.code === code ? { ...a, ...safe } : a)) }
      : { ...cur, yard: { ...cur.yard, [code]: { x: patch.x ?? it.x, y: patch.y ?? it.y } } } });
  }
  function resetEdits() {
    if (!concept) return;
    const { [concept.id]: _dropped, ...rest } = edits;
    commitEdits(rest);
  }
  const aerialId = site ? (site.parcelId ?? `pt:${site.lat.toFixed(6)},${site.lng.toFixed(6)}`) : null;

  // CoStar dossier: use a comps-derived land value for this site, then regenerate once the site state has updated
  function useLandValue(value: number, label: string, basis: string) {
    if (!site) return;
    setSites((all) => all.map((x) => (x.id === site.id ? ({ ...x, landCost: value, landCostBasis: basis, labels: { ...(x as SiteExtra).labels, landCost: label } } as ExploreSite) : x)));
    setLandDirty(true);
  }
  const siteLand = (site as SiteExtra | null)?.landCost;
  useEffect(() => {
    if (!landDirty) return;
    setLandDirty(false);
    if (result) void generate(brief, true, edits);
  }, [siteLand]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vexcel: capture details of the aerial, and whether a 3D mesh of the surroundings exists here
  const siteLat = site?.lat, siteLng = site?.lng;
  useEffect(() => {
    setAerialMeta(null); setCtx(null); setLayers((l) => ({ ...l, context: false }));
    if (!aerialId || siteLat == null || siteLng == null) return;
    let alive = true;
    fetch(vexcelMetaUrl(aerialId, 220)).then((r) => (r.ok ? r.json() : null)).then((m) => alive && setAerialMeta(m)).catch(() => {});
    fetch(vexcel3dRootUrl(siteLat, siteLng)).then((r) => (r.ok ? r.json() : null)).then((d) => alive && d?.tileset_url && setCtx({ url: d.tileset_url, lat: siteLat, lon: siteLng })).catch(() => {});
    return () => { alive = false; };
  }, [aerialId, siteLat, siteLng]);

  // MongoDB Atlas: saved projects. When it is not reachable the app keeps working and nothing is saved remotely.
  // Atlas stores the CoStar site id only; its name/address are hydrated from the local kit for display
  const [siteNames, setSiteNames] = useState<Record<string, string>>({});
  const refreshSaved = useCallback(() => {
    api<{ projects: SavedProject[] }>('/studio/projects').then((d) => {
      setSaved(d.projects);
      d.projects.forEach((p) => {
        const id = p.site?.id;
        if (id && id.startsWith('costar:')) fetch(siteDetailUrl(id)).then((r) => (r.ok ? r.json() : null)).then((x) => {
          const pr = x?.parcel ?? {};
          if (pr.name || pr.address) setSiteNames((n) => ({ ...n, [id]: [pr.address || pr.name, pr.city].filter(Boolean).join(', ') }));
        }).catch(() => {});
      });
    }).catch(() => setSaved([]));
  }, []);
  useEffect(() => {
    api<{ available: boolean; reason: string | null }>('/studio/store').then((s) => { setStore(s); if (s.available) refreshSaved(); }).catch(() => setStore(null));
  }, [refreshSaved]);
  async function saveProject(status: 'generated' | 'decided', at?: string, r: StudioResult | null = result) {
    if (!store?.available || !site) return;
    const pick = r?.concepts.find((c) => c.id === (preferred ?? '')) ?? r?.concepts.find((c) => c.rank === 1);
    try {
      await api(`/studio/projects/${projectId}`, {
        name: brief.name, market: brief.market, mw_it: brief.mw, status, brief, priorities: prio, edits,
        site: { id: site.id, name: site.name, address: site.area, lat: site.lat, lon: site.lng, custom: isUser(site) ? site : null },
        preferred: status === 'decided' ? preferred : null, reasons, decided_by: decidedBy, decided_at: at ?? null,
        summary: pick ? { concept: pick.name, capex: pick.money.capex, npv: pick.money.npv, months_to_power: pick.money.months_to_power } : {},
      }, 'PUT');
      refreshSaved();
    } catch { /* saving is best-effort */ }
  }
  async function openProject(id: string) {
    try {
      const d = await api<{ brief: Brief; priorities: Record<Factor, number>; edits: Edits; preferred: string | null; reasons: string; decided_by: string;
        site: { id: string; custom: ExploreSite | null } }>(`/studio/projects/${id}`);
      setBrief({ ...DEFAULT, ...d.brief }); setPrio(d.priorities); setEdits(d.edits ?? {}); setPreferred(d.preferred); setReasons(d.reasons ?? ''); setDecidedBy(d.decided_by ?? '');
      setProjectId(id); setDecidedAt(null);
      if (d.site.custom) setSites((all) => [d.site.custom!, ...all.filter((s) => s.id !== d.site.id)]);
      setSiteId(d.site.id); setReopen(true);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    if (!reopen || !site) return;
    setReopen(false);
    void generate(brief, true, edits).then((r) => { if (r) { setBase(r); setStep(2); } });
  }, [reopen, site]); // eslint-disable-line react-hooks/exhaustive-deps

  // a change the copilot previewed and the user confirmed: apply it and regenerate, keeping the first run as the comparison
  function applyPatch(p: BriefPatch) {
    const b = { ...brief };
    for (const [k, v] of Object.entries(p)) {
      if (k === 'flexible_share') b.flex = Math.round(Number(v) * 100);
      else if (k in API_TO_BRIEF) (b as Record<string, unknown>)[API_TO_BRIEF[k as keyof typeof API_TO_BRIEF]] = v;
    }
    setBrief(b); void generate(b, true, edits);
  }

  function decide() {
    const at = new Date().toISOString();
    setDecidedAt(at);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ brief, siteId, preferred, reasons, decidedBy, edits, at })); } catch { /* storage unavailable */ }
    void saveProject('decided', at);
    setStep(6);
  }

  const report = useMemo(() => result && chosen && ({
    project: brief.name, decided_at: decidedAt, decided_by: decidedBy || null, preferred_concept: chosen.name, reasons,
    your_edits: edits[chosen.id] ?? null, ranking: result.ranking, finance: result.finance,
    costar_parcel: site?.parcelId ?? null, inspection_notes: inspection || null,
    land: { cost: result.site.land_cost, label: result.site.land_label, basis: result.site.land_basis },
    aerial: aerialId ? { source: 'Vexcel ortho imagery', ...aerialMeta } : null,
    site: site ? { id: site.id, name: site.name, address: site.area, lat: site.lat, lon: site.lng, source: isUser(site) ? 'User-chosen location' : 'CoStar Data Extract', gates: site.screen?.gates } : null,
    brief: result.brief, priorities: prio, operating: result.operating,
    concepts: result.concepts.map(({ rooms: _r, yard: _y, equipment: _e, routes: _ro, ...rest }) => rest),
    chosen_geometry: { building: chosen.building, rooms: chosen.rooms.map(({ rows: _rows, ...r }) => r), yard: chosen.yard },
    assumptions: result.assumptions, note: result.note,
  }), [result, chosen, brief.name, decidedAt, decidedBy, reasons, site, prio, edits, aerialId, aerialMeta, inspection]);

  const canNext = [!!site && sub === 3, true, !!result, !!result, !!result, !!preferred && reasons.trim().length > 0, true, true, true, false][step];
  // Data centers run the whole flow; other property types (no layout engine yet) go from Define straight to Design.
  const kind = brief.kind ?? 'data-center';
  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? 'Data center';
  const dc = kind === 'data-center';
  const reach = (page: number) => (dc ? page <= 1 || (!!result && (page < 6 || !!decidedAt)) : page === 0 || page >= 7);
  const rail = railOf(step);
  const group = STEPS[rail].pages;
  const tabIdx = group.length > 1 ? group.indexOf(step) : -1;
  // where the tab lens slides from: the tab shown before this one in the same step (null when arriving from another step)
  const lastTab = useRef<{ rail: number; idx: number } | null>(null);
  useEffect(() => { lastTab.current = tabIdx >= 0 ? { rail, idx: tabIdx } : null; }, [rail, tabIdx]);
  const subTabs = tabIdx >= 0 && (
    <SubTabs label={STEPS[rail].key} items={group.map((pg) => TAB_LABEL[pg])} active={tabIdx}
      from={lastTab.current?.rail === rail ? lastTab.current.idx : null} onPick={(i) => setStep(group[i])} />
  );

  // Design · Model, Protect, Deploy: one HAVEN facility workspace per Studio project, shared with Smart Blocks' code and store
  const siteName = site ? siteLabel(site) : dc ? brief.name : `${kindLabel} · ${brief.market}`;
  const facility = useMemo<Facility>(() => ({
    id: `studio-${projectId.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 150), name: siteName.slice(0, 160), city: brief.market, type: kindLabel,
  }), [projectId, siteName, brief.market, kindLabel]);
  const protection = useProtection(facility, step >= 7);

  // Deep Agents: one shared run for the site evaluation and the conversation, shown live in Agent Intelligence
  const agentRun = useAgentRun();
  const [intelOpen, setIntelOpen] = useState(false);
  const [walkModel, setWalkModel] = useState<string | null>(null);
  const [evalSite, setEvalSite] = useState<string | null>(null);
  const agentBusy = isActive(agentRun.state);
  const siteScore = agentRun.state.kind === 'site-evaluation' && evalSite === siteId ? agentRun.state.score : null;
  const analyzeSite = () => {
    if (!site) return;
    setEvalSite(site.id);
    setIntelOpen(true);
    void agentRun.start('/agents/site-evaluation', { ...body(brief), stage: PAGES[step], market: brief.market, concept_id: concept?.id ?? null },
      `Evaluate ${siteLabel(site)} for a ${brief.mw} MW data center`);
  };
  const [protectStart, setProtectStart] = useState<number | undefined>();
  const [deployView, setDeployView] = useState<'current' | 'projects' | Facility>('current');
  const openCommand = () => { setProtectStart(undefined); setDeployView('current'); setStep(9); };

  // generate the three layouts and open Explore; used from Discover, or from Define to skip the drone survey
  const generateAndExplore = () => void generate(brief, false).then((r) => { if (r) { setStep(2); void saveProject('generated', undefined, r); } });
  function next() {
    if (step === 0) setStep(1);
    else if (step === 1) generateAndExplore();
    else if (step === 5) decide();
    else setStep(ORDER[ORDER.indexOf(step) + 1]);
  }
  const nextLabel = ['Continue to discover', busy ? 'Generating…' : 'Generate layouts', 'Compare concepts', 'Review decision', 'Analyze concept', 'Save decision', 'Open the 3D model', 'Set up protection', 'Go to deploy', ''][step];

  return (
    <div className="st st-shell">
        <aside className="st-rail">
          <Link href="/" className="st-mark" aria-label="GeoStar home">
            <span className="st-mark-icon"><GeoStarMark /></span>
            <span className="st-mark-text"><span>Geo<b>Star</b></span><small>Find · Design · Protect</small></span>
          </Link>
          <button type="button" className="st-new" onClick={resetStudio} title="Clear the brief, site and layouts and start again"><Plus size={16} /> New project</button>
          <small className="st-eyebrow">Your workflow</small>
          <p className="st-rail-step">Step {rail + 1} of {STEPS.length}</p>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.key} className={i === rail ? 'on' : !reach(s.pages[0]) ? 'locked' : i < rail ? 'done' : ''} onClick={() => reach(s.pages[0]) && i !== rail && setStep(s.pages[0])}>
                <i>{i < rail ? <Check size={13} /> : reach(s.pages[0]) ? i + 1 : <Lock size={11} />}</i>
                <div><b>{s.key}</b><span>{i < rail ? 'Completed' : s.hint}</span></div>
              </li>
            ))}
          </ol>
          <small className="st-eyebrow st-rail-sec">Tools</small>
          <nav className="st-rail-nav" aria-label="Tools">
            <Link href="/studio/agent"><Network size={16} /><span><b>How the AI works</b><small>Agents and evidence</small></span></Link>
            <Link href="/studio/data"><Database size={16} /><span><b>Data</b><small>MongoDB Atlas, live</small></span></Link>
            <button type="button" onClick={() => setDealDesk(true)}><Briefcase size={16} /><span><b>Deal desk</b><small>CoStar sites and comps</small></span></button>
            <Link href="/explore"><Radio size={16} /><span><b>Live operations</b><small>Grid and hardware</small></span></Link>
          </nav>
          <div className="st-rail-foot">
            {dc ? <><b>{racks.toLocaleString()} racks · {halls} halls</b><span>{brief.redundancy} · {COOLING_LABEL[brief.cooling]}</span></>
              : <><b>{kindLabel}</b><span>{brief.market} · concept model</span></>}
          </div>
          <Link href="/" className="st-rail-home"><House size={16} /> Back to home page</Link>
        </aside>

        <div className="st-col">
        <header className="st-top">
          <div className="st-top-title"><b>Studio</b><span>{dc ? `${brief.name} · ${brief.mw} MW IT${site ? ` · ${siteLabel(site)}` : ''}` : `${kindLabel} · ${brief.market} · concept model`}</span></div>
          <AgentStatusPill s={agentRun.state} onOpen={() => setIntelOpen(true)} />
        </header>

        <main className="st-main">
          {error && <div className="st-error"><CircleAlert size={14} /> {error}</div>}

          {step === 0 && (
            <section className="st-page">
              <small className="st-eyebrow">01 · Define</small>
              <h1 className="st-hero">What are you building, <em>and where?</em></h1>
              <p className="st-hero-lede">Say what you want to build. GeoStar finds where it can go, designs what goes on it, and protects it once it is built.</p>
              <div className="st-tabs">
                {['What to build', 'Requirements', 'Site', 'Review brief'].map((t, i) => (
                  <button key={t} className={sub === i ? 'on' : ''} onClick={() => (i < 3 || site) && setSub(i)} disabled={(i > 0 && brief.kind !== 'data-center') || (i === 3 && !site)}><i>{i + 1}</i>{t}</button>
                ))}
              </div>

              {sub === 0 && (
                <KindPicker kind={brief.kind ?? 'data-center'} market={brief.market} vision={brief.vision ?? ''}
                  onKind={(k) => set('kind', k)} onMarket={(m) => { set('market', m); setSiteId(null); }} onVision={(v) => set('vision', v)}
                  onContinue={() => (dc ? setSub(1) : setStep(7))}>
                  {store?.available && saved.length > 0 && (
                    <details className="st-saved">
                      <summary>Saved projects <span>{saved.length}</span><small>MongoDB Atlas</small></summary>
                      <ul>{saved.map((p) => (
                        <li key={p.id}><div><b>{p.name}</b><span>{p.mw_it} MW · {(p.site?.id && siteNames[p.site.id]) ?? p.site?.address ?? p.site?.name ?? (p.site?.id ? 'CoStar site' : 'no site')} · {p.status}{p.decided_by ? ` by ${p.decided_by}` : ''}</span></div>
                          <button className="st-btn" onClick={() => void openProject(p.id)}>Open</button></li>
                      ))}</ul>
                    </details>
                  )}
                  {store && !store.available && <p className="st-small st-muted st-saved-note">Projects are not being saved to MongoDB: {store.reason}</p>}
                </KindPicker>
              )}
              {sub === 0 && (
                <ol className="st-steps" aria-label="How it works">
                  <li><small>Step 1</small><b>Say what you are building</b><span>Pick a project type and a city.</span></li>
                  <li><small>Step 2</small><b>GeoStar finds and designs</b><span>Real sites, three layouts, one decision.</span></li>
                  <li><small>Step 3</small><b>HAVEN protects it</b><span>Sensors and alerts before the alarm rings.</span></li>
                </ol>
              )}

              {sub === 1 && (
                <div className="st-card st-form">
                  <Field label="Project name"><input value={brief.name} onChange={(e) => set('name', e.target.value)} maxLength={80} /></Field>
                  <Field label="Target IT capacity" hint="Power available to the computers.">
                    <div className="st-unit"><input type="number" min={1} max={500} value={brief.mw} onChange={(e) => set('mw', Math.max(1, Math.min(500, +e.target.value || 1)))} /><em>MW</em></div>
                  </Field>
                  <Field label="Rack density" hint={`${racks.toLocaleString()} racks at this density.`}>
                    <div className="st-unit"><input type="number" min={3} max={200} value={brief.rackKw} onChange={(e) => set('rackKw', Math.max(3, Math.min(200, +e.target.value || 3)))} /><em>kW / rack</em></div>
                  </Field>
                  <Field label="Redundancy target" hint="How much spare power equipment.">
                    <select value={brief.redundancy} onChange={(e) => set('redundancy', e.target.value as Brief['redundancy'])}><option>N</option><option>N+1</option><option>2N</option></select>
                  </Field>
                  <Field label="Cooling strategy" hint="Sets energy overhead and water use.">
                    <select value={brief.cooling} onChange={(e) => set('cooling', e.target.value as Brief['cooling'])}>
                      {Object.entries(COOLING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Data halls" hint="Leave on auto for about 5 MW per hall.">
                    <select value={brief.halls ?? ''} onChange={(e) => set('halls', e.target.value ? +e.target.value : null)}>
                      <option value="">Auto ({Math.min(12, Math.max(1, Math.round(brief.mw / 5)))})</option>
                      {[1, 2, 3, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                  <Field label="Storeys" hint="Stacking halls shrinks the footprint and costs more per square metre.">
                    <select value={brief.storeys} onChange={(e) => set('storeys', +e.target.value)}><option value={1}>1 (single storey)</option><option value={2}>2</option><option value={3}>3</option></select>
                  </Field>
                  <Field label={`Work that can wait: ${brief.flex}%`} hint="Share of computing that can move to cheaper, cleaner hours.">
                    <input type="range" min={0} max={60} step={5} value={brief.flex} onChange={(e) => set('flex', +e.target.value)} />
                  </Field>
                  <div className="st-form-foot"><button className="st-btn primary" onClick={() => setSub(2)}>Next: Site <ArrowRight size={14} /></button></div>
                </div>
              )}

              {sub === 2 && (
                <div className="st-site">
                  <div className="st-map">
                    <ExploreMap market={brief.market} sites={sites} selectedId={siteId} onSelect={(id) => void pickSite(id)} mode={mode} polygon={null}
                      onPolygon={() => {}} onPin={(lng, lat) => void onPin(lng, lat)} basemap="map" />
                    <div className="st-map-tools">
                      <button className={`st-btn ${mode === 'pin' ? 'on' : ''}`} onClick={() => setMode(mode === 'pin' ? 'browse' : 'pin')}><MapPin size={13} /> {mode === 'pin' ? 'Click the map…' : 'Use my own location'}</button>
                    </div>
                  </div>
                  <div className="st-card st-site-panel">
                    {!site ? (
                      <>
                        <h3>Choose a site</h3>
                        <p className="st-muted">Each numbered marker is a real property from the CoStar data extract, already checked against homes, flood zones, water stress and distance to high-voltage power. Or drop your own pin.</p>
                        {sitesLoading ? <p className="st-muted st-small st-sites-wait"><LoaderCircle size={14} className="st-spin" /> Loading {brief.market} sites and screening them against homes, flood, water and power…</p>
                          : sites.length === 0 ? <p className="st-muted st-small st-sites-wait">No sites loaded. {error ? 'Start the data service and reload, or drop your own pin.' : 'Drop your own pin on the map.'}</p>
                          : (
                        <ul className="st-site-list">
                          {sites.filter((s) => s.screen?.status !== 'Fail').slice(0, 8).map((s) => (
                            <li key={s.id} onClick={() => void pickSite(s.id)}><i>{s.letter}</i><div><b>{siteLabel(s)}</b><span>{s.name} · {num(s.lotAcres, 1)} acres · {verdict(s).label}</span></div></li>
                          ))}
                        </ul>)}
                      </>
                    ) : (
                      <>
                        <div className="st-site-head"><div><h3>{siteLabel(site)}</h3><span className="st-muted">{isUser(site) ? 'Your location · no CoStar record' : `CoStar property · ${site.name} · ${num(site.lotAcres, 1)} acres`}</span></div>
                          <span className={`st-verdict ${verdict(site).tone}`}>{verdict(site).label}</span></div>
                        <div className="st-gates">
                          {(site.screen?.gates ?? []).map((g: GateResult) => (
                            <div key={g.gate} className={`st-gate ${g.status === 'Pass' ? 'ok' : g.status === 'Fail' ? 'bad' : 'check'}`}>
                              {g.status === 'Pass' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
                              <div><b>{FACTORS.find((f) => f.key === GATE_FACTOR[g.gate])?.label ?? 'Site'} · {g.gate}</b><span>{g.reason}</span><small><Tag label={g.label} /> {g.source}</small></div>
                            </div>
                          ))}
                        </div>
                        {tours.length > 0 && <button type="button" className="st-tour" onClick={() => setWalkModel(tours[0])}><BoxIcon size={14} /> Site walk: pin notes and measure the existing building · {tours.length} Matterport scan{tours.length > 1 ? 's' : ''}</button>}
                        {aerialId && (
                          <figure className="st-aerial">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={vexcelOrthoUrl(aerialId, 220)} alt={`Vexcel aerial photo of ${siteLabel(site)}`} />
                            <figcaption><Tag label="Sourced" /> Vexcel aerial{aerialMeta?.['last-capture-date'] ? ` · captured ${aerialMeta['last-capture-date'].slice(0, 10)}` : ''}{aerialMeta?.['min-gsd'] ? ` · ${(Number(aerialMeta['min-gsd']) * 100).toFixed(0)} cm per pixel` : ''}{ctx ? ' · 3D mesh available' : ''}</figcaption>
                          </figure>
                        )}
                        <div className="ai-site-cta">
                          {siteScore && agentRun.state.status === 'done' && <span className="ai-mini-score"><b>{siteScore.score ?? '—'}</b> {siteScore.verdict}</span>}
                          <p>{siteScore && agentRun.state.status === 'done'
                            ? `Scored by the agents from ${Object.keys(agentRun.state.evidence).length} evidence records, ${Math.round(siteScore.coverage * 100)}% coverage. Open the graph to see who found what.`
                            : 'Deep Agents analyse this property in parallel: CoStar evidence over MCP, money, power and water, and the neighbours. Watch them work, then see exactly how the score was produced.'}</p>
                          <button className="st-btn primary" onClick={analyzeSite} disabled={agentBusy}>{agentBusy && agentRun.state.kind === 'site-evaluation' ? 'Agents working…' : siteScore ? 'Re-run the agents' : 'Analyze with agents'}</button>
                          {agentRun.state.runId && <button className="st-btn" onClick={() => setIntelOpen(true)}>Open the graph</button>}
                        </div>
                        <p className="st-small"><b>Land price.</b> {(site as SiteExtra).landCost ? `${money((site as SiteExtra).landCost!)} · ${(site as SiteExtra).landCostBasis ?? ''}` : 'Unknown. No CoStar price for this location, so land is left out of the totals.'} <Tag label={(site as SiteExtra).landCost ? ((site as SiteExtra).labels?.landCost ?? 'Estimated') : 'Unknown'} /></p>
                        <h4>Site rectangle</h4>
                        <div className="st-row">
                          <Field label="Width"><div className="st-unit"><input type="number" value={brief.siteW} onChange={(e) => set('siteW', Math.max(60, +e.target.value || 60))} /><em>m</em></div></Field>
                          <Field label="Depth"><div className="st-unit"><input type="number" value={brief.siteD} onChange={(e) => set('siteD', Math.max(60, +e.target.value || 60))} /><em>m</em></div></Field>
                        </div>
                        <div className="st-row">
                          <Field label="Setback"><div className="st-unit"><input type="number" value={brief.setback} onChange={(e) => set('setback', Math.max(0, Math.min(100, +e.target.value || 0)))} /><em>m</em></div></Field>
                          <Field label="Land kept open"><div className="st-unit"><input type="number" value={brief.expansion} onChange={(e) => set('expansion', Math.max(0, Math.min(80, +e.target.value || 0)))} /><em>%</em></div></Field>
                        </div>
                        <p className="st-muted st-small">{num(brief.siteW * brief.siteD)} m² ({num((brief.siteW * brief.siteD) / 4046.86, 1)} acres). Pre-filled from the lot size as a rectangle; the true parcel shape is not in the data. <Tag label="Estimated" /></p>
                        <div className="st-form-foot"><button className="st-btn" onClick={() => setSiteId(null)}>Change site</button><button className="st-btn" onClick={() => setImporting(true)}><FileUp size={13} /> Import your design</button>{parcelId && <button className="st-btn" onClick={() => setDossier('comps')}><Building2 size={13} /> CoStar dossier</button>}<button className="st-btn primary" onClick={() => setSub(3)}>Next: Review brief <ArrowRight size={14} /></button></div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {sub === 3 && site && (
                <div className="st-grid2">
                  <div className="st-card"><h3>Project</h3>
                    <dl className="st-dl"><dt>Name</dt><dd>{brief.name}</dd><dt>Site</dt><dd>{siteLabel(site)}</dd><dt>Market</dt><dd>{brief.market}</dd><dt>Redundancy · cooling</dt><dd>{brief.redundancy} · {COOLING_LABEL[brief.cooling]}</dd></dl></div>
                  <div className="st-card"><h3>Capacity</h3>
                    <dl className="st-dl"><dt>IT target</dt><dd>{brief.mw} MW</dd><dt>Rack density</dt><dd>{brief.rackKw} kW / rack</dd><dt>Calculated racks</dt><dd>{racks.toLocaleString()}</dd><dt>Data halls</dt><dd>{halls}</dd></dl></div>
                  <div className="st-card"><h3>Site and constraints</h3>
                    <dl className="st-dl"><dt>Site rectangle</dt><dd>{brief.siteW} × {brief.siteD} m</dd><dt>Setback</dt><dd>{brief.setback} m</dd><dt>Land kept open</dt><dd>{brief.expansion}%</dd><dt>Hard gates</dt><dd>{site.screen?.status ?? 'Unknown'}</dd></dl></div>
                  <div className="st-card"><h3>Operation</h3>
                    <dl className="st-dl"><dt>Work that can wait</dt><dd>{brief.flex}%</dd><dt>Grid</dt><dd>{brief.market === 'Houston' ? 'ERCOT day-ahead prices' : 'ERCOT day shape (no local feed)'}</dd></dl>
                    <p className="st-muted st-small">Estimates do not establish feasibility. A utility study, survey and engineering review come later.</p></div>
                </div>
              )}
            </section>
          )}

          {step === 1 && (
            <section className="st-page">
              <small className="st-eyebrow">02 · Discover</small>
              <h1>See the site from above</h1>
              <p className="st-lede">{site ? `${siteLabel(site)} · ` : ''}Fly the Tello over the site and save what the camera sees. When you’re ready, generate three layouts.</p>
              <DroneSurvey siteName={site ? siteLabel(site) : brief.name} onContinue={generateAndExplore} busy={busy} />
            </section>
          )}

          {step === 2 && result && concept && (
            <section className="st-explore">
              <div className="st-toolbar">
                <div className="st-seg">
                  {result.concepts.map((c) => <button key={c.id} className={c.id === concept.id ? 'on' : ''} onClick={() => { setActiveId(c.id); setSel(null); }}>{c.rank === 1 && <Star size={12} />}{c.name}</button>)}
                </div>
                <div className="st-tools">
                  {result.brief.storeys > 1 && (
                    <div className="st-seg">
                      <button className={layers.level === null ? 'on' : ''} onClick={() => setLayers({ ...layers, level: null })}>All levels</button>
                      {Array.from({ length: result.brief.storeys }, (_, i) => <button key={i} className={layers.level === i ? 'on' : ''} onClick={() => setLayers({ ...layers, level: i })}>L{i + 1}</button>)}
                    </div>
                  )}
                  <button className={`st-btn ${editMode ? 'primary' : ''}`} onClick={() => { setEditMode(!editMode); if (view === '2d') setView('3d'); }}><Move size={13} /> {editMode ? 'Editing layout' : 'Edit layout'}</button>
                  <div className="st-seg">
                    <button onClick={() => setCam({ preset: 'iso', n: cam.n + 1 })}>Angle view</button>
                    <button onClick={() => setCam({ preset: 'top', n: cam.n + 1 })}>Top view</button>
                  </div>
                  <div className="st-seg">
                    <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}><Square size={13} /> 2D plan</button>
                    <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}><BoxIcon size={13} /> 3D model</button>
                    <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')}><Columns2 size={13} /> Side by side</button>
                    {tours.length > 0 && parcelId && <button className={view === 'existing' ? 'on' : ''} onClick={() => setView('existing')}><Building2 size={13} /> Existing building</button>}
                  </div>
                </div>
              </div>
              {editMode && (
                <div className="st-editbar">
                  <span><b>Edit mode.</b> Drag the building or any outdoor item in the 3D model. Checks and numbers update when you let go.</span>
                  <select className="st-add" value="" onChange={(e) => { if (e.target.value) addItem(e.target.value as AddedType); }} disabled={busy} aria-label="Add an item">
                    <option value="">Add an item…</option>
                    {(Object.keys(ADD) as AddedType[]).map((k) => <option key={k} value={k}>{ADD[k].label}</option>)}
                  </select>
                  <button className="st-btn" onClick={rotateBuilding} disabled={busy}><RotateCw size={13} /> Rotate building</button>
                  <button className="st-btn" onClick={resetEdits} disabled={busy || !edits[concept.id]}><RotateCcw size={13} /> Undo all edits</button>
                </div>
              )}
              <div className="st-explore-body">
                <div className={`st-views ${view}`}>
                  {view === 'existing' && parcelId && <div className="st-view st-view-existing"><ExistingVsProposed parcelId={parcelId} mwIt={brief.mw} rackKw={brief.rackKw} onNote={setInspection}
                    conceptSlot={<Model3D concept={concept} siteW={result.brief.site_w} siteD={result.brief.site_d} setback={result.brief.setback_m} layers={layers} selected={sel} onSelect={setSel} aerialId={aerialId} edit={false} onMove={applyMove} view={cam} context={null} />} /></div>}
                  {view !== '2d' && view !== 'existing' && <div className="st-view"><Model3D concept={concept} siteW={result.brief.site_w} siteD={result.brief.site_d} setback={result.brief.setback_m} layers={layers} selected={sel} onSelect={setSel} aerialId={aerialId} edit={editMode} onMove={applyMove} view={cam} context={layers.context ? ctx : null} /></div>}
                  {view !== '3d' && view !== 'existing' && <div className="st-view st-view-plan"><Plan2D concept={concept} siteW={result.brief.site_w} siteD={result.brief.site_d} setback={result.brief.setback_m} layers={layers} selected={sel} onSelect={setSel} aerialId={aerialId} /></div>}
                </div>
                <Inspector concept={concept} sel={sel} layers={layers} setLayers={setLayers} edit={editMode} onRemove={removeItem} onGeom={setGeom} hasContext={!!ctx} />
              </div>
            </section>
          )}

          {step === 3 && result && concept && (
            <section className="st-page st-glass-in">
              <small className="st-eyebrow">04 · Analyze</small>
              <div className="st-head-row"><h1>{concept.name}</h1>
                {parcelId && <button className="st-btn" onClick={() => setDossier('comps')}><Building2 size={13} /> CoStar dossier</button>}
                <div className="st-seg">{result.concepts.map((c) => <button key={c.id} className={c.id === concept.id ? 'on' : ''} onClick={() => setActiveId(c.id)}>{c.name}</button>)}</div></div>
              {subTabs}
              <p className="st-lede">{concept.strategy}</p>
              <div className="st-card st-whatif">
                <div><b>Change a decision</b><span>Every change re-runs the layout, cost, carbon and water together.</span></div>
                <Field label="Cooling"><select value={brief.cooling} onChange={(e) => whatIf('cooling', e.target.value as Brief['cooling'])} disabled={busy}>{Object.entries(COOLING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Redundancy"><select value={brief.redundancy} onChange={(e) => whatIf('redundancy', e.target.value as Brief['redundancy'])} disabled={busy}><option>N</option><option>N+1</option><option>2N</option></select></Field>
                <Field label={`Work that can wait: ${brief.flex}%`}><input type="range" min={0} max={60} step={10} value={brief.flex} onChange={(e) => whatIf('flex', +e.target.value)} disabled={busy} /></Field>
                <Field label="Storeys"><select value={brief.storeys} onChange={(e) => whatIf('storeys', +e.target.value)} disabled={busy}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></Field>
                <Field label="Rent ($ per kW-month)"><input type="number" min={20} max={600} step={10} key={result.brief.rent_kw_month} defaultValue={result.brief.rent_kw_month} disabled={busy}
                  onBlur={(e) => { const v = Math.max(20, Math.min(600, +e.target.value || 0)); if (v !== result.brief.rent_kw_month) whatIf('rent', v); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></Field>
              </div>
              <div className="st-card st-summary">
                <div><b>In plain words</b>
                  {summary?.id === concept.id && summary.text ? <><p>{summary.text}</p><small>{summary.by}</small></> : <span>A short summary of this concept, written only from the numbers below.</span>}
                </div>
                <button className="st-btn" onClick={() => void summarize(concept.id)} disabled={summary?.id === concept.id && !summary.text}><Sparkles size={13} /> {summary?.id === concept.id && !summary.text ? 'Writing…' : 'Summarize'}</button>
              </div>
              <Analysis c={concept} r={result} base={base?.concepts.find((x) => x.id === concept.id) ?? null} />
            </section>
          )}

          {step === 4 && result && (
            <section className="st-page st-glass-in">
              <small className="st-eyebrow">04 · Analyze</small>
              <h1>Three ways to build the same brief</h1>
              {subTabs}
              <p className="st-lede">{result.ranking.note}</p>
              {result.ranking.close && <div className="st-card st-warn st-flexnote"><b>No clear winner.</b> {result.ranking.method} Pick on the specific trade-offs, or change cooling, storeys or redundancy to see a bigger difference.</div>}
              <div className="st-compare">
                {[...result.concepts].sort((a, b) => a.rank - b.rank).map((c) => (
                  <article key={c.id} className={`st-card st-concept ${preferred === c.id ? 'pref' : ''}`}>
                    <div className="st-concept-plan"><Plan2D concept={c} siteW={result.brief.site_w} siteD={result.brief.site_d} setback={result.brief.setback_m} mini /></div>
                    <div className="st-concept-head"><h3>{c.name}</h3><span className="st-rank">{c.feasible ? `Rank ${c.rank}` : 'Does not fit'}</span></div>
                    <p className="st-muted st-small">{c.strategy}</p>
                    <div className="st-scores">{FACTORS.map((f) => <div key={f.key}><span>{f.label}</span><i><b style={{ width: `${c.scores[f.key]}%` }} /></i><em>{c.scores[f.key].toFixed(0)}</em></div>)}</div>
                    <p className="st-small"><b>Advantage.</b> {c.advantage}</p>
                    <p className="st-small"><b>Trade-off.</b> {c.tradeoff}</p>
                    <div className="st-concept-foot">
                      <button className={`st-btn ${preferred === c.id ? 'primary' : ''}`} onClick={() => setPreferred(c.id)}><Star size={13} /> {preferred === c.id ? 'Preferred' : 'Select as preferred'}</button>
                      <button className="st-btn" onClick={() => { setActiveId(c.id); setStep(2); }}>Explore plan</button>
                    </div>
                  </article>
                ))}
              </div>
              <CompareTable r={result} />
            </section>
          )}

          {step === 5 && result && (
            <section className="st-page st-narrow st-glass-in">
              <small className="st-eyebrow">04 · Analyze</small>
              <h1>Record your choice</h1>
              {subTabs}
              <p className="st-lede">GeoStar ranks; you decide. Write down why, so the decision can be reviewed later.</p>
              <div className="st-card">
                <h3>Preferred concept</h3>
                <div className="st-choices">
                  {result.concepts.map((c) => (
                    <label key={c.id} className={preferred === c.id ? 'on' : ''}>
                      <input type="radio" name="pref" checked={preferred === c.id} onChange={() => setPreferred(c.id)} />
                      <div><b>{c.name}</b><span>Rank {c.rank} · {money(c.money.ten_year)} over 10 years · {num(c.metrics.footprint_m2)} m²</span></div>
                    </label>
                  ))}
                </div>
              </div>
              {chosen && chosen.checks.some((k) => !k.ok) && (
                <div className="st-card st-warn"><h3>Open issues with this concept</h3>
                  <ul>{chosen.checks.filter((k) => !k.ok).map((k) => <li key={k.name}><b>{k.name}.</b> {k.detail}</li>)}</ul></div>
              )}
              <div className="st-card">
                <h3>Decided by</h3>
                <input className="st-input" value={decidedBy} onChange={(e) => setDecidedBy(e.target.value)} maxLength={80} placeholder="Your name and role" />
              </div>
              <div className="st-card">
                <h3>Reasons</h3>
                <textarea value={reasons} onChange={(e) => setReasons(e.target.value)} rows={5} maxLength={1200} placeholder="Why this concept, and which trade-offs you accepted." />
              </div>
            </section>
          )}

          {step === 6 && result && chosen && report && (
            <section className="st-page st-narrow">
              <small className="st-eyebrow">05 · Deliver</small>
              <h1>{chosen.name}</h1>
              <p className="st-lede">{result.brief.halls} halls · {result.brief.racks.toLocaleString()} racks · {result.brief.mw_it} MW IT at {site ? siteLabel(site) : 'the chosen site'}.</p>
              <div className="st-card">
                <h3>Continue in CAD</h3>
                <p className="st-muted">A layered 2D drawing of the chosen concept: site, building, rooms, rack rows, generators and routes. Units are metres in local site coordinates.</p>
                <button className="st-btn primary" onClick={() => download(`${brief.name.replace(/\W+/g, '-').toLowerCase()}-${chosen.id}.dxf`, toDxf(chosen, result.brief.site_w, result.brief.site_d), 'application/dxf')}><Download size={14} /> Export DXF</button>
              </div>
              <div className="st-card">
                <h3>Decision evidence</h3>
                <p className="st-muted">The saved decision with the brief, site gates and their sources, every computed quantity, and every assumption with its basis. This is planning evidence, not certified engineering.</p>
                <button className="st-btn" onClick={() => download(`${brief.name.replace(/\W+/g, '-').toLowerCase()}-decision.json`, JSON.stringify(report, null, 2), 'application/json')}><Download size={14} /> Download decision report</button>
              </div>
              {parcelId && (
                <div className="st-card">
                  <h3>Investment memo (CoStar evidence)</h3>
                  <p className="st-muted">A printable memo built from this parcel&apos;s CoStar record, sale comps, occupancy and the chosen concept, with every figure sourced. Print → PDF.</p>
                  <button className="st-btn" onClick={() => void openInvestmentMemo(parcelId, brief.mw, brief.rackKw).then((e) => e && setError(e))}><FileText size={14} /> Open investment memo</button>
                </div>
              )}
              <div className="st-card">
                <h3>Prove it in operation</h3>
                <p className="st-muted">Run the operating plan against live grid prices and a grid emergency on the team's hardware.</p>
                <Link className="st-btn" href="/explore">Open live operations <ArrowRight size={14} /></Link>
              </div>
            </section>
          )}

          {step >= 7 && (result || !dc) && (
            <section className="st-page st-design">
              <small className="st-eyebrow">06 · Design</small>
              <h1>Model, protect and deploy</h1>
              {subTabs}
              <div key={step} className="st-glass-in">
                {step === 7 && (
                  <>
                    <p className="st-lede">{siteName} · A representative HAVEN model, ready to explore and protect.</p>
                    <FacilityModel protection={protection} kind={kind} kindLabel={kindLabel} onProtect={() => setStep(8)} />
                  </>
                )}
                {step > 7 && (
                  // Protect and Deploy are Smart Blocks screens; this frame lends them their scoped styles.
                  <div className="d2-shell sb st-twin-host st-sb-host">
                    {protection.error && (
                      <div className="hv-save-error" role="alert">
                        <span>{protection.error} Changes have not been saved.</span>
                        <button onClick={() => void protection.reload()}>Reload workspace</button>
                      </div>
                    )}
                    {typeof deployView === 'object' && step === 9 ? (
                      <ProjectCommandCenter key={deployView.id} facility={deployView} onBack={() => setDeployView('projects')} />
                    ) : protection.loading ? (
                      <div className="st-model-loading">Loading the facility’s protection workspace…</div>
                    ) : step === 8 ? (
                      <ProtectModule key={facility.id} state={protection.state} busy={protection.busy} act={protection.act}
                        onDesign={() => setStep(7)} initialStep={protectStart} onDeployed={openCommand} onOpenCommand={openCommand} />
                    ) : protection.state.deployed && deployView === 'current' ? (
                      <ProtectModule key={`${facility.id}-live`} state={protection.state} busy={protection.busy} act={protection.act} live
                        onDesign={() => setStep(7)} onBack={() => setDeployView('projects')} onEdit={() => { setProtectStart(0); setStep(8); }} />
                    ) : (
                      <DeployedProjects current={facility} currentDeployed={protection.state.deployed}
                        onOpen={(f) => setDeployView(f.id === facility.id ? 'current' : f)} onFinishCurrent={() => setStep(8)} />
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      <footer className="st-foot">
        <button className="st-btn" onClick={() => (step === 0 && sub > 0 ? setSub(sub - 1) : setStep(!dc && step === 7 ? 0 : ORDER[Math.max(0, ORDER.indexOf(step) - 1)]))} disabled={step === 0 && sub === 0}><ArrowLeft size={14} /> Back</button>
        <span className="st-foot-note">{busy ? 'Working…' : step === 0 && !dc ? `Layouts are for data centers. ${kindLabel} opens its concept model in Design.` : step === 0 && !site ? 'Choose a site to continue.' : step === 0 && sub < 3 ? 'Review the brief to continue.' : step === 5 && !canNext ? 'Select a concept and give a reason.' : result?.note ?? ''}</span>
        {step === 0 && dc && <button className="st-btn big" onClick={generateAndExplore} disabled={!canNext || busy}
          title="Skip the drone survey and generate the three layouts now">{busy ? 'Generating…' : 'Skip discover'} <Sparkles size={14} /></button>}
        {step < 9 && <button className="st-btn primary big" onClick={next} disabled={!canNext || busy}>{step === 1 && <Sparkles size={14} />}{nextLabel}{step !== 1 && <ArrowRight size={14} />}</button>}
      </footer>
        </div>

      <Copilot body={body(brief)} conceptId={concept?.id ?? null} selected={sel} stage={PAGES[step]} market={brief.market}
        facilityId={step >= 7 ? facility.id : null} lastScore={siteScore ? { verdict: siteScore.verdict, score: siteScore.score } : null}
        agent={agentRun} onOpenGraph={() => setIntelOpen(true)}
        onApply={applyPatch} onSelectSite={(id) => { const s = sites.find((x) => x.id === id); if (s) void pickSite(id); }} busy={busy} />
      {walkModel && site && parcelId && <SiteWalk parcelId={parcelId} modelId={walkModel} siteName={siteLabel(site)} mwIt={brief.mw} rackKw={brief.rackKw} onClose={() => setWalkModel(null)} />}
      {intelOpen && <AgentIntel s={agentRun.state} onClose={() => setIntelOpen(false)} onDecide={(a) => void agentRun.decide(a)} />}
      <Guide body={result ? body(brief) : null} conceptId={concept?.id ?? null} selected={sel} stage={PAGES[step]} market={brief.market}
        hasSite={!!site} onApply={applyPatch} />
      {dossier && <CostarDossier parcelId={parcelId} lotAcres={site?.lotAcres ?? null} mwIt={brief.mw} rackKw={brief.rackKw} initialTab={dossier}
        onUseLandValue={useLandValue} onNote={setInspection} onClose={() => setDossier(null)} />}
      {dealDesk && <DealDesk market={brief.market} mwIt={brief.mw} rackKw={brief.rackKw} onClose={() => setDealDesk(false)}
        onUseSite={(id) => { setDealDesk(false); setStep(0); setSub(2); const s = sites.find((x) => x.id === id || x.parcelId === id); void pickSite(s?.id ?? id); }} />}
      {importing && <ImportDesign body={body(brief)} onClose={() => setImporting(false)}
        onResult={(r, _notes: NotePreview[]) => { setResult(r); setBase(r); setEdits({}); setPreferred(null); setDecidedAt(null);
          setSel(null); setActiveId(r.concepts.find((c) => c.rank === 1)!.id); setImporting(false); setStep(2); }} />}
    </div>
  );
}

/** Sub-tabs styled like Define's, with a liquid-glass lens that slides from the previous tab to the active one. */
function SubTabs({ label, items, active, from, onPick }: { label: string; items: string[]; active: number; from: number | null; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const place = (i: number, glide: boolean) => {
      const b = host.querySelectorAll<HTMLButtonElement>('button')[i];
      if (!b) return;
      host.classList.toggle('is-gliding', glide);
      host.style.setProperty('--gx', `${b.offsetLeft}px`);
      host.style.setProperty('--gy', `${b.offsetTop}px`);
      host.style.setProperty('--gw', `${b.offsetWidth}px`);
      host.style.setProperty('--gh', `${b.offsetHeight}px`);
    };
    place(from ?? active, false);
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => place(active, true)); });
    const ro = new ResizeObserver(() => place(active, false));
    ro.observe(host);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [active, from]);
  return (
    <div className="st-tabs st-tabs-glass" ref={ref} role="tablist" aria-label={label}>
      <span className="st-tabs-lens" aria-hidden="true" />
      {items.map((t, i) => (
        <button key={t} type="button" role="tab" aria-selected={i === active} className={i === active ? 'on' : ''}
          onClick={() => i !== active && onPick(i)}><i>{i + 1}</i>{t}</button>
      ))}
    </div>
  );
}

function Inspector({ concept, sel, layers, setLayers, edit, onRemove, onGeom, hasContext }: {
  concept: Concept; sel: string | null; layers: Layers; setLayers: (l: Layers) => void; edit: boolean; onRemove: (code: string) => void;
  onGeom: (code: string, patch: Partial<Record<'x' | 'y' | 'w' | 'd', number>>) => void; hasContext: boolean;
}) {
  const yardItem = concept.yard.find((x) => x.code === sel);
  const storeys = concept.building.storeys;
  const r: Room | undefined = [...concept.rooms, ...concept.yard].find((x) => x.code === sel);
  const toggles: [Exclude<keyof Layers, 'roof' | 'level' | 'explode'>, string, string?][] = [['racks', 'Rack rows'], ['tags', 'Name tags'], ['yard', 'Outdoor plant'], ['aerial', 'Vexcel aerial'], ['labels', 'Plan labels'], ['site', 'Whole site in plan'], ['power', 'Power routes', ROUTE_COLOR.power], ['cooling', 'Cooling routes', ROUTE_COLOR.cooling], ['data', 'Data routes', ROUTE_COLOR.data]];
  const m = concept.metrics;
  return (
    <aside className="st-inspector">
      <h4>Layers</h4>
      <div className="st-layers">
        {toggles.map(([k, label, color]) => (
          <label key={k}><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />{color && <i style={{ background: color }} />}{label}</label>
        ))}
      </div>
      {hasContext && <label className="st-ctx"><input type="checkbox" checked={layers.context} onChange={(e) => setLayers({ ...layers, context: e.target.checked })} />Vexcel 3D surroundings (real captured mesh)</label>}
      <label className="st-roof"><span>Roof and rooftop solar</span><input type="range" min={0} max={1} step={0.05} value={layers.roof} onChange={(e) => setLayers({ ...layers, roof: +e.target.value })} /></label>
      {storeys > 1 && <label className="st-roof"><span>Pull the storeys apart</span><input type="range" min={0} max={1} step={0.05} value={layers.explode} onChange={(e) => setLayers({ ...layers, explode: +e.target.value })} disabled={layers.level !== null} /></label>}
      <h4>{r ? 'Inspector' : 'This concept'}</h4>
      {r ? (
        <>
          <p className="st-insp-title"><i style={{ background: TYPE_STYLE[r.type].fill, borderColor: TYPE_STYLE[r.type].stroke }} /><b>{r.code}</b> {r.name}</p>
          <dl className="st-dl">
            <dt>Type</dt><dd>{TYPE_STYLE[r.type].label}</dd>
            <dt>Size</dt><dd>{r.w.toFixed(1)} × {r.d.toFixed(1)} m</dd>
            <dt>Area</dt><dd>{num(r.w * r.d)} m²</dd>
            {r.need_m2 != null && <><dt>Area required</dt><dd>{num(r.need_m2)} m²</dd></>}
            {r.racks != null && <><dt>Racks placed</dt><dd>{num(r.racks)}</dd><dt>Rack positions</dt><dd>{num(r.positions)}</dd><dt>IT load</dt><dd>{r.mw} MW</dd></>}
            {r.hall != null && <><dt>Serves</dt><dd>Data hall {r.hall}</dd></>}
            {storeys > 1 && r.level != null && <><dt>Storey</dt><dd>Level {r.level + 1}</dd></>}
          </dl>
          <p className="st-why"><b>Why is this here?</b> {WHY[r.type]}</p>
          {edit && yardItem && (
            <div className="st-geom">
              {((yardItem.added ? ['x', 'y', 'w', 'd'] : ['x', 'y']) as ('x' | 'y' | 'w' | 'd')[]).map((k) => (
                <label key={k}>{{ x: 'East (m)', y: 'North (m)', w: 'Width (m)', d: 'Depth (m)' }[k]}
                  <input type="number" key={`${yardItem.code}${k}${yardItem[k]}`} defaultValue={Math.round(yardItem[k])}
                    onBlur={(e) => { const v = +e.target.value; if (Number.isFinite(v) && v !== Math.round(yardItem[k])) onGeom(yardItem.code, { [k]: v }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                </label>
              ))}
              {yardItem.added && <button className="st-btn" onClick={() => onGeom(yardItem.code, { w: yardItem.d, d: yardItem.w })}><RotateCw size={13} /> Turn 90°</button>}
              {yardItem.added && <button className="st-btn st-remove" onClick={() => onRemove(yardItem.code)}><Trash2 size={13} /> Remove</button>}
            </div>
          )}
        </>
      ) : (
        <>
          <dl className="st-dl">
            <dt>Building</dt><dd>{concept.building.w.toFixed(0)} × {concept.building.d.toFixed(0)} m</dd>
            <dt>Footprint</dt><dd>{num(m.footprint_m2)} m²</dd>
            <dt>Racks placed</dt><dd>{num(m.placed_racks)}</dd>
            <dt>Spare positions</dt><dd>{num(m.spare_positions + m.expansion_bay_positions)}</dd>
            <dt>Power route</dt><dd>{num(m.power_route_m)} m</dd>
            <dt>Cooling route</dt><dd>{num(m.cooling_route_m)} m</dd>
            <dt>Generators</dt><dd>{m.generators}</dd>
          </dl>
          <p className="st-why">Click any room in the plan or the model to see its size and why it is there.</p>
        </>
      )}
      <h4>Checks</h4>
      <ul className="st-checks">{concept.checks.map((k) => <li key={k.name} className={k.ok ? 'ok' : 'bad'}>{k.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}<div><b>{k.name}</b><span>{k.detail}</span></div></li>)}</ul>
    </aside>
  );
}

function Delta({ now, was, unit, lowerIsBetter = true, fmt }: { now: number; was: number | undefined; unit?: string; lowerIsBetter?: boolean; fmt: (n: number) => string }) {
  if (was == null || Math.abs(now - was) < Math.abs(was) * 0.0005) return null;
  const d = now - was;
  return <span className={`st-delta ${(d < 0) === lowerIsBetter ? 'good' : 'bad'}`}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}{unit ?? ''} vs your first brief</span>;
}

function Analysis({ c, r, base }: { c: Concept; r: StudioResult; base: Concept | null }) {
  const gate = (name: string) => r.site.gates.find((g) => g.gate === name);
  const homes = gate('Residential proximity'), flood = gate('Flood exposure'), water = gate('Water stress');
  const cap = c.money.capex;
  const bars: [string, number][] = [['Equipment', c.money.equipment], ['Building shell', c.money.shell], ['Distribution', c.money.distribution], ['Grid connection', c.money.interconnect]];
  if (c.money.added > 0) bars.push(['Added by you', c.money.added]);
  const flexSave = c.money.energy_per_year_flat - c.money.energy_per_year;
  return (
    <>
      {r.operating.flex_note && <div className="st-card st-warn st-flexnote"><b>Check the flexible running.</b> {r.operating.flex_note} Prices cover {r.operating.price_days} day{r.operating.price_days > 1 ? 's' : ''}; carbon uses one day.</div>}
      <div className="st-factors">
        <div className="st-card st-factor">
          <h3><Coins size={16} /> Money <Tag label="Estimated" /></h3>
          <Stat label="Cost to build" value={money(cap)} />
          <Delta now={cap} was={base?.money.capex} fmt={money} />
          <div className="st-bars">{bars.map(([k, v]) => <div key={k}><span>{k}</span><i><b style={{ width: `${(v / cap) * 100}%` }} /></i><em>{money(v)}</em></div>)}</div>
          <Stat label="Energy per year" value={money(c.money.energy_per_year)} sub={flexSave > 0 ? `${money(flexSave)} less than running flat out` : `At ${r.operating.price_flat} $/MWh wholesale`} tag={r.operating.price_label} />
          {flexSave < 0 && <p className="st-small st-flag">Flexible running costs {money(-flexSave)} more a year here.</p>}
          <Stat label="Land" value={c.money.land ? money(c.money.land) : 'Unknown'} sub={r.site.land_basis ?? undefined} tag={r.site.land_label ?? 'Unknown'} />
          <Stat label="Revenue per year" value={money(c.money.revenue_per_year)} sub={`At $${r.brief.rent_kw_month} per kW-month, once leased`} tag="Estimated" />
          <Stat label={`Net present value, ${c.money.analysis_years} years`} value={money(c.money.npv)} sub={`Likely range ${money(c.money.npv_p10)} to ${money(c.money.npv_p90)}`} tag="Simulated" />
          <Delta now={c.money.npv} was={base?.money.npv} fmt={money} lowerIsBetter={false} />
          <Stat label="Payback" value={c.money.payback_years != null ? `${c.money.payback_years} years` : `Not within ${c.money.analysis_years} years`} sub={`Power expected in ${c.money.months_to_power} months`} tag="Simulated" />
          {c.money.npv < 0 && <p className="st-small st-flag">At these assumptions the project does not earn back its cost of capital. Rent, build cost and time to power drive this; try the controls above.</p>}
          <p className="st-small st-muted">Grid connection cost is a scenario, not a quote <Tag label="Simulated" /></p>
        </div>
        <div className="st-card st-factor">
          <h3><Users size={16} /> People</h3>
          <Stat label="Nearest home" value={c.people.home_distance_m != null ? `${num(c.people.home_distance_m)} m` : 'Unknown'} sub={homes?.status === 'Pass' ? 'Clear of the limit' : homes?.reason} tag={homes?.label ?? 'Unknown'} />
          <Stat label="Generator noise at that home" value={c.people.noise_at_home_dba != null ? `${c.people.noise_at_home_dba} dBA` : 'Unknown'} sub="During tests and outages only" tag={c.people.noise_at_home_dba != null ? 'Estimated' : 'Unknown'} />
          <Stat label="Noise at the site boundary" value={`${c.people.noise_at_boundary_dba} dBA`} sub={`Generators ${c.people.generator_to_boundary_m} m from the boundary`} tag="Estimated" />
          <Stat label="Local jobs" value="Unknown" sub="No sourced jobs figure is loaded" tag="Unknown" />
        </div>
        <div className="st-card st-factor">
          <h3><Leaf size={16} /> Planet</h3>
          <Stat label="Carbon from electricity per year" value={`${num(c.planet.co2_t_per_year)} t`} tag={r.operating.carbon_label}
            sub={c.planet.co2_t_per_year_flat > c.planet.co2_t_per_year ? `${num(c.planet.co2_t_per_year_flat - c.planet.co2_t_per_year)} t less than running flat out`
              : c.planet.co2_t_per_year > c.planet.co2_t_per_year_flat ? `${num(c.planet.co2_t_per_year - c.planet.co2_t_per_year_flat)} t MORE than running flat out`
                : `Grid at ${r.operating.carbon_flat} kg/MWh`} />
          <Delta now={c.planet.co2_t_per_year} was={base?.planet.co2_t_per_year} unit=" t" fmt={(n) => num(n)} />
          <Stat label="Carbon to build the shell" value={`${num(c.planet.embodied_t)} t`} tag="Estimated" />
          <Stat label="Solar potential" value={`${num(c.planet.roof_solar_kwp)} kWp`} sub={`${pct(c.planet.roof_solar_share, 1)} of yearly electricity${c.planet.canopy_solar_kwp ? ` · ${num(c.planet.canopy_solar_kwp)} kWp from canopies` : ''}`} tag="Estimated" />
          <Stat label="Flood zone" value={flood?.status ?? 'Unknown'} sub={flood?.reason} tag={flood?.label ?? 'Unknown'} />
        </div>
        <div className="st-card st-factor">
          <h3><Droplets size={16} /> Resources</h3>
          <Stat label="Water per year" value={`${num(c.resources.water_m3_per_year)} m³`} sub={water ? `Local water stress: ${water.value ?? water.status}` : undefined} tag="Estimated" />
          <Delta now={c.resources.water_m3_per_year} was={base?.resources.water_m3_per_year} unit=" m³" fmt={(n) => num(n)} />
          <Stat label="Power drawn from the grid" value={`${c.resources.facility_mw} MW`} sub={r.site.substation_km != null ? `${r.site.substation_km} km to a high-voltage substation` : 'Substation distance unknown'} tag="Estimated" />
          <Stat label="Site left open" value={pct(c.resources.open_land_share)} sub={`${num(c.metrics.footprint_m2)} m² building`} tag="Estimated" />
          <Stat label="Room for future racks" value={num(c.resources.spare_positions)} sub="Rack positions, not powered capacity" tag="Estimated" />
          {c.resources.bess_mwh > 0 && <Stat label="Battery storage" value={`${c.resources.bess_mwh} MWh`} sub={`${c.resources.bess_minutes} minutes at full load`} tag="Estimated" />}
        </div>
      </div>
      <details className="st-card st-fold">
        <summary>
          <h3>Checks</h3>
          {c.checks.every((k) => k.ok)
            ? <span className="st-fold-meta ok"><CircleCheck size={13} /> All {c.checks.length} pass</span>
            : <span className="st-fold-meta bad"><CircleAlert size={13} /> {c.checks.filter((k) => !k.ok).length} of {c.checks.length} need attention</span>}
        </summary>
        <ul className="st-checks wide">{c.checks.map((k) => <li key={k.name} className={k.ok ? 'ok' : 'bad'}>{k.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}<div><b>{k.name}</b><span>{k.detail}</span></div></li>)}</ul>
        <details className="st-details"><summary>Assumptions behind these numbers ({r.assumptions.length})</summary>
          <table className="st-table"><tbody>{r.assumptions.map((a) => <tr key={a.key}><td>{a.basis}</td><td className="n">{num(a.value, 2)} {a.unit}</td><td><Tag label={a.label} /></td></tr>)}</tbody></table>
          <p className="st-small st-muted">{r.operating.price_source}. {r.operating.carbon_source}. {r.operating.notes.join(' ')}</p>
        </details>
      </details>
    </>
  );
}

function CompareTable({ r }: { r: StudioResult }) {
  const cs = [...r.concepts].sort((a, b) => a.rank - b.rank);
  const rows: [string, (c: Concept) => number, (n: number) => string, boolean][] = [
    ['Cost to build', (c) => c.money.capex, money, true],
    ['Net present value', (c) => c.money.npv, money, false],
    ['Ten-year cost', (c) => c.money.ten_year, money, true],
    ['Building footprint', (c) => c.metrics.footprint_m2, (n) => `${num(n)} m²`, true],
    ['Room for future racks', (c) => c.resources.spare_positions, (n) => num(n), false],
    ['Power route length', (c) => c.metrics.power_route_m, (n) => `${num(n)} m`, true],
    ['Cooling route length', (c) => c.metrics.cooling_route_m, (n) => `${num(n)} m`, true],
    ['Noise at the boundary', (c) => c.people.noise_at_boundary_dba, (n) => `${n} dBA`, true],
    ['Carbon to build the shell', (c) => c.planet.embodied_t, (n) => `${num(n)} t`, true],
    ['Solar potential', (c) => c.planet.roof_solar_kwp, (n) => `${num(n)} kWp`, false],
    ['Site left open', (c) => c.resources.open_land_share, (n) => pct(n), false],
  ];
  return (
    <details className="st-card st-fold">
      <summary><h3>Side by side</h3><span className="st-fold-meta">{rows.length} measures · {cs.length} concepts</span></summary>
      <table className="st-table st-cmp">
        <thead><tr><th />{cs.map((c) => <th key={c.id}>{c.name}</th>)}</tr></thead>
        <tbody>
          {rows.map(([label, get, fmt, lower]) => {
            const vals = cs.map(get);
            const best = lower ? Math.min(...vals) : Math.max(...vals);
            const tie = vals.every((v) => v === vals[0]);
            return <tr key={label}><td>{label}</td>{vals.map((v, i) => <td key={i} className={`n ${!tie && v === best ? 'best' : ''}`}>{fmt(v)}</td>)}</tr>;
          })}
        </tbody>
      </table>
      <p className="st-small st-muted">Best value in each row is highlighted. All figures are estimates from the stated assumptions.</p>
    </details>
  );
}
