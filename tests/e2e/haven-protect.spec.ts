import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  defaultProtections,
  type Facility,
  type ProtectionAction,
  type ProtectionState,
} from '../../src/lib/haven/engine';

const facility: Facility = {
  id: 'd2-northline-data-center-houston',
  name: 'Northline Campus',
  city: 'Houston, Texas',
  type: 'Data center',
};
const pathFor = (f: Facility) => `/api/protection/${f.id}`;
async function read(request: APIRequestContext, f = facility): Promise<ProtectionState> {
  const response = await request.get(
    `${pathFor(f)}?${new URLSearchParams({ name: f.name, city: f.city, type: f.type })}`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function prepare(request: APIRequestContext) {
  let state = await read(request);
  if (!state.modelAccepted) return;
  for (const command of [
    { action: 'reconfigure' },
    { action: 'configure', config: defaultProtections },
    { action: 'reset' },
    { action: 'finish-recovery' },
  ] as ProtectionAction[]) {
    const response = await request.patch(pathFor(facility), {
      data: { facility, revision: state.revision, command },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    state = await response.json();
  }
}
async function locate(page: Page) {
  await page.goto('/dashboard-2');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm selection', exact: true }).click();
}
test('HAVEN protects the selected facility, excludes hazardous routes and persists deployment', async ({
  page,
  request,
}) => {
  await prepare(request);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  mkdirSync('output/qa/dashboard-2/haven', { recursive: true });
  await locate(page);
  await page.getByRole('button', { name: 'Explore Design' }).click();
  await page
    .getByRole('navigation', { name: 'Design steps' })
    .getByRole('button', { name: /Model/ })
    .click();
  await expect(page.locator('.hv-design')).toContainText('Northline Campus');
  await expect(page.locator('.hv-canvas canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await page.screenshot({ path: 'output/qa/dashboard-2/haven/design-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Use this model|Continue to Protect/ }).click();
  const steps = page.getByRole('navigation', { name: 'Protect steps' });
  await steps.getByRole('button', { name: /Select/ }).click();
  await expect(steps.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await page.getByLabel('Electricity threshold').fill('450');
  await page.getByLabel('Water usage threshold').fill('45');
  await page.screenshot({ path: 'output/qa/dashboard-2/haven/select-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.al-review')).toContainText('Water Leak');
  await expect(page.locator('.al-review')).toContainText('Fire Detected');
  await page.getByLabel('DataBot placement').selectOption('east');
  await page.getByRole('radio', { name: 'North', exact: true }).click();
  await expect(page.locator('.al-review')).toContainText('Above 450 kW');
  await expect(page.locator('.al-review')).toContainText('Above 45 L/min');
  await expect(page.locator('.al-review')).toContainText('North Exit');
  expect((await read(request)).deployed).toBeFalsy();
  await page.screenshot({ path: 'output/qa/dashboard-2/haven/place-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).click();
  await expect(steps).toHaveCount(0);
  await expect(page.locator('.hv-command-bar')).toContainText('HAVEN COMMAND CENTER');
  await expect(page.locator('.hv-command-bar')).toContainText(facility.name);
  await expect(page.locator('.hv-command-bar')).toContainText('SIMULATION MODE');
  await expect(page.locator('.hv-health-banner')).toContainText('Healthy');
  await page.getByRole('button', { name: 'Trigger Water Leak', exact: true }).click();
  await expect(page.locator('.hv-health-banner')).toContainText('Warning');
  await expect(page.locator('.hv-route-summary')).toContainText('North Exit · scenario-clear');
  await page.getByRole('button', { name: 'Trigger Fire', exact: true }).click();
  await expect(page.locator('.hv-health-banner')).toContainText('Critical incident');
  await expect(page.locator('.hv-incident')).toHaveCount(2);
  await expect(page.locator('.hv-exit-chips .is-blocked')).toContainText('East Exit');
  await page
    .locator('.hv-incident')
    .filter({ hasText: 'Fire hazard detected' })
    .getByRole('button', { name: 'Acknowledge' })
    .click();
  await expect(page.locator('.hv-health-banner')).toContainText('Critical incident');
  await page.getByRole('button', { name: 'Trigger Fire', exact: true }).click();
  await expect(page.locator('.hv-incident')).toHaveCount(2);
  await expect(page.locator('.hv-timeline')).toContainText('Guardian');
  await expect(page.locator('.hv-timeline')).toContainText('Security');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: 'output/qa/dashboard-2/haven/critical-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Reset Simulation', exact: true }).click();
  await expect(page.locator('.hv-health-banner')).toContainText('Recovering');
  await page.getByRole('button', { name: 'Complete recovery', exact: true }).click();
  await expect(page.locator('.hv-health-banner')).toContainText('Healthy');
  await page.getByRole('button', { name: 'Usage spike', exact: true }).click();
  await expect(page.locator('.hv-health-banner')).toContainText('Warning');
  await expect(page.locator('.hv-metrics')).toContainText('620 kW');
  await page.getByRole('button', { name: 'Reset Simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Complete recovery', exact: true }).click();
  const saved = await read(request);
  expect(saved.deployed).toBeTruthy();
  expect(saved.config.electricity.limit).toBe(450);
  expect(saved.plan).toBe('north');
  expect(saved.placement).toBe('east');
  // A reload keeps the whole journey: every module stays checked.
  await page.goto('/dashboard-2');
  for (const name of ['Locate', 'Design', 'Protect', 'Deploy'])
    await expect(
      page
        .getByRole('navigation', { name: 'Planning modules' })
        .getByRole('button', { name: new RegExp(`^${name}.*Completed`) }),
    ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Planning modules' })
    .getByRole('button', { name: /^Deploy/ })
    .click();
  await expect(page.locator('.hv-command-bar')).toBeVisible();
  await expect(page.locator('.hv-metrics')).toContainText('Limit 450 kW');
  await page.getByRole('button', { name: 'Edit protections' }).click();
  await expect(page.getByRole('navigation', { name: 'Protect steps' })).toBeVisible();
  await expect(page.getByLabel('Electricity threshold')).toHaveValue('450');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('DataBot placement')).toHaveValue('east');
  // Reset asks for a second tap, then clears the preview and this project's saved HAVEN setup.
  const reset = page.locator('.d2-new-project');
  await reset.click();
  await expect(reset).toContainText('Tap again to start over');
  await reset.click();
  await expect(page.getByRole('navigation', { name: 'Locate steps' })).toBeVisible();
  for (const name of ['Design', 'Protect', 'Deploy'])
    await expect(
      page
        .getByRole('navigation', { name: 'Planning modules' })
        .getByRole('button', { name: new RegExp(`^${name}.*Pending`) }),
    ).toBeVisible();
  await expect.poll(async () => (await read(request)).modelAccepted).toBe(false);
  expect(errors).toEqual([]);
});

test('HAVEN configuration, 2D fallback and command center fit mobile', async ({
  page,
  request,
}) => {
  await prepare(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await locate(page);
  await page.getByRole('button', { name: 'Explore Design' }).click();
  await page
    .getByRole('navigation', { name: 'Design steps' })
    .getByRole('button', { name: /Model/ })
    .click();
  await page.getByRole('button', { name: /Use this model|Continue to Protect/ }).click();
  await page
    .getByRole('navigation', { name: 'Protect steps' })
    .getByRole('button', { name: /Select/ })
    .click();
  await page.locator('.al-card', { hasText: 'Fire Detected' }).locator('.al-card-main').click();
  await expect(page.getByRole('checkbox', { name: 'Fire Detected' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.al-review')).toContainText('Not monitored: Fire Detected');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Confirm Deploy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trigger Fire', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Trigger Water Leak', exact: true }).click();
  await expect(page.locator('.hv-health-banner')).toContainText('Warning');
  await page.getByRole('button', { name: '2D evacuation plan' }).click();
  await expect(
    page.getByRole('img', { name: 'Configured Level 4 demo evacuation plan' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'output/qa/dashboard-2/haven/command-mobile.png', fullPage: true });
  await page
    .getByRole('navigation', { name: 'Planning modules' })
    .getByRole('button', { name: /^Design/ })
    .click();
  await expect(page.locator('.hv-design')).toContainText(facility.name);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('protection API isolates facilities, validates deployment and rejects stale or cross-origin writes', async ({
  request,
}) => {
  const a = { ...facility, id: `haven-test-${Date.now()}-a` },
    b = { ...facility, id: `haven-test-${Date.now()}-b` };
  let state = await read(request, a);
  const send = async (command: ProtectionAction, status = 200) => {
    const response = await request.patch(pathFor(a), {
      data: { facility: a, revision: state.revision, command },
    });
    expect(response.status(), await response.text()).toBe(status);
    if (status === 200) state = await response.json();
  };
  await send({ action: 'deploy' }, 409);
  await send({ action: 'accept-model' });
  await send({
    action: 'configure',
    config: {
      ...defaultProtections,
      electricity: { enabled: true, limit: 400 },
      fire: { enabled: false },
    },
  });
  await send({ action: 'trigger', kind: 'fire' }, 409);
  const stale = await request.patch(pathFor(a), {
    data: { facility: a, revision: 0, command: { action: 'place', plan: 'north' } },
  });
  expect(stale.status()).toBe(409);
  await send({ action: 'place', plan: 'north' });
  await send({ action: 'deploy' });
  const other = await read(request, b);
  expect(other.modelAccepted).toBe(false);
  expect(other.config.electricity.limit).toBe(500);
  expect(other.deployed).toBe(false);
  expect((await read(request, a)).config.electricity.limit).toBe(400);
  const blocked = await request.patch(pathFor(a), {
    headers: { Origin: 'https://unrelated.example' },
    data: { facility: a, revision: state.revision, command: { action: 'reset' } },
  });
  expect(blocked.status()).toBe(403);
});
