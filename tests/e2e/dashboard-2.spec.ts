import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test('Dashboard 2 Locate remains a standalone UI preview with no application API requests', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/dashboard-2');
  const steps = page.getByRole('navigation', { name: 'Locate steps' });
  const modules = page.getByRole('navigation', { name: 'Planning modules' });
  await expect(page.getByText('UI PREVIEW', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(6);
  await page.getByRole('radio', { name: /Solar farm/ }).check();
  await page
    .getByLabel('A little about your vision')
    .fill('A sample solar project for the interface preview.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(steps.getByRole('button', { name: /Completed Describe/ })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Illustrative area map' })).toBeVisible();
  await page.getByRole('button', { name: 'Select Eastpoint Commons on map' }).click();
  await expect(
    page.locator('.d2-location-row').filter({ hasText: 'Eastpoint Commons' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Priorities' }).click();
  await page.getByLabel('Money priority').fill('60');
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('.d2-location-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.d2-preview-site-hero')).toContainText('Eastpoint Commons');
  await expect(page.locator('.d2-review-grid')).toContainText('Solar farm');
  await steps.getByRole('button', { name: /Describe/ }).click();
  await expect(page.getByLabel('A little about your vision')).toHaveValue(
    'A sample solar project for the interface preview.',
  );
  await steps.getByRole('button', { name: /Finalize/ }).click();
  await page.getByRole('button', { name: 'Confirm selection' }).click();
  await expect(page.getByRole('status')).toContainText('Locate preview complete');
  await expect(modules.getByRole('button', { name: /Locate.*Completed/ })).toBeVisible();
  await page.reload();
  // Progress survives a reload, still without any API request from Locate.
  await expect(modules.getByRole('button', { name: /Locate.*Completed/ })).toBeVisible();
  await expect(steps.getByRole('button', { name: /Completed Finalize/ })).toBeVisible();
  await expect(page.locator('.d2-preview-site-hero')).toContainText('Eastpoint Commons');
  expect(apiRequests).toEqual([]);
});

test('Dashboard 2 preview fits desktop and mobile through all three screens', async ({ page }) => {
  mkdirSync('output/qa/dashboard-2', { recursive: true });
  await page.goto('/dashboard-2');
  await page.screenshot({ path: 'output/qa/dashboard-2/describe-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.screenshot({ path: 'output/qa/dashboard-2/pick-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm selection' }).click();
  await page.screenshot({ path: 'output/qa/dashboard-2/finalize-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Reset preview' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: 'output/qa/dashboard-2/describe-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.screenshot({ path: 'output/qa/dashboard-2/pick-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm selection' }).click();
  await page.screenshot({ path: 'output/qa/dashboard-2/finalize-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
