/* vc — the library. A law you keep, so you stop pasting it.
 *
 * What it proves: a standard is kept, counted in characters, copied into a
 * check (not pointed at), its ✕ bins it rather than destroying it, a binned
 * standard can come back, an input keeps its text when the standard is deleted
 * for good, editing a standard does not rewrite a report already written, and
 * a guest never sees the drawer.
 *
 * And where a standard's words come from: a link read through the app's own
 * door, and a pdf that becomes text while the original is kept. The door itself
 * is answered by a route here, so the test says what the screen does with a
 * yes, a no and a "that is a pdf" — the door's own behaviour is checked against
 * the live source by hand.
 *
 *   node vc-lib.mjs                        # http://127.0.0.1:8105
 *   VC_URL=https://vc.terg.hr node vc-lib.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OWNER } from './_account.mjs';

const B = process.env.VC_URL || 'http://127.0.0.1:8105';
const STAMP = Math.random().toString(36).slice(2, 6);

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
async function login(pg) {
  await pg.goto(B, { waitUntil: 'networkidle' });
  if (await pg.locator('#gate').isVisible()) {
    await pg.fill('#email', OWNER.email);
    await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
  }
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(1200);
}

const LAW = 'Zakon o radu — čl. 45\n\nRadnik ima pravo na godišnji odmor od najmanje '
  + 'četiri tjedna. Odmor se može koristiti u dijelovima, ali najmanje dva tjedna '
  + 'u kontinuitetu tijekom kalendarske godine.\n\n[' + STAMP + ']';
const TITLE = 'Zakon o radu — čl. 45 (' + STAMP + ')';

/* A one-page pdf, written by hand: a law is often a pdf, and a test that needs a
 * real file needs it to be a real file. */
