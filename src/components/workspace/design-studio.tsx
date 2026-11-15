'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  Layers,
  Leaf,
  MapPin,
  RotateCw,
  Save,
  Sparkles,
} from 'lucide-react';
import type { Design, Project } from '@/lib/types';
import { designMetrics, finances, money, number } from '@/lib/engine';
import { Button } from '../ui/button';
import { SitePlan } from './site-plan';
import { Stat } from './discover';
import type { Mutate } from './workspace';
const Scene = dynamic(() => import('./scene'), {
  ssr: false,
  loading: () => (
    <div className="scene-container loading-panel">Preparing your 3D perspective…</div>
  ),
});
export function DesignStudio({
  p,
  mutate,
  busy,
  onContinue,
  onDiscover,
}: {
  p: Project;
  mutate: Mutate;
  busy: boolean;
  onContinue: () => void;
  onDiscover: () => void;
}) {
  const [selected, setSelected] = useState(p.approvedDesignId || p.designs[0]?.id || 'balanced'),
    [draft, setDraft] = useState<Design | null>(
      p.designs.find((d) => d.id === (p.approvedDesignId || selected)) || null,
    ),
    [view, setView] = useState('3d');
  useEffect(() => {
    const d = p.designs.find((d) => d.id === selected) || p.designs[0];
    if (d) setDraft(d);
  }, [p.designs, selected]);
  const site = p.sites.find((s) => s.id === p.selectedSiteId);
  if (!site)
    return (
      <section className="panel stage-empty">
        <MapPin />
        <h2>Every great concept needs a place.</h2>
        <p>Choose a candidate in Discover to generate a site-specific design.</p>
        <Button onClick={onDiscover}>
          Find a site <ArrowRight size={16} />
        </Button>
      </section>
    );
  const d = draft || p.designs[0],
    metrics = d ? designMetrics(d, site, p.type) : null,
    f = d ? finances(p.type, p.requirements, site, d) : null,
    dirty = d ? JSON.stringify(d) !== JSON.stringify(p.designs.find((x) => x.id === d.id)) : false,
    locked = !!p.approvedDesignId;
  async function save() {
    if (d) return await mutate({ action: 'save-design', design: d });
    return null;
  }
  async function approve() {
    if (!d) return;
    if (dirty && !(await save())) return;
    if (await mutate({ action: 'approve', designId: d.id })) onContinue();
  }
  return (
    <div className="design-layout">
      <div className="selected-site-strip">
        <div>
          <MapPin size={18} />
          <span>
            <small>YOUR SELECTED SITE</small>
            <b>{site.name}</b>
          </span>
          <span>
            {site.width} × {site.depth} m · {((site.width * site.depth) / 10000).toFixed(2)} ha
          </span>
        </div>
        <button onClick={onDiscover}>
          Revisit site decision <ArrowUpRightIcon />
        </button>
      </div>
      {!p.designs.length ? (
        <section className="panel stage-empty design-generate">
          <div className="generate-icon">
            <Box />
            <Sparkles />
          </div>
          <div className="eyebrow">FROM BRIEF TO BUILT FORM</div>
          <h2>One site. Three ways forward.</h2>
          <p>
            Generate a balanced concept, a capacity-focused alternative, and a more efficient
            footprint. Every option responds to your site dimensions and development brief.
          </p>
          <div className="generate-facts">
            <span>
              <Layers /> {p.requirements.floors} floors
            </span>
            <span>
              <Box /> {number(p.requirements.capacity)} target capacity
            </span>
            <span>
              <Leaf /> Conceptual green space
            </span>
          </div>
          <Button disabled={busy} onClick={() => void mutate({ action: 'generate' })}>
            <Sparkles size={17} /> Generate concepts
          </Button>
          <small>
            Conceptual massing and planning estimates. Professional design review required.
          </small>
        </section>
      ) : (
        d &&
        metrics &&
        f && (
          <>
            <div className="design-alternatives">
              {p.designs.map((alt, i) => {
                const m = designMetrics(alt, site, p.type),
                  fin = finances(p.type, p.requirements, site, alt);
                return (
                  <button
                    key={alt.id}
                    className={`alternative-card ${d.id === alt.id ? 'active' : ''}`}
                    onClick={() => setSelected(alt.id)}
                    disabled={locked && p.approvedDesignId !== alt.id}
                  >
                    <div className="alternative-top">
                      <span>CONCEPT 0{i + 1}</span>
                      {p.approvedDesignId === alt.id ? (
                        <span>
                          <CheckCircle2 size={13} /> APPROVED
                        </span>
                      ) : d.id === alt.id ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <Box size={16} />
                      )}
                    </div>
                    <h3>{alt.name}</h3>
                    <p>{alt.strategy}</p>
                    <div className="alternative-metrics">
                      <span>
                        <small>FLOOR AREA</small>
                        <b>{number(m.gfa)} m²</b>
                      </span>
                      <span>
                        <small>DEVELOPMENT</small>
                        <b>{money(m.cost)}</b>
                      </span>
                      <span>
                        <small>YIELD</small>
                        <b>{p.type === 'park' ? 'Public value' : `${fin.yield.toFixed(1)}%`}</b>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="design-workbench">
              <section className="panel model-panel">
                <div className="model-toolbar">
                  <div>
                    <Box size={17} />
                    <b>{d.name}</b>
                    <span className="badge">{dirty ? 'UNSAVED CHANGES' : 'SAVED CONCEPT'}</span>
                  </div>
                  <div className="segmented">
                    <button onClick={() => setView('3d')} className={view === '3d' ? 'active' : ''}>
                      3D perspective
                    </button>
                    <button onClick={() => setView('2d')} className={view === '2d' ? 'active' : ''}>
                      2D site plan
                    </button>
                  </div>
                </div>
                {view === '3d' ? (
                  <Scene design={d} site={site} park={p.type === 'park'} />
                ) : (
                  <SitePlan design={d} site={site} park={p.type === 'park'} />
                )}
                <div className="model-footer">
                  <span>Illustrative site boundary · No surveyed terrain</span>
                  <span>
                    {d.width} × {d.depth} m · {d.floors} floors
                  </span>
                </div>
              </section>
              <aside className="panel design-controls">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">MAKE IT YOURS</div>
                    <h3>Shape the concept.</h3>
                  </div>
                  <SettingsIcon />
                </div>
                <fieldset disabled={locked || busy}>
                  {[
                    {
                      key: 'width',
                      label: 'Building width',
                      min: 4,
                      max: site.width,
                      unit: 'm',
                      step: 1,
                    },
                    {
                      key: 'depth',
                      label: 'Building depth',
                      min: 4,
                      max: site.depth,
                      unit: 'm',
                      step: 1,
                    },
                    {
                      key: 'floors',
                      label: 'Floors',
                      min: 1,
                      max: p.type === 'park' ? 3 : 40,
                      unit: '',
                      step: 1,
                    },
                    {
                      key: 'green',
                      label: 'Landscape allocation',
                      min: 0,
                      max: 90,
                      unit: '%',
                      step: 1,
                    },
                    {
                      key: 'parking',
                      label: 'Parking spaces',
                      min: 0,
                      max: Math.min(500, Math.floor((site.width * site.depth) / 30)),
                      unit: '',
                      step: 1,
                    },
                    {
                      key: 'setback',
                      label: 'Assumed setback',
                      min: 0,
                      max: 60,
                      unit: 'm',
                      step: 1,
                    },
                  ].map((c) => (
                    <label className="design-slider" key={c.key}>
                      <span>
                        {c.label}
                        <span>
                          <input
                            aria-label={c.label}
                            type="number"
                            min={c.min}
                            max={c.max}
                            step={c.step}
                            value={d[c.key as keyof Design]}
                            onChange={(e) => setDraft({ ...d, [c.key]: +e.target.value })}
                          />
                          {c.unit}
                        </span>
                      </span>
                      <input
                        aria-label={`${c.label} slider`}
                        type="range"
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        value={d[c.key as keyof Design]}
                        onChange={(e) => setDraft({ ...d, [c.key]: +e.target.value })}
                      />
                    </label>
                  ))}
                  <Button
                    className="full-width"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft({ ...d, rotation: d.rotation === 0 ? 90 : 0 })}
                  >
                    <RotateCw size={14} /> Rotate footprint {d.rotation}°
                  </Button>
                </fieldset>
                <div className="control-actions">
                  {locked ? (
                    <div className="approved-note">
                      <CheckCircle2 size={19} />
                      <span>
                        Concept approved<small>Reselect your site to start a revision.</small>
                      </span>
                    </div>
                  ) : (
                    <Button
                      className="full-width"
                      variant="outline"
                      disabled={busy || !dirty}
                      onClick={() => void save()}
                    >
                      <Save size={16} /> Save concept
                    </Button>
                  )}
                  <Button
                    className="full-width"
                    disabled={busy || metrics.warnings.length > 0}
                    onClick={() => (locked ? onContinue() : void approve())}
                  >
                    {locked ? 'Open HAVEN twin' : 'Approve & plan protection'}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </aside>
            </div>
            {metrics.warnings.map((w) => (
              <div className="notice warning" key={w}>
                {w}
              </div>
            ))}
            <section className="panel design-summary">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">EVERY CHANGE, CONNECTED</div>
                  <h2>The concept at a glance.</h2>
                </div>
                <span className="badge">UPDATES WITH YOUR GEOMETRY</span>
              </div>
              <div className="finance-stat-grid">
                <Stat label="Gross floor area" value={`${number(metrics.gfa)} m²`} />
                <Stat label="Site coverage" value={`${metrics.coverage.toFixed(1)}%`} />
                <Stat label="Landscape area" value={`${number(metrics.greenArea)} m²`} />
                <Stat
                  label={p.type === 'data-center' ? 'Concept capacity (MW)' : 'Concept capacity'}
                  value={number(metrics.capacity)}
                />
                <Stat label="Development estimate" value={money(metrics.cost)} />
                <Stat
                  label="Budget headroom"
                  value={money(f.budgetGap)}
                  warning={f.budgetGap < 0}
                />
              </div>
              <p className="small-note">
                Massing uses 3.5 m per floor. Residential area assumes 34 m²/bed; data centers
                assume 230 m²/MW with equipment allowance; commercial area converts m² to sq ft.
                Parking assumes 30 m²/space and access roads reserve 10% of the site. No structural,
                zoning, utility or life-safety approval is implied.
              </p>
            </section>
          </>
        )
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M7 17L17 7M7 7h10v10" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
    </svg>
  );
}
