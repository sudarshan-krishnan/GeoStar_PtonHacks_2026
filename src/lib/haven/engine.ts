import { z } from 'zod';
import { sensorDefaults, incidentDetails } from '../monitoring-rules';
import {
  databotPlacements,
  demoScenarios,
  evacuationPlans,
  MODEL_ID,
  placementIds,
  type PlacementId,
  type PlanId,
} from './config';

export const protectionSchema = z.object({
  electricity: z.object({ enabled: z.boolean(), limit: z.number().finite().min(1).max(100000) }),
  waterUsage: z.object({ enabled: z.boolean(), limit: z.number().finite().min(1).max(100000) }),
  leak: z.object({ enabled: z.boolean() }),
  fire: z.object({ enabled: z.boolean() }),
});
export type Protections = z.infer<typeof protectionSchema>;
export type ProtectionKind = keyof Protections;
export const defaultProtections: Protections = {
  electricity: { enabled: true, limit: 500 },
  waterUsage: { enabled: true, limit: 50 },
  leak: { enabled: true },
  fire: { enabled: true },
};
export interface Facility {
  id: string;
  name: string;
  city: string;
  type: string;
}
export interface DemoIncident {
  id: string;
  kind: ProtectionKind;
  name: string;
  zone: string;
  severity: 'warning' | 'critical';
  status: 'active' | 'acknowledged' | 'resolved';
  message: string;
  recommendation: string;
  source: 'simulation';
  createdAt: string;
}
export interface Activity {
  id: string;
  agent: string;
  message: string;
  at: string;
}
export interface Readings {
  electricity: number;
  waterUsage: number;
  leak: number;
  fire: number;
}
/** HAVEN's incident-command layer: one reviewed response per set of active hazards. */
export type PlanStatus = 'pending_approval' | 'approved';
export interface ResponseRecord {
  id: string;
  /** Hazards and route the plan was generated for; a change proposes a new plan. */
  key: string;
  status: PlanStatus;
  proposedAt: string;
  approvedAt?: string;
}
export const MAINTENANCE_STEPS = ['open', 'in_progress', 'investigated'] as const;
export const SECURITY_STEPS = ['pending', 'acknowledged', 'dispatched', 'on_scene'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STEPS)[number];
export type SecurityStatus = (typeof SECURITY_STEPS)[number];
export interface TeamResponse {
  /** The primary incident these reports belong to. */
  incidentId: string;
  workOrder: string;
  maintenance: { status: MaintenanceStatus; updatedAt: string };
  security: { status: SecurityStatus; updatedAt: string };
}
export interface EmergencyCall {
  id: string;
  incidentId: string;
  mode: 'simulated';
  status: 'completed';
  startedAt: string;
  transcript: { speaker: string; text: string }[];
  report: string;
}
export interface ProtectionState {
  revision: number;
  facility: Facility;
  modelId: string;
  modelAccepted: boolean;
  config: Protections;
  configured: boolean;
  placed: boolean;
  plan: PlanId;
  /** Where the DataBot sensor unit sits. Absent for workspaces saved before placements existed. */
  placement?: PlacementId;
  deployed: boolean;
  recovering: boolean;
  mode: 'simulation';
  readings: Readings;
  /** Normal readings this facility returns to on reset. Defaults to the HAVEN sample values. */
  baseline?: Readings;
  /** When monitoring was last deployed. Kept while protections are being edited. */
  deployedAt?: string;
  incidents: DemoIncident[];
  timeline: Activity[];
  sequence: number;
  /** Incident-command records. Absent on snapshots saved before incident command existed. */
  response?: ResponseRecord;
  team?: TeamResponse;
  call?: EmergencyCall;
}
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept-model') }),
  z.object({ action: z.literal('configure'), config: protectionSchema }),
  z.object({
    action: z.literal('place'),
    plan: z.enum(['east', 'north']),
    placement: z.enum(placementIds).optional(),
  }),
  z.object({ action: z.literal('deploy') }),
  z.object({ action: z.literal('reconfigure') }),
  z.object({ action: z.literal('trigger'), kind: z.enum(['leak', 'fire', 'usage']) }),
  z.object({ action: z.literal('acknowledge'), incidentId: z.string().max(100) }),
  z.object({ action: z.literal('reset') }),
  z.object({ action: z.literal('finish-recovery') }),
  z.object({ action: z.literal('approve-plan'), key: z.string().max(200) }),
  z.object({ action: z.literal('team-update'), team: z.enum(['maintenance', 'security']) }),
  z.object({ action: z.literal('emergency-call') }),
]);
export type ProtectionAction = z.infer<typeof actionSchema>;
export function initialProtectionState(facility: Facility): ProtectionState {
  return {
    revision: 0,
    facility,
    modelId: MODEL_ID,
    modelAccepted: false,
    config: structuredClone(defaultProtections),
    configured: false,
    placed: false,
    plan: 'east',
    deployed: false,
    recovering: false,
    mode: 'simulation',
    readings: {
      electricity: 260,
      waterUsage: 18,
      leak: sensorDefaults.water.value,
      fire: sensorDefaults.fire.value,
    },
    incidents: [],
    timeline: [],
    sequence: 0,
  };
}
export const activeIncidents = (state: ProtectionState) =>
  state.incidents.filter((incident) => incident.status !== 'resolved');
