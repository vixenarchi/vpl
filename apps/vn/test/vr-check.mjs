/* vr — the sheet, end to end.
 *
 *   VR_URL=http://127.0.0.1:8100 node vr-check.mjs
 *
 * Runs as the agent account, makes one document, and deletes it again. No model
 * is needed: this is about the sheet, the keyboard, the colours and the gaps.
 */
import { chromium } from 'playwright';

const B = process.env.VR_URL || 'http://127.0.0.1:8100';
let pass = 0, fail = 0;
const ok = (cond, what) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };
const until = async (fn, ms = 8000, step = 120) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const br = await chromium.launch();
const ctx = await br.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'the roof' : undefined));

await pg.goto(B, { waitUntil: 'networkidle' });
ok(await pg.locator('#gate').isVisible(), 'the gate is up before a session');
await pg.fill('#email', 'vpl-agent@terg.hr');
await pg.fill('#pass', 'agent-vpl-2026!');
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1200);
ok(await until(async () => (await pg.locator('#spec').isVisible()) || (await pg.locator('#welcome').isVisible()), 12000),
  'signed in, app or welcome is visible');

// ── a document
// A previous failed run can leave its document behind; a test that only passes
// on the first attempt is not a test, so clear the name before creating it.
for (let i = 0; i < 6; i++) {
  const old = pg.locator('.proj-row', { hasText: 'vr-check dog house' });
  if (!(await old.count())) break;
  await old.first().click();
  await pg.waitForTimeout(600);
  await pg.locator('.proj-row.on .kill').click();
  await pg.waitForTimeout(900);
}
// The document is created over the network. Naming it before it exists types
// into whichever document was open before, so wait for the rail to grow.
const railBefore = await pg.locator('.proj-row').count();
await pg.click('#btn-new-project');
if (!(await until(async () => (await pg.locator('.proj-row').count()) === railBefore + 1, 12000)))
  console.log('  note: the new document did not appear in the rail');
await pg.fill('#proj-title', 'vr-check dog house');
ok(await until(async () => (await pg.inputValue('#proj-title')) === 'vr-check dog house', 5000),
  'a document can be named');
ok(await pg.locator('#brief').isVisible(), 'the brief sits above the rows');

// the brief saves and survives
await pg.click('#brief summary');
await pg.waitForTimeout(200);
await pg.fill('#brief-text', 'a dog house for one medium dog, built by three people in a weekend');
await pg.fill('#brief-scope', 'no heating, no electricity');
await pg.click('#brief-save');
ok(await until(async () => (await pg.textContent('#brief-msg')).trim() === 'saved', 8000),
  'the brief saves');

// ── rows: type, Enter, next
let n = 0;
for (const s of [
  'The floor shall be raised 5 cm above the ground.',
  'The roof shall shed rain without a gutter.',
  'The door opening shall be at least 30 cm wide.',
]) {
  await pg.fill('#req-add', s);
  await pg.press('#req-add', 'Enter');
  await until(async () => (await pg.locator('#rows tr[data-id]').count()) >= n + 1, 8000);
  n++;
}
ok((await pg.locator('#rows tr[data-id]').count()) === 3, 'three rows are in the sheet');
const refs = await pg.locator('#rows tr[data-id]').evaluateAll((rows) => rows.map((r) => r.dataset.ref));
ok(refs.join(',') === 'VR-001,VR-002,VR-003', 'rows are named in order in the database: ' + refs.join(' '));
const shown = await pg.locator('#rows tr[data-id] .c-req').allTextContents();
ok(!shown.join(' ').includes('VR-'), 'and no name is shown on the sheet');
ok(shown.join(' ').includes('The floor shall be raised'), 'the requirement is the sentence');
ok((await pg.textContent('#proj-meta')).includes('3 rows'), 'the count above the sheet agrees');

// ── strength: one click cycles, the mark and the word change together
await pg.locator('#rows tr[data-id]').nth(1).locator('.c-strength .chip-value').click();
await until(async () => (await pg.locator('#rows tr[data-id]').nth(1).locator('.c-strength .chip-value').textContent()).includes('optional'), 8000);
let s2 = await pg.locator('#rows tr[data-id]').nth(1).locator('.c-strength .chip-value').textContent();
ok(s2.includes('optional') && s2.includes('◆'), 'second row became optional, mark and word together');
await pg.locator('#rows tr[data-id]').nth(2).locator('.c-strength .chip-value').click();
await until(async () => (await pg.locator('#rows tr[data-id]').nth(2).locator('.c-strength .chip-value').textContent()).includes('optional'), 8000);
await pg.locator('#rows tr[data-id]').nth(2).locator('.c-strength .chip-value').click();
await until(async () => (await pg.locator('#rows tr[data-id]').nth(2).locator('.c-strength .chip-value').textContent()).includes('wish'), 8000);
const s3 = await pg.locator('#rows tr[data-id]').nth(2).locator('.c-strength .chip-value').textContent();
ok(s3.includes('wish') && s3.includes('◇'), 'third row cycled to wish');

