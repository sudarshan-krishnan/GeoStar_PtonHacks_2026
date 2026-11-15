// Client for the PlotStar data API (services/api, FastAPI). Real CoStar parcels, screening, Vexcel, Matterport.
import type { Site } from './types';

/** Server-side base URL (Next route handlers). */
export const DATA_API = process.env.PLOTSTAR_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
/** Browser-side base URL. */
export const PUBLIC_DATA_API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export const MARKETS = ['Houston', 'Los Angeles'] as const;
export type Market = (typeof MARKETS)[number];

export function marketFor(location: string): Market | null {
  if (/houston|harris|texas|\btx\b/i.test(location)) return 'Houston';
  if (/los angeles|\bla\b|california|\bca\b/i.test(location)) return 'Los Angeles';
  return null;
}

/** Real candidate sites from the CoStar Data Extract, screened by hard gates. Throws if the API is down. */
export async function fetchRealSites(market: Market, minAcres = 5, limit = 8): Promise<Site[]> {
  const q = new URLSearchParams({ market, min_acres: String(minAcres), limit: String(limit) });
  let res: Response;
  try {
    res = await fetch(`${DATA_API}/sites/candidates?${q}`, { cache: 'no-store' });
  } catch {
    throw new Error(
      `PlotStar data API is not reachable at ${DATA_API}. Start services/api (uvicorn app.main:app --port 8000).`,
    );
  }
  if (!res.ok) throw new Error(`PlotStar data API error ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { sites: Site[] };
  return body.sites;
}

export const vexcelOrthoUrl = (parcelId: string, bufferM = 200) =>
  `${PUBLIC_DATA_API}/vexcel/ortho/${encodeURIComponent(parcelId)}.jpg?buffer_m=${bufferM}`;
export const vexcelMetaUrl = (parcelId: string, bufferM = 200) =>
  `${PUBLIC_DATA_API}/vexcel/ortho/${encodeURIComponent(parcelId)}/meta?buffer_m=${bufferM}`;
export const vexcel3dRootUrl = (lat: number, lon: number) =>
  `${PUBLIC_DATA_API}/vexcel/3d/root?lat=${lat}&lon=${lon}`;
export const siteDetailUrl = (parcelId: string) => `${PUBLIC_DATA_API}/sites/${encodeURIComponent(parcelId)}`;
export const auditUrl = (parcelId: string, field: string) =>
  `${PUBLIC_DATA_API}/audit/parcel/${encodeURIComponent(parcelId)}/${encodeURIComponent(field)}`;
export const matterportEmbedUrl = (modelId: string) =>
  `https://my.matterport.com/show/?m=${encodeURIComponent(modelId)}&play=1&qs=1`;
