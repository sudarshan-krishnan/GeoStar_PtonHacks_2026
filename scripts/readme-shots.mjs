// Captures the README screenshots into docs/screenshots.
//
//   node scripts/readme-shots.mjs [baseUrl] [sets]
//
// baseUrl defaults to http://127.0.0.1:3000. sets is a comma-separated list of
// landing, studio, concepts, haven, agents, workspace (default: all).
// API_PORT=8002 sends the app's data-API calls to that port instead of 8000.
// The haven and workspace sets trigger simulated incidents and reset them afterwards.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const only = (process.argv[3] || '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
if (process.env.API_PORT) {
  await ctx.route(/^http:\/\/localhost:8000\//, (r) =>
    r.continue({ url: r.request().url().replace('localhost:8000', `127.0.0.1:${process.env.API_PORT}`) }));
}
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 160)));

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `${out}/${name}.png`, ...opts });
  console.log('saved', name);
};
const go = async (path, ms = 3000) => {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await wait(ms);
};
// Hide notices that only say an optional backing service is not running on this machine.
const hide = (css) => page.addStyleTag({ content: `${css} { display: none !important; } * { scroll-margin-top: 84px; }` });
const press = async (name, ms = 1500) => {
  await page.getByRole('button', { name }).first().click({ timeout: 10000 });
  await wait(ms);
};
const tryPress = async (name, ms = 1500) => {
  try { await press(name, ms); return true; } catch { console.log('  not found:', String(name)); return false; }
};
const top = async (selector, offset = -40) => {
  await page.evaluate(([s, o]) => {
    const el = document.querySelector(s);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + o, behavior: 'instant' });
  }, [selector, offset]);
  await wait(1800);
};
const into = async (locator) => {
  await locator.first().evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await wait(1200);
};

if (want('landing')) {
  await go('/', 5000);
  await hide('.ps-rhero-card, .ps-rhero-credit, .ps-rhero aside');
  await shot('landing-hero');
  await top('.ps-pyr', -110);
  await shot('landing-three-acts');
  await top('.ps-why');
  await shot('landing-why');
  await top('#find');
  await shot('landing-find');

  await top('#design .ps-stages', -120);
  await wait(6000);
  await tryPress('Edit the design');
  await tryPress('Finalize', 3500);
  await shot('landing-design');

  await top('#protect .ps-cut', -110);
  await tryPress(/Simulate a hidden leak/, 5200);
  await shot('landing-protect');

  await top('#haven');
  await wait(7000);
  await shot('landing-haven');

  await page.keyboard.press('Control+k');
  await wait(900);
  await shot('landing-command-menu');
  await page.keyboard.press('Escape');
}

const openStudio = async () => {
  await go('/studio', 1500);
  await page.evaluate(() => sessionStorage.clear());
  await go('/studio', 4500);
  await hide('.st-error:not(.st-model-error), .st-saved-note');
};
const KINDS = [['wind', 'Wind farm'], ['solar', 'Solar farm'], ['student-living', 'Student living'], ['park', 'Community park'], ['commercial', 'Commercial']];

if (want('studio')) {
  await openStudio();
  await shot('studio-define');
}

if (want('concepts')) {
  for (const [slug, label] of KINDS) {
    await openStudio();
    await page.locator('.st-kind').getByText(label).first().click();
    await press(/See the concept model/, 8000);
    await into(page.locator('.st-model'));
    if (slug === 'wind') { await shot('studio-concept-model'); continue; }
    await page.locator('.st-concept').first().screenshot({ path: `${out}/concept-${slug}.png` });
    console.log('saved', `concept-${slug}`);
  }
}

if (want('haven')) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudio();
  await page.locator('.st-kind').getByText('Commercial').first().click();
  await press(/See the concept model/, 6000);
  await press(/Use this model|Continue to Protect/, 2500);
  await hide('.st-error:not(.st-model-error)');
  if (await page.getByRole('button', { name: /^Continue$/ }).count()) {
    await into(page.getByText('Choose your alerts.'));
    await shot('protect-alerts');
    await press(/^Continue$/, 2500);
    await into(page.getByRole('button', { name: 'Confirm Deploy' }).locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"hv-")][last()]'));
    await shot('protect-place');
    await press('Confirm Deploy', 4000);
  } else {
    await tryPress(/Open command|command center/i, 3000);
  }
  await tryPress('Reset Simulation', 2500);
  await page.setViewportSize({ width: 1440, height: 1500 });
  await wait(2500);
  await shot('haven-command');
  await press('Trigger Water Leak', 4500);
  await shot('haven-leak');
  await press('Reset Simulation', 2500);
  await press('Trigger Fire', 4500);
  await shot('haven-fire');
  await press('Reset Simulation', 2500);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await tryPress('Back to deployed projects', 2500);
  await shot('haven-deployed');
  await page.setViewportSize({ width: 1440, height: 900 });
}

if (want('agents')) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/studio/agent', 9000);
  await shot('agents-top');
  await into(page.getByText('The architecture, as the server reports it'));
  await shot('agents-architecture');
  await page.setViewportSize({ width: 1440, height: 900 });
}

if (want('workspace')) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/projects', 5000);
  await shot('workspace-projects');
  await go('/projects/demo-2', 7000);
  await shot('workspace-open');
  if (await tryPress(/^Discover/, 6000)) await shot('workspace-discover');
  if (await tryPress(/^Design/, 7000)) await shot('workspace-design');
  if (await tryPress('Project report', 5000)) await shot('workspace-report');
  await page.setViewportSize({ width: 1440, height: 900 });
}

await browser.close();