function makePdf(path, lines) {
  const body = lines.map((l, i) => `BT /F1 11 Tf 72 ${780 - i * 16} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${body.length}>>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of at) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, out, 'latin1');
}

const PDF_TEXT = ['Zakon o zastiti na radu', 'Clanak 12.', 'Poslodavac je duzan osposobiti radnika za rad na siguran nacin.'];
const pdfPath = join(tmpdir(), `vpl-law-${STAMP}.pdf`);
makePdf(pdfPath, PDF_TEXT);
const READ = 'Zakon o radu\n\nClanak 45. Radnik ima pravo na godisnji odmor.\n[' + STAMP + ']';

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 },
  permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await ctx.newPage();

/* the door, answered here: eur-lex and narodne-novine are not on any list this
 * test may knock on, and a test that calls them is a test that fails on a train */
await pg.route('**/api/fetch', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const host = (() => { try { return new URL(body.url).hostname; } catch { return ''; } })();
  if (host.endsWith('narodne-novine.nn.hr')) {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ url: body.url, title: 'Narodne novine', text: READ, chars: READ.length }),
    });
  }
  if (host.endsWith('eur-lex.europa.eu')) {
    return route.fulfill({
      status: 422, contentType: 'application/json',
      body: JSON.stringify({ error: 'that is a pdf — download it and drop it into the library instead', isPdf: true }),
    });
  }
  return route.fulfill({
    status: 422, contentType: 'application/json',
    body: JSON.stringify({ error: 'that source is not on the list — download the pdf and drop it here', source: false }),
  });
});
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => {
  /* a refused source is the test asking for one: the browser logs the 422 that
   * the drawer is supposed to turn into a sentence */
  if (m.type() === 'error' && !m.text().includes('422')) errors.push('console: ' + m.text());
});
pg.on('dialog', (d) => d.accept());

await login(pg);

/* ── a check to put a standard into ─────────────────────────────── */
if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
await pg.waitForSelector('#spec:not([hidden])');
await pg.waitForTimeout(600);
await pg.fill('#proj-title', 'lib-check ' + STAMP);
await pg.waitForTimeout(900);              // the autosave is a network round trip

const standardsBefore = await pg.locator('#standards .art').count();

/* ── the drawer opens ───────────────────────────────────────────── */
ok(await pg.locator('#btn-from-lib').isVisible(), 'a check offers the library beside ＋ standard');
await pg.click('#btn-from-lib');
/* A modal <dialog> is asked about through the page, not through a locator:
 * `[open]` on a dialog that is showing modally does not reliably match. */
const libOpen = () => pg.evaluate(() => !!document.getElementById('lib-dialog')?.open);
ok(await until(libOpen), 'the library opens');
ok(await until(async () => !(await pg.locator('#lib-none').isHidden())
  || (await pg.locator('#lib-list .lib-item').count()) > 0), 'and it says what it holds, or that it holds nothing');

const keptBefore = await pg.locator('#lib-list .lib-item').count();

/* ── a standard is kept ─────────────────────────────────────────── */
await pg.click('#lib-new');
ok(await pg.locator('#lib-edit').isVisible(), 'a new standard gets a form');
await pg.fill('#lib-title', TITLE);
await pg.selectOption('#lib-kind', 'law');
await pg.fill('#lib-text', LAW);
ok((await pg.textContent('#lib-chars')).includes(String(LAW.length.toLocaleString('en')),
  ), 'the form shows how much text it is (' + await pg.textContent('#lib-chars') + ')');
await pg.click('#lib-save');
ok(await until(async () => (await pg.locator('#lib-list .lib-item').count()) === keptBefore + 1),
  'keeping it puts it in the drawer');
ok(await pg.locator('#lib-edit').isHidden(), 'the form steps aside for the list');
const row = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
ok((await row.locator('.line').textContent()).includes('characters'),
  'the row says how many characters it carries');

/* ── nothing has entered the check yet ──────────────────────────── */
ok((await pg.locator('#standards .art').count()) === standardsBefore,
  'keeping it does not put it in the check');

/* ── add copies the text ────────────────────────────────────────── */
await row.hover();
await row.locator('.add').click();
ok(await until(async () => (await pg.locator('#standards .art').count()) === standardsBefore + 1),
  'add copies it into the check as a standard');
ok(await until(async () => !(await libOpen())), 'and closes the drawer');

const added = pg.locator('#standards .art', { hasText: TITLE }).first();
await added.locator('.name').click();
await pg.waitForSelector('#art-dialog[open]');
const copied = await pg.inputValue('#art-text');
ok(copied === LAW, 'the input holds the whole text, not a pointer (' + copied.length + ' chars)');
ok((await pg.textContent('#art-from')).includes('copied from the library'),
  'and says where it came from: ' + (await pg.textContent('#art-from')).slice(0, 60));
await pg.click('#art-x');

/* ── where the words come from: a link ──────────────────────────── */
await pg.click('#btn-from-lib');
await pg.waitForFunction(() => !!document.getElementById('lib-dialog')?.open);
await pg.click('#lib-new');
await pg.fill('#lib-title', 'NN — ' + STAMP);
await pg.fill('#lib-url', 'https://narodne-novine.nn.hr/clanci/sluzbeni/2026.html');
await pg.click('#lib-fetch');
ok(await until(async () => (await pg.inputValue('#lib-text')) === READ, 10000),
  'a link becomes the text of the standard');
ok((await pg.textContent('#lib-src-msg')).includes('read'), 'and the form says how much it read: '
  + (await pg.textContent('#lib-src-msg')).slice(0, 60));
ok((await pg.textContent('#lib-chars')).includes(String(READ.length)),
  'the character count follows the fetch');
await pg.click('#lib-save');
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: 'NN — ' + STAMP }).count()) === 1),
  'the linked standard is kept');
const linked = pg.locator('#lib-list .lib-item', { hasText: 'NN — ' + STAMP }).first();
ok((await linked.textContent()).includes('linked'), 'its row says where it came from');

/* a link off the list is refused with a sentence, not a silence */
await pg.click('#lib-new');
await pg.fill('#lib-title', 'off-list ' + STAMP);
await pg.fill('#lib-url', 'https://example.com/law');
await pg.click('#lib-fetch');
ok(await until(async () => (await pg.textContent('#lib-src-msg')).includes('not on the list'), 10000),
  'a source off the list gets a sentence: ' + (await pg.textContent('#lib-src-msg')).slice(0, 70));
ok((await pg.inputValue('#lib-text')) === '', 'and nothing is pasted in its place');

/* ── and a pdf ─────────────────────────────────────────────────── */
await pg.fill('#lib-title', 'PDF — ' + STAMP);
await pg.setInputFiles('#lib-file', pdfPath);
ok(await until(async () => (await pg.inputValue('#lib-text')).includes('zastiti na radu'), 20000),
  'a pdf becomes text in the drawer');
ok((await pg.textContent('#lib-chars')).includes(String((await pg.inputValue('#lib-text')).length)),
  'the count follows the pdf too');
ok(await until(async () => !(await pg.locator('#lib-file-line').isHidden())), 'the original is kept, and named');
ok((await pg.textContent('#lib-file-line')).includes('.pdf'),
  'the line says which file: ' + (await pg.textContent('#lib-file-line')).slice(0, 60));
await pg.locator('#lib-dialog').screenshot({ path: '/home/vergovic/vixen/.shots/lib-pdf.png' }).catch(() => {});
await pg.click('#lib-save');
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: 'PDF — ' + STAMP }).count()) === 1),
  'a standard from a pdf is kept like any other');
/* and it opens again with its source remembered */
const pdfRow = pg.locator('#lib-list .lib-item', { hasText: 'PDF — ' + STAMP }).first();
await pdfRow.locator('.name').click();
ok(await until(async () => (await pg.locator('#lib-edit').isVisible())), 'the pdf standard opens');
ok((await pg.inputValue('#lib-text')).includes('zastiti na radu'), 'with its text, not a placeholder');
ok(!(await pg.locator('#lib-file-line').isHidden()), 'and its original still attached');
await pg.click('#lib-cancel');

/* put the two test standards out of the way: both to the bin, then both gone */
const MINE = ['NN — ' + STAMP, 'PDF — ' + STAMP];
const binLine = async () => ((await pg.locator('#lib-bin-line').isHidden())
  ? '' : (await pg.textContent('#lib-bin-line')));
const toList = async () => {
  if ((await binLine()).includes('back to the library')) await pg.locator('#lib-bin-line button').click();
  await until(async () => (await pg.locator('#lib-edit').isHidden()));
};
const toBin = async () => {
  if (!(await binLine()).includes('back to the library')) await pg.locator('#lib-bin-line button').click();
  await until(async () => (await pg.locator('#lib-list').isVisible()));
};
for (const name of MINE) {
  if (!(await libOpen())) {
    await pg.click('#btn-from-lib');
    await pg.waitForFunction(() => !!document.getElementById('lib-dialog')?.open);
  }
  await toList();
  const r = pg.locator('#lib-list .lib-item', { hasText: name }).first();
  await r.hover();
  await r.locator('.del').click();
  await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: name }).count()) === 0);
}
await toBin();
for (const name of MINE) {
  const r = pg.locator('#lib-list .lib-item', { hasText: name }).first();
  await r.hover();
  await r.locator('.del').click();
  await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: name }).count()) === 0);
}
await pg.click('#lib-x');

/* ── the drawer's ✕ bins, it does not destroy ───────────────────── */
await pg.click('#btn-from-lib');
await pg.waitForFunction(() => !!document.getElementById('lib-dialog')?.open);
const mine = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await mine.hover();
await mine.locator('.del').click();
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 0),
  'the standard leaves the list');
ok(await until(async () => !(await pg.locator('#lib-bin-line').isHidden())), 'the bin line appears');
ok((await pg.textContent('#lib-bin-line')).includes('in the bin'),
  'and counts what is in it: ' + (await pg.textContent('#lib-bin-line')).trim());

/* ── showing the bin, and taking it back ────────────────────────── */
const showingBin = async () => (await pg.textContent('#lib-bin-line')).includes('back to the library');
await pg.locator('#lib-bin-line button').click();
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 1),
  'the bin lists the standard it took');
const binned = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
ok(await binned.locator('.back').count() === 1, 'with a way back');
await binned.locator('.back').click();
/* one of two things is right, depending on what is left in the bin: the view
 * goes back to the library when the bin is now empty, and stays in the bin (with
 * the row gone) when it is not. Both mean the standard came back. */
ok(await until(async () => {
  const inBin = await showingBin();
  const n = await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count();
  return inBin ? n === 0 : n === 1;
}), 'back takes it out of the bin and into the library');
if (await showingBin()) {
  await pg.locator('#lib-bin-line button').click();
  ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 1),
    'and it is in the library again');
}

/* ── editing a standard does not rewrite the check's copy ───────── */
const back = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await back.locator('.name').click();
await pg.waitForSelector('#lib-edit:not([hidden])');
await pg.fill('#lib-text', LAW + '\n\nDODANO KASNIJE — ovo ne smije ući u već napravljen izvještaj.');
await pg.click('#lib-save');
await pg.waitForTimeout(1500);
await pg.click('#lib-x');
const still = pg.locator('#standards .art', { hasText: TITLE }).first();
await still.locator('.name').click();
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.inputValue('#art-text')) === LAW, 'the copy in the check did not change when the standard did');
await pg.click('#art-x');

/* ── deleting the standard for good leaves the copy alone ───────── */
await pg.click('#btn-from-lib');
await pg.waitForFunction(() => !!document.getElementById('lib-dialog')?.open);
const again = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await again.hover();
await again.locator('.del').click();
await until(async () => !(await pg.locator('#lib-bin-line').isHidden()));
if (!(await showingBin())) await pg.locator('#lib-bin-line button').click();
await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 1);
const doomed = pg.locator('#lib-list .lib-item', { hasText: TITLE }).first();
await doomed.hover();
await doomed.locator('.del').click();
ok(await until(async () => (await pg.locator('#lib-list .lib-item', { hasText: TITLE }).count()) === 0),
  'a second ✕, in the bin, deletes it for good');
await pg.click('#lib-x');

await still.locator('.name').click();
await pg.waitForSelector('#art-dialog[open]');
ok((await pg.inputValue('#art-text')) === LAW, 'the check keeps its words after the standard is gone');
ok((await pg.textContent('#art-from')).includes('no longer there'),
  'and the input says the standard is gone');
await pg.click('#art-x');

/* ── a guest never sees the drawer ──────────────────────────────── */
await pg.click('#btn-share');
await pg.waitForSelector('#share-dialog[open]');
await pg.click('#share-make');
ok(await until(async () => (await pg.inputValue('#share-link')).includes('?s=')), 'a link is made');
const link = await pg.inputValue('#share-link');
await pg.click('#share-x');

const gctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const gp = await gctx.newPage();
gp.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1400);
ok((await gp.inputValue('#proj-title')).includes('lib-check ' + STAMP), 'a guest reads the check');
ok(!(await gp.locator('#btn-from-lib').isVisible()), 'the library is the owner\'s drawer, and the guest has no door to it');
await gctx.close();

/* ── a phone ────────────────────────────────────────────────────── */
await pg.setViewportSize({ width: 390, height: 844 });
await pg.waitForTimeout(500);
const wide = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(wide === 0, 'a phone does not scroll sideways (' + wide + ' px)');
await pg.click('#btn-from-lib').catch(() => {});
await pg.waitForTimeout(700);
const libWide = await pg.evaluate(() => {
  const d = document.querySelector('#lib-dialog');
  return d ? Math.round(d.getBoundingClientRect().width) : 0;
});
ok(libWide === 0 || libWide <= 390, 'the library fits a phone (' + libWide + ' px)');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));

await br.close();
console.log(`\nvc library: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
