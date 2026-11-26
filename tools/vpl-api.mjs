#!/usr/bin/env node
/* vpl-api — one command for an agent that would rather act than click.
 *
 *   node tools/vpl-api.mjs login you@example.com     # reads $VPL_PASS, else asks
 *   node tools/vpl-api.mjs whoami
 *   node tools/vpl-api.mjs get vr_reqs 'select=id,title&order=pos.asc&limit=5'
 *   node tools/vpl-api.mjs post vn_notes '{"title":"from an agent","body":"…"}'
 *   node tools/vpl-api.mjs patch vn_notes 'id=eq.<uuid>' '{"title":"renamed"}'
 *   node tools/vpl-api.mjs delete vn_notes 'id=eq.<uuid>'
 *   node tools/vpl-api.mjs rpc vp_spend '{"p_amount":1,"p_reason":"a call"}'
 *   node tools/vpl-api.mjs me                        # the person, the tables, the bins
 *
 * There is no vpl service and no second database: this talks to Supabase's
 * REST API as *the person*, with their own token. Row-level security therefore
 * applies exactly as it does in the browser — an agent can do what that person
 * may do, and nothing else. That is the whole design: the API surface is the
 * one the apps already use.
 *
 * A token lives for an hour. It is cached in ~/.config/vpl/api-token.json (mode
 * 600), refreshed with the refresh_token when it ages, and never printed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const CONFIG = ['apps/vn/config.local.js', 'apps/vp/config.local.js'];
const CACHE = path.join(homedir(), '.config', 'vpl', 'api-token.json');

/* ── where the database is ─────────────────────────────────────────────
 * The url and the anon key are already in every app's local config, and the
 * anon key is public by design: row-level security is the lock, not the key. */
function site() {
  for (const f of CONFIG) {
    try {
      const s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      const url = s.match(/url:\s*'([^']+)'/)?.[1];
      const anon = s.match(/anon:\s*'([^']+)'/)?.[1];
      if (url && anon) return { url, anon };
    } catch {}
  }
  const url = process.env.VPL_SUPABASE_URL;
  const anon = process.env.VPL_SUPABASE_ANON;
  if (url && anon) return { url, anon };
  die('no config: expected apps/vn/config.local.js, or VPL_SUPABASE_URL / VPL_SUPABASE_ANON');
}

const die = (msg) => { console.error(`vpl-api: ${msg}`); process.exit(2); };

const readCache = () => {
  try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return null; }
};
const writeCache = (o) => {
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(o, null, 1), { mode: 0o600 });
  try { chmodSync(CACHE, 0o600); } catch {}
};

async function call(pathname, { method = 'GET', body, token, prefer } = {}) {
  const { url, anon } = site();
  const headers = { apikey: anon, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${url}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json?.message || json?.error_description || text.slice(0, 300) || res.statusText;
    const hint = json?.hint ? ` (hint: ${json.hint})` : '';
    const code = json?.code ? ` [${json.code}]` : '';
    throw new Error(`${res.status} ${msg}${code}${hint}`);
  }
  return json;
}

/* ── the token ─────────────────────────────────────────────────────────
 * One hour is shorter than most jobs, so a cached token is refreshed rather
 * than reported as an error: an agent should not have to know about expiry. */
async function token(force = false) {
  const c = readCache();
  if (!c?.access_token) die('not signed in — run: node tools/vpl-api.mjs login <email>');
  const stale = Date.now() > (c.expires_at || 0) - 90_000;
  if (!stale && !force) return c.access_token;
  if (!c.refresh_token) die('the token is old and cannot be refreshed — run login again');
  const { url, anon } = site();
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh_token }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) die(`refresh failed (${res.status}) — run login again`);
  writeCache({
    email: c.email,
    access_token: j.access_token,
    refresh_token: j.refresh_token || c.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    user_id: c.user_id,
  });
  return j.access_token;
}

/* ── login ─────────────────────────────────────────────────────────────
 * A password grant, exactly what the apps do. Nothing is stored but the token. */
async function login(email, password) {
  if (!email) die('usage: vpl-api login <email>');
  let pass = password || process.env.VPL_PASS;
  if (!pass) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    pass = await rl.question(`password for ${email}: `);
    rl.close();
  }
  const { url, anon } = site();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) die(`login failed: ${j?.error_description || j?.msg || res.status}`);
  const uid = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString()).sub;
  writeCache({
    email,
    user_id: uid,
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
  });
  console.log(`signed in as ${email} (${uid.slice(0, 8)}…) — token cached for an hour`);
}

/* ── what this person can see ──────────────────────────────────────────
 * `me` is the one command to run before a job: it says who you are and how
 * many rows each app's tables hold, so an agent can check its own work. */
