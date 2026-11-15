import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getProject } from '@/lib/projects';
import { reportData } from '@/lib/report';
import { HttpError, routeError } from '@/lib/http';
import { db } from '@/lib/db';
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const p = await getProject((await ctx.params).id);
    if (!p) throw new HttpError(404, 'Project not found.');
    const { sections, site, d } = reportData(p);
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica),
      bold = await doc.embedFont(StandardFonts.HelveticaBold);
    doc.setTitle(`PlotStar - ${p.name}`);
    doc.setAuthor('PlotStar');
    const ink = rgb(0.13, 0.25, 0.19),
      muted = rgb(0.39, 0.44, 0.38),
      green = rgb(0.67, 0.77, 0.47);
    let page = doc.addPage([595.28, 841.89]),
      y = 0;
    const ascii = (s: string) =>
      s
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/→/g, ' > ')
        .replace(/²/g, '2')
        .replace(/°/g, ' deg ')
        .replace(/·/g, ' / ')
        .replace(/[^\x20-\x7E\n]/g, '');
    function newPage() {
      if (y !== 0) page = doc.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 790, width: 595.28, height: 52, color: ink });
      page.drawText('PLOTSTAR / INVESTMENT & PLANNING', {
        x: 42,
        y: 811,
        font: bold,
        size: 10,
        color: rgb(0.95, 0.96, 0.9),
      });
      y = 758;
    }
    function text(value: string, size = 10, isBold = false) {
      const f = isBold ? bold : font,
        max = 511,
        words = ascii(value).split(/\s+/);
      let line = '';
      for (const raw of words) {
        const chunks = raw.length > 75 ? raw.match(/.{1,65}/g) || [raw] : [raw];
        for (const word of chunks) {
          const test = line ? `${line} ${word}` : word;
          if (f.widthOfTextAtSize(test, size) > max && line) {
            if (y < 62) newPage();
            page.drawText(line, { x: 42, y, font: f, size, color: isBold ? ink : muted });
            y -= size * 1.5;
            line = word;
          } else line = test;
        }
      }
      if (line) {
        if (y < 62) newPage();
        page.drawText(line, { x: 42, y, font: f, size, color: isBold ? ink : muted });
        y -= size * 1.5;
      }
      y -= 8;
    }
    newPage();
    text('Find it. Design it. Protect it.', 24, true);
    text(p.name, 18, true);
    text(`Prepared ${new Date().toISOString()} / Project ${p.id}`);
    text('CONCEPTUAL PLANNING / ILLUSTRATIVE DATA / PROFESSIONAL REVIEW REQUIRED', 8, true);
    if (y < 260) newPage();
    const scale = Math.min(190 / site.width, 100 / site.depth),
      sx = 42,
      sy = y - 120;
    page.drawRectangle({
      x: sx,
      y: sy,
      width: site.width * scale,
      height: site.depth * scale,
      color: rgb(0.91, 0.94, 0.87),
      borderColor: green,
      borderWidth: 1,
    });
    page.drawRectangle({
      x: sx + ((site.width - d.width) * scale) / 2,
      y: sy + ((site.depth - d.depth) * scale) / 2,
      width: d.width * scale,
      height: d.depth * scale,
      color: green,
      borderColor: ink,
      borderWidth: 0.7,
    });
    page.drawText('CONCEPTUAL SITE FOOTPRINT', {
      x: 260,
      y: sy + 80,
      font: bold,
      size: 9,
      color: ink,
    });
    page.drawText(`${d.width} x ${d.depth} m / ${d.floors} floors`, {
      x: 260,
      y: sy + 60,
      font,
      size: 10,
      color: muted,
    });
    page.drawText('No surveyed parcel or terrain', {
      x: 260,
      y: sy + 40,
      font,
      size: 9,
      color: muted,
    });
    y = sy - 24;
    for (const section of sections) {
      if (y < 140) newPage();
      text(section.title.toUpperCase(), 12, true);
      for (const paragraph of section.text) text(paragraph);
      y -= 8;
    }
    const cache = await db.amenityCache.findUnique({ where: { key: `${site.lat},${site.lng}` } });
    if (cache) {
      const info = JSON.parse(cache.payload);
      text(
        `Live amenity snapshot: ${info.source}; fetched ${info.fetchedAt}; ${info.points.length} mapped points. ${info.message}`,
      );
    }
    const pages = doc.getPages();
    pages.forEach((pg, i) => {
      pg.drawLine({
        start: { x: 42, y: 45 },
        end: { x: 553, y: 45 },
        color: green,
        thickness: 0.6,
      });
      pg.drawText(`PLOTSTAR / CONCEPTUAL PLANNING     ${i + 1} / ${pages.length}`, {
        x: 42,
        y: 28,
        size: 8,
        font,
        color: muted,
      });
    });
    const bytes = await doc.save();
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="plotstar-${p.id}-report.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return routeError(e);
  }
}
