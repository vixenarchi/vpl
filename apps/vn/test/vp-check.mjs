/* vp — slips, keys, the ledger and the door.
 *
 *   PORT=8106 OAUTH_PORT=0 ./serve vp
 *   node vp-check.mjs
 *   VP_URL=https://vp.terg.hr node vp-check.mjs
 *
 * The provider is never called: the door is checked for its refusals (401, 403,
 * CORS), and a successful call is proven separately against a mocked fetch in
 * vp-proxy.mjs. No credit is spent by this file.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.VP_URL || 'http://127.0.0.1:8106';
const API = process.env.API_URL || 'https://api.terg.hr';
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
    await new Promise((r) => setTimeout(r, 90));
  }
}
async function login(pg, who) {
  await pg.goto(B, { waitUntil: 'networkidle' });
  await pg.fill('#email', who.email);
  await pg.fill('#pass', who.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await pg.waitForTimeout(900);
}

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1100, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

await login(pg, OWNER);
ok(await pg.locator('#app').isVisible(), 'the owner is in, the drawer is open');

/* leave the past behind: this account's drawer starts empty for the run */
const wipe = await pg.evaluate(async () => {
  const cfg = window.__VPL_CONFIG__;
  const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
  const tok = JSON.parse(localStorage.getItem(k)).access_token;
  const h = { apikey: cfg.anon, authorization: 'Bearer ' + tok };
  const a = await fetch(cfg.url + '/rest/v1/vp_keys?id=not.is.null', { method: 'DELETE', headers: h });
  const b = await fetch(cfg.url + '/rest/v1/vp_codes?id=not.is.null', { method: 'DELETE', headers: h });
  return { keys: a.status, codes: b.status };
});
ok(wipe.keys < 300 && wipe.codes < 300, 'the drawer can be emptied (' + wipe.keys + '/' + wipe.codes + ')');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });
await pg.waitForTimeout(600);
ok(await pg.locator('#codes-none').isVisible(), 'with no slips it says so');
ok(await pg.locator('#keys-none').isVisible(), 'and no keys');

/* ── make two slips ──────────────────────────────────────────────── */
await pg.fill('#mk-count', '2');
await pg.fill('#mk-credits', '5');
await pg.fill('#mk-label', 'vp-check ' + STAMP);
await pg.click('#mk-go');
ok(await until(async () => (await pg.locator('#slip-list .slip').count()) === 2), 'two slips appear');
const codes = (await pg.$$eval('.slip-code', (els) => els.map((e) => e.textContent.trim())));
ok(codes.length === 2 && codes.every((c) => /^vpc_[0-9a-f]{24}$/.test(c)), 'each is a code, and only shown here');
ok((await pg.textContent('#mk-msg')).includes('2 codes made'), 'and the page says how many');
ok((await pg.textContent('.slip-meta')).includes('5 calls'), 'the slip says the allowance in words');

ok(await until(async () => (await pg.locator('#codes li').count()) === 2), 'both slips are in the list of codes made');
ok((await pg.textContent('#codes')).includes('waiting'), 'a code nobody took yet reads "waiting"');

/* the slips are not readable by anybody else, and the plaintext is nowhere */
const stored = await pg.evaluate(async () => {
  const cfg = window.__VPL_CONFIG__;
  const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
  const tok = JSON.parse(localStorage.getItem(k)).access_token;
  const r = await fetch(cfg.url + '/rest/v1/vp_codes?select=*', {
    headers: { apikey: cfg.anon, authorization: 'Bearer ' + tok } });
  return await r.json();
});
ok(Array.isArray(stored) && stored.length === 2 && !JSON.stringify(stored).includes(codes[0]),
  'the database holds only the hash of each code');

