'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import type { ExploreSite } from './types';
import { fmtMoney, fmtNum, verdict } from './types';

type Row = ExploreSite & { idx: number };
type Col = { key: string; label: string; right?: boolean; get: (s: Row) => number | string | null; fmt?: (v: number | string | null, s: Row) => string };

const gate = (s: ExploreSite, name: string) => s.screen?.gates.find((g) => g.gate === name);

export const COLS: Col[] = [
  { key: 'idx', label: '#', right: true, get: (s) => s.idx },
  { key: 'name', label: 'Property', get: (s) => s.name },
  { key: 'acres', label: 'Acres', right: true, get: (s) => s.lotAcres ?? null, fmt: (v) => fmtNum(v as number, 1) },
  { key: 'mw', label: 'Supportable MW', right: true, get: (s) => s.supportableMw ?? null, fmt: (v) => fmtNum(v as number, 0) },
  { key: 'price', label: 'Acquisition', right: true, get: (s) => s.landCost || null, fmt: (v) => fmtMoney(v as number) },
  { key: 'ppa', label: '$ / acre', right: true, get: (s) => (s.landCost && s.lotAcres ? s.landCost / s.lotAcres : null), fmt: (v) => (v == null ? '—' : fmtMoney(v as number)) },
  { key: 'sub', label: 'Substation km', right: true, get: (s) => s.screen?.power.nearest_substation?.distance_km ?? null, fmt: (v, s) => (v == null ? '—' : `${fmtNum(v as number, 1)} · ${s.screen?.power.nearest_substation?.max_kv ?? '?'} kV`) },
  { key: 'homes', label: 'Homes ≤ 1 mi', right: true, get: (s) => s.screen?.power.residential_within_1mi ?? null, fmt: (v) => fmtNum(v as number, 0) },
  { key: 'homeDist', label: 'Nearest home m', right: true, get: (s) => (gate(s, 'Residential proximity')?.value as number) ?? null, fmt: (v) => fmtNum(v as number, 0) },
  { key: 'flood', label: 'FEMA zone', get: (s) => (gate(s, 'Flood exposure')?.value as string) ?? null, fmt: (v) => (v == null ? '—' : String(v)) },
  { key: 'water', label: 'Water stress', get: (s) => s.screen?.power.water_stress_cat ?? null, fmt: (v, s) => (v == null ? '—' : String(gate(s, 'Water stress')?.value ?? v).replace(/\s*\(.*\)/, '')) },
  { key: 'status', label: 'Screen', get: (s) => ({ Pass: 0, 'Needs review': 1, Fail: 2 }[s.screen?.status ?? 'Fail'] ?? 2) },
  { key: 'money', label: 'M', right: true, get: (s) => s.pillars.money, fmt: (v) => fmtNum(v as number, 0) },
  { key: 'people', label: 'P', right: true, get: (s) => s.pillars.people, fmt: (v) => fmtNum(v as number, 0) },
  { key: 'planet', label: 'Pl', right: true, get: (s) => s.pillars.planet, fmt: (v) => fmtNum(v as number, 0) },
  { key: 'overall', label: 'Score', right: true, get: (s) => (s.screen?.status === 'Fail' ? -1 : s.pillars.overall), fmt: (v) => ((v as number) < 0 ? '—' : fmtNum(v as number, 0)) },
];

export function toCsv(rows: Row[]): string {
  const head = [...COLS.map((c) => c.label), 'Verdict', 'Reason', 'Lat', 'Lng', 'CoStar property', 'Acquisition basis'];
  const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((s) => {
    const v = verdict(s);
    return [...COLS.map((c) => (c.fmt ? c.fmt(c.get(s), s) : c.get(s))), v.label, v.reason, s.lat, s.lng, s.costarPropertyId, s.landCostBasis].map(esc).join(',');
  });
  return [head.map(esc).join(','), ...lines].join('\n');
}

export function ResultsTable({
  sites,
  selectedId,
  pickId,
  compare,
  counts,
  onSelect,
  onToggleCompare,
  loading,
}: {
  sites: ExploreSite[];
  selectedId: string | null;
  pickId: string | null | undefined;
  compare: Set<string>;
  counts?: { Pass: number; 'Needs review': number; Fail: number };
  onSelect: (id: string) => void;
  onToggleCompare: (id: string) => void;
  loading: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'overall', dir: -1 });
  const rows = useMemo(() => {
    const withIdx: Row[] = sites.map((s, i) => ({ ...s, idx: i + 1 }));
    const col = COLS.find((c) => c.key === sort.key)!;
    return [...withIdx].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }, [sites, sort]);

  function download() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plotstar-sites-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="ws-table-wrap">
      <div className="ws-table-head">
        <div>
          <b>{loading ? 'Searching…' : `${sites.length} candidate properties`}</b>
          {counts && (
            <span className="ws-counts">
              <span><i style={{ background: 'var(--ws-ok)' }} />{counts.Pass} pass</span>
              <span><i style={{ background: 'var(--ws-warn)' }} />{counts['Needs review']} review</span>
              <span><i style={{ background: 'var(--ws-bad)' }} />{counts.Fail} fail a gate</span>
            </span>
          )}
        </div>
        <button className="ws-btn sm" onClick={download} disabled={!rows.length}><Download size={12} /> CSV</button>
      </div>
      <table className="ws-table">
        <thead>
          <tr>
            <th style={{ width: 28 }} title="Add to comparison" onClick={(e) => e.stopPropagation()}>Cmp</th>
            {COLS.map((c) => (
              <th key={c.key} className={`${c.right ? 'r' : ''} ${sort.key === c.key ? 'sorted' : ''}`} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((s.dir * -1) as 1 | -1) : c.key === 'name' || c.key === 'idx' ? 1 : -1 }))}>
                {c.label}
                {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const v = verdict(s);
            return (
              <tr key={s.id} className={s.id === selectedId ? 'sel' : ''} onClick={() => onSelect(s.id)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={compare.has(s.id)} onChange={() => onToggleCompare(s.id)} /></td>
                {COLS.map((c) => {
                  if (c.key === 'name')
                    return (
                      <td key={c.key} className="name" title={s.area}>
                        {s.name}
                        {s.id === pickId ? ' · recommended' : ''}
                        <small>{s.area}</small>
                      </td>
                    );
                  if (c.key === 'status')
                    return (
                      <td key={c.key}>
                        <span className={`ws-status ${v.tone}`} title={v.reason}><i />{v.label}</span>
                      </td>
                    );
                  const raw = c.get(s);
                  return <td key={c.key} className={`ws-num ${c.right ? 'r' : ''}`}>{c.fmt ? c.fmt(raw, s) : raw ?? '—'}</td>;
                })}
              </tr>
            );
          })}
          {!loading && !rows.length && (
            <tr><td colSpan={COLS.length + 1} style={{ textAlign: 'center', padding: 30, color: 'var(--ws-muted)' }}>No properties match these criteria.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
