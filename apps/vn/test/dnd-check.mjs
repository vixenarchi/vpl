/* Drag and drop in the tree, checked with real mouse drags in a real browser,
 * against a real Supabase project.
 *
 * Every assertion is something a user would notice if it broke: a note lands
 * where the drop line promised, its children come along, and a note cannot be
 * dropped inside itself.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 8096;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const srv = createServer((q, r) => {
  const u = new URL(q.url, 'http://x').pathname;
  const name = u === '/' ? '/index.html' : u;
  try {
    const body = readFileSync(join(ROOT, name));
    r.writeHead(200, { 'content-type': MIME[name.slice(name.lastIndexOf('.'))] || 'text/plain' });
    r.end(body);
  } catch { r.writeHead(404).end('not found'); }
});
await new Promise((ok) => srv.listen(PORT, '127.0.0.1', ok));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const BASE = `http://127.0.0.1:${PORT}/`;
const stamp = Date.now();

await page.goto(BASE);
await page.fill('#email', `dnd-${stamp}@example.com`);
await page.fill('#pass', 'secret123');
await page.click('#btn-register');
await page.waitForSelector('#app', { state: 'visible', timeout: 20000 });

/* ── build ROOT > A > A1, and ROOT > B ─────────────────────────────── */
const waitNew = (prev) => page.waitForFunction(
  (h) => location.hash !== h && location.hash.startsWith('#/n/'), prev, { timeout: 10000 });

/* Autosave is a 800 ms debounce plus a round trip: a fixed sleep is a coin
 * toss, so wait for the row instead of for the clock. The poll lives here
 * because waitForFunction with an async predicate is satisfied by the promise
 * object itself and returns before the answer is known. */
async function waitSaved(title) {
  for (let i = 0; i < 75; i++) {
    const has = await page.evaluate(async (t) => {
      const { listNotes } = await import('/lib/supabase.js');
      return (await listNotes()).some((n) => n.title === t);
    }, title);
    if (has) return;
    await page.waitForTimeout(200);
  }
  throw new Error('the note "' + title + '" was never saved');
}

async function create(title, asChild) {
  const prev = await page.evaluate(() => location.hash);
  await page.click(asChild ? '#btn-child' : '#btn-new');
  await waitNew(prev);

  /* the editor shows the note the address points at, and it is opened a tick
   * after the hash changes: typing before that lands in the previous note's
   * title. Wait for the new note to own the field, then type. */
  const now = await page.evaluate(() => location.hash);
  await page.waitForFunction((h) => location.hash === h
    && document.getElementById('title').value === ''
    && document.getElementById('view-note').offsetParent !== null, now, { timeout: 10000 });

  await page.fill('#title', title);
  await waitSaved(title);
}

await create('ROOT', false);
await create('A', true);
await create('A1', true);          // child of A
await page.click('#list-items .tree-row:has(.li-title:text-is("ROOT"))');
await page.waitForFunction(() => document.getElementById('title').value === 'ROOT');
await create('B', true);           // child of ROOT

const row = (title) => page.locator(`#list-items .tree-row:has(.li-title:text-is("${title}"))`);

/* the whole tree as the database sees it: "title <- parent" (plus [bin]) */
async function relations() {
  return page.evaluate(async () => {
    const { listNotes } = await import('/lib/supabase.js');
    const all = await listNotes();
    const byId = new Map(all.map((n) => [n.id, n]));
    return all
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((n) => `${n.title} <- ${n.parent_id ? byId.get(n.parent_id)?.title : 'root'}`
        + (n.deleted_at ? ' [bin]' : ''));
  });
}

/* a drag held mid-air: returns the bin's word while the note hovers it. The
 * zone is the rail's head strip, not the chip: a 30 px sign is a promise, the
 * strip is a place a hand can find mid-drag */
async function dragToBin(title, hold = false) {
  const src = await row(title).boundingBox();
  const dst = await page.locator('.list-head').boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 8, { steps: 5 });
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
  await page.waitForTimeout(200);
  const label = await page.textContent('#btn-bin .bin-word');
  await page.mouse.up();
  if (!hold) await page.waitForTimeout(1600);
  return label;
}

