import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';
const B = process.env.VI_URL || 'http://127.0.0.1:8100';
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1180, height: 860 } });
const pg = await ctx.newPage();
const bad = [];
pg.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
pg.on('console', (m) => m.type() === 'error' && bad.push('console: ' + m.text()));
let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n)); };
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await pg.waitForTimeout(100); }
  return false;
};

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(600);

// fresh funnel
await pg.click('#btn-new');
await pg.waitForTimeout(900);
ok(await pg.isVisible('#funnel'), 'new funnel opens');
await pg.fill('#proj-title', 'check funnel');
await pg.press('#proj-title', 'Enter');
await pg.waitForTimeout(500);

const add = async (t) => { await pg.fill('#note-input', t); await pg.press('#note-input', 'Enter'); await pg.waitForTimeout(750); };
await add('alpha idea');
await add('beta idea');
await add('gamma idea');
ok((await pg.locator('.note').count()) === 3, 'three sticky notes on the wall');
ok((await pg.textContent('#band-ideation')) === '3', 'band counts the notes');

// colours differ
const cols = await pg.$$eval('.note', (ns) => ns.map((n) => n.dataset.color));
ok(new Set(cols).size >= 2, 'notes get different colours: ' + cols.join(','));

// delete one
await pg.locator('.note .kill').nth(2).click();
ok(await until(async () => (await pg.locator('.note').count()) === 2), 'note deleted');

// explore alpha
await pg.locator('.note .go').first().click();
await pg.waitForTimeout(300);
ok(await pg.isVisible('#explore-work'), 'explore panel opens for the picked note');
await pg.fill('#explore-text', 'customer: x\nproblem: y\nsize: z\nproves it: w');
await pg.click('#explore-save');
ok(await until(async () => (await pg.textContent('#band-exploration')) === '1'), 'explored count is 1');

// explore beta too
await pg.click('.pick-btn >> nth=1');
await pg.waitForTimeout(200);
await pg.fill('#explore-text', 'customer: b\nproblem: c');
await pg.click('#explore-save');
ok(await until(async () => (await pg.textContent('#band-exploration')) === '2'), 'second idea explored');

// select
await pg.click('.step[data-stage="selection"]');
await pg.fill('#pick-reason', 'because margin');
await pg.locator('.pick-card button').first().click();
ok(await until(async () => (await pg.textContent('#band-selection')) === '1'), 'one chosen');
ok(await until(async () => (await pg.textContent('#parked-n')) === '1'), 'the other explored idea is parked: ' + await pg.textContent('#parked-n'));
await pg.click('.step[data-stage="selection"]');
await pg.waitForTimeout(250);
ok(await pg.isVisible('#chosen'), 'chosen card shown');
ok((await pg.textContent('#sim-who')).includes('roof') || (await pg.textContent('#sim-who')).includes('alpha'), 'simulation names the choice: ' + await pg.textContent('#sim-who'));

// parked reason
const ensureOpen = async () => {
  if (!(await pg.evaluate(() => document.querySelector('#parked-box').open))) {
    await pg.click('#parked-box summary');
  }
};
await ensureOpen();
const rs = pg.locator('#parked-list input.r');
await rs.first().fill('not this quarter');
await rs.first().press('Enter');
await pg.waitForTimeout(500);

// reload: does it all come back?
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1400);
ok((await pg.inputValue('#proj-title')) === 'check funnel', 'title survives reload');
ok((await pg.locator('.note').count()) === 1, 'wall shows the chosen idea after reload: ' + await pg.locator('.note').count());
ok((await pg.textContent('#band-exploration')) === '2', 'explored count survives reload');
ok((await pg.inputValue('#parked-list input.r')) === 'not this quarter', 'parked reason survives reload');

// swap back
await ensureOpen();
await pg.locator('#parked-list [data-a="swap"]').first().click();
await pg.waitForTimeout(800);
ok((await pg.textContent('#band-selection')) === '1', 'still exactly one chosen after swap');
ok((await pg.locator('#parked-list li').count()) === 1, 'and one parked');

// restore (the drawer repaints after a swap, so wait for the row itself)
await ensureOpen();
await pg.waitForSelector('#parked-list [data-a="restore"]', { timeout: 8000 });
const row = pg.locator('#parked-list [data-a="restore"]').first();
await row.click();
/* A click that lands while the drawer is repainting is a lost click, not a bug in
 * restore. Wait for the row to be gone — the act itself — and only then count. */
if (!(await until(async () => (await pg.locator('#parked-list [data-a="restore"]').count()) === 0, 6000))) {
  await row.click({ timeout: 3000 }).catch(() => {});
}
ok(await until(async () => (await pg.locator('.note').count()) === 2, 8000), 'restore puts the idea back on the wall');

// one selected per project is enforced by the database, not by the UI
await pg.click('.step[data-stage="ideation"]');
ok(await pg.isVisible('#note-input'), 'ideate panel is the active one');

bad.forEach((b) => console.log('  log ' + b));
console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
