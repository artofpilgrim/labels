// Headless boot smoke test. Starts the Vite dev server, loads the app in
// Chromium, enters the editor, exercises the main surfaces, and FAILS (exit 1)
// on any uncaught page error or if the editor doesn't mount. Catches the class
// of runtime crash that `vite build` cannot (TDZ, undefined refs, bad wiring).
//
//   npm run smoke
//
// One-time browser install (if missing): npx playwright install chromium
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';

const PORT = Number(process.env.SMOKE_PORT) || 5179;
const URL = `http://localhost:${PORT}/`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

// Spawn vite directly through node so it's a single, easily-killed process.
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(URL); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(400);
  }
  throw new Error(`dev server did not start on ${URL}`);
}

const errors = [];
const ui = [];   // missing-UI assertions (a "renders nothing" bug throws no error)
let browser;
let code = 0;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 160)); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Open the Studio/i }).first().click();
  await page.waitForTimeout(1500);

  // Exercise the main surfaces (each interaction is best-effort).
  await page.locator('.layer-row').first().click().catch(() => {});       // → Properties panel
  await page.waitForTimeout(300);
  if ((await page.locator('.align-toolbar').count()) === 0) ui.push('align toolbar missing after selecting a layer');
  if ((await page.locator('.properties-panel, .rightpanel .pad, .rightpanel .panel').count()) === 0) ui.push('properties/right panel missing');
  const rail = page.locator('.rail-btn');
  const railCount = await rail.count();
  for (let i = 0; i < railCount; i++) {                                    // panel switches + add-layer + help
    await rail.nth(i).click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: /^Export/i }).first().click().catch(() => {}); // → Export panel
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});

  const mounted = (await page.locator('.canvas-stage, .leftpanel').count()) > 0;
  const layerRows = await page.locator('.layer-row').count();
  const fatal = [...errors.filter(e => e.startsWith('PAGEERROR')), ...ui];
  if (!mounted) fatal.push('EDITOR DID NOT MOUNT');

  console.log(`mounted=${mounted} layerRows=${layerRows} pageErrors=${fatal.filter(e => e.startsWith('PAGEERROR')).length}`);
  if (errors.length) console.log(errors.join('\n'));
  code = fatal.length ? 1 : 0;
  console.log(code ? '\n✗ SMOKE FAILED' : '\n✓ SMOKE PASSED');
} catch (e) {
  console.error('smoke error:', e.message);
  code = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  try { vite.kill('SIGTERM'); } catch { /* already gone */ }
  await sleep(300);
  try { vite.kill('SIGKILL'); } catch { /* already gone */ }
  process.exit(code);
}
