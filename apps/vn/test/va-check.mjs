/* va — architecture check. A job, its pile, a mocked model that answers with a
 * box list, a shared link and a phone. Leaves nothing behind.
 *
 *   node va-check.mjs                        # http://127.0.0.1:8107
 *   VA_URL=https://va.terg.hr node va-check.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const B = process.env.VA_URL || 'http://127.0.0.1:8107';
const OWNER = { email: 'vpl-agent@terg.hr', pass: 'agent-vpl-2026!' };
const GUEST = { email: 'vpl-guest@terg.hr', pass: 'guest-vpl-2026!' };
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
async function login(pg, who) {
  await pg.goto(B, { waitUntil: 'networkidle' });
  await pg.fill('#email', who.email);
  await pg.fill('#pass', who.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(1000);
}

const ANSWER = `The system is one notes app for one person: the person writes in a browser,
the page is static, and every row lives in Supabase. Nothing else crosses the
boundary.

\`\`\`yaml
boxes:
  - id: person
    label: Person
    kind: person
    host: ""
    note: [no address] the one user
  - id: vn
    label: vn
    kind: external
    host: vn.terg.hr
    note: the notes app itself
arrows:
  - from: person
    to: vn
    label: https
\`\`\`

## What I checked
- the brief in the pile

## What I did not check
- whether the page talks to Supabase directly
`;

const KEY = JSON.stringify({ url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  key: 'test-key-not-real', model: 'gemini-3.1-flash-lite' });

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 },
  permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript((k) => { try { localStorage.setItem('vpl.ai', k); } catch {} }, KEY);
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

/* the model is mocked at the suite's own door, so nothing is spent and the
 * request body can be read: the notes a person adds must reach the model */
let lastUser = '';
async function mockModel(ctxPage) {
  await ctxPage.route('**/chat', async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, apikey',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    try {
      const body = JSON.parse(req.postData() || '{}');
      lastUser = body.messages?.find((m) => m.role === 'user')?.content || '';
    } catch { lastUser = ''; }
    await new Promise((r) => setTimeout(r, 250));
    return route.fulfill({
      status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: ANSWER } }] }),
    });
  });
}

await mockModel(pg);
await login(pg, OWNER);
ok(await pg.locator('#app').isVisible(), 'signed in, the desk is up');

/* ── a job ───────────────────────────────────────────────────────── */
if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
else await pg.click('#btn-new-project');
await until(async () => (await pg.inputValue('#proj-title')) === 'untitled job');
await pg.fill('#proj-title', 'va-check ' + STAMP);
await pg.waitForTimeout(1300);
ok((await pg.textContent('#proj-meta')).includes('0 inputs'), 'a new job has no inputs');
ok(await pg.locator('#out-none').isVisible(), 'the output pane says what will happen here');
ok((await pg.inputValue('#proj-title')).includes('va-check'), 'the job has a name');

/* ── one input pasted ───────────────────────────────────────────── */
await pg.click('#btn-add-text');
await pg.waitForSelector('#art-dialog[open]');
await pg.fill('#art-title', 'brief ' + STAMP);
await pg.fill('#art-text', 'One notes app for one person: a static page, Supabase for accounts and rows, no other moving parts. Address vn.terg.hr.');
await pg.click('#art-save');
await until(async () => (await pg.locator('#artifacts .art').count()) === 1);
ok((await pg.locator('#artifacts .art').count()) === 1, 'the pasted input is on the pile');
ok((await pg.textContent('#artifacts .line')).includes('words'), 'it reports how much there is to read');
ok((await pg.textContent('#proj-meta')).includes('1 input'), 'the meta line counts one input');

/* ── one file, and its text ─────────────────────────────────────── */
const dir = mkdtempSync(join(tmpdir(), 'va-'));
const txt = join(dir, 'uslovi.txt');
writeFileSync(txt, 'Inventory: api on 10.0.0.5:8080, postgres at 10.0.0.6:5432, no digest pinning.');
await pg.setInputFiles('#file-input', txt);
ok(await until(async () => (await pg.locator('#artifacts .art').count()) === 2), 'a file becomes a second input');
await pg.locator('#artifacts .name').nth(1).click();
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.inputValue('#art-text')).includes('postgres at 10.0.0.6'), 'the text was taken out of the file');
ok((await pg.textContent('#art-file')).includes('uslovi.txt'), 'the original is named, and kept');
await pg.click('#art-x2');

/* ── the template is a decision and it persists ─────────────────── */
await pg.selectOption('#template', 'overview');
await pg.waitForTimeout(800);
ok((await pg.textContent('#template-about')).includes('components inside'), 'the template explains itself in words');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1500);
ok((await pg.inputValue('#template')) === 'overview', 'the template survives a reload');
await pg.selectOption('#template', 'context');
await pg.waitForTimeout(700);

/* ── generate, with the model mocked at the shared door ─────────── */
await pg.click('#btn-generate');
ok(await until(async () => (await pg.locator('#out-body').isVisible())), 'the document appears on the desk');
ok((await pg.inputValue('#out-body')).includes('boxes:'), 'the answer carries the box list the template asked for');
ok((await pg.textContent('#gen-msg')).includes('read it'), 'the app says it is a draft to read');
ok(lastUser.includes('brief ' + STAMP) && lastUser.includes('Inventory:'), 'every input was sent to the model');
ok(lastUser.includes('system context'), 'the template reached the model as a task');

