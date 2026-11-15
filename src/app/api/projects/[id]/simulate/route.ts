import { z } from 'zod';
import { getProject } from '@/lib/projects';
import { simulate } from '@/lib/monitoring';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    guardOrigin(req);
    const p = await getProject((await ctx.params).id);
    if (!p) throw new HttpError(404, 'Project not found.');
    const { kind } = z
      .object({ kind: z.enum(['water-leak', 'overheating', 'fire-alarm', 'reset']) })
      .parse(await readJSON(req));
    try {
      await simulate(p, kind);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return Response.json(await getProject(p.id));
  } catch (e) {
    return routeError(e);
  }
}
