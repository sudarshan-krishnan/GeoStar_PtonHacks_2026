import { z } from 'zod';
import { db } from '@/lib/db';
import { getProject } from '@/lib/projects';
import { sensorDefaults } from '@/lib/monitoring';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    guardOrigin(req);
    const id = (await ctx.params).id,
      p = await getProject(id);
    if (!p) throw new HttpError(404, 'Project not found.');
    const d = p.designs.find((d) => d.id === p.approvedDesignId);
    if (!d) throw new HttpError(400, 'Approve a design first.');
    const body = z
      .object({
        action: z.enum(['add', 'update', 'delete']),
        sensorId: z.string().optional(),
        name: z.string().trim().min(1).max(80).optional(),
        type: z.enum(['water', 'temperature', 'fire', 'electrical']).optional(),
        zone: z.string().trim().min(1).max(80).optional(),
        x: z.number().optional(),
        z: z.number().optional(),
        floor: z.number().int().min(1).optional(),
        threshold: z.number().min(0.01).max(10000).optional(),
        deviceId: z.string().trim().max(100).nullable().optional(),
      })
      .parse(await readJSON(req));
    if (p.sensors.length >= 400 && body.action === 'add')
      throw new HttpError(400, 'Maximum 400 sensors.');
    const s = p.sensors.find((s) => s.id === body.sensorId);
    if (body.action !== 'add' && !s) throw new HttpError(404, 'Sensor not found.');
    if (body.action === 'delete') {
      await db.$transaction([
        db.incident.updateMany({
          where: { projectId: id, sensorId: s!.id, status: { not: 'resolved' } },
          data: { status: 'resolved' },
        }),
        db.sensor.delete({ where: { id: s!.id } }),
      ]);
    } else {
      const x = body.x ?? s?.x ?? 0,
        z = body.z ?? s?.z ?? 0,
        floor = body.floor ?? s?.floor ?? 1;
      if (Math.abs(x) > d.width / 2 || Math.abs(z) > d.depth / 2 || floor > d.floors)
        throw new HttpError(
          400,
          'Sensor position must be within the approved building and floor count.',
        );
      if (body.action === 'add') {
        const type = body.type || 'water',
          defaults = sensorDefaults[type];
        await db.sensor.create({
          data: {
            projectId: id,
            name: body.name || `${defaults.label} sensor`,
            type,
            zone: body.zone || 'Mechanical room',
            x,
            z,
            floor,
            value: defaults.value,
            threshold: body.threshold ?? defaults.threshold,
            unit: defaults.unit,
            deviceId: body.deviceId || null,
          },
        });
      } else
        await db.sensor.update({
          where: { id: s!.id },
          data: {
            name: body.name,
            zone: body.zone,
            x,
            z,
            floor,
            threshold: body.threshold,
            deviceId: body.deviceId,
          },
        });
    }
    return Response.json(await getProject(id));
  } catch (e) {
    return routeError(e);
  }
}
