/* Moving notes with a finger, on a phone-sized screen.
 *
 * HTML5 drag events never fire on a touch screen, so the tree has a second
 * way in: a long press lifts the row and pointer events carry it. These are
 * real touch events, injected through the browser's input layer, not calls
 * into our own functions.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 8091;
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
const context = await browser.newContext({
  viewport: { width: 390, height: 760 },
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 12; Honor 8X) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

const BASE = `http://127.0.0.1:${PORT}/`;
const stamp = Date.now();

const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0, radiusX: 2, radiusY: 2, force: 1 }],
});

/* press, wait past the hold, then walk to the target */
async function liftAndDrag(from, to, steps = 6) {
  await touch('touchStart', from.x, from.y);
  await page.waitForTimeout(520);
  const lifted = await page.locator('.drag-ghost').count() === 1;
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(120);
  await touch('touchEnd');
  await page.waitForTimeout(1300);
  return lifted;
}

const rows = () => page.evaluate(async () => {
  const { listNotes } = await import('/lib/supabase.js');
  const all = await listNotes();
  const by = new Map(all.map((n) => [n.id, n]));
  return all.map((n) => `${n.title} <- ${n.parent_id ? by.get(n.parent_id)?.title : 'root'}`
    + (n.deleted_at ? ' [bin]' : ''));
});
const centre = async (title) => {
  const b = await page.locator(`#list-items .tree-row:has(.li-title:text-is("${title}"))`).first().boundingBox();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
};
/* on a phone the list is a drawer: it is already open more often than not,
 * and the button toggles rather than opens */
const openList = async () => {
  if (!(await page.evaluate(() => document.querySelector('.list').classList.contains('open')))) {
    await page.click('#btn-list');
  }
  await page.waitForTimeout(650);
};

await page.goto(BASE);
await page.fill('#email', `touch-${stamp}@example.com`);
await page.fill('#pass', 'secret123');
await page.click('#btn-register');
await page.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await page.waitForTimeout(1000);

/* build ROOT > A, ROOT > B */
async function create(title, asChild) {
  const prev = await page.evaluate(() => location.hash);
  await page.click(asChild ? '#btn-child' : '#btn-new');
  await page.waitForFunction((h) => location.hash !== h && location.hash.startsWith('#/n/'), prev, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('title').value === '');
  await page.fill('#title', title);
  for (let i = 0; i < 60; i++) {
    const has = await page.evaluate(async (t) => {
      const { listNotes } = await import('/lib/supabase.js');
      return (await listNotes()).some((n) => n.title === t);
    }, title);
    if (has) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
}

await create('ROOT', false);
await create('A', true);
await openList();
await page.click('#list-items .tree-row:has(.li-title:text-is("ROOT"))');
await page.waitForTimeout(900);
await create('B', true);
await openList();

check('a phone shows the tree without sideways scrolling',
  (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);

/* 1. a long press lifts, and the drop nests */
const lifted = await liftAndDrag(await centre('B'), await centre('A'));
check('a long press lifts the row off the tree', lifted);
let rel = await rows();
check('a finger drag nests the note under the target', rel.includes('B <- A'), JSON.stringify(rel));

/* 2. a quick swipe is a scroll, not a move */
const before = (await rows()).join(',');
const from = await centre('B'), to = await centre('A');
await touch('touchStart', from.x, from.y);
for (let i = 1; i <= 4; i++) {
  await touch('touchMove', from.x, from.y + 18 * i);
  await page.waitForTimeout(30);
}
await touch('touchEnd');
await page.waitForTimeout(900);
check('a quick swipe scrolls instead of moving a note', (await rows()).join(',') === before);

/* 3. the recycle bin takes a note from a finger too */
await openList();
const bin = await page.locator('#btn-trash').boundingBox();
const wentIn = await liftAndDrag(await centre('B'), {
  x: Math.round(bin.x + bin.width / 2),
  y: Math.round(bin.y + bin.height / 2),
});
check('the bin is reachable with a finger', wentIn);
await openList();
rel = await rows();
check('a note dropped on the bin with a finger is in the bin', rel.some((r) => r.startsWith('B <-') && r.endsWith('[bin]')),
  JSON.stringify(rel));
check('the bin label says what it will do', (await page.textContent('.trash-label')).trim() === 'recycle bin');

/* 4. a plain tap still opens a note */
await openList();
await page.click('#list-items .tree-row:has(.li-title:text-is("A"))');
await page.waitForTimeout(900);
check('a tap still just opens the note',
  await page.evaluate(() => location.hash.startsWith('#/n/')) && (await page.inputValue('#title')) === 'A');

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.evaluate(() => import('/lib/supabase.js').then((m) => m.deleteAccount())).catch(() => {});
await browser.close();
srv.close();

console.log(`\n${pass}/${pass + fail} touch checks passed\n`);
process.exit(fail ? 1 : 0);
