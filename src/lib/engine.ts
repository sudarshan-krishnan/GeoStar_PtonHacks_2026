import { z } from 'zod';
import type { Design, DevelopmentType, Project, Requirements, Site } from './types';

export const typeLabels: Record<DevelopmentType, string> = {
  residential: 'Student living',
  'data-center': 'Data center',
  park: 'Community park',
  commercial: 'Commercial',
};
export const weightDefaults: Record<DevelopmentType, Record<string, number>> = {
  residential: { walkability: 25, demand: 25, amenities: 20, affordability: 20, resilience: 10 },
  // Real-data metrics from services/api /sites/candidates (formulas in its `method` block).
  'data-center': { power: 35, community: 25, resilience: 25, affordability: 15 },
  park: { underserved: 30, accessibility: 25, schools: 20, space: 15, affordability: 10 },
  commercial: { customers: 30, access: 25, demographics: 20, competition: 15, affordability: 10 },
};
export const requirementsSchema = z.object({
  location: z.string().trim().min(2).max(120),
  capacity: z.number().min(1).max(100000),
  budget: z.number().min(10000).max(1e12),
  floors: z.number().int().min(1).max(40),
  monthlyRate: z.number().min(0).max(1e7),
  occupancy: z.number().min(0).max(1),
  expenseRatio: z.number().min(0).max(0.99),
  parking: z.number().int().min(0).max(5000),
  setback: z.number().min(0).max(60),
});
export const designSchema = z.object({
  id: z.string().max(80),
  name: z.string().min(1).max(80),
  strategy: z.string().max(200),
  width: z.number().min(4).max(1000),
  depth: z.number().min(4).max(1000),
  floors: z.number().int().min(1).max(40),
  green: z.number().min(0).max(90),
  parking: z.number().int().min(0).max(5000),
  setback: z.number().min(0).max(60),
  rotation: z.number().refine((v) => [0, 90].includes(v), 'Rotation must be 0 or 90 degrees'),
});
export function parseBrief(brief: string): {
  type: DevelopmentType;
  requirements: Requirements;
  name: string;
} {
  const b = brief.toLowerCase();
  const type: DevelopmentType = /data\s*cent|\bmw\b|server/.test(b)
    ? 'data-center'
    : /park|recreation|playground/.test(b)
      ? 'park'
      : /commercial|retail|office|shop/.test(b)
        ? 'commercial'
        : 'residential';
  const capacityMatch = b.match(
    /([\d,]+)[\s-]*(?:beds?|students?|units?|mw|visitors?|people|sq\.?\s*ft|sqft)/,
  );
  const budgetMatch = b.match(
    /(?:budget(?:\s+of)?\s*\$?|\$)\s*([\d,.]+)\s*(million|billion|m\b|b\b|k\b)?/,
  );
  const budget = budgetMatch
    ? Number(budgetMatch[1].replaceAll(',', '')) *
      (/b/.test(budgetMatch[2] || '')
        ? 1e9
        : /m/.test(budgetMatch[2] || '')
          ? 1e6
          : budgetMatch[2] === 'k'
            ? 1000
            : 1)
    : type === 'data-center'
      ? 900e6
      : type === 'park'
        ? 8e6
        : 28e6;
  const fallbackLocation = type === 'data-center' ? 'Houston, Texas' : 'Princeton, New Jersey';
  const location = /houston/.test(b)
    ? 'Houston, Texas'
    : /los angeles/.test(b)
      ? 'Los Angeles, California'
      : /princeton/.test(b)
        ? 'Princeton, New Jersey'
        : brief
            .match(/(?:near|in|around)\s+([A-Za-z][a-zA-Z .-]+?)(?:,|\s+with|\s+for|\.|$)/)?.[1]
            ?.trim() || fallbackLocation;
  const floors = Number(
    b.match(/(\d+)\s*(?:floors?|stor(?:y|ies))/)?.[1] ||
      (type === 'park' ? 1 : type === 'data-center' ? 2 : 4),
  );
  const requirements = requirementsSchema.parse({
    location,
    capacity: capacityMatch
      ? Number(capacityMatch[1].replaceAll(',', ''))
      : type === 'data-center'
        ? 100
        : type === 'park'
          ? 500
          : type === 'commercial'
            ? 10000
            : 200,
    budget,
    floors,
    monthlyRate:
      type === 'data-center' ? 120000 : type === 'park' ? 0 : type === 'commercial' ? 28 : 1800,
    occupancy: 0.94,
    expenseRatio: type === 'park' ? 0.35 : 0.32,
    parking: type === 'park' ? 30 : type === 'data-center' ? 50 : 40,
    setback: 8,
  });
  return { type, requirements, name: `${typeLabels[type]} · ${location.split(',')[0]}` };
}
const candidateBase = [
  {
    name: 'Witherspoon Commons',
    area: 'Princeton North',
    lat: 40.3593,
    lng: -74.6616,
    width: 140,
    depth: 120,
    landCost: 3.8e6,
    metrics: {
      walkability: 94,
      demand: 92,
      amenities: 95,
      affordability: 64,
      resilience: 85,
      power: 55,
      cooling: 60,
      community: 45,
      underserved: 58,
      accessibility: 92,
      schools: 90,
      space: 62,
      customers: 93,
      access: 85,
      demographics: 91,
      competition: 58,
    },
    risks: [
      'Zoning and height limits need municipal review.',
      'Land availability and asking price are unverified.',
    ],
    context: 'A walkable urban infill concept close to central Princeton.',
    amenities: { schools: 4, restaurants: 28, parks: 3, transit: 6, population: 8200 },
  },
  {
    name: 'Route 1 Innovation Campus',
    area: 'West Windsor',
    lat: 40.3128,
    lng: -74.6492,
    width: 420,
    depth: 300,
    landCost: 8.2e6,
    metrics: {
      walkability: 46,
      demand: 82,
      amenities: 65,
      affordability: 78,
      resilience: 88,
      power: 91,
      cooling: 86,
      community: 78,
      underserved: 48,
      accessibility: 65,
      schools: 54,
      space: 98,
      customers: 76,
      access: 94,
      demographics: 81,
      competition: 82,
    },
    risks: [
      'Utility interconnection and 100 MW capacity have NOT been verified.',
      'Cooling water availability and noise impacts need studies.',
    ],
    context: 'An illustrative large campus with road access; power score is a demo proxy only.',
    amenities: { schools: 2, restaurants: 12, parks: 2, transit: 3, population: 5400 },
  },
  {
    name: 'Canal Green',
    area: 'Princeton / Plainsboro',
    lat: 40.3342,
    lng: -74.6264,
    width: 230,
    depth: 190,
    landCost: 2.6e6,
    metrics: {
      walkability: 72,
      demand: 76,
      amenities: 78,
      affordability: 91,
      resilience: 48,
      power: 62,
      cooling: 57,
      community: 68,
      underserved: 96,
      accessibility: 88,
      schools: 86,
      space: 90,
      customers: 65,
      access: 73,
      demographics: 78,
      competition: 89,
    },
    risks: [
      'Illustrative flood exposure requires an authoritative FEMA assessment.',
      'Wetlands and ecological constraints are unknown.',
    ],
    context: 'A community green-space concept with potential access benefits.',
    amenities: { schools: 3, restaurants: 8, parks: 1, transit: 4, population: 11200 },
  },
  {
    name: 'Nassau East Quarter',
    area: 'Princeton East',
    lat: 40.3481,
    lng: -74.6416,
    width: 155,
    depth: 130,
    landCost: 4.5e6,
    metrics: {
      walkability: 86,
      demand: 88,
      amenities: 90,
      affordability: 59,
      resilience: 90,
      power: 48,
      cooling: 66,
      community: 52,
      underserved: 64,
      accessibility: 81,
      schools: 82,
      space: 69,
      customers: 96,
      access: 87,
      demographics: 94,
      competition: 62,
    },
    risks: [
      'Traffic access and local market rents need validation.',
      'Illustrative parcel boundaries are not cadastral records.',
    ],
    context: 'A mixed-use neighborhood concept with strong illustrative customer demand.',
    amenities: { schools: 3, restaurants: 22, parks: 4, transit: 5, population: 9700 },
  },
];
export function makeSites(type: DevelopmentType, location = 'Princeton, New Jersey'): Site[] {
  return candidateBase.map((s, i) => ({
    ...s,
    id: `site-${String.fromCharCode(97 + i)}`,
    metrics: { ...s.metrics },
    risks: [...s.risks],
    provenance: `Illustrative candidate in the Princeton demonstration region. Not a property listing. All prices, scores, dimensions, demographics and baseline amenity counts are assumed.${!/princeton|west windsor|plainsboro/i.test(location) ? ` Requested region (${location}) is outside the demo dataset; these candidates do not represent that region.` : ''}`,
    landCost: type === 'park' ? s.landCost * 0.55 : s.landCost,
  }));
}
export function scoreSite(site: Site, weights: Record<string, number>): number {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return total > 0
    ? Math.round(
        (Object.entries(weights).reduce((a, [k, v]) => a + (site.metrics[k] || 0) * v, 0) / total) *
          10,
      ) / 10
    : 0;
}
/** Hard gates are pass/fail, never averaged in: a failing site ranks below every non-failing site. */
export const failsHardGate = (s: Site) => s.screen?.status === 'Fail';
export const isRealSite = (s: Site) => s.source === 'costar';
export function rankSites(sites: Site[], weights: Record<string, number>) {
  return [...sites].sort(
    (a, b) =>
      Number(failsHardGate(a)) - Number(failsHardGate(b)) ||
      scoreSite(b, weights) - scoreSite(a, weights),
  );
}
export function generateDesigns(type: DevelopmentType, r: Requirements, site: Site): Design[] {
  const isPark = type === 'park',
    isDC = type === 'data-center';
  const needed = isPark
    ? 450
    : isDC
      ? (r.capacity * 230) / r.floors
      : type === 'commercial'
        ? (r.capacity * 0.092903) / r.floors
        : (r.capacity * 34) / r.floors;
  const width = Math.max(8, Math.min(site.width - r.setback * 2, Math.sqrt(needed * 1.3)));
  const depth = Math.max(8, Math.min(site.depth - r.setback * 2, needed / width));
  const alternatives: Design[] = [
    {
      id: 'balanced',
      name: 'The balanced approach',
      strategy: 'Comfort, efficiency and a resilient site plan.',
      width,
      depth,
      floors: r.floors,
      green: isPark ? 65 : 25,
      parking: r.parking,
      setback: r.setback,
      rotation: 0,
    },
    {
      id: 'capacity',
      name: isPark ? 'Community first' : 'Capacity maximizer',
      strategy: isPark
        ? 'More recreation space and a larger community pavilion.'
        : 'Additional floor area for more development capacity.',
      width: Math.min(width * 1.08, site.width - r.setback * 2),
      depth: Math.min(depth * 1.08, site.depth - r.setback * 2),
      floors: isPark ? 1 : Math.min(40, r.floors + 2),
      green: isPark ? 55 : 15,
      parking: r.parking,
      setback: r.setback,
      rotation: 0,
    },
    {
      id: 'efficient',
      name: isPark ? 'A greener footprint' : 'Capital efficient',
      strategy: isPark
        ? 'A compact pavilion with the most space for nature.'
        : 'A compact footprint, lower capital cost and more landscape.',
      width: width * 0.88,
      depth: depth * 0.9,
      floors: r.floors,
      green: isPark ? 75 : 35,
      parking: Math.round(r.parking * 0.75),
      setback: r.setback,
      rotation: 0,
    },
  ].map((d) => ({ ...d, width: Math.round(d.width), depth: Math.round(d.depth) }));
  // The efficient alternative responds to the actual budget, while retaining explicit capacity tradeoffs.
  const efficient = alternatives[2],
    available = Math.max(0, r.budget - site.landCost);
  for (let i = 0; i < 30 && designMetrics(efficient, site, type).cost > available; i++) {
    if (efficient.width <= 4 && efficient.depth <= 4) break;
    efficient.width = Math.max(4, Math.floor(efficient.width * 0.94));
    efficient.depth = Math.max(4, Math.floor(efficient.depth * 0.94));
  }
  return alternatives;
}
export function designMetrics(d: Design, site: Site, type: DevelopmentType) {
  const footprint = d.width * d.depth,
    gfa = footprint * d.floors,
    area = site.width * site.depth;
  const construction =
    type === 'data-center'
      ? gfa * 2800
      : type === 'park'
        ? gfa * 1800 + ((area * d.green) / 100) * 55
        : gfa * (type === 'commercial' ? 2100 : 2650);
  const equipment = type === 'data-center' ? Math.floor(gfa / 230) * 5.5e6 : 0;
  const hardCost = construction + equipment + d.parking * 7000;
  const cost = hardCost * 1.22;
  const capacity =
    type === 'residential'
      ? Math.floor(gfa / 34)
      : type === 'data-center'
        ? Math.floor(gfa / 230)
        : type === 'park'
          ? Math.floor((area * d.green) / 100 / 18)
          : Math.floor(gfa / 0.092903);
  const used = footprint + (area * d.green) / 100 + d.parking * 30 + area * 0.1;
  const rw = d.rotation === 90 ? d.depth : d.width,
    rd = d.rotation === 90 ? d.width : d.depth;
  const warnings = [
    ...(rw + 2 * d.setback > site.width || rd + 2 * d.setback > site.depth
      ? ['Building exceeds the assumed setbacks.']
      : []),
    ...(used > area
      ? ['Footprint, landscaping, parking and access exceed the site area. Reduce the program.']
      : []),
  ];
  return {
    footprint,
    gfa,
    area,
    coverage: (footprint / area) * 100,
    cost,
    capacity,
    greenArea: (area * d.green) / 100,
    remaining: area - used,
    warnings,
  };
}
export function finances(
  type: DevelopmentType,
  r: Requirements,
  site: Site,
  d?: Design,
  landMultiplier = 1,
) {
  const design = d || generateDesigns(type, r, site)[0],
    m = designMetrics(design, site, type);
  const total = site.landCost * landMultiplier + m.cost;
  const units = Math.min(r.capacity, m.capacity);
  const revenue = type === 'park' ? 0 : units * r.monthlyRate * 12 * r.occupancy;
  const expenses = type === 'park' ? m.greenArea * 7 + m.gfa * 35 : revenue * r.expenseRatio;
  const noi = revenue - expenses;
  return {
    total,
    land: site.landCost * landMultiplier,
    construction: m.cost,
    revenue,
    expenses,
    noi,
    yield: total > 0 ? (noi / total) * 100 : 0,
    payback: noi > 0 ? total / noi : null,
    budgetGap: r.budget - total,
    units,
    socialReach: type === 'park' ? m.capacity : null,
  };
}
export function siteRationale(site: Site, type: DevelopmentType, weights: Record<string, number>) {
  if (isRealSite(site) && site.screen) {
    const failed = site.screen.gates.filter((g) => g.status === 'Fail');
    if (failed.length)
      return `${site.name} fails ${failed.length === 1 ? 'a hard gate' : `${failed.length} hard gates`}: ${failed.map((g) => g.reason).join(' ')} Hard gates cannot be bought back with a better financial score, so it is excluded from the recommendation.`;
    const top = Object.keys(weights)
      .sort((a, b) => (site.metrics[b] ?? 0) * weights[b] - (site.metrics[a] ?? 0) * weights[a])
      .slice(0, 2);
    const p = site.screen.power;
    const sub = p.nearest_substation;
    return `${site.name} passes the community and environmental gates${site.screen.status === 'Needs review' ? ' with items flagged for review' : ''} and scores ${scoreSite(site, weights)}/100, led by ${top.map((k) => `${k} (${site.metrics[k]}/100)`).join(' and ')}. ${sub ? `Nearest ${sub.max_kv ?? '?'} kV substation is ${sub.distance_km} km away. ` : ''}${p.building_service_mw != null ? `Existing building service is about ${p.building_service_mw} MW (Estimated), so a ${type === 'data-center' ? 'large' : ''} facility needs a utility upgrade. ` : ''}Grid capacity requires utility confirmation.`;
  }
  const drivers = Object.keys(weights)
    .sort((a, b) => site.metrics[b] * weights[b] - site.metrics[a] * weights[a])
    .slice(0, 2);
  return `${site.name} scores ${scoreSite(site, weights)}/100 for ${typeLabels[type].toLowerCase()}, led by ${drivers.map((k) => `${k} (${site.metrics[k]}/100)`).join(' and ')}. ${type === 'data-center' ? 'Power is an illustrative infrastructure proxy; a utility study must confirm capacity. ' : ''}${site.risks[0]}`;
}
export const money = (n: number, compact = true) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: compact ? 1 : 0,
    ...(compact ? { notation: 'compact' as const } : {}),
  }).format(n);
