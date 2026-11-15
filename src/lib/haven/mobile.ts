// The phone app's view of a deployed facility: the stored HAVEN state plus everything Dashboard 2
// derives from it (severity, response plan, routes, systems), so the app shows HAVEN's own rules
// instead of re-implementing them. Reached from the network only through
// scripts/mobile-gateway.mjs; the web app itself stays on 127.0.0.1.
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http';
import { sensorDefaults } from '../monitoring-rules';
import { databotPlacements, demoScenarios, evacuationPlans, levelY, monitoringPoints } from './config';
import {
  activeIncidents,
  buildingHealth,
  effectivePlan,
  facilitySystems,
  operationsHealth,
  primaryIncident,
  responsePlan,
  routeAvailability,
  severity,
  type ProtectionAction,
  type ProtectionState,
} from './engine';

/** Bearer-token check for the phone routes. Disabled until MOBILE_API_KEY is set. */
export function requireMobileKey(req: Request) {
  const key = process.env.MOBILE_API_KEY;
  if (!key) throw new HttpError(503, 'Phone access is disabled. Set MOBILE_API_KEY.');
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (
    Buffer.byteLength(token) !== Buffer.byteLength(key) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(key))
  )
    throw new HttpError(401, 'Invalid phone access token.');
}

/** What the phone may do: respond to incidents and run the demo triggers. Setup stays on desktop. */
export const MOBILE_ACTIONS = new Set<ProtectionAction['action']>([
  'trigger',
  'acknowledge',
  'reset',
  'finish-recovery',
  'approve-plan',
  'team-update',
  'emergency-call',
]);

// Level 4 plan coordinates (x, z in metres of the sample twin) for the phone's floor plan.
const level4 = levelY(4) + 0.3;
const plan2d = ([x, , z]: readonly [number, number, number]): [number, number] => [x, z];

export function mobileView(state: ProtectionState) {
  const availability = routeAvailability(state);
  const hazards = new Set(activeIncidents(state).map((i) => i.kind));
  const c = state.config;
  return {
    facility: state.facility,
    revision: state.revision,
    mode: state.mode,
    deployed: state.deployed,
    recovering: state.recovering,
    health: buildingHealth(state),
    severity: severity(state),
    readings: state.readings,
    limits: { electricity: c.electricity.limit, waterUsage: c.waterUsage.limit },
    thresholds: { leak: sensorDefaults.water.threshold, fire: sensorDefaults.fire.threshold },
    enabled: {
      electricity: c.electricity.enabled,
      waterUsage: c.waterUsage.enabled,
      leak: c.leak.enabled,
      fire: c.fire.enabled,
    },
    incidents: state.incidents.slice(0, 12),
    primaryIncidentId: primaryIncident(state)?.id ?? null,
    plan: responsePlan(state),
    route: effectivePlan(state),
    routes: Object.values(evacuationPlans).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      stepFree: r.stepFree,
      available: availability[r.id],
      path: r.points.filter((p) => p[1] === level4).map(plan2d),
    })),
    team: state.team ?? null,
    call: state.call ?? null,
    operations: operationsHealth(state),
    systems: facilitySystems(state),
    timeline: state.timeline.slice(0, 30),
    floor: {
      points: monitoringPoints.map((p) => ({
        id: p.id,
        label: p.label,
        protection: p.protection,
        zone: p.zone,
        at: plan2d(p.position),
      })),
      hazards: (['leak', 'fire'] as const)
        .filter((kind) => hazards.has(kind))
        .map((kind) => ({ kind, at: plan2d(demoScenarios[kind].hazardPosition) })),
      placement: state.placement
        ? {
            name: databotPlacements[state.placement].name,
            at: databotPlacements[state.placement].plan,
          }
        : null,
    },
  };
}
