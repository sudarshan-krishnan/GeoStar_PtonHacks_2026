import { routeError } from '@/lib/http';
import { requireMobileKey } from '@/lib/haven/mobile';

// The phone's Wi-Fi survey times this: ?kb=0 for response time, ?kb=256 for download speed.
export const dynamic = 'force-dynamic';
const block = new Uint8Array(1024 * 1024);

export async function GET(req: Request) {
  try {
    requireMobileKey(req);
    const kb = Math.max(0, Math.min(1024, Number(new URL(req.url).searchParams.get('kb')) || 0));
    return new Response(block.subarray(0, kb * 1024), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store, no-transform',
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
