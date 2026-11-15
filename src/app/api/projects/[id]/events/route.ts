import { getProject } from '@/lib/projects';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  if (!(await getProject(id)))
    return Response.json({ error: 'Project not found' }, { status: 404 });
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined,
    closed = false,
    busy = false;
  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener('abort', close, { once: true });
      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      let previous = '';
      timer = setInterval(async () => {
        if (closed || busy) return;
        busy = true;
        try {
          const p = await getProject(id);
          if (!p) {
            close();
            return;
          }
          const payload = JSON.stringify(p);
          if (payload !== previous) {
            controller.enqueue(encoder.encode(`event: project\ndata: ${payload}\n\n`));
            previous = payload;
          } else controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          close();
        } finally {
          busy = false;
        }
      }, 1800);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
