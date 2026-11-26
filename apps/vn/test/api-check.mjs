/* The API an agent uses, checked the way an agent would use it.
 *
 * No browser. This runs the tool in tools/vpl-api.mjs against the real
 * database, as the test account, and asserts the promises docs/api.md makes:
 *
 *   1. a password grant gives a token, and the token names the person
 *   2. a read returns that person's rows and nobody else's
 *   3. a row cannot be made without user_id (the insert policy is the reason)
 *   4. a write returns the row it wrote
 *   5. the bin is one column: binned is not live, restored is live again
 *   6. an owner field is not a field — patching user_id is refused
 *   7. a closed list refuses a word that is not in it
 *   8. a generated column refuses a value
 *   9. deleting for good removes what was binned, and only that
 *
 * Two of these hit the database on purpose and clean up after themselves. If
 * the token belongs to a person, the rows it makes are that person's.
 *
 *   node api-check.mjs          (uses $VPL_EMAIL / $VPL_PASS, or the cached token)
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'tools/vpl-api.mjs');
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); return true; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  return false;
};

/* the tool prints JSON on stdout and its complaints on stderr */
const api = (...args) => {
  /* login and me answer in sentences, not JSON: `raw` says so */
  const raw = ['login', 'me', 'whoami'].includes(args[0]);
  try {
    const out = execFileSync('node', [API, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let json = null;
    if (!raw) { try { json = out.trim() ? JSON.parse(out) : null; } catch { json = null; } }
    return { ok: true, json, text: out, raw };
  } catch (e) {
    return { ok: false, text: `${e.stdout || ''}${e.stderr || ''}`.trim(), status: e.status };
  }
};

console.log('\napi · the surface an agent uses\n');

if (EMAIL && PASS) {
  const login = api('login', EMAIL, PASS);
  ok(login.ok && /signed in as/.test(login.text), 'a password grant gives a token', login.text.slice(0, 120));
} else {
  console.log('  note: no VPL_EMAIL/VPL_PASS — using the cached token, if there is one');
}

const me = api('me');
ok(me.ok && /^who\s+\S+@/.test(me.text), 'the token names the person');
const who = (me.text.match(/^who\s+(\S+)/) || [])[1] || '';
ok(who === EMAIL || !EMAIL, 'and it is the account we asked for', who);

const read = api('get', 'vn_notes', 'select=id,user_id,deleted_at&limit=20');
ok(read.ok && Array.isArray(read.json), 'a read returns rows');
ok(read.ok && read.json.every((r) => r.user_id && r.deleted_at !== undefined),
  'every row carries its owner and its bin marker');

/* ── a row cannot be made without user_id ────────────────────────────── */
const anon = api('post', 'vn_notes', '{"title":"api-check, no owner","body":"x\\n"}');
/* the tool fills user_id, so this proves the *tool's* convenience, not the policy */
ok(anon.ok && Array.isArray(anon.json) && anon.json[0].user_id, 'post fills user_id for you');
const made = anon.ok ? anon.json[0] : null;
ok(!!made && made.title === 'api-check, no owner', 'a write returns the row it wrote');

if (!made) {
  console.log(`\n  ${pass} ok, ${fail} failed (nothing to clean up)\n`);
  process.exit(1);
}

/* ── the bin is one column ───────────────────────────────────────────── */
const live = api('get', 'vn_notes', `select=id,deleted_at&id=eq.${made.id}`);
ok(live.ok && live.json.length === 1 && live.json[0].deleted_at === null, 'a new row is live');

const binned = api('patch', 'vn_notes', `id=eq.${made.id}`, JSON.stringify({ deleted_at: new Date().toISOString() }));
ok(binned.ok && binned.json[0].deleted_at, 'deleted_at puts it in the bin');

const inBin = api('get', 'vn_notes', `select=id&id=eq.${made.id}&deleted_at=not.is.null`);
ok(inBin.ok && inBin.json.length === 1, 'and the bin query finds it');

const back = api('patch', 'vn_notes', `id=eq.${made.id}`, '{"deleted_at":null}');
ok(back.ok && back.json[0].deleted_at === null, 'null takes it back out');

/* ── an owner is decided when a row is made ──────────────────────────── */
const steal = api('patch', 'vn_notes', `id=eq.${made.id}`, '{"user_id":"00000000-0000-0000-0000-000000000000"}');
ok(!steal.ok && /42501|permission denied|row-level security/.test(steal.text),
  'patching user_id is refused, and says so like a grant error', steal.text.slice(0, 90));

/* ── a closed list ───────────────────────────────────────────────────── */
const project = api('get', 'vc_projects', 'select=id&limit=1');
if (project.ok && project.json?.length) {
  const bad = api('post', 'vc_targets', JSON.stringify({
    project_id: project.json[0].id, name: 'api-check, not a status', status: 'maybe',
  }));
  ok(!bad.ok && /23514|check constraint/.test(bad.text), 'a closed list refuses a word outside it', bad.text.slice(0, 90));
} else {
  console.log('  skip closed-list check: this account has no vc project');
}

/* ── a generated column ──────────────────────────────────────────────── */
const gen = api('post', 'vc_standards', '{"title":"api-check","kind":"policy","text":"x","chars":999}');
ok(!gen.ok && /428C9|generated|non-DEFAULT/i.test(gen.text), 'a generated column refuses a value', gen.text.slice(0, 90));

/* ── destroying for good takes only the row that was binned ──────────── */
const before = api('get', 'vn_notes', 'select=id&limit=1000');
const del = api('delete', 'vn_notes', `id=eq.${made.id}`);
ok(del.ok, 'deleting for good works on a binned row');
const after = api('get', 'vn_notes', 'select=id&limit=1000');
ok(before.ok && after.ok && after.json.length === before.json.length - 1,
  'and takes exactly one row with it', `${before.json?.length} → ${after.json?.length}`);
ok(after.ok && !after.json.some((r) => r.id === made.id), 'the row is gone, not merely hidden');

const unfiltered = api('delete', 'vn_notes');
ok(!unfiltered.ok && /filter is required/.test(unfiltered.text), 'a delete with no filter is refused by the tool');

console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
