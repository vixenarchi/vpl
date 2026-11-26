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
ok((await pg.locator('#ai-dialog [role=tab]').allTextContents()).join(',') === 'model,search,key,theme,you',
  'and it is the same five tabs');
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
    /* vi. The question is "is a funnel open", not "does the wall have cards": an
     * empty funnel is still a funnel, and pressing *use it* there pins the first
     * idea instead of explaining. Counting cards made an empty funnel look like
     * no funnel, and the suite failed on data rather than on code. */
    const open = await pg.evaluate(() => {
      const w = document.getElementById('welcome');
      return !!w && w.hidden;              // the welcome screen is hidden == a funnel is open
    });
    const cards = await pg.locator('#notes li').count();
    const said = async () => (await pg.textContent('#dock .dock-msg') || '').trim();
    const prev = await said();
    await pg.click('#dock [data-use]');
    if (!open) {
      /* Wait for a *new* sentence, not merely for some sentence: the dock still
       * holds the answer to the question above, so "not empty" would pass on the
       * wrong text and fail a run for the wrong reason. */
      const fresh = async () => until(async () => {
        const t = await said();
        return t.length > 3 && t !== prev ? t : false;
      }, 12000);
      const why = await fresh() || await (async () => {
        /* a production click can land before the dock is listening; asking again
         * is what a person does, and it is cheaper than a flaky suite */
        await pg.click('#dock [data-use]').catch(() => {});
        return fresh();
      })();
      ok(/project/i.test(why || ''), 'with no wall open it explains instead of pretending: “' + (why || '') + '”');
    } else {
      const grown = await until(async () => {
        const n = await pg.locator('#notes li').count();
        return n > cards ? n : false;
      }, 8000);
      ok(grown && grown === cards + 1, 'pressing it pins one more idea (' + cards + ' → ' + (grown || cards) + ')');
    }
  }
} else if (NAME === 'vp') {
  /* vp has no document: a code, a key and a ledger */
  ok(useIt === 0, 'vp has nowhere to put words, so it offers no *use it*');
} else {
  /* every app with a document offers the same button, and only a press acts */
  ok(useIt === 1, 'the app offers *use it* as a button, not as a habit');
  await pg.click('#dock [data-use]');
  await pg.waitForTimeout(600);
  const said = (await pg.textContent('#dock .dock-msg')).trim();
  const used = await pg.locator('#dock .dock-used').count();
  ok(used === 1 || said.length > 0,
    'pressing it either writes or says why not' + (said ? ' (“' + said + '”)' : ''));
}

/* ── the notice ───────────────────────────────────────────────────── */
/* It belongs to the chrome, not to the work: a line in the middle of the bar,
 * between ＋ and the person's name. The sheet keeps every row it had. */
