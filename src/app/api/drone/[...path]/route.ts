import { z } from 'zod';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';

// Proxy to the Tello bridge (bridge/server.py) running on the demo laptop. The dashboard talks
// only to its own origin; the bridge itself accepts local origins only.
export const dynamic = 'force-dynamic';

const BRIDGE = (process.env.DRONE_BRIDGE_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
const actions = z.enum([
  'takeoff',
  'land',
  'up',
  'down',
  'left',
  'right',
  'forward',
  'back',
  'cw',
  'ccw',
  'emergency',
]);
const stick = z.number().min(-100).max(100).default(0);
const captureName = /^[0-9]{8}-[0-9]{6}(-[0-9]{3})?(-sim)?\.jpg$/;
type Context = { params: Promise<{ path: string[] }> };

async function bridge(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 4000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(`${BRIDGE}${path}`, {
      ...rest,
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new HttpError(503, `Drone bridge not reachable at ${BRIDGE}.`);
  }
}

/** Passes the bridge's JSON (and status code) through unchanged. */
async function relay(res: Response) {
  const body = await res.json().catch(() => ({ error: `Bridge error ${res.status}` }));
  return Response.json(body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request, ctx: Context) {
  try {
    const path = (await ctx.params).path.join('/');
    if (path === 'status') {
      // Never an error: "bridge offline" is a normal state the page renders.
      try {
        const res = await bridge('/api/status', { timeoutMs: 2500 });
        return Response.json(
          { bridge: true, url: BRIDGE, ...(await res.json()) },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch {
        return Response.json(
          { bridge: false, url: BRIDGE },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
    }
    if (path === 'video') {
      // MJPEG from the drone camera. The browser closing the <img> aborts the upstream stream.
      const res = await bridge('/video', { signal: req.signal, timeoutMs: 24 * 3600 * 1000 });
      if (!res.ok || !res.body) throw new HttpError(502, 'The bridge has no video stream.');
      return new Response(res.body, {
        headers: {
          'Content-Type': res.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame',
          // no-transform keeps compression from buffering the endless stream
          'Cache-Control': 'no-store, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    if (path === 'snapshots') return relay(await bridge('/api/drone/snapshots'));
    const capture = path.match(/^captures\/(.+)$/)?.[1];
    if (capture && captureName.test(capture)) {
      const res = await bridge(`/captures/${capture}`);
      if (!res.ok) throw new HttpError(404, 'Capture not found.');
      return new Response(res.body, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
      });
    }
    throw new HttpError(404, 'Unknown drone endpoint.');
  } catch (e) {
    return routeError(e);
  }
}

export async function POST(req: Request, ctx: Context) {
  try {
    guardOrigin(req);
    const path = (await ctx.params).path.join('/');
    if (path === 'command') {
      const { action } = z.object({ action: actions }).parse(await readJSON(req));
      // djitellopy waits up to 7 s for the drone's reply and retries; moves can take a while.
      return relay(
        await bridge('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
          timeoutMs: 25000,
        }),
      );
    }
    if (path === 'rc') {
      // Hold-to-fly: stick positions, repeated while a control is held (see bridge/server.py).
      const sticks = z.object({ right: stick, forward: stick, up: stick, clockwise: stick }).parse(await readJSON(req));
      return relay(
        await bridge('/api/rc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sticks),
          timeoutMs: 1500,
        }),
      );
    }
    if (path === 'snapshot')
      return relay(await bridge('/api/drone/snapshot', { method: 'POST', timeoutMs: 8000 }));
    throw new HttpError(404, 'Unknown drone endpoint.');
  } catch (e) {
    return routeError(e);
  }
}