async function me() {
  const t = await token();
  const c = readCache();
  /* the list is ours and it is short; the OpenAPI root wants the service key,
   * which an agent must never have */
  const APPS = {
    vn: 'vn_notes',
    vi: 'vi_projects',
    vr: 'vr_projects',
    vz: 'vz_projects',
    vd: 'vd_projects',
    vc: 'vc_projects',
    vp: null,
    va: 'va_projects',
  };
  console.log(`who      ${c.email}  (${c.user_id})`);
  console.log(`token    ${Math.max(0, Math.round(((c.expires_at || 0) - Date.now()) / 60000))} min left`);
  for (const [app, table] of Object.entries(APPS)) {
    if (!table) continue;
    try {
      const rows = await call(`/rest/v1/${table}?select=id,deleted_at`, { token: t });
      const live = rows.filter((r) => !r.deleted_at).length;
      const bin = rows.length - live;
      console.log(`  ${app}  ${table.padEnd(12)} ${String(live).padStart(4)} live, ${bin} binned`);
    } catch (e) {
      console.log(`  ${app}  ${table.padEnd(12)} — ${e.message}`);
    }
  }
}

/* ── the verbs ─────────────────────────────────────────────────────────
 * A table name and a PostgREST query string, nothing invented: the same syntax
 * the browser uses, so the documentation for one is the documentation for both. */
const bodyOf = async (arg) => {
  if (arg === undefined) return undefined;
  const text = arg === '-' ? await new Promise((res) => {
    let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => res(s));
  }) : arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg;
  try { return JSON.parse(text); } catch { die(`not JSON: ${text.slice(0, 80)}`); }
};

const needsTable = (t) => { if (!t) die('a table name is required'); return t; };

async function main(argv) {
  const [cmd, ...rest] = argv;
  const t = ['login', 'help', '--help', '-h', undefined].includes(cmd) ? null : await token();
  switch (cmd) {
    case 'login': return login(rest[0], rest[1]);
    case 'whoami': {
      const c = readCache();
      const u = await call('/auth/v1/user', { token: await token() });
      return console.log(`${u.email}  ${u.id}`);
    }
    case 'me': return me();
    case 'get': {
      const [table, query] = rest;
      const q = query ?? 'select=*&limit=10';
      const rows = await call(`/rest/v1/${needsTable(table)}?${q}`, { token: t });
      return console.log(JSON.stringify(rows, null, 1));
    }
    case 'post': {
      const [table, body] = rest;
      const row = await bodyOf(body) ?? {};
      /* the person's id is part of the row, not a default in the database: the
       * insert policy asks whether user_id is you, and a row without one is
       * refused with 42501. The apps send it too; so does this. */
      if (row.user_id === undefined) {
        const c = readCache();
        if (c?.user_id) row.user_id = c.user_id;
      }
      const made = await call(`/rest/v1/${needsTable(table)}`, { method: 'POST', token: t, body: row, prefer: 'return=representation' });
      return console.log(JSON.stringify(made, null, 1));
    }
    case 'patch': {
      const [table, filter, body] = rest;
      if (!filter?.includes('=')) die('a filter is required, e.g. "id=eq.<uuid>" — a patch without one writes every row');
      const row = await call(`/rest/v1/${needsTable(table)}?${filter}`, { method: 'PATCH', token: t, body: await bodyOf(body), prefer: 'return=representation' });
      return console.log(JSON.stringify(row, null, 1));
    }
    case 'delete': {
      const [table, filter] = rest;
      if (!filter?.includes('=')) die('a filter is required, e.g. "id=eq.<uuid>" — a delete without one takes every row');
      const row = await call(`/rest/v1/${needsTable(table)}?${filter}`, { method: 'DELETE', token: t, prefer: 'return=representation' });
      return console.log(JSON.stringify(row, null, 1));
    }
    case 'rpc': {
      const [fn, args] = rest;
      const out = await call(`/rest/v1/rpc/${needsTable(fn)}`, { method: 'POST', token: t, body: (await bodyOf(args)) || {} });
      return console.log(JSON.stringify(out, null, 1));
    }
    default:
      console.log(`vpl-api — act as yourself, through the same API the apps use.

  login <email> [password]     password from $VPL_PASS, or asked for
  whoami                       the signed-in person
  me                           who you are, and what each app holds
  get <table> [query]          query is PostgREST, e.g. "select=id,title&limit=5"
  post <table> <json|@file|->  returns the new row; user_id is filled for you
  patch <table> <filter> <json>  filter is required, e.g. "id=eq.<uuid>"
  delete <table> <filter>      filter is required
  rpc <function> <json>        a database function, e.g. vp_spend

Read docs/api.md before writing anything: it lists the tables, the closed lists,
the bins, and the four things that are refused.`);
  }
}

main(process.argv.slice(2)).catch((e) => die(e.message));
