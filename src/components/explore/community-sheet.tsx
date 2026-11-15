'use client';
// Community sheet: what this facility would mean for the people who live nearby, in plain language, with
// measurable commitments. Every figure comes from the screening data, the design, or the impact model.
import { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { PUBLIC_DATA_API } from '@/lib/plotstar-api';
import type { DesignSite } from './design-step';
import { fmtNum } from './types';

interface Impact { energy_gwh_per_year: number; water_gal_per_day: number; co2_t_per_year: number; carbon_label: string }

export function CommunitySheet({ site, mw, cooling, depth, gensets, batteryMin, solarMwp, censusHouseholds = null, onClose }: {
  site: DesignSite; mw: number; cooling: string; depth: number; gensets: number; batteryMin: number; solarMwp: number; censusHouseholds?: number | null; onClose: () => void;
}) {
  const [imp, setImp] = useState<Impact | null>(null);
  useEffect(() => {
    fetch(`${PUBLIC_DATA_API}/impact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mw_it: mw, cooling }) })
      .then((r) => r.json()).then(setImp).catch(() => setImp(null));
  }, [mw, cooling]);
  const g = (name: string) => site.screen?.gates.find((x) => x.gate === name);
  const homes = g('Residential proximity'), flood = g('Flood exposure'), water = g('Water stress');
  const within = site.screen?.power.residential_within_1mi;
  const households = imp ? Math.round((imp.water_gal_per_day * 365) / 100000) : null; // ~100k gal per household-year (team assumption)
  const rows: [string, string, string][] = [
    ['Distance from homes', homes?.value != null ? `Nearest recorded home is ${homes.value} m away. ${within ?? '—'} CoStar-recorded homes or apartment communities within 1 mile (a lower bound).${censusHouseholds != null ? ` Census estimate: about ${fmtNum(censusHouseholds)} households within 1 mile.` : ''}` : 'Not established.', `Stay at least ${homes?.limit ?? 300} m from homes. Checked against CoStar residential records.`],
    ['Noise', `${gensets} backup generators and rooftop cooling units. Generators run only in a utility outage and for scheduled tests.`, 'Generator tests in daytime hours only; publish the test log. Night-time noise limit to be set with the county before permitting.'],
    ['Water', imp ? `About ${fmtNum(imp.water_gal_per_day)} gallons a day with ${cooling} cooling${households ? `, roughly the use of ${fmtNum(households)} households` : ''}. Local water stress: ${water?.value ?? 'unknown'}.` : 'Calculating…', 'Meter and publish monthly water use. No water cooling where stress is above the limit.'],
    ['Flood', flood ? `${flood.reason}.` : 'Not established.', 'No construction in a FEMA special flood hazard area.'],
    ['Power grid', `Draws about ${fmtNum(mw * 1.4, 0)} MW. In grid emergencies it cuts ${Math.round(depth * 100)}% of its load; a ${fmtNum(batteryMin, 0)}-minute battery bridges to the generators.${solarMwp ? ` ${solarMwp} MWp of solar on site.` : ''}`, 'Record every grid event: requested cut, measured cut, duration. Share the record with the utility.'],
    ['Air and carbon', imp ? `About ${fmtNum(imp.co2_t_per_year)} t CO₂ a year from grid electricity (${imp.carbon_label}).` : 'Calculating…', 'Run delayable work in the cleanest hours; report annual emissions with the method.'],
  ];
  return (
    <div className="ws-drawer-bg" onClick={onClose}>
      <div className="ws-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ws-drawer-head"><h2>Community sheet: {site.name}</h2>
          <div style={{ display: 'flex', gap: 6 }}><button className="ws-btn sm" onClick={() => window.print()}><Printer size={12} /> Print</button><button className="ws-btn sm" onClick={onClose}><X size={12} /> Close</button></div>
        </div>
        <div className="ws-drawer-body">
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 12px' }}>What a {mw} MW data center at this location would mean for people living nearby, and what the developer commits to measure. Written for residents and local officials.</p>
          <table className="ws-compare">
            <thead><tr><th>Topic</th><th>What to expect</th><th>Commitment and how it is checked</th></tr></thead>
            <tbody>{rows.map(([t, a, b]) => <tr key={t}><td style={{ color: 'var(--ws-ink)', fontWeight: 600 }}>{t}</td><td>{a}</td><td>{b}</td></tr>)}</tbody>
          </table>
          <p className="ws-note" style={{ marginTop: 12 }}>Figures are planning estimates from public data and team assumptions, not measurements or permit conditions. This sheet makes no claim about household electricity bills; that needs a utility study. Household water comparison assumes about 100,000 gallons per household per year.</p>
        </div>
      </div>
    </div>
  );
}