/* ── a guest takes one ───────────────────────────────────────────── */
const gctx = await br.newContext({ viewport: { width: 1100, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'] });
const gp = await gctx.newPage();
gp.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
gp.on('console', (m) => { if (m.type() === 'error') errors.push('guest console: ' + m.text()); });
await login(gp, GUEST);
ok(await gp.locator('#codes-none').isVisible(), 'the guest sees none of the owner\'s codes');
ok(await until(async () => (await gp.locator('#keys-none').isVisible())), 'and holds no keys');

await gp.fill('#rd-code', codes[0]);
await gp.click('#rd-go');
ok(await until(async () => await gp.locator('#rd-out').isVisible()), 'the code becomes a key');
ok((await gp.textContent('#rd-url')) === 'https://api.terg.hr/vp', 'the address it replaces is the door, not a provider');
ok(/^vp_[0-9a-f]{32}$/.test((await gp.textContent('#rd-key')).trim()), 'the key is a vp key');
const model = (await gp.textContent('#rd-model')).trim();
ok(model.length > 0, 'and the model name comes along (' + model + ')');
ok((await gp.textContent('#rd-msg')).includes('5 calls'), 'the allowance is said out loud');

await gp.click('#rd-use');
ok(await until(async () => (await gp.textContent('#rd-use-msg')).includes('every app')), 'one click puts it into this browser');
const local = await gp.evaluate(() => JSON.parse(localStorage.getItem('vpl.ai') || '{}'));
ok(local.url === 'https://api.terg.hr/vp' && /^vp_/.test(local.key) && local.model === model,
  'localStorage now holds the door, the key and the model');

ok(await until(async () => (await gp.locator('#keys li').count()) >= 1), 'the key is in the guest\'s list');
ok((await gp.textContent('#keys')).includes('5 calls left'), 'with its allowance counted');

/* a slip is good once */
await gp.fill('#rd-code', codes[0]);
await gp.click('#rd-go');
ok(await until(async () => /already been used/i.test(await gp.textContent('#rd-msg'))),
  'taking the same code twice says "already been used"');

await gp.fill('#rd-code', 'vpc_000000000000000000000000');
await gp.click('#rd-go');
ok(await until(async () => /not one of ours/i.test(await gp.textContent('#rd-msg'))),
  'a made-up code is refused with a sentence, not a stack trace');

/* ── the owner sees the key they gave away ───────────────────────── */
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1600);
ok((await pg.textContent('#keys')).includes('given out'), 'the owner sees the key as "given out"');
ok((await pg.textContent('#codes')).includes('taken'), 'and the code as taken, with a date');

/* ── the door, without spending anything ─────────────────────────── */
async function door(headers, body) {
  const r = await fetch(API + '/vp', { method: 'POST', headers, body: JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json, headers: r.headers };
}
const CORS = { 'content-type': 'application/json', origin: B };

const noKey = await door(CORS, { model, messages: [{ role: 'user', content: 'hi' }] });
ok(noKey.status === 401 && /vp key/i.test(noKey.body?.error || ''), 'the door refuses a provider key (401)');

const fake = await door({ ...CORS, authorization: 'Bearer vp_00000000000000000000000000000000' },
  { model, messages: [{ role: 'user', content: 'hi' }] });
ok(fake.status === 403 && /not one of ours/i.test(fake.body?.error || ''), 'a key that is not ours is refused (403)');
ok(fake.headers.get('x-vpl-proxy') === 'vp', 'the answer is marked as the door\'s, so an app can tell');

const pre = await fetch(API + '/vp', {
  method: 'OPTIONS',
  headers: { origin: 'https://vn.terg.hr', 'access-control-request-method': 'POST' },
});
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://vn.terg.hr',
  'the door answers the app\'s preflight');

/* ── revoking stops it ───────────────────────────────────────────── */
await pg.click('#keys [data-kill="key"]');
/* a fixed wait is a guess about somebody else's machine: wait for the word */
const revoked = async (page) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if ((await page.textContent('#keys').catch(() => '')).includes('revoked')) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
ok(await revoked(pg), 'a revoked key reads "revoked"');
await gp.reload({ waitUntil: 'networkidle' });
await gp.waitForTimeout(1600);
ok((await gp.textContent('#keys')).includes('revoked'), 'the guest sees it too, on their next visit');

/* the guest tries a used code and a made-up one on purpose; both answer 400 */
const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of 400/.test(e));
ok(real.length === 0, 'no console or page errors' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));

await br.close();
console.log('\nvp: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