let rel = await relations();
check('setup: A1 sits under A, B under ROOT',
  rel.includes('A1 <- A') && rel.includes('B <- ROOT') && rel.includes('A <- ROOT'),
  JSON.stringify(rel));

/* ── drop A (with its child) onto the middle of B ──────────────────── */
const bBox = await row('B').boundingBox();
await row('A').dragTo(row('B'), { targetPosition: { x: 60, y: bBox.height / 2 } });
await page.waitForTimeout(1500);

rel = await relations();
check('drop on the middle of a row nests the note there',
  rel.includes('A <- B'), JSON.stringify(rel));
check('the dragged note takes its subtree along',
  rel.includes('A1 <- A'), JSON.stringify(rel));

const indentA = await row('A').evaluate((r) => parseFloat(getComputedStyle(r).paddingLeft) || 0);
const indentB = await row('B').evaluate((r) => parseFloat(getComputedStyle(r).paddingLeft) || 0);
check('the dropped note is drawn one level deeper than its parent',
  indentA > indentB, `${indentB} < ${indentA}`);

/* ── drop A on empty space → back to the top level ──────────────────── */
const listBox = await page.locator('#list-items').boundingBox();
await row('A').dragTo(page.locator('#list-items'), {
  targetPosition: { x: 60, y: Math.max(listBox.height - 12, 10) },
});
await page.waitForTimeout(1500);

rel = await relations();
check('drop on empty space lifts the note to the top level',
  rel.includes('A <- root'), JSON.stringify(rel));
check('its child stays where it was, under A',
  rel.includes('A1 <- A'), JSON.stringify(rel));

/* ── drop onto the top edge of ROOT → becomes a sibling before it ───── */
const rootBox = await row('ROOT').boundingBox();
/* rows that share the top level right now, in drawn order */
const topLevel = () => page.evaluate(() =>
  [...document.querySelectorAll('#list-items > li:not([hidden]) .tree-row')]
    .filter((r) => parseFloat(getComputedStyle(r).paddingLeft) < 10)
    .map((r) => r.querySelector('.li-title').textContent));
const topBefore = await topLevel();

await row('A').dragTo(row('ROOT'), { targetPosition: { x: 60, y: 3 } });
await page.waitForTimeout(1500);

const topAfter = await topLevel();
check('drop on the top edge reorders instead of nesting',
  topAfter[0] === 'A' && topBefore[0] === 'ROOT',
  `${topBefore.join(',')} -> ${topAfter.join(',')}`);

rel = await relations();
check('the reordered note is still at the top level', rel.includes('A <- root'), JSON.stringify(rel));

/* ── a note cannot be dropped inside its own subtree ────────────────── */
const before = await relations();
await row('A').dragTo(row('A1'), { targetPosition: { x: 60, y: 12 } });
await page.waitForTimeout(1200);
const after = await relations();
check('dropping a note inside its own subtree is refused',
  JSON.stringify(after.slice().sort()) === JSON.stringify(before.slice().sort()),
  JSON.stringify(after));

/* ── dropping into a collapsed node expands it ──────────────────────── */
/* collapse ROOT, then drag A1 (a child of A) onto it */
const rootRow = row('ROOT');
await rootRow.locator('.twisty').click();
await page.waitForTimeout(300);
const collapsedCount = await page.locator('#list-items > li:not([hidden])').count();

await row('A1').dragTo(row('ROOT'), { targetPosition: { x: 60, y: 22 } });
await page.waitForTimeout(1500);

const expandedCount = await page.locator('#list-items > li:not([hidden])').count();
rel = await relations();
check('dropping into a collapsed note expands it',
  expandedCount > collapsedCount && rel.includes('A1 <- ROOT'),
  `${collapsedCount} -> ${expandedCount} rows`);

/* ── the new row order is stable after a reload ─────────────────────── */
const drawnBefore = await page.evaluate(() =>
  [...document.querySelectorAll('#list-items > li:not([hidden]) .li-title')].map((e) => e.textContent));
