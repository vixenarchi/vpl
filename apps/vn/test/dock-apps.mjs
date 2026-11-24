/* The dock in the apps that write documents: it is given what is on the desk,
 * and *use it* puts the words in that document, saved.
 *
 *   APP=vd PORT=8104 VPL_EMAIL=… VPL_PASS=… node dock-apps.mjs
 *   APP=vc PORT=8105 …   APP=va PORT=8107 …
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const APP = process.env.APP || 'vd';
const BASE = `http://127.0.0.1:${PORT}/`;
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;
if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to a test account, e.g.\n' +
    '  APP=vd PORT=8104 VPL_EMAIL=you@example.com VPL_PASS=… node dock-apps.mjs');
  process.exit(1);
}
if (!['vd', 'vc', 'va'].includes(APP)) {
  console.log('APP must be vd, vc or va');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const sent = [];
await page.route('**/api/chat', async (route) => {
  sent.push(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: 'DODANO IZ DOCKA' } }] }),
  });
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#pass', PASS);
await page.click('#btn-login');
await page.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await page.waitForTimeout(1200);

const TITLE = `dock ${APP} probe`;
const made = await page.evaluate(async ({ app, title }) => {
  const db = await import('/lib/db.js');
  const jobs = await db.listProjects();
  for (const j of jobs || []) {
    if ((j.title || '') === title) await db.deleteProject(j.id).catch(() => {});
  }
  const job = await db.createProject(title, 'offer');
  const out = await db.addOutput(job.id, {
    id: null, run_id: null, kind: 'doc', title: 'the document',
    body: 'Prvi odlomak dokumenta.\n\nDrugi odlomak.\n',
  });
  return { job: job.id, out: out.id };
}, { app: APP, title: TITLE });

await page.evaluate(() => {
  localStorage.setItem('vpl.ai', JSON.stringify({
    provider: 'openai', url: 'https://api.example.com/v1', key: 'test-key', model: 'test-model',
  }));
});

/* the job opens from the rail, like a person opens it */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.getByText(TITLE, { exact: false }).first().click();
await page.waitForTimeout(1400);

const onDesk = await page.locator('#out-body').isVisible().catch(() => false);
check(onDesk, 'the job opens with its document on the desk');

/* the desk is the context, and the answer is meant for it */
await page.click('#out-body');
await page.keyboard.press('Control+End');
await page.fill('#dock .dock-input', 'dodaj rečenicu');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);

const brief = sent[0]?.messages?.slice(-1)[0]?.content || '';
check(/Prvi odlomak dokumenta/.test(brief), 'the model is given the document, not the page chrome',
  brief.slice(0, 80));
check(/only the new text/i.test(sent[0]?.messages?.[0]?.content || ''),
  'and is told to answer with the text itself');

const label = (await page.textContent('#dock [data-use]')).trim();
check(label === 'use it', 'the button says what it will do', label);

await page.click('#dock [data-use]');
await page.waitForTimeout(1600);

const saved = await page.evaluate(async ({ outId, projectId }) => {
  const db = await import('/lib/db.js');
  const rows = await db.listOutputs(projectId);
  const row = (rows || []).find((r) => r.id === outId);
  return { body: (row && row.body) || '', field: document.getElementById('out-body').value };
}, { outId: made.out, projectId: made.job }).catch(() => ({ body: '', field: '' }));

check(/DODANO IZ DOCKA/.test(saved.field), 'the answer is in the document on the screen');
check(/DODANO IZ DOCKA/.test(saved.body), 'and it is saved, not only typed',
  JSON.stringify(saved.body || '').slice(0, 80));
check(/Prvi odlomak dokumenta/.test(saved.body), 'the document kept what it had');

/* tidying up after the probe */
await page.evaluate(async (jobId) => {
  const db = await import('/lib/db.js');
  await db.deleteProject(jobId).catch(() => {});
  localStorage.removeItem('vpl.ai');
}, made.job).catch(() => {});

check(errors.length === 0, 'no page errors', errors.join(' | '));

console.log(`\n${pass}/${pass + fail} ${APP} dock checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
