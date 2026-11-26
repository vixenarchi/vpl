/* The dock: it knows the note, it answers with text that can go in, and it
 * never grows the page upward.
 *
 *   PORT=8102 VPL_EMAIL=… VPL_PASS=… node dock-check.mjs
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const BASE = `http://127.0.0.1:${PORT}/`;
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;
if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to a test account, e.g.\n' +
    '  VPL_EMAIL=you@example.com VPL_PASS=… node dock-check.mjs');
  process.exit(78);      // not configured: skipped, never green
}

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

/* The model is faked at the door: everything above it — the context, the
 * prompt, the two verbs, the write into the note — is what is being tested. */
const sent = [];
await page.route('**/api/chat', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  sent.push(body);
  const last = (body.messages || []).slice(-1)[0]?.content || '';
  const answer = /prevedi|translate/i.test(last)
    ? 'Prvi odlomak, tvrdnja.'
    : 'Ovo je popravljena rečenica.';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: answer } }] }),
  });
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#pass', PASS);
await page.click('#btn-login');
await page.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await page.waitForTimeout(1200);

const BODY = [
  'Prva rečenica, dovoljno duga da se ima što označiti.',
  '',
  'druga reečenica sa greškom',
  '',
  'treća rečenica na kraju.',
].join('\n');

const id = await page.evaluate(async (body) => {
  const db = await import('/lib/supabase.js');
  const rows = await db.listNotes().catch(() => []);
  for (const n of rows || []) if (/^dock probe/.test(n.title || '')) await db.deleteNote(n.id).catch(() => {});
  const n = await db.createNote({ title: 'dock probe', body });
  return n.id;
}, BODY);

