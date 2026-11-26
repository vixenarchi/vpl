/* C2 — an owner is decided when a row is made.
 *
 * The shared editor may rewrite the words of a row they may edit. They may not
 * move the row to themselves: `user_id` (and `project_id`) are refused by a
 * trigger, because `with check` cannot see the column it just overwrote.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const URL = process.env.VD_URL || 'http://127.0.0.1:8104';
let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};

const br = await chromium.launch();
async function signIn(acct) {
  const ctx = await br.newContext();
  const pg = await ctx.newPage();
  await pg.goto(URL, { waitUntil: 'networkidle' });
  await pg.waitForSelector('#gate-form', { timeout: 25000 });
  await pg.fill('#email', acct.email);
  await pg.fill('#pass', acct.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await pg.waitForTimeout(900);
  return pg;
}

const owner = await signIn(OWNER);
const guest = await signIn(GUEST);
const ANON = await owner.evaluate(() => window.__VPL_CONFIG__.anon);
const SUPA = await owner.evaluate(() => window.__VPL_CONFIG__.url);

const made = await owner.evaluate(async (email) => {
  const db = await import('/lib/db.js');
  const p = await db.createProject('owner-guard ' + Date.now());
  const a = await db.addArtifact(p.id, { kind: 'text', title: 'a document', text: 'the words' });
  await db.shareWith(p.id, email, 'edit');
  /* a second desk of the owner's, to try to move the row into */
  const other = await db.createProject('owner-guard other ' + Date.now());
  return { project: p.id, other: other.id, artifact: a.id };
}, process.env.VPL_GUEST_EMAIL);

const out = await guest.evaluate(async ({ project, other, artifact, anon, supa }) => {
  const raw = Object.keys(localStorage).find((k) => k.includes('auth-token'));
  const tok = JSON.parse(localStorage.getItem(raw)).access_token;
  const H = { apikey: anon, authorization: 'Bearer ' + tok, 'content-type': 'application/json',
    prefer: 'return=representation' };
  const base = supa + '/rest/v1/';
  const patch = (body) => fetch(base + 'vd_artifacts?id=eq.' + artifact,
    { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  const me = JSON.parse(atob(tok.split('.')[1])).sub;

  const words = await patch({ text: 'the words, edited by a friend' });
  const steal = await patch({ user_id: me });
  const stealBody = await steal.text();
  const move = await patch({ project_id: other });
  const moveBody = await move.text();
  const after = await (await fetch(base + 'vd_artifacts?select=text,user_id&id=eq.' + artifact, { headers: H })).json();
  return {
    words: words.status,
    steal: steal.status, stealBody: stealBody.slice(0, 160),
    move: move.status, moveBody: moveBody.slice(0, 160),
    after: Array.isArray(after) ? after[0] : after,
    me,
  };
}, { project: made.project, other: made.other, artifact: made.artifact, anon: ANON, supa: SUPA });

check(out.words === 200, 'a shared editor may still rewrite the words', String(out.words));
check(out.steal === 403 || out.steal >= 400, 'a shared editor cannot make the row their own',
  `${out.steal} ${out.stealBody}`);
check(out.move === 403 || out.move >= 400, 'and cannot move it to another document',
  `${out.move} ${out.moveBody}`);
check(out.after && out.after.user_id !== out.me, 'the row still belongs to the person who made it',
  JSON.stringify(out.after));
check(out.after && /edited by a friend/.test(out.after.text || ''), 'the words that were allowed did land');

await owner.evaluate(async (ids) => {
  const db = await import('/lib/db.js');
  for (const id of ids) await db.deleteProject(id).catch(() => null);
}, [made.project, made.other]).catch(() => {});
await br.close();

console.log(`\nowner guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
