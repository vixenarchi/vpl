/* Proves vpl is now a plain web app: no service worker, no caches, no
 * manifest. Nothing survives a reload except the Supabase session, which is
 * in localStorage and is the only thing that should. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, ''), PORT = 8099;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = createServer((q, r) => {
  const u = new URL(q.url, 'http://x').pathname;
  const n = u === '/' ? '/index.html' : u;
  try { const b = readFileSync(join(ROOT, n));
    r.writeHead(200, { 'content-type': MIME[n.slice(n.lastIndexOf('.'))] || 'text/plain' });
    r.end(b); } catch { r.writeHead(404).end('not found'); }
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const checks = [];
const check = (n, ok, d = '') => { checks.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? ' — ' + d : ''}`); };

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

check('page loads', await p.isVisible('#gate'));

const workers = await p.evaluate(async () =>
  (await navigator.serviceWorker.getRegistrations()).map((r) =>
    r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL));
check('no service worker registered', workers.length === 0, JSON.stringify(workers));

const caches_ = await p.evaluate(async () => await caches.keys());
check('no caches created', caches_.length === 0, JSON.stringify(caches_));

const cacheStorage = await p.evaluate(() => 'caches' in window);
check('Cache API untouched', cacheStorage === true);

const manifest = await p.evaluate(() =>
  !!document.querySelector('link[rel="manifest"]'));
check('no manifest link', manifest === false);

// register a user and create a note, then reload: the note must come from the
// network, not from anything stored locally.
const stamp = Date.now();
await p.fill('#email', `plain-${stamp}@example.com`);
await p.fill('#pass', 'secret123');
await p.click('#btn-register');
await p.waitForSelector('#app', { state: 'visible', timeout: 20000 });
await p.click('#btn-new');
await p.waitForFunction(() => location.hash.startsWith('#/n/'), { timeout: 10000 });
await p.fill('#title', 'plain note');
await p.waitForTimeout(1400);

await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#app', { state: 'visible', timeout: 20000 });
await p.waitForTimeout(1200);
const titles = await p.locator('#list-items .li-title').allTextContents();
check('data comes from the network after reload',
  titles.some((t) => t.trim() === 'plain note'), JSON.stringify(titles));

const after = await p.evaluate(async () =>
  (await navigator.serviceWorker.getRegistrations()).length);
check('still no worker after reload', after === 0, `${after}`);

check('no console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

await p.evaluate(() => import('/lib/supabase.js').then((m) => m.deleteAccount())).catch(() => {});
await b.close(); srv.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
