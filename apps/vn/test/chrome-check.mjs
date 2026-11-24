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
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.APP_URL || 'http://127.0.0.1:8107';
const NAME = process.env.APP_NAME || 'this app';

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

/* ── one bar, one order, in all eight ───────────────────────────────
 * The bar is the one thing a hand learns once and expects everywhere: the list,
 * the boxed letters of the app, its name, the one thing you add — then air,
 * who you are, the gear and out. vp has no list and nothing to add, so its bar
 * is the same order with those two absent.
 *
 * The theme left the bar on purpose: it lives inside settings now, one press,
 * next to the word. A bar that grows a fourth button is a bar that stops
 * matching the other seven. */
const order = await pg.evaluate(() => {
  const bar = document.querySelector('header.bar');
  if (!bar) return null;
  return [...bar.children]
    .filter((c) => c.offsetParent !== null && !c.hidden)
    .map((c) => (c.id ? '#' + c.id : c.classList[0]));
});
const wanted = NAME === 'vp'
  ? ['brand', 'grow', '#who', '#btn-ai', '#btn-out']
  : ['#btn-projects', 'brand', '#btn-new', 'grow', '#who', '#btn-ai', '#btn-out'];
ok(JSON.stringify(order) === JSON.stringify(wanted),
  'the bar is in the suite\'s order', JSON.stringify(order));
const boxed = (await pg.textContent('.bar .brand-mark') || '').trim().toLowerCase();
ok(boxed === NAME, 'the box says which app this is (' + boxed + ')');
ok(await pg.locator('.bar #btn-theme').count() === 0, 'the theme is not a fourth button in the bar');

/* ── one gear, one dialog ───────────────────────────────────────── */
ok(await pg.locator('#btn-ai').isVisible(), 'there is a settings gear');
await pg.click('#btn-ai');
ok(await until(async () => pg.locator('#ai-dialog[open]').isVisible()), 'it opens the shared settings');
ok((await pg.locator('#ai-dialog [role=tab]').allTextContents()).join(',') === 'model,search,key,theme',
  'and it is the same four tabs');
const mode = await pg.locator('#ai-dialog [data-a=mode]').count();
ok(mode === 1, 'and one press next to the word switches dark or normal');

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

/* the dock never writes into the document on its own: where an app offers
 * *use it*, it is a button, and only a press makes it happen */
const useIt = await pg.locator('#dock [data-use]').count();
if (NAME === 'vn' || NAME === 'vi') {
  ok(useIt === 1, 'the app offers *use it* as a button, not as a habit');
  if (NAME === 'vn') {
    await pg.click('#btn-new');
    await pg.waitForTimeout(1000);
    /* a new note opens in whichever mode was last used; write is where words go */
    await pg.click('#app [data-mode=write]');
    await pg.waitForTimeout(400);
    const read = () => pg.evaluate(() => document.querySelector('#editable').textContent.replace(/\s+/g, ' ').trim());
    const before = await read();
    await pg.click('#dock [data-use]');
    ok(await until(async () => (await read()).includes('this is the answer about the screen'), 6000),
      'pressing it puts the words in the note');
    const after = await read();
    ok(after.length > before.length + 10, 'and the note grew (' + before.length + ' → ' + after.length + ')');
    await pg.waitForTimeout(1000);   // let the autosave land before the next check
  } else {
    /* with no project open it must say so, not pretend */
    const cards = await pg.locator('#notes li').count();
    await pg.click('#dock [data-use]');
    await pg.waitForTimeout(900);
    if (cards === 0) {
      const why = (await pg.textContent('#dock .dock-msg')).trim();
      ok(/project/i.test(why), 'with no wall open it explains instead of pretending: “' + why + '”');
    } else {
      const grown = await pg.locator('#notes li').count();
      ok(grown === cards + 1, 'pressing it pins one more idea (' + cards + ' → ' + grown + ')');
    }
  }
} else {
  ok(useIt === 0, 'nothing in the dock lands anywhere without a person pressing a button');
}

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
/* it is in the app's column, not an overlay, so nothing can hide behind it */
const flow = await pg.evaluate(() => {
  const d = document.querySelector('#dock');
  const cs = getComputedStyle(d);
  return { pos: cs.position, parent: d.parentElement.id || d.parentElement.tagName };
});
ok(flow.pos !== 'fixed' || flow.parent === 'body', 'the dock takes its own strip (' + flow.pos + ' in ' + flow.parent + ')');

ok(errors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, 'no unexpected errors');
if (errors.length) console.log('   (' + errors.length + ' expected noise)');

await br.close();
console.log(`\nchrome (${NAME}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
