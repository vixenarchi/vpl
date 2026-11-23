/* the key of record — stage 1 of vp.
 *
 * One key saved on the account, adopted by every app and browser that finds
 * itself without one, and invisible to anybody else. Needs two local servers
 * because adoption has to be shown across origins:
 *
 *   PORT=8104 OAUTH_PORT=0 ./serve vd
 *   PORT=8101 OAUTH_PORT=0 ./serve vr
 *
 *   node key-check.mjs
 *   VD_URL=... VR_URL=... node key-check.mjs
 */
import { chromium } from 'playwright';

const VD = process.env.VD_URL || 'http://127.0.0.1:8104';
const VR = process.env.VR_URL || 'http://127.0.0.1:8101';
const OWNER = { email: 'vpl-agent@terg.hr', pass: 'agent-vpl-2026!' };
const GUEST = { email: 'vpl-guest@terg.hr', pass: 'guest-vpl-2026!' };
const KEY = 'account-key-not-real-' + Math.random().toString(36).slice(2, 8);
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MODEL = 'gemini-3.1-flash-lite';

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

async function login(pg, base, who) {
  await pg.goto(base, { waitUntil: 'networkidle' });
  await pg.fill('#email', who.email);
  await pg.fill('#pass', who.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await pg.waitForTimeout(800);
}

/* talk to the database as whoever is signed in on this page — the only honest
 * way to test row level security from a test */
async function rest(pg, path, method = 'GET') {
  return pg.evaluate(async ({ path, method }) => {
    const cfg = window.__VPL_CONFIG__;
    const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token'));
    let tok = null;
    try { const s = JSON.parse(localStorage.getItem(k)); tok = s.access_token || s?.currentSession?.access_token; } catch {}
    const r = await fetch(cfg.url + '/rest/v1/' + path, {
      method,
      headers: { apikey: cfg.anon, authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, { path, method });
}

const localKey = (pg) => pg.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('vpl.ai') || '{}').key || ''; } catch { return ''; }
});

const accNote = (pg) => pg.locator('#ai-account .ai-acc-note').first().textContent();
const accMsg = (pg) => pg.locator('#ai-account .ai-acc-msg').first().textContent();

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

/* clean slate: no key in this browser, and none on the account */
await pg.goto(VD, { waitUntil: 'networkidle' });
await login(pg, VD, OWNER);
const wiped = await rest(pg, 'vpl_ai?user_id=not.is.null', 'DELETE');
ok(wiped.status < 300, 'the account starts with no key (' + wiped.status + ')');
await pg.evaluate(() => localStorage.removeItem('vpl.ai'));
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });

/* ── 1. signed in and empty: the dialog says so, plainly ─────────── */
await pg.click('#btn-ai');
await pg.waitForSelector('#ai-dialog[open]');
ok(/no key on your account yet/i.test(await accNote(pg)), 'with nothing saved it says "no key on your account yet"');
ok(await pg.locator('#ai-account [data-a="save"]').isVisible(), 'and offers "save to my account"');
ok(!(await pg.locator('#ai-account [data-a="forget"]').count()), 'nothing to remove yet');

/* ── 2. save to the account ──────────────────────────────────────── */
await pg.fill('#ai-url', URL_);
await pg.fill('#ai-model', MODEL);
await pg.fill('#ai-key', KEY);
await pg.click('#ai-account [data-a="save"]');
ok(await until(async () => /on your account, and in this browser/i.test(await accMsg(pg))),
  'saving says where the key went: the account and this browser');
ok((await localKey(pg)) === KEY, 'and this browser has it in localStorage');

const rows = await rest(pg, 'vpl_ai?select=api_key,model');
ok(rows.status === 200 && rows.body.length === 1 && rows.body[0].api_key === KEY,
  'the account has exactly one row, with the key');

/* ── 3. a fresh browser on the same address adopts it ────────────── */
await pg.evaluate(() => localStorage.removeItem('vpl.ai'));
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });
ok((await localKey(pg)) === '', 'localStorage starts empty again (a new browser)');
await pg.click('#btn-ai');
await pg.waitForSelector('#ai-dialog[open]');
ok(await until(async () => (await pg.inputValue('#ai-key')) === KEY),
  'opening settings adopts the account key by itself');
ok(/on your account since/i.test(await accNote(pg)), 'and says since when');
ok((await localKey(pg)) === KEY, 'the adopted key is in this browser now');
await pg.click('#ai-x');

/* ── 4. another app, another origin, same account ───────────────── */
const pgVr = await ctx.newPage();
pgVr.on('pageerror', (e) => errors.push('vr pageerror: ' + e.message));
pgVr.on('console', (m) => { if (m.type() === 'error') errors.push('vr console: ' + m.text()); });
await login(pgVr, VR, OWNER);
ok((await pgVr.evaluate(() => localStorage.getItem('vpl.ai'))) === null ||
   (await localKey(pgVr)) === '', 'vr, a different origin, has no key yet');
await pgVr.click('#btn-ai');
await pgVr.waitForSelector('#ai-dialog[open]');
ok(await until(async () => (await pgVr.inputValue('#ai-key')) === KEY),
  'vr adopts the same account key without a paste');
ok((await localKey(pgVr)) === KEY, 'and keeps it for its own origin');
await pgVr.close();

/* ── 5. nobody else can read it ──────────────────────────────────── */
const ctxGuest = await br.newContext({ viewport: { width: 1200, height: 900 } });
const pgGuest = await ctxGuest.newPage();
await login(pgGuest, VD, GUEST);
const seen = await rest(pgGuest, 'vpl_ai?select=api_key');
ok(seen.status === 200 && Array.isArray(seen.body) && seen.body.length === 0,
  'a signed-in guest sees no rows at all (' + seen.status + ', ' + JSON.stringify(seen.body) + ')');
await ctxGuest.close();

/* ── 6. remove from the account, keep the browser working ────────── */
await pg.click('#btn-ai');
await pg.waitForSelector('#ai-dialog[open]');
await pg.click('#ai-account [data-a="forget"]');
ok(await until(async () => /gone from your account/i.test(await accMsg(pg))),
  'removing says the account is clear');
const after = await rest(pg, 'vpl_ai?select=api_key');
ok(after.status === 200 && after.body.length === 0, 'the row is gone from the database');
ok((await localKey(pg)) === KEY, 'this browser keeps its key, as the sentence said');
ok(/no key on your account yet/i.test(await accNote(pg)), 'and the dialog is back to "no key on your account yet"');

/* ── 7. forgetting locally clears only this browser ──────────────── */
await pg.click('#ai-forget');
ok(await until(async () => (await localKey(pg)) === ''), 'forget the key clears this browser');
await pg.click('#ai-x');

/* ── 8. the anon key alone opens nothing ───────────────────────── */
const anon = await pg.evaluate(async () => {
  const cfg = window.__VPL_CONFIG__;
  const r = await fetch(cfg.url + '/rest/v1/vpl_ai?select=api_key', {
    headers: { apikey: cfg.anon },
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
});
ok(anon.status === 401 || (anon.status === 200 && Array.isArray(anon.body) && anon.body.length === 0),
  'without a session the table is shut, not just empty (' + anon.status + ')');

/* the one 401 below is the test's own probe of the anon door */
const real = errors.filter((e) => !/status of 401|Failed to load resource: the server responded with a status of 401/.test(e));
ok(real.length === 0, 'no console or page errors' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));

await br.close();
console.log('\nkey: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
