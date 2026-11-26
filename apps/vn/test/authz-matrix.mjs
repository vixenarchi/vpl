/* The authorization grid — six apps, two roles, one guest doing the asking.
 *
 * Found on 2026-11-26 by an agent on another laptop, over the public REST API,
 * the way an ordinary account would use it: no service key, no code read as an
 * authority, every line a measured request and the answer that came back. The
 * seven findings are in docs/security.md; this file is the proof that the
 * answers have not drifted back.
 *
 * Three accounts, because two cannot tell "the owner's editor" from "a
 * stranger": A owns a project, B is given `view` and then `edit`, C is never
 * invited by A and must see nothing.
 *
 *   node authz-matrix.mjs                 # local config, the three test accounts
 *   AUTHZ_OWNER=… AUTHZ_GUEST=… AUTHZ_THIRD=… node authz-matrix.mjs
 *
 * Exit 0 when every dangerous attempt was refused, 1 when one was not, 78 when
 * the accounts are missing — a skip is never a pass.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* the url and the public anon key, the way every other suite in this folder
 * finds them: the app's own config, or the environment */
function config() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON) {
    return { url: process.env.VPL_SUPABASE_URL, anon: process.env.VPL_SUPABASE_ANON };
  }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const s = readFileSync(path.join(dir, '../../vn/config.local.js'), 'utf8');
  return {
    url: s.match(/url:\s*'([^']+)'/)[1],
    anon: s.match(/anon:\s*'([^']+)'/)[1],
  };
}
const { url: URL_, anon: ANON } = config();

const ACCOUNTS = {
  A: { email: process.env.AUTHZ_OWNER || 'xxx123@vpl.local', password: process.env.AUTHZ_OWNER_PASS || 'xxx123' },
  B: { email: process.env.AUTHZ_GUEST || 'yyy123@vpl.local', password: process.env.AUTHZ_GUEST_PASS || 'yyy123' },
  C: { email: process.env.AUTHZ_THIRD || 'zzz123@vpl.local', password: process.env.AUTHZ_THIRD_PASS || 'zzz123' },
};

const APPS = {
  vi: { row: 'vi_ideas', rowBody: { text: 'probe idea' }, content: { text: 'CHANGED BY GUEST' }, tmpl: null },
  vr: { row: 'vr_reqs', rowBody: { statement: 'The probe shall answer.', kind: 'functional', strength: 'must', status: 'draft', pos: 1 }, content: { statement: 'CHANGED BY GUEST' }, tmpl: null },
  vz: { row: 'vz_pairs', rowBody: { key: 'probe_key', value: 'probe value' }, content: { value: 'CHANGED BY GUEST' }, tmpl: null, publish: { published: true } },
  vd: { row: 'vd_artifacts', rowBody: { title: 'probe input', kind: 'note' }, content: { title: 'CHANGED BY GUEST' }, tmpl: 'offer' },
  vc: { row: 'vc_targets', rowBody: { name: 'probe control', status: 'queued', pos: 1 }, content: { name: 'CHANGED BY GUEST' }, counts: { n_pass: 99, n_fail: 0 }, tmpl: 'offer' },
  va: { row: 'va_jobs', rowBody: { template: 'context', task: 'probe task', status: 'queued' }, content: { task: 'CHANGED BY GUEST' }, tmpl: 'context' },
};

