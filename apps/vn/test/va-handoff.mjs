/* va — the hand-off, end to end. The desk writes a job, a worker with the
 * agent's own account takes it, and the answer comes back to be kept or
 * dropped. The worker runs --fake, so this proves the wiring without spending
 * a model call; the real model path is the same code with one branch removed.
 *
 *   node va-handoff.mjs                       # http://127.0.0.1:8107
 *   VA_URL=https://va.terg.hr node va-handoff.mjs
 *
 * Needs the agent's slip in ~/.config/vpl/agent.env (VPL_AGENT_EMAIL/PASS).
 */
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { OWNER, GUEST } from './_account.mjs';

const run = promisify(execFile);
const B = process.env.VA_URL || 'http://127.0.0.1:8107';
const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const AGENT = 'eva-agent@vpl.local';
const STAMP = Math.random().toString(36).slice(2, 6);

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); }
};
const errors = [];
async function until(fn, ms = 25000) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function config() {
  const text = readFileSync(join(ROOT, 'apps', 'va', 'config.local.js'), 'utf8');
  const grab = (k) => (text.match(new RegExp(k + ":\\s*'([^']+)'")) || [])[1];
  return { url: grab('url'), anon: grab('anon') };
}

function agentEnv() {
  const p = join(process.env.HOME || '', '.config', 'vpl', 'agent.env');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(900);

/* ── a job with one input, shared with the agent ─────────────────── */
if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
else await pg.click('#btn-new');
await until(async () => (await pg.inputValue('#proj-title')) === 'untitled job');
await pg.fill('#proj-title', 'va-handoff ' + STAMP);
await pg.waitForTimeout(1200);
await pg.click('#btn-add-text');
await pg.waitForSelector('#art-dialog[open]');
await pg.fill('#art-title', 'brief ' + STAMP);
await pg.fill('#art-text', 'One desk for one person. Address va.terg.hr. Nothing else is known.');
await pg.click('#art-save');
await until(async () => (await pg.locator('#artifacts .art').count()) === 1);

await pg.click('#btn-share');
await pg.waitForSelector('#share-dialog[open]');
await pg.fill('#share-email', AGENT);
await pg.selectOption('#share-role', 'edit');
await pg.click('#share-add');
ok(await until(async () => (await pg.locator('#share-list li').count()) >= 1), 'the agent is on the list as an editor');
await pg.click('#share-x');

/* ── hand it over ───────────────────────────────────────────────── */
ok(await pg.locator('#handoff').isVisible(), 'the hand-off strip is there for an editor');
await pg.click('#btn-hand');
ok(await until(async () => (await pg.locator('#jobs .job').count()) === 1), 'the desk wrote a job');
ok((await pg.textContent('#jobs')).includes('waiting'), 'and says it is waiting, in a word');
ok((await pg.textContent('#hand-msg')).includes('handed over'), 'the person is told what happens next');

/* ── the worker, with the agent's own account ──────────────────── */
const cfg = config();
const env = agentEnv();
const jobs = mkdtempSync(join(tmpdir(), 'va-jobs-'));
let workerOut = '';
try {
  const { stdout } = await run(process.execPath, [join(ROOT, 'agent', 'worker.mjs'), '--bucket', '--once', '--fake'], {
    cwd: ROOT,
    env: { ...process.env, ...env, VPL_SUPABASE_URL: cfg.url, VPL_SUPABASE_ANON: cfg.anon,
      VPL_JOBS: jobs, VPL_FAKE: '1', VPL_POLL: '500' },
    timeout: 120000,
  });
  workerOut = stdout;
} catch (e) { workerOut = (e.stdout || '') + (e.stderr || ''); }
ok(/done · \d+ file\(s\) back/.test(workerOut), 'the worker took the job and put files back');
if (!/done/.test(workerOut)) console.log(workerOut.slice(-800));

/* ── the answer comes back to be kept or dropped ───────────────── */
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1500);
/* the desk reopens whatever was last on screen; other runs may have left a
 * project there, so walk back to ours by name rather than trusting the order */
ok(await until(async () => (await pg.locator('#proj-list .proj-row', { hasText: 'va-handoff ' + STAMP }).count()) === 1),
  'our job is in the rail after a reload');
if (!(await pg.locator('#proj-list .proj-row.on', { hasText: STAMP }).count())) {
  await pg.locator('#proj-list .proj-row', { hasText: 'va-handoff ' + STAMP }).locator('.pick').click();
  await pg.waitForTimeout(1200);
}
ok(await until(async () => (await pg.textContent('#jobs')).includes('answered')), 'the desk shows it as answered');
ok((await pg.textContent('#jobs')).includes('boxes.yaml'), 'and names the file the agent wrote');
ok((await pg.textContent('#jobs')).includes('a list the desk can draw'),
  'and says, before you keep it, that the list is drawable');
await pg.click('#jobs .job [data-act="keep"]');
ok(await until(async () => (await pg.locator('#out-versions option').count()) === 2),
  'keeping it puts two papers on the desk: the report and the list');
ok(await until(async () => (await pg.locator('#artifacts .art').count()) === 2), 'its file joins the pile');

/* ── the reverse pull: the list the agent read comes back as a drawing ── */
ok((await pg.textContent('#out-versions')).includes('boxes.yaml'), 'the list is named after the file the agent wrote');
ok(await until(async () => !(await pg.locator('#draw').isHidden())), 'and the desk draws it without being asked');
ok(await until(async () => (await pg.locator('#draw-svg .box').count()) >= 2), 'two boxes, as the file said');
ok((await pg.textContent('#draw-count')).includes('arrows'), 'and counts the arrows');
ok((await pg.inputValue('#out-body')).includes('boxes:'), 'the answer is the yaml itself, editable as always');
/* the report is still there, assumptions and all — walk back to it */
await pg.selectOption('#out-versions', { index: 1 });
await pg.waitForTimeout(500);
ok((await pg.inputValue('#out-body')).includes('[assumption]'),
  'and the agent\'s own words are kept, assumptions and all');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1400);
ok((await pg.locator('#artifacts .art').count()) === 2, 'the pile survives the reload');

/* ── tidy ──────────────────────────────────────────────────────── */
await pg.click('#proj-list .proj-row.on .kill');
await pg.waitForTimeout(1500);
ok(await until(async () => !(await pg.textContent('#proj-list')).includes('va-handoff ' + STAMP)), 'the job is deleted');
ok(errors.length === 0, 'no console or page errors');
if (errors.length) console.log(errors.slice(0, 4).join('\n'));

await br.close();
console.log(`\nva hand-off: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
