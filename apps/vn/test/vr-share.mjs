/* vr — one document, two people.
 *
 *   VR_URL=http://127.0.0.1:8101 node vr-share.mjs
 *
 * A public link (read-only, no account) and a personal grant (may write text,
 * never decides). The last check is the important one: it asks the database
 * directly, because a rule that only lives in the screen is a wish.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const B = process.env.VR_URL || 'http://127.0.0.1:8101';
const cfg = readFileSync(new URL('../../../apps/vr/config.local.js', import.meta.url), 'utf8');
const URL_ = /url:\s*'([^']+)'/.exec(cfg)[1];
const KEY = /anon:\s*'([^']+)'/.exec(cfg)[1];
const GUEST = { email: 'vpl-guest@terg.hr', pass: 'guest-vpl-2026!' };

let pass = 0, fail = 0;
const ok = (cond, what) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const until = async (fn, ms = 8000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

/* the second account exists for tests; created once, harmless afterwards */
async function ensureGuest() {
  const r = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: GUEST.email, password: GUEST.pass }),
  });
  if (!r.ok && r.status !== 422) console.log('  note: could not create the guest account', r.status);
  const t = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: GUEST.email, password: GUEST.pass }),
  });
  return (await t.json()).access_token;
}

const guestToken = await ensureGuest();
if (!guestToken) { console.log('no second account; cannot test the personal grant'); process.exit(1); }

const br = await chromium.launch();
const owner = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await owner.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('dialog', (d) => d.accept());

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', 'vpl-agent@terg.hr');
await pg.fill('#pass', 'agent-vpl-2026!');
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1200);
await pg.click('#btn-new-project');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'vr-share test');
await pg.waitForTimeout(800);

await pg.click('.brief summary');
await pg.fill('#brief-text', 'a small hut, for the sharing test');
await pg.click('#brief-save');
await pg.waitForTimeout(700);
await pg.fill('#req-add', 'The hut shall stand in the garden.');
await pg.press('#req-add', 'Enter');
await pg.waitForTimeout(800);
await pg.click('#btn-glossary');
await pg.fill('#term-word', 'hut');
await pg.fill('#term-mean', 'the small wooden thing this document is about');
await pg.click('#term-add-b');
await pg.waitForTimeout(700);
await pg.click('#glossary-x');

// ── the proof travels with the document
await pg.locator('#rows tr[data-id]').first().locator('.req-open').click();
await pg.waitForTimeout(600);
const proofId = await pg.locator('#rows tr.detail').evaluate((tr) => tr.previousElementSibling.dataset.id);
await pg.setInputFiles(`input[data-file-input="${proofId}"]`, {
  name: 'merenje.txt', mimeType: 'text/plain', buffer: Buffer.from('nagib 22 · 42 m2'),
});
ok(await until(async () => (await pg.textContent(`#d-msg-${proofId}`)).includes('attached'), 15000),
  'the owner attaches a proof to the row');
await pg.locator('button[data-close]').first().click();
await pg.waitForTimeout(400);

// ── the link
await pg.click('#btn-share');
await pg.waitForTimeout(400);
await pg.click('#share-make');
await pg.waitForTimeout(1200);
const link = await pg.inputValue('#share-link');
ok(/^http.*\?s=\w{10,}$/.test(link), 'a public link is minted');
ok(!(await pg.locator('#share-list li').first().textContent()).includes('write'), 'a link is read, never write');

const guest = await br.newContext({ viewport: { width: 1280, height: 900 } });
const gp = await guest.newPage();
gp.on('pageerror', (e) => errors.push('guest: ' + e.message));
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1800);
ok(!(await gp.locator('#spec').isHidden()), 'the link opens the document without an account');
ok((await gp.evaluate(() => document.body.dataset.role)) === 'view', 'and it is read only');
ok(/shared document/i.test(await gp.textContent('#guest-banner')), 'the banner says it is a shared document');
ok((await gp.locator('#rows tr[data-id]').count()) === 1, 'the rows came with it');
ok(await gp.locator('#add-row, .add-row').first().isHidden(), 'a reader has no row to type in');
ok(await gp.locator('#btn-share').isHidden(), 'a reader cannot share it on');
ok(await gp.locator('#projects').isHidden(), 'and has no rail of documents');

// a strength click must do nothing for a reader
await gp.locator('#rows tr[data-id]').first().locator('.c-strength .chip-value').click();
await gp.waitForTimeout(600);
ok((await gp.locator('#rows tr[data-id]').first().locator('.c-strength .chip-value').textContent()).includes('must'),
  'a reader cannot change how hard a row is');
await gp.click('#btn-glossary');
await gp.waitForTimeout(300);
ok((await gp.inputValue('#term-list li input')).includes('small wooden thing'), 'the glossary travels too');
await gp.click('#glossary-x');

