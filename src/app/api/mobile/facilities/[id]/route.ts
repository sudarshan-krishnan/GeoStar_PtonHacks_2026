import { z } from 'zod';
import { HttpError, readJSON, routeError } from '@/lib/http';
import { listDeployed } from '@/lib/haven/deployed';
import { actionSchema } from '@/lib/haven/engine';
import { MOBILE_ACTIONS, mobileView, requireMobileKey } from '@/lib/haven/mobile';
import { changeProtection, loadProtection } from '@/lib/haven/store';

// One deployed facility for the phone app: read its incident-command view, or send a response.
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

async function deployedFacility(ctx: Context) {
  const { id } = await ctx.params;
  const project = (await listDeployed()).find((p) => p.facility.id === id);
  if (!project) throw new HttpError(404, 'No deployed facility with this ID.');
  return project.facility;
}

export async function GET(req: Request, ctx: Context) {
  try {
    requireMobileKey(req);
    const facility = await deployedFacility(ctx);
    return Response.json(mobileView(await loadProtection(facility)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(req: Request, ctx: Context) {
  try {
    requireMobileKey(req);
    const facility = await deployedFacility(ctx);
    const body = z
      .object({ revision: z.number().int().min(0), command: actionSchema })
      .parse(await readJSON(req));
    if (!MOBILE_ACTIONS.has(body.command.action))
      throw new HttpError(403, 'Set up protections on the desktop. The phone handles incident response.');
    try {
      return Response.json(
        mobileView(await changeProtection(facility, body.revision, body.command)),
      );
    } catch (error) {
      // Same as the desktop: a stale revision or a rejected transition.
      throw new HttpError(409, (error as Error).message);
    }
  } catch (error) {
    return routeError(error);
  }
}
