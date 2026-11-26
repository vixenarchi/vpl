#!/usr/bin/env node
/* vpl-notes — from a cold start to a note another person can open, without a browser.
 *
 *   node vpl-notes.mjs who
 *   node vpl-notes.mjs signup <email> <password>     # 6+ chars; session comes back at once
 *   node vpl-notes.mjs login  <email> <password>
 *   node vpl-notes.mjs note   <title> <body.md>      # prints the new note id
 *   node vpl-notes.mjs share  <note_id> <email> [view|edit]
 *   node vpl-notes.mjs show   <note_id>              # and says its last letter
 *
 * Every call runs as one person, with that person's token: the cache is the same
 * file tools/vpl-api.mjs uses, so both tools share one session. No service key.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CACHE = path.join(homedir(), '.config', 'vpl', 'api-token.json');
const CONFIG_URL = process.env.VPL_CONFIG_URL || 'https://vn.terg.hr/config.local.js';
const die = (m) => { console.error('vpl-notes: ' + m); process.exit(2); };

/* ── where the database is ──────────────────────────────────────────────
 * env first, then a clone's apps/vn/config.local.js, then the deployed copy of
 * that same file. The anon key is public by design: row-level security is the
 * lock, not the key. */
async function site() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON)
    return { url: process.env.VPL_SUPABASE_URL.replace(/\/+$/, ''), anon: process.env.VPL_SUPABASE_ANON };
  const pick = (s) => {
    const url = s.match(/url:\s*'([^']+)'/)?.[1];
    const anon = s.match(/anon:\s*'([^']+)'/)?.[1];
    return url && anon ? { url: url.replace(/\/+$/, ''), anon } : null;
  };
  /* a full clone, whether the skill sits in skills/ or in a copy of the folder:
   * try the repository this file is in, then the working directory */
  for (const where of ['../../../apps/vn/config.local.js', '../../../../apps/vn/config.local.js', 'apps/vn/config.local.js']) {
    try {
      const here = where.startsWith('/') ? where : new URL(where, `file://${process.cwd()}/`).pathname;
      const local = readFileSync(here, 'utf8');
      const got = pick(local);
      if (got) return got;
    } catch {}
    try {
      const got = pick(readFileSync(new URL(where, import.meta.url), 'utf8'));
      if (got) return got;
    } catch {}
  }
  const res = await fetch(CONFIG_URL);
  if (!res.ok) die(`no config: set VPL_SUPABASE_URL and VPL_SUPABASE_ANON (${CONFIG_URL} answered ${res.status})`);
  const got = pick(await res.text());
  if (!got) die(`no config: ${CONFIG_URL} has no url/anon pair`);
  return got;
}

async function call(pathname, { method = 'GET', body, token, prefer } = {}) {
  const { url, anon } = await site();
  const headers = { apikey: anon, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${url}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.message || json?.error_description || json?.msg || text.slice(0, 300) || res.statusText;
    const code = json?.code ? ` [${json.code}]` : '';
    die(`${res.status} ${msg}${code}${json?.hint ? ` (hint: ${json.hint})` : ''}`);
  }
  return json;
}

const readCache = () => { try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return null; } };
const writeCache = (o) => {
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(o, null, 1), { mode: 0o600 });
};

/* A token lives one hour; a cached one is refreshed rather than reported. */
async function token() {
  const c = readCache();
  if (!c?.access_token) die('not signed in — run: node vpl-notes.mjs login <email> <password>');
  if (Date.now() < (c.expires_at || 0) - 90_000) return c.access_token;
  if (!c.refresh_token) die('the cached token is old and cannot be refreshed — login again');
  const { url, anon } = await site();
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh_token }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) die(`refresh failed (${res.status}) — login again`);
  writeCache({ ...c, access_token: j.access_token, refresh_token: j.refresh_token || c.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

const sub = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;

/* Signup returns a session immediately when email confirmation is off, which is
 * how this project is configured; if it is on, the answer has no token and the
 * person must confirm first. Say which one happened instead of guessing. */
async function signup(email, password) {
  if (!email || !password) die('usage: signup <email> <password>');
  const { url, anon } = await site();
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) die(`signup failed: ${j?.msg || j?.error_description || res.status}`);
  if (!j?.access_token) {
    console.log(`created ${email} — email confirmation is ON, so there is no session yet`);
    return;
  }
  writeCache({ email, user_id: j.user.id, access_token: j.access_token,
    refresh_token: j.refresh_token, expires_at: (j.expires_at || 0) * 1000 });
  console.log(`signed up and signed in as ${email} (${j.user.id.slice(0, 8)}…)`);
}

async function login(email, password) {
  if (!email || !password) die('usage: login <email> <password>');
  const { url, anon } = await site();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) die(`login failed: ${j?.error_description || j?.msg || res.status}`);
  writeCache({ email, user_id: sub(j.access_token), access_token: j.access_token,
    refresh_token: j.refresh_token, expires_at: (j.expires_at || 0) * 1000 });
  console.log(`signed in as ${email} — token cached in ${CACHE}`);
}

