/* vc — compliance check. Two piles in, a verdict strip out, one guest link and
 * a phone. The model is mocked; nothing is spent and nothing is left behind.
 *
 *   node vc-check.mjs                        # http://127.0.0.1:8105
 *   VC_URL=https://vc.terg.hr node vc-check.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OWNER, GUEST } from './_account.mjs';

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
async function login(pg, who) {
  await pg.goto(B, { waitUntil: 'networkidle' });
  await pg.fill('#email', who.email);
  await pg.fill('#pass', who.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(1000);
}

const ANSWER = `# Izvještaj o usklađenosti — pristup sustavu

## Sažetak
Tri kontrole su dokazane, jedna nije, dvije nemaju dokaz.

## Nalazi
- PASS — Lozinke — zapisnik od 12.3. pokazuje obaveznu promjenu svakih 90 dana.
- PASS — MFA — svi administratori imaju MFA (popis u prilogu).
- PASS — Rezervne kopije — dnevne, provjereno 20.3.
- FAIL — Zaključavanje nakon neuspješnih prijava — politika postoji, ali nije primijenjena na dvije stanice.
- UNKNOWN — Šifriranje diska — nema dokaza u ulazima.
- UNKNOWN — Popis ovlaštenih osoba — popis nije priložen.

## Što prvo popraviti
Primijeniti zaključavanje na dvije stanice.

## Što nedostaje
Dokaz o šifriranju i popis ovlaštenih osoba.
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

let lastUser = '';
async function mockModel(page) {
  await page.route('**/chat', async (route) => {
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
    await new Promise((r) => setTimeout(r, 200));
    return route.fulfill({
      status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: ANSWER } }] }),
    });
  });
}

await mockModel(pg);
await login(pg, OWNER);
ok(await pg.locator('#app').isVisible(), 'signed in, the desk is up');

/* ── a check, with two empty piles ──────────────────────────────── */
if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
else await pg.click('#btn-new');
await until(async () => (await pg.inputValue('#proj-title')) === 'untitled job');
await pg.fill('#proj-title', 'vc-check ' + STAMP);
await pg.waitForTimeout(1300);
ok(await pg.locator('#std-none').isVisible(), 'the rules pile says it is empty');
ok(await pg.locator('#ev-none').isVisible(), 'the evidence pile says it is empty');

/* ── a standard and two proofs ──────────────────────────────────── */
await pg.click('#btn-add-standard');
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.textContent('#art-head')).includes('standard'), 'the dialog knows it is a standard');
await pg.fill('#art-title', 'Politika lozinki');
await pg.fill('#art-text', 'Lozinke se mijenjaju svakih 90 dana. MFA je obavezan za administratore. Zaključavanje nakon 5 neuspješnih prijava.');
await pg.click('#art-save');
await until(async () => (await pg.locator('#standards .art').count()) === 1);
ok((await pg.locator('#standards .art').count()) === 1, 'the standard sits in the rules pile');
ok((await pg.locator('#evidence .art').count()) === 0, 'and not among the proofs');

await pg.click('#btn-add-evidence');
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.textContent('#art-head')).includes('dokaz'), 'the dialog knows it is a proof');
await pg.fill('#art-title', 'Zapisnik 12.3.');
await pg.fill('#art-text', 'Promjena lozinke svakih 90 dana potvrđena. MFA uključen na svim administratorskim računima.');
await pg.click('#art-save');
await until(async () => (await pg.locator('#evidence .art').count()) === 1);
ok((await pg.locator('#evidence .art').count()) === 1, 'the proof sits in the evidence pile');

const dir = mkdtempSync(join(tmpdir(), 'vc-'));
const txt = join(dir, 'popis.txt');
writeFileSync(txt, 'Ovlaštene osobe: Ana, Marko. Nijedan račun nema MFA.');
await pg.setInputFiles('#file-input', txt);
ok(await until(async () => (await pg.locator('#evidence .art').count()) === 2), 'a file is a second proof');
ok((await pg.textContent('#proj-meta')).includes('1 standard'), 'the meta line counts the rules');
ok((await pg.textContent('#proj-meta')).includes('2 dokaza'), 'and the proofs');

/* ── generate: the strip reads the report ───────────────────────── */
await pg.click('#btn-generate');
ok(await until(async () => await pg.locator('#findings').isVisible()), 'the findings strip appears');
ok((await pg.textContent('#n-pass')) === '3', 'three pass, counted');
ok((await pg.textContent('#n-fail')) === '1', 'one fail, counted');
ok((await pg.textContent('#n-unknown')) === '2', 'two unknown, counted');
ok((await pg.textContent('#findings-note')).includes('6 controls'), 'and the strip says six controls in words');
ok(lastUser.includes('Politika lozinki') && lastUser.includes('Zapisnik 12.3.'), 'both piles reached the model');
ok(lastUser.includes('UNKNOWN means the evidence was not in the inputs'), 'the template forbids guessing a pass');

