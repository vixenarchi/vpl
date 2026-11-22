/* vr — the model proposes, the person presses use it.
 *
 *   VR_URL=http://127.0.0.1:8101 node vr-ai.mjs
 *
 * The model is faked at the proxy, so this tests the app's manners: nothing
 * lands in the sheet until a button is pressed, the answer is read rather than
 * parsed as JSON, and the no-key hint tells the truth.
 */
import { chromium } from 'playwright';

const B = process.env.VR_URL || 'http://127.0.0.1:8101';
let pass = 0, fail = 0;
const until = async (fn, ms = 8000, step = 150) => {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};
const ok = (cond, what) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

const REVIEW = [
  'Here is what I would change.',
  'VR-001 | verification | a two-winter test in the garden | the only proof that matters',
  'VR-002 | strength | optional | nobody would block on it',
].join('\n');
const DRAFT = [
  'The hut shall have a floor 5 cm above the ground. | must | the hut',
  'The hut could have one window facing the sun. | wish | the hut',
].join('\n');
const GLOSSARY = 'damp course | a strip that stops water rising through the wall.';

let proxyCalls = 0;
function answer(body) {
  const text = JSON.stringify(body.messages || body);
  const content = /Turn it into requirements/.test(text) ? DRAFT
    : /Name the words/.test(text) ? GLOSSARY
    : REVIEW;
  return JSON.stringify({ choices: [{ message: { content } }] });
}

const br = await chromium.launch();

/* ── no key: the sheet says so instead of failing on click ─────────── */
{
  const ctx = await br.newContext();
  const pg = await ctx.newPage();
  await pg.goto(B, { waitUntil: 'networkidle' });
  await pg.fill('#email', 'vpl-agent@terg.hr');
  await pg.fill('#pass', 'agent-vpl-2026!');
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(1500);
  ok(await pg.locator('#ai-hint').isVisible(), 'without a key the hint is visible');
  await pg.click('#ai-hint-open');
  await pg.waitForTimeout(300);
  ok(await pg.locator('#ai-dialog').isVisible(), 'the hint opens the settings');
  await pg.fill('#ai-key', 'sk-test');
  await pg.selectOption('#ai-provider', 'openai');
  await pg.waitForTimeout(200);
  await pg.click('#ai-save');
  await pg.waitForTimeout(400);
  ok(await pg.locator('#ai-hint').isHidden(), 'the hint goes away once a key exists');
  await ctx.close();
}

/* ── with a model, on a fake proxy ────────────────────────────────── */
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('vpl.ai', JSON.stringify({
    url: 'https://api.openai.com/v1', key: 'sk-test', model: 'gpt-4o-mini',
  }));
});
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('dialog', (d) => d.accept());
// nothing on our own origin answers /api/chat when serving statically
await pg.route('**/api/chat', (r) => r.fulfill({ status: 404, body: 'no function here' }));
await pg.route('https://api.terg.hr/chat', async (r) => {
  proxyCalls++;
  const body = JSON.parse(r.request().postData() || '{}');
  await r.fulfill({ status: 200, contentType: 'application/json', body: answer(body) });
});

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', 'vpl-agent@terg.hr');
await pg.fill('#pass', 'agent-vpl-2026!');
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1500);
await pg.click('#btn-new-project');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'vr-ai test');
await pg.waitForTimeout(800);

for (const s of ['The roof shall keep the rain out.', 'The hut shall be built in one weekend.']) {
  await pg.fill('#req-add', s);
  await pg.press('#req-add', 'Enter');
  await pg.waitForTimeout(700);
}

// ── the review
await pg.click('#btn-review');
await pg.waitForTimeout(1200);
ok(proxyCalls === 1, 'the call went through the shared proxy');
ok(await pg.locator('#review-dialog').isVisible(), 'the reading opens as a list');
ok((await pg.locator('#review-list li').count()) === 2, 'two proposals, one per line');
ok((await pg.textContent('#review-list')).includes('a two-winter test'), 'the why is kept next to the value');

// before pressing anything, the sheet is untouched
await pg.click('#review-x');
await pg.waitForTimeout(300);
ok(!(await pg.textContent('#rows')).includes('two-winter'), 'closing the dialog changes nothing');

await pg.click('#btn-review');
await pg.waitForTimeout(1200);
await pg.locator('#review-list li button[data-use]').first().click();
await pg.waitForTimeout(1200);
await pg.click('#review-x');
await pg.waitForTimeout(300);
ok((await pg.locator('#rows').textContent()).includes('a two-winter test in the garden'), 'use it writes the row');
await pg.click('#btn-columns');
await pg.waitForTimeout(300);
ok((await pg.locator('#rows').textContent()).includes('the only proof that matters') === false, 'the why is not written anywhere');
ok((await pg.locator('#rows').textContent()).includes('a two-winter test in the garden'), 'the proof is visible in its column');

await pg.click('#btn-review');
await pg.waitForTimeout(1200);
await pg.click('#review-all');
await pg.waitForTimeout(1400);
ok(await until(async () => (await pg.textContent('#proj-meta')).includes('optional'), 6000),
  'use all moved the second row to optional: ' + (await pg.textContent('#proj-meta')));

// ── draft from the brief
await pg.click('#brief summary');
await pg.waitForTimeout(300);
await pg.fill('#brief-text', 'A hut for one medium dog, built by three children in a weekend.');
await pg.click('#brief-ai');
await pg.waitForTimeout(1200);
ok(await pg.locator('#review-dialog').isVisible(), 'drafting opens the same kind of list');
ok((await pg.locator('#review-list li').count()) === 2, 'two drafted rows');
await pg.click('#review-all');
await pg.waitForTimeout(1400);
ok((await pg.locator('#rows tr[data-id]').count()) === 4, 'both drafted rows are in the sheet');
ok((await pg.textContent('#rows')).includes('one window facing the sun'), 'and they say what the model proposed');

// ── the glossary proposes words
await pg.click('#btn-glossary');
await pg.waitForTimeout(300);
await pg.click('#term-suggest');
await pg.waitForTimeout(1200);
ok(await pg.locator('#review-dialog').isVisible(), 'a word arrives as a proposal too');
ok((await pg.textContent('#review-list')).includes('damp course'), 'the word is named');
await pg.click('#review-all');
await pg.waitForTimeout(1200);
ok((await pg.locator('#term-list li').count()) === 1, 'use it puts the word in the glossary');
ok((await pg.inputValue('#term-list li input')).includes('stops water'), 'with its meaning');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));

await pg.click('#glossary-x');
await pg.waitForTimeout(200);
await pg.locator('.proj-row.on .kill').click();
await pg.waitForTimeout(1200);

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
