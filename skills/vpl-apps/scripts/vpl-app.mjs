#!/usr/bin/env node
/* vpl-app — the same six moves for the seven apps that are not notes.
 *
 *   node vpl-app.mjs who
 *   node vpl-app.mjs projects vr                     # what this account holds
 *   node vpl-app.mjs project  vr 'my spec'           # prints the new project id
 *   node vpl-app.mjs post     vr_reqs '{"kind":"functional","strength":"must","status":"draft","statement":"…","project_id":"<id>"}'
 *   node vpl-app.mjs share    vr <project_id> someone@example.com edit
 *   node vpl-app.mjs get      vr_reqs 'project_id=eq.<id>&order=pos.asc'
 *
 * Two things differ from vn_notes and they are the whole reason this file
 * exists: a project share names owner_id as well as project_id, and a project's
 * rows carry project_id. Everything else is the same PostgREST the apps use.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CACHE = path.join(homedir(), '.config', 'vpl', 'api-token.json');
const CONFIG_URL = process.env.VPL_CONFIG_URL || 'https://vn.terg.hr/config.local.js';
const die = (m) => { console.error('vpl-app: ' + m); process.exit(2); };

/* the seven apps with projects, and the row tables that hang off each one */
const APPS = {
  vi: { rows: ['vi_ideas'] },
  vr: { rows: ['vr_reqs', 'vr_themes'] },
  vz: { rows: ['vz_pairs'] },
  vd: { rows: ['vd_artifacts', 'vd_outputs'] },
  vc: { rows: ['vc_artifacts', 'vc_targets', 'vc_outputs'] },
  va: { rows: ['va_artifacts', 'va_outputs', 'va_jobs'] },
};

async function site() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON)
    return { url: process.env.VPL_SUPABASE_URL.replace(/\/+$/, ''), anon: process.env.VPL_SUPABASE_ANON };
  const pick = (s) => {
    const url = s.match(/url:\s*'([^']+)'/)?.[1];
    const anon = s.match(/anon:\s*'([^']+)'/)?.[1];
    return url && anon ? { url: url.replace(/\/+$/, ''), anon } : null;
  };
  /* the same three places as vpl-notes: this repository, then the working
   * directory, so a copy of the folder still finds a clone's config */
  for (const where of ['../../../apps/vn/config.local.js', '../../../../apps/vn/config.local.js', 'apps/vn/config.local.js']) {
    try {
      const got = pick(readFileSync(new URL(where, import.meta.url), 'utf8'));
      if (got) return got;
    } catch {}
    try {
      const got = pick(readFileSync(where, 'utf8'));
      if (got) return got;
    } catch {}
  }
  const res = await fetch(CONFIG_URL);
  if (!res.ok) die(`no config: set VPL_SUPABASE_URL and VPL_SUPABASE_ANON (${CONFIG_URL} answered ${res.status})`);
  const g = pick(await res.text());
  if (!g) die(`no config: ${CONFIG_URL} has no url/anon pair`);
  return g;
}

