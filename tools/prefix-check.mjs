#!/usr/bin/env node
/* Ask the database whether every app keeps to its own name.
 *
 *   VPL_EMAIL=you@example.com VPL_PASS=… node tools/prefix-check.mjs
 *
 * vpl_prefix_check() returns tables, functions and triggers in `public` whose
 * names carry no app prefix. Empty output means the suite's rule still holds:
 * vn owns vn_*, vi owns vi_*, and neither can quietly write into the other.
 *
 * Exit code 1 when something is unprefixed, so a script (or you, in a hurry)
 * can stop on it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = process.argv[2] || 'vn';
const cfgPath = join(here, '..', 'apps', app, 'config.local.js');

const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;
if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to any account on the project, e.g.\n' +
    '  VPL_EMAIL=you@example.com VPL_PASS=… node tools/prefix-check.mjs');
  process.exit(2);
}

const src = readFileSync(cfgPath, 'utf8');
const url = src.match(/url:\s*'([^']+)'/)?.[1];
const anon = src.match(/anon:\s*'([^']+)'/)?.[1];
if (!url || !anon) {
  console.log(`could not read url/anon from ${cfgPath}`);
  process.exit(2);
}

const post = async (path, body, token) => {
  const res = await fetch(url + path, {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, text };
};

const login = await post('/auth/v1/token?grant_type=password', { email: EMAIL, password: PASS });
const token = login.json?.access_token;
if (!token) {
  console.log('could not sign in:', login.json?.error_description || login.json?.msg || login.text.slice(0, 120));
  process.exit(2);
}

const out = await post('/rest/v1/rpc/vpl_prefix_check', {}, token);
if (out.status !== 200) {
  console.log(`vpl_prefix_check answered ${out.status}: ${out.text.slice(0, 160)}`);
  process.exit(2);
}

const rows = Array.isArray(out.json) ? out.json : [];
if (!rows.length) {
  console.log('clean — every table, function and trigger carries an app prefix');
  process.exit(0);
}

console.log(`${rows.length} object(s) without a prefix:`);
for (const r of rows) console.log(`  ${r.kind.padEnd(9)} ${r.name}`);
process.exit(1);