const req = async (p, { method = 'GET', body, tok } = {}) => {
  const r = await fetch(URL_ + p, {
    method,
    headers: { apikey: ANON, authorization: 'Bearer ' + tok, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { status: r.status, j, text: t.slice(0, 120) };
};

const auth = async (email, password) => {
  const r = await fetch(URL_ + '/auth/v1/signup', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  let j = await r.json().catch(() => null);
  if (!j?.access_token) {
    const r2 = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    j = await r2.json();
  }
  if (!j?.access_token) throw new Error('no session for ' + email + ': ' + JSON.stringify(j).slice(0, 120));
  return { email, tok: j.access_token, id: j.user.id };
};

/* one attempt, classified: refused = 4xx, or 200 with no row written */
const attempt = async (label, expect, p, opts) => {
  const r = await req(p, opts);
  const rows = Array.isArray(r.j) ? r.j.length : null;
  const applied = r.status < 300 && rows !== 0;
  const noColumn = r.text.includes('PGRST204');
  const verdict = noColumn ? 'n/a (no such column)' : applied ? 'APPLIED' : 'refused';
  const bug = expect === 'blocked' && applied && !noColumn;
  return { label, expect, verdict, status: r.status, bug, detail: bug ? r.text.slice(0, 90) : '' };
};

const [A, B] = await Promise.all([
  auth(ACCOUNTS.A.email, ACCOUNTS.A.password).catch(() => null),
  auth(ACCOUNTS.B.email, ACCOUNTS.B.password).catch(() => null),
]);
if (!A || !B) {
  console.log(`authz-matrix: no session for ${!A ? ACCOUNTS.A.email : ACCOUNTS.B.email}`);
  console.log('  set AUTHZ_OWNER / AUTHZ_GUEST (and their _PASS) to two accounts of this project');
  process.exit(78);           // not configured: skipped, never green
}
console.log(`A (owner) ${A.email} ${A.id.slice(0, 8)}\nB (guest) ${B.email} ${B.id.slice(0, 8)}\n`);

const all = [];
for (const [app, cfg] of Object.entries(APPS)) {
  const proj = await req(`/rest/v1/${app}_projects`, { method: 'POST', tok: A.tok, body: { user_id: A.id, title: `probe ${app}`, ...(cfg.tmpl ? { template: cfg.tmpl } : {}) } });
  if (proj.status >= 300) { console.log(`${app}: cannot create project — ${proj.text}`); continue; }
  const pid = proj.j[0].id;
  const row = await req(`/rest/v1/${cfg.row}`, { method: 'POST', tok: A.tok, body: { user_id: A.id, project_id: pid, ...cfg.rowBody } });
  if (row.status >= 300) { console.log(`${app}: cannot create row — ${row.text}`); continue; }
  const rid = row.j[0].id;

  const grant = async (role) => {
    const mine = await req(`/rest/v1/${app}_shares?select=id&project_id=eq.${pid}&email=eq.${encodeURIComponent(B.email)}`, { tok: A.tok });
    if (mine.j?.length) return req(`/rest/v1/${app}_shares?id=eq.${mine.j[0].id}`, { method: 'PATCH', tok: A.tok, body: { role, pending: false } });
    return req(`/rest/v1/${app}_shares`, { method: 'POST', tok: A.tok, body: { project_id: pid, owner_id: A.id, email: B.email, role, pending: false } });
  };

  /* a real target for "move the row": B's own project. Sending the same id back
   * proves nothing — that was a false BUG in the first run of this file. */
  const bProj = await req(`/rest/v1/${app}_projects`, { method: 'POST', tok: B.tok, body: { user_id: B.id, title: `probe ${app} (guest's own)`, ...(cfg.tmpl ? { template: cfg.tmpl } : {}) } });
  const bPid = bProj.j?.[0]?.id;

  const phase = async (role) => {
    await grant(role);
    const canWrite = role === 'edit';
    const T = (label, expect, p, o) => attempt(label, expect, p, { ...o, tok: B.tok });
    const res = [];
    res.push(await T('read project', 'allowed', `/rest/v1/${app}_projects?select=id,title&id=eq.${pid}`, {}));
    res.push(await T('read row', 'allowed', `/rest/v1/${cfg.row}?select=id&project_id=eq.${pid}`, {}));
    res.push(await T('write row content', canWrite ? 'allowed' : 'blocked', `/rest/v1/${cfg.row}?id=eq.${rid}`, { method: 'PATCH', body: cfg.content }));
    res.push(await T('add a row (content)', canWrite ? 'allowed' : 'blocked', `/rest/v1/${cfg.row}`, { method: 'POST', body: { user_id: B.id, project_id: pid, ...cfg.rowBody } }));
    res.push(await T('rename the project', canWrite ? 'allowed?' : 'blocked', `/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'PATCH', body: { title: 'CHANGED BY GUEST' } }));
    res.push(await T('move row to another project', 'blocked', `/rest/v1/${cfg.row}?id=eq.${rid}`, { method: 'PATCH', body: { project_id: bPid } }));
    res.push(await T('bin the row', 'blocked', `/rest/v1/${cfg.row}?id=eq.${rid}`, { method: 'PATCH', body: { deleted_at: new Date().toISOString() } }));
    res.push(await T('bin the project', 'blocked', `/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'PATCH', body: { deleted_at: new Date().toISOString() } }));
    res.push(await T('steal the project (user_id)', 'blocked', `/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'PATCH', body: { user_id: B.id } }));
    res.push(await T('publish it', 'blocked', `/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'PATCH', body: cfg.publish || { is_public: true } }));
    if (cfg.counts) res.push(await T('inflate the verdict counts', canWrite ? 'allowed?' : 'blocked', `/rest/v1/${cfg.row}?id=eq.${rid}`, { method: 'PATCH', body: cfg.counts }));
    res.push(await T('share it further', 'blocked', `/rest/v1/${app}_shares`, { method: 'POST', body: { project_id: pid, owner_id: B.id, email: `third-${role}-${Math.random().toString(36).slice(2, 7)}@example.com`, role: 'edit', pending: false } }));
    const own = await req(`/rest/v1/${app}_shares?select=id&project_id=eq.${pid}&email=eq.${encodeURIComponent(B.email)}`, { tok: B.tok });
    if (own.j?.length) {
      res.push(await T('raise one\'s own grant', 'blocked', `/rest/v1/${app}_shares?id=eq.${own.j[0].id}`, { method: 'PATCH', body: { role: 'edit', pending: false } }));
      res.push(await T('delete one\'s own grant', 'blocked', `/rest/v1/${app}_shares?id=eq.${own.j[0].id}`, { method: 'DELETE' }));
    }
    res.push(await T('delete the row', 'blocked', `/rest/v1/${cfg.row}?id=eq.${rid}`, { method: 'DELETE' }));
    res.push(await T('delete the project', 'blocked', `/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'DELETE' }));
    return res;
  };

  const viewRes = await phase('view');
  const editRes = await phase('edit');

  /* what the owner sees afterwards, to prove nothing dangerous stuck */
  const after = await req(`/rest/v1/${app}_projects?select=title,deleted_at&id=eq.${pid}`, { tok: A.tok });
  const rowAfter = await req(`/rest/v1/${cfg.row}?select=id,deleted_at&id=eq.${rid}`, { tok: A.tok });

  console.log(`===== ${app} =====`);
  for (const r of viewRes) console.log(`  view  ${r.verdict.padEnd(18)} ${r.label}${r.bug ? '   ← BUG' : ''}`);
  for (const r of editRes) console.log(`  edit  ${r.verdict.padEnd(18)} ${r.label}${r.bug ? '   ← BUG' : ''}`);
  console.log(`  after: title=${JSON.stringify(after.j?.[0]?.title)} binned=${after.j?.[0]?.deleted_at ? 'YES' : 'no'} row=${rowAfter.j?.length ? 'present' : 'GONE'}`);
  all.push({ app, viewRes, editRes });

  /* cleanup: grants, child rows the guest made, then the project */
  const shares = await req(`/rest/v1/${app}_shares?select=id&project_id=eq.${pid}`, { tok: A.tok });
  for (const s of shares.j || []) await req(`/rest/v1/${app}_shares?id=eq.${s.id}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/${cfg.row}?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  if (bPid) {
    await req(`/rest/v1/${cfg.row}?project_id=eq.${bPid}`, { method: 'DELETE', tok: B.tok });
    await req(`/rest/v1/${app}_projects?id=eq.${bPid}`, { method: 'DELETE', tok: B.tok });
  }
}

console.log('\n===== BUGS =====');
const bugs = all.flatMap((a) => [...a.viewRes, ...a.editRes].filter((r) => r.bug).map((r) => `${a.app}: ${r.label} — ${r.status} ${r.detail}`));
console.log(bugs.length ? bugs.join('\n') : 'none in this matrix');
process.exit(bugs.length ? 1 : 0);
