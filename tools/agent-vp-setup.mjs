#!/usr/bin/env node
// Give the agent its own account, its own model key, and a vp key to spend.
//
//   GEMINI_API_KEY=... node tools/agent-vp-setup.mjs [--credits 100] [--days 180]
//
// It writes ~/.config/vpl/agent.env (mode 600) with exactly what the worker
// needs, and prints only prefixes. Safe to re-run: signing in, the model row and
// the code are all idempotent enough for a setup path (a second run makes a
// second slip, which is honest — credits are counted).
//
// Why this exists: a docker agent cannot use a free backend that shows ads, and
// nobody should copy a provider secret into a container. A vp key is a slip with
// N calls and a date on it, and every call lands in vp_charges.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const credits = Number(arg('credits', 100));
const days = Number(arg('days', 180));
// The model the door will spend for this agent. Gemini is the default, but note
// that Gemini's OpenAI-compatible surface refuses a tool result without a
// thought_signature, so an agent with tools wants a plain OpenAI-shaped upstream
// (NVIDIA `nim`, DeepSeek, OpenRouter) behind the door instead.
const API_KEY = process.env.MODEL_KEY || process.env.GEMINI_API_KEY || '';
const MODEL_BASE = process.env.AGENT_MODEL_BASE || 'https://generativelanguage.googleapis.com/v1beta/openai';
const MODEL = process.env.AGENT_MODEL || 'gemini-3.1-flash-lite';
const AGENT_EMAIL = process.env.AGENT_EMAIL || 'eva-agent@vpl.local';
const HOME = os.homedir();
const OUT = path.join(HOME, '.config', 'vpl', 'agent.env');

if (!API_KEY) {
  console.error('set MODEL_KEY (or GEMINI_API_KEY): the model the agent will use');
  process.exit(1);
}

// The suite's own config: url and anon key of the project every app talks to.
async function project() {
  const roots = ['/home/vergovic/vpl/apps', '.', 'apps'];
  for (const root of roots) {
    let names = [];
    try {
      names = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(root, name, 'config.local.js');
      let text;
      try {
        text = await fs.readFile(p, 'utf8');
      } catch {
        continue;
      }
      const url = text.match(/url:\s*'([^']+)'/)?.[1];
      const anon = text.match(/anon:\s*'([^']+)'/)?.[1];
      if (url && anon) return { url, anon };
    }
  }
  throw new Error('no apps/<app>/config.local.js with url and anon found');
}

const { url, anon } = await project();
const H = { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };

async function rest(pathname, init = {}) {
  const r = await fetch(`${url}${pathname}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: r.ok, status: r.status, body };
}

const rand = () => Array.from({ length: 18 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');

// A password that exists only in the agent's env file. Re-runs reuse it.
async function password() {
  try {
    const text = await fs.readFile(OUT, 'utf8');
    const m = text.match(/^VPL_AGENT_PASS=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch {}
  return `agent-${rand()}`;
}

const pass = await password();

let who = await rest('/auth/v1/token?grant_type=password', {
  method: 'POST',
  body: JSON.stringify({ email: AGENT_EMAIL, password: pass }),
});
if (!who.ok) {
  const made = await rest('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email: AGENT_EMAIL, password: pass }),
  });
  if (!made.ok) {
    console.error('signup refused:', made.body?.msg || made.body?.error_description || made.status);
    process.exit(1);
  }
  who = await rest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: AGENT_EMAIL, password: pass }),
  });
}
if (!who.ok) {
  console.error('signin refused:', who.body?.error_description || who.body?.msg || who.status);
  process.exit(1);
}

const token = who.body.access_token;
const uid = who.body.user.id;
const authed = { ...H, Authorization: `Bearer ${token}` };

// The model key the door will spend. One row, owned by the agent, so the door
// hands it back only for calls made with this agent's slip.
const saved = await fetch(`${url}/rest/v1/vpl_ai`, {
  method: 'POST',
  headers: { ...authed, Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify({ user_id: uid, url: MODEL_BASE, model: MODEL, api_key: API_KEY }),
});
if (!saved.ok) {
  console.error('could not save the model key:', saved.status, (await saved.text()).slice(0, 200));
  process.exit(1);
}

const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const made = await fetch(`${url}/rest/v1/rpc/vp_make_codes`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ p_count: 1, p_credits: credits, p_until: until, p_label: 'agent' }),
});
const codes = await made.json().catch(() => null);
const code = Array.isArray(codes) ? codes[0]?.code : null;
if (!code) {
  console.error('could not make a code:', made.status, JSON.stringify(codes).slice(0, 200));
  process.exit(1);
}

const redeemed = await fetch(`${url}/rest/v1/rpc/vp_redeem`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ p_code: code }),
});
const slips = await redeemed.json().catch(() => null);
const slip = Array.isArray(slips) ? slips[0] : null;
if (!slip?.api_key) {
  console.error('could not redeem:', redeemed.status, JSON.stringify(slips).slice(0, 200));
  process.exit(1);
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(
  OUT,
  [
    '# Written by tools/agent-vp-setup.mjs. Mode 600. Never committed.',
    `VPL_AGENT_EMAIL=${AGENT_EMAIL}`,
    `VPL_AGENT_PASS=${pass}`,
    'VPL_MODEL_BASE=https://api.terg.hr/vp/v1',
    `VPL_MODEL=vpl/${MODEL.split('/').pop()}`,
    `VPL_MODEL_KEY=${slip.api_key}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

const mask = (s) => (s ? s.slice(0, 7) + '…' + s.slice(-4) : '');
console.log(`account   ${AGENT_EMAIL}  (uid ${uid.slice(0, 8)}…)`);
console.log(`model     ${MODEL} at ${MODEL_BASE}`);
console.log(`vp key    ${mask(slip.api_key)}  · ${slip.credits} calls · until ${slip.valid_until}`);
console.log(`written   ${OUT}`);
