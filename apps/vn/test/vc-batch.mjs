/* vc · the batch — one row is one check.
 *
 * Fifty offers, or one job ad and a pile of CVs: the same verdict grammar, but
 * one report per row and a list that sorts by what was found. This walks it like
 * a person would, with the model's answer mocked so the run is deterministic and
 * costs nothing: what is under test is the queue, the piles and the tallies, not
 * the prose.
 *
 *   node vc-batch.mjs           # local, port 8105
 *   VPL_PROD=1 node vc-batch.mjs
 */
import { chromium } from 'playwright';
import { join } from 'node:path';
import { OWNER } from './_account.mjs';

const PROD = process.env.VPL_PROD === '1';
const BASE = process.env.VC_URL || (PROD ? 'https://vc.terg.hr' : 'http://127.0.0.1:8105');
const OUT = '/home/vergovic/vixen/.shots';
let ok = 0, bad = 0;
const chk = (name, cond, got = '') => {
  if (cond) { ok += 1; console.log('  ✓ ' + name); }
  else { bad += 1; console.log('  ✗ ' + name + (got ? ' — ' + String(got).slice(0, 200) : '')); }
};

const ANSWER = `# Ocjena kandidata — test

## Sažetak
Dva uvjeta su ispunjena, jedan nije.

## Uvjeti
- PASS — vozačka dozvola B kategorije — "posjedujem vozačku dozvolu B kategorije"
- PASS — pet godina iskustva — "radim od 2019. godine"
- FAIL — njemački jezik — "njemački ne govorim"

## Što pitati kandidata
Kada može početi?`;

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1440, height: 980 } });
/* a key, so the run is allowed to start; the answer itself comes from the route
 * below, so nothing is spent and nothing depends on a model being awake */
await ctx.addInitScript(() => {
  localStorage.setItem('vpl.ai', JSON.stringify({
    url: 'https://api.example.invalid/v1', key: 'sk-test', model: 'test-model',
  }));
});
const pg = await ctx.newPage();
pg.on('pageerror', (e) => { bad += 1; console.log('  ✗ page error: ' + e.message.slice(0, 160)); });

/* every model call is answered from here, and every call is counted */
let calls = [];
await pg.route('**/api/chat', async (route) => {
  const body = route.request().postData() || '';
  calls.push({ at: Date.now(), body });
  /* a model takes a moment; without one the queue would be over before anybody
   * could see a row say it is running */
  await new Promise((r) => setTimeout(r, 500));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: ANSWER } }] }),
  });
});
await pg.route('**/functions/v1/chat', async (route) => {
  calls.push({ at: Date.now(), body: route.request().postData() || '' });
  await new Promise((r) => setTimeout(r, 500));
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: ANSWER } }] }),
  });
});

const wait = (ms) => pg.waitForTimeout(ms);
const until = async (fn, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await wait(150);
  }
  return false;
};
const txt = (sel) => pg.locator(sel).first().textContent().then((t) => (t || '').trim());

await pg.goto(BASE, { waitUntil: 'networkidle' });
if (await pg.locator('#gate').isVisible()) {
  await pg.fill('#email', OWNER.email);
  await pg.fill('#pass', OWNER.pass);
  await pg.click('#btn-login');
}
await pg.waitForSelector('#app:not([hidden])', { timeout: 30000 });
await until(async () => (await pg.locator('#welcome:not([hidden])').count()) > 0
  || (await pg.locator('#spec:not([hidden])').count()) > 0, 15000);

/* ── a check of the batch kind ─────────────────────────────────────── */
console.log('\na tender, not an audit');
await pg.click('#btn-new');
await until(async () => (await pg.locator('#proj-title').inputValue()) === '', 8000);
await wait(600);
const nRows = await pg.locator('#proj-list li').count();
const title = 'test · batch ' + new Date().toISOString().slice(11, 19);
await pg.fill('#proj-title', title);
await pg.locator('#proj-title').blur();
await wait(1400);
chk('the check exists', (await pg.locator('#proj-list li').count()) >= nRows);
await pg.selectOption('#template', 'tender');
await wait(1200);

chk('the piles are named by the pack', (await txt('#std-head')) === 'uvjeti natječaja'
  && (await txt('#ev-head')) === 'kandidati'
  && (await txt('#tgt-head')) === 'kandidati', `${await txt('#std-head')} / ${await txt('#ev-head')} / ${await txt('#tgt-head')}`);
chk('the add buttons follow the pack',
  (await txt('#btn-add-standard')).includes('uvjet natječaja')
  && (await txt('#btn-add-target')).includes('kandidat'));
chk('a batch shows its list', !(await pg.locator('#targets-wrap').isHidden()));

