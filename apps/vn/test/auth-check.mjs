/* Who is signed in, and whether that is still true.
 *
 *   node auth-check.mjs                          # http://127.0.0.1:8107
 *   APP_URL=https://va.terg.hr node auth-check.mjs
 *
 * The bugs this is for: two tabs sharing one session, a logout that leaves a
 * token behind, and a stored token that is not a token at all. All three are
 * invisible until somebody signs in twice.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.APP_URL || 'http://127.0.0.1:8107';
const NAME = process.env.APP_NAME || 'this app';
const STAMP = Math.random().toString(36).slice(2, 6);

let pass = 0; let fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } };
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 120));
  }
};
async function login(pg, who) {
  await pg.fill('#email', who.email);
  await pg.fill('#pass', who.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(900);
}

const br = await chromium.launch();
/* one context = one origin = one localStorage, which is exactly the situation */
const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const a = await ctx.newPage();
const b = await ctx.newPage();
const errors = [];
for (const [n, p] of [['a', a], ['b', b]]) {
  p.on('pageerror', (e) => errors.push(n + ' pageerror: ' + e.message));
  p.on('dialog', (d) => d.accept());
}

/* ── tab a: the owner, with a job open ──────────────────────────── */
await a.goto(B, { waitUntil: 'networkidle' });
await login(a, OWNER);
ok((await a.textContent('#who')).includes('vpl-agent') || (await a.textContent('#who')).trim().length > 0, 'signed in as the owner');
const ownerWho = (await a.textContent('#who')).trim();

/* a token that is really a token: three parts, and the person behind it is us */
const tok = await a.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => /-auth-token$/.test(x));
  const raw = k ? localStorage.getItem(k) : null;
  try { return JSON.parse(raw).access_token || null; } catch { return null; }
});
ok(!!tok && tok.split('.').length === 3, 'the stored session is a real jwt, not a fragment');
const sub = tok ? JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).sub : null;
ok(!!sub && sub.length === 36, 'and it names a person');

/* ── tab b: a different person, same storage ────────────────────── */
await b.goto(B + '/?tab=b', { waitUntil: 'networkidle' });
await b.waitForTimeout(600);
if (await b.locator('#app[hidden]').count()) await login(b, GUEST);
else {
  /* tab b opened already signed in as the owner: sign out, then in as the guest */
  await b.click('#btn-out');
  await b.waitForSelector('#gate:not([hidden])');
  await login(b, GUEST);
}
ok((await b.textContent('#who')).trim() !== ownerWho, 'the second tab is somebody else');

/* tab a notices the moment it is looked at again */
await a.bringToFront();
await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const flipped = await until(async () => {
  await a.waitForLoadState('domcontentloaded').catch(() => {});
  return (await a.textContent('#who')).trim() !== ownerWho;
});
ok(flipped, 'the first tab stops showing the first person');
if (!flipped) {
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForTimeout(900);
}
/* the label is the same one every app shows (vendor/who.js): a name when there
 * is one, else the address tidied — vpl-guest@terg.hr reads as "Vpl Guest". */
ok(/vpl\W*guest/i.test((await a.textContent('#who')).trim()), 'and shows the person who is actually signed in');

/* nothing of the owner's job is on screen under the guest's name */
const title = await a.inputValue('#proj-title').catch(() => '');
ok(!title.includes('owner-only'), 'the guest is not looking at the owner\'s job');

/* ── signing out leaves nothing behind ─────────────────────────── */
await b.bringToFront();
await b.click('#btn-out');
ok(await until(async () => b.locator('#gate:not([hidden])').isVisible()), 'the second tab lands on the gate');

const left = await b.evaluate(() => Object.keys(localStorage).filter((k) => /-auth-token/.test(k))
  .map((k) => [k, (localStorage.getItem(k) || '').length]));
ok(left.length === 0 || left.every(([, len]) => len === 0), 'and no session is left in storage (' + JSON.stringify(left) + ')');

await a.bringToFront();
await a.reload({ waitUntil: 'networkidle' });
await a.waitForTimeout(1000);
ok(await a.locator('#gate:not([hidden])').isVisible(), 'a reload in the other tab does not sign anybody back in');

ok(errors.length === 0, 'no page errors');
if (errors.length) console.log(errors.slice(0, 3).join('\n'));

await br.close();
console.log(`\nauth (${NAME}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
