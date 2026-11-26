/* The recycle bin, in every app that can lose a row.
 *
 * One suite, seven apps, one promise: pressing ✕ never destroys words. The row
 * goes to a place with a name, a number and a filled button, it can come back,
 * and only "for good" is final.
 *
 *   APP=vr PORT=8101 VPL_EMAIL=… VPL_PASS=… node bin-check.mjs
 */
import { chromium } from 'playwright';

const APP = process.env.APP || 'vi';
const PORT = process.env.PORT || 8100;
const BASE = `http://127.0.0.1:${PORT}/`;
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;

if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to a test account');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 120));
  }
};

/* What each app calls things. The row a person deletes, the list it lives in,
 * the button that opens the bin, and how a row is put back. */
const MAP = {
  vi: {
    row: '#notes li', live: '#notes li', binRow: '.bin-mode li',
    btn: '#btn-bin', banner: '#bin-banner-note', count: '#bin-count',
    del: '.kill', restore: '.row-restore', purge: '.kill',
    make: async (pg, text) => {
      if (await pg.locator('#btn-first').isVisible()) await pg.click('#btn-first');
      else await pg.click('#btn-new').catch(() => {});
      await pg.waitForTimeout(1200);
      await pg.fill('#note-input', text);
      await pg.click('#note-form button[type=submit]');
      await pg.waitForTimeout(900);
    },
    mode: 'notes',
  },
  vr: {
    row: '#rows tr', live: '#rows tr', binRow: '#rows tr.in-bin',
    btn: '#btn-bin', banner: '#bin-banner-note', count: '#bin-count',
    del: 'button[data-del]', restore: 'button[data-back]', purge: 'button[data-purge]',
    make: async (pg, text) => {
      await pg.click('#btn-new').catch(() => {});
      await pg.waitForTimeout(1400);
      await pg.fill('#req-add', text);
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(1000);
    },
    mode: 'sheet',
  },
  vz: {
    row: '#pairs li', live: '#pairs li', binRow: '#bin-list li',
    btn: '#btn-bin', banner: '#bin-banner-note', count: '#bin-count',
    del: '[data-bin]', restore: '[data-restore]', purge: '[data-purge]',
    make: async (pg, text) => {
      await pg.click('#btn-new').catch(() => {});
      await pg.waitForTimeout(1200);
      const add = pg.locator('#add-key, #key-add, input[placeholder^="key"]').first();
      await add.fill(text.split('=')[0]);
      const val = pg.locator('#add-val, #val-add, input[placeholder^="value"]').first();
      if (await val.count()) await val.fill(text.split('=')[1] || '');
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(1000);
    },
    mode: 'view',
  },
  vd: {
    row: '#artifacts li', live: '#artifacts li', binRow: '.bin-mode li',
    btn: '#btn-bin', banner: '#bin-banner-note', count: '#bin-count',
    del: '.del', restore: '.row-restore', purge: '.del',
    make: async (pg, text) => {
      const job = await pg.evaluate(async (t) => {
        const db = await import('/lib/db.js');
        const j = await db.createProject(t + ' job', 'offer');
        await db.addArtifact(j.id, { kind: 'note', title: t, text: 'jedan dva tri' });
        return j.id;
      }, text);
      await pg.evaluate((id) => localStorage.setItem('vpl.binjob', id), job);
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1500);
      await pg.getByText(text + ' job', { exact: false }).first().click();
      await pg.waitForTimeout(1400);
    },
    mode: 'engine',
  },
  vc: {
    row: '#standards li', live: '#standards li', binRow: '.bin-mode li',
    btn: '#btn-bin', banner: '#bin-banner-note', count: '#bin-count',
    del: '.del', restore: '.row-restore', purge: '.del',
    make: async (pg, text) => {
      const job = await pg.evaluate(async (t) => {
        const db = await import('/lib/db.js');
        const j = await db.createProject(t + ' job', 'audit');
        await db.addArtifact(j.id, { kind: 'standard', title: t, text: 'A.5.1' });
        return j.id;
      }, text);
      await pg.evaluate((id) => localStorage.setItem('vpl.binjob', id), job);
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1500);
      await pg.getByText(text + ' job', { exact: false }).first().click();
      await pg.waitForTimeout(1400);
    },
    mode: 'engine',
  },
  va: {
    row: '#artifacts li', live: '#artifacts li', binRow: '.bin-mode li',
    btn: '#btn-bin', banner: '#bin-banner-note', count: '#bin-count',
    del: '.del', restore: '.row-restore', purge: '.del',
    make: async (pg, text) => {
      const job = await pg.evaluate(async (t) => {
        const db = await import('/lib/db.js');
        const j = await db.createProject(t + ' job', 'context');
        await db.addArtifact(j.id, { kind: 'note', title: t, text: 'box: api' });
        return j.id;
      }, text);
      await pg.evaluate((id) => localStorage.setItem('vpl.binjob', id), job);
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1500);
      await pg.getByText(text + ' job', { exact: false }).first().click();
      await pg.waitForTimeout(1400);
    },
    mode: 'engine',
  },
  vn: {
    row: '#list-items li', live: '#list-items li', binRow: '.trash-mode li',
    btn: '#btn-bin', banner: '#trash-banner-note', count: '#bin-count',
    del: '#btn-del', restore: '#btn-del', purge: '.row-purge',
    make: async (pg, text) => {
      await pg.click('#btn-new');
      await pg.waitForTimeout(1100);
      await pg.click('#app [data-mode=write]').catch(() => {});
      await pg.click('#editable');
      await pg.keyboard.type(text);
      await pg.waitForTimeout(1000);
    },
    mode: 'notes',
  },
};

