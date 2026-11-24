/* One real hand-off: the desk writes a job, the worker in the workshop takes it
 * with a vp key and a real model, and the desk shows what came back. Setup and
 * teardown only — the worker runs in another process, which is the point. */
import { chromium } from 'playwright';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { OWNER, GUEST } from './_account.mjs';

const run = promisify(execFile);
const B = process.env.VA_URL || 'https://vpl-va.pages.dev';
const ROOT = '/home/vergovic/vpl';
const AGENT = 'eva-agent@vpl.local';
const STAMP = Math.random().toString(36).slice(2, 6);

const text = readFileSync(join(ROOT, 'apps', 'va', 'config.local.js'), 'utf8');
const grab = (k) => (text.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1];
const env = {};
for (const line of readFileSync(join(process.env.HOME, '.config', 'vpl', 'agent.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
pg.on('dialog', (d) => d.accept());
pg.on('pageerror', (e) => console.log('pageerror:', e.message));
await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(900);

if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
else await pg.click('#btn-new-project');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'real hand-off ' + STAMP);
await pg.waitForTimeout(1200);
await pg.click('#btn-add-text');
await pg.waitForSelector('#art-dialog[open]');
await pg.fill('#art-title', 'brief ' + STAMP);
await pg.fill('#art-text',
  'One desk for one person at va.terg.hr: a static page, Supabase for accounts and rows, '
  + 'no other moving parts. Say in one sentence what the system is and what crosses its boundary.');
await pg.click('#art-save');
await pg.waitForTimeout(800);
await pg.click('#btn-share');
await pg.waitForSelector('#share-dialog[open]');
await pg.fill('#share-email', AGENT);
await pg.selectOption('#share-role', 'edit');
await pg.click('#share-add');
await pg.waitForTimeout(900);
await pg.click('#share-x');
await pg.selectOption('#template', 'context');
await pg.waitForTimeout(500);
await pg.click('#btn-hand');
await pg.waitForTimeout(1500);
console.log('handed over:', (await pg.textContent('#hand-msg')).trim());

const log = '/tmp/va-real.log';
const out = openSync(log, 'w');
const child = spawn(process.execPath, [join(ROOT, 'agent', 'worker.mjs'), '--bucket', '--once'], {
  cwd: ROOT,
  env: { ...process.env, ...env, VPL_SUPABASE_URL: grab('url'), VPL_SUPABASE_ANON: grab('anon'),
    VPL_JOBS: '/tmp/va-real-jobs', VPL_POLL: '1000' },
  stdio: ['ignore', out, out],
  detached: true,
});
child.unref();
console.log('worker pid', child.pid, 'log', log);

const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 9 * 60 * 1000) {
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  const txt = await pg.textContent('#jobs');
  if (txt.includes('answered') || txt.includes('gave up')) { done = true; break; }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log('settled:', done, ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log('strip:', (await pg.textContent('#jobs')).replace(/\s+/g, ' ').slice(0, 200));
await pg.screenshot({ path: '/home/vergovic/vixen/.shots/va-handoff-real.png', fullPage: false });
if (done) {
  await pg.click('#jobs .job [data-act="keep"]');
  await pg.waitForTimeout(1200);
  const body = await pg.inputValue('#out-body');
  console.log('kept, first lines:\n' + body.split('\n').slice(0, 8).join('\n'));
}
await pg.click('#proj-list .proj-row.on .kill');
await pg.waitForTimeout(1500);
console.log('tidy:', !(await pg.textContent('#proj-list')).includes('real hand-off ' + STAMP));
await br.close();