async function call(p, { method = 'GET', body } = {}) {
  const { url, anon } = await site();
  const c = readCache();
  const headers = { apikey: anon, 'content-type': 'application/json', authorization: `Bearer ${c?.access_token || ''}` };
  if (body !== undefined) headers.prefer = 'return=representation';
  const res = await fetch(url + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${res.status} ${j?.message || j?.error_description || text.slice(0, 240)}${j?.code ? ` [${j.code}]` : ''}`);
  return j;
}

const readCache = () => { try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return null; } };
const writeCache = (o) => {
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(o, null, 1), { mode: 0o600 });
};

/* The cache is the same file `vpl-notes.mjs` and `tools/vpl-api.mjs` use, and a
 * token lives one hour. An aged token is refreshed here rather than reported:
 * an agent should not have to know when an hour ends. */
async function me() {
  const c = readCache();
  if (!c?.access_token) die('not signed in — run: node skills/vpl-notes/scripts/vpl-notes.mjs login <email> <password>');
  if (Date.now() < (c.expires_at || 0) - 90_000) return c;
  if (!c.refresh_token) die('the cached token is old and cannot be refreshed — login again');
  const { url, anon } = await site();
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh_token }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) die(`refresh failed (${res.status}) — login again`);
  const next = { ...c, access_token: j.access_token, refresh_token: j.refresh_token || c.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  writeCache(next);
  return next;
}

const appOf = (a) => { const s = APPS[a]; if (!s) die(`unknown app "${a}" — one of ${Object.keys(APPS).join(', ')}`); return s; };
const json = (arg) => { try { return JSON.parse(arg); } catch { die(`not JSON: ${String(arg).slice(0, 80)}`); } };

const verbs = {
  async who() {
    const c = await me();
    console.log(`${c.email}  (${c.user_id})   ${Math.max(0, Math.round((c.expires_at - Date.now()) / 60000))} min left`);
    for (const a of Object.keys(APPS)) {
      let rows = null, why = '';
      try { rows = await call(`/rest/v1/${a}_projects?select=id,deleted_at`); } catch (e) { why = e.message; }
      if (!rows) { console.log(`  ${a}  — not readable (${why.slice(0, 60)})`); continue; }
      console.log(`  ${a}  ${String(rows.filter((r) => !r.deleted_at).length).padStart(3)} live, ${rows.filter((r) => r.deleted_at).length} binned`);
    }
  },
  async projects(a) {
    appOf(a);
    for (const p of await call(`/rest/v1/${a}_projects?select=id,title,deleted_at&order=updated_at.desc&limit=20`))
      console.log(`${p.id}  ${p.deleted_at ? '(binned) ' : ''}${p.title}`);
  },
  async project(a, title, template) {
    appOf(a);
    if (!title) die('usage: project <app> <title> [template]');
    const c = await me();
    const body = { user_id: c.user_id, title };
    if (template) body.template = template;
    const made = await call(`/rest/v1/${a}_projects`, { method: 'POST', body });
    console.log(made[0].id);
  },
  async post(table, body) {
    if (!table || !body) die('usage: post <table> <json>');
    const c = await me();
    const row = json(body);
    if (row.user_id === undefined) row.user_id = c.user_id;
    const made = await call(`/rest/v1/${table}`, { method: 'POST', body: row });
    console.log(made[0]?.id ?? JSON.stringify(made));
  },
  async share(a, projectId, email, role = 'view') {
    appOf(a);
    if (!projectId || !email) die('usage: share <app> <project_id> <email> [view|edit]');
    if (!['view', 'edit'].includes(role)) die('role must be view or edit');
    const c = await me();
    /* a project share names both ids; the insert policy asks for owner_id */
    const made = await call(`/rest/v1/${a}_shares`, {
      method: 'POST',
      body: { project_id: projectId, owner_id: c.user_id, email: email.trim().toLowerCase(), role, pending: false },
    });
    const g = made[0];
    console.log(`share    ${g.email}  role ${g.role}  on ${a} project ${g.project_id}  id ${g.id}`);
  },
  async get(table, query = 'select=*&limit=10') {
    if (!table) die('usage: get <table> [postgrest query]');
    console.log(JSON.stringify(await call(`/rest/v1/${table}?${query}`), null, 1));
  },
  /* vp is the one app with no projects and no shares, and it holds money and a
   * model key. An agent reports what is there and never touches it: the key
   * columns are not even readable (`select=*` is 403), which is the point. */
  async vp() {
    const c = await me();
    const rows = async (q) => { try { return await call(q); } catch { return null; } };
    const keys = await rows('/rest/v1/vp_keys?select=id,label,created_at,calls');
    const codes = await rows('/rest/v1/vp_codes?select=id,label,created_at');
    const charges = await rows('/rest/v1/vp_charges?select=id,created_at,model');
    console.log(`${c.email} — vp, read only`);
    console.log(`  keys     ${keys ? keys.length : '—'}  ${(keys || []).map((k) => `${k.label || '(no label)'} ${k.calls ?? 0} call(s)`).join(', ')}`);
    console.log(`  codes    ${codes ? codes.length : '—'}  ${(codes || []).map((k) => k.label || '(no label)').join(', ')}`);
    console.log(`  charges  ${charges ? charges.length : '—'}  ${(charges || []).map((k) => k.model).filter(Boolean).slice(0, 5).join(', ')}`);
    console.log('  the key itself is not readable by an agent (select=* answers 403);');
    console.log('  minting, redeeming and spending are a person\'s decisions — this verb never does them.');
  },
  async bin(a, projectId) {
    appOf(a);
    if (!projectId) die('usage: bin <app> <project_id>');
    const made = await call(`/rest/v1/${a}_projects?id=eq.${projectId}`, { method: 'PATCH', body: { deleted_at: new Date().toISOString() } });
    console.log(`binned   ${made[0]?.title}  (restore with {"deleted_at":null})`);
  },
};

const [cmd, ...a] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(`vpl-app — the seven apps that are not notes.

  who                              who you are, and the live/binned count per app
  projects <app>                   the projects you hold
  project  <app> <title> [template]  prints the new id (template: vd offer, vc/vd job, va context)
  post     <table> '<json>'        insert a row; user_id is filled for you
  share    <app> <project_id> <email> [view|edit]
  get      <table> '<postgrest query>'
  bin      <app> <project_id>      deleted_at = now; restore with null
  vp                               keys / codes / charges — counts and labels only

  apps: ${Object.keys(APPS).join(' ')}     (vp has no projects and no shares: read only)`);
  process.exit(cmd ? 0 : 2);
}
if (!verbs[cmd]) die(`unknown verb "${cmd}" — run with --help`);
await verbs[cmd](...a).catch((e) => die(e.message));
