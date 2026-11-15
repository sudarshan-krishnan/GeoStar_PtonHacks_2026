'use client';
// HAVEN's admin "operations center", ported for the deployed Command Center: the status strip,
// Building overview, Incident command (impact chain, reviewed response plan, simulated emergency
// call) and Response coordination. Everything is a simulation over the sample twin; labels say so.
import type { ReactNode } from 'react';
import {
  Accessibility,
  ArrowRight,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Droplets,
  Flame,
  LockKeyhole,
  Phone,
  Radio,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Waves,
  Wrench,
  Zap,
} from 'lucide-react';
import { PrimaryCard } from './shell';
import { FacilityTwin } from './facility-twin';
import {
  activeIncidents,
  buildingHealth,
  facilitySystems,
  operationsHealth,
  primaryIncident,
  responsePlan,
  severity,
  type FacilitySystem,
  type MaintenanceStatus,
  type ProtectionAction,
  type ProtectionState,
  type SecurityStatus,
  type SystemStatus,
} from '@/lib/haven/engine';

type Act = (action: ProtectionAction) => Promise<ProtectionState | null>;
type Tone = 'online' | 'warning' | 'critical' | 'offline' | 'safe' | 'unknown';

const clock = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '—';
const two = (n: number) => String(n).padStart(2, '0');

/** Labels only, as in HAVEN: never creates a fault or controls equipment. */
function systemState(system: FacilitySystem): { label: string; tone: Tone } {
  if (!system.monitored) return { label: 'NOT MONITORED', tone: 'unknown' };
  return (
    {
      operational: { label: 'ONLINE', tone: 'online' },
      affected: { label: 'DEGRADED', tone: 'warning' },
      unavailable: { label: 'OFFLINE', tone: 'offline' },
      rerouted: { label: 'RE-ROUTED', tone: 'safe' },
    } as Record<SystemStatus, { label: string; tone: Tone }>
  )[system.status];
}
export function StateChip({ label, tone = 'unknown' }: { label: string; tone?: Tone }) {
  return (
    <span className={`cc-chip cc-${tone}`}>
      <i />
      {label}
    </span>
  );
}
const SYSTEM_ICONS: Record<string, typeof Flame> = {
  FIRE: Flame,
  R3: Droplets,
  E1: ArrowUpDown,
  POWER: Zap,
  'ROUTE-EAST': Accessibility,
  'ROUTE-NORTH': Accessibility,
};
const incidentIcon = (kind?: string) =>
  kind === 'fire' ? Flame : kind === 'leak' ? Droplets : kind === 'waterUsage' ? Waves : Zap;

/* ------------------------------------------------------------------ status strip */

function SeverityBadge({ state }: { state: ProtectionState }) {
  const s = severity(state);
  return (
    <div
      className={`cc-severity cc-severity-${s.level}`}
      aria-label={`Severity ${s.level} of 4: ${s.label}`}
    >
      {s.level ? <TriangleAlert size={17} /> : <ShieldCheck size={17} />}
      <div>
        <strong>{s.label}</strong>
        <span>
          {s.level >= 3 ? 'CRITICAL' : s.level ? 'WARNING' : 'ONLINE'} · LEVEL {s.level} / 4
        </span>
      </div>
      <div className="cc-severity-scale" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= s.level ? 'filled' : ''} />
        ))}
      </div>
    </div>
  );
}

/**
 * HAVEN's status strip. Keeps the `hv-health-banner` class and health wording that the
 * Command Center tests read, and adds severity, counts and reported-systems availability.
 */