/* ── the rules: shared, added once ─────────────────────────────────── */
console.log('\nthe ad’s conditions');
await pg.click('#btn-add-standard');
await pg.waitForSelector('#art-dialog[open]', { state: 'attached' });
await wait(500);
await pg.fill('#art-title', 'uvjeti — skladište');
await pg.fill('#art-text', '1. Vozačka dozvola B kategorije.\n2. Najmanje pet godina iskustva u skladištu.\n3. Njemački jezik, razina B1.');
await pg.click('#art-save');
await until(async () => (await pg.locator('#standards .art').count()) > 0, 10000);
chk('the rules are in the check', (await pg.locator('#standards .art').count()) === 1);

/* ── two candidates, each with their own proofs ───────────────────── */
console.log('\ntwo candidates');
await pg.click('#btn-add-target');
await until(async () => (await pg.locator('#targets .tgt').count()) > 0, 10000);
await pg.click('#btn-add-target');
await until(async () => (await pg.locator('#targets .tgt').count()) === 2, 10000);
const names = await pg.locator('.tgt-name').evaluateAll((els) => els.map((e) => e.value));
chk('rows are numbered and named', names.length === 2, names.join(', '));
chk('the last row is on the desk', (await pg.locator('.tgt.on .tgt-name').inputValue()) === names[1]);
chk('the evidence pile says whose it is', (await txt('#ev-who')).includes(names[1]), await txt('#ev-who'));

/* the name is editable in place */
const first = pg.locator('.tgt-name').first();
await first.fill('Ana Kovač');
await first.blur();
chk('renaming a row sticks in the list',
  await until(async () => (await pg.locator('.tgt-name').first().inputValue()) === 'Ana Kovač', 6000));

/* candidate 2's proof */
async function addProof(name, text) {
  await pg.click('#btn-add-evidence');
  await pg.waitForSelector('#art-dialog[open]', { state: 'attached' });
  await wait(400);
  await pg.fill('#art-title', name);
  await pg.fill('#art-text', text);
  await pg.click('#art-save');
  await until(async () => (await pg.locator('#art-dialog[open]').count()) === 0, 8000);
  await wait(400);
}
await addProof('CV — kandidat 2', 'Pet godina u skladištu. Njemački ne govorim. Vozačka B.');
await until(async () => (await pg.locator('#evidence .art').count()) === 1, 10000);
chk('the proof landed in the row’s pile', (await pg.locator('#evidence .art').count()) === 1);
chk('the shared rules did not move', (await pg.locator('#standards .art').count()) === 1);

/* candidate 1's proof */
await pg.locator('.tgt').first().click();
await until(async () => (await txt('#ev-who')).includes('Ana Kovač'), 8000);
chk('another row is another pile', (await pg.locator('#evidence .art').count()) === 0,
  String(await pg.locator('#evidence .art').count()));
await addProof('CV — Ana', 'Radim od 2019. Njemački B1. Vozačka dozvola B kategorije.');
await until(async () => (await pg.locator('#evidence .art').count()) === 1, 10000);
chk('each candidate keeps their own proofs',
  (await pg.locator('#evidence .art').count()) === 1
  && (await pg.locator('#standards .art').count()) === 1);

/* ── the queue ─────────────────────────────────────────────────────── */
console.log('\nrun all — one at a time, in order');
calls = [];
const t0 = Date.now();
await pg.click('#btn-run-all');
chk('the button says it is running', await until(async () => (await txt('#btn-run-all')).includes('running'), 5000), await txt('#btn-run-all'));
chk('stop appears while it runs', !(await pg.locator('#btn-stop').isHidden()));
chk('one row runs at a time', await until(async () => (await pg.locator('#targets .tgt.st-running').count()) === 1, 8000),
  'running rows: ' + (await pg.locator('#targets .tgt.st-running').count()));
chk('the rows finish', await until(async () => (await pg.locator('.tgt.st-done').count()) === 2, 45000),
  'done rows: ' + (await pg.locator('.tgt.st-done').count()));
chk('two calls, not one big one', calls.length === 2, String(calls.length));
chk('the calls come one after another', calls.length === 2 && calls[1].at - calls[0].at > 60,
  calls.map((c) => c.at - t0).join(' → '));
chk('each call carries only its own candidate',
  calls.length === 2 && !(calls[0].body.includes('Radim od 2019') && calls[0].body.includes('Pet godina')),
  'body 1 has both CVs');
chk('the tallies are on the row', (await txt('.tgt.st-done .tgt-tally')).includes('pass'),
  await txt('.tgt.st-done .tgt-tally'));
chk('the tally counts the verdict lines', (await txt('.tgt.st-done .verdict.pass')).startsWith('2'),
  await txt('.tgt.st-done .verdict.pass'));
