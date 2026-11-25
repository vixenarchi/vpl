/* vc — the library. A law you keep, so you stop pasting it.
 *
 * What it proves: a standard is kept, counted in characters, copied into a
 * check (not pointed at), its ✕ bins it rather than destroying it, a binned
 * standard can come back, an input keeps its text when the standard is deleted
 * for good, editing a standard does not rewrite a report already written, and
 * a guest never sees the drawer.
 *
 *   node vc-lib.mjs                        # http://127.0.0.1:8105
 *   VC_URL=https://vc.terg.hr node vc-lib.mjs
 */
import { chromium } from 'playwright';
import { OWNER } from './_account.mjs';

const B = process.env.VC_URL || 'http://127.0.0.1:8105';
const STAMP = Math.random().toString(36).slice(2, 6);

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); }
};
const errors = [];
async function until(fn, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 80));
  }
}
async function login(pg) {
  await pg.goto(B, { waitUntil: 'networkidle' });
  if (await pg.locator('#gate').isVisible()) {
    await pg.fill('#email', OWNER.email);
    await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
  }
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(1200);
}

const LAW = 'Zakon o radu — čl. 45\n\nRadnik ima pravo na godišnji odmor od najmanje '
  + 'četiri tjedna. Odmor se može koristiti u dijelovima, ali najmanje dva tjedna '
  + 'u kontinuitetu tijekom kalendarske godine.\n\n[' + STAMP + ']';
const TITLE = 'Zakon o radu — čl. 45 (' + STAMP + ')';

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 },
  permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

await login(pg);

/* ── a check to put a standard into ─────────────────────────────── */
if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
await pg.waitForSelector('#spec:not([hidden])');
await pg.waitForTimeout(600);
await pg.fill('#proj-title', 'lib-check ' + STAMP);
await pg.waitForTimeout(900);              // the autosave is a network round trip

const standardsBefore = await pg.locator('#standards .art').count();

/* ── the drawer opens ───────────────────────────────────────────── */
ok(await pg.locator('#btn-from-lib').isVisible(), 'a check offers the library beside ＋ standard');
await pg.click('#btn-from-lib');
/* A modal <dialog> is asked about through the page, not through a locator:
 * `[open]` on a dialog that is showing modally does not reliably match. */
const libOpen = () => pg.evaluate(() => !!document.getElementById('lib-dialog')?.open);
ok(await until(libOpen), 'the library opens');
ok(await until(async () => !(await pg.locator('#lib-none').isHidden())
  || (await pg.locator('#lib-list .lib-item').count()) > 0), 'and it says what it holds, or that it holds nothing');

const keptBefore = await pg.locator('#lib-list .lib-item').count();

/* ── a standard is kept ─────────────────────────────────────────── */
await pg.click('#lib-new');
ok(await pg.locator('#lib-edit').isVisible(), 'a new standard gets a form');
await pg.fill('#lib-title', TITLE);
await pg.selectOption('#lib-kind', 'law');
await pg.fill('#lib-text', LAW);
ok((await pg.textContent('#lib-chars')).includes(String(LAW.length.toLocaleString('en')),
  ), 'the form shows how much text it is (' + await pg.textContent('#lib-chars') + ')');
await pg.click('#lib-save');
ok(await until(async () => (await pg.locator('#lib-list .lib-item').count()) === keptBefore + 1),
  'keeping it puts it in the drawer');
ok(await pg.locator('#lib-edit').isHidden(), 'the form steps aside for the list');
const row = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
ok((await row.locator('.line').textContent()).includes('characters'),
  'the row says how many characters it carries');

/* ── nothing has entered the check yet ──────────────────────────── */
ok((await pg.locator('#standards .art').count()) === standardsBefore,
  'keeping it does not put it in the check');

/* ── add copies the text ────────────────────────────────────────── */
await row.hover();
await row.locator('.add').click();
ok(await until(async () => (await pg.locator('#standards .art').count()) === standardsBefore + 1),
  'add copies it into the check as a standard');
ok(await until(async () => !(await libOpen())), 'and closes the drawer');

const added = pg.locator('#standards .art', { hasText: TITLE }).first();
await added.locator('.name').click();
await pg.waitForSelector('#art-dialog[open]');
const copied = await pg.inputValue('#art-text');
ok(copied === LAW, 'the input holds the whole text, not a pointer (' + copied.length + ' chars)');
ok((await pg.textContent('#art-from')).includes('copied from the library'),
  'and says where it came from: ' + (await pg.textContent('#art-from')).slice(0, 60));
