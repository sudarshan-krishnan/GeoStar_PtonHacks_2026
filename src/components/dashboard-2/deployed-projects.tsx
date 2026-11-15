'use client';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Cpu,
  GraduationCap,
  LayoutGrid,
  Radio,
  Store,
  Sun,
  Trees,
  Wind,
} from 'lucide-react';
import type { Facility } from '@/lib/haven/engine';
import type { DeployedProject } from '@/lib/haven/portfolio';
import { PrimaryCard } from './shell';
import { ProtectModule } from './protection-workspace';
import { useProtection } from './use-protection';

const typeIcon = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes('solar')) return Sun;
  if (t.includes('wind')) return Wind;
  if (t.includes('data')) return Cpu;
  if (t.includes('campus')) return GraduationCap;
  if (t.includes('park')) return Trees;
  if (t.includes('commercial')) return Store;
  return Building2;
};
const healthClass = (health: DeployedProject['health']) =>
  health === 'Critical incident' ? 'critical' : health.toLowerCase();
const attention = { 'Critical incident': 0, Warning: 1, Recovering: 2, Healthy: 3 } as const;

function useDeployedProjects() {
  const [projects, setProjects] = useState<DeployedProject[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/protection', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Cannot load deployed projects.');
        if (active) setProjects(data.projects);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);
  return { projects, error };
}

