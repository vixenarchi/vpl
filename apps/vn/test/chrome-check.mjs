/* The chrome every app shares: who is signed in, one settings gear, and a dock
 * at the bottom that can answer about what is on screen.
 *
 *   node chrome-check.mjs                        # http://127.0.0.1:8107 (va)
 *   APP_URL=http://127.0.0.1:8102 APP_NAME=vn node chrome-check.mjs
 *   ./tools/test-chrome.sh                       # all eight
 *
 * The model answer is mocked, so this costs nothing and asserts the shape.
 */
import { chromium } from 'playwright';

const B = process.env.APP_URL || 'http://127.0.0.1:8107';
const NAME = process.env.APP_NAME || 'this app';
const OWNER = { email: 'vpl-agent@terg.hr', pass: 'agent-vpl-2026!' };

let pass = 0; let fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } };
const until = async (fn, ms = 10000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 120));
  }
};

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

let asked = null;
for (const pattern of ['**/api/chat', 'https://api.terg.hr/chat']) {
  await pg.route(pattern, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    try { asked = JSON.parse(req.postData() || '{}'); } catch { asked = null; }
    return route.fulfill({
      status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: 'this is the answer about the screen' } }] }),
    });
  });
}

/* A key in this browser, so the dock has something to call. The door itself is
 * mocked below, so nothing leaves the machine and nothing is spent. */
await ctx.addInitScript(() => {
  localStorage.setItem('vpl.ai', JSON.stringify({
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: 'test-key-not-real',
    model: 'gemini-3.1-flash-lite',
  }));
});

await pg.goto(B, { waitUntil: 'networkidle' });

/* ── the gate: one sentence, one card ───────────────────────────── */
const fine = await pg.textContent('.gate-fine, .gate-foot').catch(() => '');
ok(fine.trim() === 'one account for the whole suite', 'the gate says one account for the whole suite');
const frame = await pg.evaluate(() => {
  const f = document.querySelector('.gate-form, .gate-box');
  const cs = getComputedStyle(f);
  return { border: parseFloat(cs.borderTopWidth) || 0, bg: cs.backgroundColor };
});
ok(frame.border >= 1, 'the sign-in has a frame (' + frame.border + 'px)');

await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(900);

/* ── who ─────────────────────────────────────────────────────────── */
const who = (await pg.textContent('#who')).trim();
ok(who.length > 2, 'the bar names the person: “' + who + '”');
ok(!who.includes('@'), 'and it is a name, not an address');
ok(/^[A-Z]/.test(who), 'starting with a capital');

/* ── one gear, one dialog ───────────────────────────────────────── */
ok(await pg.locator('#btn-ai').isVisible(), 'there is a settings gear');
await pg.click('#btn-ai');
ok(await until(async () => pg.locator('#ai-dialog[open]').isVisible()), 'it opens the shared settings');
ok((await pg.locator('#ai-dialog [role=tab]').allTextContents()).join(',') === 'model,search,key,theme',
  'and it is the same four tabs');

/* the bug: a theme change used to swallow save and close */
await pg.click('#ai-dialog [data-tab=theme]');
await pg.click('#ai-dialog .set-theme[data-theme=ink], #ai-dialog .set-theme[data-theme=dark]');
await pg.waitForTimeout(200);
await pg.click('#ai-dialog [data-a=close]');
ok(await until(async () => !(await pg.locator('#ai-dialog[open]').count())), 'changing the theme still lets the dialog close');
await pg.click('#btn-ai');
await until(async () => pg.locator('#ai-dialog[open]').isVisible());
await pg.click('#ai-dialog [data-tab=theme]');
await pg.click('#ai-dialog .set-theme[data-theme=vi]');
await pg.click('#ai-dialog [data-a=save]');
ok(await until(async () => (await pg.textContent('#ai-dialog .set-msg')).length > 0), 'and save still answers');
ok(!(await pg.evaluate(() => document.documentElement.dataset.theme === 'vi')) === false, 'the theme did apply');
await pg.click('#ai-dialog [data-a=close]');
await until(async () => !(await pg.locator('#ai-dialog[open]').count()));

/* ── the dock ───────────────────────────────────────────────────── */
const dock = pg.locator('#dock');
ok(await dock.isVisible(), 'the dock is on the screen');
const place = await pg.evaluate(() => {
  const d = document.querySelector('#dock').getBoundingClientRect();
  return { bottom: Math.round(window.innerHeight - d.bottom), width: Math.round(d.width), vw: window.innerWidth };
});
ok(place.bottom <= 2, 'it sits on the bottom edge (' + place.bottom + 'px gap)');
ok(place.width >= place.vw - 4, 'and spans the whole width');

await pg.fill('#dock .dock-input', 'what is this?');
await pg.click('#dock .dock-go');
const answered = await until(async () => (await pg.locator('#dock .dock-row.it .dock-text').count()) === 1);
ok(answered, 'asking gives an answer in the dock');
const said = answered ? (await pg.textContent('#dock .dock-row.it .dock-text')) : '';
ok(said.includes('answer about the screen'), 'the answer is the model\'s');
if (!answered) console.log('   dock said: ' + (await pg.textContent('#dock .dock-msg')));
ok(!!asked && asked.messages?.some((m) => m.role === 'system'), 'the request carried a system brief');
ok(!!asked && asked.messages?.[1]?.content.includes('what is this?'), 'and the question');
const brief = asked?.messages?.[1]?.content || '';
ok(brief.split('Question:')[0].length > 60, 'and what is on screen travels with it (' + brief.split('Question:')[0].length + ' chars)');

/* the dock never writes into the document on its own */
const useIt = await pg.locator('#dock [data-use]').count();
ok(useIt === 0, 'nothing in the dock lands anywhere without a person pressing a button');

await pg.click('#dock [data-a=hide]');
ok(await until(async () => !(await pg.locator('#dock .dock-log').isVisible())), 'the transcript puts itself away');

/* ── the page still fits ────────────────────────────────────────── */
const fit = await pg.evaluate(() => {
  const d = document.querySelector('#dock').getBoundingClientRect();
  const nearBottom = [...document.querySelectorAll('#dock ~ *, #dock')].length; // eslint-disable-line
  const rows = d.top;
  return {
    wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dockTop: Math.round(rows), vh: window.innerHeight, nearBottom,
  };
});
ok(fit.wide === 0, 'no sideways scroll (' + fit.wide + 'px)');
/* the dock sits in the app's column, so nothing is hidden behind it */
const overlap = await pg.evaluate(() => {
  const dock = document.querySelector('#dock').getBoundingClientRect();
  const hit = [...document.querySelectorAll('#app *')]
    .filter((n) => {
      const r = n.getBoundingClientRect();
      return r.height > 8 && r.bottom > dock.top + 2 && r.top < dock.top && r.width > 40;
    })
    .map((n) => n.className || n.tagName);
  return hit.slice(0, 3);
});
ok(overlap.length === 0, 'and it does not cover anything (' + overlap.join(', ') + ')');

ok(errors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, 'no unexpected errors');
if (errors.length) console.log('   (' + errors.length + ' expected noise)');

await br.close();
console.log(`\nchrome (${NAME}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