/* a key so the dock talks to the mocked door instead of opening settings */
await page.evaluate(() => {
  localStorage.setItem('vpl.ai', JSON.stringify({
    provider: 'openai', url: 'https://api.example.com/v1', key: 'test-key', model: 'test-model',
  }));
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const q = document.getElementById('q');
  q.value = 'dock probe';
  q.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(400);
await page.locator('#list-items .tree-row button[data-id]').first().click();
await page.waitForTimeout(900);

/* ── the transcript is a layer, not a growing page ────────────────── */
const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

await page.fill('#dock .dock-input', 'popravi drugu rečenicu');
await page.keyboard.press('Enter');
await page.waitForTimeout(900);

const geo = await page.evaluate(() => {
  const log = document.querySelector('#dock .dock-log');
  const line = document.querySelector('#dock .dock-line');
  const thread = document.querySelector('#dock .dock-thread');
  const lr = log.getBoundingClientRect();
  const lir = line.getBoundingClientRect();
  return {
    open: !log.hidden,
    layer: Math.abs(lr.bottom - lir.top) < 2,        // sits exactly on the line
    threadH: Math.round(thread.getBoundingClientRect().height),
    page: document.documentElement.scrollHeight,
    rows: document.querySelectorAll('#dock .dock-row').length,
    dockH: Math.round(document.getElementById('dock').getBoundingClientRect().height),
  };
});
check(geo.open, 'the transcript opens when you ask');
check(geo.layer, 'the transcript is a layer above the line, not part of the column');
check(geo.threadH <= 112, 'it holds about three rows and scrolls inside itself', `${geo.threadH}px`);
check(geo.page === heightBefore, 'asking does not grow the page upward',
  `${heightBefore} → ${geo.page}`);
check(geo.dockH <= 60, 'the dock keeps its one-line height while open', `${geo.dockH}px`);

/* ── it is given the note, and it is told to answer with text ─────── */
const prompt = sent[0]?.messages || [];
const system = prompt[0]?.content || '';
const user = prompt.slice(-1)[0]?.content || '';
check(/dock probe/.test(user) && /druga reečenica sa greškom/.test(user),
  'the note is what the model is given');
check(/only the new text/i.test(system), 'the model is told to answer with the changed text only',
  system.slice(0, 80));

/* ── use it: no selection, the answer goes in at the caret ────────── */
const useLabel = await page.textContent('#dock [data-use]');
check(useLabel.trim() === 'use it', 'with nothing selected the button says "use it"', useLabel);

await page.click('#dock [data-use]');
await page.waitForTimeout(1400);
const inserted = await page.evaluate(async () => {
  const db = await import('/lib/supabase.js');
  const rows = await db.listNotes();
  const n = rows.find((r) => /^dock probe/.test(r.title || ''));
  const full = await db.getNote(n.id);
  return full.body;
});
check(/Ovo je popravljena rečenica\./.test(inserted), 'the answer is in the note, and saved');
check(/druga reečenica sa greškom/.test(inserted),
  'and it was added, not silently swapped for anything');

/* ── replace selection ───────────────────────────────────────────── */
await page.evaluate(() => {
  const ed = document.getElementById('editable');
  const p = [...ed.querySelectorAll('p')].find((x) => /druga reečenica/.test(x.textContent));
  const r = document.createRange();
  r.selectNodeContents(p);
  const s = document.getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.fill('#dock .dock-input', 'popravi ovo');
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);

const withSelection = sent.slice(-1)[0]?.messages || [];
check(/They selected exactly this/.test(withSelection.slice(-1)[0]?.content || ''),
  'the selection is sent as the thing that would be replaced');

const replaceLabel = await page.textContent('#dock [data-use]');
check(replaceLabel.trim() === 'replace selection',
  'with words selected the button says what it does', replaceLabel);

await page.click('#dock [data-use]');
await page.waitForTimeout(1400);
const replaced = await page.evaluate(async () => {
  const db = await import('/lib/supabase.js');
  const rows = await db.listNotes();
  const n = rows.find((r) => /^dock probe/.test(r.title || ''));
  const full = await db.getNote(n.id);
  return full.body;
});
check(!/druga reečenica sa greškom/.test(replaced), 'the selected words are gone', replaced.slice(0, 80));
check(/Prva rečenica/.test(replaced) && /treća rečenica/.test(replaced),
  'and the neighbours are untouched');
const count = (replaced.match(/Ovo je popravljena rečenica\./g) || []).length;
check(count >= 1, 'the replacement is in the note', String(count));

/* ── a short memory: "shorter still" has a subject ────────────────── */
await page.fill('#dock .dock-input', 'prevedi prvu');
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
const second = sent.slice(-1)[0]?.messages || [];
check(second.filter((m) => m.role === 'assistant').length >= 1,
  'the next question carries the previous answer, so "shorter still" means something');

/* ── the transcript closes and takes nothing with it ──────────────── */
await page.click('#dock [data-a=hide]');
await page.waitForTimeout(300);
const closed = await page.evaluate(() => ({
  log: document.querySelector('#dock .dock-log').hidden,
  dockH: Math.round(document.getElementById('dock').getBoundingClientRect().height),
  page: document.documentElement.scrollHeight,
}));
check(closed.log, 'the transcript folds away');
check(closed.dockH <= 60, 'and the dock returns to one line', `${closed.dockH}px`);

/* ── the settings dialog keeps one height ─────────────────────────── */
await page.click('#btn-ai');
await page.waitForTimeout(500);
const heights = {};
for (const t of ['model', 'search', 'key', 'theme']) {
  await page.click(`#ai-dialog [data-tab="${t}"]`);
  await page.waitForTimeout(250);
  heights[t] = Math.round((await page.evaluate(() =>
    document.getElementById('ai-dialog').getBoundingClientRect().height)));
}
const vals = Object.values(heights);
check(new Set(vals).size === 1,
  'the settings dialog is the same size on every tab — it is measured, not guessed',
  JSON.stringify(heights));
await page.keyboard.press('Escape');

await page.evaluate(async (probe) => {
  const db = await import('/lib/supabase.js');
  await db.deleteNote(probe).catch(() => {});
}, id).catch(() => {});

check(errors.length === 0, 'no page errors', errors.join(' | '));

console.log(`\n${pass}/${pass + fail} dock checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