export function StatusStrip({
  state,
  busy,
  act,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
}) {
  const health = buildingHealth(state);
  const healthClass = health === 'Critical incident' ? 'critical' : health.toLowerCase();
  const active = activeIncidents(state);
  const primary = primaryIncident(state);
  const plan = responsePlan(state);
  const approved = plan?.status === 'approved';
  const systems = facilitySystems(state).filter((s) => s.monitored);
  const affected = systems.filter((s) => s.status === 'affected' || s.status === 'unavailable');
  const ops = operationsHealth(state);
  const s = severity(state);
  return (
    <div
      className={`hv-health-banner ${healthClass} cc-strip`}
      role={health === 'Critical incident' || health === 'Warning' ? 'alert' : 'status'}
    >
      <div className="cc-strip-main">
        <span className={`cc-orb ${primary && !approved ? 'alert' : ''}`}>
          {health === 'Critical incident' ? (
            <Flame size={20} />
          ) : health === 'Warning' ? (
            <TriangleAlert size={20} />
          ) : health === 'Recovering' ? (
            <RotateCcw size={20} />
          ) : (
            <ShieldCheck size={20} />
          )}
        </span>
        <div>
          <b>
            {health}
            <em>
              {primary
                ? approved
                  ? ' · Response plan approved'
                  : ' · An incident needs your review'
                : health === 'Recovering'
                  ? ' · Recovery review'
                  : ' · Daily mode'}
            </em>
          </b>
          <p>
            {primary
              ? approved
                ? 'Reviewed guidance published · Incident remains active until readings recover.'
                : `${primary.name} · ${primary.zone}, Level 4 · Review affected systems and approve a response.`
              : health === 'Recovering'
                ? 'Simulated readings have reset. Complete the recovery review to return to healthy.'
                : s.level
                  ? s.reasons.join(' ')
                  : 'All monitored systems are operational. No active incidents.'}
          </p>
        </div>
        {state.recovering && !active.length && (
          <button disabled={busy} onClick={() => void act({ action: 'finish-recovery' })}>
            Complete recovery <Check size={14} />
          </button>
        )}
      </div>
      <div className="cc-strip-metrics">
        <SeverityBadge state={state} />
        <div className="cc-count">
          <strong>{two(active.length)}</strong>
          <span>Active incidents</span>
        </div>
        <div className="cc-count">
          <strong>{two(affected.length)}</strong>
          <span>Affected systems</span>
        </div>
        <div className="cc-ops" data-online-percent={ops.percent ?? 'unknown'}>
          <div className="cc-ops-score">
            <strong>{ops.percent === null ? '—' : `${ops.percent}%`}</strong>
            <span>
              REPORTED SYSTEMS ONLINE
              <small>
                {ops.online} of {ops.reported} monitored
              </small>
            </span>
          </div>
          <div className="cc-ops-counts">
            <span>
              <i className="cc-dot online" />
              <b>{ops.online}</b> online
            </span>
            <span>
              <i className="cc-dot warning" />
              <b>{ops.degraded}</b> degraded
            </span>
            <span>
              <i className="cc-dot offline" />
              <b>{ops.offline}</b> offline
            </span>
          </div>
          <span className="cc-snapshot">
            <Radio size={12} /> SNAPSHOT <code>#{state.revision}</code>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ building overview */

/** HAVEN's "How the incident connects": trigger → dependent systems → route outcome. */
function cascadeSteps(state: ProtectionState): string[] {
  const primary = primaryIncident(state);
  if (!primary) return [];
  const plan = responsePlan(state);
  const systems = facilitySystems(state).filter((s) => s.monitored);
  const steps = [`${primary.name} · ${primary.zone}`];
  for (const system of systems)
    if (system.status === 'affected' || system.status === 'unavailable')
      steps.push(`${system.name}: ${system.detail.toLowerCase()}`);
  if (plan?.lifeSafety)
    steps.push(
      plan.status === 'approved'
        ? `Approved route · ${plan.route}`
        : `Proposed route · ${plan.route} · awaiting approval`,
    );
  return steps;
}

export function BuildingOverview({
  state,
  children,
}: {
  state: ProtectionState;
  /** Route summary and other twin footers from the Command Center. */
  children?: ReactNode;
}) {
  const primary = primaryIncident(state);
  const s = severity(state);
  const plan = responsePlan(state);
  const systems = facilitySystems(state);
  const steps = cascadeSteps(state);
  const degraded = systems.some(
    (x) => x.monitored && x.status !== 'operational' && x.status !== 'rerouted',
  );
  return (
    <PrimaryCard className="hv-live-model cc-overview">
      <div className="hv-section-heading">
        <div>
          <span className="d2-overline">BUILDING OVERVIEW</span>
          <h2>Building systems · Digital twin</h2>
        </div>
        <span
          className={`cc-badge ${primary?.kind === 'fire' ? 'red' : primary || degraded ? 'amber' : 'green'}`}
        >
          <i />
          {primary
            ? primary.kind === 'fire'
              ? 'Fire incident active'
              : 'Incident active'
            : s.level
              ? 'Advisory'
              : 'Systems healthy'}
        </span>
      </div>
      <FacilityTwin state={state} operational initialFloor={null} />
      <div className="cc-systems" role="list" aria-label="Facility systems">
        {systems.map((system) => {
          const Icon = SYSTEM_ICONS[system.id] ?? ShieldCheck;
          return (
            <div
              key={system.id}
              role="listitem"
              className={`cc-system ${system.monitored ? system.status : 'unmonitored'}`}
              title={system.detail}
            >
              <Icon size={15} />
              <code>{system.tag}</code>
              <StateChip {...systemState(system)} />
            </div>
          );
        })}
      </div>
      {steps.length > 0 && (
        <section
          className={`cc-sequence ${plan?.status === 'approved' ? 'approved' : ''}`}
          aria-label="How the incident connects"
        >
          <div className="cc-sequence-heading">
            <strong>How the incident connects</strong>
            <span>{plan?.status === 'approved' ? 'Plan approved' : 'Response requires approval'}</span>
          </div>
          <ol>
            {steps.map((step, i) => (
              <li key={step}>
                <span>{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      )}
      {children}
    </PrimaryCard>
  );
}

/* ------------------------------------------------------------------ incident command */

function ImpactChain({ state }: { state: ProtectionState }) {
  const affected = facilitySystems(state).filter(
    (s) => s.monitored && s.status !== 'operational',
  );
  if (!affected.length) return null;
  return (
    <section className="cc-impact" aria-label="System impact chain">
      <div className="cc-label">
        <h3>System impact chain</h3>
        <span>Reported state</span>
      </div>
      <ol>
        {affected.map((system) => (
          <li key={system.id}>
            <code>{system.tag}</code>
            <strong>{system.name}</strong>
            <small>{system.detail}</small>
            <StateChip {...systemState(system)} />
            <ArrowRight size={13} aria-hidden="true" />
          </li>
        ))}
      </ol>
      <small>Incident-linked systems only. States come from the simulation rules, not guesses.</small>
    </section>
  );
}

function ResponsePlanSection({
  state,
  busy,
  act,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
}) {
  const plan = responsePlan(state);
  if (!plan) return null;
  const approved = plan.status === 'approved';
  return (
    <section className="cc-plan" aria-label="Response plan">
      <div className="cc-label">
        <h3>Response plan</h3>
        <span className={`cc-plan-status ${approved ? 'approved' : ''}`}>
          {approved ? <Check size={13} /> : <Clock3 size={13} />}
          {approved ? 'Approved' : 'Needs approval'}
        </span>
      </div>
      <p className="cc-plan-intro">
        <code>{plan.id}</code> · Generated by HAVEN&apos;s rules · {plan.title}
      </p>
      <ol className="cc-steps">
        {plan.steps.map((step, i) => (
          <li key={step}>
            <span>{approved ? <Check size={12} /> : i + 1}</span>
            <p>{step}</p>
          </li>
        ))}
      </ol>
      <details className="cc-rationale">
        <summary>
          <CircleHelp size={14} />
          Why this plan?
          <ChevronRight size={14} />
        </summary>
        <p>{plan.rationale}</p>
      </details>
      <div className={`cc-approval ${approved ? 'confirmed' : 'pending'}`}>
        <div className="cc-approval-title">
          <span>{approved ? <ShieldCheck size={20} /> : <Clock3 size={20} />}</span>
          <div>
            <strong>{approved ? 'Approved by operator' : 'Proposed · Approval required'}</strong>
            <p>
              {approved
                ? `Confirmed at ${clock(plan.approvedAt)}`
                : 'Nothing is shared with staff until a person approves it.'}
            </p>
          </div>
        </div>
        <div className="cc-publication" role="status">
          {approved ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}
          <span>{approved ? 'Staff guidance published' : 'Staff guidance is unpublished'}</span>
        </div>
        {plan.lifeSafety && (
          <p className="cc-instruction">
            <Accessibility size={14} />
            <span>
              <b>{approved ? 'Live guidance' : 'Guidance after approval'}:</b> {plan.instruction}
            </span>
          </p>
        )}
      </div>
      <button
        className={`cc-approve ${approved ? 'is-approved' : ''}`}
        disabled={busy || approved}
        onClick={() => void act({ action: 'approve-plan', key: plan.key })}
      >
        {approved ? <CheckCircle2 size={17} /> : <ShieldCheck size={17} />}
        {approved ? 'Plan approved & shared' : 'Approve plan'}
        {!approved && <ArrowRight size={16} />}
      </button>
      <p className="cc-hint">
        {approved
          ? 'Guidance stays live until readings recover. New hazards propose an updated plan.'
          : 'Approval publishes the staff guidance above and records who approved it.'}
      </p>
    </section>
  );
}

function EmergencyDispatch({
  state,
  busy,
  act,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
}) {
  const primary = primaryIncident(state);
  if (!primary || (primary.kind !== 'fire' && primary.kind !== 'leak')) return null;
  const call = state.call?.incidentId === primary.id ? state.call : null;
  return (
    <section className="cc-dispatch" aria-label="Emergency services simulation">
      <div className="cc-label">
        <h3>Emergency services</h3>
        <span className="cc-badge amber">SIMULATED ONLY</span>
      </div>
      <p className="cc-note">
        A local, scripted conversation. No real emergency number or provider is connected.
      </p>
      <button
        className="cc-emergency"
        disabled={busy || !!call}
        onClick={() => void act({ action: 'emergency-call' })}
      >
        <Phone size={15} />
        {call ? 'Simulated call completed' : 'Call emergency services (simulated)'}
      </button>
      {call && (
        <div className="cc-call" role="status">
          <strong>
            {call.id} · started {clock(call.startedAt)}
          </strong>
          <ol aria-label="Simulated conversation transcript">
            {call.transcript.map((turn, i) => (
              <li key={i} style={{ animationDelay: `${i * 0.35}s` }}>
                <b>{turn.speaker}</b>
                <p>{turn.text}</p>
              </li>
            ))}
          </ol>
          <p className="cc-report">{call.report}</p>
        </div>
      )}
    </section>
  );
}

export function IncidentCommand({
  state,
  busy,
  act,
  children,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
  /** The Command Center's list of every active incident (with acknowledgement). */
  children?: ReactNode;
}) {
  const primary = primaryIncident(state);
  const Icon = incidentIcon(primary?.kind);
  const system = primary
    ? facilitySystems(state).find((s) =>
        primary.kind === 'fire'
          ? s.id === 'FIRE'
          : primary.kind === 'electricity'
            ? s.id === 'POWER'
            : s.id === 'R3',
      )
    : undefined;
  return (
    <PrimaryCard className="hv-response-panel cc-command">
      <div className="hv-section-heading">
        <div>
          <span className="d2-overline">{primary ? 'INCIDENT COMMAND' : 'ROUTINE OPERATIONS'}</span>
          <h2>{primary ? primary.name : 'Daily mode'}</h2>
        </div>
        <span className={`cc-badge ${primary ? (primary.severity === 'critical' ? 'red' : 'amber') : 'green'}`}>
          <i />
          {primary ? 'Active' : 'Healthy'}
        </span>
      </div>
      {primary ? (
        <>
          <div className="cc-incident-title">
            <span className={`cc-tile ${primary.kind}`}>
              <Icon size={22} />
            </span>
            <div>
              <p>
                {primary.zone} · Level 4{system ? ` · ${system.name}` : ''}
              </p>
              <div className="cc-meta">
                <code>{primary.id}</code>
                <span>
                  <Clock3 size={12} />
                  {clock(primary.createdAt)}
                </span>
                <span>Severity {severity(state).level} · {severity(state).label}</span>
              </div>
            </div>
          </div>
          <ImpactChain state={state} />
          <ResponsePlanSection state={state} busy={busy} act={act} />
          <EmergencyDispatch state={state} busy={busy} act={act} />
        </>
      ) : (
        <div className="cc-daily">
          <span className="cc-tile ok">
            <Wrench size={22} />
          </span>
          <div>
            <h3>No incident to command</h3>
            <p>
              Enabled protections are within their limits. HAVEN proposes a response plan the
              moment a simulated reading crosses a threshold.
            </p>
          </div>
        </div>
      )}
      {children}
    </PrimaryCard>
  );
}

/* ------------------------------------------------------------------ response coordination */

const MAINTENANCE_LABEL: Record<MaintenanceStatus, [string, string, Tone]> = {
  open: ['Needs investigation', 'OPEN', 'warning'],
  in_progress: ['Investigation in progress', 'IN PROGRESS', 'warning'],
  investigated: ['Investigation complete · operator review', 'REPORTED', 'safe'],
};
const MAINTENANCE_NEXT: Partial<Record<MaintenanceStatus, string>> = {
  open: 'Report investigation started',
  in_progress: 'Report investigation complete',
};
const SECURITY_LABEL: Record<SecurityStatus, [string, string, Tone]> = {
  pending: ['Awaiting acknowledgement', 'AWAITING ACK', 'warning'],
  acknowledged: ['Incident acknowledged', 'ACKNOWLEDGED', 'online'],
  dispatched: ['Officer dispatched to main entrance', 'DISPATCHED', 'online'],
  on_scene: ['Officer on scene · entrance ready', 'ON SCENE', 'safe'],
};
const SECURITY_NEXT: Partial<Record<SecurityStatus, string>> = {
  pending: 'Report security acknowledged',
  acknowledged: 'Report officer dispatched',
  dispatched: 'Report officer on scene',
};

export function ResponseCoordination({
  state,
  busy,
  act,
}: {
  state: ProtectionState;
  busy: boolean;
  act: Act;
}) {
  const primary = primaryIncident(state);
  const team = state.team;
  if (!primary || !team) return null;
  const plan = responsePlan(state);
  const [mLabel, mChip, mTone] = MAINTENANCE_LABEL[team.maintenance.status];
  const [sLabel, sChip, sTone] = SECURITY_LABEL[team.security.status];
  const mNext = MAINTENANCE_NEXT[team.maintenance.status];
  const sNext = SECURITY_NEXT[team.security.status];
  const acknowledged = activeIncidents(state).filter((i) => i.status === 'acknowledged').length;
  return (
    <PrimaryCard className="cc-coordination">
      <div className="hv-section-heading">
        <div>
          <span className="d2-overline">RESPONSE COORDINATION</span>
          <h2>Who is doing what.</h2>
        </div>
        <span className="d2-sample-tag">
          <code>{primary.id}</code> · Simulated team reports
        </span>
      </div>
      <div className="cc-teams">
        <article>
          <Wrench size={19} />
          <div>
            <span className="d2-overline">MAINTENANCE · {team.workOrder}</span>
            <strong>{mLabel}</strong>
            <StateChip label={mChip} tone={mTone} />
            <small>Updated {clock(team.maintenance.updatedAt)}</small>
            {mNext && (
              <button disabled={busy} onClick={() => void act({ action: 'team-update', team: 'maintenance' })}>
                {mNext}
              </button>
            )}
          </div>
        </article>
        <article>
          <ShieldCheck size={19} />
          <div>
            <span className="d2-overline">SECURITY DESK</span>
            <strong>{sLabel}</strong>
            <StateChip label={sChip} tone={sTone} />
            <small>Updated {clock(team.security.updatedAt)}</small>
            {sNext && (
              <button disabled={busy} onClick={() => void act({ action: 'team-update', team: 'security' })}>
                {sNext}
              </button>
            )}
          </div>
        </article>
        <article>
          <Accessibility size={19} />
          <div>
            <span className="d2-overline">OPERATOR · GUIDANCE</span>
            <strong>
              {plan?.status === 'approved' ? 'Guidance published' : 'Plan awaiting approval'}
            </strong>
            <StateChip
              label={plan?.status === 'approved' ? 'PUBLISHED' : 'UNPUBLISHED'}
              tone={plan?.status === 'approved' ? 'safe' : 'warning'}
            />
            <small>
              {acknowledged} of {activeIncidents(state).length} incidents acknowledged ·
              acknowledgement is not confirmed safety
            </small>
          </div>
        </article>
      </div>
    </PrimaryCard>
  );
}
