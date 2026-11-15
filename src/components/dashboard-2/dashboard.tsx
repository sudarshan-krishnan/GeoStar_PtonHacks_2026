'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { type Module, PrimaryCard, Sidebar, StepNavigation, type Status } from './shell';
import { DesignModule, ProtectModule } from './protection-workspace';
import { useProtection } from './use-protection';
import { DescribePreview, FinalizePreview, PickPreview } from './locate-preview';
import { sampleProjectTypes, sampleSites, type PreviewProjectType } from './sample-data';
import { DeployedProjects, ProjectCommandCenter } from './deployed-projects';
import { DroneDiscover } from './drone-discover';
import type { Facility } from '@/lib/haven/engine';

// Locate remains an independent UI preview. Design/Protect share a persisted simulation workspace.
// Journey progress is kept in this browser so a reload never drops the check marks.
const PROGRESS_KEY = 'afterlight.d2.progress.v1';
const STATUS_KEY = 'afterlight.d2.status.v1';
type Known = { modelAccepted: boolean; configured: boolean; deployed: boolean };
function readStore<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode). Progress then lasts for this visit only.
  }
}

export function DashboardTwo() {
  const [module, setModule] = useState<Module>('locate');
  const [step, setStep] = useState(0);
  const [designStep, setDesignStep] = useState(0);
  // Deploy shows the current project's Command Center, the Deployed Projects list, or another project.
  const [deployView, setDeployView] = useState<'current' | 'projects' | Facility>('current');
  const [protectStart, setProtectStart] = useState<number | undefined>();
  const [type, setType] = useState<PreviewProjectType>('data-center');
  const [brief, setBrief] = useState<string>(sampleProjectTypes[0].brief);
  const [city, setCity] = useState('Houston, Texas');
  const [selectedId, setSelectedId] = useState<string>(sampleSites[0].id);
  const [completed, setCompleted] = useState([false, false, false]);
  const [hydrated, setHydrated] = useState(false);
  const [knownStatus, setKnownStatus] = useState<Record<string, Known>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const selected = sampleSites.find((site) => site.id === selectedId) || sampleSites[0];
  const projectType = sampleProjectTypes.find((project) => project.id === type)!;
  const facility = {
    id: `d2-${selected.id}-${type}-${city
      .split(',')[0]
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')}`,
    name: selected.name,
    city,
    type: projectType.label,
  };
  const protection = useProtection(facility, module !== 'locate' && completed[2]);
  // Locate makes no API calls, so it shows the last known status of this project until it loads.
  const known: Known = protection.loaded
    ? protection.state
    : knownStatus[facility.id] || { modelAccepted: false, configured: false, deployed: false };
  const currentDeployed = completed[2] && known.deployed;

  useEffect(() => {
    const saved = readStore<{
      module: Module;
      step: number;
      designStep: number;
      deployView: 'current' | 'projects';
      type: PreviewProjectType;
      brief: string;
      city: string;
      selectedId: string;
      completed: boolean[];
    }>(PROGRESS_KEY);
    if (saved && sampleProjectTypes.some((t) => t.id === saved.type)) {
      setModule(saved.module);
      setStep(saved.step);
      setDesignStep(saved.designStep);
      setDeployView(saved.deployView);
      setType(saved.type);
      setBrief(saved.brief);
      setCity(saved.city);
      if (sampleSites.some((site) => site.id === saved.selectedId)) setSelectedId(saved.selectedId);
      setCompleted(saved.completed);
    }
    setKnownStatus(readStore<Record<string, Known>>(STATUS_KEY) || {});
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    writeStore(PROGRESS_KEY, {
      module,
      step,
      designStep,
      deployView: typeof deployView === 'object' ? 'projects' : deployView,
      type,
      brief,
      city,
      selectedId,
      completed,
    });
  }, [hydrated, module, step, designStep, deployView, type, brief, city, selectedId, completed]);
  const { modelAccepted, configured, deployed } = protection.state;
  useEffect(() => {
    if (!hydrated || !protection.loaded) return;
    setKnownStatus((current) => {
      const previous = current[facility.id];
      if (
        previous?.modelAccepted === modelAccepted &&
        previous.configured === configured &&
        previous.deployed === deployed
      )
        return current;
      const next = { ...current, [facility.id]: { modelAccepted, configured, deployed } };
      writeStore(STATUS_KEY, next);
      return next;
    });
  }, [hydrated, protection.loaded, facility.id, modelAccepted, configured, deployed]);

  // Changing the place, type or city makes a different project, so Locate needs confirming again.
  function changeChoice(apply: () => void) {
    apply();
    setCompleted((current) => [current[0], current[1], false]);
  }
  const showingOtherDeployView = module === 'deploy' && (deployView !== 'current' || !completed[2]);

  function selectModule(next: Module) {
    if (next === 'deploy') setDeployView(completed[2] ? 'current' : 'projects');
    setModule(next);
  }
  function openCommandCenter() {
    setProtectStart(undefined);
    setDeployView('current');
    setModule('deploy');
  }
  function openProject(project: Facility) {
    setDeployView(project.id === facility.id ? 'current' : project);
  }

  useEffect(() => {
    if (!firstRender.current) {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    firstRender.current = false;
  }, [module, step, designStep, deployView]);

  function advance(index: number) {
    setCompleted((current) => current.map((done, i) => i === index || done));
    if (index < 2) setStep(index + 1);
  }

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    try {
      await fetch(`/api/protection/${facility.id}`, { method: 'DELETE' });
    } catch {
      // The local preview still resets. The saved project can be reset again later.
    }
    protection.forget();
    setKnownStatus((current) => {
      const next = { ...current };
      delete next[facility.id];
      writeStore(STATUS_KEY, next);
      return next;
    });
    setModule('locate');
    setStep(0);
    setDesignStep(0);
    setDeployView('current');
    setProtectStart(undefined);
    setType('data-center');
    setBrief(sampleProjectTypes[0].brief);
    setCity('Houston, Texas');
    setSelectedId(sampleSites[0].id);
    setCompleted([false, false, false]);
  }

  // Each screen gets its own key so the workspace plays the glass page transition on every move.
  const viewKey = `${module}:${module === 'locate' ? step : module === 'design' ? designStep : typeof deployView === 'object' ? deployView.id : deployView}`;

  return (
    <div className="d2-shell sb" style={hydrated ? undefined : { visibility: 'hidden' }}>
      <div className="sb-ambient" aria-hidden="true"></div>
      <Sidebar
        active={module}
        complete={completed[2]}
        onSelect={selectModule}
        statuses={
          {
            locate: completed[2] ? 'completed' : 'active',
            design:
              completed[2] && known.modelAccepted
                ? 'completed'
                : module === 'design'
                  ? 'active'
                  : 'pending',
            protect:
              completed[2] && known.deployed
                ? 'completed'
                : (completed[2] && known.configured) || module === 'protect'
                  ? 'active'
                  : 'pending',
            deploy: currentDeployed ? 'completed' : module === 'deploy' ? 'active' : 'pending',
          } satisfies Record<Module, Status>
        }
      >
        <div className="d2-preview-project">
          <span className="d2-overline">YOUR CONCEPT</span>
          <b>
            <projectType.icon size={16} />
            {projectType.label}
          </b>
          <span>{city}</span>
        </div>
        <button
          className={`d2-new-project ${confirmReset ? 'is-confirming' : ''}`}
          onClick={() => void reset()}
          onBlur={() => setConfirmReset(false)}
          title="Clears this preview and the project's saved HAVEN setup"
        >
          <Plus size={15} /> {confirmReset ? 'Tap again to start over' : 'Reset preview'}
        </button>
      </Sidebar>
      <main className="d2-workspace" id="d2-main">
        <header className="d2-topline">
          <span>
            Workspace <span>/</span>
            <b>{module[0].toUpperCase() + module.slice(1)}</b>
          </span>
          <span className="d2-edition">
            <span>
              {module === 'locate'
                ? 'Sample sites'
                : module === 'deploy'
                  ? 'HAVEN · Command center'
                  : 'HAVEN · Simulation'}
            </span>
          </span>
        </header>
        {module === 'locate' ? (
          <StepNavigation step={step} completed={completed} onSelect={setStep} busy={false} />
        ) : module === 'design' ? (
          <StepNavigation
            step={designStep}
            completed={[
              designStep > 0 || protection.state.modelAccepted,
              protection.state.modelAccepted,
            ]}
            onSelect={setDesignStep}
            busy={protection.busy}
            names={['Discover', 'Model']}
            label="Design"
            linear={false}
          />
        ) : null}
        {module !== 'locate' && !showingOtherDeployView && protection.error && (
          <div className="hv-save-error" role="alert">
            <span>{protection.error} Changes have not been saved.</span>
            <button onClick={() => void protection.reload()}>Reload workspace</button>
          </div>
        )}
        <div className="sb-view" key={viewKey}>
          {showingOtherDeployView ? (
            typeof deployView === 'object' ? (
              <ProjectCommandCenter
                key={deployView.id}
                facility={deployView}
                onBack={() => setDeployView('projects')}
              />
            ) : (
              <DeployedProjects
                current={facility}
                currentDeployed={currentDeployed}
                onOpen={openProject}
                onFinishCurrent={() => setModule(completed[2] ? 'protect' : 'locate')}
              />
            )
          ) : module !== 'locate' ? (
            !completed[2] ? (
              <PrimaryCard className="hv-prerequisite">
                <MapPin size={42} />
                <h1>First, find its place.</h1>
                <p>Finish Locate to carry your selected facility into Design and Protect.</p>
                <button className="d2-button" onClick={() => setModule('locate')}>
                  Return to Locate
                </button>
              </PrimaryCard>
            ) : protection.loading ? (
              <PrimaryCard>
                <div className="hv-model-loading" role="status">
                  Loading the facility’s protection workspace…
                </div>
              </PrimaryCard>
            ) : module === 'design' ? (
              designStep === 0 ? (
                <DroneDiscover
                  facility={protection.state.facility}
                  onContinue={() => setDesignStep(1)}
                />
              ) : (
                <DesignModule
                  state={protection.state}
                  busy={protection.busy}
                  act={protection.act}
                  onProtect={() => setModule('protect')}
                />
              )
            ) : module === 'deploy' ? (
              protection.state.deployed ? (
                <ProtectModule
                  key={`${facility.id}-live`}
                  state={protection.state}
                  busy={protection.busy}
                  act={protection.act}
                  onDesign={() => setModule('design')}
                  live
                  onBack={() => setDeployView('projects')}
                  onEdit={() => {
                    setProtectStart(0);
                    setModule('protect');
                  }}
                />
              ) : (
                <DeployedProjects
                  current={facility}
                  currentDeployed={false}
                  onOpen={openProject}
                  onFinishCurrent={() => setModule('protect')}
                />
              )
            ) : (
              <ProtectModule
                key={facility.id}
                state={protection.state}
                busy={protection.busy}
                act={protection.act}
                onDesign={() => setModule('design')}
                initialStep={protectStart}
                onDeployed={openCommandCenter}
                onOpenCommand={openCommandCenter}
              />
            )
          ) : (
            <>
              {step === 0 && (
                <DescribePreview
                  type={type}
                  setType={(next) => next !== type && changeChoice(() => setType(next))}
                  brief={brief}
                  setBrief={setBrief}
                  city={city}
                  setCity={(next) => next !== city && changeChoice(() => setCity(next))}
                  onContinue={() => advance(0)}
                  headingRef={heading}
                />
              )}
              {step === 1 && (
                <PickPreview
                  selected={selected}
                  onSelect={(id) => id !== selectedId && changeChoice(() => setSelectedId(id))}
                  city={city}
                  onContinue={() => advance(1)}
                  headingRef={heading}
                />
              )}
              {step === 2 && (
                <FinalizePreview
                  site={selected}
                  city={city}
                  projectLabel={projectType.label}
                  complete={completed[2]}
                  onBack={() => setStep(1)}
                  onConfirm={() => advance(2)}
                  onDesign={() => setModule('design')}
                  headingRef={heading}
                />
              )}
              {step !== 1 && (
                <div className="d2-support">
                  <div>
                    <span className="d2-support-icon">
                      <MapPin size={18} />
                    </span>
                    <b>A place with purpose.</b>
                    <p>Great possibilities start with a thoughtful location.</p>
                  </div>
                  <div>
                    <span className="d2-support-icon">
                      <Sparkles size={18} />
                    </span>
                    <b>See the bigger picture.</b>
                    <p>Money, people, and planet. Room for all three.</p>
                  </div>
                  <div>
                    <span className="d2-support-icon">
                      <ShieldCheck size={18} />
                    </span>
                    <b>One connected journey.</b>
                    <p>From the first idea to what comes next.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="d2-footer">
          <span>
            GeoStar <i /> Find it. Design it. Protect it.
          </span>
          <span>
            {module === 'locate'
              ? 'Sample locations and fixed scores'
              : 'Simulation only · local workspace'}
          </span>
        </footer>
      </main>
    </div>
  );
}
