/* A key kept on the account arrives with the person.
 *
 * The suite's promise (docs/configure.md): save the model key once, on your
 * account, and every browser and every address of the suite has it — "if the
 * suite is to be demonstrable without a visitor pasting their own".
 *
 * It was broken in three apps and nobody noticed, because the dialog still drew
 * itself: vn, vz and vp never handed `ai.js` the session's token, so
 * `accountAi()` answered "nothing" to a person whose account had a key, the three
 * account buttons never appeared, and a new browser said "no model key yet". vn
 * also adopted only when the settings were opened, so the dock said it first.
 *
 * This asks the question the aspirational sentence asks: sign in on a browser
 * with nothing in it, and is the key there — before anything is opened?
 *
 * It uses the **guest** account, not the owner: the owner's row holds the real
 * key that makes the suite demonstrable, and a test must not overwrite it. The
 * guest gets a fake key, which is enough to prove that the row travels; no model
 * is called.
 *
 *   node account-key-check.mjs                 # all eight
 *   APP=vn PORT=8102 node account-key-check.mjs
 *   VPL_PROD=1 node account-key-check.mjs      # the deployments
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GUEST } from './_account.mjs';

const APPS = [
  { id: 'vn', port: 8102, prod: 'https://vn.terg.hr' },
  { id: 'vi', port: 8100, prod: 'https://vpl-vi.pages.dev' },
  { id: 'vr', port: 8101, prod: 'https://vpl-vr.pages.dev' },
  { id: 'vz', port: 8103, prod: 'https://vpl-vz.pages.dev' },
  { id: 'vd', port: 8104, prod: 'https://vpl-vd.pages.dev' },
  { id: 'vc', port: 8105, prod: 'https://vpl-vc.pages.dev' },
  { id: 'vp', port: 8106, prod: 'https://vpl-vp.pages.dev' },
  { id: 'va', port: 8107, prod: 'https://vpl-va.pages.dev' },
];

const EMAIL = GUEST.email;
const PASS = GUEST.pass;
if (!EMAIL || !PASS) {
  console.log('set VPL_GUEST_EMAIL and VPL_GUEST_PASS — the guest account carries the test key');
  process.exit(78);            // not configured: skipped, never green
}

/* the same url and anon key every app finds, without a browser */
function config() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON) {
    return { url: process.env.VPL_SUPABASE_URL, anon: process.env.VPL_SUPABASE_ANON };
  }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const s = readFileSync(path.join(dir, '../../vn/config.local.js'), 'utf8');
  return { url: s.match(/url:\s*'([^']+)'/)[1], anon: s.match(/anon:\s*'([^']+)'/)[1] };
}

const FAKE = 'test-key-that-is-not-a-key';
const { url, anon } = config();
let pass = 0;
let fail = 0;
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; return true; }
  fail++; console.log(`  FAIL ${what}${extra ? ' — ' + extra : ''}`);
  return false;
};

/* ── the guest signs in over REST, and gets a key on the account ────── */
const auth = async () => {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) {
    console.log(`no session for ${EMAIL}`);
    console.log('  set VPL_GUEST_EMAIL / VPL_GUEST_PASS to an account of this project');
    process.exit(78);          // not configured
  }
  return { token: j.access_token, id: j.user.id };
};

const rest = async (tok, pathname, init = {}) => {
  const r = await fetch(`${url}/rest/v1${pathname}`, {
    ...init,
    headers: { apikey: anon, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, json };
};

const { token: tok, id } = await auth();
const MINE = `/vpl_ai?user_id=eq.${id}`;

/* leave whatever was there behind, so a failure cannot poison the next run */
const before = (await rest(tok, MINE)).json || [];
const put = async () => rest(tok, '/vpl_ai?on_conflict=user_id', {
  method: 'POST',
  headers: { apikey: anon, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation,resolution=merge-duplicates' },
  body: JSON.stringify({
    user_id: id,
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'a-test-model',
    api_key: FAKE,
  }),
});
await rest(tok, MINE, { method: 'DELETE' });
const written = await put();
if (written.status >= 300) {
  console.log(`cannot write a key on the guest's account: ${written.status} ${JSON.stringify(written.json)}`);
  process.exit(78);
}

const one = process.env.APP;
const list = one
  ? [{ id: one, url: process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 8102}` }]
  : APPS.map((a) => ({ id: a.id, url: process.env.VPL_PROD ? a.prod : `http://127.0.0.1:${a.port}` }));

const br = await chromium.launch();
console.log('');

for (const app of list) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.accept());
  await pg.goto(`${app.url}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);

  const gate = pg.locator('#email');
  if (await gate.isVisible().catch(() => false)) {
    await gate.fill(EMAIL);
    await pg.fill('#pass', PASS);
    await pg.click('#btn-login');
    await untilVisible(pg, '#app:not([hidden])', 20000);
    await pg.waitForTimeout(2600);
  }

  /* 1. the key is in the browser before any settings dialog is opened */
  const store = await pg.evaluate(async () => {
    const mod = await import('/vendor/ai.js');
    const now = mod.readAi();
    return { key: now.key, model: now.model };
  });
  ok(store.key === FAKE, `${app.id}: the account's key is already here after signing in`,
    store.key ? 'a different key' : 'none — nothing adopted it');
  ok(store.model === 'a-test-model', `${app.id}: and so is the model that goes with it`, String(store.model));

  /* 2. the settings dialog offers the account's key, rather than pretending
   * there is none (the bug that hid this for months) */
  await pg.click('#btn-ai');
  await untilVisible(pg, '#ai-dialog[open]', 8000);
  await pg.click('#ai-dialog [data-tab=model]').catch(() => {});
  /* The dialog paints the account line after asking the database, and the first
   * paint can be the "not signed in" sentence while that answer is still on its
   * way. Wait for the sentence that is actually about the account, and fail if
   * it never arrives — that is the bug this test exists for. */
  let seen = '';
  const line = await untilTruthy(async () => {
    const t = ((await pg.textContent('#ai-dialog #set-acc-line').catch(() => '')) || '').trim();
    if (t) seen = t;
    return /account/i.test(t) && !/sign in and one key/i.test(t) ? t : false;
  }, 10000);
  ok(!!line && /account/i.test(String(line)), `${app.id}: the dialog says what is on the account`, String(line || seen || '(nothing)'));
  const buttons = await pg.locator('#ai-dialog [data-acc=use], #ai-dialog [data-acc=remove]').count();
  ok(buttons >= 2, `${app.id}: and offers to use it, and to remove it`, `${buttons} of 2`);
  await pg.click('#ai-dialog [data-a=close]').catch(() => {});

  ok(errs.length === 0, `${app.id}: no page errors`, errs.slice(0, 2).join(' · '));
  console.log(`  ${app.id.padEnd(3)} adopted · ${buttons} account button(s)`);
  await ctx.close();
}

await br.close();

/* ── put the guest's account back the way it was ────────────────────── */
await rest(tok, `/vpl_ai?user_id=eq.${id}`, { method: 'DELETE' });
for (const row of before) {
  await rest(tok, '/vpl_ai?on_conflict=user_id', {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
}

console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

async function untilVisible(pg, sel, ms) {
  const t0 = Date.now();
  for (;;) {
    if (await pg.locator(sel).count().catch(() => 0)) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function untilTruthy(fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => false);
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}
