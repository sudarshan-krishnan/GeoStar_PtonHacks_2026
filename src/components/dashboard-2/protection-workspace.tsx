'use client';
import { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Droplets,
  Flame,
  Leaf,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Waves,
  Zap,
} from 'lucide-react';
import {
  databotPlacements,
  evacuationPlans,
  monitoringPoints,
  MODEL_NAME,
  placementIds,
  type PlacementId,
  type PlanId,
} from '@/lib/haven/config';
import {
  activeIncidents,
  effectivePlan,
  routeAvailability,
  type ProtectionAction,
  type ProtectionState,
  type Protections,
} from '@/lib/haven/engine';
import { PrimaryCard, StepNavigation } from './shell';
import { FacilityTwin } from './facility-twin';
import { LiveHardware } from './live-hardware';
import {
  BuildingOverview,
  IncidentCommand,
  ResponseCoordination,
  StatusStrip,
} from './incident-command';

type Act = (action: ProtectionAction) => Promise<ProtectionState | null>;
// Alerts in the order people think about them: hazards first, then usage limits.
const definitions = [
  {
    id: 'leak',
    name: 'Water Leak',
    detail: 'Moisture sensors catch water where it should not be.',
    trigger: 'Any moisture detected',
    icon: Droplets,
  },
  {
    id: 'fire',
    name: 'Fire Detected',
    detail: 'Smoke and heat sensors watch both operations corridors.',
    trigger: 'Any smoke or heat alarm',
    icon: Flame,
  },
  {
    id: 'waterUsage',
    name: 'Water Usage Limit Reached',
    detail: 'Know when water flow climbs past the limit you set.',
    icon: Waves,
    unit: 'L/min',
    input: 'Water usage threshold',
  },
  {
    id: 'electricity',
    name: 'Electricity Usage Limit Reached',
    detail: 'Know when power demand climbs past the limit you set.',
    icon: Zap,
    unit: 'kW',
    input: 'Electricity threshold',
  },
] as const;
export function DesignModule({
  state,
  busy,
  act,
  onProtect,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
  onProtect: () => void;
}) {
  return (
    <>
      <PrimaryCard className="hv-design">
        <div className="d2-card-top">
          <span className="d2-kicker">
            <span /> GIVE YOUR VISION A SHAPE
          </span>
          <span className="hv-mode">
            <Box size={12} /> SAMPLE MODEL
          </span>
        </div>
        <h1>A clearer view of{'\n'}what comes next.</h1>
        <p className="d2-lede">
          {state.facility.name} · {state.facility.city}
          <br />A representative HAVEN model, ready to explore and protect.
        </p>
        <div className="hv-model-title">
          <div>
            <b>{MODEL_NAME}</b>
            <span>Reused HAVEN geometry · six levels · orbit, zoom and inspect</span>
          </div>
          <span className="d2-sample-tag">Representative geometry</span>
        </div>
        <FacilityTwin state={state} />
        <div className="hv-design-details">
          <div>
            <span>FACILITY</span>
            <b>{state.facility.name}</b>
          </div>
          <div>
            <span>MODEL</span>
            <b>Six-level cutaway</b>
          </div>
          <div>
            <span>MONITORING PLAN</span>
            <b>Level 4 operations</b>
          </div>
        </div>
        <p className="hv-note">
          This sample is not a generated design for the selected parcel. The same model and facility
          identity carry into Protect. Configured routes use stairs and are not step-free.
        </p>
        <div className="d2-form-footer">
          <span>
            <Leaf size={15} />{' '}
            {state.modelAccepted ? 'Model selection saved' : 'One facility. One connected twin.'}
          </span>
          <button
            className="d2-button"
            disabled={busy}
            onClick={async () => {
              if (state.modelAccepted || (await act({ action: 'accept-model' }))) onProtect();
            }}
          >
            {busy
              ? 'Saving model…'
              : state.modelAccepted
                ? 'Continue to Protect'
                : 'Use this model'}
            <ArrowRight size={16} />
          </button>
        </div>
      </PrimaryCard>
    </>
  );
}
function SimulationControls({
  state,
  act,
  busy,
}: {
  state: ProtectionState;
  act: Act;
  busy: boolean;
}) {
  return (
    <div className="hv-demo-controls" aria-label="Demo incident controls">
      <span>
        <Radio size={13} /> SIMULATION CONTROLS
      </span>
      <div>
        <button
          disabled={busy || !state.config.leak.enabled}
          onClick={() => void act({ action: 'trigger', kind: 'leak' })}
        >
          <Droplets size={15} /> Trigger Water Leak
        </button>
        <button
          className="hv-fire-trigger"
          disabled={busy || !state.config.fire.enabled}
          onClick={() => void act({ action: 'trigger', kind: 'fire' })}
        >
          <Flame size={15} /> Trigger Fire
        </button>
        <button
          disabled={busy || (!state.config.electricity.enabled && !state.config.waterUsage.enabled)}
          onClick={() => void act({ action: 'trigger', kind: 'usage' })}
        >
          <Zap size={15} /> Usage spike
        </button>
        <button disabled={busy} onClick={() => void act({ action: 'reset' })}>
          <RotateCcw size={14} /> Reset Simulation
        </button>
      </div>
    </div>
  );
}
function RouteSummary({ state }: { state: ProtectionState }) {
  const available = routeAvailability(state),
    plan = effectivePlan(state);
  return (
    <div className="hv-route-summary">
      <div>
        <ShieldCheck size={17} />
        <span>
          <b>
            {plan
              ? `${evacuationPlans[plan].name} · scenario-clear`
              : 'No available configured route'}
          </b>
          <small>
            {plan
              ? evacuationPlans[plan].description
              : 'Request on-site assistance. No route can be recommended by this scenario.'}
          </small>
        </span>
      </div>
      <div className="hv-exit-chips">
        {Object.entries(evacuationPlans).map(([id, exit]) => (
          <span key={id} className={available[id as PlanId] ? 'is-clear' : 'is-blocked'}>
            {available[id as PlanId] ? <Check size={11} /> : <Flame size={11} />}
            {exit.name} · {available[id as PlanId] ? 'available in demo' : 'blocked in demo'}
          </span>
        ))}
      </div>
      <p>
        Predefined simulation routes only · stairs are not step-free · no real-world safety
        verification
      </p>
    </div>
  );
}
function IncidentSummary({
  state,
  act,
  busy,
}: {
  state: ProtectionState;
  act: Act;
  busy: boolean;
}) {
  const incidents = activeIncidents(state);
  return (
    <div className="hv-incidents">
      <div className="hv-section-heading">
        <h2>Active incidents</h2>
        <span>{incidents.length}</span>
      </div>
      {incidents.length ? (
        incidents.map((incident) => (
          <article className={`hv-incident ${incident.severity}`} key={incident.id}>
            <div>
              <span>
                {incident.kind === 'fire' ? (
                  <Flame size={16} />
                ) : incident.kind === 'leak' ? (
                  <Droplets size={16} />
                ) : (
                  <Activity size={16} />
                )}
              </span>
              <div>
                <h3>{incident.name}</h3>
                <small>{incident.zone} · Simulated</small>
              </div>
            </div>
            <p>{incident.message}</p>
            <p className="hv-response">{incident.recommendation}</p>
            <footer>
              <span>
                {incident.status === 'acknowledged'
                  ? 'Acknowledged · hazard remains active'
                  : 'Awaiting acknowledgement'}
              </span>
              {incident.status === 'active' && (
                <button
                  disabled={busy}
                  onClick={() => void act({ action: 'acknowledge', incidentId: incident.id })}
                >
                  Acknowledge <Check size={12} />
                </button>
              )}
            </footer>
          </article>
        ))
      ) : (
        <div className="hv-empty-state">
          <CheckCircle2 size={24} />
          <b>No active incidents</b>
          <p>All enabled simulated readings are within their configured limits.</p>
        </div>
      )}
    </div>
  );
}
function Timeline({ state }: { state: ProtectionState }) {
  return (
    <PrimaryCard className="hv-timeline">
      <div className="hv-section-heading">
        <div>
          <span className="d2-overline">HAVEN RESPONSE RULES</span>
          <h2>Every signal. A clear next step.</h2>
        </div>
        <span className="d2-sample-tag">Deterministic simulation</span>
      </div>
      <div className="hv-agent-strip">
        {['Building Monitor', 'Guardian', 'Maintenance', 'Security', 'Recovery'].map((role) => (
          <span key={role}>
            <i className={state.timeline.some((e) => e.agent === role) ? 'has-activity' : ''} />
            {role}
          </span>
        ))}
      </div>
      <ol>
        {state.timeline.slice(0, 12).map((event) => (
          <li key={event.id}>
            <span className="hv-timeline-dot" />
            <div>
              <b>{event.agent}</b>
              <p>{event.message}</p>
            </div>
            <time dateTime={event.at}>
              {new Date(event.at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </time>
          </li>
        ))}
      </ol>
      <p className="hv-note">
        Shared threshold and response rules run locally in GeoStar’s backend. External HAVEN
        uAgents, hardware, physical alarms and equipment controls are not connected.
      </p>
    </PrimaryCard>
  );
}
export function ProtectModule({
  state,
  busy,
  act,
  onDesign,
  live = false,
  initialStep,
  onBack,
  onDeployed,
  onEdit,
  onOpenCommand,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
  onDesign: () => void;
  /** Render the Command Center once deployed. Otherwise Protect points to Deploy. */
  live?: boolean;
  initialStep?: number;
  /** Back arrow at the top of the Command Center. */
  onBack?: () => void;
  onDeployed?: () => void;
  /** Called after "Edit protections" returns the facility to setup. Stays inline when absent. */
  onEdit?: () => void;
  onOpenCommand?: () => void;
}) {
  const [step, setStep] = useState(initialStep ?? (state.placed ? 1 : 0));
  const [placement, setPlacement] = useState<PlacementId>(state.placement || 'utility');
  const [deploying, setDeploying] = useState(false);
  const [draft, setDraft] = useState<Protections>(state.config);
  const [plan, setPlan] = useState<PlanId>(state.plan);
  const available = routeAvailability(state);
  const choice = available[plan] ? plan : effectivePlan(state) || 'north';
  const selectedAlerts = definitions.filter((d) => draft[d.id].enabled);
  const skippedAlerts = definitions.filter((d) => !draft[d.id].enabled);
  const anySelected = selectedAlerts.length > 0;
  const limitsValid = (['electricity', 'waterUsage'] as const).every(
    (id) => !draft[id].enabled || (draft[id].limit >= 1 && draft[id].limit <= 100000),
  );
  const coverage = monitoringPoints.filter((p) => draft[p.protection].enabled);
  // Nothing is saved until Confirm Deploy: thresholds, then placement and route, then deploy.
  async function confirmDeploy() {
    setDeploying(true);
    try {
      const configured = await act({ action: 'configure', config: draft });
      if (!configured) return;
      const route = routeAvailability(configured)[plan]
        ? plan
        : effectivePlan(configured) || 'north';
      if (!(await act({ action: 'place', plan: route, placement }))) return;
      if (await act({ action: 'deploy' })) onDeployed?.();
    } finally {
      setDeploying(false);
    }
  }
  async function edit() {
    const next = await act({ action: 'reconfigure' });
    if (!next) return;
    if (onEdit) return onEdit();
    setDraft(next.config);
    setStep(0);
  }
  if (!state.modelAccepted)
    return (
      <PrimaryCard className="hv-prerequisite">
        <Box size={42} />
        <h1>Start with your twin.</h1>
        <p>
          Choose the representative facility model in Design, then configure its protection plan.
        </p>
        <button className="d2-button" onClick={onDesign}>
          Open Design <ArrowRight size={15} />
        </button>
      </PrimaryCard>
    );
  if (state.deployed && !live)
    return (
      <PrimaryCard className="hv-prerequisite">
        <Radio size={42} />
        <h1>Live in its Command Center.</h1>
        <p>{state.facility.name} is deployed. Monitoring and incidents now run in Deploy.</p>
        <div className="hv-prerequisite-actions">
          <button className="d2-back" disabled={busy} onClick={edit}>
            <Settings2 size={15} /> Edit protections
          </button>
          <button className="d2-button" onClick={onOpenCommand}>
            Open Command Center <ArrowRight size={15} />
          </button>
        </div>
      </PrimaryCard>
    );
  if (state.deployed)
    return (
      <>
        <div className="hv-command-bar">
          <div>
            {onBack && (
              <button
                className="hv-command-back"
                onClick={onBack}
                aria-label="Back to deployed projects"
                title="Deployed projects"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <ShieldCheck size={19} />
            <span>
              HAVEN COMMAND CENTER<small>{state.facility.name}</small>
            </span>
          </div>
          <span className="hv-mode">
            <Radio size={12} /> SIMULATION MODE
          </span>
        </div>
        {/* Every deployed project: live readings when the physical model is connected to it,
            otherwise where the kit is and a button to connect it here. */}
        <LiveHardware facility={state.facility} />
        <div className="hv-live-heading">
          <div>
            <span className="d2-overline">CONNECTED TO YOUR VISION</span>
            <h1>Care, in every corner.</h1>
            <p>
              {state.facility.city} · {MODEL_NAME}
            </p>
          </div>
          <button className="d2-back" disabled={busy} onClick={edit}>
            <Settings2 size={15} /> Edit protections
          </button>
        </div>
        <StatusStrip state={state} busy={busy} act={act} />
        <div className="hv-metrics">
          <Metric
            icon={Zap}
            name="Electricity"
            value={state.config.electricity.enabled ? `${state.readings.electricity} kW` : 'Off'}
            detail={`Limit ${state.config.electricity.limit} kW`}
            ratio={
              state.config.electricity.enabled
                ? state.readings.electricity / state.config.electricity.limit
                : undefined
            }
            warning={
              state.config.electricity.enabled &&
              state.readings.electricity >= state.config.electricity.limit
            }
          />
          <Metric
            icon={Waves}
            name="Water usage"
            value={state.config.waterUsage.enabled ? `${state.readings.waterUsage} L/min` : 'Off'}
            detail={`Limit ${state.config.waterUsage.limit} L/min`}
            ratio={
              state.config.waterUsage.enabled
                ? state.readings.waterUsage / state.config.waterUsage.limit
                : undefined
            }
            warning={
              state.config.waterUsage.enabled &&
              state.readings.waterUsage >= state.config.waterUsage.limit
            }
          />
          <Metric
            icon={Droplets}
            name="Leak detection"
            value={
              state.config.leak.enabled
                ? activeIncidents(state).some((i) => i.kind === 'leak')
                  ? 'Leak detected'
                  : 'Clear'
                : 'Off'
            }
            detail="2 configured moisture points"
            warning={activeIncidents(state).some((i) => i.kind === 'leak')}
          />
          <Metric
            icon={Flame}
            name="Fire hazards"
            value={
              state.config.fire.enabled
                ? activeIncidents(state).some((i) => i.kind === 'fire')
                  ? 'Alarm active'
                  : 'Clear'
                : 'Off'
            }
            detail="2 configured smoke / heat points"
            warning={activeIncidents(state).some((i) => i.kind === 'fire')}
          />
        </div>
        <div className="hv-command-grid">
          <div className="sb-command-main">
            <BuildingOverview state={state}>
              <RouteSummary state={state} />
            </BuildingOverview>
            <ResponseCoordination state={state} busy={busy} act={act} />
            <Timeline state={state} />
          </div>
          <div className="sb-command-side">
            <IncidentCommand state={state} busy={busy} act={act}>
              <IncidentSummary state={state} act={act} busy={busy} />
            </IncidentCommand>
            <SimulationControls state={state} act={act} busy={busy} />
          </div>
        </div>
      </>
    );
  return (
    <>
      {onBack && (
        <button className="d2-back hv-setup-back" onClick={onBack}>
          <ArrowLeft size={15} /> Deployed projects
        </button>
      )}
      <StepNavigation
        step={step}
        completed={[(step > 0 || state.placed) && anySelected && limitsValid, state.deployed]}
        onSelect={setStep}
        busy={busy || deploying}
        names={['Select', 'Deploy']}
        label="Protect"
      />
      {step === 0 && (
        <PrimaryCard className="hv-select al-select">
          <div className="d2-card-top">
            <span className="d2-kicker">
              <span /> WHAT SHOULD HAVEN WATCH FOR?
            </span>
            <span className="d2-card-index">01 — 02</span>
          </div>
          <h1>Choose your alerts.</h1>
          <p className="d2-lede">
            Select every alert you want for {state.facility.name}. You can change them any time.
          </p>
          <div className="al-grid" role="group" aria-label="Monitoring alerts">
            {definitions.map((item) => {
              const Icon = item.icon;
              const config = draft[item.id];
              return (
                <div key={item.id} className={`al-card ${config.enabled ? 'is-selected' : ''}`}>
                  <label className="al-card-main">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      aria-label={item.name}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [item.id]: { ...config, enabled: e.target.checked },
                        })
                      }
                    />
                    <span className="al-icon">
                      <Icon size={20} strokeWidth={1.6} />
                    </span>
                    <span className="al-check" aria-hidden="true">
                      {config.enabled && <Check size={12} strokeWidth={3} />}
                    </span>
                    <b>{item.name}</b>
                    <small>{item.detail}</small>
                  </label>
                  {'unit' in item && (
                    <div className="al-limit">
                      <span>Alert above</span>
                      <span className="al-limit-field">
                        <input
                          type="number"
                          min="1"
                          max="100000"
                          disabled={!config.enabled}
                          aria-label={item.input}
                          value={draft[item.id].limit}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [item.id]: { ...draft[item.id], limit: Number(e.target.value) },
                            })
                          }
                        />
                        {item.unit}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="d2-form-footer">
            <button type="button" className="d2-back" onClick={onDesign}>
              <ArrowLeft size={15} /> Back to Design
            </button>
            <span className="al-count">
              {selectedAlerts.length} of {definitions.length} selected
            </span>
            <button
              className="d2-button"
              disabled={!anySelected || !limitsValid}
              onClick={() => setStep(1)}
            >
              Continue
              <ArrowRight size={16} />
            </button>
          </div>
        </PrimaryCard>
      )}
      {step === 1 && (
        <PrimaryCard className="hv-deploy al-review">
          <div className="d2-card-top">
            <span className="d2-kicker">
              <span /> ONE LAST LOOK
            </span>
            <span className="d2-card-index">02 — 02</span>
          </div>
          <h1>Ready to watch over it.</h1>
          <p className="d2-lede">Review everything below. Nothing goes live until you confirm.</p>

          <div className="db-hero">
            <span className="db-hero-icon">
              <ShieldCheck size={26} strokeWidth={1.4} />
            </span>
            <div>
              <h2>{state.facility.name}</h2>
              <p>
                {state.facility.type} · {state.facility.city} · {MODEL_NAME}
              </p>
              <p className="db-hero-best">
                {selectedAlerts.length} {selectedAlerts.length === 1 ? 'alert' : 'alerts'} ·{' '}
                {coverage.length} sensors on Level 4
              </p>
            </div>
          </div>

          <div className="al-section-title">
            <h2>Alerts</h2>
            <button className="db-link" onClick={() => setStep(0)}>
              Edit
            </button>
          </div>
          <section className="db-group" aria-label="Selected alerts">
            {selectedAlerts.map((item) => {
              const Icon = item.icon;
              const sensors = monitoringPoints.filter((p) => p.protection === item.id);
              return (
                <div className="db-row al-row" key={item.id}>
                  <span className="al-row-icon">
                    <Icon size={17} strokeWidth={1.6} />
                  </span>
                  <div>
                    <b>{item.name}</b>
                    <small>{sensors.map((s) => s.label).join(' · ')} · Level 4</small>
                  </div>
                  <span className="al-threshold">
                    {'unit' in item ? (
                      <>
                        Above <b>{draft[item.id as 'electricity' | 'waterUsage'].limit}</b>{' '}
                        {item.unit}
                      </>
                    ) : (
                      item.trigger
                    )}
                  </span>
                </div>
              );
            })}
            {skippedAlerts.length > 0 && (
              <div className="db-row al-skipped">
                <span className="al-row-icon" />
                <div>
                  <small>Not monitored: {skippedAlerts.map((d) => d.name).join(' · ')}</small>
                </div>
              </div>
            )}
          </section>

          <div className="al-section-title">
            <h2>Deployment</h2>
          </div>
          <section className="db-group" aria-label="Deployment details">
            <div className="db-row">
              <span>DataBot</span>
              <div>
                <b>{databotPlacements[placement].name}</b>
                <small>{databotPlacements[placement].bestFor}</small>
              </div>
              <select
                className="al-select-input"
                aria-label="DataBot placement"
                value={placement}
                onChange={(e) => setPlacement(e.target.value as PlacementId)}
              >
                {placementIds.map((id) => (
                  <option key={id} value={id}>
                    {databotPlacements[id].name}
                  </option>
                ))}
              </select>
            </div>
            <div className="db-row">
              <span>Exit route</span>
              <div>
                <b>{evacuationPlans[choice].name}</b>
                <small>Predefined demo route · stairs, not step-free</small>
              </div>
              <div className="db-segment" role="radiogroup" aria-label="Exit route">
                {(Object.keys(evacuationPlans) as PlanId[]).map((id) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={choice === id}
                    disabled={!available[id]}
                    className={choice === id ? 'is-active' : ''}
                    onClick={() => setPlan(id)}
                  >
                    {evacuationPlans[id].name.replace(' Exit', '')}
                  </button>
                ))}
              </div>
            </div>
            <div className="db-row">
              <span>Mode</span>
              <div>
                <b>Simulation</b>
                <small>No hardware is connected yet. Readings and incidents are simulated.</small>
              </div>
            </div>
          </section>

          {activeIncidents(state).length > 0 && (
            <div className="hv-inline-alert">
              <Bell size={17} />
              The current demo incident will carry into the Command Center.
            </div>
          )}
          <div className="d2-form-footer db-footer">
            <button className="d2-back" onClick={() => setStep(0)}>
              <ArrowLeft size={15} /> Back to Select
            </button>
            <button
              className="d2-button"
              disabled={busy || deploying || !anySelected || !limitsValid}
              onClick={confirmDeploy}
            >
              {deploying ? 'Deploying…' : 'Confirm Deploy'}
              <ShieldCheck size={16} />
            </button>
          </div>
        </PrimaryCard>
      )}
    </>
  );
}
function Metric({
  icon: Icon,
  name,
  value,
  detail,
  warning,
  ratio,
}: {
  icon: typeof Zap;
  name: string;
  value: string;
  detail: string;
  warning: boolean;
  /** Reading ÷ limit, drawn as a meter. Omitted for on/off detectors. */
  ratio?: number;
}) {
  return (
    <div className={`hv-metric ${warning ? 'is-warning' : ''}`}>
      <span>
        <Icon size={16} />
        {name}
        <small>SIMULATED</small>
      </span>
      <b>{value}</b>
      {ratio !== undefined && (
        <span
          className="sb-meter"
          role="meter"
          aria-label={`${name} against its limit`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(ratio, 1.5) * 100)}
        >
          <i style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
        </span>
      )}
      <p>{detail}</p>
    </div>
  );
}