async function who() {
  const t = await token();
  const c = readCache();
  const rows = await call('/rest/v1/vn_notes?select=id,deleted_at', { token: t });
  console.log(`who      ${c.email}  (${c.user_id})`);
  console.log(`token    ${Math.max(0, Math.round(((c.expires_at || 0) - Date.now()) / 60000))} min left`);
  console.log(`vn       ${rows.filter((r) => !r.deleted_at).length} live, ${rows.filter((r) => r.deleted_at).length} binned`);
}

/* user_id is not a database default: the insert policy asks whether the row is
 * yours, and the apps send it. position decides the order in the list. */
async function note(title, bodyFile) {
  if (!title || !bodyFile) die('usage: note <title> <body.md>');
  const body = readFileSync(bodyFile, 'utf8');
  const t = await token();
  const mine = await call('/rest/v1/vn_notes?select=id&deleted_at=is.null', { token: t });
  const row = {
    user_id: readCache().user_id,
    title, body,
    position: mine.length + 1,
    is_public: false,
    tags: [title.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
  };
  const made = await call('/rest/v1/vn_notes', { method: 'POST', token: t, body: row, prefer: 'return=representation' });
  console.log(made[0].id);
}

/* A grant is an address plus a role, and it names owner_id — not user_id. The
 * database writes owner_id from auth.uid(), so sending one is refused; that is
 * also why tools/vpl-api.mjs post cannot be used for this table (it adds
 * user_id to every row). Insert from here instead. */
async function share(noteId, email, role = 'view') {
  if (!noteId || !email) die('usage: share <note_id> <email> [view|edit]');
  if (!['view', 'edit'].includes(role)) die('role must be view or edit');
  const t = await token();
  const known = await call('/rest/v1/rpc/vn_account_exists', { method: 'POST', token: t, body: { who: email } });
  if (known !== true) {
    console.log(`no account for ${email}: storing the invitation as pending — it grants nothing until they sign up`);
  }
  const made = await call('/rest/v1/vn_shares', {
    method: 'POST', token: t, prefer: 'return=representation',
    body: { note_id: noteId, email: email.trim().toLowerCase(), role, pending: known !== true },
  });
  const g = made[0];
  console.log(`share    ${g.email}  role ${g.role}${g.pending ? '  (pending — wait' + 's)' : ''}  id ${g.id}`);
  if (g.pending) console.log('when they sign up: patch vn_shares id=eq.' + g.id + ' with {"pending":false}');
}

async function show(noteId) {
  if (!noteId) die('usage: show <note_id>');
  const t = await token();
  const rows = await call(`/rest/v1/vn_notes?select=id,title,body,updated_at,deleted_at&id=eq.${noteId}`, { token: t });
  if (!rows.length) die('no such note — not yours, binned, or the id is wrong');
  const n = rows[0];
  const trimmed = n.body.replace(/\s+$/, '');
  console.log(`title    ${n.title}`);
  console.log(`updated  ${n.updated_at}${n.deleted_at ? '   (in the bin)' : ''}`);
  console.log(`chars    ${n.body.length}\n--- body ---`);
  console.log(n.body);
  console.log(`--- last letter: ${JSON.stringify(trimmed.slice(-1))}`);
}

async function list(limit = '20') {
  const t = await token();
  const mine = readCache().user_id;
  const rows = await call(`/rest/v1/vn_notes?select=id,title,updated_at,user_id&deleted_at=is.null&order=updated_at.desc&limit=${limit}`, { token: t });
  if (!rows.length) return console.log('no live notes — nothing you own, nothing shared with you');
  for (const r of rows)
    console.log(`${r.id}  ${r.user_id === mine ? 'mine  ' : 'SHARED'}  ${r.updated_at.slice(0, 16).replace('T', ' ')}  ${r.title}`);
  /* a note shared with this account is read through the same table: the select
   * policy lets a guest read the row, so the difference is only user_id */
}

const [cmd, ...a] = process.argv.slice(2);
const verbs = {
  who, signup, login, note, share, show, list,
};
if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(`vpl-notes — a note in vpl, from the shell.

  who                              who you are, and how many notes you hold
  list                             your notes and the ones shared with you
  signup <email> <password>        6+ chars; no mailbox needed on this project
  login  <email> <password>        caches a token for an hour
  note   <title> <body.md>         prints the new note id
  share  <note_id> <email> [view|edit]
  show   <note_id>                 the body, and its last letter

config: \$VPL_SUPABASE_URL + \$VPL_SUPABASE_ANON, else apps/vn/config.local.js,
else the deployed ${'vn'}/config.local.js (the anon key is public by design).`);
  process.exit(cmd ? 0 : 2);
}
if (!verbs[cmd]) die(`unknown verb "${cmd}" — run with --help`);
await verbs[cmd](...a);
