'use client';
// Two tiny single-series SVG charts for the dossier. One hue, thin bars with 4px rounded tops on the baseline, 2px
// gaps, recessive axis, hover tooltip on every bar and a visually hidden table for screen readers.
import { useState } from 'react';
import s from './dossier.module.css';

export interface Bar { label: string; value: number; tip?: string; highlight?: boolean }

export function BarChart({ bars, title, unit = '', height = 120 }: { bars: Bar[]; title: string; unit?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!bars.length) return <p className={s.empty}>No data for this chart.</p>;
  const W = 520, H = height, pad = { l: 4, r: 4, t: 8, b: 18 };
  const max = Math.max(...bars.map((b) => b.value), 1);
  const bw = (W - pad.l - pad.r) / bars.length;
  const ih = H - pad.t - pad.b;
  const every = Math.ceil(bars.length / 8);
  return (
    <figure className={s.chart}>
      <figcaption>{title}</figcaption>
      <div className={s.chartBox}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className={s.axis} />
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(2, (b.value / max) * ih) : 0;
            const x = pad.l + i * bw + 1, w = Math.max(1, bw - 2), y = H - pad.b - h;
            const r = Math.min(4, w / 2, h);
            return (
              <g key={b.label} onMouseEnter={() => setHover(i)}>
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
                {h > 0 && <path className={b.highlight ? s.barHi : s.bar} style={{ opacity: hover == null || hover === i ? 1 : 0.55 }}
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`} />}
                {i % every === 0 && <text x={pad.l + i * bw + bw / 2} y={H - 4} className={s.tick} textAnchor="middle">{b.label}</text>}
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className={s.tip} style={{ left: `${((hover + 0.5) / bars.length) * 100}%` }}>
            <b>{bars[hover].label}</b>{bars[hover].tip ?? `${bars[hover].value.toLocaleString()}${unit}`}
          </div>
        )}
      </div>
      <table className={s.srOnly}><caption>{title}</caption><tbody>{bars.map((b) => <tr key={b.label}><th>{b.label}</th><td>{b.value}{unit}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** Histogram of values into n even bins; the subject's value (if given) is marked with a darker bin. */
export function Histogram({ values, title, fmt, mark, bins: want }: { values: number[]; title: string; fmt: (n: number) => string; mark?: number | null; bins?: number }) {
  const v = values.filter((x) => Number.isFinite(x));
  const bins = want ?? Math.min(10, Math.max(4, Math.ceil(v.length / 2)));
  if (v.length < 3) return <p className={s.empty}>Too few values for a distribution ({v.length}).</p>;
  const lo = Math.min(...v), hi = Math.max(...v), step = (hi - lo) / bins || 1;
  const counts = Array.from({ length: bins }, (_, i) => ({ from: lo + i * step, to: lo + (i + 1) * step, n: 0 }));
  v.forEach((x) => { counts[Math.min(bins - 1, Math.floor((x - lo) / step))].n++; });
  const markBin = mark != null && Number.isFinite(mark) ? Math.max(0, Math.min(bins - 1, Math.floor((mark - lo) / step))) : -1;
  return <BarChart title={title} bars={counts.map((c, i) => ({
    label: fmt(c.from), value: c.n, highlight: i === markBin,
    tip: `${c.n} sale${c.n === 1 ? '' : 's'} between ${fmt(c.from)} and ${fmt(c.to)}${i === markBin ? ' · includes this site' : ''}`,
  }))} />;
}
