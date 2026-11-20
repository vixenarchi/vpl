/* Tree, rich editor and keyboard, checked against a real browser. These are the features added in v2.2; each assertion states a
 * behaviour a user would notice if it broke. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 8097;
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
await page.fill('#email', `tree-${stamp}@example.com`);
await page.fill('#pass', 'secret123');
await page.click('#btn-register');
await page.waitForSelector('#app', { state: 'visible', timeout: 20000 });

/* ── nesting ─────────────────────────────────────────────────────── */
const waitNew = (prev) => page.waitForFunction(
  (h) => location.hash !== h && location.hash.startsWith('#/n/'), prev, { timeout: 10000 });

await page.click('#btn-new');
await page.waitForFunction(() => location.hash.startsWith('#/n/'));
await page.fill('#title', 'ROOT');
await page.waitForTimeout(900);

for (const name of ['CHILD', 'GRAND']) {
  const prev = await page.evaluate(() => location.hash);
  await page.click('#btn-child');
  await waitNew(prev);
  await page.waitForTimeout(150);
  await page.fill('#title', name);
  await page.waitForTimeout(900);
}

const depths = await page.evaluate(() => [...document.querySelectorAll('#list-items > li')].map((li) => ({
  title: li.querySelector('.li-title').textContent,
  pad: parseFloat(li.querySelector('.tree-row').style.paddingLeft.replace(/[^0-9.]/g, '')),
})));

check('three notes exist', depths.length === 3, depths.map((d) => d.title).join(' > '));
check('tree order is parent first', depths[0]?.title === 'ROOT', JSON.stringify(depths.map(d => d.title)));
check('each level is indented deeper',
  depths[0].pad < depths[1].pad && depths[1].pad < depths[2].pad,
  depths.map((d) => d.pad + 'rem').join(' < '));

const relations = await page.evaluate(async () => {
  const { listNotes } = await import('/lib/supabase.js');
  const all = await listNotes();
  const byId = new Map(all.map((n) => [n.id, n]));
  return all.map((n) => `${n.title} <- ${n.parent_id ? byId.get(n.parent_id)?.title : 'root'}`);
});
check('the database holds the same nesting', relations.includes('GRAND <- CHILD'), JSON.stringify(relations));

/* ── collapse keeps the parent visible ───────────────────────────── */
await page.evaluate(() => document.querySelector('#list-items li .twisty').click());
await page.waitForTimeout(300);
const afterCollapse = await page.evaluate(() =>
  [...document.querySelectorAll('#list-items > li:not([hidden]) .li-title')].map((e) => e.textContent));
check('collapsing hides children but keeps the parent',
  afterCollapse.length === 1 && afterCollapse[0] === 'ROOT', JSON.stringify(afterCollapse));

await page.evaluate(() => document.querySelector('#list-items li .twisty').click());
await page.waitForTimeout(300);

/* ── keyboard reparenting ────────────────────────────────────────── */
await page.click('#list-items button[data-id]:has-text("GRAND")');
/* wait until the note is actually open, not just 800ms */
await page.waitForFunction(() => document.getElementById('title').value === 'GRAND', { timeout: 10000 });
await page.waitForTimeout(300);
const padBefore = await page.evaluate(() =>
  parseFloat([...document.querySelectorAll('#list-items li')]
    .find((li) => li.querySelector('.li-title').textContent === 'GRAND')
    .querySelector('.tree-row').style.paddingLeft.replace(/[^0-9.]/g, '')));

await page.keyboard.press('Alt+ArrowLeft');
await page.waitForTimeout(1200);
const padAfter = await page.evaluate(() =>
  parseFloat([...document.querySelectorAll('#list-items li')]
    .find((li) => li.querySelector('.li-title').textContent === 'GRAND')
    .querySelector('.tree-row').style.paddingLeft.replace(/[^0-9.]/g, '')));
check('Alt+Left outdents the note', padAfter < padBefore, `${padBefore} -> ${padAfter}`);

/* ── rich editor round trip ─────────────────────────────────────── */
await page.keyboard.press('Control+1');
await page.click('#editable');
await page.evaluate(async () => {
  const { mdToHtml } = await import('/lib/editor.js');
  const ed = document.getElementById('editable');
  ed.innerHTML = mdToHtml('a **bold** word and *slanted* too');
  ed.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(1300);
await page.keyboard.press('Control+2');
await page.waitForSelector('#rendered strong', { timeout: 10000 });
const strong = await page.textContent('#rendered strong');
const em = await page.textContent('#rendered em');
check('rich text survives the round trip to markdown', strong.trim() === 'bold' && em.trim() === 'slanted',
  `${strong} / ${em}`);

/* ── a fenced code block is shown as code, and kept ────────────── */
await page.keyboard.press('Control+1');
await page.evaluate(async () => {
  const { mdToHtml } = await import('/lib/editor.js');
  const ed = document.getElementById('editable');
  ed.innerHTML = mdToHtml('```js\nconst a = 1;\n```');
  ed.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(1300);
await page.keyboard.press('Control+2');
const codeOk = await page.waitForSelector('#rendered pre code', { timeout: 15000 })
  .then(() => true).catch(() => false);
check('a code block renders as code', codeOk);

/* ── only two modes exist now ──────────────────────────────────── */
const modes = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.dataset.mode));
check('the editor has exactly write and view', JSON.stringify(modes) === JSON.stringify(['write', 'view']),
  JSON.stringify(modes));

/* ── layout ─────────────────────────────────────────────────────── */
const box = await page.evaluate(() => {
  const r = document.querySelector('.note').getBoundingClientRect();
  return { x: r.x, right: window.innerWidth - r.right, w: r.width, win: window.innerWidth };
});
check('the note starts at the left of the pane', box.x < 400, `x=${Math.round(box.x)}`);
check('the note stretches across the width', box.w > box.win * 0.6,
  `${Math.round(box.w)} of ${box.win}`);

/* ── no console errors ─────────────────────────────────────────── */
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} tree checks passed`);
await page.evaluate(() => import('/lib/supabase.js').then((m) => m.deleteAccount())).catch(() => {});

await browser.close();
srv.close();
process.exit(fail ? 1 : 0);
