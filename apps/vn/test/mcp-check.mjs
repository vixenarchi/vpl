/* The MCP door — the API as tools, over stdio.
 *
 * No browser, no server: spawn the file an agent spawns, say hello, and check
 * that the five tools are there, that a read works as the signed-in person, and
 * that a write without a filter is refused before it reaches the database.
 *
 *   node mcp-check.mjs            # needs a cached token (tools/vpl-api.mjs login)
 *   MCP_NO_ACCOUNT=1 ...          # (nothing is green without one; exit 78)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '../../../tools/vpl-mcp.mjs');
const CACHE = path.join(homedir(), '.config', 'vpl', 'api-token.json');

let pass = 0; let fail = 0;
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + what); return; }
  fail++; console.log(`  FAIL ${what}${extra ? ' — ' + extra : ''}`);
};

try {
  const c = JSON.parse(readFileSync(CACHE, 'utf8'));
  if (!c?.access_token) throw new Error('no token');
} catch {
  console.log('not signed in — run: node tools/vpl-api.mjs login <email>');
  process.exit(78);
}

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
child.stdout.setEncoding('utf8');

const waiting = new Map();
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const done = waiting.get(msg.id);
    if (done) { waiting.delete(msg.id); done(msg); }
  }
});

let nextId = 1;
const ask = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (waiting.delete(id)) reject(new Error('no answer to ' + method)); }, 25000);
});
const tool = async (name, args = {}) => {
  const r = await ask('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error || r);
  let json = null; try { json = JSON.parse(text); } catch {}
  return { isError: !!r.result?.isError, text, json };
};

try {
  const init = await ask('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'mcp-check' } });
  ok(init.result?.serverInfo?.name === 'vpl', 'the server says its name', JSON.stringify(init.result?.serverInfo));
  ok(!!init.result?.capabilities?.tools, 'and offers tools');

  const list = await ask('tools/list', {});
  const names = (list.result?.tools || []).map((t) => t.name);
  ok(names.length === 5, 'five tools, no more', names.join(' '));
  ok(['vpl_login', 'vpl_whoami', 'vpl_query', 'vpl_write', 'vpl_rpc'].every((n) => names.includes(n)),
    'and they are the five an agent needs', names.join(' '));

  const schema = (list.result?.tools || []).find((t) => t.name === 'vpl_write')?.inputSchema;
  ok(schema?.required?.includes('method'), 'vpl_write says method is required', JSON.stringify(schema?.required));

  const who = await tool('vpl_whoami');
  ok(!who.isError && who.json?.email, 'a cached token is enough to know who you are', who.text.slice(0, 90));

  const q = await tool('vpl_query', { table: 'vz_projects', select: 'id,title', limit: 2 });
  ok(!q.isError && Array.isArray(q.json), 'a read comes back as rows', q.text.slice(0, 90));

  const bad = await tool('vpl_write', { table: 'vz_projects', method: 'delete' });
  ok(bad.isError && /without a filter/i.test(bad.text), 'a delete with no filter is refused before it leaves', bad.text.slice(0, 90));

  const nope = await tool('vpl_query', { table: 'no_such_table' });
  ok(nope.isError && /404|does not exist|not found/i.test(nope.text), 'and a table that is not there says so', nope.text.slice(0, 90));

  const notif = await ask('tools/list', {});
  ok(!!notif.result, 'the server is still alive after all that');
} finally {
  child.kill();
}

console.log(`\nmcp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
