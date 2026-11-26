/* The door's logic, without spending a cent: the Supabase functions and the
 * provider are both faked, the function under test is the real file.
 *
 *   node vp-proxy.mjs
 */
import { onRequestPost as door, onRequestOptions } from '../../api/functions/vp.js';

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); }
};

const env = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' };
const CORS = { 'content-type': 'application/json', origin: 'https://vn.terg.hr' };

let calls = [];          // what the fake world was asked to do
let spendAnswer = { ok: true, status: 200, body: [{ ok: true, reason: null, key_id: 'k1',
  provider_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  provider_model: 'gemini-3.1-flash-lite', provider_key: 'provider-secret',
  credits_left: 4, calls_left: 1 }] };
let providerAnswer = { status: 200, body: { choices: [{ message: { content: 'hi' } }],
  usage: { prompt_tokens: 10, completion_tokens: 3 } } };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.includes('/rest/v1/rpc/vp_spend')) { calls.push({ rpc: 'spend', body }); return reply(spendAnswer); }
  if (u.includes('/rest/v1/rpc/vp_settle')) { calls.push({ rpc: 'settle', body }); return reply({ status: 200, body: null }); }
  if (u.includes('/chat/completions')) { calls.push({ provider: u, body, auth: init.headers.Authorization }); return reply(providerAnswer); }
  return reply({ status: 404, body: { error: 'unexpected ' + u } });
};
function reply({ status, body }) {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

async function ask(headers, body) {
  const req = new Request('https://api.terg.hr/vp', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const res = await door({ request: req, env });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

const msgs = [{ role: 'user', content: 'hi' }];

/* ── the door's manners ──────────────────────────────────────────── */
const origin = await ask({ ...CORS, origin: 'https://evil.example' }, { messages: msgs });
ok(origin.status === 403, 'a foreign origin is refused');

const pre = await onRequestOptions({ request: new Request('https://api.terg.hr/vp', {
  method: 'OPTIONS', headers: { origin: 'https://vr.terg.hr' } }) });
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://vr.terg.hr',
  'a known origin gets its preflight answered');

const providerKey = await ask({ ...CORS, authorization: 'Bearer sk-real-key' }, { messages: msgs });
ok(providerKey.status === 401 && /vp key/i.test(providerKey.body.error),
  'a provider key is not a vp key');

/* C7/VP-4: an Origin is required, because a door is for pages. This used to say
 * the opposite — "a server with no Origin is allowed, the key is the
 * credential" — and that made the door an open relay for anything that could
 * send an HTTP request. The key is still the credential; the Origin is what a
 * page always has and a program has to lie about. */
spendAnswer = { ok: false, status: 200, body: [{ ok: false, reason: 'that key is not one of ours' }] };
const serverCall = await ask({ 'content-type': 'application/json', authorization: 'Bearer vp_x' },
  { model: 'm', messages: msgs });
ok(serverCall.status === 403 && /origin/i.test(serverCall.body.error || ''),
  'a caller with no Origin is refused, and told why', `${serverCall.status} ${JSON.stringify(serverCall.body)}`);

const notJson = await ask({ ...CORS, 'content-type': 'text/plain', authorization: 'Bearer vp_x' },
  { model: 'm', messages: msgs });
ok(notJson.status === 415, 'a form post is refused before the spend (415)', String(notJson.status));

const tooBig = await ask({ ...CORS, 'content-length': '4000000', authorization: 'Bearer vp_x' },
  { model: 'm', messages: msgs });
ok(tooBig.status === 413, 'a body over the cap is refused before the spend (413)', String(tooBig.status));

const noMessages = await ask({ ...CORS, authorization: 'Bearer vp_x' }, { model: 'm' });
ok(noMessages.status === 400, 'no messages, no call');

/* ── the spend decides ───────────────────────────────────────────── */
calls = [];
spendAnswer = { ok: true, status: 200, body: [{ ok: false, reason: 'that key is out of calls' }] };
const out = await ask({ ...CORS, authorization: 'Bearer vp_deadbeef' }, { model: 'gemini-3.1-flash-lite', messages: msgs });
ok(out.status === 403 && /out of calls/.test(out.body.error),
  'the database\'s reason reaches the person, word for word');
ok(calls.filter((c) => c.provider).length === 0, 'and no provider was called');

spendAnswer = { ok: false, status: 500, body: { message: 'the door has no key of its own' } };
const broken = await ask({ ...CORS, authorization: 'Bearer vp_deadbeef' }, { messages: msgs });
ok(broken.status === 500, 'a database that cannot answer is an error, not a free call');

/* ── a real call, faked on both sides ────────────────────────────── */
spendAnswer = { ok: true, status: 200, body: [{ ok: true, key_id: 'k1',
  provider_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  provider_model: 'gemini-3.1-flash-lite', provider_key: 'provider-secret',
  credits_left: 4, calls_left: 1 }] };
calls = [];
const good = await ask({ ...CORS, authorization: 'Bearer vp_alive' },
  { model: 'gemini-3.1-flash-lite', messages: msgs, max_tokens: 99999, temperature: 0.2 });
ok(good.status === 200 && good.body.choices[0].message.content === 'hi', 'the answer comes back as the provider shaped it');

const sent = calls.find((c) => c.provider);
ok(sent && sent.body.model === 'gemini-3.1-flash-lite', 'the issuer\'s model is used, not the caller\'s guess');
ok(sent && sent.auth === 'Bearer provider-secret', 'the provider sees the issuer\'s key, never the vp key');
ok(sent && sent.body.max_tokens === 4096, 'a runaway max_tokens is capped');
ok(good.headers.get('x-vpl-proxy') === 'vp', 'the answer is marked as the door\'s');
ok(good.headers.get('x-vpl-credits') === '4', 'and says how many calls are left');

const settle = calls.find((c) => c.rpc === 'settle');
ok(settle && settle.body.p_in === 10 && settle.body.p_out === 3 && settle.body.p_status === 200,
  'the ledger gets the tokens and the status');

ok(!JSON.stringify(good.body).includes('provider-secret'), 'the provider key never reaches the caller');

/* ── a failed upstream call gives the credit back ────────────────── */
calls = [];
providerAnswer = { status: 503, body: { error: { message: 'overloaded' } } };
const failed = await ask({ ...CORS, authorization: 'Bearer vp_alive' },
  { model: 'gemini-3.1-flash-lite', messages: msgs });
const refund = calls.find((c) => c.rpc === 'settle');
ok(failed.status === 503 && refund && refund.body.p_status === 503,
  'an upstream failure is settled with its status, which is what refunds the call');

/* ── the door will not forward to a host it does not know ────────── */
spendAnswer = { ok: true, status: 200, body: [{ ok: true, key_id: 'k1',
  provider_url: 'https://evil.example/v1', provider_model: 'm',
  provider_key: 'k', credits_left: 3, calls_left: 2 }] };
calls = [];
const offlist = await ask({ ...CORS, authorization: 'Bearer vp_alive' }, { messages: msgs });
ok(offlist.status === 403 && /not one this door forwards to/.test(offlist.body.error),
  'an issuer address off the allowlist is refused before any call');
ok(calls.filter((c) => c.provider).length === 0, 'and nothing left the building');

globalThis.fetch = realFetch;
console.log('\nvp-proxy: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