/* ── a person changes a verdict; the strip follows ──────────────── */
const body = await pg.inputValue('#out-body');
await pg.fill('#out-body', body.replace('- UNKNOWN — Šifriranje diska — nema dokaza u ulazima.',
  '- FAIL — Šifriranje diska — nema dokaza u ulazima.'));
await pg.waitForTimeout(400);
ok((await pg.textContent('#n-unknown')) === '1' && (await pg.textContent('#n-fail')) === '2',
  'editing a verdict line moves the count');
await pg.waitForTimeout(1000);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1600);
ok((await pg.inputValue('#out-body')).includes('- FAIL — Šifriranje diska'), 'the edit is saved');
ok((await pg.textContent('#n-fail')) === '2', 'and the strip is right after a reload');

/* ── notes and a second version ─────────────────────────────────── */
await pg.fill('#notes', 'dodaj kontrolu o popisu ovlaštenih');
await pg.click('#btn-generate');
ok(await until(async () => (await pg.locator('#out-versions option').count()) === 2), 'a second report keeps the first');
ok(lastUser.includes('dodaj kontrolu o popisu'), 'the notes reached the model');

/* ── copy ───────────────────────────────────────────────────────── */
await pg.click('#btn-copy');
await pg.waitForTimeout(200);
ok((await pg.evaluate(() => navigator.clipboard.readText())).includes('Izvještaj o usklađenosti'),
  'copy puts the report on the clipboard');

/* ── a link and a reader ────────────────────────────────────────── */
await pg.click('#btn-share');
await pg.waitForSelector('#share-dialog[open]');
await pg.click('#share-make');
ok(await until(async () => (await pg.inputValue('#share-link')).includes('?s=')), 'a read-only link is made');
const link = await pg.inputValue('#share-link');
await pg.click('#share-x');

const gctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const gp = await gctx.newPage();
gp.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
gp.on('dialog', (d) => d.accept());
await mockModel(gp);
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1300);
ok((await gp.inputValue('#proj-title')).includes('vc-check ' + STAMP), 'a guest sees the check');
ok((await gp.locator('#standards .art').count()) === 1, 'the rules are there to read');
ok((await gp.locator('#evidence .art').count()) === 2, 'and the proofs');
ok((await gp.locator('#findings').isVisible()), 'the strip is there for the guest too');
ok(!(await gp.locator('#btn-generate').isVisible()), 'a reader cannot generate');
ok(!(await gp.locator('#btn-add-standard').isVisible()), 'a reader cannot add a rule');

/* ── a phone ────────────────────────────────────────────────────── */
await pg.setViewportSize({ width: 390, height: 844 });
await pg.waitForTimeout(500);
const wide = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(wide === 0, 'a phone does not scroll sideways (' + wide + ' px)');
await pg.screenshot({ path: '/home/vergovic/vixen/.shots/vc-phone.png', fullPage: false });
await pg.setViewportSize({ width: 1400, height: 950 });
await pg.waitForTimeout(400);
await pg.screenshot({ path: '/home/vergovic/vixen/.shots/vc-desktop.png', fullPage: false });

/* ── tidy ───────────────────────────────────────────────────────── */
await pg.click('#proj-list .proj-row.on .kill');
await pg.waitForTimeout(1200);
ok(await until(async () => !(await pg.textContent('#proj-list')).includes('vc-check ' + STAMP)), 'the check is deleted');

/* ✕ must not be final: the job goes to the bin in the rail, comes back, and
 * only a second, named question ends it. */
ok(await until(async () => ((await pg.textContent('#job-bin-count')) || '').trim().length > 0, 8000),
  '✕ puts the check in the bin in the rail, and the button counts it');
await pg.click('#btn-job-bin');
ok(await until(async () => pg.evaluate(() => document.querySelector('#btn-job-bin').getAttribute('aria-pressed') === 'true'), 6000),
  'the bin opens as a place, and says so');
ok(await until(async () => /binned|nothing in it/.test(await pg.textContent('#job-bin-note')), 6000),
  'a sentence at the top names it and counts what is in it');
ok(await until(async () => (await pg.textContent('#proj-list')).includes(STAMP), 8000),
  'the binned check is there to restore');
await pg.locator('#proj-list [data-back]').first().click();
ok(await until(async () => ((await pg.inputValue('#proj-title')) || '').includes(STAMP), 10000),
  'restoring opens the thing it brought back');
ok(await until(async () => pg.evaluate(() => document.querySelector('#btn-job-bin').getAttribute('aria-pressed') === 'false'), 8000),
  'restoring leaves the bin and opens what came back');
/* and the way out of the bin for good: bin it again, purge it */
await pg.locator('#proj-list .proj-row.on .kill').click({ force: true });
await pg.waitForTimeout(900);
await pg.click('#btn-job-bin');
await until(async () => pg.locator('#proj-list [data-purge]').count(), 6000);
await pg.locator('#proj-list [data-purge]').first().click();
ok(await until(async () => !(await pg.textContent('#proj-list')).includes(STAMP), 8000),
  'deleting for good takes it out of the bin');

ok(errors.length === 0, 'no console or page errors');
if (errors.length) console.log(errors.slice(0, 4).join('\n'));

await br.close();
console.log(`\nvc: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
