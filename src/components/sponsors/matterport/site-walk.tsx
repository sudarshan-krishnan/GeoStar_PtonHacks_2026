'use client';
// Site walk: work inside the Matterport scan of an existing CoStar building.
//   Pin a note   aim at a spot in the scan; GeoStar freezes that 3D point and pins your note there (power, cooling,
//                structure, access, fire, water). Notes come back as pins the next time anyone opens the scan.
//   Measure      Matterport's own measuring tool; you say what you measured (clear height, column spacing, doors) and
//                GeoStar uses it in the conversion check as a Measured value, where CoStar records nothing.
// The embedded viewer has no click events for the page, only hover (Pointer.intersection), so pinning is "aim, then
// capture": a short countdown freezes the point before the pointer leaves the scan. Without the SDK (key not allowed
// on this address) the plain viewer still plays and notes and measurements are saved without a 3D position.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, CircleAlert, Crosshair, Eye, Layers, MapPin, Ruler, Trash2, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { ConversionResp } from '../costar/existing-vs-proposed';
import s from './site-walk.module.css';

type V3 = { x: number; y: number; z: number };
interface Note { id: string; category: string; severity: string; text: string; position: V3 | null; normal: V3 | null; floor: number | null; author: string | null; created_at: string; stored?: string }
interface Measure { id: string; kind: string; label: string; length_m: number; points: V3[]; floor: number | null; method: string; author: string | null; created_at: string }
interface Walk {
  notes: Note[]; measurements: Measure[]; stored: string; label: string; note: string;
  categories: Record<string, string>; kinds: Record<string, { label: string; need_m: number | null; why: string }>;
  derived: Record<string, { label: string; value_m: number; count: number; need_m: number | null }>;
}
type Hit = { position: V3; normal: V3; floorIndex?: number };
// The Matterport SDK object is untyped here on purpose: we only call the handful of methods named below.
type Sdk = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KEY = process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY ?? '';
const SDK_URL = `https://static.matterport.com/showcase-sdk/bootstrap/3.1.0-0-g1cd7e0997a/sdk.js?applicationKey=${KEY}`;
const COLORS: Record<string, [number, number, number]> = {
  power: [0.85, 0.6, 0.1], cooling: [0.18, 0.5, 0.69], structure: [0.55, 0.35, 0.27], access: [0.42, 0.45, 0.5],
  fire: [0.75, 0.22, 0.17], water: [0.12, 0.6, 0.75], other: [0.42, 0.31, 0.82],
};
const hex = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
const ft = (m: number) => `${(m * 3.28084).toFixed(1)} ft`;
const api = (path: string, init?: RequestInit) => fetch(`${PUBLIC_DATA_API}${path}`, init).then(async (r) => {
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `Request failed (${r.status})`);
  return d;
});

function loadSdkScript(): Promise<void> {
  const w = window as unknown as { MP_SDK?: unknown };
  if (w.MP_SDK) return Promise.resolve();
  return new Promise((res, rej) => {
    const prior = document.querySelector<HTMLScriptElement>('script[data-mp-sdk]');
    const el = prior ?? Object.assign(document.createElement('script'), { src: SDK_URL, async: true });
    el.dataset.mpSdk = '1';
    el.addEventListener('load', () => res());
    el.addEventListener('error', () => rej(new Error('Matterport SDK script did not load')));
    if (!prior) document.head.appendChild(el);
  });
}

