import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantAnswer,
  designMetrics,
  finances,
  generateDesigns,
  makeSites,
  parseBrief,
  rankSites,
  requirementsSchema,
  scoreSite,
  weightDefaults,
} from './src/lib/engine';
import { sensorPlan, incidentDetails } from './src/lib/monitoring';
import { reportData } from './src/lib/report';
import type { DevelopmentType, Project } from './src/lib/types';
test('natural-language briefs extract independent development types, units, budgets and floors', () => {
  const d = parseBrief(
    'Build a 200-bed student dorm near Princeton with a budget of $28 million and 5 floors',
  );
  // Hyphenated capacity also supported by the parser after normalization.
  assert.equal(d.type, 'residential');
  assert.equal(d.requirements.budget, 28e6);
  assert.equal(d.requirements.floors, 5);
  const dc = parseBrief('Build a 100 MW data center near Princeton with a $900 million budget');
  assert.equal(dc.type, 'data-center');
  assert.equal(dc.requirements.capacity, 100);
  assert.equal(dc.requirements.budget, 900e6);
  assert.equal(parseBrief('Create a community park near Princeton for 500 visitors').type, 'park');
  assert.equal(
    parseBrief('Plan a commercial retail store with 10000 sqft').requirements.capacity,
    10000,
  );
});
test('different purposes rank different sites using distinct criteria', () => {
  const winner = (t: DevelopmentType) => rankSites(makeSites(t), weightDefaults[t])[0].id;
  assert.equal(winner('residential'), 'site-a');
  assert.equal(winner('data-center'), 'site-b');
  assert.equal(winner('park'), 'site-c');
  assert.equal(winner('commercial'), 'site-d');
});
test('scores normalize weights and respond to reweighting', () => {
  const s = makeSites('residential')[0];
  assert.equal(scoreSite(s, { walkability: 1 }), 94);
  assert.equal(scoreSite(s, { walkability: 10 }), 94);
  assert.equal(scoreSite(s, { affordability: 1 }), 64);
  assert.equal(scoreSite(s, {}), 0);
});
test('geometry is calculated from actual dimensions and floors', () => {
  const { requirements: r } = parseBrief('200 beds near Princeton'),
    s = makeSites('residential')[0],
    d = generateDesigns('residential', r, s)[0],
    m = designMetrics(d, s, 'residential');
  assert.equal(m.gfa, d.width * d.depth * d.floors);
  assert.equal(m.footprint, d.width * d.depth);
  assert.equal(m.capacity, Math.floor(m.gfa / 34));
  assert.equal(
    designMetrics({ ...d, floors: d.floors + 2 }, s, 'residential').gfa,
    m.gfa + d.width * d.depth * 2,
  );
  assert.equal(m.warnings.length, 0);
});
test('site fit detects rotated bounds and over-allocation', () => {
  const { requirements: r } = parseBrief('200 beds near Princeton'),
    s = makeSites('residential')[0],
    d = generateDesigns('residential', r, s)[0];
  assert.ok(
    designMetrics({ ...d, width: 130, depth: 100, rotation: 90 }, s, 'residential').warnings.length,
  );
  assert.ok(designMetrics({ ...d, green: 90, parking: 500 }, s, 'residential').warnings.length);
});
test('budget changes the efficient concept', () => {
  const { requirements: r } = parseBrief('200 beds near Princeton'),
    s = makeSites('residential')[0],
    normal = generateDesigns('residential', r, s)[2],
    tight = generateDesigns('residential', { ...r, budget: 9e6 }, s)[2];
  assert.ok(tight.width * tight.depth < normal.width * normal.depth);
  assert.ok(designMetrics(tight, s, 'residential').cost + s.landCost <= 9e6);
});
test('financial arithmetic, land-price scenario and capacity cap are coherent', () => {
  const { requirements: r } = parseBrief('200 beds near Princeton'),
    s = makeSites('residential')[0],
    d = generateDesigns('residential', r, s)[0],
    f = finances('residential', r, s, d),
    shock = finances('residential', r, s, d, 1.2);
  assert.ok(Math.abs(shock.total - f.total - s.landCost * 0.2) < 0.001);
  assert.equal(shock.noi, f.noi);
  assert.ok(shock.yield < f.yield);
  assert.equal(
    f.revenue,
    Math.min(r.capacity, designMetrics(d, s, 'residential').capacity) *
      r.monthlyRate *
      12 *
      r.occupancy,
  );
  assert.equal(f.noi, f.revenue - f.expenses);
  assert.equal(f.yield, (f.noi / f.total) * 100);
});
test('park uses maintenance and social capacity rather than fake rental income', () => {
  const { requirements: r } = parseBrief('Community park for 500 visitors'),
    s = makeSites('park')[2],
    d = generateDesigns('park', r, s)[0],
    f = finances('park', r, s, d);
  assert.equal(f.revenue, 0);
  assert.ok(f.expenses > 0);
  assert.equal(f.payback, null);
  assert.ok(f.socialReach! > 0);
  assert.equal(d.floors, 1);
});
test('data center estimates include equipment and never imply grid verification', () => {
  const { requirements: r } = parseBrief('100 MW data center'),
    s = makeSites('data-center')[1],
    d = generateDesigns('data-center', r, s)[0];
  assert.ok(designMetrics(d, s, 'data-center').cost > 500e6);
  assert.match(s.risks.join(' '), /NOT been verified/);
});
test('sensors stay inside approved massing on every floor', () => {
  const { requirements: r } = parseBrief('200 beds'),
    site = makeSites('residential')[0],
    d = generateDesigns('residential', r, site)[0],
    sensors = sensorPlan('test', d, 'residential');
  assert.equal(sensors.length, d.floors * 7);
  for (const s of sensors) {
    assert.ok(Math.abs(s.x) <= d.width / 2);
    assert.ok(Math.abs(s.z) <= d.depth / 2);
    assert.ok(s.floor! >= 1 && s.floor! <= d.floors);
  }
});
test('fire incidents are critical and response does not actuate equipment', () => {
  const i = incidentDetails('fire', 'West wing', 1, 'simulation');
  assert.equal(i.severity, 'critical');
  assert.match(i.recommendation, /does not operate/);
  assert.equal(incidentDetails('water', 'Plant', 88, 'simulation').kind, 'water-leak');
});
test('requirements reject invalid monetary and physical assumptions', () => {
  const r = parseBrief('200 beds').requirements;
  assert.equal(requirementsSchema.safeParse({ ...r, floors: 0 }).success, false);
  assert.equal(requirementsSchema.safeParse({ ...r, occupancy: 1.2 }).success, false);
  assert.equal(requirementsSchema.safeParse({ ...r, budget: -100 }).success, false);
});
test('assistant and report use saved context and expose assumptions', () => {
  const b = parseBrief('Student dorm near Princeton with 200 beds'),
    sites = makeSites(b.type),
    designs = generateDesigns(b.type, b.requirements, sites[0]);
  const p = {
    ...b,
    id: 'test',
    brief: '200 beds',
    sites,
    designs,
    selectedSiteId: 'site-a',
    approvedDesignId: 'balanced',
    weights: weightDefaults[b.type],
    sensors: [],
    incidents: [],
    simulations: [],
    messages: [],
    stage: 'design',
    createdAt: '',
    updatedAt: '',
  } as Project;
  assert.match(assistantAnswer(p, 'What if land prices increase 20%?'), /20%/);
  assert.match(assistantAnswer(p, 'What happens if I add two more floors?'), /Adding 2 floors/);
  assert.match(assistantAnswer(p, 'Why is Site B better than Site A?'), /illustrative/);
  assert.equal(reportData(p).sections.length, 8);
  assert.match(reportData(p).sections.at(-1)!.text.join(' '), /illustrative/);
});
