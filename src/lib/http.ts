import { ZodError } from 'zod';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function guardOrigin(req: Request) {
  const origin = req.headers.get('origin');
  const url = new URL(req.url);
  // Next can normalize req.url to localhost even when the browser uses 127.0.0.1.
  // Host is the browser-requested authority; do not trust forwarded origin headers.
  const expected = `${url.protocol}//${req.headers.get('host') || url.host}`;
  if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expected))
    throw new HttpError(403, 'Cross-origin writes are not allowed.');
}
export async function readJSON(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > 65536)
    throw new HttpError(413, 'Request too large.');
  const text = await req.text();
  if (text.length > 65536) throw new HttpError(413, 'Request too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Expected valid JSON.');
  }
}
export function routeError(e: unknown) {
  if (e instanceof ZodError)
    return Response.json(
      { error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error('GeoStar API error', e instanceof Error ? e.message : 'Unknown error');
  return Response.json(
    { error: 'Unable to complete this request. Please try again.' },
    { status: 500 },
  );
}