export function DeployedProjects({
  current,
  currentDeployed,
  onOpen,
  onFinishCurrent,
}: {
  current: Facility;
  currentDeployed: boolean;
  onOpen: (facility: Facility) => void;
  onFinishCurrent: () => void;
}) {
  const { projects, error } = useDeployedProjects();
  const [filter, setFilter] = useState('All');
  const list = (projects || [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.facility.id === current.id) - Number(a.facility.id === current.id) ||
        attention[a.health] - attention[b.health],
    );
  const types = ['All', ...new Set(list.map((p) => p.facility.type))];
  const shown = filter === 'All' ? list : list.filter((p) => p.facility.type === filter);
  const live = list.filter((p) => p.deployed);
  const count = (h: DeployedProject['health']) => live.filter((p) => p.health === h).length;
  const summary = [
    { name: 'Live projects', value: live.length, tone: '' },
    { name: 'Healthy', value: count('Healthy'), tone: '' },
    {
      name: 'Needs attention',
      value: count('Warning') + count('Critical incident'),
      tone: 'is-warning',
    },
    { name: 'Recovering', value: count('Recovering'), tone: '' },
  ];

  return (
    <>
      <div className="hv-command-bar">
        <div>
          <LayoutGrid size={19} />
          <span>
            DEPLOYED PROJECTS
            <small>
              {projects ? `${live.length} live · ${list.length} total` : 'Loading projects…'}
            </small>
          </span>
        </div>
        <span className="hv-mode">
          <Radio size={12} /> SIMULATION MODE
        </span>
      </div>
      <div className="hv-live-heading">
        <div>
          <span className="d2-overline">EVERYTHING YOU’VE BUILT</span>
          <h1>Every project, in one view.</h1>
          <p>Open any project to see its own Command Center, readings and incidents.</p>
        </div>
      </div>
      <div className="hv-metrics dp-summary">
        {summary.map(({ name, value, tone }) => (
          <div key={name} className={`hv-metric ${tone && value ? tone : ''}`}>
            <span>{name}</span>
            <b>{projects ? value : '–'}</b>
          </div>
        ))}
      </div>
      {!currentDeployed && (
        <div className="hv-inline-alert dp-current-note">
          <span>
            <b>{current.name}</b> is not deployed yet. Finish Protect and confirm deploy to add it
            here.
          </span>
          <button className="d2-back" onClick={onFinishCurrent}>
            Continue setup <ArrowRight size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="hv-save-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {projects && (
        <div className="dp-filters" role="group" aria-label="Filter by project type">
          {types.map((type) => (
            <button
              key={type}
              aria-pressed={filter === type}
              className={filter === type ? 'is-active' : ''}
              onClick={() => setFilter(type)}
            >
              {type}
            </button>
          ))}
        </div>
      )}
      {!projects && !error ? (
        <PrimaryCard>
          <div className="hv-model-loading" role="status">
            Loading deployed projects…
          </div>
        </PrimaryCard>
      ) : (
        <ul className="dp-grid" aria-label="Deployed projects">
          {shown.map((project) => {
            const Icon = typeIcon(project.facility.type);
            const isCurrent = project.facility.id === current.id;
            return (
              <li key={project.facility.id}>
                <button className="dp-card" onClick={() => onOpen(project.facility)}>
                  <span className="dp-card-top">
                    <span className="dp-icon">
                      <Icon size={18} strokeWidth={1.7} />
                    </span>
                    <span
                      className={`dp-status ${project.deployed ? healthClass(project.health) : 'paused'}`}
                    >
                      <i />
                      {project.deployed ? project.health : 'Paused for edits'}
                    </span>
                  </span>
                  <b className="dp-name">{project.facility.name}</b>
                  <span className="dp-meta">
                    {project.facility.type} · {project.facility.city}
                  </span>
                  <span className="dp-readings">
                    <span>
                      Power
                      <b>
                        {project.readings.electricity === null
                          ? 'Off'
                          : `${project.readings.electricity} kW`}
                      </b>
                      <LoadMeter
                        value={project.readings.electricity}
                        limit={project.limits?.electricity}
                      />
                    </span>
                    <span>
                      Water
                      <b>
                        {project.readings.waterUsage === null
                          ? 'Off'
                          : `${project.readings.waterUsage} L/min`}
                      </b>
                      <LoadMeter
                        value={project.readings.waterUsage}
                        limit={project.limits?.waterUsage}
                      />
                    </span>
                    <span>
                      Incidents
                      <b>{project.activeIncidents}</b>
                    </span>
                  </span>
                  <span className="dp-card-foot">
                    <span className="d2-sample-tag">
                      {isCurrent
                        ? 'Current project'
                        : project.sample
                          ? 'Sample project'
                          : 'Your project'}
                    </span>
                    <span className="dp-open">
                      Open Command Center <ArrowRight size={13} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hv-note">
        Readings are simulated unless the physical model is connected to a project; deploying a
        project connects it. Sample projects are illustrative fixtures that run the same HAVEN rules
        as your own project, each with its own saved state.
      </p>
    </>
  );
}

// Any deployed project's Command Center, backed by its own persisted workspace.
export function ProjectCommandCenter({
  facility,
  onBack,
}: {
  facility: Facility;
  onBack: () => void;
}) {
  const protection = useProtection(facility, true);
  return (
    <>
      {protection.error && (
        <div className="hv-save-error" role="alert">
          <span>{protection.error} Changes have not been saved.</span>
          <button onClick={() => void protection.reload()}>Reload workspace</button>
        </div>
      )}
      {protection.loading ? (
        <PrimaryCard>
          <div className="hv-model-loading" role="status">
            Loading {facility.name}’s Command Center…
          </div>
        </PrimaryCard>
      ) : (
        <ProtectModule
          key={facility.id}
          state={protection.state}
          busy={protection.busy}
          act={protection.act}
          onDesign={onBack}
          live
          onBack={onBack}
        />
      )}
    </>
  );
}

/** Reading against its alert limit; amber when close, red past it. */
function LoadMeter({ value, limit }: { value: number | null; limit?: number }) {
  if (value === null || !limit) return <span className="sb-meter is-off" aria-hidden="true" />;
  const ratio = value / limit;
  return (
    <span
      className={`sb-meter ${ratio >= 1 ? 'is-over' : ratio >= 0.8 ? 'is-near' : ''}`}
      title={`${Math.round(ratio * 100)}% of the ${limit} limit`}
      aria-hidden="true"
    >
      <i style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
    </span>
  );
}
