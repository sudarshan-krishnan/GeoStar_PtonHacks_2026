import { z } from 'zod';
import { db } from '@/lib/db';
import { createProject, decodeProject, ensureDemos, includeProject } from '@/lib/projects';
import { guardOrigin, readJSON, routeError } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await ensureDemos();
    return Response.json(
      (await db.project.findMany({ include: includeProject, orderBy: { updatedAt: 'desc' } })).map(
        decodeProject,
      ),
    );
  } catch (e) {
    return routeError(e);
  }
}
export async function POST(req: Request) {
  try {
    guardOrigin(req);
    const { brief } = z
      .object({ brief: z.string().trim().min(12).max(4000) })
      .parse(await readJSON(req));
    return Response.json(await createProject(brief), { status: 201 });
  } catch (e) {
    return routeError(e);
  }
}
