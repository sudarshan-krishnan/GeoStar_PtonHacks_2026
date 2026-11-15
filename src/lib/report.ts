import type { Project } from './types';
import {
  designMetrics,
  finances,
  generateDesigns,
  money,
  number,
  rankSites,
  scoreSite,
  siteRationale,
  typeLabels,
} from './engine';
export function reportData(p: Project) {
  const ranked = rankSites(p.sites, p.weights),
    site = p.sites.find((s) => s.id === p.selectedSiteId) || ranked[0],
    d =
      p.designs.find((d) => d.id === p.approvedDesignId) ||
      p.designs[0] ||
      generateDesigns(p.type, p.requirements, site)[0],
    m = designMetrics(d, site, p.type),
    f = finances(p.type, p.requirements, site, d);
  const sections = [
    {
      title: '01 / Development brief',
      text: [
        p.brief,
        `Type: ${typeLabels[p.type]}. Requested region: ${p.requirements.location}. Capacity target: ${number(p.requirements.capacity)}. Budget: ${money(p.requirements.budget, false)}. Stage: ${p.stage}.`,
        ...(!/princeton|plainsboro|west windsor/i.test(p.requirements.location)
          ? [
              'OUTSIDE DEMO COVERAGE: candidates represent Princeton only, not the requested location.',
            ]
          : []),
      ],
    },
    {
      title: '02 / Site comparison & recommendation',
      text: [
        ...ranked.map(
          (s) =>
            `${s.name} | Score ${scoreSite(s, p.weights)}/100 | Land ${money(s.landCost)} | Investment ${money(finances(p.type, p.requirements, s).total)} | Yield ${finances(p.type, p.requirements, s).yield.toFixed(2)}%. ${siteRationale(s, p.type, p.weights)}`,
        ),
        `Current ${p.selectedSiteId ? 'selected' : 'provisional recommended'} location: ${site.name}, ${site.area}. ${site.lat}, ${site.lng}.`,
        `Scoring weights (normalized): ${Object.entries(p.weights)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}.`,
      ],
    },
    {
      title: '03 / Financial projections',
      text: [
        `Land: ${money(f.land, false)}. Development including equipment, parking, soft costs and contingency: ${money(f.construction, false)}. Total: ${money(f.total, false)}. Budget headroom: ${money(f.budgetGap, false)}.`,
        `Annual gross revenue: ${money(f.revenue, false)}. Annual expenses: ${money(f.expenses, false)}. Annual NOI: ${money(f.noi, false)}. Unlevered operating yield: ${f.yield.toFixed(2)}%. Simple payback: ${f.payback ? `${f.payback.toFixed(1)} years` : 'not applicable'}.`,
        `Monthly rate per ${p.type === 'data-center' ? 'MW' : p.type === 'commercial' ? 'sq ft' : 'bed'}: ${money(p.requirements.monthlyRate, false)}. Occupancy: ${(p.requirements.occupancy * 100).toFixed(0)}%. Expense ratio: ${(p.requirements.expenseRatio * 100).toFixed(0)}%. Revenue is capped at the lesser of target and concept capacity.`,
        p.type === 'park'
          ? 'Parks have zero modeled rental revenue. Operating expenses represent green-space and pavilion upkeep; assess accessibility, public benefit and service capacity.'
          : 'Yield = annual NOI / total investment; simple payback = total investment / NOI. These are not IRR, levered returns or investment advice.',
        `Land +20% scenario: total ${money(finances(p.type, p.requirements, site, d, 1.2).total)}, operating yield ${finances(p.type, p.requirements, site, d, 1.2).yield.toFixed(2)}%.`,
      ],
    },
    {
      title: '04 / Conceptual design summary',
      text: [
        `${d.name} (${p.approvedDesignId ? 'approved concept' : 'unapproved planning concept'}): ${d.width} x ${d.depth} m, ${d.floors} floors, ${d.rotation} degree orientation. Footprint ${number(m.footprint)} m2. Gross floor area ${number(m.gfa)} m2. Site coverage ${m.coverage.toFixed(1)}%.`,
        `Landscape ${d.green}% (${number(m.greenArea)} m2). Parking ${d.parking} spaces. Assumed setbacks ${d.setback} m. Concept capacity ${number(m.capacity)}. Construction + site estimate ${money(m.cost)}.`,
        ...m.warnings,
        ...p.designs.map((a) => {
          const m = designMetrics(a, site, p.type);
          return `Alternative ${a.name}: ${number(m.gfa)} m2, ${money(m.cost)} development, ${finances(p.type, p.requirements, site, a).yield.toFixed(2)}% operating yield.`;
        }),
        'Conceptual massing only. Not permit-ready drawings, engineering, approved floor plans or a zoning determination.',
      ],
    },
    {
      title: '05 / Sensor & protection plan',
      text: [
        `${p.sensors.length} conceptual sensors. ${new Set(p.sensors.map((s) => `${s.floor}:${s.zone}`)).size} mapped floor/zone combinations. Guardian receives threshold events, the monitoring agent creates incidents, and the maintenance agent recommends review. No equipment is actuated.`,
        ...p.sensors.map(
          (s) =>
            `${s.name}: ${s.type}, ${s.zone}, floor ${s.floor}, position (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) m; threshold ${s.threshold} ${s.unit}; last reading ${s.value} ${s.unit}; source ${s.source}; last received ${s.lastSeen || 'none'}.`,
        ),
        ...(!p.sensors.length
          ? ['Approve a concept in Design to generate the initial sensor plan.']
          : []),
        'Sensor circles and suggested placement are illustrative. Qualified professionals must validate coverage, specifications and all code requirements.',
      ],
    },
    {
      title: '06 / Incidents & simulation history',
      text: [
        ...p.incidents.map(
          (i) =>
            `${i.kind} | ${i.severity} | ${i.status} | ${i.source} | ${i.createdAt}: ${i.message} ${i.recommendation}`,
        ),
        ...p.simulations.map((s) => `${s.createdAt}: ${s.summary}`),
        ...(!p.incidents.length && !p.simulations.length
          ? ['No incidents or simulations have been saved.']
          : []),
      ],
    },
    {
      title: '07 / Risks, approvals & unknowns',
      text: [
        ...site.risks,
        'Outstanding: ownership, property availability, title, survey, zoning, height approval, flood and wetlands studies, soil conditions, utility interconnection, traffic impact, market rents, demand and construction quotations.',
        'Data center power and water capacity are unconfirmed. No external utility study is included. Safety designs require licensed review; this product does not provide code certification or operate life-safety equipment.',
      ],
    },
    {
      title: '08 / Sources & assumptions',
      text: [
        site.provenance,
        'Map tiles: OpenStreetMap contributors, https://www.openstreetmap.org/copyright. Map locations provide geographic context, not surveyed parcels.',
        'Live amenities: on-demand Overpass / OpenStreetMap, 1.2 km radius, cached for 24 hours. Community mapped data may be incomplete. External data does not modify illustrative scoring inputs.',
        'All candidate prices, dimensions, demographic context, risks and scores are illustrative. No listing feed, utility capacity feed or authoritative hazard layer is connected.',
        'Cost basis: residential 2650 USD/m2; commercial 2100 USD/m2; data center shell 2800 USD/m2 + 5.5 million USD per whole modeled MW for equipment; park pavilion 1800 USD/m2 + landscaping 55 USD/m2. Parking 7000 USD/space. All hard costs receive a 22% soft-cost and contingency allowance.',
        'Capacity basis: 34 m2/bed; 230 m2/MW; park green area / 18 m2/visitor; commercial GFA converted to sq ft. Park annual upkeep: 7 USD/m2 landscape + 35 USD/m2 pavilion. Model excludes financing, tax, sale proceeds and appreciation.',
        'This report reflects the saved project. Hardware connectivity is only live when telemetry was actually received recently. Historical hardware readings are not proof of current connectivity.',
      ],
    },
  ];
  return { ranked, site, d, m, f, sections };
}
