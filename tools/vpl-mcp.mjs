#!/usr/bin/env node
/* vpl as a tool an agent can call — Model Context Protocol, over stdio.
 *
 * There is no vpl service, and this is not one: it is a thin door onto the same
 * PostgREST the apps use, carrying **the person's own token**. Row-level security
 * decides what happens, so an agent can do what that person may do in the browser
 * and nothing more. The service key is never read, never asked for, never here.
 *
 *   node tools/vpl-mcp.mjs                 # speaks JSON-RPC on stdin/stdout
 *   node tools/vpl-mcp.mjs --tools         # print the tool list and exit
 *
 * Register it once, then the agent has the API as tools:
 *
 *   ~/.free-pi/agent/mcp.json
 *   { "mcpServers": { "vpl": { "command": "node",
 *       "args": ["/home/<you>/vpl/tools/vpl-mcp.mjs"] } } }
 *
 * The token comes from the same cache `tools/vpl-api.mjs login` fills, so signing
 * in once in a shell is enough for both.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.dirname(HERE);
const CACHE = path.join(homedir(), '.config', 'vpl', 'api-token.json');
const CONFIG = ['apps/vn/config.local.js', 'apps/vi/config.local.js', 'apps/vr/config.local.js'];

/* ── the address, from the apps' own config ─────────────────────────── */
function site() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON) {
    return { url: process.env.VPL_SUPABASE_URL, anon: process.env.VPL_SUPABASE_ANON };
  }
  for (const f of CONFIG) {
    try {
      const s = readFileSync(path.join(ROOT, f), 'utf8');
      const url = s.match(/url:\s*'([^']+)'/)?.[1];
      const anon = s.match(/anon:\s*'([^']+)'/)?.[1];
      if (url && anon) return { url, anon };
    } catch {}
  }
  throw new Error('no config: expected apps/vn/config.local.js, or VPL_SUPABASE_URL / VPL_SUPABASE_ANON');
}

const readCache = () => {
  try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return null; }
};
const writeCache = (o) => {
  mkdirSync(path.dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(o, null, 1), { mode: 0o600 });
  try { chmodSync(CACHE, 0o600); } catch {}
};

/* one hour is shorter than most jobs, so an old token is refreshed rather than
 * handed back as an error — an agent should not have to know about expiry */
async function token() {
  const c = readCache();
  if (!c?.access_token) throw new Error('not signed in — call vpl_login, or run: node tools/vpl-api.mjs login <email>');
  if (Date.now() < (c.expires_at || 0) - 90_000) return c.access_token;
  if (!c.refresh_token) throw new Error('the token is old and cannot be refreshed — sign in again');
  const { url, anon } = site();
  const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh_token }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) throw new Error(`refresh failed (${r.status}) — sign in again`);
  writeCache({
    email: c.email, access_token: j.access_token, refresh_token: j.refresh_token || c.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000, user_id: c.user_id,
  });
  return j.access_token;
}

