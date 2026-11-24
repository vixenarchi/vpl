/* Things that must not surprise you: the bin says it is the bin, reading
 * stays reading, a heading can be undone, and new note is not the browser's
 * "new window".
 *
 *   node mode-check.mjs            (needs ../serve running on PORT)
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const BASE = `http://127.0.0.1:${PORT}/`;
/* sign in as an account of your own: no credentials live in this repo */
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;
if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to a test account, e.g.\n' +
    '  VPL_EMAIL=you@example.com VPL_PASS=… node mode-check.mjs');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#pass', PASS);
await page.click('#btn-login');
await page.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await page.waitForTimeout(1200);

const mine = await page.evaluate(async () => {
  const db = await import('/lib/supabase.js');
  const n = await db.createNote({ title: 'mode probe', body: 'first line\nsecond line' });
  return n.id;
});

/* ── the bin looks like the bin ───────────────────────────────────── */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);

const binBefore = await page.evaluate(() => ({
  bg: getComputedStyle(document.getElementById('list')).backgroundColor,
  banner: !document.getElementById('trash-banner').hidden,
}));
check(!binBefore.banner, 'the list is not dressed as the bin while you are in notes');

await page.click('#btn-trash');
await page.waitForTimeout(500);
const binOn = await page.evaluate(() => ({
  bg: getComputedStyle(document.getElementById('list')).backgroundColor,
  banner: !document.getElementById('trash-banner').hidden,
  text: document.getElementById('trash-banner').textContent.replace(/\s+/g, ' ').trim(),
  placeholder: document.getElementById('q').placeholder,
  cls: document.getElementById('list').className,
}));
check(binOn.bg !== binBefore.bg, 'the bin pane changes colour', `${binBefore.bg} -> ${binOn.bg}`);
check(binOn.banner && /recycle bin/i.test(binOn.text), 'the bin says it is the bin', binOn.text);
check(binOn.cls.includes('trash-mode'), 'the pane carries a trash-mode class');
check(/bin/i.test(binOn.placeholder), 'the filter offers to filter the bin', binOn.placeholder);

await page.click('#btn-trash');
await page.waitForTimeout(400);
const binOff = await page.evaluate(() => ({
  bg: getComputedStyle(document.getElementById('list')).backgroundColor,
  banner: !document.getElementById('trash-banner').hidden,
}));
check(binOff.bg === binBefore.bg && !binOff.banner, 'leaving the bin puts the pane back');

/* ── reading stays reading ────────────────────────────────────────── */
const rows = await page.$$eval('#list-items .tree-row button[data-id]', (l) => l.length);
check(rows >= 2, 'at least two notes to move between', String(rows));

const titleOf = (i) => page.evaluate((i) => {
  const b = document.querySelectorAll('#list-items .tree-row button[data-id]')[i];
  return b.querySelector('.li-title').childNodes[0].textContent.trim();
}, i);

await page.locator('#list-items .tree-row button[data-id]').nth(0).click();
await page.waitForTimeout(900);
await page.click('[data-mode="view"]');
await page.waitForTimeout(500);

const first = await titleOf(0);
const second = await titleOf(1);
await page.locator('#list-items .tree-row button[data-id]').nth(1).click();
await page.waitForTimeout(1100);

const afterJump = await page.evaluate(() => ({
  view: !document.getElementById('pane-view').hidden,
  write: !document.getElementById('pane-write').hidden,
  title: document.getElementById('title').value,
  tab: document.querySelector('[data-mode="view"]').getAttribute('aria-selected'),
}));
check(afterJump.view && !afterJump.write,
  `opening "${second}" from reading keeps you reading`,
  JSON.stringify(afterJump));
check(afterJump.tab === 'true', 'the view tab is still the selected one');

/* and the other way round: writing stays writing */
await page.click('[data-mode="write"]');
await page.waitForTimeout(400);
await page.locator('#list-items .tree-row button[data-id]').nth(0).click();
await page.waitForTimeout(1000);
const afterBack = await page.evaluate(() => ({
  write: !document.getElementById('pane-write').hidden,
  title: document.getElementById('title').value,
}));
check(afterBack.write, `opening "${first}" from writing keeps you writing`, JSON.stringify(afterBack));

/* ── a heading can be undone ──────────────────────────────────────── */
await page.click('#list-items .tree-row:has(.li-title:text-is("mode probe")) button[data-id]');
await page.waitForTimeout(1000);
await page.click('#editable');
await page.keyboard.press('Control+Home');

const tags = [];
const hit = async (label) => {
  const tag = await page.evaluate(() => {
    const sel = window.getSelection();
    let n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentElement;
    return (n?.closest?.('h1,h2,h3,h4,p,li,div,blockquote')?.tagName || '?').toLowerCase();
  });
  tags.push(tag);
  return tag;
};

await page.locator('[data-cmd="formatBlock"][data-arg="h2"]').click();
await page.waitForTimeout(300);
await hit();
await page.locator('[data-cmd="formatBlock"][data-arg="h2"]').click();
await page.waitForTimeout(300);
await hit();

