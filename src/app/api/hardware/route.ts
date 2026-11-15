// Live hardware bridge: the SiteStar PROTECT service (ESP32 + UNO R4 console) runs on the laptop wired
// to the physical model. This route reads its state for any deployed project's Command Center,
// forwards grid controls and approvals, and connects the kit to a project ("link").
import { z } from 'zod';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';
import { linkHardware, PROTECT_BASE as BASE } from '@/lib/hardware/protect';

export const dynamic = 'force-dynamic';
const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,150}$/),
  name: z.string().trim().min(1).max(160),
  city: z.string().max(120).optional(),
  type: z.string().max(60).optional(),
});

type Incident = {
  id: string; kind: string; title: string; room_name: string; severity: string; status: string;
  started: number; agent_state: string; work_order?: string | null;
};

export async function GET() {
  try {
    const r = await fetch(`${BASE}/api/state`, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!r.ok) return Response.json({ online: false }, { headers: { 'Cache-Control': 'no-store' } });
    const s = await r.json();
    const power = s.power ?? {};
    return Response.json(
      {
        online: true,
        at: Date.now(),
        live: s.live ?? {},
        power: { ...power, history: (power.history ?? []).slice(-90) },
        incidents: ((s.incidents ?? []) as Incident[]).slice(0, 4).map((i) => ({
          id: i.id, kind: i.kind, title: i.title, room: i.room_name, severity: i.severity,
          status: i.status, started: i.started, agent: i.agent_state, workOrder: i.work_order ?? null,
        })),
        agent: {
          mode: s.agent?.mode ?? null,
          pending: (s.agent?.pending ?? []).map((p: { lines?: string[] }) => p.lines?.[0] ?? ''),
          trace: (s.agent?.trace ?? []).slice(-4).map((t: { t: number; who: string; text: string }) => ({
            t: t.t, who: t.who, text: t.text,
          })),
        },
        badge: s.lobby?.last_badge ?? null,
        messages: (s.phone?.transcript ?? []).slice(-3).map((m: { t: number; dir: string; text: string }) => ({
          t: m.t, dir: m.dir, text: m.text,
        })),
        boards: { esp32: !!s.hardware?.connected, console: !!s.lobby?.alive },
        facilityId: s.team_app?.facility_id ?? null,
        // The project the physical model is connected to (one kit, one project at a time).
        linked: s.team_app?.facility_id
          ? {
              id: s.team_app.facility_id as string,
              name: (s.team_app.facility as string | null) ?? s.team_app.facility_id,
              type: (s.team_app.facility_type as string | null) ?? null,
              by: (s.team_app.linked_by as string | null) ?? null,
              error: s.team_app.ok === false ? ((s.team_app.error as string | null) ?? null) : null,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ online: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

const ACTIONS: Record<string, (depth?: number) => [string, unknown]> = {
  'grid-start': (depth) => [`/api/grid/request${depth ? `?depth=${depth}` : ''}`, {}],
  'grid-end': () => ['/api/grid/end', {}],
  approve: () => ['/api/manager/reply', { text: 'YES', channel: 'dashboard' }],
  decline: () => ['/api/manager/reply', { text: 'NO', channel: 'dashboard' }],
};

export async function POST(req: Request) {
  try {
    guardOrigin(req);
    const body = (await readJSON(req)) as { action?: string; depth?: number; project?: unknown };
    if (body.action === 'link') {
      const project = projectSchema.parse(body.project);
      if (!(await linkHardware(project, 'dashboard'))) throw new HttpError(503, 'Live hardware is offline.');
      return Response.json({ ok: true });
    }
    const make = body.action ? ACTIONS[body.action] : undefined;
    if (!make) throw new HttpError(400, 'Unknown hardware action.');
    const depth = Number.isInteger(body.depth) && body.depth! >= 10 && body.depth! <= 90 ? body.depth : undefined;
    const [path, payload] = make(depth);
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new HttpError(502, 'The hardware service rejected the action.');
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof TypeError) return routeError(new HttpError(503, 'Live hardware is offline.'));
    return routeError(error);
  }
}
