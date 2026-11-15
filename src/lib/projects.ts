import { db } from './db';
import { makeSites, parseBrief, weightDefaults } from './engine';
import { interpretBrief } from './llm';
import { fetchRealSites, marketFor } from './plotstar-api';
import type { DevelopmentType, Project, Site } from './types';
export const includeProject = {
  sensors: { orderBy: { name: 'asc' as const } },
  incidents: { orderBy: { createdAt: 'desc' as const } },
  messages: { orderBy: { createdAt: 'asc' as const } },
  simulations: { orderBy: { createdAt: 'desc' as const } },
};
export function decodeProject(raw: unknown): Project {
  const p = JSON.parse(JSON.stringify(raw));
  return {
    ...p,
    requirements: JSON.parse(p.requirements),
    sites: JSON.parse(p.sites),
    designs: JSON.parse(p.designs),
    weights: JSON.parse(p.weights),
  };
}
export async function getProject(id: string) {
  const raw = await db.project.findUnique({ where: { id }, include: includeProject });
  return raw ? decodeProject(raw) : null;
}
/**
 * Data center projects in a CoStar-covered market (Houston, Los Angeles) get real, screened CoStar
 * parcels from services/api. Other project types keep the illustrative Princeton candidates.
 */
export async function sitesFor(type: DevelopmentType, location: string): Promise<Site[]> {
  const market = marketFor(location);
  if (type === 'data-center' && market) return fetchRealSites(market);
  return makeSites(type, location);
}
export async function createProject(brief: string) {
  const p = await interpretBrief(brief);
  return decodeProject(
    await db.project.create({
      data: {
        ...p,
        brief,
        requirements: JSON.stringify(p.requirements),
        sites: JSON.stringify(await sitesFor(p.type, p.requirements.location)),
        weights: JSON.stringify(weightDefaults[p.type]),
      },
      include: includeProject,
    }),
  );
}
export const demos = [
  'Find a student dormitory near Princeton, with 200 beds, good walkability and strong investment returns. Budget $28 million.',
  'Find a suitable location for a 100 MW data center in Houston with electrical infrastructure and minimal environmental conflicts. Budget $900 million.',
  'Create a community park near Princeton for 500 visitors, prioritizing underserved neighborhoods, schools and green space. Budget $8 million.',
];
export async function ensureDemos() {
  for (let i = 0; i < demos.length; i++) {
    const id = `demo-${i + 1}`;
    const p = parseBrief(demos[i]);
    const existing = await db.project.findUnique({ where: { id } });
    // Upgrade a previously seeded illustrative data-center demo to real CoStar candidates.
    const stale =
      existing &&
      p.type === 'data-center' &&
      !(JSON.parse(existing.sites) as Site[]).some((s) => s.source === 'costar');
    if (existing && !stale) continue;
    let sites: Site[];
    try {
      sites = await sitesFor(p.type, p.requirements.location);
    } catch (e) {
      // The data API may not be running yet: keep what exists, or seed this demo on a later visit.
      console.warn(`[ensureDemos] ${id} skipped: ${(e as Error).message}`);
      continue;
    }
    const data = {
      name: p.name,
      brief: demos[i],
      type: p.type,
      requirements: JSON.stringify(p.requirements),
      sites: JSON.stringify(sites),
      weights: JSON.stringify(weightDefaults[p.type]),
    };
    if (existing)
      await db.project.update({
        where: { id },
        data: { ...data, selectedSiteId: null, designs: '[]', approvedDesignId: null, stage: 'discover' },
      });
    else await db.project.create({ data: { id, ...data } });
  }
}
