'use client';
// Small SVG charts for the Data page, built to the dataviz method: thin marks, hairline solid grid, legend for >= 2
// series, selective direct labels, hover tooltip with a generous hit target, and a table view for every chart.
// Series colours are the validated reference slots (run against the white card surface): blue, orange, aqua.
import { useId, useMemo, useState, type ReactNode } from 'react';

export const SLOT = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
export const OTHER = '#898781';
const INK = '#18231d', INK2 = '#44504a', MUTED = '#747f78', GRID = '#e1e0d9', AXIS = '#c3c2b7', SURFACE = '#ffffff';

export interface Pt { x: number; y: number; label?: string; series?: string; extra?: string }
export interface Series { name: string; color: string; points: Pt[] }

function ticks(min: number, max: number, n = 4): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step, out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(+v.toFixed(10));
  return out;
}
const compact = (v: number) => Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 0 : 1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : v.toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Chart frame: title, optional legend, table-view toggle, and the plot or its table twin. */
function Frame({ title, sub, legend, table, children }: { title: string; sub?: string; legend?: { name: string; color: string }[]; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="ch">
      <figcaption className="ch-head">
        <div><b>{title}</b>{sub && <span>{sub}</span>}</div>
        <div className="ch-tools">
          {legend && legend.length >= 2 && <ul className="ch-legend">{legend.map((l) => <li key={l.name}><i style={{ background: l.color }} />{l.name}</li>)}</ul>}
          <button type="button" className="ch-toggle" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? 'Chart' : 'Table'}</button>
        </div>
      </figcaption>
      {asTable ? <div className="ch-table">{table}</div> : children}
    </figure>
  );
}

export function LineChart({ title, sub, series, xFmt, yFmt = compact, height = 220, labelPeak = false }: {
  title: string; sub?: string; series: Series[]; xFmt: (x: number) => string; yFmt?: (y: number) => string; height?: number; labelPeak?: boolean;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null); // index into the x domain
  const W = 640, H = height, m = { l: 48, r: 70, t: 12, b: 28 };
  const all = series.flatMap((s) => s.points);
  const empty = all.length === 0;
  const xs = Array.from(new Set(all.map((p) => p.x))).sort((a, b) => a - b);
  const x0 = xs[0] ?? 0, x1 = xs[xs.length - 1] ?? 1;
  const ymin = Math.min(0, ...all.map((p) => p.y)), ymax = Math.max(1, ...all.map((p) => p.y));
  const yt = ticks(ymin, ymax);
  const yTop = yt[yt.length - 1], yBot = yt[0];
  const sx = (x: number) => m.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + (1 - (y - yBot) / (yTop - yBot || 1)) * (H - m.t - m.b);
  const peak = labelPeak && all.length ? all.reduce((a, b) => (b.y > a.y ? b : a)) : null;
  const hx = hover != null ? xs[hover] : null;
  return (
    <Frame title={title} sub={sub} legend={series.map((s) => ({ name: s.name, color: s.color }))}
      table={<table><thead><tr><th>x</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead><tbody>{xs.map((x) => <tr key={x}><td>{xFmt(x)}</td>{series.map((s) => { const p = s.points.find((q) => q.x === x); return <td key={s.name} className="n">{p ? yFmt(p.y) : '—'}</td>; })}</tr>)}</tbody></table>}>
      {empty ? <p className="ch-empty">No data yet.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="ch-svg" role="img" aria-labelledby={id}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; let best = 0; xs.forEach((x, i) => { if (Math.abs(sx(x) - px) < Math.abs(sx(xs[best]) - px)) best = i; }); setHover(best); }}>
          <title id={id}>{title}</title>
          {yt.map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} /><text x={m.l - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>{yFmt(t)}</text></g>)}
          <line x1={m.l} x2={W - m.r} y1={sy(yBot)} y2={sy(yBot)} stroke={AXIS} strokeWidth={1} />
          {[x0, xs[Math.floor(xs.length / 2)], x1].filter((v, i, a) => a.indexOf(v) === i).map((x) => <text key={x} x={sx(x)} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>{xFmt(x)}</text>)}
          {series.map((s) => {
            const pts = [...s.points].sort((a, b) => a.x - b.x);
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join(' ');
            const last = pts[pts.length - 1];
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {last && <><circle cx={sx(last.x)} cy={sy(last.y)} r={6} fill={SURFACE} /><circle cx={sx(last.x)} cy={sy(last.y)} r={4} fill={s.color} /></>}
                {last && series.length >= 2 && <text x={sx(last.x) + 10} y={sy(last.y) + 4} fontSize={11} fill={INK2}>{s.name}</text>}
              </g>
            );
          })}
          {peak && <g><circle cx={sx(peak.x)} cy={sy(peak.y)} r={6} fill={SURFACE} /><circle cx={sx(peak.x)} cy={sy(peak.y)} r={4} fill={series[0].color} />
            <text x={sx(peak.x)} y={sy(peak.y) - 10} textAnchor="middle" fontSize={11} fill={INK}>{yFmt(peak.y)}</text></g>}
          {hx != null && (
            <g pointerEvents="none">
              <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={sy(yBot)} stroke={AXIS} strokeWidth={1} />
              {series.map((s) => { const p = s.points.find((q) => q.x === hx); return p ? <g key={s.name}><circle cx={sx(p.x)} cy={sy(p.y)} r={6} fill={SURFACE} /><circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} /></g> : null; })}
              <Tip x={sx(hx)} y={m.t} W={W} lines={[xFmt(hx), ...series.map((s) => { const p = s.points.find((q) => q.x === hx); return `${s.name}: ${p ? yFmt(p.y) : '—'}`; })]} />
            </g>
          )}
        </svg>
      )}
    </Frame>
  );
}

