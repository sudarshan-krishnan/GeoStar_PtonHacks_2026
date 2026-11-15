'use client';
import { useState } from 'react';
import { Box, ChevronDown, Printer, X } from 'lucide-react';
import { vexcelOrthoUrl } from '@/lib/plotstar-api';
import { MatterportPanel } from '../site-evidence';
import type { OptimizeResult } from './optimize-types';
import { PlanPanel } from './plan-panel';
import type { ExploreSite } from './types';
import { fmtMoney, fmtNum, verdict } from './types';

const tagClass = (label: string) => `ws-tag ${label.toLowerCase().replace(/[^a-z]/g, '')}`;

export function SiteDetail({ site, mw, run, runBusy, onWhatIf, onOpen3d, onClose }: {
  site: ExploreSite; mw: number; run: OptimizeResult | null; runBusy: boolean;
  onWhatIf: (c: Record<string, number>) => void; onOpen3d: () => void; onClose: () => void;
}) {
  const v = verdict(site);
  const p = site.screen?.power;
  const sub = p?.nearest_substation;
  const [prov, setProv] = useState(false);
  const g = (name: string) => site.screen?.gates.find((x) => x.gate === name);
  const perAcre = site.landCost && site.lotAcres ? site.landCost / site.lotAcres : null;
  return (
    <div className="ws-detail">
      <div className="ws-detail-hero">
        {site.parcelId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vexcelOrthoUrl(site.parcelId)} alt={`Vexcel aerial of ${site.name}`} />
        )}
        <span className="ws-credit">Vexcel aerial · Sourced</span>
        <button className="ws-close" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      <div className="ws-detail-head">
        <h2>{site.name}</h2>
        <p>{site.area} · CoStar {site.costarPropertyId}<br />{(site.propertySubtype || site.propertyType || '').replace(/^Industrial_/, '')} · {fmtNum(site.lotAcres, 2)} acres · {site.buildingSf ? `${fmtNum(site.buildingSf)} SF building` : 'no building data'} · {site.availability}</p>
      </div>
      <div className={`ws-verdict ${v.tone}`}><i /><div><b>{v.label}</b><span>{v.reason}</span></div></div>

      <div className="ws-block">
        <div className="ws-block-head"><h3>Score</h3><span className="ws-tag estimated">Estimated</span></div>
        {[
          ['Money', site.pillars.money, `${perAcre ? `${fmtMoney(perAcre)}/acre` : 'price unknown'} (${site.labels?.landCost}) · substation ${sub ? `${sub.distance_km} km` : 'n/a'}`],
          ['People', site.pillars.people, `nearest home ${fmtNum(g('Residential proximity')?.value as number)} m · ${p?.residential_within_1mi ?? '—'} within 1 mi`],
          ['Planet', site.pillars.planet, `${g('Water stress')?.value ?? 'water n/a'} · FEMA ${g('Flood exposure')?.value ?? 'n/a'}`],
        ].map(([k, val, note]) => (
          <div key={k as string} className="ws-score"><span>{k}</span><i style={{ ['--w' as string]: `${val}%` }} /><b>{Math.round(val as number)}</b><small>{note}</small></div>
        ))}
        <p className="ws-note">Scores rank sites that pass the gates; a failed gate excludes a site regardless of score.</p>
      </div>

      <div className="ws-block">
        <div className="ws-block-head"><h3>Screening gates</h3><span className="ws-note">pass / fail, not averaged</span></div>
        <table className="ws-gates">
          <thead><tr><th>Gate</th><th>Result</th><th>Value</th><th>Limit</th></tr></thead>
          <tbody>
            {site.screen?.gates.map((x) => (
              <tr key={x.gate}>
                <td>{x.gate}<small>{x.source}{x.retrieved_at ? ` · ${new Date(x.retrieved_at).toLocaleDateString()}` : ''}</small></td>
                <td><span className={`ws-status ${x.status === 'Pass' ? 'good' : x.status === 'Fail' ? 'bad' : 'check'}`}><i />{x.status}</span></td>
                <td className="ws-num">{x.value == null ? '—' : `${x.value}${x.unit ? ` ${x.unit}` : ''}`}<small><span className={tagClass(x.label)}>{x.label}</span></small></td>
                <td className="ws-num">{x.limit == null ? '—' : `${x.limit}${x.unit && typeof x.limit === 'number' ? ` ${x.unit}` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ws-block">
        <div className="ws-block-head"><h3>Power</h3></div>
        <table className="ws-kv">
          <tbody>
            <tr><th>Existing building service</th><td>{p?.building_service_mw != null ? `≈ ${p.building_service_mw} MW` : 'not recorded'} <span className={tagClass(p?.building_service_label ?? 'Unknown')}>{p?.building_service_label ?? 'Unknown'}</span></td></tr>
            {p?.building_service_method && <tr><th>Method</th><td className="l" style={{ fontSize: 11 }}>{p.building_service_method}</td></tr>}
            <tr><th>Nearest ≥ 138 kV substation</th><td>{sub ? `${sub.name || sub.osm_id} · ${sub.max_kv ?? '?'} kV · ${sub.distance_km} km` : 'none found'}</td></tr>
            <tr><th>Requires utility confirmation</th><td className="l" style={{ fontSize: 11.5 }}>{p?.requires_utility_confirmation.join('; ')}</td></tr>
          </tbody>
        </table>
      </div>

      <PlanPanel run={run} siteId={site.id} mw={mw} busy={runBusy} onWhatIf={onWhatIf} />

      <div className="ws-block">
        <div className="ws-block-head"><h3>Acquisition</h3><span className={tagClass(site.labels?.landCost ?? 'Unknown')}>{site.labels?.landCost}</span></div>
        <table className="ws-kv">
          <tbody>
            <tr><th>Basis</th><td className="l" style={{ fontSize: 11.5 }}>{site.landCostBasis}</td></tr>
            <tr><th>Amount</th><td>{fmtMoney(site.landCost)}</td></tr>
            <tr><th>Per acre</th><td>{perAcre ? fmtMoney(perAcre) : '—'}</td></tr>
          </tbody>
        </table>
      </div>

      {site.parcelId && (
        <div className="ws-block ws-matterport">
          <div className="ws-block-head"><h3>Interior (Matterport)</h3><button className="ws-btn sm" onClick={onOpen3d}><Box size={12} /> Site in 3D</button></div>
          <MatterportPanel site={site} />
        </div>
      )}

      <div className="ws-block">
        <button className="ws-btn sm" onClick={() => setProv(!prov)}>Provenance <ChevronDown size={12} style={{ transform: prov ? 'rotate(180deg)' : '' }} /></button>
        {prov && <p className="ws-note">{site.provenance}</p>}
        <button className="ws-btn sm" onClick={() => window.print()}><Printer size={12} /> Print site report</button>
      </div>
    </div>
  );
}
