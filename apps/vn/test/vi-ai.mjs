/* vi — the balloon and the evidence, without spending a model call.
 *
 * The model is mocked by a route, so the whole real code path runs (fetch ->
 * balloon -> "use it" -> database) but the answer is ours. Search is live: it
 * needs a key in VPL_SEARCH_KEY and VPL_SEARCH_PROVIDER (tavily by default).
 *
 *   VPL_SEARCH_KEY=tvly-… node vi-ai.mjs
 */
import { chromium } from 'playwright';

const B = process.env.VI_URL || 'http://127.0.0.1:8100';
const KEY = process.env.VPL_SEARCH_KEY || '';
const PROV = process.env.VPL_SEARCH_PROVIDER || 'tavily';

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', (e) => console.log('  log ' + e.message));

// canned model answers, one per stage, served by the real /api/chat route
const canned = [
  '1. Roof inspection reports as a photo-to-PDF pack\n2. Warranty claims log shared with the client\n3. Quote builder from a roof measurement\n4. Crew scheduling across three sites\n5. Material leftovers marketplace',
  'customer: roofing firms of 20-80 people in Croatia and Austria\nproblem: quotes live in Excel and nobody knows the margin\nsize: about 1 900 firms, [assumption] 15 % would pay 200 EUR a month\nproves it: five firms hand over one real quote to rebuild',
];
let call = 0;
await pg.route('**/api/chat', async (route) => {
  const content = canned[Math.min(call++, canned.length - 1)];
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'X-Vpl-Proxy': '1' },
    body: JSON.stringify({ choices: [{ message: { content } }] }),
  });
});

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.evaluate(([k, p]) => {
  localStorage.setItem('vpl.ai', JSON.stringify({ url: 'https://api.openai.com/v1', key: 'test-only', model: 'gpt-4o-mini' }));
  localStorage.setItem('vpl.search', JSON.stringify({ provider: p, key: k }));
}, [KEY, PROV]);

await pg.fill('#email', 'vpl-agent@terg.hr');
await pg.fill('#pass', 'agent-vpl-2026!');
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(700);
await pg.click('#btn-new-project');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'vi-ai test');
await pg.press('#proj-title', 'Enter');
await pg.waitForTimeout(500);

// ── the balloon: ideas are proposed, not inserted
await pg.click('#notes-ai');
await pg.waitForSelector('.panel[data-stage="ideation"] .bubble', { timeout: 15000 });
ok((await pg.locator('.note').count()) === 0, 'nothing hits the wall before you agree');
const bt = await pg.textContent('.panel[data-stage="ideation"] .bubble-text');
ok((bt.match(/\n/g) || []).length >= 3, 'the balloon lists the ideas');
await pg.click('.panel[data-stage="ideation"] .bubble-act button.primary');
await pg.waitForTimeout(1500);
ok((await pg.locator('.note').count()) === 5, 'taking the balloon puts five notes on the wall');
ok((await pg.locator('.bubble').count()) === 0, 'the balloon leaves when it is used');

// ── the balloon can be dropped
await pg.click('#notes-ai');
await pg.waitForSelector('.panel[data-stage="ideation"] .bubble');
await pg.click('.panel[data-stage="ideation"] .bubble-act button.ghost');
ok((await pg.locator('.panel[data-stage="ideation"] .bubble').count()) === 0, 'drop closes it and changes nothing');
ok((await pg.locator('.note').count()) === 5, 'still five notes');

// ── explore: search finds facts with sources
await pg.click('.note .go >> nth=0');
await pg.waitForTimeout(400);
await pg.click('#explore-search');
await pg.waitForSelector('.panel[data-stage="exploration"] .bubble .bubble-src', { timeout: 25000 });
const links = await pg.locator('.panel[data-stage="exploration"] .bubble-src').count();
ok(links >= 1, `search returned ${links} source link(s)`);
await pg.click('.panel[data-stage="exploration"] .bubble-act button.primary');
await pg.waitForTimeout(400);
ok((await pg.inputValue('#explore-text')).includes('http') === false && (await pg.inputValue('#explore-text')).length > 30,
   'facts land as text in the draft');

// ── explore: the model sketches, the person takes it
await pg.click('#explore-ai');
await pg.waitForSelector('.panel[data-stage="exploration"] .bubble');
ok((await pg.textContent('.panel[data-stage="exploration"] .bubble-text')).includes('customer:'), 'the sketch names a customer');
await pg.click('.panel[data-stage="exploration"] .bubble-act button.primary');
await pg.waitForTimeout(300);
ok((await pg.inputValue('#explore-text')).includes('customer:'), 'draft accepted');

await pg.screenshot({ path: '/tmp/vi-balloon.png' });
await pg.click('#btn-theme');
await pg.waitForTimeout(400);
await pg.screenshot({ path: '/tmp/vi-dark2.png' });

// tidy up after itself: the test owns one project and deletes it
pg.on('dialog', (d) => d.accept());
await pg.click('.proj-row.on .kill');
await pg.waitForTimeout(1200);
ok((await pg.inputValue('#proj-title').catch(() => '')) !== 'vi-ai test', 'the test project was deleted again');

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
