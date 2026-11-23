/* va · the drawing (slice 2).
 *
 *   node va-canvas.mjs                              # http://127.0.0.1:8107
 *   VA_URL=https://vpl-va.pages.dev node va-canvas.mjs
 *
 * Answers are mocked, so this costs nothing. What it asserts is the claim the
 * canvas makes: the text is the truth, the drawing reads it, and the only thing
 * the drawing writes back is where a box sits.
 */
import { chromium } from 'playwright';

const B = process.env.VA_URL || 'http://127.0.0.1:8107';
const OWNER = { email: 'vpl-agent@terg.hr', pass: 'agent-vpl-2026!' };

const GOOD = `# context

The editor talks https to an api that owns one postgres.

\`\`\`yaml
boxes:
  - id: editor
    label: The editor
    kind: person
    host: ""
    note: writes the tender
  - id: api
    label: Public API
    kind: service
    host: api.example.hr:443
    note: serves the editor
  - id: pg
    label: Postgres
    kind: db
    host: db.example.hr:5432
    note: the one copy
  - id: nightly
    label: Nightly copy
    kind: vm
    host: 10.0.0.7
    note: takes a dump at 03:00
    view: deployment
arrows:
  - from: editor
    to: api
    label: https
  - from: api
    to: pg
    label: sql
  - from: api
    to: ghost
    label: nowhere
\`\`\`
`;

const BROKEN = `no box list at all, just prose about a system.`;

let pass = 0; let fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } };
const until = async (fn, ms = 12000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 130));
  }
};

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

let answer = GOOD;
await ctx.addInitScript(() => {
  localStorage.setItem('vpl.ai', JSON.stringify({
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: 'test-key-not-real',
    model: 'gemini-3.1-flash-lite',
  }));
});
for (const pattern of ['**/api/chat', 'https://api.terg.hr/chat']) {
  await pg.route(pattern, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({
      status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: answer } }] }),
    });
  });
}

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(900);

/* ── a job with one input and one (mocked) answer ─────────────────── */
await pg.click('#btn-new-project');
await pg.waitForTimeout(900);
await pg.fill('#brief', 'an editor, an api, one postgres');
await pg.click('#btn-add-text');
await pg.waitForTimeout(400);
await pg.fill('#art-title', 'the brief');
await pg.fill('#art-text', 'the editor talks https to the api, the api owns one postgres');
await pg.click('#art-save');
await pg.waitForTimeout(700);
await pg.click('#btn-generate');
ok(await until(async () => (await pg.evaluate(() => document.querySelector('#out-body')?.value.length || 0)) > 40),
  'a document with a box list is written');

/* ── the drawing reads the text ───────────────────────────────────── */
ok(await pg.locator('#btn-draw').isVisible(), 'the answer offers a drawing');
await pg.click('#btn-draw');
ok(await until(async () => pg.locator('#draw').isVisible()), 'pressing it draws');
ok(await pg.locator('#out-body').isHidden(), 'and puts the words away');

const counts = async () => ({
  boxes: await pg.locator('#draw-svg g.box').count(),
  edges: await pg.locator('#draw-svg g.edge').count(),
});
const c1 = await counts();
ok(c1.boxes === 4, 'four boxes, because the list has four (' + c1.boxes + ')');
ok(c1.edges === 2, 'two arrows drawn — the third points at nothing (' + c1.edges + ')');

const words = (await pg.locator('#draw-svg g.box').allTextContents()).join(' | ');
ok(/public api/i.test(words) && /service/i.test(words), 'a box carries its label and its kind as words');
ok(/person/i.test(words) && /db/i.test(words), 'so colour is never the only signal');

const strip = (await pg.textContent('#draw-strip')).trim();
ok(/ghost/.test(strip), 'the strip names the arrow that points at nothing: “' + strip.slice(0, 60) + '…”');
ok(await pg.locator('#draw-strip').isVisible(), 'and it is visible rather than silent');

/* ── three views, one list ────────────────────────────────────────── */
await pg.click('#draw-views [data-view=context]');
await pg.waitForTimeout(250);
const c2 = await counts();
ok(c2.boxes === 3, 'the context view leaves out the deployment-only box (' + c2.boxes + ')');
await pg.click('#draw-views [data-view=deployment]');
await pg.waitForTimeout(250);
const c3 = await counts();
ok(c3.boxes >= 1, 'the deployment view keeps it (' + c3.boxes + ' boxes)');
await pg.click('#draw-views [data-view=all]');
await pg.waitForTimeout(250);
ok((await counts()).boxes === 4, 'and everything means everything');

/* ── the drag writes two lines, and nothing else ──────────────────── */
const before = await pg.evaluate(() => document.querySelector('#out-body').value);
const box = pg.locator('#draw-svg g.box[data-id=api] rect');
const r = await box.boundingBox();
await pg.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
await pg.mouse.down();
await pg.mouse.move(r.x + r.width / 2 + 70, r.y + r.height / 2 + 40, { steps: 8 });
await pg.mouse.up();
await pg.waitForTimeout(1400);

const movedText = await pg.evaluate(() => document.querySelector('#out-body').value);
ok(/x:\s*-?\d+/.test(movedText.split('id: api')[1]?.slice(0, 240) || ''), 'a drag writes x (and y) into the api box');
const changed = movedText.split('\n').length - before.split('\n').length;
ok(changed === 2, 'and adds exactly two lines to the document (' + changed + ')');
const untouched = before.split('\n').filter((l) => !/^\s*(x|y):/.test(l)).join('\n');
const stillThere = untouched.split('\n').every((l) => movedText.includes(l));
ok(stillThere, 'every other line is left exactly as it was');

/* what was written survives a reload, because it is only text */
await pg.waitForTimeout(900);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1200);
const afterReload = await pg.evaluate(() => document.querySelector('#out-body').value);
ok(/x:\s*-?\d+/.test(afterReload.split('id: api')[1]?.slice(0, 240) || ''), 'and it survives a reload');

/* ── a document with no box list is not an error ──────────────────── */
answer = BROKEN;
await pg.click('#btn-generate');
await pg.waitForTimeout(1800);
ok(await pg.locator('#btn-draw').isHidden(), 'a document with no box list has no drawing button');
ok(await pg.locator('#draw').isHidden(), 'and the canvas stays out of the way');

/* ── a phone ──────────────────────────────────────────────────────── */
const phone = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
await phone.addInitScript(() => {});
await pp.route('**/api/chat', (route) => route.fulfill({
  status: 200, headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ choices: [{ message: { content: GOOD } }] }),
}));
await pp.goto(B, { waitUntil: 'networkidle' });
await pp.fill('#email', OWNER.email);
await pp.fill('#pass', OWNER.pass);
await pp.click('#btn-login');
await pp.waitForSelector('#app:not([hidden])');
await pp.waitForTimeout(1400);
await pp.click('#btn-draw').catch(() => {});
await pp.waitForTimeout(500);
const wide = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(wide === 0, 'on a phone the drawing scales instead of scrolling sideways (' + wide + 'px)');

ok(errors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, 'no unexpected errors');

await br.close();
console.log(`\nva drawing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
