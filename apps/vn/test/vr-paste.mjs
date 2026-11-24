/* vr — a spreadsheet poured into the sheet.
 *
 *   VR_URL=http://127.0.0.1:8101 node vr-paste.mjs
 *
 * The old world is an .xls with 271 rows. The bridge is a copy-paste: the
 * sentence is the longest cell, a must/optional/wish cell becomes the strength,
 * and the names continue from where the document stopped.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.VR_URL || 'http://127.0.0.1:8101';
let pass = 0, fail = 0;
const ok = (cond, what) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('dialog', (d) => d.accept());

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1200);
await pg.click('#btn-new-project');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'vr-paste test');
await pg.waitForTimeout(900);

// one row first, so the pasted names must not start at 001 again
await pg.fill('#req-add', 'The sheet shall keep a name it was given.');
await pg.press('#req-add', 'Enter');
await pg.waitForTimeout(900);

await pg.click('#btn-paste');
await pg.waitForTimeout(300);
await pg.fill('#paste-text', [
  'Vrsta zahtjeva\tKategorija zahtjeva\tOpis zahtjeva',
  '\t\tThe hut shall stand for two winters without a repair.',
  'must\tthe visit\tThe door shall open and close with one hand.',
  'optional\t\tthe hut could carry a name plate',
  'wish\tthe visit\tThe hut could get a name plate someday.',
].join('\n'));
await pg.waitForTimeout(300);
ok((await pg.textContent('#paste-msg')).includes('4 rows'), 'the preview counts four usable rows');
await pg.click('#paste-do');
await pg.waitForTimeout(1400);
ok((await pg.locator('#rows tr[data-id]').count()) === 5, 'five rows: one typed, four pasted');

const refs = await pg.locator('#rows tr[data-id]').evaluateAll((rows) => rows.map((r) => r.dataset.ref));
ok(refs.join(',') === 'VR-001,VR-002,VR-003,VR-004,VR-005', 'names continue instead of restarting: ' + refs.join(' '));

const rows = await pg.locator('#rows tr[data-id]').evaluateAll((trs) => trs.map((tr) => ({
  text: tr.textContent.replace(/\s+/g, ' ').trim(),
  strength: tr.querySelector('.c-strength .chip-value').textContent.replace(/\s+/g, ''),
  theme: tr.querySelector('.c-theme').textContent.trim(),
})));
ok(rows[1].text.includes('two winters') && rows[1].strength === '■must', 'the bare sentence becomes a must');
ok(rows[2].strength === '■must' && rows[2].theme === 'the visit', 'a short cell becomes the theme, the sentence stays the sentence');
ok(rows[3].strength === '◆optional', 'optional is read from the cell');
ok(rows[4].strength === '◇wish' && rows[4].text.includes('name plate'), 'wish is read too');

// the header row did not become a requirement
ok(!(await pg.textContent('#rows')).includes('Vrsta zahtjeva'), 'a spreadsheet header is not a requirement');

// commas work as well as tabs, and quoted commas stay in one cell
await pg.click('#btn-paste');
await pg.fill('#paste-text', 'Two bunks shall fit inside, "says the child", she said.');
await pg.click('#paste-do');
await pg.waitForTimeout(1200);
ok((await pg.locator('#rows tr[data-id]').count()) === 6, 'a comma separated line adds one row');
ok((await pg.textContent('#rows')).includes('says the child'), 'a quoted comma survives');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));

await pg.locator('.proj-row.on .kill').click();
await pg.waitForTimeout(1200);

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
