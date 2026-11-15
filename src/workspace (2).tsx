'use client';
import { Download, FileText, MapPin, ShieldCheck } from 'lucide-react';
import { reportData } from '@/lib/report';
import type { Project } from '@/lib/types';
import { money, number } from '@/lib/engine';
import { Button } from './ui/button';
import { Stat } from './discover';
export function Report({ p }: { p: Project }) {
  const { site, m, f, sections } = reportData(p);
  return (
    <div className="report-layout">
      <section className="report-cover">
        <div>
          <div className="eyebrow">PLOTSTAR / INVESTMENT & PLANNING</div>
          <h2>{p.name}</h2>
          <p>
            <MapPin size={15} />
            {site.name} · {site.area}
          </p>
          <span>
            Prepared from your saved project ·{' '}
            {new Date().toLocaleDateString('en-US', {
              timeZone: 'America/New_York',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>
        <Button asChild variant="secondary">
          <a href={`/api/projects/${p.id}/report`} download>
            <Download size={17} /> Export PDF
          </a>
        </Button>
        <div className="report-cover-grid">
          <Stat label="Total investment" value={money(f.total)} />
          <Stat label="Gross floor area" value={`${number(m.gfa)} m²`} />
          <Stat
            label="Operating yield"
            value={p.type === 'park' ? 'Public benefit' : `${f.yield.toFixed(2)}%`}
          />
          <Stat label="Planned sensors" value={String(p.sensors.length)} />
        </div>
      </section>
      <div className="report-body">
        {sections.map((s, i) => (
          <section className="panel report-section" key={s.title}>
            <div className="report-section-number">{String(i + 1).padStart(2, '0')}</div>
            <div>
              <h2>{s.title.split(' / ')[1]}</h2>
              {s.text.map((t, j) => (
                <p key={j}>{t}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="notice">
        <ShieldCheck size={18} /> This is a conceptual planning report based on illustrative
        assumptions. It is not a property valuation, utility guarantee, engineering approval, or
        life-safety certification.
      </div>
    </div>
  );
}
