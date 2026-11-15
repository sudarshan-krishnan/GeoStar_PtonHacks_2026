import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getProject } from '@/lib/projects';
import { ingestReading } from '@/lib/monitoring';
import { HttpError, readJSON, routeError } from '@/lib/http';
const limits = new Map<string, { count: number; time: number }>();
export async function POST(req: Request) {
  try {
    const key = process.env.TELEMETRY_API_KEY;
    if (!key)
      throw new HttpError(503, 'Hardware ingestion is disabled. Configure TELEMETRY_API_KEY.');
    const token = req.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (
      Buffer.byteLength(token) !== Buffer.byteLength(key) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(key))
    )
      throw new HttpError(401, 'Invalid telemetry credentials.');
    const b = z
      .object({
        projectId: z.string().min(1).max(100),
        sensorId: z.string().min(1).max(100),
        deviceId: z.string().min(1).max(100),
        value: z.number().finite().min(-100).max(10000),
      })
      .parse(await readJSON(req));
    const limitKey = `${b.projectId}:${b.deviceId}`,
      now = Date.now(),
      last = limits.get(limitKey),
      l =
        last && now - last.time < 60000
          ? { ...last, count: last.count + 1 }
          : { count: 1, time: now };
    if (limits.size > 2000) limits.clear();
    limits.set(limitKey, l);
    if (l.count > 120) throw new HttpError(429, 'At most 120 readings per device per minute.');
    const p = await getProject(b.projectId),
      s = p?.sensors.find((s) => s.id === b.sensorId);
    if (!s) throw new HttpError(404, 'Unknown project sensor.');
    if (!s.deviceId || s.deviceId !== b.deviceId)
      throw new HttpError(403, 'Bind this sensor to the device ID in Protect before ingestion.');
    if (
      ((s.type === 'water' || s.type === 'electrical') && (b.value < 0 || b.value > 100)) ||
      (s.type === 'fire' && ![0, 1].includes(b.value)) ||
      (s.type === 'temperature' && (b.value < -50 || b.value > 150))
    )
      throw new HttpError(400, 'Reading outside supported sensor range.');
    const sensor = await ingestReading(s, b.value, 'hardware', b.deviceId);
    return Response.json({ accepted: true, sensorId: sensor.id, receivedAt: sensor.lastSeen });
  } catch (e) {
    return routeError(e);
  }
}
