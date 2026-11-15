import { z } from 'zod';
import { db } from '@/lib/db';
import { getProject } from '@/lib/projects';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    guardOrigin(req);
    const id = (await ctx.params).id;
    const input = z
      .object({ incidentId: z.string(), status: z.enum(['acknowledged', 'resolved']) })
      .parse(await readJSON(req));
    const i = await db.incident.findFirst({ where: { id: input.incidentId, projectId: id } });
    if (!i) throw new HttpError(404, 'Incident not found.');
    if (i.status === 'resolved') throw new HttpError(409, 'This incident is already resolved.');
    await db.incident.update({ where: { id: i.id }, data: { status: input.status } });
    return Response.json(await getProject(id));
  } catch (e) {
    return routeError(e);
  }
}
