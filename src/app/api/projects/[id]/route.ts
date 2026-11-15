import { z } from 'zod';
import { db } from '@/lib/db';
import { getProject } from '@/lib/projects';
import {
  designMetrics,
  designSchema,
  generateDesigns,
  requirementsSchema,
  weightDefaults,
} from '@/lib/engine';
import { guardOrigin, HttpError, readJSON, routeError } from '@/lib/http';
import { sensorPlan } from '@/lib/monitoring';
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, ctx: Context) {
  try {
    const p = await getProject((await ctx.params).id);
    if (!p) throw new HttpError(404, 'Project not found.');
    return Response.json(p);
  } catch (e) {
    return routeError(e);
  }
}
export async function PATCH(req: Request, ctx: Context) {
  try {
    guardOrigin(req);
    const id = (await ctx.params).id,
      p = await getProject(id);
    if (!p) throw new HttpError(404, 'Project not found.');
    const input = z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('requirements'),
          requirements: requirementsSchema,
          name: z.string().trim().min(1).max(120),
        }),
        z.object({
          action: z.literal('weights'),
          weights: z.record(z.string(), z.number().min(0).max(100)),
        }),
        z.object({ action: z.literal('select-site'), siteId: z.string() }),
        z.object({ action: z.literal('generate') }),
        z.object({ action: z.literal('save-design'), design: designSchema }),
        z.object({ action: z.literal('approve'), designId: z.string() }),
      ])
      .parse(await readJSON(req));
    if (input.action === 'requirements') {
      if (p.approvedDesignId)
        throw new HttpError(
          409,
          'The approved design locks requirements. Select a site again to revise the project.',
        );
      await db.project.update({
        where: { id },
        data: {
          name: input.name,
          requirements: JSON.stringify(input.requirements),
          designs: '[]',
          approvedDesignId: null,
        },
      });
    }
    if (input.action === 'weights') {
      const keys = Object.keys(weightDefaults[p.type]);
      if (
        Object.keys(input.weights).length !== keys.length ||
        keys.some((k) => !(k in input.weights)) ||
        Object.values(input.weights).every((v) => v === 0)
      )
        throw new HttpError(400, 'Supply positive weights for the project scoring criteria.');
      await db.project.update({ where: { id }, data: { weights: JSON.stringify(input.weights) } });
    }
    if (input.action === 'select-site') {
      const chosen = p.sites.find((s) => s.id === input.siteId);
      if (!chosen) throw new HttpError(400, 'Unknown site.');
      // Hard gates are pass/fail and cannot be bought back with a good financial score (PRD principle 1).
      if (chosen.screen?.status === 'Fail')
        throw new HttpError(
          409,
          `${chosen.name} fails a hard gate: ${chosen.screen.gates
            .filter((g) => g.status === 'Fail')
            .map((g) => g.gate)
            .join(', ')}.`,
        );
      if (p.selectedSiteId !== input.siteId || p.approvedDesignId)
        await db.$transaction([
          db.sensor.deleteMany({ where: { projectId: id } }),
          db.incident.deleteMany({ where: { projectId: id } }),
          db.project.update({
            where: { id },
            data: {
              selectedSiteId: input.siteId,
              designs: '[]',
              approvedDesignId: null,
              stage: 'design',
            },
          }),
        ]);
    }
    if (input.action === 'generate') {
      const site = p.sites.find((s) => s.id === p.selectedSiteId);
      if (!site) throw new HttpError(400, 'Select a site first.');
      if (p.approvedDesignId)
        throw new HttpError(409, 'Reselect the site to replace an approved design.');
      await db.project.update({
        where: { id },
        data: {
          designs: JSON.stringify(generateDesigns(p.type, p.requirements, site)),
          stage: 'design',
        },
      });
    }
    if (input.action === 'save-design') {
      if (p.approvedDesignId)
        throw new HttpError(409, 'Reselect the site to revise an approved design.');
      if (!p.designs.some((d) => d.id === input.design.id))
        throw new HttpError(400, 'Unknown design.');
      await db.project.update({
        where: { id },
        data: {
          designs: JSON.stringify(
            p.designs.map((d) => (d.id === input.design.id ? input.design : d)),
          ),
        },
      });
    }
    if (input.action === 'approve') {
      const design = p.designs.find((d) => d.id === input.designId),
        site = p.sites.find((s) => s.id === p.selectedSiteId);
      if (!design || !site) throw new HttpError(400, 'Generate and save a design first.');
      if (designMetrics(design, site, p.type).warnings.length)
        throw new HttpError(400, 'Resolve site fit warnings before approval.');
      if (p.approvedDesignId !== design.id)
        await db.$transaction([
          db.sensor.deleteMany({ where: { projectId: id } }),
          db.incident.deleteMany({ where: { projectId: id } }),
          db.sensor.createMany({ data: sensorPlan(id, design, p.type) }),
          db.project.update({
            where: { id },
            data: { approvedDesignId: design.id, stage: 'protect' },
          }),
        ]);
    }
    return Response.json(await getProject(id));
  } catch (e) {
    return routeError(e);
  }
}
