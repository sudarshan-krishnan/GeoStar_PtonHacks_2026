'use client';
// Import your own design: drop a DXF, a blueprint image or a PDF, see it in 2D and 3D, move shapes, set the footprint,
// pin suggestions on the drawing, then let PlotStar build the brief inside that footprint (POST /blueprint/build).
// Geometry comes from services/api/app/cad_import.py (DXF) or Claude vision (images, PDFs); the layouts come from the
// layout engine. Nothing here invents numbers.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import dynamic from 'next/dynamic';
import { Box, CircleAlert, Crosshair, FileUp, Hammer, Loader2, MapPin, Maximize, MousePointer2, Move, Square, Trash2, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { StudioResult } from '../types';
import s from './import.module.css';

const Import3D = dynamic(() => import('./import-3d'), { ssr: false, loading: () => <div className={s.loading}>Loading 3D…</div> });

export interface Shape { id: string; layer: string; points: [number, number][]; closed: boolean; area_m2: number | null; from_lines?: boolean; label?: string }
export interface Drawing {
  kind: 'dxf' | 'image' | 'pdf'; name: string; label: string; units: string; units_assumed: boolean; scale_to_m: number; unit_options?: string[];
  /** Set when the file was kept in MongoDB Atlas (GridFS); builds and notes attach to it. */
  design_id?: string | null;
  layers: { name: string; shapes: number }[]; polygons: Shape[]; texts: { layer: string; x: number; y: number; h: number; text: string }[];
  bbox: { x: number; y: number; w: number; d: number };
  footprint: { source: string; shape_id: string | null; layer: string | null; area_m2: number; cx: number; cy: number; w: number; d: number; angle_deg: number };
  footprint_label: string; warnings: string[]; outline_px?: { left: number; top: number; right: number; bottom: number } | null;
  scale_text?: string; dimensions_basis?: string; units_on_drawing?: string; notes?: string[];
}
export interface NotePreview {
  note_id: string; text: string; understood: boolean; patch: Record<string, number | string> | null; summary: string;
  changed?: { metric: string; before: string; after: string; better: boolean | null }[];
}
interface Fit { fits: boolean; concept: string | null; racks: number; max_racks: number | null; max_mw: number | null; text: string }
interface Pin { id: string; x: number; y: number; text: string }
type Tool = 'select' | 'move' | 'pin';
type VB = { x: number; y: number; w: number; h: number };

const PALETTE = ['#264d39', '#3d7391', '#a8731c', '#6f5aa6', '#a5533a', '#4f7f55', '#5c665f', '#2f6f93', '#8a8062', '#b3362b'];
const ACCEPT = '.dxf,image/png,image/jpeg,image/webp,image/gif,application/pdf';

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${PUBLIC_DATA_API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `${path} failed (${r.status})`);
  return d as T;
}

/** Minimum-area rectangle of a point set (long side first), for "use this shape as the footprint". */
function minRect(pts: [number, number][]): { cx: number; cy: number; w: number; d: number; angle: number } {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  const h = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  let best = { area: Infinity, cx: 0, cy: 0, w: 0, d: 0, angle: 0 };
  for (let i = 0; i < h.length; i++) {
    const [x0, y0] = h[i], [x1, y1] = h[(i + 1) % h.length];
    const a = Math.atan2(y1 - y0, x1 - x0), c = Math.cos(-a), sn = Math.sin(-a);
    const rx = h.map(([x, y]) => x * c - y * sn), ry = h.map(([x, y]) => x * sn + y * c);
    const w = Math.max(...rx) - Math.min(...rx), d = Math.max(...ry) - Math.min(...ry);
    if (w * d < best.area) {
      const mx = (Math.max(...rx) + Math.min(...rx)) / 2, my = (Math.max(...ry) + Math.min(...ry)) / 2;
      best = { area: w * d, cx: mx * Math.cos(a) - my * Math.sin(a), cy: mx * Math.sin(a) + my * Math.cos(a), w, d, angle: (a * 180) / Math.PI };
    }
  }
  if (best.d > best.w) best = { ...best, w: best.d, d: best.w, angle: best.angle + 90 };
  best.angle = ((((best.angle + 90) % 180) + 180) % 180) - 90;
  return best;
}

