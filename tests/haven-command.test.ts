import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultProtections,
  facilitySystems,
  initialProtectionState,
  operationsHealth,
  planKey,
  primaryIncident,
  responsePlan,
  severity,
  transitionProtection,
  type ProtectionAction,
  type ProtectionState,
} from '../src/lib/haven/engine';

const facility = { id: 'cmd-facility', name: 'Command test', city: 'Houston', type: 'Data center' };
const now = '2026-11-14T12:00:00.000Z';
const run = (state: ProtectionState, ...actions: ProtectionAction[]) =>
  actions.reduce((s, action) => transitionProtection(s, action, now), state);
function deployed() {
  return run(
    initialProtectionState(facility),
    { action: 'accept-model' },
    { action: 'configure', config: structuredClone(defaultProtections) },
    { action: 'place', plan: 'east' },
    { action: 'deploy' },
  );
}
const system = (state: ProtectionState, id: string) => facilitySystems(state).find((s) => s.id === id)!;

test('HAVEN command: a healthy deployment has no plan, team or severity', () => {
  const state = deployed();
  assert.equal(responsePlan(state), null);
  assert.equal(state.response, undefined);
  assert.equal(state.team, undefined);
  assert.deepEqual(severity(state), { level: 0, label: 'Normal', reasons: [] });
  assert.equal(operationsHealth(state).percent, 100);
});

test('HAVEN command: a leak isolates E1 via riser R-3 and proposes a plan needing approval', () => {
  const state = run(deployed(), { action: 'trigger', kind: 'leak' });
  assert.equal(severity(state).level, 2);
  assert.equal(system(state, 'R3').status, 'affected');
  assert.equal(system(state, 'E1').status, 'unavailable');
  assert.match(system(state, 'E1').detail, /riser R-3/);
  assert.equal(system(state, 'ROUTE-EAST').status, 'unavailable');
  const plan = responsePlan(state)!;
  assert.equal(plan.status, 'pending_approval');
  assert.equal(plan.id, state.response!.id);
  assert.match(plan.instruction, /North Exit/);
  assert.equal(state.team?.maintenance.status, 'open');
  assert.equal(state.team?.security.status, 'pending');
  assert.ok(state.timeline.some((e) => /Generated response plan/.test(e.message)));
  assert.ok(operationsHealth(state).percent! < 100);
});

test('HAVEN command: approval publishes guidance and marks the route re-routed', () => {
  let state = run(deployed(), { action: 'trigger', kind: 'leak' });
  const key = planKey(state)!;
  state = run(state, { action: 'approve-plan', key });
  assert.equal(responsePlan(state)!.status, 'approved');
  assert.equal(state.response!.approvedAt, now);
  assert.equal(system(state, 'ROUTE-NORTH').status, 'rerouted');
  assert.throws(() => run(state, { action: 'approve-plan', key }), /already approved/);
});

test('HAVEN command: a new hazard replaces an approved plan with one that needs review', () => {
  let state = run(deployed(), { action: 'trigger', kind: 'leak' });
  const leakKey = planKey(state)!;
  state = run(state, { action: 'approve-plan', key: leakKey }, { action: 'trigger', kind: 'fire' });
  assert.equal(severity(state).level, 4);
  assert.equal(primaryIncident(state)!.kind, 'fire');
  assert.equal(responsePlan(state)!.status, 'pending_approval');
  assert.notEqual(planKey(state), leakKey);
  assert.throws(() => run(state, { action: 'approve-plan', key: leakKey }), /Conditions changed/);
  assert.match(system(state, 'E1').detail, /fire-safety/);
});

test('HAVEN command: team reports advance in order and stop at the last step', () => {
  let state = run(deployed(), { action: 'trigger', kind: 'fire' });
  state = run(state, { action: 'team-update', team: 'maintenance' }, { action: 'team-update', team: 'maintenance' });
  assert.equal(state.team!.maintenance.status, 'investigated');
  assert.throws(() => run(state, { action: 'team-update', team: 'maintenance' }), /already reported/);
  state = run(
    state,
    { action: 'team-update', team: 'security' },
    { action: 'team-update', team: 'security' },
    { action: 'team-update', team: 'security' },
  );
  assert.equal(state.team!.security.status, 'on_scene');
});

test('HAVEN command: a second hazard keeps the team progress already reported', () => {
  let state = run(deployed(), { action: 'trigger', kind: 'leak' }, { action: 'team-update', team: 'maintenance' });
  const workOrder = state.team!.workOrder;
  state = run(state, { action: 'trigger', kind: 'fire' });
  assert.equal(state.team!.workOrder, workOrder);
  assert.equal(state.team!.maintenance.status, 'in_progress');
  assert.equal(state.team!.incidentId, primaryIncident(state)!.id);
});

test('HAVEN command: the emergency call is simulated, once per incident, and cleared on reset', () => {
  let state = run(deployed(), { action: 'trigger', kind: 'fire' }, { action: 'emergency-call' });
  assert.equal(state.call?.mode, 'simulated');
  assert.equal(state.call?.incidentId, primaryIncident(state)!.id);
  assert.match(state.call!.report, /not contacted/);
  assert.throws(() => run(state, { action: 'emergency-call' }), /already exists/);
  state = run(state, { action: 'reset' });
  assert.equal(state.call, undefined);
  assert.equal(state.response, undefined);
  assert.equal(state.team, undefined);
});

test('HAVEN command: usage-only incidents never exclude a route', () => {
  const state = run(deployed(), { action: 'trigger', kind: 'usage' });
  const plan = responsePlan(state)!;
  assert.equal(plan.lifeSafety, false);
  assert.equal(severity(state).level, 1);
  assert.equal(system(state, 'ROUTE-EAST').status, 'operational');
  assert.equal(system(state, 'POWER').status, 'affected');
});

test('HAVEN command: snapshots saved before incident command still approve', () => {
  const legacy = run(deployed(), { action: 'trigger', kind: 'leak' });
  delete legacy.response;
  delete legacy.team;
  const state = run(legacy, { action: 'approve-plan', key: planKey(legacy)! });
  assert.equal(responsePlan(state)!.status, 'approved');
});
