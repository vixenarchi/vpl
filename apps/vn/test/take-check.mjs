/* Taking something with you: the two transfer buttons in the reader.
 *
 *   owner  writes a two-chapter note and makes a public link
 *   anon   opens the link, presses "copy markdown", gets the whole subtree
 *   reader signs in, presses "copy to my notes", and the copy is theirs
 *
 * The point of the second one is ownership, not import: the copy gets fresh
 * ids under the reader's own account, so they can rename, move and delete it.
 *
 *   VN_URL=https://vn.terg.hr node take-check.mjs   (against production)
 *   node take-check.mjs                             (own server on 8095)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { OWNER, GUEST } from './_account.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 8095;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const OWN_SERVER = !process.env.VN_URL;

let srv = null;
if (OWN_SERVER) {
  srv = createServer((q, r) => {
    const u = new URL(q.url, 'http://x').pathname;
    const name = u === '/' ? '/index.html' : u;
    try {
      const body = readFileSync(join(ROOT, name));
      r.writeHead(200, { 'content-type': MIME[name.slice(name.lastIndexOf('.'))] || 'text/plain' });
      r.end(body);
    } catch { r.writeHead(404).end('not found'); }
  });
  await new Promise((ok) => srv.listen(PORT, '127.0.0.1', ok));
}

const BASE = (process.env.VN_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '') + '/';
const READER = GUEST;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const browser = await chromium.launch();
const errors = [];
const stamp = Date.now();

const until = async (fn, ms = 10000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

async function newPage() {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 940 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return page;
}

async function signIn(page, who) {
  await page.goto(BASE);
  await page.fill('#email', who.email);
  await page.fill('#pass', who.pass);
  await page.click('#btn-login');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

const clip = (page) => page.evaluate(() => navigator.clipboard.readText());

/* ── 1. the owner writes a note with a chapter ────────────────────── */
const op = await newPage();
await signIn(op, OWNER);

await op.click('#btn-new');
await op.waitForFunction(() => location.hash.startsWith('#/n/'), { timeout: 10000 });
await op.fill('#title', 'take me ' + stamp);
await op.click('#editable');
await op.evaluate(async () => {
  const { mdToHtml } = await import('/lib/editor.js');
  const ed = document.getElementById('editable');
  ed.innerHTML = mdToHtml('the opening line, in **markdown**.');
  ed.dispatchEvent(new Event('input', { bubbles: true }));
});
await op.waitForTimeout(1300);

const beforeChild = await op.locator('#list-items li').count();
await op.click('#btn-child');
await until(async () => (await op.locator('#list-items li').count()) > beforeChild, 10000);
await op.fill('#title', 'a chapter');
await op.click('#editable');
await op.evaluate(async () => {
  const { mdToHtml } = await import('/lib/editor.js');
  const ed = document.getElementById('editable');
  ed.innerHTML = mdToHtml('the chapter body.');
  ed.dispatchEvent(new Event('input', { bubbles: true }));
});
await op.waitForTimeout(1300);

/* back to the root, where the link is made */
await op.locator('#list-items li:has-text("take me ' + stamp + '")').first().click();
await op.waitForTimeout(800);
await op.click('#btn-share');
await op.check('#share-public');
await op.waitForFunction(() => !document.getElementById('share-link-row').hidden, { timeout: 15000 });
const link = await op.inputValue('#share-link');
check('the owner can make a public link', /#\/s\//.test(link), link.slice(0, 60));
await op.click('#share-x');

/* ── 2. a stranger copies the whole subtree as markdown ───────────── */
const gp = await newPage();
await gp.goto(link);
await gp.waitForSelector('#reader:not([hidden])');
await gp.waitForSelector('#reader-title');
await until(async () => (await gp.textContent('#reader-title')) === 'take me ' + stamp);

check('the reader is not asked to sign in', !(await gp.isVisible('#gate')));
check('the reader offers no "copy to my notes"', !(await gp.isVisible('#reader-own')));
await gp.click('#reader-md-copy');
await gp.waitForTimeout(600);
const md = await clip(gp);
check('copy markdown put the note on the clipboard', md.includes('# take me ' + stamp), JSON.stringify(md.slice(0, 40)));
check('...and the chapter under it, one level deeper', /## a chapter/.test(md), md.replace(/\n/g, ' | ').slice(0, 120));
check('...with both bodies intact', md.includes('the opening line, in **markdown**.') && md.includes('the chapter body.'),
  md.replace(/\n/g, ' | ').slice(0, 120));
check('...and nothing twice', md.split('the chapter body.').length === 2, md.split('the chapter body.').length + ' copies');

/* ── 3. a signed-in reader copies it into their own notes ─────────── */
const rp = await newPage();
await signIn(rp, READER);
const roots = await rp.locator('#list-items li').count();
await rp.goto(link);
await rp.waitForSelector('#reader:not([hidden])');
await rp.waitForSelector('#reader-own:not([hidden])', { timeout: 15000 });
await rp.click('#reader-own');
await rp.waitForFunction(() => location.hash.startsWith('#/n/'), { timeout: 20000 });
await rp.waitForTimeout(1500);

check('the copy opened on the reader\'s own screen', (await rp.inputValue('#title')) === 'take me ' + stamp);
const after = await until(async () => (await rp.locator('#list-items li').count()) >= roots, 8000);
check('the copy is in the reader\'s list', !!after, `${roots} → ${await rp.locator('#list-items li').count()}`);
const chapters = await rp.evaluate(() => document.querySelectorAll('#list-items li').length);
check('the chapter came with it', chapters >= 2, chapters + ' rows');

/* the copy is a copy: deleting it must not touch the original */
await rp.click('#btn-del');
await rp.waitForTimeout(1200);

/* the reader's bin: a copy left behind would pile up on every run */
await rp.click('#btn-bin');
await rp.waitForTimeout(600);
await rp.click('#btn-bin-empty');
await rp.waitForTimeout(500);
await rp.click('#purge-go');
await rp.waitForTimeout(1500);

await rp.goto(link);
await rp.waitForSelector('#reader-title');
check('the original survives the copy being deleted', (await rp.textContent('#reader-title')) === 'take me ' + stamp);

/* ── 4. clean up the original ─────────────────────────────────────── */
await op.goto(BASE + '#/');
await op.waitForTimeout(800);
await op.locator('#list-items li:has-text("take me ' + stamp + '")').first().click();
await op.waitForTimeout(500);
await op.click('#btn-del');
await op.waitForTimeout(1200);
await op.evaluate(() => document.getElementById('bin-toggle')?.click());
await op.waitForTimeout(400);

/* page errors are failures: an empty clipboard is usually a crash, not a click */
check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));

console.log(`\n  ${pass} passed, ${fail} failed`);
await browser.close();
if (srv) srv.close();
process.exit(fail ? 1 : 0);