chk('the run says what happened', (await txt('#tgt-run-msg')).startsWith('done: 2 of 2'), await txt('#tgt-run-msg'));
chk('run all offers itself again', (await pg.locator('#btn-run-all').isEnabled())
  && (await txt('#btn-run-all')).includes('2'), await txt('#btn-run-all'));

/* one report per row, and the desk follows the selection */
chk('the desk shows the last row’s report',
  (await pg.inputValue('#out-body')).includes('Ocjena kandidata'));
await pg.locator('.tgt').first().click();
chk('switching a row switches the report', await until(async () => {
  const v = await pg.inputValue('#out-body');
  return v.includes('Ocjena kandidata');
}, 8000));
chk('a row with one report hides the version picker', await pg.locator('#out-versions').isHidden());
/* a second run of the same row is a second version of that row's report, and
 * still only that row's: versions never mix two candidates */
await pg.click('#btn-generate');
await until(async () => (await txt('#gen-msg')).includes('written in') || (await txt('#gen-msg')).includes('read it'), 20000);
await wait(600);
chk('running one row makes one more version', await until(async () => !(await pg.locator('#out-versions').isHidden()), 8000));
chk('the picker holds both, and only this row’s',
  (await pg.locator('#out-versions option').count()) === 2,
  String(await pg.locator('#out-versions option').count()));

/* ── stop is honest ────────────────────────────────────────────────── */
console.log('\nstop after the one in flight');
await pg.locator('.tgt').first().click();
await wait(600);
calls = [];
await pg.click('#btn-run-all');
await until(async () => (await txt('#tgt-run-msg')).includes('1 of 2'), 8000);
await pg.click('#btn-stop');
chk('stopping says when', await until(async () => (await txt('#tgt-run-msg')).includes('stopping'), 4000),
  await txt('#tgt-run-msg'));
chk('it stops after the one in flight',
  await until(async () => (await txt('#tgt-run-msg')).includes('stopped after the one in flight'), 20000),
  await txt('#tgt-run-msg'));
chk('a stopped queue ran one, not both', calls.length === 1, 'calls: ' + calls.length);
chk('nothing is left pretending to run', (await pg.locator('#targets .tgt.st-running').count()) === 0);
chk('the queue offers itself again', await pg.locator('#btn-run-all').isEnabled());

/* ── removing a row is undoable ───────────────────────────────────── */
console.log('\n✕ on a row');
const before = await pg.locator('#targets .tgt').count();
await pg.locator('.tgt .tgt-del').last().click();
await until(async () => (await pg.locator('#targets .tgt').count()) === before - 1, 8000);
chk('the row leaves the list', (await pg.locator('#targets .tgt').count()) === before - 1);
await pg.click('#btn-bin');
await until(async () => (await pg.locator('#standards .art.in-bin').count()) > 0, 8000);
chk('the row waits in the recycle bin',
  (await pg.locator('#standards .art.tgt-bin').count()) === 1);
chk('the bin names what it holds',
  (await txt('#std-none')) === '' && (await txt('#bin-banner-note')).includes('in the bin'),
  await txt('#bin-banner-note'));
await pg.locator('.tgt-bin [data-back]').click();
await until(async () => (await pg.locator('.tgt-bin').count()) === 0, 8000);
chk('restore gives the row back', (await pg.locator('.tgt-bin').count()) === 0);
await pg.click('#btn-bin');
await until(async () => (await pg.locator('#standards .art.tgt-bin').count()) === 0, 6000);
chk('the list is whole again', await until(async () => (await pg.locator('#targets .tgt').count()) === before, 8000),
  String(await pg.locator('#targets .tgt').count()));

/* ── choosing is how a subset is said ────────────────────────────────
 * A run covers everything the list holds unless a person narrows it: the tick
 * on a row is the narrowing, and an unticked list means "all of it". The tick
 * is on rules and proofs too, so a run can be one rule against three
 * candidates, or three rules against one. */
console.log('\nthe tick says what the run covers');
/* both bins are in the rail: a place belongs on the left, not under the last
 * row of work */
const bins = await pg.evaluate(() => {
  const rail = document.getElementById('projects');
  const a = document.getElementById('btn-bin');
  const b = document.getElementById('btn-job-bin');
  const at = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }; };
  return { row: rail.contains(a) ? at(a) : null, job: rail.contains(b) ? at(b) : null,
    railRight: Math.round(rail.getBoundingClientRect().right),
    inWork: !!document.querySelector('.work .bin-foot') };
});
chk('the row bin sits in the rail, on the left', !!bins.row && bins.row.x + bins.row.w <= bins.railRight,
  JSON.stringify(bins.row));
chk('the check bin sits beside it, and both are words not just a mark',
  !!bins.job && bins.job.x + bins.job.w <= bins.railRight
  && (await txt('#btn-job-bin')).includes('checks') && (await txt('#btn-bin')).includes('inputs'),
  `${await txt('#btn-job-bin')} / ${await txt('#btn-bin')}`);
