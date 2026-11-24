/* settings — one dialog, every app. Run it against any of them:
 *
 *   node settings-check.mjs                      # http://127.0.0.1:8107
 *   APP_URL=http://127.0.0.1:8100 node settings-check.mjs
 *
 * What it proves: the four tabs exist and switch, a save reaches localStorage,
 * forget clears both keys, the theme is applied and survives a reload, the test
 * button really calls the model door, and the key tab is honest about sign-in.
 * The door is mocked, so nothing is spent and no provider is touched.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.APP_URL || process.env.VA_URL || 'http://127.0.0.1:8107';
const NAME = process.env.APP_NAME || 'this app';

let pass = 0; let fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } };
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
};

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

/* The model door, mocked at the app's own origin so the test is free. */
let sawBody = null;
await pg.route('**/api/chat', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
  try { sawBody = JSON.parse(req.postData() || '{}'); } catch { sawBody = null; }
  return route.fulfill({
    status: 200, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
  });
});
await pg.route('https://api.terg.hr/chat', async (route) => route.fulfill({
  status: 200, headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
}));

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(800);

/* ── it opens, and it is the same dialog ─────────────────────────── */
await pg.click('#btn-ai');
ok(await until(async () => pg.locator('#ai-dialog[open]').isVisible()), NAME + ': settings opens');
const tabs = await pg.locator('#ai-dialog [role=tab]').allTextContents();
ok(tabs.join(',') === 'model,search,key,theme', 'four tabs, in one order: ' + tabs.join(','));

/* ── the form is tight, not an essay ─────────────────────────────── */
const size = await pg.evaluate(() => {
  const el = document.querySelector('#ai-dialog .set-row input');
  const cs = getComputedStyle(el);
  const note = getComputedStyle(document.querySelector('#ai-dialog .set-note'));
  return { font: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight), note: parseFloat(note.fontSize) };
});
ok(size.font <= 13, 'inputs are small (' + size.font + 'px)');
ok(size.line <= 18, 'lines are tight (' + size.line + 'px)');
ok(size.note <= 12, 'notes are smaller than the fields (' + size.note + 'px)');
const centred = await pg.evaluate(() => [...document.querySelectorAll('#ai-dialog input, #ai-dialog select, #ai-dialog .set-row label')]
  .some((el) => getComputedStyle(el).textAlign === 'center'));
ok(!centred, 'nothing typed is centred');

/* ── tabs switch, panels follow ──────────────────────────────────── */
await pg.click('#ai-dialog [data-tab=theme]');
ok(await pg.locator('#ai-dialog [data-panel=theme]').isVisible(), 'the theme tab shows the theme panel');
ok(!(await pg.locator('#ai-dialog [data-panel=model]').isVisible()), 'and hides the model panel');

/* ── a theme is applied and remembered ──────────────────────────── */
await pg.click('#ai-dialog .set-theme[data-theme=vi]');
ok((await pg.evaluate(() => document.documentElement.dataset.theme)) === 'vi', 'comic applies at once');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(900);
ok((await pg.evaluate(() => document.documentElement.dataset.theme)) === 'vi', 'and survives a reload');
await pg.click('#btn-ai');
await until(async () => pg.locator('#ai-dialog[open]').isVisible());
await pg.click('#ai-dialog [data-tab=theme]');
await pg.click('#ai-dialog .set-theme[data-theme=light]');
ok(!(await pg.evaluate(() => document.documentElement.dataset.theme)), 'paper puts the default back');

/* ── save writes what a person typed ────────────────────────────── */
await pg.click('#ai-dialog [data-tab=model]');
await pg.fill('#set-url', 'https://api.openai.com/v1');
await pg.fill('#set-model', 'gpt-4o-mini');
await pg.fill('#set-key', 'sk-test-123');
await pg.click('#ai-dialog [data-a=save]');
ok(await until(async () => (await pg.textContent('.set-msg')).includes('saved')), 'save says it saved');
const stored = await pg.evaluate(() => JSON.parse(localStorage.getItem('vpl.ai') || '{}'));
ok(stored.key === 'sk-test-123' && stored.model === 'gpt-4o-mini', 'the key and model are in this browser');
await pg.click('#ai-dialog [data-tab=search]');
await pg.selectOption('#set-search', 'tavily');
await pg.fill('#set-search-key', 'tvly-test');
await pg.click('#ai-dialog [data-a=save]');
const search = await pg.evaluate(() => JSON.parse(localStorage.getItem('vpl.search') || '{}'));
ok(search.provider === 'tavily' && search.key === 'tvly-test', 'search provider and key are saved too');

/* ── test is a real call through this app's door ────────────────── */
await pg.click('#ai-dialog [data-a=test]');
ok(await until(async () => (await pg.textContent('.set-msg')).startsWith('it answered')), 'test asks the model and reports the answer');
ok(sawBody && sawBody.messages && sawBody.max_tokens <= 32, 'the test sent a tiny real request');
ok(String(sawBody.url || '').endsWith('/chat/completions'), 'and used the address that was typed');

/* ── the key tab is honest about who is signed in ───────────────── */
await pg.click('#ai-dialog [data-tab=key]');
ok(await until(async () => !(await pg.textContent('#set-acc-line')).includes('sign in and one key')), 'signed in: the account tab offers to save, not to sign in');

/* ── forget clears this browser and leaves the account alone ────── */
await pg.click('#ai-dialog [data-a=forget]');
const after = await pg.evaluate(() => ({
  ai: localStorage.getItem('vpl.ai'), search: localStorage.getItem('vpl.search'),
}));
ok(after.ai === null && after.search === null, 'forget empties both keys in this browser');
ok((await pg.textContent('.set-msg')).includes('forgotten'), 'and says so');

/* ── the dialog closes like a dialog ───────────────────────────── */
await pg.click('#ai-dialog [data-a=close]');
ok(!(await pg.locator('#ai-dialog[open]').count()), 'the close button closes it');

ok(errors.filter((e) => !/401|Incorrect API key|Failed to load resource/.test(e)).length === 0, 'no unexpected console or page errors');
if (errors.length) console.log('   (' + errors.length + ' expected noise: ' + errors.slice(0, 2).join(' | ').slice(0, 160) + ')');

await br.close();
console.log(`\nsettings (${NAME}): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
