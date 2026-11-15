import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardwareCopy, isDataCenter } from '../src/lib/hardware/copy';

test('hardware: data centers keep the data-hall wording and the grid workflow', () => {
  for (const t of ['Data center', 'data centre', 'Hyperscale Data Center']) assert.equal(isDataCenter(t), true);
  const c = hardwareCopy('Data center');
  assert.equal(c.dataCenter, true);
  assert.equal(c.leak.title, 'Coolant loop');
  assert.match(c.people.empty, /racks/);
});

test('hardware: every other project type gets the same sensors in plain words', () => {
  for (const t of ['Student housing', 'Wind farm', 'Solar farm', 'Community park', 'Commercial', '', null, undefined]) {
    const c = hardwareCopy(t);
    assert.equal(c.dataCenter, false, String(t));
    assert.equal(c.leak.title, 'Water leak');
    assert.doesNotMatch(`${c.climate.title} ${c.fan.title} ${c.people.title} ${c.people.empty}`, /rack|hall|aisle|server/i);
  }
});