export function buildingHealth(
  state: ProtectionState,
): 'Healthy' | 'Warning' | 'Critical incident' | 'Recovering' {
  const active = activeIncidents(state);
  return active.some((i) => i.severity === 'critical')
    ? 'Critical incident'
    : active.length
      ? 'Warning'
      : state.recovering
        ? 'Recovering'
        : 'Healthy';
}
// HAVEN's route-exclusion rule: a path touching any excluded location is unavailable.
// Availability applies to this explicit simulation topology only, never real-world safety.
export function routeAvailability(state: ProtectionState) {
  const blocked = activeIncidents(state).flatMap((i) =>
    i.kind === 'leak' || i.kind === 'fire' ? [...demoScenarios[i.kind].blockedLocations] : [],
  );
  return Object.fromEntries(
    Object.entries(evacuationPlans).map(([id, route]) => [
      id,
      !route.locationIds.some((location) => blocked.includes(location as (typeof blocked)[number])),
    ]),
  ) as Record<PlanId, boolean>;
}
export function effectivePlan(state: ProtectionState): PlanId | null {
  const availability = routeAvailability(state);
  return availability[state.plan]
    ? state.plan
    : availability.north
      ? 'north'
      : availability.east
        ? 'east'
        : null;
}
// ---------------------------------------------------------------------------------------------
// Incident command, ported from HAVEN's admin dashboard: severity, the system impact chain, a
// generated response plan that a human approves before guidance is shared, team reports and a
// simulated emergency-services call. Deterministic rules only; nothing controls real equipment.
// ---------------------------------------------------------------------------------------------
export const SEVERITY_LABELS = [
  'Normal',
  'Advisory',
  'Operational',
  'Life Safety',
  'Confirmed Emergency',
] as const;
const KIND_RANK: Record<ProtectionKind, number> = { fire: 0, leak: 1, electricity: 2, waterUsage: 3 };
/** The incident HAVEN commands around: the most severe active one, then the newest. */
export function primaryIncident(state: ProtectionState): DemoIncident | null {
  return (
    [...activeIncidents(state)].sort(
      (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.createdAt.localeCompare(a.createdAt),
    )[0] ?? null
  );
}
export function severity(state: ProtectionState) {
  const kinds = new Set(activeIncidents(state).map((i) => i.kind));
  const levels: [number, string][] = [];
  if (kinds.has('fire'))
    levels.push([4, `Fire alarm activated · ${demoScenarios.fire.zone}, Level 4.`]);
  if (kinds.has('leak'))
    levels.push([
      2,
      `Moisture detected · ${demoScenarios.leak.zone}. Riser R-3 feeds the Elevator E1 shaft, so E1 is isolated.`,
    ]);
  if (kinds.has('electricity'))
    levels.push([1, `Electrical load above the ${state.config.electricity.limit} kW limit.`]);
  if (kinds.has('waterUsage'))
    levels.push([1, `Water flow above the ${state.config.waterUsage.limit} L/min limit.`]);
  const level = Math.max(0, ...levels.map(([n]) => n));
  return { level, label: SEVERITY_LABELS[level], reasons: levels.map(([, reason]) => reason) };
}

export type SystemStatus = 'operational' | 'affected' | 'unavailable' | 'rerouted';
export interface FacilitySystem {
  id: string;
  tag: string;
  name: string;
  family: string;
  zone: string;
  /** False when the protection that reports this system is switched off. */
  monitored: boolean;
  status: SystemStatus;
  detail: string;
}
/** Reported system states, derived from the active simulated incidents and the plan. */
export function facilitySystems(state: ProtectionState): FacilitySystem[] {
  const kinds = new Set(activeIncidents(state).map((i) => i.kind));
  const available = routeAvailability(state);
  const approvedRoute =
    state.response?.status === 'approved' && state.response.key === planKey(state)
      ? effectivePlan(state)
      : null;
  const c = state.config;
  const system = (
    id: string,
    tag: string,
    name: string,
    family: string,
    zone: string,
    monitored: boolean,
    [status, detail]: [SystemStatus, string],
  ): FacilitySystem => ({ id, tag, name, family, zone, monitored, status, detail });
  const route = (id: PlanId): [SystemStatus, string] =>
    !available[id]
      ? ['unavailable', `Excluded · route touches the ${kinds.has('fire') ? 'fire' : 'leak'} zone`]
      : approvedRoute === id
        ? ['rerouted', 'Approved evacuation route · guidance published']
        : ['operational', 'Clear in the configured scenario'];
  return [
    system('FIRE', 'FIRE-L04', 'Fire monitoring', 'Life safety', 'L04 · East / west corridors', c.fire.enabled,
      kinds.has('fire') ? ['affected', `Alarm active · ${demoScenarios.fire.zone}`] : ['operational', 'Smoke / heat points normal']),
    system('R3', 'R-3', 'Water riser R-3', 'Water services', 'Service riser · L04', c.leak.enabled || c.waterUsage.enabled,
      kinds.has('leak') ? ['affected', `Leak detected · ${demoScenarios.leak.zone}`]
        : kinds.has('waterUsage') ? ['affected', `Flow ${state.readings.waterUsage} L/min · above limit`]
          : ['operational', 'Moisture and flow normal']),
    system('E1', 'E1', 'Freight elevator E1', 'Vertical transportation', 'Core east · L01–L06', c.leak.enabled || c.fire.enabled,
      kinds.has('fire') ? ['unavailable', 'Offline · fire-safety isolation']
        : kinds.has('leak') ? ['unavailable', 'Offline · riser R-3 water dependency']
          : ['operational', 'In service']),
    system('POWER', 'EP-L04', 'Electrical panel', 'Electrical supply', 'L04 · Electrical service bay', c.electricity.enabled,
      kinds.has('electricity') ? ['affected', `Load ${state.readings.electricity} kW · above limit`] : ['operational', `Load ${state.readings.electricity} kW`]),
    system('ROUTE-EAST', 'ROUTE-E', evacuationPlans.east.name + ' route', 'Egress', 'L04 corridor → east stair', true, route('east')),
    system('ROUTE-NORTH', 'ROUTE-N', evacuationPlans.north.name + ' route', 'Egress', 'L04 corridor → west stair', true, route('north')),
  ];
}
/** HAVEN's availability measure: reported, monitored systems only. */
export function operationsHealth(state: ProtectionState) {
  const reported = facilitySystems(state).filter((s) => s.monitored);
  const count = (status: SystemStatus) => reported.filter((s) => s.status === status).length;
  const online = count('operational') + count('rerouted');
  return {
    reported: reported.length,
    online,
    percent: reported.length ? Math.round((online / reported.length) * 100) : null,
    degraded: count('affected'),
    offline: count('unavailable'),
    rerouted: count('rerouted'),
  };
}

/** Identifies the hazards and route a plan was generated for. */
export function planKey(state: ProtectionState): string | null {
  const kinds = [...new Set(activeIncidents(state).map((i) => i.kind))].sort();
  return kinds.length ? `${kinds.join('+')}:${effectivePlan(state) ?? 'none'}` : null;
}
export interface ResponsePlan {
  key: string;
  id: string;
  status: PlanStatus;
  approvedAt?: string;
  title: string;
  steps: string[];
  rationale: string;
  instruction: string;
  route: string;
  /** Hazards that exclude routes; usage-only incidents keep normal operations. */
  lifeSafety: boolean;
}
/** The generated response for the current hazards. Approval is only read from the stored record. */
export function responsePlan(state: ProtectionState): ResponsePlan | null {
  const key = planKey(state);
  const primary = primaryIncident(state);
  if (!key || !primary) return null;
  const kinds = new Set(activeIncidents(state).map((i) => i.kind));
  const record = state.response?.key === key ? state.response : undefined;
  const plan = effectivePlan(state);
  const route = plan ? evacuationPlans[plan] : null;
  const fire = kinds.has('fire');
  const leak = kinds.has('leak');
  const lifeSafety = fire || leak;
  const hazard = fire && leak ? 'fire and water leak' : fire ? 'fire' : 'water leak';
  const steps: string[] = [];
  if (lifeSafety) {
    steps.push(
      fire
        ? 'Keep the east operations corridor excluded and Elevator E1 isolated while the fire alarm is active.'
        : 'Keep Elevator E1 offline and the wet east corridor excluded while riser R-3 is investigated.',
    );
    steps.push(
      route
        ? `Direct Level 4 staff to the ${route.name}: ${route.description.toLowerCase()}.`
        : 'No configured exit route is clear. Hold staff in the nearest unaffected space and request on-site assistance.',
    );
    steps.push(
      'Coordinate maintenance and security checks on site. Record acknowledgements separately from confirmed safety.',
    );
  } else {
    if (kinds.has('electricity'))
      steps.push('Maintenance: review the EP-L04 panel load before changing the electricity limit.');
    if (kinds.has('waterUsage'))
      steps.push('Maintenance: inspect the R-3 flow meter for unexpected consumption.');
    steps.push('Normal operations continue. No route is excluded by a usage threshold.');
  }
  return {
    key,
    id: record?.id ?? 'Pending',
    status: record?.status ?? 'pending_approval',
    approvedAt: record?.approvedAt,
    title: lifeSafety ? `${hazard[0].toUpperCase()}${hazard.slice(1)} response` : 'Usage review',
    steps,
    rationale: lifeSafety
      ? `HAVEN's deterministic rules exclude every configured route that touches the ${hazard} zone (${demoScenarios[fire ? 'fire' : 'leak'].zone}, East Exit). Elevator E1 is isolated ${fire ? 'for fire safety' : 'because riser R-3 feeds its shaft'}. Stairs are not step-free. ${route ? `The ${route.name} is the remaining scenario-clear route.` : 'No configured route remains clear.'} Staff must review the plan before guidance is shared.`
      : 'Usage thresholds are operational signals. They never exclude a route, so the plan is a maintenance review only.',
    instruction: lifeSafety
      ? route
        ? `Leave Level 4 by the ${route.name.replace(' Exit', '').toLowerCase()} route to the ${route.name}. Do not use Elevator E1.`
        : 'Stay in the nearest unaffected space and wait for on-site assistance. Do not use Elevator E1.'
      : 'No action needed for occupants.',
    route: route ? `${route.name} · ${route.description}` : 'No configured route available',
    lifeSafety,
  };
}
const pad = (n: number) => String(n).padStart(4, '0');
/** Keeps the response, team reports and call tied to the current hazards. */
function syncCommand(state: ProtectionState, now: string) {
  const key = planKey(state);
  const primary = primaryIncident(state);
  if (!key || !primary) {
    delete state.response;
    delete state.team;
    delete state.call;
    return;
  }
  if (state.response?.key !== key) {
    const replaced = !!state.response;
    state.response = { id: `PLAN-${pad(++state.sequence)}`, key, status: 'pending_approval', proposedAt: now };
    activity(
      state,
      'Guardian',
      `${replaced ? 'Conditions changed. Updated' : 'Generated'} response plan ${state.response.id} for operator review. Guidance is not shared until it is approved.`,
      now,
    );
  }
  // One work order and security response per response: a new hazard joins it rather than
  // wiping progress. The record follows the current primary incident.
  if (state.team) state.team.incidentId = primary.id;
  else
    state.team = {
      incidentId: primary.id,
      workOrder: `WO-${pad(++state.sequence)}`,
      maintenance: { status: 'open', updatedAt: now },
      security: { status: 'pending', updatedAt: now },
    };
  if (state.call && state.call.incidentId !== primary.id) delete state.call;
}
const MAINTENANCE_REPORTS: Record<MaintenanceStatus, string> = {
  open: 'Work order open · needs investigation.',
  in_progress: 'Investigation in progress. Isolated equipment stays isolated.',
  investigated: 'Investigation complete. Findings reported for operator review.',
};
const SECURITY_REPORTS: Record<SecurityStatus, string> = {
  pending: 'Awaiting acknowledgement.',
  acknowledged: 'Incident acknowledged by the security desk.',
  dispatched: 'Officer dispatched to the main entrance to meet responders.',
  on_scene: 'Officer on scene. Entrance access ready for responders.',
};
function emergencyCall(state: ProtectionState, primary: DemoIncident, now: string): EmergencyCall {
  const s = severity(state);
  const plan = effectivePlan(state);
  const elevator = facilitySystems(state).find((x) => x.id === 'E1');
  return {
    id: `CALL-${pad(++state.sequence)}`,
    incidentId: primary.id,
    mode: 'simulated',
    status: 'completed',
    startedAt: now,
    transcript: [
      { speaker: 'Demo operator', text: 'SIMULATION ONLY. Describe the building incident.' },
      {
        speaker: 'HAVEN',
        text: `SIMULATION: ${state.facility.name}, ${state.facility.city}. ${primary.name} in the ${primary.zone}, Level 4. Severity ${s.level}: ${s.label}. Elevator E1 ${elevator?.status === 'operational' ? 'in service' : 'isolated'}. ${plan ? `Staff are directed to the ${evacuationPlans[plan].name}.` : 'No configured exit route is clear.'} Responders should use the main entrance.`,
      },
      {
        speaker: 'Demo operator',
        text: 'Simulated report received. This does not dispatch real responders or confirm anyone is safe.',
      },
    ],
    report: `Demo report for ${primary.id}: ${primary.name}, severity ${s.level}. Real emergency services were not contacted. Follow the approved response plan; responder arrival and occupant safety remain unconfirmed.`,
  };
}

function activity(state: ProtectionState, agent: string, message: string, at: string) {
  state.timeline.unshift({ id: `event-${++state.sequence}`, agent, message, at });
  state.timeline = state.timeline.slice(0, 80);
}
function evaluate(state: ProtectionState, now: string) {
  const checks = [
    {
      kind: 'electricity' as const,
      value: state.readings.electricity,
      threshold: state.config.electricity.limit,
      type: 'electrical',
      name: 'Electricity limit exceeded',
      zone: 'Electrical service bay',
    },
    {
      kind: 'waterUsage' as const,
      value: state.readings.waterUsage,
      threshold: state.config.waterUsage.limit,
      type: 'water',
      name: 'Water usage limit exceeded',
      zone: 'R-3 utility bay',
    },
    {
      kind: 'leak' as const,
      value: state.readings.leak,
      threshold: sensorDefaults.water.threshold,
      type: 'water',
      name: 'Water leak detected',
      zone: demoScenarios.leak.zone,
    },
    {
      kind: 'fire' as const,
      value: state.readings.fire,
      threshold: sensorDefaults.fire.threshold,
      type: 'fire',
      name: 'Fire hazard detected',
      zone: demoScenarios.fire.zone,
    },
  ];
  for (const check of checks) {
    if (
      !state.config[check.kind].enabled ||
      check.value < check.threshold ||
      activeIncidents(state).some((i) => i.kind === check.kind)
    )
      continue;
    const response = incidentDetails(check.type, check.zone, check.value, 'simulation');
    const incident: DemoIncident = {
      id: `incident-${++state.sequence}`,
      kind: check.kind,
      name: check.name,
      zone: check.zone,
      severity: check.kind === 'fire' ? 'critical' : 'warning',
      status: 'active',
      message:
        check.kind === 'waterUsage'
          ? `Simulated water flow ${check.value} L/min exceeds the configured ${check.threshold} L/min limit.`
          : response.message,
      recommendation:
        check.kind === 'waterUsage'
          ? 'Maintenance: inspect the flow meter and unexpected consumption before adjusting the limit.'
          : response.recommendation,
      source: 'simulation',
      createdAt: now,
    };
    state.incidents.unshift(incident);
    state.incidents = state.incidents.slice(0, 40);
    activity(
      state,
      'Building Monitor',
      `${check.name} · ${check.value} ≥ ${check.threshold}. Simulated reading.`,
      now,
    );
    const plan = effectivePlan(state);
    activity(
      state,
      'Guardian',
      check.kind === 'leak' || check.kind === 'fire'
        ? `East route excluded by the scenario. ${plan ? `${evacuationPlans[plan].name} is scenario-clear; stairs are not step-free.` : 'No configured route is available. Request on-site assistance.'}`
        : 'Usage threshold crossed; no evacuation route is excluded by this rule.',
      now,
    );
    activity(state, 'Maintenance', incident.recommendation, now);
    if (check.kind === 'fire' || check.kind === 'leak')
      activity(
        state,
        'Security',
        'Demo East Exit blocked; North Exit available in the configured scenario. Coordinate on-site checks. No doors or alarms are controlled.',
        now,
      );
  }
}
export function transitionProtection(
  previous: ProtectionState,
  input: ProtectionAction,
  now = new Date().toISOString(),
): ProtectionState {
  const action = actionSchema.parse(input);
  const state = structuredClone(previous);
  // Snapshots saved before incident command get their plan and team records first.
  syncCommand(state, now);
  switch (action.action) {
    case 'accept-model':
      state.modelAccepted = true;
      activity(state, 'Design', 'Representative HAVEN model selected for this facility.', now);
      break;
    case 'configure': {
      if (!state.modelAccepted) throw new Error('Choose a model before configuring protections.');
      if (state.deployed) throw new Error('Return to configuration before changing protections.');
      if (!Object.values(action.config).some((p) => p.enabled))
        throw new Error('Enable at least one protection.');
      state.config = action.config;
      state.configured = true;
      state.placed = false;
      evaluate(state, now);
      activity(state, 'Configuration', 'Protection thresholds saved for this facility.', now);
      break;
    }
    case 'place':
      if (state.deployed) throw new Error('Return to configuration before changing the route.');
      if (!state.configured) throw new Error('Configure protections first.');
      if (!routeAvailability(state)[action.plan])
        throw new Error('This route is blocked in the active scenario.');
      state.plan = action.plan;
      if (action.placement) state.placement = action.placement;
      state.placed = true;
      activity(
        state,
        'Guardian',
        `${evacuationPlans[state.plan].name} selected from the predefined demo routes.`,
        now,
      );
      if (action.placement)
        activity(
          state,
          'Configuration',
          `DataBot placed in the ${databotPlacements[action.placement].name}, Level 4.`,
          now,
        );
      break;
    case 'deploy':
      if (!state.modelAccepted || !state.configured || !state.placed)
        throw new Error('Select a model, configure protections and confirm a route first.');
      state.deployed = true;
      state.deployedAt = now;
      evaluate(state, now);
      activity(
        state,
        'Building Monitor',
        'Simulation monitoring deployed. No hardware or external agents are connected.',
        now,
      );
      break;
    case 'reconfigure':
      state.deployed = false;
      activity(
        state,
        'Configuration',
        'Returned to protection setup. Incident records retained.',
        now,
      );
      break;
    case 'trigger':
      if (!state.configured)
        throw new Error('Configure protections before simulating an incident.');
      if (action.kind !== 'usage' && !state.config[action.kind].enabled)
        throw new Error('Enable this protection before triggering its demo.');
      if (action.kind === 'usage') {
        if (!state.config.electricity.enabled && !state.config.waterUsage.enabled)
          throw new Error('Enable usage monitoring first.');
        state.readings.electricity = 620;
        state.readings.waterUsage = 75;
      } else state.readings[action.kind] = demoScenarios[action.kind].value;
      state.recovering = false;
      evaluate(state, now);
      break;
    case 'acknowledge': {
      const incident = state.incidents.find(
        (i) => i.id === action.incidentId && i.status !== 'resolved',
      );
      if (!incident) throw new Error('Active incident not found.');
      incident.status = 'acknowledged';
      activity(
        state,
        'Operator',
        `${incident.name} acknowledged. Hazard and route exclusions remain active.`,
        now,
      );
      break;
    }
    case 'reset':
      state.readings = { ...(state.baseline || initialProtectionState(state.facility).readings) };
      for (const incident of activeIncidents(state)) incident.status = 'resolved';
      state.recovering = true;
      evaluate(state, now);
      activity(
        state,
        'Recovery',
        'Simulation readings reset. Review the restored scenario before completing recovery.',
        now,
      );
      break;
    case 'finish-recovery':
      if (!state.recovering || activeIncidents(state).length)
        throw new Error('Resolve active threshold conditions before completing recovery.');
      state.recovering = false;
      activity(
        state,
        'Recovery',
        'Demo recovery checked. Simulated building state returned to healthy.',
        now,
      );
      break;
    case 'approve-plan': {
      if (!state.deployed) throw new Error('Deploy monitoring before approving a response.');
      const plan = responsePlan(state);
      if (!plan || !state.response) throw new Error('There is no response plan to approve.');
      if (plan.key !== action.key)
        throw new Error('Conditions changed. Review the updated response plan before approving.');
      if (state.response.status === 'approved') throw new Error('This plan is already approved.');
      state.response.status = 'approved';
      state.response.approvedAt = now;
      activity(
        state,
        'Operator',
        `Response plan ${state.response.id} approved. ${plan.lifeSafety ? `Staff guidance published: ${plan.instruction}` : 'Maintenance review recorded.'}`,
        now,
      );
      break;
    }
    case 'team-update': {
      const team = state.team;
      if (!team || !primaryIncident(state)) throw new Error('There is no active incident to report on.');
      if (action.team === 'maintenance') {
        const next = MAINTENANCE_STEPS[MAINTENANCE_STEPS.indexOf(team.maintenance.status) + 1];
        if (!next) throw new Error('Maintenance has already reported its investigation.');
        team.maintenance = { status: next, updatedAt: now };
        activity(state, 'Maintenance', `${team.workOrder} · ${MAINTENANCE_REPORTS[next]} Simulated team report.`, now);
      } else {
        const next = SECURITY_STEPS[SECURITY_STEPS.indexOf(team.security.status) + 1];
        if (!next) throw new Error('Security is already on scene.');
        team.security = { status: next, updatedAt: now };
        activity(state, 'Security', `${SECURITY_REPORTS[next]} Simulated team report.`, now);
      }
      break;
    }
    case 'emergency-call': {
      const primary = primaryIncident(state);
      if (!state.deployed || !primary) throw new Error('An active incident is required.');
      if (state.call?.incidentId === primary.id)
        throw new Error('A simulated call already exists for this incident.');
      state.call = emergencyCall(state, primary, now);
      activity(
        state,
        'Dispatch',
        `Simulated emergency-services call ${state.call.id} completed. No real call was made.`,
        now,
      );
      break;
    }
  }
  syncCommand(state, now);
  state.revision++;
  return state;
}