export function BarChart({ title, sub, rows, color = SLOT[0], fmt = (v: number) => v.toLocaleString() }: {
  title: string; sub?: string; rows: { label: string; value: number }[]; color?: string; fmt?: (v: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, rowH = 30, bar = 18, m = { l: 150, r: 64, t: 6, b: 6 };
  const H = m.t + m.b + rows.length * rowH;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sx = (v: number) => m.l + (v / max) * (W - m.l - m.r);
  return (
    <Frame title={title} sub={sub} table={<table><tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="n">{fmt(r.value)}</td></tr>)}</tbody></table>}>
      {rows.length === 0 ? <p className="ch-empty">No data yet.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="ch-svg" role="img" aria-labelledby={id} onMouseLeave={() => setHover(null)}>
          <title id={id}>{title}</title>
          <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} stroke={AXIS} strokeWidth={1} />
          {rows.map((r, i) => {
            const y = m.t + i * rowH + (rowH - bar) / 2, w = Math.max(0, sx(r.value) - m.l), rx = Math.min(4, w / 2);
            const d = `M${m.l},${y} h${Math.max(0, w - rx)} a${rx},${rx} 0 0 1 ${rx},${rx} v${bar - 2 * rx} a${rx},${rx} 0 0 1 -${rx},${rx} h-${Math.max(0, w - rx)} z`;
            return (
              <g key={r.label} onMouseEnter={() => setHover(i)}>
                <rect x={0} y={m.t + i * rowH} width={W} height={rowH} fill="transparent" />
                <text x={m.l - 10} y={y + bar / 2 + 4} textAnchor="end" fontSize={12} fill={INK2}>{r.label}</text>
                <path d={d} fill={color} opacity={hover == null || hover === i ? 1 : 0.55} />
                <text x={sx(r.value) + 8} y={y + bar / 2 + 4} fontSize={11.5} fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.value)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </Frame>
  );
}

export function ScatterChart({ title, sub, points, series, xFmt = compact, yFmt = compact, xLabel, yLabel }: {
  title: string; sub?: string; points: Pt[]; series: { name: string; color: string }[]; xFmt?: (v: number) => string; yFmt?: (v: number) => string; xLabel: string; yLabel: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 260, m = { l: 56, r: 20, t: 14, b: 40 };
  const xt = ticks(Math.min(0, ...points.map((p) => p.x)), Math.max(1, ...points.map((p) => p.x)), 4);
  const yt = ticks(Math.min(0, ...points.map((p) => p.y)), Math.max(1, ...points.map((p) => p.y)), 4);
  const sx = (x: number) => m.l + ((x - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + (1 - (y - yt[0]) / (yt[yt.length - 1] - yt[0] || 1)) * (H - m.t - m.b);
  const col = (p: Pt) => series.find((s) => s.name === p.series)?.color ?? OTHER;
  const hp = hover != null ? points[hover] : null;
  return (
    <Frame title={title} sub={sub} legend={series} table={<table><thead><tr><th>Project</th><th>Series</th><th>{xLabel}</th><th>{yLabel}</th></tr></thead><tbody>{points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.series}</td><td className="n">{xFmt(p.x)}</td><td className="n">{yFmt(p.y)}</td></tr>)}</tbody></table>}>
      {points.length === 0 ? <p className="ch-empty">No data yet.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="ch-svg" role="img" aria-labelledby={id} onMouseLeave={() => setHover(null)}>
          <title id={id}>{title}</title>
          {yt.map((t) => <g key={`y${t}`}><line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} /><text x={m.l - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>{yFmt(t)}</text></g>)}
          {xt.map((t) => <text key={`x${t}`} x={sx(t)} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{xFmt(t)}</text>)}
          <text x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>{xLabel}</text>
          <text transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill={MUTED}>{yLabel}</text>
          {points.map((p, i) => (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={12} fill="transparent" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={6} fill={SURFACE} />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={col(p)} opacity={hover == null || hover === i ? 1 : 0.5} />
            </g>
          ))}
          {hp && <g pointerEvents="none"><Tip x={sx(hp.x)} y={sy(hp.y) - 12} W={W} lines={[hp.label ?? '', `${xLabel}: ${xFmt(hp.x)}`, `${yLabel}: ${yFmt(hp.y)}`, hp.extra ?? ''].filter(Boolean)} /></g>}
        </svg>
      )}
    </Frame>
  );
}

function Tip({ x, y, W, lines }: { x: number; y: number; W: number; lines: string[] }) {
  const w = Math.max(...lines.map((l) => l.length)) * 6.6 + 16, h = lines.length * 15 + 10;
  const left = Math.min(Math.max(x + 10, 4), W - w - 4);
  return (
    <g transform={`translate(${left} ${Math.max(y, 4)})`}>
      <rect width={w} height={h} rx={6} fill={SURFACE} stroke={AXIS} strokeWidth={1} />
      {lines.map((l, i) => <text key={i} x={8} y={16 + i * 15} fontSize={11} fill={i === 0 ? INK : INK2} fontWeight={i === 0 ? 600 : 400}>{l}</text>)}
    </g>
  );
}

export function useChartSeries<T>(data: T | null, build: (d: T) => Series[]): Series[] {
  return useMemo(() => (data ? build(data) : []), [data, build]);
}