export const number = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
export function assistantAnswer(p: Project, question: string): string {
  const q = question.toLowerCase(),
    ranked = rankSites(p.sites, p.weights),
    site = p.sites.find((s) => s.id === p.selectedSiteId) || ranked[0];
  const design =
    p.designs.find((d) => d.id === p.approvedDesignId) ||
    p.designs[0] ||
    generateDesigns(p.type, p.requirements, site)[0];
  const f = finances(p.type, p.requirements, site, design),
    m = designMetrics(design, site, p.type);
  if (/land|price|20%/.test(q)) {
    const pct =
      Number(q.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] || 20) * (/decreas|fall|lower/.test(q) ? -1 : 1);
    const next = finances(p.type, p.requirements, site, design, 1 + pct / 100);
    return `A ${pct}% change in land price changes ${site.name}'s land cost from ${money(f.land)} to ${money(next.land)}, total investment to ${money(next.total)}, and unlevered operating yield from ${f.yield.toFixed(2)}% to ${next.yield.toFixed(2)}%. Annual NOI stays ${money(f.noi)} because only acquisition cost changes. This is a scenario, not a saved change. Debt, tax, appreciation and sale proceeds are excluded.`;
  }
  if (/floor|stor/.test(q)) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
    const count = Number(
      q.match(/(\d+)\s*(?:more|extra|additional)?\s*floors?/)?.[1] ||
        words[q.match(/(one|two|three|four)\s+(?:more\s+)?floors?/)?.[1] || ''] ||
        2,
    );
    const next = { ...design, floors: Math.min(40, design.floors + count) },
      nm = designMetrics(next, site, p.type),
      nf = finances(p.type, p.requirements, site, next);
    return `Adding ${count} floors to ${design.name} produces ${number(nm.gfa)} m² gross floor area (${number(nm.gfa - m.gfa)} m² more), conceptual capacity ${number(nm.capacity)}, and ${money(nm.cost)} development cost. Total investment becomes ${money(nf.total)}; operating yield ${nf.yield.toFixed(2)}%. Revenue is capped at the requested capacity (${number(p.requirements.capacity)}), so additional area may reduce yield. Height approval, structure, fire access and demand are unverified. This scenario does not edit the design.`;
  }
  if (/sensor|leak|water/.test(q))
    return `For ${design.name}, consider leak detection near plumbing risers, restrooms, mechanical rooms and low points; temperature and electrical monitoring near plant equipment, and conceptual smoke sensors in circulation zones. ${p.sensors.length} sensors are currently mapped across ${new Set(p.sensors.map((s) => s.zone)).size} zones; ${p.incidents.filter((i) => i.status !== 'resolved').length} incidents need attention. Device coverage in this prototype is a planning aid, not certified detection coverage. Have qualified safety professionals validate layout and code requirements.`;
  if (/design|maximiz|return|profit/.test(q)) {
    const all = (p.designs.length ? p.designs : generateDesigns(p.type, p.requirements, site))
      .map((d) => ({ d, f: finances(p.type, p.requirements, site, d) }))
      .sort((a, b) => b.f.yield - a.f.yield);
    return `${all.map((x) => `${x.d.name}: ${money(x.f.total)} total, ${money(x.f.noi)} annual NOI, ${x.f.yield.toFixed(2)}% operating yield`).join('\n\n')}\n\n${p.type === 'park' ? 'Parks have no rental revenue in this model; compare access, public benefit, green area and annual maintenance rather than a commercial return.' : `${all[0].d.name} has the highest modeled operating yield. This is an unlevered estimate, not an IRR or investment recommendation.`}`;
  }
  if (/risk|approval|unknown/.test(q))
    return `${site.risks.join(' ')} Also validate title, zoning, actual market demand, geotechnical conditions and construction pricing. Budget headroom is ${money(f.budgetGap)}. ${m.warnings.join(' ')} All candidate attributes are illustrative. ${p.type === 'data-center' ? 'No 100 MW utility connection is confirmed.' : ''} Conceptual safety placement requires professional review.`;
  if (/why|better|site|compar/.test(q))
    return `${ranked.map((s, i) => `${i + 1}. ${siteRationale(s, p.type, p.weights)}`).join('\n\n')}\n\nAll candidate attributes are illustrative. Scores use your saved development-specific weights. Adjust the weights in Discover to test the decision. No listing, price, or zoning has been verified.`;
  return `For ${p.name}, ${site.name} is ${p.selectedSiteId ? 'your selected site' : 'the leading candidate'}. ${design.name} models ${number(m.gfa)} m² across ${design.floors} floors, ${money(f.total)} total investment and ${f.yield.toFixed(2)}% operating yield. ${p.incidents.filter((i) => i.status !== 'resolved').length} unresolved monitoring incidents. Ask about site comparisons, a 20% land-price change, adding two floors, design returns, development risks or sensor placement. Calculations use saved assumptions and illustrative data.`;
}
