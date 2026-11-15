import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeIncidents,
  buildingHealth,
  defaultProtections,
  effectivePlan,
  initialProtectionState,
  routeAvailability,
  transitionProtection,
} from '../src/lib/haven/engine';
const facility = {
  id: 'test-facility',
  name: 'Test facility',
  city: 'Houston',
  type: 'Data center',
};
const now = '2026-11-14T12:00:00.000Z';
function configured() {
  let state = transitionProtection(
    initialProtectionState(facility),
    { action: 'accept-model' },
    now,
  );
  return transitionProtection(
    state,
    { action: 'configure', config: structuredClone(defaultProtections) },
    now,
  );
}
test('HAVEN requires model, protections and a route before deployment', () => {
  const initial = initialProtectionState(facility);
  assert.throws(() => transitionProtection(initial, { action: 'deploy' }), /Select a model/);
  assert.throws(
    () => transitionProtection(initial, { action: 'configure', config: defaultProtections }),
    /Choose a model/,
  );
  const state = transitionProtection(configured(), { action: 'place', plan: 'east' });
  assert.equal(transitionProtection(state, { action: 'deploy' }).deployed, true);
  assert.equal(initial.modelAccepted, false);
});
test('HAVEN excludes configured hazard routes and retains critical state on acknowledgement', () => {
  let state = configured();
  state = transitionProtection(state, { action: 'trigger', kind: 'leak' }, now);
  assert.equal(buildingHealth(state), 'Warning');
  assert.deepEqual(routeAvailability(state), { east: false, north: true });
  assert.equal(effectivePlan(state), 'north');
  assert.throws(() => transitionProtection(state, { action: 'place', plan: 'east' }), /blocked/);
  state = transitionProtection(state, { action: 'trigger', kind: 'fire' }, now);
  assert.equal(buildingHealth(state), 'Critical incident');
  const fire = state.incidents.find((i) => i.kind === 'fire')!;
  state = transitionProtection(state, { action: 'acknowledge', incidentId: fire.id }, now);
  state = transitionProtection(state, { action: 'trigger', kind: 'fire' }, now);
  assert.equal(state.incidents.filter((i) => i.kind === 'fire').length, 1);
  assert.equal(buildingHealth(state), 'Critical incident');
  assert.equal(routeAvailability(state).east, false);
  assert.equal(
    state.incidents.every((i) => i.source === 'simulation'),
    true,
  );
});
test('HAVEN disabling a protection does not erase an existing hazard', () => {
  let state = transitionProtection(configured(), { action: 'trigger', kind: 'fire' }, now);
  state = transitionProtection(
    state,
    { action: 'configure', config: { ...defaultProtections, fire: { enabled: false } } },
    now,
  );
  assert.equal(buildingHealth(state), 'Critical incident');
  assert.equal(routeAvailability(state).east, false);
  assert.throws(
    () => transitionProtection(state, { action: 'trigger', kind: 'fire' }),
    /Enable this protection/,
  );
});
test('HAVEN evaluates usage limits separately from moisture and fire and preserves recovery', () => {
  let state = configured();
  state = transitionProtection(state, { action: 'trigger', kind: 'usage' }, now);
  assert.equal(activeIncidents(state).length, 2);
  assert.equal(state.readings.leak, 0);
  assert.deepEqual(routeAvailability(state), { east: true, north: true });
  state = transitionProtection(state, { action: 'reset' }, now);
  assert.equal(buildingHealth(state), 'Recovering');
  assert.equal(activeIncidents(state).length, 0);
  state = transitionProtection(state, { action: 'finish-recovery' }, now);
  assert.equal(buildingHealth(state), 'Healthy');
  assert.equal(
    state.timeline.some((e) => e.agent === 'Recovery'),
    true,
  );
});
test('HAVEN does not report healthy when a configured limit is below baseline readings', () => {
  let state = configured();
  state = transitionProtection(
    state,
    {
      action: 'configure',
      config: { ...defaultProtections, electricity: { enabled: true, limit: 200 } },
    },
    now,
  );
  assert.equal(buildingHealth(state), 'Warning');
  state = transitionProtection(state, { action: 'reset' }, now);
  assert.equal(buildingHealth(state), 'Warning');
  assert.throws(() => transitionProtection(state, { action: 'finish-recovery' }), /Resolve active/);
  assert.throws(
    () =>
      transitionProtection(configured(), {
        action: 'configure',
        config: { ...defaultProtections, electricity: { enabled: true, limit: -1 } },
      }),
    /Too small/,
  );
});