export function ImportDesign({ body, onResult, onClose }: {
  /** The same body the Studio sends to POST /studio/generate. */
  body: Record<string, unknown>;
  onResult: (result: StudioResult, patches: NotePreview[]) => void;
  onClose: () => void;
}) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [rawDxf, setRawDxf] = useState<string | null>(null);
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, [number, number]>>({});
  const [foot, setFoot] = useState<{ cx: number; cy: number; w: number; d: number; angle: number; source: string; shapeId: string | null } | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [vb, setVb] = useState<VB>({ x: 0, y: -100, w: 100, h: 100 });
  const [built, setBuilt] = useState<{ result: StudioResult; fit: Fit; notes: NotePreview[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ kind: 'pan' | 'move'; x: number; y: number; vb: VB; id?: string; start?: [number, number] } | null>(null);

  useEffect(() => () => { if (img) URL.revokeObjectURL(img.url); }, [img]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const layerColor = useMemo(() => Object.fromEntries((drawing?.layers ?? []).map((l, i) => [l.name, PALETTE[i % PALETTE.length]])), [drawing]);
  const shapes = useMemo(() => (drawing?.polygons ?? []).filter((p) => !hidden.has(p.layer)).map((p) => {
    const m = moves[p.id];
    return m ? { ...p, points: p.points.map(([x, y]) => [x + m[0], y + m[1]] as [number, number]) } : p;
  }), [drawing, hidden, moves]);

  const fit = useCallback((d: Drawing | null = drawing) => {
    if (!d) return;
    const pad = Math.max(d.bbox.w, d.bbox.d) * 0.06 + 2;
    setVb({ x: d.bbox.x - pad, y: -(d.bbox.y + d.bbox.d) - pad, w: d.bbox.w + 2 * pad, h: d.bbox.d + 2 * pad });
  }, [drawing]);

  function loaded(d: Drawing) {
    setDrawing(d); setHidden(new Set()); setMoves({}); setSel(null); setPins([]); setBuilt(null); setError(null);
    setFoot({ cx: d.footprint.cx, cy: d.footprint.cy, w: d.footprint.w, d: d.footprint.d, angle: d.footprint.angle_deg, source: d.footprint.source, shapeId: d.footprint.shape_id });
    fit(d);
  }

  async function open(file: File) {
    setError(null); setBuilt(null);
    if (file.size > 10 * 1024 * 1024) { setError('That file is larger than 10 MB.'); return; }
    const isDxf = /\.dxf$/i.test(file.name);
    const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
    if (/\.dwg$/i.test(file.name)) { setError('DWG files cannot be read directly. Export the plan as DXF (ASCII) from your CAD tool.'); return; }
    if (!isDxf && !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(type)) { setError('Use a .dxf drawing, an image (PNG, JPG, WebP) or a PDF.'); return; }
    setBusy(isDxf ? 'Reading your drawing…' : 'Reading your blueprint with Claude. This takes about half a minute…');
    try {
      if (isDxf) {
        const text = await file.text();
        setRawDxf(text); setImg(null);
        loaded(await post<Drawing>('/blueprint/dxf', { name: file.name, text }));
      } else {
        const data = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
          fr.onerror = () => rej(new Error('Could not read the file.'));
          fr.readAsDataURL(file);
        });
        setRawDxf(null);
        const d = await post<Drawing>('/blueprint/image', { name: file.name, media_type: type, data });
        if (type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          const im = new Image();
          im.onload = () => setImg({ url, w: im.naturalWidth, h: im.naturalHeight });
          im.src = url;
        } else setImg(null);
        loaded(d);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function setUnits(units: string) {
    if (!rawDxf || !drawing) return;
    setBusy('Rescaling…');
    try { loaded({ ...(await post<Drawing>('/blueprint/dxf', { name: drawing.name, text: rawDxf, units })) }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  // ---- 2D interaction: SVG user units are (x, -y) metres
  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, -p.y];
  };
  function onWheel(e: React.WheelEvent) {
    const [wx, wy] = toWorld(e);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setVb((v) => ({ x: wx - (wx - v.x) * k, y: -wy - (-wy - v.y) * k, w: v.w * k, h: v.h * k }));
  }
  function down(e: RPointerEvent<SVGSVGElement>, shapeId?: string) {
    if (e.button !== 0) return;
    if (shapeId) e.stopPropagation(); // the shape handles it; the svg's own handler must not run twice
    const w = toWorld(e);
    if (tool === 'pin') { // a note can go anywhere, on a shape or not
      const id = String(pins.reduce((n, p) => Math.max(n, +p.id), 0) + 1);
      setPins((p) => [...p, { id, x: w[0], y: w[1], text: '' }]);
      setTimeout(() => document.getElementById(`pin-note-${id}`)?.focus(), 30);
      return;
    }
    if (shapeId && tool === 'move') {
      setSel(shapeId);
      gesture.current = { kind: 'move', x: e.clientX, y: e.clientY, vb, id: shapeId, start: w };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    setSel(shapeId ?? null); // select mode: pick the shape, and dragging still pans
    gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, vb };
  }
  function moveP(e: RPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || !svg.current) return;
    if (g.kind === 'pan') {
      const r = svg.current.getBoundingClientRect();
      const k = Math.max(g.vb.w / r.width, g.vb.h / r.height);
      setVb({ ...g.vb, x: g.vb.x - (e.clientX - g.x) * k, y: g.vb.y - (e.clientY - g.y) * k });
    } else if (g.id && g.start) {
      const w = toWorld(e);
      const id = g.id, dx = w[0] - g.start[0], dy = w[1] - g.start[1];
      g.start = w;
      setMoves((m) => ({ ...m, [id]: [(m[id]?.[0] ?? 0) + dx, (m[id]?.[1] ?? 0) + dy] }));
    }
  }
  const up = () => { gesture.current = null; };

  function pickFootprint(id: string) {
    const p = shapes.find((x) => x.id === id);
    if (!p || p.points.length < 3) return;
    const r = minRect(p.points);
    setFoot({ cx: r.cx, cy: r.cy, w: Math.round(r.w * 10) / 10, d: Math.round(r.d * 10) / 10, angle: Math.round(r.angle * 10) / 10, source: `shape ${id} on layer ${p.layer}`, shapeId: id });
  }

  async function build() {
    if (!foot) return;
    const w = Math.max(foot.w, foot.d), d = Math.min(foot.w, foot.d);
    if (d < 20) { setError('The footprint must be at least 20 m on each side for a data center layout.'); return; }
    setBusy('Laying the brief out inside your footprint…'); setError(null);
    try {
      const r = await post<{ result: StudioResult; fit: Fit; notes: NotePreview[]; design_id?: string | null }>('/blueprint/build', {
        ...body, footprint: { w, d, angle_deg: foot.angle, source: foot.source }, drawing_name: drawing?.name ?? '', design_id: drawing?.design_id ?? null,
        notes: pins.filter((p) => p.text.trim()).map((p) => ({ id: p.id, text: p.text.trim(), x: p.x, y: p.y })),
      });
      setBuilt(r);
      if (r.design_id && drawing && !drawing.design_id) setDrawing({ ...drawing, design_id: r.design_id });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const px = vb.w / 110; // one "screen-ish" unit for pins and handles
  const selShape = shapes.find((p) => p.id === sel) ?? null;
  const center: [number, number] = drawing ? [drawing.bbox.x + drawing.bbox.w / 2, drawing.bbox.y + drawing.bbox.d / 2] : [0, 0];

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label="Import your design">
      <div className={s.modal}>
        <header className={s.head}>
          <div><b>Import your design</b><span>DXF drawings, blueprint images or a PDF. PlotStar builds your brief inside your footprint.</span></div>
          <button className={s.icon} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>

        {!drawing ? (
          <label className={`${s.drop} ${drag ? s.dragging : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void open(f); }}>
            <input type="file" accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} hidden />
            {busy ? <><Loader2 size={22} className={s.spin} /><b>{busy}</b></> : <>
              <FileUp size={26} />
              <b>Drop a drawing here, or click to choose a file</b>
              <span>.dxf from AutoCAD, Revit, Rhino or QCAD (read exactly) · PNG, JPG or PDF blueprints (read by Claude, you verify the sizes)</span>
              <span>Files stay on your PlotStar server; images and PDFs are sent once to the Anthropic API to be read.</span>
            </>}
            {error && <em className={s.err}><CircleAlert size={14} /> {error}</em>}
          </label>
        ) : (
          <div className={s.body}>
            <div className={s.stage}>
              <div className={s.toolbar}>
                <div className="st-seg">
                  <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}><Square size={13} /> Drawing</button>
                  <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}><Box size={13} /> 3D</button>
                </div>
                {view === '2d' && <div className="st-seg">
                  <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} title="Select a shape, drag the background to pan"><MousePointer2 size={13} /> Select</button>
                  <button className={tool === 'move' ? 'on' : ''} onClick={() => setTool('move')} title="Drag a shape to move it"><Move size={13} /> Move</button>
                  <button className={tool === 'pin' ? 'on' : ''} onClick={() => setTool('pin')} title="Click the drawing to add a suggestion"><MapPin size={13} /> Add note</button>
                </div>}
                {view === '2d' && <button className="st-btn" onClick={() => fit()}><Maximize size={13} /> Fit</button>}
                <span className={s.badge}><span className={`st-tag ${drawing.kind === 'dxf' ? 'st-tag-sourced' : ''}`}>{drawing.label}</span></span>
              </div>
              {view === '2d' ? (
                <svg ref={svg} className={`${s.svg} ${tool === 'pin' ? s.pinCursor : ''}`} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
                  onWheel={onWheel} onPointerDown={(e) => down(e)} onPointerMove={moveP} onPointerUp={up} onPointerLeave={up}
                  role="img" aria-label={`Your drawing ${drawing.name}`}>
                  {img && drawing.outline_px && (() => {
                    const o = drawing.outline_px, W = drawing.bbox.w, D = drawing.bbox.d;
                    const sx = W / Math.max(1, o.right - o.left), sy = D / Math.max(1, o.bottom - o.top);
                    return <image href={img.url} x={-o.left * sx} y={-D - o.top * sy} width={img.w * sx} height={img.h * sy} opacity={0.55} preserveAspectRatio="none" />;
                  })()}
                  {shapes.map((p) => {
                    const pts = p.points.map(([x, y]) => `${x},${-y}`).join(' ');
                    const c = layerColor[p.layer] ?? '#44504a', on = p.id === sel;
                    const props = { points: pts, stroke: on ? '#b3362b' : c, strokeWidth: on ? 2.4 : 1.1, vectorEffect: 'non-scaling-stroke' as const,
                      onPointerDown: (e: RPointerEvent<SVGElement>) => down(e as unknown as RPointerEvent<SVGSVGElement>, p.id), className: s.shape };
                    return p.closed ? <polygon key={p.id} {...props} fill={on ? 'rgba(179,54,43,0.10)' : `${c}14`} /> : <polyline key={p.id} {...props} fill="none" />;
                  })}
                  {drawing.texts.filter((t) => !hidden.has(t.layer)).slice(0, 800).map((t, i) => (
                    <text key={i} x={t.x} y={-t.y} fontSize={Math.max(t.h, px * 1.2)} className={s.label}>{t.text}</text>
                  ))}
                  {shapes.filter((p) => p.label).map((p) => {
                    const xs = p.points.map((q) => q[0]), ys = p.points.map((q) => q[1]);
                    return <text key={`l${p.id}`} x={(Math.min(...xs) + Math.max(...xs)) / 2} y={-(Math.min(...ys) + Math.max(...ys)) / 2} fontSize={px * 1.6} textAnchor="middle" className={s.label}>{p.label}</text>;
                  })}
                  {foot && (
                    <g transform={`translate(${foot.cx} ${-foot.cy}) rotate(${-foot.angle})`} pointerEvents="none">
                      <rect x={-foot.w / 2} y={-foot.d / 2} width={foot.w} height={foot.d} className={s.foot} vectorEffect="non-scaling-stroke" />
                    </g>
                  )}
                  {pins.map((p) => (
                    <g key={p.id} transform={`translate(${p.x} ${-p.y})`} className={s.pin}>
                      <circle r={px * 1.8} /><text fontSize={px * 2} textAnchor="middle" dy={px * 0.7}>{p.id}</text>
                    </g>
                  ))}
                </svg>
              ) : (
                <div className={s.three}>
                  <Import3D shapes={shapes} footprintId={foot?.shapeId ?? null} center={center} span={Math.max(drawing.bbox.w, drawing.bbox.d)} height={8} />
                  <small className={s.caption}>Closed shapes extruded for a quick look. Your footprint is the tall green shape. Open lines are not shown in 3D.</small>
                </div>
              )}
              {busy && <div className={s.busy}><Loader2 size={15} className={s.spin} /> {busy}</div>}
            </div>

            <aside className={s.side}>
              {error && <p className={s.err}><CircleAlert size={14} /> {error}</p>}
              <section>
                <h4>Your drawing</h4>
                <p className={s.meta}><b>{drawing.name}</b> · {drawing.polygons.length.toLocaleString()} shapes · {drawing.bbox.w.toFixed(1)} × {drawing.bbox.d.toFixed(1)} m</p>
                {drawing.kind === 'dxf' ? (
                  <label className={s.row}>Units
                    <select value={drawing.units} onChange={(e) => void setUnits(e.target.value)} disabled={!!busy}>
                      {(drawing.unit_options ?? [drawing.units]).map((u) => <option key={u}>{u}</option>)}
                    </select>
                    {drawing.units_assumed && <span className="st-tag">Assumed</span>}
                  </label>
                ) : (
                  <p className={s.meta}>{drawing.dimensions_basis}{drawing.scale_text ? ` Scale on the drawing: ${drawing.scale_text}.` : ''} <span className="st-tag">Read from your drawing, verify</span></p>
                )}
                {drawing.warnings.map((w) => <p key={w} className={s.warn}><CircleAlert size={12} /> {w}</p>)}
                {(drawing.notes ?? []).length > 0 && <ul className={s.small}>{drawing.notes!.map((n) => <li key={n}>{n}</li>)}</ul>}
              </section>

              <section>
                <h4>Layers</h4>
                <div className={s.layers}>
                  {drawing.layers.map((l) => (
                    <label key={l.name}><input type="checkbox" checked={!hidden.has(l.name)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(l.name)) n.delete(l.name); else n.add(l.name); return n; })} />
                      <i style={{ background: layerColor[l.name] }} />{l.name}<em>{l.shapes}</em></label>
                  ))}
                </div>
              </section>

              {selShape && (
                <section>
                  <h4>Selected shape</h4>
                  <p className={s.meta}>{selShape.label ?? selShape.id} · layer {selShape.layer} · {selShape.closed ? `${(selShape.area_m2 ?? 0).toLocaleString()} m²` : 'open line'}{moves[selShape.id] ? ' · moved' : ''}</p>
                  <div className={s.btns}>
                    {selShape.closed && <button className="st-btn" onClick={() => pickFootprint(selShape.id)}><Crosshair size={13} /> Use as footprint</button>}
                    {moves[selShape.id] && <button className="st-btn" onClick={() => setMoves(({ [selShape.id]: _drop, ...rest }) => rest)}>Undo move</button>}
                  </div>
                </section>
              )}

              <section>
                <h4>Footprint PlotStar builds inside</h4>
                {foot && <>
                  <div className={s.dims}>
                    <label>Width<span><input type="number" min={20} step={0.5} value={foot.w} onChange={(e) => setFoot({ ...foot, w: Math.max(1, +e.target.value || 0), source: 'edited by you' })} /> m</span></label>
                    <label>Depth<span><input type="number" min={20} step={0.5} value={foot.d} onChange={(e) => setFoot({ ...foot, d: Math.max(1, +e.target.value || 0), source: 'edited by you' })} /> m</span></label>
                  </div>
                  <p className={s.meta}>{(foot.w * foot.d).toLocaleString(undefined, { maximumFractionDigits: 0 })} m² · {foot.angle ? `turned ${foot.angle}°` : 'square to the drawing'} · from {foot.source} <span className="st-tag">{drawing.footprint_label}</span></p>
                </>}
              </section>

              <section>
                <h4>Your suggestions</h4>
                {pins.length === 0 ? <p className={s.meta}>Choose <b>Add note</b> and click the drawing to pin a suggestion, for example “use air cooling”, “fit another 200 racks” or “keep this wall”.</p> : (
                  <ol className={s.notes}>{pins.map((p) => (
                    <li key={p.id}><i>{p.id}</i>
                      <textarea id={`pin-note-${p.id}`} rows={2} maxLength={400} value={p.text} placeholder="Your suggestion…" onChange={(e) => setPins((all) => all.map((x) => (x.id === p.id ? { ...x, text: e.target.value } : x)))} />
                      <button className={s.icon} onClick={() => setPins((all) => all.filter((x) => x.id !== p.id))} aria-label={`Remove note ${p.id}`}><Trash2 size={13} /></button></li>
                  ))}</ol>
                )}
              </section>

              {built ? (
                <section className={s.result}>
                  <h4>Generated by PlotStar</h4>
                  <p className={built.fit.fits ? s.ok : s.warn}>{built.fit.text}</p>
                  {built.notes.length > 0 && <ul className={s.previews}>{built.notes.map((n) => (
                    <li key={n.note_id}><b>Note {n.note_id}</b> {n.summary}{n.understood && <span className="st-tag">Preview</span>}</li>
                  ))}</ul>}
                  <div className={s.btns}>
                    <button className="st-btn primary" onClick={() => onResult(built.result, built.notes)}>See the layouts in the Studio</button>
                    <button className="st-btn" onClick={() => setBuilt(null)}>Change and rebuild</button>
                  </div>
                  <p className={s.meta}>Note changes are previews. Apply them in the Studio if you agree with the numbers.</p>
                </section>
              ) : (
                <div className={s.footer}>
                  <button className="st-btn" onClick={() => { setDrawing(null); setError(null); }}>Import another file</button>
                  <button className="st-btn primary" onClick={() => void build()} disabled={!!busy || !foot}><Hammer size={14} /> Build it</button>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportDesign;
