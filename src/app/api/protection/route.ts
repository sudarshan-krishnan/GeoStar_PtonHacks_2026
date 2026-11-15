import { routeError } from '@/lib/http';
import { listDeployed } from '@/lib/haven/deployed';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return Response.json(
      { projects: await listDeployed() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return routeError(error);
  }
}