const spec = MAP[APP];
if (!spec) { console.log('APP must be one of ' + Object.keys(MAP).join(', ')); process.exit(1); }

const STAMP = 'bin' + Date.now().toString().slice(-6);
const TEXT = `koš proba ${STAMP}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('dialog', (d) => d.accept());

await pg.goto(BASE, { waitUntil: 'networkidle' });
/* an app that remembers a session may open straight onto the desk */
if (await pg.locator('#gate').isVisible()) {
  await pg.fill('#email', EMAIL);
  await pg.fill('#pass', PASS);
  await pg.click('#btn-login');
}
await pg.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await pg.waitForTimeout(1400);

await spec.make(pg, TEXT);

/* The bin is a place, and a place has an address: it sits in the left column
 * with a word on it, it is not a bar at the foot of the work column, and
 * nothing is on top of it. This holds in every app, so it is asked of every app
 * rather than remembered per app. */
const place = await pg.evaluate(() => {
  const btn = document.querySelector('#btn-bin') || document.querySelector('#btn-trash');
  if (!btn) return { none: true };
  const rail = document.getElementById('projects') || document.querySelector('.list');
  const work = document.querySelector('main') || document.querySelector('#spec') || document.querySelector('.workspace');
  const box = btn.getBoundingClientRect();
  const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  const foot = document.querySelector('.bin-foot');
  return {
    text: btn.textContent.replace(/\s+/g, ' ').trim(),
    inRail: rail ? rail.contains(btn) : false,
    leftOfWork: work ? box.right <= work.getBoundingClientRect().left + 2 : true,
    x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
    hit: at === btn || btn.contains(at),
    topIs: (at && (at.id || at.className)) || null,
    foot: !!(foot && foot.offsetParent),
  };
});
check(!place.none, 'the bin has a button at all');
check(place.inRail || place.leftOfWork, `the bin is in the left column, not in the work (${place.x},${place.y})`);
check(/[a-z]{3}/i.test(place.text), `the bin carries a word, not only a mark ("${place.text}")`);
check(!place.foot, 'no bar at the foot of the work column holds the bin');
check(place.hit && place.w >= 30 && place.h >= 30,
  `the bin can be pressed where it is (${place.w}×${place.h}, over it: ${place.topIs})`);

const liveCount = () => pg.locator(spec.live).count();
const binCount = () => pg.locator(spec.binRow).count();
const before = await liveCount();
check(before >= 1, `the row is there to lose (${before})`);

/* ── ✕ puts it in the bin, and says so ─────────────────────────────── */
/* vn's delete is a button of its own, and it acts on the open note; every
 * other app hangs the ✕ on the row. One helper, two habits. */
/* vn opens a note by its address — the same route the row's button sets, and
 * the only one that survives a row being a folder, a filter, or a repaint. */
async function openRow(rowSel) {
  const id = await pg.locator(rowSel).first().locator('button[data-id]').first()
    .getAttribute('data-id').catch(() => null);
  if (id) await pg.evaluate((i) => { location.hash = '#/n/' + i; }, id);
  else await pg.locator(rowSel).first().click();
  await pg.waitForTimeout(1000);
}

async function discard(rowSel, sel) {
  if (sel === '#btn-del') {
    await openRow(rowSel);
    if (process.env.BIN_DEBUG) {
      console.log('  [debug]', JSON.stringify(await pg.evaluate(() => ({
        hash: location.hash,
        rows: document.querySelectorAll('#list-items li').length,
        firstId: document.querySelector('#list-items li button[data-id]')?.dataset.id,
        delVisible: !!document.getElementById('btn-del')?.offsetParent,
        viewNoteHidden: document.getElementById('view-note')?.hidden,
        trash: document.getElementById('list')?.className,
      }))));
    }
    await pg.click('#btn-del');
    return;
  }
  /* vz (and vn's rail) keep the row tools for the row you are on */
  await pg.locator(rowSel).first().hover();
  await pg.waitForTimeout(150);
  await pg.locator(rowSel).first().locator(sel).first().click({ force: true });
}

/* The bin may already hold things — an account that has used the app has
 * used its bin. Count relatively, so the suite measures this row, not history. */
await pg.click(spec.btn);
await pg.waitForTimeout(900);
const binBefore = await binCount();
await pg.click(spec.btn);
await pg.waitForTimeout(900);

/* Leave the bin however this app leaves it. vn's bin is a mode on the list
 * whose hash never changes, so a route assignment there is a no-op. */
async function snap(tag) {
  if (!process.env.BIN_DEBUG) return;
  console.log('  [snap ' + tag + ']', JSON.stringify(await pg.evaluate(() => ({
    hash: location.hash,
    bin: !!document.querySelector('.trash-mode'),
    viewNoteHidden: document.getElementById('view-note')?.hidden,
    del: !!document.getElementById('btn-del')?.offsetParent,
  }))));
}

async function leaveBin() {
  if (APP === 'vn') {
    const open = await pg.evaluate(() => document.getElementById('list').classList.contains('trash-mode'));
    if (open) await pg.click(spec.btn);
    await pg.waitForTimeout(900);
    return;
  }
  if ((await pg.locator(spec.btn).getAttribute('aria-pressed')) === 'true') {
    await pg.click(spec.btn);
    await pg.waitForTimeout(900);
  }
}

await discard(spec.live, spec.del);
await pg.waitForTimeout(1300);

check(await until(async () => (await liveCount()) === before - 1), 'pressing ✕ takes it off the list');
check(await until(async () => /\S/.test((await pg.textContent(spec.count)) || '')), 'and the bin button carries the count');

await pg.click(spec.btn);
/* Opening the bin is a query against the server, and the answer arrives when it
 * arrives. Reading the count on a timer made this suite flaky on a slow round
 * trip (a green run one minute, 9/14 the next) — so wait for the number. */
await until(async () => (await binCount()) === binBefore + 1, 8000);

const inBin = await binCount();
check(inBin === binBefore + 1, 'the bin holds the row it took', `${binBefore} → ${inBin}`);

/* the clothes are painted in the same frame as the state, but the fill is a
 * class the app sets after its own repaint — so wait for the shape, then judge it */
await until(async () => pg.evaluate((btn) => {
  const b = document.querySelector(btn);
  const st = getComputedStyle(b);
  return b.getAttribute('aria-pressed') === 'true'
    && st.backgroundColor !== 'transparent' && st.backgroundColor !== 'rgba(0, 0, 0, 0)'
    && st.backgroundColor !== getComputedStyle(document.body).backgroundColor;
}, spec.btn), 6000);

const state = await pg.evaluate(({ btn, banner }) => {
  const b = document.querySelector(btn);
  const st = getComputedStyle(b);
  const note = document.querySelector(banner);
  return {
    pressed: b.getAttribute('aria-pressed'),
    label: (b.querySelector('.bin-label, .trash-label, .bin-word') || {}).textContent || '',
    filled: st.backgroundColor !== 'transparent' && st.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
      st.backgroundColor !== getComputedStyle(document.body).backgroundColor,
    banner: note ? note.textContent.trim() : '',
    bannerVisible: note ? note.getBoundingClientRect().height > 0 : false,
    /* vn and vz put the bin in a place of its own rather than a mode on the
     * list; either way the pane a person is looking at is not the live one. */
    tinted: !!document.querySelector('.bin-mode, .trash-mode, #binview:not([hidden])'),
  };
}, { btn: spec.btn, banner: spec.banner });

check(state.pressed === 'true', 'the button says it is open (aria-pressed)');
check(state.label !== '' && !/^recycle bin$/.test(state.label),
  'and its word changes, so the way back is written down (' + state.label + ')');
check(state.filled, 'the button is filled, not a tint of the paper');
check(state.bannerVisible && /\d/.test(state.banner),
  'a banner names the place and counts what is in it (“' + state.banner + '”)');
check(state.tinted, 'the list itself changes, not only the button');

/* ── and it comes back ─────────────────────────────────────────────── */
await (spec.restore === '#btn-del'
  ? (async () => {
    await openRow(spec.binRow);
    await pg.click('#btn-del');
  })()
  : pg.locator(spec.binRow).first().locator(spec.restore).first().click());
await pg.waitForTimeout(1500);

/* vn opens the binned note and leaves the bin when it is put back, so "is the
 * bin empty of it" may need the bin opened again before it can be answered. */
await snap('after-restore');
if ((await binCount()) === 0) {
  await pg.click(spec.btn);
  await pg.waitForTimeout(900);
  await snap('bin-reopened');
}
check(await until(async () => (await binCount()) === binBefore), 'restore takes it back out of the bin');

await leaveBin();
await snap('after-leave-1');
/* The question is not "how many rows" — a list can hold rows from an earlier
 * run, and a count is a fact about the whole list. The question is whether *this
 * row* came back, so the row is what is looked for. */
const backText = await until(async () => (await pg.locator(spec.live).allTextContents()).join(' ').includes(STAMP)
  || (await pg.locator(spec.live).allTextContents()).join(' ').includes(TEXT), 8000);
check(backText, 'and the row is on the list again', `${before} → ${await liveCount()}`);

/* ── for good is for good ──────────────────────────────────────────── */
/* the second half starts from the list as it is now, not as it was before the
 * first half ran — reading `before` again here is what keeps the arithmetic
 * honest on a rerun against a project that already had rows */
const before2 = await liveCount();
await discard(spec.live, spec.del);
await until(async () => (await liveCount()) === before2 - 1, 8000);
await pg.click(spec.btn);
await until(async () => (await binCount()) === binBefore + 1, 8000);
await pg.locator(spec.binRow).first().locator(spec.purge).first().click();
await pg.waitForTimeout(1300);
if (await pg.locator('#purge-go').isVisible().catch(() => false)) {
  await pg.click('#purge-go');
  await pg.waitForTimeout(900);
}
check((await binCount()) === binBefore, 'deleting for good takes it out of the bin');

await leaveBin();
const afterPurge = await liveCount();
check(afterPurge === before2 - 1, 'and it does not come back to the list', `${before2 - 1} expected, ${afterPurge} there`);

check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));

/* tidy up whatever the probe made */
await pg.evaluate(async (app) => {
  if (!['vd', 'vc', 'va'].includes(app)) return;
  const db = await import('/lib/db.js');
  await db.deleteProject(localStorage.getItem('vpl.binjob')).catch(() => {});
  localStorage.removeItem('vpl.binjob');
}, APP).catch(() => {});

console.log(`\n${pass}/${pass + fail} ${APP} bin checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
