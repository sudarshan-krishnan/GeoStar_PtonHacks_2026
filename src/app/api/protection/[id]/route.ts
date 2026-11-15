import { z } from 'zod';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';
import { actionSchema } from '@/lib/haven/engine';
import { changeProtection, loadProtection } from '@/lib/haven/store';
import { resetWorkspace } from '@/lib/haven/deployed';

export const dynamic = 'force-dynamic';
const facilitySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,150}$/),
  name: z.string().trim().min(1).max(160),
  city: z.string().max(120),
  type: z.string().max(60),
});
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const params = new URL(req.url).searchParams;
    const facility = facilitySchema.parse({
      id,
      name: params.get('name'),
      city: params.get('city') || '',
      type: params.get('type') || '',
    });
    return Response.json(await loadProtection(facility), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return routeError(error);
  }
}
export async function PATCH(req: Request, ctx: Context) {
  try {
    guardOrigin(req);
    const { id } = await ctx.params;
    const body = z
      .object({
        facility: facilitySchema,
        revision: z.number().int().min(0),
        command: actionSchema,
      })
      .parse(await readJSON(req));
    if (id !== body.facility.id) throw new HttpError(400, 'Facility identifier does not match.');
    try {
      return Response.json(await changeProtection(body.facility, body.revision, body.command));
    } catch (error) {
      throw new HttpError(409, (error as Error).message);
    }
  } catch (error) {
    return routeError(error);
  }
}
export async function DELETE(req: Request, ctx: Context) {
  try {
    guardOrigin(req);
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]{1,150}$/.test(id)) throw new HttpError(400, 'Invalid facility identifier.');
    return Response.json({ reset: await resetWorkspace(id) });
  } catch (error) {
    return routeError(error);
  }
}
