/* Taking a funnel with you: "copy" and "copy to mine" in vi.
 *
 *   owner  builds a small funnel and mints a public link
 *   guest  opens the link, copies it as markdown (clipboard), cannot copy it home
 *   reader signs in, presses "copy to mine", and the funnel is theirs
 *
 *   VI_URL=https://vi.terg.hr node vi-take.mjs   (against production)
 *   node vi-take.mjs                             (own server on 8096)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { OWNER, GUEST } from './_account.mjs';

const ROOT = new URL('../../vi', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 8096;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const OWN_SERVER = !process.env.VI_URL;

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

const BASE = (process.env.VI_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '') + '/';
const READER = GUEST;
const stamp = Date.now();
const TITLE = 'take me ' + stamp;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const browser = await chromium.launch();
const errors = [];

const until = async (fn, ms = 12000, step = 150) => {
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
  page.on('dialog', (d) => d.accept());
  return page;
}

async function signIn(page, who) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#email', who.email);
  await page.fill('#pass', who.pass);
  await page.click('#btn-login');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

const clip = (page) => page.evaluate(() => navigator.clipboard.readText());

/* ── 1. the owner builds a funnel ─────────────────────────────────── */
const op = await newPage();
await signIn(op, OWNER);
await op.click('#btn-new-project');
await op.waitForTimeout(1200);
await op.fill('#proj-title', TITLE);
await op.press('#proj-title', 'Enter');
await op.waitForTimeout(500);

await op.click('.step[data-stage="context"]');
await op.waitForTimeout(300);
await op.fill('#ctx-text', 'three people, one roof, two weeks');
await op.click('#ctx-save');
await op.waitForTimeout(700);
await op.click('.step[data-stage="ideation"]');
await op.waitForTimeout(300);
for (const idea of ['a ladder long enough', 'a second pair of hands']) {
  await op.fill('#note-input', idea);
  await op.press('#note-input', 'Enter');
  await op.waitForTimeout(700);
}
check('the funnel has two ideas', (await op.locator('.note').count()) === 2);

/* the owner can write its own funnel down as markdown too */
await op.click('#btn-md');
await op.waitForTimeout(500);
const ownMd = await clip(op);
check('the owner can copy the funnel as markdown', ownMd.startsWith('# ' + TITLE), JSON.stringify(ownMd.slice(0, 40)));
check('...with the question and the ideas in it', ownMd.includes('three people, one roof') && ownMd.includes('a ladder long enough'),
  ownMd.replace(/\n/g, ' | ').slice(0, 120));
check('the owner is offered no "copy to mine" of their own funnel', await op.locator('#btn-own').isHidden());

/* ── 2. a public link ─────────────────────────────────────────────── */
await op.click('#btn-share');
await op.waitForTimeout(500);
await op.click('#share-make');
await op.waitForTimeout(1500);
const link = await op.inputValue('#share-link');
check('a public link was minted', /^http.*\?s=\w{10,}$/.test(link), link.slice(0, 50));
await op.click('#share-x');

/* ── 3. a stranger: markdown yes, a copy no ───────────────────────── */
const gp = await newPage();
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1800);
check('the link opens without an account', !(await gp.locator('#app').isHidden()));
check('a guest without an account is not offered "copy to mine"', await gp.locator('#btn-own').isHidden());
await gp.click('#btn-md');
await gp.waitForTimeout(600);
const md = await clip(gp);
check('a guest can copy the shared funnel as markdown', md.includes(TITLE) && md.includes('a second pair of hands'),
  md.replace(/\n/g, ' | ').slice(0, 120));
check('...and the copy names the chosen idea first, not last', md.indexOf('## ideation') > 0);

/* ── 4. a signed-in reader takes it home ──────────────────────────── */
const rp = await newPage();
await signIn(rp, READER);
const before = await rp.locator('.proj-row').count();
await rp.goto(link, { waitUntil: 'networkidle' });
await rp.waitForTimeout(1800);
await rp.waitForSelector('#btn-own:not([hidden])', { timeout: 15000 });
await rp.click('#btn-own');
const grew = await until(async () => (await rp.locator('.proj-row').count()) > before, 15000);
check('the copy is in the reader\'s rail', !!grew, `${before} → ${await rp.locator('.proj-row').count()}`);
check('the copy opened on the reader\'s screen', (await rp.inputValue('#proj-title')) === TITLE);
check('the ideas came with the copy', (await rp.locator('.note').count()) === 2, (await rp.locator('.note').count()) + ' ideas');
await rp.click('.step[data-stage="context"]');
await rp.waitForTimeout(300);
check('the context came with it', (await rp.inputValue('#ctx-text')).includes('three people'));

/* the copy is a copy: deleting it must leave the original alone */
await rp.locator('.proj-row', { hasText: TITLE }).first().hover();
await rp.locator('.proj-row', { hasText: TITLE }).first().locator('.kill').click();
await rp.waitForTimeout(1500);
check('the reader deleted their own copy', !(await rp.locator('.proj-row', { hasText: TITLE }).count()));

await gp.reload({ waitUntil: 'networkidle' });
await gp.waitForTimeout(1500);
check('the original funnel is untouched', (await gp.locator('.note').count()) === 2);

/* ── 5. clean up the original ─────────────────────────────────────── */
await op.reload({ waitUntil: 'networkidle' });
await op.waitForSelector('.proj-row');
await op.locator('.proj-row', { hasText: TITLE }).first().locator('.kill').click();
await op.waitForTimeout(1500);

check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));

console.log(`\n  ${pass} passed, ${fail} failed`);
await browser.close();
if (srv) srv.close();
process.exit(fail ? 1 : 0);