await page.reload();
await page.waitForSelector('#list-items li', { timeout: 20000 });
await page.waitForTimeout(1200);
const drawnAfter = await page.evaluate(() =>
  [...document.querySelectorAll('#list-items > li:not([hidden]) .li-title')].map((e) => e.textContent));
check('the order drawn after a drop survives a reload',
  JSON.stringify(drawnBefore) === JSON.stringify(drawnAfter),
  `${drawnBefore.join(',')} -> ${drawnAfter.join(',')}`);

/* ── the bin takes a drop, and gives it back ──────────────────────── */
const labelIntoBin = await dragToBin('A1');
check('the bin says what a drop will do', labelIntoBin === 'move to bin', labelIntoBin);

let state = await relations();
check('dropping a note on the bin moves it to the bin',
  state.includes('A1 <- ROOT [bin]'), JSON.stringify(state));
check('a binned note disappears from the tree',
  (await page.locator('#list-items .tree-row:has(.li-title:text-is("A1"))').count()) === 0);
check('the bin count shows one note',
  (await page.textContent('#bin-count')).trim() === '1');

/* now drag it back out of the bin */
await page.click('#btn-bin');
await page.waitForTimeout(500);
const labelOutOfBin = await dragToBin('A1');
check('the bin says a binned note comes back out',
  labelOutOfBin === 'restore from bin', labelOutOfBin);

state = await relations();
check('dropping a binned note on the bin restores it',
  state.includes('A1 <- ROOT') && !state.includes('A1 <- ROOT [bin]'), JSON.stringify(state));
check('a restored note keeps its parent',
  state.includes('A1 <- ROOT'), JSON.stringify(state));
check('restoring empties the bin count', (await page.textContent('#bin-count')).trim() === '');

/* a restore leaves you in the bin, so the note is drawn in the tree again */
await page.click('#btn-bin');
await page.waitForTimeout(400);
check('the restored note is drawn again',
  (await page.locator('#list-items .tree-row:has(.li-title:text-is("A1"))').count()) === 1,
  'after leaving the bin');

/* ── restoring the note that is open gives the editor back ────────── */
await page.click('#list-items .tree-row:has(.li-title:text-is("A1"))');
await page.waitForFunction(() => document.getElementById('title').value === 'A1', { timeout: 10000 });
await page.click('#btn-del');
await page.waitForTimeout(1500);

await page.click('#btn-bin');
await page.waitForTimeout(500);
await page.click('#list-items .tree-row:has(.li-title:text-is("A1"))');
await page.waitForFunction(() => document.getElementById('btn-del').textContent.trim() === 'restore',
  { timeout: 10000 });
const lockedInBin = await page.evaluate(() => document.getElementById('title').readOnly);

await dragToBin('A1');
const afterRestore = await page.evaluate(() => ({
  locked: document.getElementById('title').readOnly,
  del: document.getElementById('btn-del').textContent.trim(),
  child: document.getElementById('btn-child').disabled,
}));
check('the bin locks the open note while it sits there', lockedInBin === true);
check('restoring the open note gives the editor back',
  !afterRestore.locked && afterRestore.del === 'delete' && !afterRestore.child,
  JSON.stringify(afterRestore));

await page.click('#btn-bin');           // leave the bin view
await page.waitForTimeout(400);

/* ── dragging is off in a filtered list ───────────────────────────── */
await page.fill('#q', 'A1');
await page.waitForTimeout(300);
const flatDraggable = await page.evaluate(() =>
  [...document.querySelectorAll('#list-items .tree-row')].some((r) => r.draggable));
check('a filtered list is not draggable', !flatDraggable);
await page.fill('#q', '');

/* ── no console errors ─────────────────────────────────────────────── */
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} drag-and-drop checks passed`);
/* the account and its notes go with it */
await page.evaluate(() => import('/lib/supabase.js').then((m) => m.deleteAccount())).catch(() => {});

await browser.close();
srv.close();
process.exit(fail ? 1 : 0);
