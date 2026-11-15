import { db } from '@/lib/db';
import { getProject } from '@/lib/projects';
import { HttpError, routeError } from '@/lib/http';
import type { AmenityResult } from '@/lib/types';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const p = await getProject((await ctx.params).id);
    if (!p) throw new HttpError(404, 'Project not found.');
    const site = p.sites.find((s) => s.id === new URL(req.url).searchParams.get('siteId'));
    if (!site) throw new HttpError(400, 'Unknown site.');
    const key = `${site.lat},${site.lng}`,
      cache = await db.amenityCache.findUnique({ where: { key } });
    if (cache && Date.now() - cache.updatedAt.getTime() < 86400000)
      return Response.json(JSON.parse(cache.payload));
    try {
      const query = `[out:json][timeout:12];(nwr(around:1200,${site.lat},${site.lng})[amenity~"school|restaurant|cafe|bus_station"];nwr(around:1200,${site.lat},${site.lng})[leisure=park];nwr(around:1200,${site.lat},${site.lng})[public_transport=platform];);out center 100;`;
      const r = await fetch(process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: {
          'User-Agent': 'PlotStar-Local-Demo/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('Overpass unavailable');
      const data = await r.json();
      const result: AmenityResult = {
        source: 'OpenStreetMap / Overpass',
        fetchedAt: new Date().toISOString(),
        message:
          'Mapped amenities within 1.2 km. Community mapping may be incomplete; no property or grid attributes are verified.',
        points: (data.elements || [])
          .map(
            (e: {
              id: number;
              tags?: Record<string, string>;
              lat?: number;
              lon?: number;
              center?: { lat: number; lon: number };
            }) => ({
              id: e.id,
              name:
                e.tags?.name ||
                e.tags?.amenity ||
                e.tags?.leisure ||
                e.tags?.public_transport ||
                'Mapped place',
              type: e.tags?.amenity || e.tags?.leisure || e.tags?.public_transport || 'amenity',
              lat: e.lat ?? e.center?.lat,
              lng: e.lon ?? e.center?.lon,
            }),
          )
          .filter(
            (e: { lat?: number; lng?: number }) => Number.isFinite(e.lat) && Number.isFinite(e.lng),
          ),
      };
      await db.amenityCache.upsert({
        where: { key },
        create: { key, payload: JSON.stringify(result) },
        update: { payload: JSON.stringify(result) },
      });
      return Response.json(result);
    } catch {
      return Response.json({
        source: 'Illustrative fallback',
        fetchedAt: new Date().toISOString(),
        message:
          'The external amenity lookup is unavailable. Baseline candidate counts remain illustrative; no live points are shown.',
        points: [],
      } satisfies AmenityResult);
    }
  } catch (e) {
    return routeError(e);
  }
}
