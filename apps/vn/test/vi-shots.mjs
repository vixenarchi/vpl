import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';
/* The theme left the bar: it is one press inside settings now (◐ next to the
 * word), and the palette tab underneath has all three. This is the same press. */
async function darkMode(pgOrPage) {
  const pg = pgOrPage;
  await pg.click('#btn-ai');
  await pg.waitForSelector('#ai-dialog[open]');
  await pg.click('#ai-dialog [data-a=mode]');
  await pg.waitForTimeout(150);
  await pg.click('#ai-dialog [data-a=close]');
  await pg.waitForTimeout(150);
}

const B = process.env.VI_URL || 'http://127.0.0.1:8100';
const OUT = '/tmp/vi';
const notes = [
  'Roof inspection reports, photo to PDF',
  'Warranty tracker for roofing jobs',
  'Crew scheduling across three sites',
  'Quote builder from a roof measurement',
  'Material leftovers marketplace',
  'Client portal: what happens when',
];
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.screenshot({ path: `${OUT}-gate.png` });

await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])', { timeout: 15000 });
await pg.waitForTimeout(700);
await pg.screenshot({ path: `${OUT}-welcome.png` });

if (await pg.isVisible('#btn-first')) { await pg.click('#btn-first'); }
else { await pg.click('#btn-new'); }
await pg.waitForTimeout(900);
await pg.fill('#proj-title', 'Rooftop ERP');
await pg.press('#proj-title', 'Enter');  // blur -> save
await pg.waitForTimeout(500);

for (const n of notes) {
  await pg.fill('#note-input', n);
  await pg.press('#note-input', 'Enter');
  await pg.waitForTimeout(180);
}
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}-ideation.png` });

// explore one
await pg.click('.note .go');
await pg.waitForTimeout(300);
await pg.fill('#explore-text', 'customer: 20–80 person roofing firms in Croatia and Austria\nproblem: quotes are built in Excel and lost; nobody knows the margin\nsize: [assumption] ~1 900 firms, 15 % would pay 200 €/mo\nproves it: 5 firms let me rebuild one real quote');
await pg.click('#explore-save');
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}-explore.png` });

// explore a second one so selection has two
await pg.click('.pick-btn >> nth=1');
await pg.waitForTimeout(250);
await pg.fill('#explore-text', 'customer: roofing crews of 4–10\nproblem: warranty claims arrive as phone calls and vanish\nsize: [assumption] 40 % of the same firms\nproves it: 3 firms ask for a shared warranty log unprompted');
await pg.click('#explore-save');
await pg.waitForTimeout(400);

await pg.waitForTimeout(800);
console.log('DEBUG explored band:', await pg.textContent('#band-exploration'), 'picks:', await pg.locator('.pick-btn').count(), 'done:', await pg.locator('.pick-btn.done').count());
await pg.click('.step[data-stage="selection"]');
await pg.waitForTimeout(600);
console.log('DEBUG pick cards:', await pg.locator('.pick-card').count());
await pg.screenshot({ path: `${OUT}-select.png` });
await pg.fill('#pick-reason', 'only one with a number I can defend, and the buyer is the owner');
await pg.click('.pick-card >> nth=0 >> button');
await pg.waitForTimeout(800);
await pg.screenshot({ path: `${OUT}-chosen.png` });

// parked reason
await pg.waitForTimeout(900);
const r = pg.locator('#parked-list input.r').first();
if (await r.count()) { await r.fill('warranty is a feature of the first one, not a product'); await r.press('Enter'); }
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}-parked.png` });

await pg.click('.step[data-stage="context"]');
await pg.fill('#ctx-text', 'construction · saturated · capabilities: high-rise, commercial, residential, roofing');
await pg.click('#ctx-save');
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${OUT}-context.png` });

await pg.click('.step[data-stage="simulation"]');
await pg.fill('#sim-text', 'tests: 5 firms, one rebuilt quote, fail if they do not send real data\ntheir real data');
await pg.click('#sim-save');
await pg.waitForTimeout(500);
await pg.screenshot({ path: `${OUT}-sim.png` });

// dark
await pg.click('.step[data-stage="ideation"]');
await darkMode(pg);
await pg.waitForTimeout(300);
await pg.screenshot({ path: `${OUT}-dark.png` });
await pg.click('#btn-ai');
await pg.waitForTimeout(300);
await pg.screenshot({ path: `${OUT}-ai.png` });
await pg.click('#ai-x');
await darkMode(pg);
await pg.waitForTimeout(250);

// narrow
const mctx = await br.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, storageState: await pg.context().storageState() });
const m = await mctx.newPage();
await m.goto(B, { waitUntil: 'networkidle' });
await m.waitForTimeout(1200);
await m.screenshot({ path: `${OUT}-phone.png` });

// overflow / geometry checks on desktop
const geo = await pg.evaluate(() => ({
  cards: document.querySelectorAll('.note').length,
  bands: [...document.querySelectorAll('.band')].map((b) => [b.dataset.stage, b.textContent.trim().replace(/\s+/g, ' '), Math.round(b.getBoundingClientRect().width)]),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  steps: [...document.querySelectorAll('.step')].map((s) => Math.round(s.getBoundingClientRect().width)),
  barH: Math.round(document.querySelector('.bar').getBoundingClientRect().height),
}));
console.log(JSON.stringify(geo, null, 1));
const mgeo = await m.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  steps: [...document.querySelectorAll('.step')].map((s) => Math.round(s.getBoundingClientRect().height)),
  barH: Math.round(document.querySelector('.bar').getBoundingClientRect().height),
  gateHidden: !!document.querySelector('#app') && !document.querySelector('#app').hidden,
}));
console.log('PHONE', JSON.stringify(mgeo));
await br.close();