await pg.click('#art-x');

/* ── the drawer's ✕ bins, it does not destroy ───────────────────── */
await pg.click('#btn-from-lib');
await pg.waitForFunction(() => !!document.getElementById('lib-dialog')?.open);
const mine = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await mine.hover();
await mine.locator('.del').click();
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 0),
  'the standard leaves the list');
ok(await until(async () => !(await pg.locator('#lib-bin-line').isHidden())), 'the bin line appears');
ok((await pg.textContent('#lib-bin-line')).includes('in the bin'),
  'and counts what is in it: ' + (await pg.textContent('#lib-bin-line')).trim());

/* ── showing the bin, and taking it back ────────────────────────── */
const showingBin = async () => (await pg.textContent('#lib-bin-line')).includes('back to the library');
await pg.locator('#lib-bin-line button').click();
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 1),
  'the bin lists the standard it took');
const binned = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
ok(await binned.locator('.back').count() === 1, 'with a way back');
await binned.locator('.back').click();
/* one of two things is right, depending on what is left in the bin: the view
 * goes back to the library when the bin is now empty, and stays in the bin (with
 * the row gone) when it is not. Both mean the standard came back. */
ok(await until(async () => {
  const inBin = await showingBin();
  const n = await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count();
  return inBin ? n === 0 : n === 1;
}), 'back takes it out of the bin and into the library');
if (await showingBin()) {
  await pg.locator('#lib-bin-line button').click();
  ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 1),
    'and it is in the library again');
}

/* ── editing a standard does not rewrite the check's copy ───────── */
const back = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await back.locator('.name').click();
await pg.waitForSelector('#lib-edit:not([hidden])');
await pg.fill('#lib-text', LAW + '\n\nDODANO KASNIJE — ovo ne smije ući u već napravljen izvještaj.');
await pg.click('#lib-save');
await pg.waitForTimeout(1500);
await pg.click('#lib-x');
const still = pg.locator('#standards .art', { hasText: TITLE }).first();
await still.locator('.name').click();
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.inputValue('#art-text')) === LAW, 'the copy in the check did not change when the standard did');
await pg.click('#art-x');

/* ── deleting the standard for good leaves the copy alone ───────── */
await pg.click('#btn-from-lib');
await pg.waitForFunction(() => !!document.getElementById('lib-dialog')?.open);
const again = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await again.hover();
await again.locator('.del').click();
await until(async () => !(await pg.locator('#lib-bin-line').isHidden()));
if (!(await showingBin())) await pg.locator('#lib-bin-line button').click();
await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 1);
const doomed = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await doomed.hover();
await doomed.locator('.del').click();
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 0),
  'a second ✕, in the bin, deletes it for good');
await pg.click('#lib-x');

await still.locator('.name').click();
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.inputValue('#art-text')) === LAW, 'the check keeps its words after the standard is gone');
ok((await pg.textContent('#art-from')).includes('no longer there'),
  'and the input says the standard is gone');
await pg.click('#art-x');

/* ── a guest never sees the drawer ──────────────────────────────── */
await pg.click('#btn-share');
await pg.waitForSelector('#share-dialog[open]');
await pg.click('#share-make');
ok(await until(async () => (await pg.inputValue('#share-link')).includes('?s=')), 'a link is made');
const link = await pg.inputValue('#share-link');
await pg.click('#share-x');

const gctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const gp = await gctx.newPage();
gp.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1400);
ok((await gp.inputValue('#proj-title')).includes('lib-check ' + STAMP), 'a guest reads the check');
ok(!(await gp.locator('#btn-from-lib').isVisible()), 'the library is the owner\'s drawer, and the guest has no door to it');
await gctx.close();

/* ── a phone ────────────────────────────────────────────────────── */
await pg.setViewportSize({ width: 390, height: 844 });
await pg.waitForTimeout(500);
const wide = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(wide === 0, 'a phone does not scroll sideways (' + wide + ' px)');
await pg.click('#btn-from-lib').catch(() => {});
await pg.waitForTimeout(700);
const libWide = await pg.evaluate(() => {
  const d = document.querySelector('#lib-dialog');
  return d ? Math.round(d.getBoundingClientRect().width) : 0;
});
ok(libWide === 0 || libWide <= 390, 'the library fits a phone (' + libWide + ' px)');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));

await br.close();
console.log(`\nvc library: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
