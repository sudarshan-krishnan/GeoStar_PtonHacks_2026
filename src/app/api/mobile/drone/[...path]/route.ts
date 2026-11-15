import { routeError } from '@/lib/http';
import { requireMobileKey } from '@/lib/haven/mobile';
import { GET as droneGet, POST as dronePost } from '@/app/api/drone/[...path]/route';

// The phone's drone tab: the dashboard's Tello proxy (status, video, command, snapshot,
// captures) behind the phone token. Reached through scripts/mobile-gateway.mjs.
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Context) {
  try {
    requireMobileKey(req);
  } catch (error) {
    return routeError(error);
  }
  return droneGet(req, ctx);
}

export async function POST(req: Request, ctx: Context) {
  try {
    requireMobileKey(req);
  } catch (error) {
    return routeError(error);
  }
  return dronePost(req, ctx);
}