export function SiteWalk({ parcelId, modelId, siteName, mwIt, rackKw, onClose }: {
  parcelId: string; modelId: string; siteName: string; mwIt?: number; rackKw?: number; onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const hit = useRef<Hit | null>(null);
  const tags = useRef<Record<string, string>>({});
  const restoring = useRef(false);
  const [sdk, setSdk] = useState<Sdk>(null);
  const [link, setLink] = useState<'connecting' | 'connected' | 'plain'>(KEY ? 'connecting' : 'plain');
  const [walk, setWalk] = useState<Walk | null>(null);
  const [conv, setConv] = useState<ConversionResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'notes' | 'measure' | 'check'>('notes');
  const [aim, setAim] = useState<number | null>(null);          // countdown seconds while aiming
  const [floorNow, setFloorNow] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ position: V3 | null; normal: V3 | null; floor: number | null } | null>(null);
  const [cat, setCat] = useState('structure');
  const [sev, setSev] = useState('concern');
  const [text, setText] = useState('');
  const [measuring, setMeasuring] = useState(false);
  const [pending, setPending] = useState<{ length: number; points: V3[]; floor: number | null } | null>(null);
  const [kind, setKind] = useState('clear_height');
  const [manual, setManual] = useState('');
  const [author, setAuthor] = useState('');
  const [busy, setBusy] = useState(false);

  const src = `https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&play=1&qs=1${KEY ? `&applicationKey=${KEY}` : ''}`;

  const refresh = useCallback(async () => {
    const [w, c] = await Promise.all([
      api(`/costar/site-walk/${encodeURIComponent(parcelId)}`),
      mwIt ? api(`/costar/conversion/${encodeURIComponent(parcelId)}?mw_it=${mwIt}&rack_kw=${rackKw ?? 20}`).catch(() => null) : Promise.resolve(null),
    ]);
    setWalk(w); if (c) setConv(c);
    return w as Walk;
  }, [parcelId, mwIt, rackKw]);
  useEffect(() => { refresh().catch((e) => setErr(e.message)); }, [refresh]);

  // connect the SDK once the viewer has loaded; fall back to the plain viewer after 25 s
  useEffect(() => {
    if (!KEY) return;
    const f = frame.current;
    if (!f) return;
    let alive = true;
    const onLoad = async () => {
      try {
        await loadSdkScript();
        const mp = (window as unknown as { MP_SDK: { connect: (f: HTMLIFrameElement, k: string, v: string) => Promise<Sdk> } }).MP_SDK;
        const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000));
        const sdkObj = await Promise.race([mp.connect(f, KEY, ''), timeout]);
        if (!alive) return;
        sdkObj.Pointer.intersection.subscribe((i: Hit) => { if (i?.position) { hit.current = i; setFloorNow(i.floorIndex ?? null); } });
        setSdk(sdkObj); setLink('connected');
      } catch { if (alive) setLink('plain'); }
    };
    f.addEventListener('load', onLoad);
    return () => { alive = false; f.removeEventListener('load', onLoad); };
  }, []);

  // show saved notes as pins and saved measurements as lines, then listen for new measurements
  useEffect(() => {
    if (!sdk || !walk) return;
    let sub: { cancel: () => void } | null = null;
    (async () => {
      for (const n of walk.notes) {
        if (!n.position || tags.current[n.id]) continue;
        const c = COLORS[n.category] ?? COLORS.other;
        const nrm = n.normal ?? { x: 0, y: 1, z: 0 };
        try {
          const [id] = await sdk.Tag.add({ label: `${walk.categories[n.category] ?? n.category} · ${n.severity}`, description: n.text,
            anchorPosition: n.position, stemVector: { x: nrm.x * 0.3, y: nrm.y * 0.3, z: nrm.z * 0.3 }, color: { r: c[0], g: c[1], b: c[2] } });
          tags.current[n.id] = id;
        } catch { /* a pin that cannot be drawn stays in the list */ }
      }
      restoring.current = true;
      try {
        const drawn = walk.measurements.filter((m) => m.points?.length >= 2).map((m) => ({ points: m.points, label: `${m.label} ${m.length_m.toFixed(2)} m` }));
        if (drawn.length) await sdk.Measurements.add(...drawn);
      } catch { /* measurements still listed */ }
      restoring.current = false;
      sub = sdk.Measurements.data.subscribe({
        onAdded(_: string, item: { totalLength: number; points: V3[]; temporary: boolean }) {
          if (restoring.current || item.temporary || !(item.totalLength > 0)) return;
          setPending({ length: item.totalLength, points: [...item.points], floor: hit.current?.floorIndex ?? null });
          setTab('measure');
        },
      });
    })();
    return () => sub?.cancel();
  }, [sdk, walk?.notes.length, walk?.measurements.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // aim, then capture: a countdown freezes the last surface under the pointer before it leaves the scan
  useEffect(() => {
    if (aim === null) return;
    if (aim === 0) {
      const h = hit.current;
      setAim(null);
      if (!h) { setErr('Point at a wall or the floor inside the scan, then try again.'); return; }
      setDraft({ position: { ...h.position }, normal: { ...h.normal }, floor: h.floorIndex ?? null });
      setTab('notes');
      return;
    }
    const t = setTimeout(() => setAim(aim - 1), 1000);
    return () => clearTimeout(t);
  }, [aim]);

  async function saveNote() {
    if (!draft || !text.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api(`/costar/site-walk/${encodeURIComponent(parcelId)}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId, category: cat, severity: sev, text, author: author || null, ...draft }) });
      setDraft(null); setText('');
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function saveMeasure(lengthM: number, points: V3[], method: string, floor: number | null) {
    setBusy(true); setErr(null);
    try {
      await api(`/costar/site-walk/${encodeURIComponent(parcelId)}/measurements`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId, kind, length_m: lengthM, points, floor, author: author || null, method }) });
      setPending(null); setManual('');
      await refresh();
      setTab('check');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try {
      await api(`/costar/site-walk/${encodeURIComponent(parcelId)}/items/${id}`, { method: 'DELETE' });
      if (sdk && tags.current[id]) { try { await sdk.Tag.remove(tags.current[id]); } catch { /* ignore */ } delete tags.current[id]; }
      await refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  async function goTo(n: Note) {
    const id = tags.current[n.id];
    if (!sdk || !id) return;
    try { await sdk.Mattertag.navigateToTag(id, sdk.Mattertag.Transition.FLY); await sdk.Tag.open?.(id); } catch { /* ignore */ }
  }

  async function toggleMeasure() {
    if (!sdk) return;
    const on = !measuring;
    try { await sdk.Measurements.toggleMode(on); setMeasuring(on); if (on) setTab('measure'); } catch (e) { setErr(`Measuring is not available: ${(e as Error).message}`); }
  }

  const view = (m: 'INSIDE' | 'DOLLHOUSE' | 'FLOORPLAN') => sdk?.Mode.moveTo(sdk.Mode.Mode[m]).catch(() => {});
  const blockers = walk?.notes.filter((n) => n.severity === 'blocker').length ?? 0;

  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label={`Site walk of ${siteName}`}>
      <section className={s.shell}>
        <header className={s.head}>
          <div>
            <span className={s.eyebrow}><Box size={13} /> Site walk · Matterport scan · CoStar building</span>
            <h2>{siteName}</h2>
            <p>{walk ? `${walk.notes.length} notes${blockers ? ` (${blockers} blocker${blockers > 1 ? 's' : ''})` : ''} · ${walk.measurements.length} measurements · saved to ${walk.stored}` : 'Loading…'}</p>
          </div>
          <span className={`${s.link} ${s[`link_${link}`]}`}>{link === 'connected' ? 'Pins and measuring on' : link === 'connecting' ? 'Connecting to the scan…' : 'Plain viewer: notes save without a 3D pin'}</span>
          <button className={s.close} onClick={onClose} aria-label="Close the site walk"><X size={17} /></button>
        </header>

        <div className={s.body}>
          <div className={s.stage}>
            <iframe ref={frame} src={src} title={`Matterport scan of ${siteName}`} allow="xr-spatial-tracking; fullscreen" />
            <div className={s.toolbar}>
              <button className={`st-btn ${aim !== null ? 'primary' : ''}`} onClick={() => (link === 'connected' ? setAim(3) : setDraft({ position: null, normal: null, floor: null }))} disabled={aim !== null}>
                <MapPin size={14} /> {aim !== null ? `Pinning in ${aim}…` : 'Pin a note'}
              </button>
              <button className={`st-btn ${measuring ? 'primary' : ''}`} onClick={() => void toggleMeasure()} disabled={link !== 'connected'} title={link === 'connected' ? 'Use Matterport’s measuring tool' : 'Needs the SDK connection'}>
                <Ruler size={14} /> {measuring ? 'Done measuring' : 'Measure'}
              </button>
              {link === 'connected' && <span className={s.seg}>
                <button onClick={() => void view('INSIDE')}><Eye size={13} /> Inside</button>
                <button onClick={() => void view('DOLLHOUSE')}><Box size={13} /> Dollhouse</button>
                <button onClick={() => void view('FLOORPLAN')}><Layers size={13} /> Floor plan</button>
              </span>}
            </div>
            {aim !== null && <div className={s.aim}><Crosshair size={18} /> Hold the pointer on the spot in the scan… {aim}</div>}
            {measuring && <div className={s.aim}><Ruler size={16} /> Click the start and end points in the scan. Each finished line asks what it measures.</div>}
            {link === 'connected' && floorNow !== null && <span className={s.floor}>Floor {floorNow + 1}</span>}
          </div>

          <aside className={s.side}>
            <nav className={s.tabs} role="tablist">
              {([['notes', `Notes (${walk?.notes.length ?? 0})`], ['measure', `Measurements (${walk?.measurements.length ?? 0})`], ['check', 'What it changes']] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? s.on : ''} onClick={() => setTab(k)}>{l}</button>
              ))}
            </nav>
            {err && <p className={s.err}><CircleAlert size={13} /> {err}</p>}

            {tab === 'notes' && (
              <div className={s.pane}>
                {draft && (
                  <div className={s.form}>
                    <b>{draft.position ? 'New pinned note' : 'New note (no 3D pin)'}</b>
                    <div className={s.chips}>{walk && Object.entries(walk.categories).map(([k, l]) => (
                      <button key={k} className={cat === k ? s.chipOn : ''} style={{ ['--c' as string]: hex(COLORS[k] ?? COLORS.other) }} onClick={() => setCat(k)}>{l}</button>
                    ))}</div>
                    <div className={s.sev}>{['info', 'concern', 'blocker'].map((v) => <button key={v} className={sev === v ? s.chipOn : ''} onClick={() => setSev(v)}>{v}</button>)}</div>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1200} placeholder="What you see here: e.g. columns every 7 m, cracked slab by the dock, single 400 A panel" autoFocus />
                    <div className={s.row}><button className="st-btn primary" onClick={() => void saveNote()} disabled={busy || !text.trim()}>Save note</button><button className="st-btn" onClick={() => setDraft(null)}>Cancel</button></div>
                  </div>
                )}
                {walk?.notes.length === 0 && !draft && <p className={s.empty}>No notes yet. Press <b>Pin a note</b>, hold the pointer on the spot in the scan, and write what you see.</p>}
                <ul className={s.list}>{walk?.notes.slice().reverse().map((n) => (
                  <li key={n.id}>
                    <i style={{ background: hex(COLORS[n.category] ?? COLORS.other) }} />
                    <div>
                      <b>{walk.categories[n.category] ?? n.category}</b> <span className={`${s.badge} ${s[`sev_${n.severity}`]}`}>{n.severity}</span>
                      <p>{n.text}</p>
                      <small>{n.position ? `Pinned${n.floor != null ? ` on floor ${n.floor + 1}` : ''}` : 'No 3D pin'} · {n.author ? `${n.author} · ` : ''}{new Date(n.created_at).toLocaleString()}</small>
                    </div>
                    <span className={s.acts}>
                      {n.position && tags.current[n.id] && <button onClick={() => void goTo(n)} title="Fly to this pin"><MapPin size={13} /></button>}
                      <button onClick={() => void remove(n.id)} title="Delete"><Trash2 size={13} /></button>
                    </span>
                  </li>
                ))}</ul>
              </div>
            )}

            {tab === 'measure' && (
              <div className={s.pane}>
                {pending && (
                  <div className={s.form}>
                    <b>New measurement: {pending.length.toFixed(2)} m ({ft(pending.length)})</b>
                    <span className={s.hint}>What did you measure?</span>
                    <KindChips walk={walk} kind={kind} setKind={setKind} />
                    <div className={s.row}><button className="st-btn primary" onClick={() => void saveMeasure(pending.length, pending.points, 'Matterport measurement tool', pending.floor)} disabled={busy}>Save measurement</button><button className="st-btn" onClick={() => setPending(null)}>Discard</button></div>
                  </div>
                )}
                {!pending && (
                  <div className={s.form}>
                    <b>{link === 'connected' ? 'Press Measure and draw a line in the scan' : 'Enter a measurement you took in the scan'}</b>
                    <KindChips walk={walk} kind={kind} setKind={setKind} />
                    <div className={s.row}>
                      <input type="number" step="0.01" min="0.05" placeholder="metres" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Length in metres" />
                      <button className="st-btn" onClick={() => void saveMeasure(+manual, [], 'Entered by hand from the scan', null)} disabled={busy || !(+manual > 0.05)}>Save</button>
                    </div>
                  </div>
                )}
                <ul className={s.list}>{walk?.measurements.slice().reverse().map((m) => {
                  const k = walk.kinds[m.kind];
                  const ok = k?.need_m != null ? m.length_m >= k.need_m : null;
                  return (
                    <li key={m.id}>
                      <i className={ok === false ? s.bad : ok ? s.good : ''} />
                      <div><b>{m.label}</b> <span className={s.num}>{m.length_m.toFixed(2)} m · {ft(m.length_m)}</span>
                        {k?.need_m != null && <p>{ok ? 'Meets' : 'Below'} the {k.need_m} m GeoStar uses. {k.why}</p>}
                        <small>{m.method}{m.author ? ` · ${m.author}` : ''} · {new Date(m.created_at).toLocaleString()}</small></div>
                      <span className={s.acts}><button onClick={() => void remove(m.id)} title="Delete"><Trash2 size={13} /></button></span>
                    </li>
                  );
                })}</ul>
              </div>
            )}

            {tab === 'check' && (
              <div className={s.pane}>
                {!conv ? <p className={s.empty}>{mwIt ? 'Loading the conversion check…' : 'Set a capacity in the brief to run the conversion check.'}</p> : (
                  <>
                    <p className={s.hint}>Could this existing building hold {conv.racks_needed.toLocaleString()} racks? What you measure here replaces what CoStar does not record.</p>
                    <table className={s.table}><tbody>{conv.checks.map((c) => (
                      <tr key={c.name}><td>{c.name}{(c as { label?: string }).label === 'Measured' && <span className={`${s.badge} ${s.measured}`}>Measured</span>}</td>
                        <td className={s.num}>{c.have != null ? `${c.have.toLocaleString()} ${c.unit}` : 'unknown'}</td>
                        <td className={s.num}>{c.need != null ? `needs ${c.need.toLocaleString()}` : ''}</td>
                        <td><span className={`${s.badge} ${s[`st_${c.status.replace(/\s/g, '_')}`]}`}>{c.status}</span></td></tr>
                    ))}</tbody></table>
                    <b className={s.sub}>Still unknown</b>
                    <ul className={s.plain}>{conv.missing.map((m) => <li key={m.item}><b>{m.item}.</b> {m.why}</li>)}</ul>
                    <p className={s.hint}>{conv.note}</p>
                  </>
                )}
              </div>
            )}
            <label className={s.author}>Your name on notes <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80} placeholder="optional" /></label>
            <p className={s.foot}>{walk?.note} The scan and building record are CoStar&apos;s; the notes and measurements are yours.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}

function KindChips({ walk, kind, setKind }: { walk: Walk | null; kind: string; setKind: (k: string) => void }) {
  if (!walk) return null;
  return <div className={s.chips}>{Object.entries(walk.kinds).map(([k, v]) => <button key={k} className={kind === k ? s.chipOn : ''} onClick={() => setKind(k)}>{v.label}</button>)}</div>;
}