chk('nothing is left of the bar under the work', !bins.inWork);

/* a second rule and a third candidate */
await pg.click('#btn-add-standard');
await pg.waitForSelector('#art-dialog[open]', { state: 'attached' });
await wait(400);
await pg.fill('#art-title', 'uvjeti — rok');
await pg.fill('#art-text', 'Isporuka najkasnije 30 dana od potvrde.');
await pg.click('#art-save');
await until(async () => (await pg.locator('#standards .art').count()) === 2, 10000);
await pg.click('#btn-add-target');
await until(async () => (await pg.locator('#targets .tgt').count()) === 3, 10000);
chk('two rules, three candidates', (await pg.locator('#standards .art').count()) === 2
  && (await pg.locator('#targets .tgt').count()) === 3);

/* narrow to the second rule only — a repaint rebuilds the list, so each press
 * is aimed at the list again rather than at a node that is already gone */
await pg.locator('#standards .art').nth(1).locator('.pick').click();
await until(async () => (await txt('#std-count')) === '1 of 2', 6000);
chk('the rules say how much of them a run will use', (await txt('#std-count')) === '1 of 2', await txt('#std-count'));

/* and run just one row with its own ▶ */
calls = [];
await pg.locator('#targets .tgt').nth(2).locator('.tgt-run').click();
await until(() => calls.length > 0, 15000);
await until(async () => (await pg.locator('#targets .tgt .tgt-state').nth(2).textContent()) === 'done', 15000);
const oneBody = calls.map((c) => c.body).join('\n');
chk('▶ runs one row on its own', calls.length === 1, `${calls.length} call(s)`);
chk('and only the rules that were ticked travel with it',
  oneBody.includes('najkasnije 30 dana') && !oneBody.includes('Vozačka dovoljna B kategorije')
  && !oneBody.includes('Vozačka dozvola B kategorije'), oneBody.slice(0, 120));

/* now two rows of three, untick the rules (an empty tick means all of them) */
for (let i = 0; i < 2; i += 1) await pg.locator('#standards .art').nth(i).locator('.pick').click();
await pg.locator('#targets .tgt').nth(0).locator('.tgt-pick').click();
await pg.locator('#targets .tgt').nth(1).locator('.tgt-pick').click();
await until(async () => (await txt('#btn-run-all')).startsWith('run 2'), 6000);
chk('the button says how many rows were chosen', (await txt('#btn-run-all')).startsWith('run 2'), await txt('#btn-run-all'));
chk('and the line under it says how much of the list that is',
  (await txt('#tgt-run-msg')).includes('2 of 3'), await txt('#tgt-run-msg'));

calls = [];
await pg.click('#btn-run-all');
await until(() => calls.length === 2, 20000);
await until(async () => {
  const st = await pg.locator('#targets .tgt .tgt-state').evaluateAll((els) => els.map((e) => e.textContent));
  return st[0] === 'done' && st[1] === 'done' && st[2] === 'done';
}, 20000);
chk('two rows run, in order, one call each', calls.length === 2, `${calls.length} call(s)`);
const order = await pg.locator('#targets .tgt .tgt-state').evaluateAll((els) => els.map((e) => e.textContent));
chk('the row nobody ticked kept its last answer', order.filter((x) => x === 'done').length === 3, order.join(' / '));

/* all and none are one press each, and none means everything */
await pg.click('#btn-tgt-all');
await until(async () => (await txt('#btn-run-all')).startsWith('run 3'), 6000);
chk('all ticks every row', (await txt('#btn-run-all')).startsWith('run 3'), await txt('#btn-run-all'));
await pg.click('#btn-tgt-none');
await until(async () => (await txt('#btn-run-all')).startsWith('run all'), 6000);
chk('none goes back to the whole list, which is what a run means by default',
  (await txt('#btn-run-all')).startsWith('run all'), await txt('#btn-run-all'));

/* ── a phone ──────────────────────────────────────────────────────── */
console.log('\na phone');
await pg.setViewportSize({ width: 354, height: 720 });
await wait(600);
const sideways = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
chk('nothing is pushed sideways', sideways <= 1, sideways + ' px');
await pg.locator('.tgt').first().screenshot({ path: join(OUT, 'tgt-phone.png') }).catch(() => {});
await pg.setViewportSize({ width: 1440, height: 980 });
await wait(400);

/* ── and the job is put out of the way ────────────────────────────── */
await pg.locator('#proj-list li.on .kill').first().click();
await wait(1200);

console.log(`\n${ok} ok, ${bad} failed`);
await br.close();
process.exit(bad ? 1 : 0);