// ── sorting: a heading sorts, a second click turns it round
await pg.locator('#sheet thead th[data-sort="strength"]').click();
await pg.waitForTimeout(400);
let order = await pg.locator('#rows tr[data-id]').evaluateAll((rows) => rows.map((r) => r.dataset.ref));
ok(order[0] === 'VR-001', 'sorting by how hard follows the document`s order, not the alphabet: ' + order.join(' '));
await pg.locator('#sheet thead th[data-sort="strength"]').click();
await pg.waitForTimeout(500);
order = await pg.locator('#rows tr[data-id]').evaluateAll((rows) => rows.map((r) => r.dataset.ref));
ok(order[0] === 'VR-003', 'and the second click turns it round: ' + order.join(' '));
await pg.locator('#sheet thead th[data-sort="pos"]').click();
await pg.waitForTimeout(300);

// ── find
await pg.fill('#q', 'shed rain');
ok(await until(async () => (await pg.locator('#rows tr[data-id]').count()) === 1, 6000),
  'the find box narrows the sheet');
await pg.fill('#q', '');
ok(await until(async () => (await pg.locator('#rows tr[data-id]').count()) === 3, 6000), 'and clearing it brings them back');

// ── the detail opens in place and autosaves
await pg.locator('#rows tr[data-id]').first().locator('.req-open').click();
await pg.waitForTimeout(500);
ok(await pg.locator('tr.detail').isVisible(), 'a row opens into its own detail');
await pg.fill('#rows tr.detail textarea[data-field="statement"]', 'The floor shall be raised 5 cm above the grass.');
await pg.waitForTimeout(1400);
ok((await pg.locator('#rows tr[data-id]').first().textContent()).includes('above the grass'),
  'editing the sentence in the detail changes the row');

// ── one attachment per row, and two megabytes is the limit
const rid = await pg.locator('#rows tr.detail').evaluate((tr) => tr.previousElementSibling.dataset.id);
await pg.setInputFiles(`input[data-file-input="${rid}"]`, {
  name: 'merenje.txt', mimeType: 'text/plain', buffer: Buffer.from('nagib 22 · 42 m2'),
});
ok(await until(async () => (await pg.textContent(`#d-msg-${rid}`)).includes('attached'), 15000),
  'a proof can be attached to a row');
ok((await pg.textContent(`button[data-open-file="${rid}"]`)).includes('merenje.txt'),
  'and the sheet names the file');
await pg.setInputFiles(`input[data-file-input="${rid}"]`, {
  name: 'too-big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(3 * 1024 * 1024),
});
await pg.waitForTimeout(900);
ok((await pg.textContent(`#d-msg-${rid}`)).includes('2 MB'),
  'a file over two megabytes is refused before it leaves the browser');
await pg.click(`button[data-drop-file="${rid}"]`);
ok(await until(async () => (await pg.locator(`button[data-open-file="${rid}"]`).count()) === 0, 15000),
  'and an attachment can be taken off again');

// ── the sheet is a sentence and two words, nothing else
ok((await pg.locator('#sheet thead th').count()) === 5, 'five headings: requirement, how hard, status, theme, tools');
ok((await pg.locator('#btn-columns').count()) === 0, 'and no all-columns switch to bring the rest back');
const detailLabels = await pg.locator('#rows tr.detail label').allTextContents();
ok(detailLabels.length <= 6, 'the detail is short: ' + detailLabels.length + ' fields');
ok(!detailLabels.join(' ').toLowerCase().includes('long version'), 'no long version anywhere');

// ── moving a row up
await pg.locator('#rows tr[data-id]').nth(2).hover();
await pg.locator('#rows tr[data-id]').nth(2).locator('button[data-move="-1"]').click();
await pg.waitForTimeout(900);
const moved = await pg.locator('#rows tr[data-id]').evaluateAll((rows) => rows.map((r) => r.dataset.ref));
ok(moved[1] === 'VR-003' && moved[2] === 'VR-002', 'a row moves up by one: ' + moved.join(' '));

// ── the glossary
await pg.click('#btn-glossary');
await pg.waitForTimeout(300);
await pg.fill('#term-word', 'raised floor');
await pg.fill('#term-mean', 'the platform the hut stands on, above ground level');
await pg.click('#term-add-b');
await pg.waitForTimeout(900);
ok((await pg.locator('#term-list li').count()) === 1, 'a word goes into the glossary');
await pg.click('#glossary-x');

// ── copy as markdown
await pg.bringToFront();
await pg.click('#btn-copy');
const clip = await until(() => pg.evaluate(() => navigator.clipboard.readText()), 6000) || '';
ok(clip.includes('# vr-check dog house'), 'copy gives a markdown document' + (clip.includes('# vr-check dog house') ? '' : ' — got: ' + JSON.stringify(clip.slice(0, 60))));
ok(!clip.includes('VR-001'), 'and no internal names in the markdown');
ok(clip.includes('## glossary'), 'and the glossary');
ok(clip.includes('a dog house for one medium dog'), 'and the brief');

// ── it survives a reload
await pg.reload({ waitUntil: 'networkidle' });
ok(await until(async () => (await pg.locator('#rows tr[data-id]').count()) === 3, 12000),
  'three rows after a reload');
