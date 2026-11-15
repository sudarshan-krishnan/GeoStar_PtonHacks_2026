import { test, expect, type APIRequestContext } from '@playwright/test';
import { rankSites } from '../src/lib/engine';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Project } from '../src/lib/types';
async function create(request: APIRequestContext, brief: string): Promise<Project> {
  const response = await request.post('/api/projects', { data: { brief } });
  expect(response.status()).toBe(201);
  return response.json();
}
async function change(
  request: APIRequestContext,
  id: string,
  data: Record<string, unknown>,
  path = '',
  method = 'PATCH',
): Promise<Project> {
  const r = await request.fetch(`/api/projects/${id}${path}`, { method, data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test('each demonstration completes discovery, design, monitoring, assistant, PDF and persistence', async ({
  request,
}) => {
  for (const brief of [
    'Student dormitory near Princeton with 200 beds and a $28 million budget',
    'A 100 MW data center near Princeton with a $900 million budget',
    'Community park near Princeton for 500 visitors and a $8 million budget',
  ]) {
    let p = await create(request, brief);
    const id = p.id;
    expect(p.sites).toHaveLength(4);
    const site = rankSites(p.sites, p.weights)[0];
    const before = await request.patch(`/api/projects/${id}`, { data: { action: 'generate' } });
    expect(before.status()).toBe(400);
    p = await change(request, id, { action: 'select-site', siteId: site.id });
    p = await change(request, id, { action: 'generate' });
    expect(p.designs).toHaveLength(3);
    const edited = { ...p.designs[0], width: p.designs[0].width - 1 };
    p = await change(request, id, { action: 'save-design', design: edited });
    expect(p.designs[0].width).toBe(edited.width);
    p = await change(request, id, { action: 'approve', designId: edited.id });
    expect(p.approvedDesignId).toBe(edited.id);
    expect(p.sensors.length).toBeGreaterThan(0);
    for (const kind of ['water-leak', 'overheating', 'fire-alarm'])
      p = await change(request, id, { kind }, '/simulate', 'POST');
    expect(p.incidents).toHaveLength(3);
    expect(p.incidents.find((i) => i.kind === 'fire-alarm')?.severity).toBe('critical');
    const repeated = await change(request, id, { kind: 'water-leak' }, '/simulate', 'POST');
    expect(repeated.incidents).toHaveLength(3);
    p = await change(
      request,
      id,
      { incidentId: p.incidents[0].id, status: 'acknowledged' },
      '/incidents',
    );
    expect(p.incidents[0].status).toBe('acknowledged');
    p = await change(
      request,
      id,
      { incidentId: p.incidents[0].id, status: 'resolved' },
      '/incidents',
    );
    expect(p.incidents[0].status).toBe('resolved');
    p = await change(request, id, { kind: 'reset' }, '/simulate', 'POST');
    expect(p.incidents.every((i) => i.status === 'resolved')).toBeTruthy();
    expect(
      p.sensors.filter((s) => s.source === 'simulation').every((s) => s.value < s.threshold),
    ).toBeTruthy();
    const answer = await request.post(`/api/projects/${id}/assistant`, {
      data: { question: 'What if land prices increase 20%?' },
    });
    expect(answer.ok()).toBeTruthy();
    expect((await answer.json()).answer).toContain('20%');
    const pdf = await request.get(`/api/projects/${id}/report`);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    const buffer = await pdf.body();
    expect((await PDFDocument.load(buffer)).getPageCount()).toBeGreaterThan(2);
    mkdirSync('output/pdf', { recursive: true });
    writeFileSync(`output/pdf/${p.type}-demo-report.pdf`, buffer);
    const restored = await (await request.get(`/api/projects/${id}`)).json();
    expect(restored.approvedDesignId).toBe(edited.id);
    expect(restored.simulations.length).toBeGreaterThanOrEqual(5);
    expect(restored.messages).toHaveLength(2);
  }
});
test('telemetry authentication, device binding, live SSE, sensor CRUD and tenant boundaries', async ({
  request,
}) => {
  let p = await create(request, 'Student dormitory near Princeton with 200 beds');
  p = await change(request, p.id, { action: 'select-site', siteId: 'site-a' });
  p = await change(request, p.id, { action: 'generate' });
  p = await change(request, p.id, { action: 'approve', designId: 'balanced' });
  const other = await create(request, 'Community park near Princeton for 500 visitors');
  const s = p.sensors.find((s) => s.type === 'temperature')!;
  const payload = { projectId: p.id, sensorId: s.id, deviceId: 'test-device-01', value: 48 };
  expect((await request.post('/api/telemetry', { data: payload })).status()).toBe(401);
  const headers = { Authorization: `Bearer ${process.env.TELEMETRY_API_KEY}` };
  expect((await request.post('/api/telemetry', { headers, data: payload })).status()).toBe(403);
  p = await change(
    request,
    p.id,
    { action: 'update', sensorId: s.id, x: 1, z: 2, floor: 1, deviceId: 'test-device-01' },
    '/sensors',
    'POST',
  );
  const abort = new AbortController(),
    response = await fetch(`http://127.0.0.1:3100/api/projects/${p.id}/events`, {
      signal: abort.signal,
    });
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  expect((await request.post('/api/telemetry', { headers, data: payload })).status()).toBe(200);
  const reader = response.body!.getReader();
  let stream = '';
  try {
    for (let i = 0; i < 10 && !stream.includes('test-device-01'); i++) {
      const { value } = await reader.read();
      stream += new TextDecoder().decode(value);
    }
  } finally {
    abort.abort();
  }
  expect(stream).toContain('test-device-01');
  expect(stream).toContain('"value":48');
  p = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(p.sensors.find((x) => x.id === s.id)?.source).toBe('hardware');
  expect(p.incidents.find((i) => i.sensorId === s.id)?.source).toBe('hardware');
  p = await change(request, p.id, { kind: 'reset' }, '/simulate', 'POST');
  expect(p.sensors.find((x) => x.id === s.id)?.value).toBe(48);
  expect(p.incidents.find((i) => i.sensorId === s.id)?.status).toBe('open');
  expect(
    (await request.post('/api/telemetry', { headers, data: { ...payload, value: 200 } })).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/projects/${other.id}/sensors`, {
        data: { action: 'delete', sensorId: s.id },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/projects/${p.id}/sensors`, {
        data: { action: 'update', sensorId: s.id, x: 999 },
      })
    ).status(),
  ).toBe(400);
  const count = p.sensors.length;
  p = await change(
    request,
    p.id,
    {
      action: 'add',
      name: 'Test custom leak',
      type: 'water',
      zone: 'Mechanical room',
      x: 1,
      z: 1,
      floor: 1,
    },
    '/sensors',
    'POST',
  );
  expect(p.sensors.length).toBe(count + 1);
  const added = p.sensors.find((s) => s.name === 'Test custom leak')!;
  p = await change(request, p.id, { action: 'delete', sensorId: added.id }, '/sensors', 'POST');
  expect(p.sensors.length).toBe(count);
});
test('validation blocks malformed inputs, cross-origin writes and unrelated sensor modifications', async ({
  request,
}) => {
  expect((await request.post('/api/projects', { data: { brief: 'bad' } })).status()).toBe(400);
  expect(
    (
      await request.post('/api/projects', {
        headers: { Origin: 'https://untrusted.example' },
        data: { brief: 'Create student housing' },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get('/api/projects/missing')).status()).toBe(404);
});
test('judge journey in the browser: create, score, model, save, simulate, export and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Find it. Design it. Protect it.' }),
  ).toBeVisible();
  await page.screenshot({ path: 'output/qa/landing-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Start building', exact: false }).first().click();
  await page
    .getByRole('textbox', { name: 'Development brief' })
    .fill(
      'Build a student dormitory near Princeton with 200 beds, 4 floors, a $28 million budget and great walkability.',
    );
  await page.getByRole('button', { name: 'Find the possibilities' }).click();
  await expect(
    page.getByRole('heading', { name: 'Good things start in the right place.' }),
  ).toBeVisible();
  await expect(page.locator('.candidate-card')).toHaveCount(4);
  await page.screenshot({ path: 'output/qa/discover-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Scoring priorities' }).click();
  await page.getByRole('slider', { name: 'walkability weight', exact: true }).fill('40');
  await page.getByRole('button', { name: 'Apply priorities' }).click();
  await page.getByRole('button', { name: 'Select this site', exact: true }).click();
  await page.getByRole('button', { name: 'Generate concepts', exact: true }).click();
  await expect(page.locator('.alternative-card')).toHaveCount(3);
  await expect(page.locator('.scene-container canvas')).toBeVisible();
  const before = await page.locator('.design-summary .stat').first().innerText();
  await page.getByRole('spinbutton', { name: 'Floors', exact: true }).fill('5');
  await expect(page.locator('.design-summary .stat').first()).not.toHaveText(before);
  await page.getByRole('button', { name: 'Save concept', exact: true }).click();
  await expect(page.getByText('SAVED CONCEPT', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/qa/design-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '2D site plan', exact: true }).click();
  await expect(
    page.locator('svg[aria-label=' + JSON.stringify('Interactive conceptual site plan') + ']'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Approve & plan protection', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A little foresight. A lot more confidence.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Water leak', exact: false }).click();
  await expect(page.locator('.incident-card')).toHaveCount(1);
  await expect(page.locator('.incident-card').first()).toContainText('water leak');
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(page.locator('.incident-card .status-pill')).toHaveText('acknowledged');
  await page.screenshot({ path: 'output/qa/protect-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.locator('.incident-card .status-pill')).toHaveText('resolved');
  await page.getByRole('button', { name: 'Ask PlotStar', exact: true }).first().click();
  await page.getByRole('button', { name: 'What if I add two more floors?', exact: true }).click();
  await expect(page.locator('.chat-message.assistant').last()).toContainText('Adding 2 floors');
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Project report', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'The whole picture, in one place.' }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'A little foresight. A lot more confidence.' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile landing and dashboard fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open workspace' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/qa/landing-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'A place for big ideas.' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/qa/dashboard-mobile.png', fullPage: true });
});
test('mobile workspace supports discovery, concept approval, sensor editing and report', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const p = await create(
    request,
    'A community park near Princeton for 500 visitors and $8 million budget',
  );
  await page.goto(`/projects/${p.id}`);
  await expect(page.locator('.candidate-card')).toHaveCount(4);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Select this site', exact: true }).click();
  await page.getByRole('button', { name: 'Generate concepts', exact: true }).click();
  await expect(page.locator('.alternative-card')).toHaveCount(3);
  await page.getByRole('button', { name: '2D site plan', exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/qa/design-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve & plan protection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your sensor network.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add sensor', exact: true }).click();
  await page.getByLabel('Sensor name', { exact: true }).fill('Pavilion plumbing leak');
  await page.getByLabel('X position (m)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Add sensor', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.sensor-table')).toContainText('Pavilion plumbing leak');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/qa/protect-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Project report', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Export PDF', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