async function call(pathname, { method = 'GET', body, prefer } = {}) {
  const { url, anon } = site();
  const tok = await token();
  const r = await fetch(`${url}${pathname}`, {
    method,
    headers: { apikey: anon, authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const msg = json?.message || json?.error_description || text.slice(0, 300) || r.statusText;
    const hint = json?.hint ? ` (hint: ${json.hint})` : '';
    const code = json?.code ? ` [${json.code}]` : '';
    throw new Error(`${r.status} ${msg}${code}${hint}`);
  }
  return json;
}

/* ── the tools ───────────────────────────────────────────────────────── */
const APPS = 'vn notes · vi funnels · vr requirements · vz dictionary · vd documents · vc compliance · va jobs · vp keys';

const TOOLS = [
  {
    name: 'vpl_login',
    description: 'Sign in as the person this agent works for. Stores a token in ~/.config/vpl/api-token.json (mode 600), '
      + 'the same cache the shell tool uses. Every later call runs as that person.',
    inputSchema: {
      type: 'object', required: ['email', 'password'],
      properties: { email: { type: 'string' }, password: { type: 'string' } },
    },
  },
  {
    name: 'vpl_whoami',
    description: 'Who the token is, when it expires, and how many live / binned rows each app holds. Use it to check '
      + 'the connection before a job and the work after it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vpl_query',
    description: `Read rows as this person. PostgREST filters, e.g. table "vz_pairs", ` +
      `select "key,value", filter "project_id=eq.<uuid>", order "key.asc", limit 50. ` +
      `Row-level security decides what is visible. Tables: vn_notes, vi_ideas, vr_items, vz_pairs, ${APPS}.`,
    inputSchema: {
      type: 'object', required: ['table'],
      properties: {
        table: { type: 'string' },
        select: { type: 'string', description: 'columns, default *' },
        filter: { type: 'string', description: 'PostgREST filter without "?", e.g. project_id=eq.<uuid>' },
        order: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'vpl_write',
    description: 'Insert, update or delete rows as this person. An update or delete without a filter is refused — '
      + 'one wrong call should not take a column. Deleting usually means filling `deleted_at` instead.',
    inputSchema: {
      type: 'object', required: ['table', 'method'],
      properties: {
        table: { type: 'string' },
        method: { type: 'string', enum: ['insert', 'update', 'delete'] },
        filter: { type: 'string', description: 'required for update and delete' },
        row: { type: 'object', description: 'the row, or the columns to change' },
      },
    },
  },
  {
    name: 'vpl_rpc',
    description: 'Call a database function as this person, e.g. "vn_delete_my_account", "vz_share_role", '
      + '"va_can_edit". Use it when a rule lives in a function rather than a policy.',
    inputSchema: {
      type: 'object', required: ['fn'],
      properties: { fn: { type: 'string' }, args: { type: 'object' } },
    },
  },
];

const need = (filter, method) => {
  if (!filter || !filter.includes('=')) throw new Error(`a ${method} without a filter writes every row — give one, e.g. id=eq.<uuid>`);
};

async function run(name, a = {}) {
  switch (name) {
    case 'vpl_login': {
      const { url, anon } = site();
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ email: a.email, password: a.password }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.access_token) throw new Error(`${r.status} ${j?.error_description || j?.msg || 'sign-in refused'}`);
      writeCache({
        email: j.user?.email || a.email, access_token: j.access_token, refresh_token: j.refresh_token,
        expires_at: Date.now() + (j.expires_in || 3600) * 1000, user_id: j.user?.id,
      });
      return { signed_in: j.user?.email, user_id: j.user?.id, minutes: Math.round((j.expires_in || 3600) / 60) };
    }
    case 'vpl_whoami': {
      const { url, anon } = site();
      const c = readCache();
      const tok = await token();
      const who = await (await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${tok}` } })).json();
      const live = {};
      for (const [app, label] of [['vn', 'notes'], ['vi', 'funnels'], ['vr', 'requirements'], ['vz', 'dictionary'],
        ['vd', 'documents'], ['vc', 'compliance'], ['va', 'jobs']]) {
        const table = app === 'vn' ? 'vn_notes' : `${app}_projects`;
        try {
          const rows = await call(`/rest/v1/${table}?select=id,deleted_at`);
          live[label] = { live: rows.filter((r) => !r.deleted_at).length, binned: rows.filter((r) => r.deleted_at).length };
        } catch (e) { live[label] = { error: String(e.message || e).slice(0, 80) }; }
      }
      return { email: who?.email || c?.email, user_id: who?.id, token_minutes_left: Math.max(0, Math.round(((c?.expires_at || 0) - Date.now()) / 60000)), rows: live };
    }
    case 'vpl_query': {
      const q = new URLSearchParams();
      q.set('select', a.select || '*');
      if (a.filter) new URLSearchParams(a.filter).forEach((v, k) => q.append(k, v));
      if (a.order) q.set('order', a.order);
      if (a.limit) q.set('limit', String(a.limit));
      else q.set('limit', '100');
      return await call(`/rest/v1/${a.table}?${q}`);
    }
    case 'vpl_write': {
      if (a.method === 'insert') return await call(`/rest/v1/${a.table}`, { method: 'POST', body: a.row ?? {}, prefer: 'return=representation' });
      need(a.filter, a.method);
      if (a.method === 'update') return await call(`/rest/v1/${a.table}?${a.filter}`, { method: 'PATCH', body: a.row ?? {}, prefer: 'return=representation' });
      if (a.method === 'delete') {
        const c = readCache();
        if (!c?.access_token) throw new Error('sign in first');
        return await call(`/rest/v1/${a.table}?${a.filter}`, { method: 'DELETE', prefer: 'return=representation' });
      }
      throw new Error('method must be insert, update or delete');
    }
    case 'vpl_rpc': return await call(`/rest/v1/rpc/${a.fn}`, { method: 'POST', body: a.args ?? {} });
    default: throw new Error(`no tool called ${name}`);
  }
}

/* ── the wire: JSON-RPC 2.0, one object per line ─────────────────────── */
if (process.argv.includes('--tools')) {
  console.log(JSON.stringify(TOOLS.map((t) => ({ name: t.name, description: t.description })), null, 1));
  process.exit(0);
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }); continue; }

    /* notifications carry no id and want no answer */
    if (msg.id === undefined || msg.id === null) continue;

    try {
      if (msg.method === 'initialize') {
        send({ jsonrpc: '2.0', id: msg.id, result: {
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'vpl', version: '1.0.0' },
        } });
      } else if (msg.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params || {};
        try {
          const out = await run(name, args || {});
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] } });
        } catch (e) {
          /* a tool that fails is a result with isError, not a protocol error:
           * the model should see the sentence and be able to try something else */
          send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: String(e.message || e) }] } });
        }
      } else if (msg.method === 'ping') {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
      } else {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e.message || e) } });
    }
  }
});
