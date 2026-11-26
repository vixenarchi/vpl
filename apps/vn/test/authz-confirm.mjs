/* One clean proof per finding, with a third account.
 *
 * The grid (`authz-matrix.mjs`) walks every cell; this walks the seven bugs on
 * their own, so a regression says which one came back. Each case prints
 * CONFIRMED when the hole is open and "not reproduced" when it is shut; the exit
 * code is 1 if any hole is open, 0 if all are shut, 78 if the accounts are absent.
 *
 *   node authz-confirm.mjs
 *   AUTHZ_OWNER=… AUTHZ_GUEST=… AUTHZ_THIRD=… VPL_SUPABASE_URL=… VPL_SUPABASE_ANON=… node authz-confirm.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function config() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON) {
    return { url: process.env.VPL_SUPABASE_URL, anon: process.env.VPL_SUPABASE_ANON };
  }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const s = readFileSync(path.join(dir, '../../vn/config.local.js'), 'utf8');
  return { url: s.match(/url:\s*'([^']+)'/)[1], anon: s.match(/anon:\s*'([^']+)'/)[1] };
}
const { url: U, anon: K } = config();
const ACC = {
  A: [process.env.AUTHZ_OWNER || 'xxx123@vpl.local', process.env.AUTHZ_OWNER_PASS || 'xxx123'],
  B: [process.env.AUTHZ_GUEST || 'yyy123@vpl.local', process.env.AUTHZ_GUEST_PASS || 'yyy123'],
  C: [process.env.AUTHZ_THIRD || 'zzz123@vpl.local', process.env.AUTHZ_THIRD_PASS || 'zzz123'],
};
let opened = 0;

const req = async (p, { method = 'GET', body, tok } = {}) => {
  const r = await fetch(U + p, { method, headers: { apikey: K, authorization: 'Bearer ' + tok, 'content-type': 'application/json', prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { s: r.status, j, t: t.slice(0, 130) };
};
const auth = async (email, password) => {
  const r = await fetch(U + '/auth/v1/signup', { method: 'POST', headers: { apikey: K, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  let j = await r.json().catch(() => null);
  if (!j?.access_token) j = await (await fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: K, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
  return { email, tok: j.access_token, id: j.user.id };
};
const [A, B, C] = await Promise.all(Object.values(ACC).map(([e, p]) => auth(e, p).catch(() => null)));
if (!A || !B || !C) {
  console.log('authz-confirm: one of the three accounts has no session');
  console.log('  set AUTHZ_OWNER / AUTHZ_GUEST / AUTHZ_THIRD (and their _PASS)');
  process.exit(78);           // not configured: skipped, never green
}
const say = (n, ok, txt) => {
  if (ok) opened++;
  console.log(`${ok ? 'CONFIRMED' : 'not reproduced'}  ${n}${txt ? '  — ' + txt : ''}`);
};

/* ── 1. a viewer can add a row ───────────────────────────────────────── */
{
  const p = await req('/rest/v1/vi_projects', { method: 'POST', tok: A.tok, body: { user_id: A.id, title: 'c1 viewer-adds-row' } });
  const pid = p.j[0].id;
  await req('/rest/v1/vi_shares', { method: 'POST', tok: A.tok, body: { project_id: pid, owner_id: A.id, email: B.email, role: 'view', pending: false } });
  const r = await req('/rest/v1/vi_ideas', { method: 'POST', tok: B.tok, body: { user_id: B.id, project_id: pid, text: 'VIEWER WROTE THIS' } });
  const seen = await req(`/rest/v1/vi_ideas?select=id,text,user_id&project_id=eq.${pid}`, { tok: A.tok });
  say('B with role=view INSERTED a row into A\'s project', r.s === 201, `${r.s}; owner now sees ${seen.j?.length} row(s): ${JSON.stringify(seen.j?.[0]?.text)}`);
  await req(`/rest/v1/vi_ideas?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/vi_shares?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/vi_projects?id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
}

/* ── 2. a viewer can invite a third party, and the invite works ──────── */
{
  const p = await req('/rest/v1/vr_projects', { method: 'POST', tok: A.tok, body: { user_id: A.id, title: 'c2 viewer-invites' } });
  const pid = p.j[0].id;
  await req('/rest/v1/vr_reqs', { method: 'POST', tok: A.tok, body: { user_id: A.id, project_id: pid, statement: 'Secret: the door is 30 cm wide.', kind: 'functional', strength: 'must', status: 'draft', pos: 1 } });
  await req('/rest/v1/vr_shares', { method: 'POST', tok: A.tok, body: { project_id: pid, owner_id: A.id, email: B.email, role: 'view', pending: false } });
  const invite = await req('/rest/v1/vr_shares', { method: 'POST', tok: B.tok, body: { project_id: pid, owner_id: B.id, email: C.email, role: 'edit', pending: false } });
  const cReads = await req(`/rest/v1/vr_reqs?select=statement&project_id=eq.${pid}`, { tok: C.tok });
  const cWrites = await req(`/rest/v1/vr_reqs?project_id=eq.${pid}`, { method: 'PATCH', tok: C.tok, body: { statement: 'C WAS HERE' } });
  say('B (view) created a grant for C', invite.s === 201, `${invite.s} role=${invite.j?.[0]?.role}`);
  say('and C could then READ A\'s requirements', (cReads.j?.length || 0) > 0, JSON.stringify(cReads.j?.[0]?.statement || cReads.t));
  say('and C could WRITE them (role edit, granted by B)', cWrites.s < 300 && (cWrites.j?.length || 0) > 0, `${cWrites.s} rows=${cWrites.j?.length ?? 0}`);
  await req(`/rest/v1/vr_reqs?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/vr_shares?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/vr_projects?id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
}

/* ── 3. an editor can bin the owner's project, and it vanishes for the owner */
for (const app of ['vi', 'vr', 'vz', 'vd', 'vc', 'va']) {
  const p = await req(`/rest/v1/${app}_projects`, { method: 'POST', tok: A.tok, body: { user_id: A.id, title: `c3 ${app} bin` } });
  const pid = p.j[0].id;
  await req(`/rest/v1/${app}_shares`, { method: 'POST', tok: A.tok, body: { project_id: pid, owner_id: A.id, email: B.email, role: 'edit', pending: false } });
  const bin = await req(`/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'PATCH', tok: B.tok, body: { deleted_at: new Date().toISOString() } });
  const ownerList = await req(`/rest/v1/${app}_projects?select=id&deleted_at=is.null&id=eq.${pid}`, { tok: A.tok });
  say(`${app}: B (edit) binned A's project → gone from A's live list`, bin.s < 300 && (bin.j?.length || 0) === 1 && ownerList.j?.length === 0, `${bin.s}, owner live rows=${ownerList.j?.length}`);
  await req(`/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'PATCH', tok: A.tok, body: { deleted_at: null } });
  await req(`/rest/v1/${app}_shares?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
}

/* ── 4. an editor can permanently DELETE rows (and which apps) ───────── */
const ROWS = { vi: ['vi_ideas', { text: 'x' }], vr: ['vr_reqs', { statement: 'x', kind: 'functional', strength: 'must', status: 'draft', pos: 1 }], vz: ['vz_pairs', { key: 'k', value: 'v' }], vd: ['vd_artifacts', { title: 'x', kind: 'note' }], vc: ['vc_targets', { name: 'x', status: 'queued', pos: 1 }], va: ['va_jobs', { template: 'context', task: 'x', status: 'queued' }] };
for (const [app, [table, body]] of Object.entries(ROWS)) {
  const p = await req(`/rest/v1/${app}_projects`, { method: 'POST', tok: A.tok, body: { user_id: A.id, title: `c4 ${app} delete` } });
  const pid = p.j[0].id;
  const r = await req(`/rest/v1/${table}`, { method: 'POST', tok: A.tok, body: { user_id: A.id, project_id: pid, ...body } });
  const rid = r.j[0].id;
  await req(`/rest/v1/${app}_shares`, { method: 'POST', tok: A.tok, body: { project_id: pid, owner_id: A.id, email: B.email, role: 'edit', pending: false } });
  const del = await req(`/rest/v1/${table}?id=eq.${rid}`, { method: 'DELETE', tok: B.tok });
  const left = await req(`/rest/v1/${table}?select=id&id=eq.${rid}`, { tok: A.tok });
  const gone = del.s < 300 && (del.j?.length || 0) === 1 && left.j?.length === 0;
  say(`${app}: B (edit) permanently deleted ${table} row`, gone, `${del.s}, row still there=${left.j?.length}`);
  await req(`/rest/v1/${app}_shares?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/${app}_projects?id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
}

/* ── 5. an editor can move a row into their own project ──────────────── */
{
  const a = await req('/rest/v1/vz_projects', { method: 'POST', tok: A.tok, body: { user_id: A.id, title: 'c5 A' } });
  const b = await req('/rest/v1/vz_projects', { method: 'POST', tok: B.tok, body: { user_id: B.id, title: 'c5 B own' } });
  const pair = await req('/rest/v1/vz_pairs', { method: 'POST', tok: A.tok, body: { user_id: A.id, project_id: a.j[0].id, key: 'secret', value: 'A value' } });
  await req('/rest/v1/vz_shares', { method: 'POST', tok: A.tok, body: { project_id: a.j[0].id, owner_id: A.id, email: B.email, role: 'edit', pending: false } });
  const mv = await req(`/rest/v1/vz_pairs?id=eq.${pair.j[0].id}`, { method: 'PATCH', tok: B.tok, body: { project_id: b.j[0].id } });
  const inB = await req(`/rest/v1/vz_pairs?select=key,value,project_id&project_id=eq.${b.j[0].id}`, { tok: B.tok });
  const inA = await req(`/rest/v1/vz_pairs?select=key&project_id=eq.${a.j[0].id}`, { tok: A.tok });
  say('B (edit) moved A\'s dictionary row INTO B\'s own project', mv.s < 300 && (mv.j?.length || 0) === 1, `${mv.s}; B now holds ${JSON.stringify(inB.j?.[0]?.key)}; A's project holds ${inA.j?.length}`);
  for (const pid of [a.j[0].id, b.j[0].id]) {
    await req(`/rest/v1/vz_pairs?project_id=eq.${pid}`, { method: 'DELETE', tok: pid === b.j[0].id ? B.tok : A.tok });
    await req(`/rest/v1/vz_shares?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
    await req(`/rest/v1/vz_projects?id=eq.${pid}`, { method: 'DELETE', tok: pid === b.j[0].id ? B.tok : A.tok });
  }
}

/* ── 6. an editor can inflate a compliance verdict ───────────────────── */
{
  const p = await req('/rest/v1/vc_projects', { method: 'POST', tok: A.tok, body: { user_id: A.id, title: 'c6 counts' } });
  const pid = p.j[0].id;
  const t = await req('/rest/v1/vc_targets', { method: 'POST', tok: A.tok, body: { user_id: A.id, project_id: pid, name: 'control', status: 'queued', n_pass: 0, n_fail: 3, pos: 1 } });
  await req('/rest/v1/vc_shares', { method: 'POST', tok: A.tok, body: { project_id: pid, owner_id: A.id, email: B.email, role: 'edit', pending: false } });
  const up = await req(`/rest/v1/vc_targets?id=eq.${t.j[0].id}`, { method: 'PATCH', tok: B.tok, body: { n_pass: 99, n_fail: 0 } });
  say('B (edit) rewrote a control\'s verdict counts', up.s < 300 && (up.j?.length || 0) === 1, `${up.s} n_pass=${up.j?.[0]?.n_pass} n_fail=${up.j?.[0]?.n_fail}`);
  await req(`/rest/v1/vc_targets?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/vc_shares?project_id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
  await req(`/rest/v1/vc_projects?id=eq.${pid}`, { method: 'DELETE', tok: A.tok });
}

console.log(opened ? `\n${opened} hole(s) open` : '\nall seven shut');
process.exit(opened ? 1 : 0);