ok(await until(async () => (await pg.inputValue('#proj-title')) === 'vr-check dog house', 12000),
  'the document reopened as the last one');
await pg.click('#brief summary');
await pg.waitForTimeout(300);
ok((await pg.inputValue('#brief-text')).includes('medium dog'), 'the brief survived');

// ── the keyboard moves a row
await pg.locator('#rows tr[data-id]').nth(1).locator('.req-open').click();
await pg.waitForTimeout(400);
await pg.locator('#rows tr.detail textarea[data-field="statement"]').focus();
await pg.keyboard.press('Alt+ArrowUp');
await pg.waitForTimeout(900);
const kb = await pg.locator('#rows tr[data-id]').evaluateAll((rows) => rows.map((r) => r.dataset.ref));
ok(kb[0] === 'VR-003', 'alt+↑ moves the focused row up: ' + kb.join(' '));
await pg.keyboard.press('Escape').catch(() => {});

// ── the tree: a theme, and the quick add going into it
await pg.click('#btn-new-theme');
ok(await until(async () => (await pg.locator('#theme-tree .tt-root').count()) === 1, 10000),
  'a theme can be made from the rail');
await pg.locator('#theme-tree .tt-root .tt-pick').first().click();
await pg.waitForTimeout(800);
ok((await pg.locator('#sheet').getAttribute('data-theme')) === '1', 'standing inside a theme');
ok(await pg.locator('#sheet thead th.c-theme').isHidden(), 'and the theme column steps aside');
ok((await pg.textContent('#crumb')).includes('the roof'), 'the breadcrumb says where you are');
await pg.fill('#req-add', 'The house shall keep the rain off the wood.');
await pg.press('#req-add', 'Enter');
ok(await until(async () => (await pg.locator('#rows tr[data-id]').count()) === 1, 10000),
  'a row typed inside the theme is only that theme');
ok((await pg.textContent('#add-theme')).includes('the roof'), 'and the box said where it would go');
await pg.locator('#theme-tree .tt-all .tt-pick').click();
await pg.waitForTimeout(800);
ok((await pg.locator('#sheet').getAttribute('data-theme')) === '0', 'everything is one click away');
ok(await pg.locator('#sheet thead th.c-theme').isVisible(), 'and the theme column comes back');

// ── print is the document, not the app
await pg.emulateMedia({ media: 'print' });
await pg.waitForTimeout(200);
ok(await pg.locator('.bar').isHidden(), 'printing leaves the bar out');
ok(await pg.locator('.add-row').isHidden(), 'and the new-row box');
ok(await pg.locator('.tools').isHidden(), 'and the tools');
ok(await pg.locator('#rows tr[data-id]').first().isVisible(), 'but keeps the rows');
await pg.emulateMedia({ media: 'screen' });

// ── a phone: one column, the rail as a drawer
const phone = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
pp.on('pageerror', (e) => errors.push('phone: ' + e.message));
await pp.goto(B, { waitUntil: 'networkidle' });
await pp.fill('#email', 'vpl-agent@terg.hr');
await pp.fill('#pass', 'agent-vpl-2026!');
await pp.click('#btn-login');
await pp.waitForSelector('#app:not([hidden])');
await pp.waitForTimeout(1600);
ok((await pp.evaluate(() => getComputedStyle(document.querySelector('.body')).gridTemplateColumns.split(' ').length)) === 1,
  'on a phone the sheet is one column');
ok(await pp.locator('#btn-projects').isVisible(), 'a phone gets the rail button');
await pp.click('#btn-projects');
await pp.waitForTimeout(300);
ok((await pp.evaluate(() => document.body.dataset.rail)) === 'open', 'the rail opens as a drawer');
ok((await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
  'a phone does not scroll sideways');

// a phone gets cards, not a clipped table, and a row still opens compact
await pp.locator('.proj-row.on .pick').click().catch(() => {});
await pp.waitForTimeout(2200);
ok((await pp.evaluate(() => getComputedStyle(document.querySelector('#sheet')).display)) === 'block',
  'on a phone the sheet is a list of sentences, not a table');
ok(await pp.locator('#sheet tbody tr[data-id] .c-status').first().isVisible(),
  'and the status is not pushed off the screen');
await pp.locator('#rows tr[data-id]').first().locator('.req-open').click();
await pp.waitForTimeout(700);
ok((await pp.locator('#rows tr.detail').evaluate((tr) => Math.round(tr.getBoundingClientRect().height))) < 300,
  'an opened row stays a strip, not a form');
ok((await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
  'and opening it still does not scroll sideways');
await phone.close();

// ── delete a row, then the document
await pg.locator('#rows tr[data-id]').nth(2).hover();
await pg.locator('#rows tr[data-id]').nth(2).locator('button[data-del]').click();
await pg.waitForTimeout(900);
ok((await pg.locator('#rows tr[data-id]').count()) === 3, 'a row can be deleted');

await pg.locator('.proj-row.on .kill').click();
await pg.waitForTimeout(1200);
ok((await pg.textContent('#proj-meta')).indexOf('vr-check') === -1, 'the document is gone again');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