/* ── notes change the next answer ───────────────────────────────── */
await pg.fill('#notes', 'no invented addresses — say what is missing');
await pg.click('#btn-generate');
ok(await until(async () => (await pg.locator('#out-versions option').count()) === 2), 'a second answer keeps the first as a version');
ok(lastUser.includes('no invented addresses'), 'the notes were sent with the inputs');
ok(await pg.locator('#out-versions').isVisible(), 'earlier versions are one pick away');
await pg.selectOption('#out-versions', { index: 1 });
await pg.waitForTimeout(300);
await pg.selectOption('#out-versions', { index: 0 });
await pg.waitForTimeout(300);

/* ── the person's edit is what is kept ──────────────────────────── */
const edited = (await pg.inputValue('#out-body')).replace('## What I checked', '## What I checked (by hand)');
await pg.fill('#out-body', edited + '\n\n— pregledao ' + STAMP);
await pg.waitForTimeout(1100);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1600);
ok((await pg.inputValue('#out-body')).includes('pregledao ' + STAMP), 'the edit is saved without a button');
ok((await pg.inputValue('#out-body')).includes('by hand'), 'and the changed heading stayed changed');

/* ── copy, print plumbing ───────────────────────────────────────── */
await pg.click('#btn-copy');
await pg.waitForTimeout(200);
const clip = await pg.evaluate(() => navigator.clipboard.readText());
ok(clip.includes('pregledao ' + STAMP), 'copy puts the answer on the clipboard');

/* ── an input leaves ────────────────────────────────────────────── */
await pg.locator('#artifacts .art').nth(1).locator('.del').click();
ok(await until(async () => (await pg.locator('#artifacts .art').count()) === 1), 'an input can be removed');
ok((await pg.textContent('#proj-meta')).includes('1 input'), 'and the count follows');

/* ── a link, and a guest who reads ──────────────────────────────── */
await pg.click('#btn-share');
await pg.waitForSelector('#share-dialog[open]');
await pg.click('#share-make');
ok(await until(async () => (await pg.inputValue('#share-link')).includes('?s=')), 'a read-only link is made');
const link = await pg.inputValue('#share-link');
await pg.fill('#share-email', GUEST.email);
await pg.selectOption('#share-role', 'view');
await pg.click('#share-add');
ok(await until(async () => (await pg.locator('#share-list li').count()) >= 1), 'one person is on the list');
await pg.click('#share-x');

const gctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const gp = await gctx.newPage();
gp.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
gp.on('dialog', (d) => d.accept());
gp.on('console', (m) => console.log('  gp[' + m.type() + ']', m.text()));
await mockModel(gp);
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1200);
const gtitle = await gp.inputValue('#proj-title');
const gbody = await gp.inputValue('#out-body');
if (!gtitle.includes('va-check') || !gbody.includes(STAMP)) console.log('  guest saw:', JSON.stringify(gtitle), JSON.stringify(gbody.slice(0, 60)));
ok(gtitle.includes('va-check ' + STAMP), 'a guest sees the job');
ok(await gp.locator('#guest-banner').isVisible(), 'and is told it is shared');
ok((await gp.inputValue('#out-body')).includes('pregledao ' + STAMP), 'the guest reads the document');
ok(!(await gp.locator('#btn-generate').isVisible()), 'a reader has no generate button');
ok((await gp.locator('#artifacts .art').count()) === 1, 'the inputs are there to read');

/* ── a copy becomes the guest's, then is thrown away ─────────────── */
await gp.click('#btn-own');
await gp.waitForSelector('#gate:not([hidden])');
await gp.fill('#email', GUEST.email);
await gp.fill('#pass', GUEST.pass);
await gp.click('#btn-login');
await gp.waitForSelector('#app:not([hidden])');
ok(await until(async () => (await gp.inputValue('#proj-title')).includes('(copy)')), 'signing in makes the copy on the way');
await gp.waitForTimeout(900);
ok((await gp.inputValue('#out-body')).includes('pregledao ' + STAMP), 'the copy carries the document');

await gp.click('#proj-list .proj-row.on .kill');
await gp.waitForTimeout(1200);
ok(await until(async () => !(await gp.textContent('#proj-list')).includes('(copy)')), 'the guest tidies up after themselves');
ok((await gp.textContent('#proj-list')).includes('va-check ' + STAMP), 'the shared job stays in the guest list, without a delete');

/* ── a phone: one column, nothing sideways ──────────────────────── */
await pg.setViewportSize({ width: 390, height: 844 });
await pg.waitForTimeout(500);
const wide = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(wide === 0, 'a phone does not scroll sideways (' + wide + ' px)');
await pg.screenshot({ path: '/home/vergovic/vixen/.shots/va-phone.png', fullPage: false });
const cols = await pg.evaluate(() => getComputedStyle(document.querySelector('.work')).gridTemplateColumns);
ok(!/\d+px \d+px/.test(cols), 'inputs and output sit one under the other');
await pg.setViewportSize({ width: 1400, height: 950 });
await pg.waitForTimeout(400);
await pg.screenshot({ path: '/home/vergovic/vixen/.shots/va-desktop.png', fullPage: false });

/* ── tidy: the owner's job goes, and so does the guest's ────────── */
await pg.click('#proj-list .proj-row.on .kill');
await pg.waitForTimeout(1200);
ok(await until(async () => !(await pg.textContent('#proj-list')).includes('va-check ' + STAMP)), 'the job is deleted');

ok(errors.length === 0, 'no console or page errors');
if (errors.length) console.log(errors.slice(0, 4).join('\n'));

await br.close();
console.log(`\nva: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