// ── one person, with a role
await pg.fill('#share-email', 'VPL-Guest@Terg.hr');   // case is not an identity
await pg.selectOption('#share-role', 'edit');
await pg.click('#share-add');
await pg.waitForTimeout(1200);
ok((await pg.textContent('#share-msg')).includes('shared'), 'the document is shared with an address');

// the guest signs in and finds it in the rail
const gs = await br.newContext({ viewport: { width: 1280, height: 900 } });
const sp = await gs.newPage();
sp.on('pageerror', (e) => errors.push('guest2: ' + e.message));
sp.on('dialog', (d) => d.accept());
await sp.goto(B, { waitUntil: 'networkidle' });
await sp.fill('#email', GUEST.email);
await sp.fill('#pass', GUEST.pass);
await sp.click('#btn-login');
await sp.waitForSelector('#app:not([hidden])');
await sp.waitForTimeout(1600);
const rows = sp.locator('.proj-row .pick');
let found = false;
for (let i = 0; i < await rows.count(); i++) {
  if ((await rows.nth(i).textContent()).includes('vr-share test')) { await rows.nth(i).click(); found = true; break; }
}
ok(found, 'the shared document is in the guest rail');
await sp.waitForTimeout(1200);
ok((await sp.evaluate(() => document.body.dataset.role)) === 'edit', 'the grant says: may write');
ok((await sp.textContent('#proj-meta')).includes('you may write, not decide'), 'the sheet says what that means');

// text is theirs
await sp.fill('#req-add', 'The guest shall be allowed to add a sentence.');
await sp.press('#req-add', 'Enter');
await sp.waitForTimeout(900);
ok((await sp.locator('#rows tr[data-id]').count()) === 2, 'an editor may add a row');

// decisions are not
await sp.locator('#rows tr[data-id]').first().locator('.c-strength .chip-value').click();
await sp.waitForTimeout(700);
ok((await sp.locator('#rows tr[data-id]').first().locator('.c-strength .chip-value').textContent()).includes('must'),
  'an editor cannot change the strength on screen');

// ── and the database says the same thing, in its own words
const r = await fetch(`${URL_}/rest/v1/vr_reqs?select=id,project_id,strength&limit=1`, {
  headers: { apikey: KEY, Authorization: 'Bearer ' + guestToken },
});
const [row] = await r.json();
const bad = await fetch(`${URL_}/rest/v1/vr_reqs?id=eq.${row.id}`, {
  method: 'PATCH',
  headers: { apikey: KEY, Authorization: 'Bearer ' + guestToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ strength: 'wish' }),
});
const body = await bad.text();
ok(bad.status === 400 && body.includes('only the owner'), 'the database refuses a decision by an editor: ' + (JSON.parse(body).code || bad.status));

const good = await fetch(`${URL_}/rest/v1/vr_reqs?id=eq.${row.id}`, {
  method: 'PATCH',
  headers: { apikey: KEY, Authorization: 'Bearer ' + guestToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ theme: 'the garden' }),
});
ok(good.ok, 'but the database accepts text from the same editor');

// ── a shared document can become one of your own
const beforeCopy = await sp.locator('#rows tr[data-id]').count();
await sp.click('#btn-own');
const copied = await until(async () => {
  const t = await sp.inputValue('#proj-title').catch(() => '');
  return t.endsWith('(copy)');
}, 25000);
ok(copied, 'an editor can take a copy where the decisions are theirs');
ok((await sp.evaluate(() => document.body.dataset.role)) === 'owner', 'and the copy says: you are the owner');
ok(await until(async () => (await sp.locator('#rows tr[data-id]').count()) === beforeCopy, 20000),
  'every row came with the copy');
await sp.locator('#rows tr[data-id]').first().locator('.req-open').click();
await sp.waitForTimeout(800);
ok(await until(async () => (await sp.locator('button[data-open-file]').count()) > 0, 20000),
  'the attached proof came with the copy too');
const proofName = await sp.locator('button[data-open-file]').first().textContent();
ok(proofName.includes('merenje.txt'), '...with its name intact: ' + proofName.trim());
await sp.locator('button[data-close]').first().click();
await sp.waitForTimeout(300);
await sp.locator('#rows tr[data-id] .c-strength .chip-value').first().click();
await sp.waitForTimeout(1200);
const ownStrength = await sp.locator('#rows tr[data-id] .c-strength .chip-value').first().textContent();
ok(!ownStrength.includes('must'), 'in the copy the strength moves: ' + ownStrength.trim().slice(0, 20));
await sp.locator('.proj-row.on .kill').first().click();
await sp.waitForTimeout(1500);

// ── revoking closes the door
await pg.click('#share-list li button');
await pg.waitForTimeout(1200);
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1500);
ok(await gp.locator('#spec').isHidden(), 'a revoked link shows the gate, not the document');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));

// ── tidy: the test owns one document
await pg.click('#share-x');
await pg.waitForTimeout(300);
await pg.locator('.proj-row.on .kill').click();
await pg.waitForTimeout(1400);

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