check(tags[0] === 'h2', 'H turns the line into a heading', tags[0]);
check(tags[1] === 'p', 'H again turns it back into ordinary text', tags[1]);

const kept = await page.evaluate(() => document.getElementById('editable').textContent.trim().startsWith('first line'));
check(kept, 'turning it back keeps the words');

await page.waitForTimeout(1200);   /* let autosave land */

/* ── Alt+N makes a note, not a browser window ─────────────────────── */
const before = await page.evaluate(() => document.querySelectorAll('#list-items .tree-row').length);
const pagesBefore = ctx.pages().length;
await page.keyboard.press('Alt+n');
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({
  rows: document.querySelectorAll('#list-items .tree-row').length,
  hash: location.hash,
}));
check(after.rows === before + 1, 'Alt+N adds a note', `${before} -> ${after.rows}`);
check(ctx.pages().length === pagesBefore, 'Alt+N does not open a browser window');

const controlN = await page.evaluate(() => {
  const ev = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true });
  document.dispatchEvent(ev);
  return true;
});
await page.waitForTimeout(700);
const afterCtrl = await page.evaluate(() => document.querySelectorAll('#list-items .tree-row').length);
check(controlN && afterCtrl === after.rows, 'Ctrl+N is left to the browser', `${after.rows} -> ${afterCtrl}`);

/* ── help is a combination; "?" belongs to the text ───────────────── */
await page.keyboard.press('Escape');
await page.click('#editable');
await page.keyboard.press('Control+Home');
await page.type('#editable', 'why? ');
const helpAfterQuestion = await page.evaluate(() => document.getElementById('help').open);
check(!helpAfterQuestion, 'typing "?" in the note does not open the shortcut list');

await page.keyboard.press('Control+/');
await page.waitForTimeout(400);
const helpOpen = await page.evaluate(() => document.getElementById('help').open);
check(helpOpen, 'Ctrl+/ opens the shortcut list');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

/* ── typed lines are tight ────────────────────────────────────────── */
await page.click('#editable');
await page.keyboard.press('Control+Home');
for (const line of ['one', 'two', 'three']) {
  await page.keyboard.press('Enter');
  await page.type('#editable', line);
}
const tight = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('#editable p')];
  const bx = ps.map((p) => p.getBoundingClientRect());
  return {
    gaps: bx.slice(1).map((b, i) => Math.round(b.top - bx[i].bottom)),
    margin: getComputedStyle(ps[0]).marginBottom,
  };
});
check(tight.margin === '0px' && tight.gaps.every((g) => g === 0),
  'consecutive lines sit flush — no paragraph margin', JSON.stringify(tight));

/* ── the assistant's key can be tried before it is trusted ──────────
 * One settings dialog in the suite now (vendor/settings.js): the gear opens the
 * model tab, and "test" is the same button in every app. */
await page.click('#btn-ai');
await page.waitForSelector('#ai-dialog[open]');
await page.waitForTimeout(300);
const testFeedback = await page.evaluate(async () => {
  const dlg = document.getElementById('ai-dialog');
  const url = dlg.querySelector('#set-url');
  const key = dlg.querySelector('#set-key');
  if (!url || !key) return 'no model tab at all';
  url.value = '';
  key.value = '';
  dlg.querySelector('[data-a="test"]').click();
  await new Promise((r) => setTimeout(r, 200));
  return dlg.querySelector('.set-msg').textContent;
});
check(testFeedback === 'nothing to test yet', 'the assistant can be tested, and says what is missing', String(testFeedback));
await page.click('#ai-dialog [data-a="close"]').catch(() => {});
await page.keyboard.press('Escape').catch(() => {});

/* ── the gate: brand on one line, and "username" in the field ─────── */
await page.evaluate(() => { location.hash = '#/'; });
await page.click('#btn-signout').catch(() => {});
await page.waitForTimeout(900);
const gate = await page.evaluate(() => {
  const brand = document.querySelector('.gate-brand');
  const sub = document.querySelector('.gate-sub');
  if (!brand) return null;
  return {
    lines: Math.round(brand.getBoundingClientRect().height),
    sameLine: Math.abs(sub.getBoundingClientRect().top - brand.getBoundingClientRect().top) < 12,
    placeholder: document.getElementById('email').placeholder,
  };
});
if (gate) {
  check(gate.sameLine && gate.lines <= 30, 'the gate brand fits on one line', JSON.stringify(gate));
  check(/username/i.test(gate.placeholder), 'the login field says username, not a made-up name', gate.placeholder);
}

/* ── tidy up ──────────────────────────────────────────────────────── */
await page.evaluate(async (ids) => {
  const db = await import('/lib/supabase.js');
  await db.purgeNotes(ids);
}, await page.evaluate(async () => {
  /* only what this suite made: the probe, and the empty note Alt+N left */
  const db = await import('/lib/supabase.js');
  const all = await db.listNotes();
  const probes = all.filter((n) => n.title === 'mode probe' || n.title === '').map((n) => n.id);
  return probes;
}));

check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} mode checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
