/* vi — a real model run, through the real proxy, on real project data.
 *
 *   VPL_MODEL_URL=… VPL_MODEL_KEY=… VPL_MODEL=… node vi-real.mjs [project title]
 *
 * It does not seed anything: it opens the named project and walks the stages
 * the way a person would, keeping every balloon it gets in /tmp/model-*.txt so
 * the answers can be compared afterwards.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const B = process.env.VI_URL || 'https://vi.terg.hr';
const url = process.env.VPL_MODEL_URL;
const key = process.env.VPL_MODEL_KEY;
const model = process.env.VPL_MODEL;
const want = process.argv[2] || 'model run';
if (!url || !key || !model) { console.error('need VPL_MODEL_URL, VPL_MODEL_KEY, VPL_MODEL'); process.exit(2); }

const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1280, height: 940 } });
pg.on('pageerror', (e) => console.log('E', e.message));
pg.on('console', (m) => m.type() === 'error' && console.log('C', m.text().slice(0, 120)));

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.evaluate(([u, k, m, sp, sk]) => {
  localStorage.setItem('vpl.ai', JSON.stringify({ url: u, key: k, model: m }));
  if (sp && sk) localStorage.setItem('vpl.search', JSON.stringify({ provider: sp, key: sk }));
}, [url, key, model, process.env.VPL_SEARCH_PROVIDER || '', process.env.VPL_SEARCH_KEY || '']);
await pg.reload({ waitUntil: 'networkidle' });
await pg.fill('#email', 'vpl-agent@terg.hr');
await pg.fill('#pass', 'agent-vpl-2026!');
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1400);

// find the project
const rows = pg.locator('.proj-row .pick');
const n = await rows.count();
for (let i = 0; i < n; i++) {
  if ((await rows.nth(i).textContent()).includes(want)) { await rows.nth(i).click(); break; }
}
await pg.waitForTimeout(1200);

const panel = (s) => `.panel[data-stage="${s}"]`;
const PLACEHOLDERS = ['sketching the business', 'weighing the two', 'writing tests', 'thinking'];
async function grab(stage, name) {
  await pg.waitForSelector(`${panel(stage)} .bubble-text`, { timeout: 120000 });
  let text = '';
  for (let i = 0; i < 120; i++) {
    text = (await pg.textContent(`${panel(stage)} .bubble-text`).catch(() => '')) || '';
    if (text.length > 24 && !PLACEHOLDERS.includes(text.trim())) break;
    const msg = (await pg.textContent(`${panel(stage)} .msg`).catch(() => '')) || '';
    if (!text && msg) { console.log(`  panel says: ${msg.slice(0, 140)}`); break; }
    await pg.waitForTimeout(700);
  }
  const err = await pg.textContent(`${panel(stage)} .msg`).catch(() => '');
  writeFileSync(`/tmp/model-${name}.txt`, text || '');
  if (err) writeFileSync(`/tmp/model-${name}.err.txt`, err);
  await pg.screenshot({ path: `/tmp/m-${name}.png`, fullPage: false });
  console.log(`\n=== ${name} (${(text || '').length} chars) ===\n${(text || '').slice(0, 900)}`);
  return text;
}

// 1 ideate
await pg.click('.step[data-stage="ideation"]');
await pg.waitForTimeout(300);
await pg.click('#notes-ai');
await grab('ideation', 'ideate');

// 2 explore the first two ideas: draft, take it, save it
for (const which of [0, 1]) {
  await pg.click('.step[data-stage="exploration"]');
  await pg.waitForTimeout(200);
  await pg.click(`.pick-btn >> nth=${which}`);
  await pg.waitForTimeout(300);
  await pg.click('#explore-ai');
  await grab('exploration', which === 0 ? 'explore' : 'explore2');
  const n0 = (await pg.inputValue('#explore-text')).length;
  await pg.locator(`${panel('exploration')} .bubble-act button.primary`).click();
  let n1 = n0;
  for (let w = 0; w < 40 && n1 <= n0; w++) { await pg.waitForTimeout(250); n1 = (await pg.inputValue('#explore-text')).length; }
  console.log(`  draft in the box: ${n0} -> ${n1} chars`);
  await pg.click('#explore-save');
  for (let w = 0; w < 40; w++) {
    const m = await pg.textContent('#explore-msg').catch(() => '');
    if (/saved/.test(m)) break;
    if (/error|failed|row/i.test(m)) { console.log('  save said:', m); break; }
    await pg.waitForTimeout(250);
  }
  console.log('  save said:', (await pg.textContent('#explore-msg').catch(() => '')).slice(0, 60));
}

// 4 the pick
await pg.click('.step[data-stage="selection"]');
await pg.waitForTimeout(400);
await pg.click('#pick-ai');
await grab('selection', 'select');
const usePick = pg.locator(`${panel('selection')} .bubble-act button.primary`);
if (await usePick.count()) { await usePick.click(); await pg.waitForTimeout(400); }
await pg.locator('.pick-card button').first().click();
await pg.waitForTimeout(1200);

// 5 the test plan
await pg.click('.step[data-stage="simulation"]');
await pg.waitForTimeout(300);
await pg.click('#sim-ai');
await grab('simulation', 'simulate');
const useSim = pg.locator(`${panel('simulation')} .bubble-act button.primary`);
if (await useSim.count()) {
  await useSim.click();
  for (let w = 0; w < 40; w++) { if ((await pg.inputValue('#sim-text')).length > 100) break; await pg.waitForTimeout(250); }
  await pg.click('#sim-save');
  for (let w = 0; w < 40; w++) {
    const m = await pg.textContent('#sim-msg').catch(() => '');
    if (/saved/.test(m)) break;
    await pg.waitForTimeout(250);
  }
  console.log('  sim save said:', await pg.textContent('#sim-msg').catch(() => ''));
}
await pg.screenshot({ path: '/tmp/m-final.png', fullPage: true });

await br.close();
