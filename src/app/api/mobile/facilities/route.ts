import { routeError } from '@/lib/http';
import { listDeployed } from '@/lib/haven/deployed';
import { requireMobileKey } from '@/lib/haven/mobile';

// Deployed facilities for the phone app (reached through scripts/mobile-gateway.mjs).
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    requireMobileKey(req);
    return Response.json(
      { projects: await listDeployed() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return routeError(error);
  }
}