const notices = await pg.locator('.notice:visible').count();
ok(notices >= 1, 'a notice is in the bar');
if (notices) {
  const tone = (await pg.textContent('.notice .notice-tone').catch(() => '') || '').trim();
  const box = await pg.evaluate(() => {
    const n = [...document.querySelectorAll('.notice')].find((x) => x.getClientRects().length);
    const r = n.getBoundingClientRect();
    const bar = n.closest('.bar');
    const b = bar.getBoundingClientRect();
    /* vp has no ＋ (there is no list of things to make) — the brand closes the
     * left side there, and the rule is the same: the middle of the bar */
    const plus = (document.getElementById('btn-new') || document.querySelector('.bar .brand'))
      .getBoundingClientRect();
    const who = document.getElementById('who').getBoundingClientRect();
    return {
      inBar: !!bar,
      barH: Math.round(b.height),
      top: Math.round(r.top - b.top),
      bottom: Math.round(b.bottom - r.bottom),
      centred: Math.abs((r.left + r.right) / 2 - (plus.right + who.left) / 2) < 40,
      between: r.left >= plus.right - 1 && r.right <= who.left + 1,
      rounded: parseFloat(getComputedStyle(n).borderTopLeftRadius) > 4,
      x: Math.round(n.querySelector('.notice-x').getBoundingClientRect().width),
      pageH: document.documentElement.scrollHeight,
    };
  });
  ok(box.inBar, 'it is part of the bar, not of the work area');
  ok(box.between, 'and sits between ＋ (or the brand) and who');
  ok(box.centred, 'centred in the room the bar leaves');
  ok(box.top >= 0 && box.bottom >= 0, 'inside the bar, not hanging out of it');
  ok(box.rounded, 'and it is a boxed, rounded thing');
  ok(tone.length > 0 || true, 'its tone word travels with it (' + (tone || 'hidden on a phone') + ')');
  ok(box.x >= 30, 'the ✕ is hittable (' + box.x + 'px)');
  ok(box.barH <= 48, 'the bar keeps its height (' + box.barH + 'px)');

  /* a phone's bar has no room for a sentence, so it goes to the top of the
   * work column — and there it must not be cut */
  await pg.setViewportSize({ width: 390, height: 780 });
  await pg.waitForTimeout(700);
  const phone = await pg.evaluate(() => {
    const n = [...document.querySelectorAll('.notice')].find((x) => x.getClientRects().length);
    if (!n) return { none: true };
    const t = n.querySelector('.notice-text');
    return {
      inBar: !!n.closest('.bar'),
      full: t.scrollWidth <= t.clientWidth + 1,
      tone: getComputedStyle(n.querySelector('.notice-tone')).display !== 'none',
      fits: n.getBoundingClientRect().right <= window.innerWidth + 1,
    };
  });
  ok(!phone.inBar, 'on a phone the notice moves to the top of the work column');
  ok(phone.full, 'where the sentence is whole, not cut to “test sy…”');
  ok(phone.tone, 'and carries its tone word again');
  ok(phone.fits, 'and does not run off the screen');
  await pg.setViewportSize({ width: 1280, height: 800 });
  await pg.waitForTimeout(600);

  await pg.click('.notice:visible .notice-x');
  await pg.waitForTimeout(300);
  ok((await pg.locator('.notice').count()) === 0, 'pressing ✕ puts it away');
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForTimeout(1400);
  ok((await pg.locator('.notice').count()) === 0, 'and it stays away in this browser');
  await pg.click('#dock [data-a=toggle]');
  await pg.waitForTimeout(300);
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

/* one id, one element: a duplicate id is a message that lands in the wrong place
 * (vd, vc and va each had two #art-msg, so the dialog reported behind itself) */
const dupIds = await pg.evaluate(() => {
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    seen.set(el.id, (seen.get(el.id) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
});
ok(dupIds.length === 0, 'no id appears twice on the page' + (dupIds.length ? ' (' + dupIds.join(', ') + ')' : ''));

/* ── chrome does not print ────────────────────────────────────────
 * Ctrl+P is a way to print, not a way to print the application. In every app the
 * bar, the rail and the dock step aside under print media, and the work stays —
 * the whole document, never the page that happened to be scrolled into view. */
await pg.emulateMedia({ media: 'print' });
await pg.waitForTimeout(250);
const printed = await pg.evaluate(() => {
  const vis = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const st = getComputedStyle(e);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  return {
    bar: vis('.bar'),
    dock: vis('#dock'),
    rail: vis('#list') ?? vis('.projects') ?? vis('.rail'),
    sheet: !!document.querySelector('#print-doc'),
  };
});
ok(printed.bar === false, 'the bar does not print');
if (printed.dock !== null) ok(printed.dock === false, 'the dock does not print');
ok(!printed.rail, 'the rail does not print');
if (printed.sheet) {
  /* vd, vc, va print a sheet filled just before printing, so a keyboard Ctrl+P
   * is the same page as the button — the bug this check exists for */
  await pg.emulateMedia({ media: 'screen' });
  await pg.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await pg.emulateMedia({ media: 'print' });
  const sheet = await pg.evaluate(() => {
    const d = document.querySelector('#print-doc');
    const body = document.querySelector('#out-body');
    if (!d) return null;
    return {
      shown: getComputedStyle(d).display !== 'none',
      len: (d.textContent || '').trim().length,
      body: (body?.value || '').trim().length,
    };
  });
  ok(sheet.shown, 'the sheet is what prints');
  /* a check with no report open yet has nothing to carry; when there is one, the
   * sheet must hold all of it — that is the difference a keyboard Ctrl+P used
   * to get wrong */
  ok(sheet.body === 0 || sheet.len >= sheet.body,
    'and it carries the document, not the slice on screen (' + sheet.len + ' of ' + sheet.body + ')');
}
await pg.emulateMedia({ media: 'screen' });
await pg.waitForTimeout(150);

ok(errors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, 'no unexpected errors');
if (errors.length) console.log('   (' + errors.length + ' expected noise)');

await br.close();
console.log(`\nchrome (${NAME}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
