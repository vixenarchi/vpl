/* vpl · vp — the door that spends somebody else's key, one call at a time.
 *
 *   POST https://api.terg.hr/vp
 *   Authorization: Bearer vp_…
 *   { model, messages, max_tokens?, temperature?, tools?, stream? }
 *
 * This is the only function in the suite that holds a secret big enough to hurt:
 * the service-role key, because `vp_spend` hands back the provider key of the
 * person who issued the code. Everything it does is in this file, and it does
 * nothing else.
 *
 * The order is deliberate: spend a credit BEFORE calling the provider (two
 * parallel calls cannot both pass when one is left), settle AFTER (a failed call
 * gives the credit back). Nothing is logged here; `vp_charges` holds metadata
 * only — no prompt, no answer, no address.
 */

const SUPABASE = 'https://ebhrjstllsazywbxnbqt.supabase.co';

/* Same list as chat.js, minus nothing: a key holder may call these hosts. */
const ALLOWED = [
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.mistral.ai',
  'api.together.xyz',
  'api.deepseek.com',
  'api.fireworks.ai',
  'api.perplexity.ai',
  'api.cerebras.ai',
  'api.sambanova.ai',
  'api.novita.ai',
  'api.hyperbolic.xyz',
  'integrate.api.nvidia.com',
  'api.x.ai',
  'generativelanguage.googleapis.com',
  'models.inference.ai.azure.com',
  'openai.azure.com',
  '.openai.azure.com',
];

const ORIGINS = [
  'https://vn.terg.hr',
  'https://vi.terg.hr',
  'https://vr.terg.hr',
  'https://vd.terg.hr',
  'https://vc.terg.hr',
  'https://vz.terg.hr',
  'https://vp.terg.hr',
  'https://va.terg.hr',
  'https://vg.terg.hr',
  '.vpl-ae9.pages.dev',
  '.vpl-vr.pages.dev',
  '.vpl-vd.pages.dev',
  '.vpl-vc.pages.dev',
  '.vpl-vz.pages.dev',
  'https://vpl-vp.pages.dev',
  '.vpl-vp.pages.dev',
];

function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  /* No Origin at all means a server is calling, not a page: the key it holds is
   * the credential, and CORS is not authentication. A browser always sends one,
   * so a page from the wrong place is still refused below. */
  if (!origin) return '';
  let host = '';
  try { host = new URL(origin).hostname.toLowerCase(); } catch { host = ''; }
  const local = host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
  const ok = local || ORIGINS.some((o) => (o.startsWith('.') ? host.endsWith(o) : origin === o));
  return ok ? origin : '';
}

const headersFor = (request, extra, contentType) => {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Vpl-Proxy': 'vp',
    ...extra,
  };
  const allow = corsFor(request);
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow;
    headers['Access-Control-Expose-Headers'] = 'X-Vpl-Proxy';
    headers['Vary'] = 'Origin';
  }
  return headers;
};

const json = (body, status, request, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: headersFor(request, extra, 'application/json') });

const sse = (text, status, request, extra = {}) =>
  new Response(text, { status, headers: headersFor(request, extra, 'text/event-stream') });

/* The door relays, it does not rewrite: an agent's tool calls must survive the
 * trip. `usage` is the only thing read out of the stream, because that is what
 * the ledger is allowed to keep. */
function usageFromSse(text) {
  let usage = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const data = s.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const j = JSON.parse(data);
      if (j && j.usage) usage = j.usage;
    } catch { /* a partial chunk is not an error */ }
  }
  return usage;
}

export async function onRequestOptions({ request }) {
  const headers = {
    'X-Vpl-Proxy': 'vp',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  const allow = corsFor(request);
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow;
    headers['Access-Control-Expose-Headers'] = 'X-Vpl-Proxy';
  }
  return new Response(null, { status: 204, headers });
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rpc(env, name, args) {
  const key = env.SUPABASE_SERVICE_KEY;
  if (!key) return { ok: false, status: 500, body: { error: 'the door has no key of its own' } };
  const r = await fetch(`${env.SUPABASE_URL || SUPABASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { ok: r.ok, status: r.status, body };
}

/* A stored base address usually ends with the OpenAI-shaped prefix; some
 * people paste the full completions url. Both are accepted. */
function completionsUrl(base) {
  const b = String(base || '').replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : b + '/chat/completions';
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && !corsFor(request)) {
    return json({ error: 'this origin may not use the door' }, 403, request);
  }

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith('vp_')) {
    return json({ error: 'use a vp key here, not a provider key' }, 401, request);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'send json' }, 400, request); }
  if (!Array.isArray(body?.messages) || !body.messages.length) {
    return json({ error: 'no messages' }, 400, request);
  }

  const hash = await sha256hex(token);
  const model = String(body.model || '').trim();

  const spent = await rpc(env, 'vp_spend', { p_hash: hash, p_app: '', p_model: model });
  if (!spent.ok) {
    return json({ error: (spent.body && spent.body.message) || 'the door could not answer' }, spent.status, request);
  }
  const row = Array.isArray(spent.body) ? spent.body[0] : spent.body;
  if (!row || row.ok !== true) {
    return json({ error: row?.reason || 'that key cannot be used' }, 403, request);
  }

  const url = completionsUrl(row.provider_url);
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = ''; }
  const allowed = host && ALLOWED.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
  if (!allowed) {
    await rpc(env, 'vp_settle', {
      p_hash: hash, p_status: 403, p_app: '', p_model: model, p_in: 0, p_out: 0, p_ms: 0,
    });
    return json({ error: `the issuer's address ${host || '(none)'} is not one this door forwards to` }, 403, request);
  }

  /* An allowlist, not a pass-through: the caller's body may carry anything
   * (`store`, `metadata`, provider-specific knobs) and only these fields are
   * forwarded. That is also what keeps a vp key from being a proxy of its own. */
  const payload = { model: row.provider_model, messages: body.messages };
  if (typeof body.max_tokens === 'number') payload.max_tokens = Math.min(body.max_tokens, 4096);
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;
  if (typeof body.top_p === 'number') payload.top_p = body.top_p;
  if (Array.isArray(body.stop)) payload.stop = body.stop.slice(0, 4);
  if (Array.isArray(body.tools)) payload.tools = body.tools.slice(0, 64);
  if (body.tool_choice !== undefined) payload.tool_choice = body.tool_choice;
  if (body.response_format && typeof body.response_format === 'object') {
    payload.response_format = body.response_format;
  }
  if (body.parallel_tool_calls === false) payload.parallel_tool_calls = false;
  const wantsStream = body.stream === true;
  if (wantsStream) {
    payload.stream = true;
    if (body.stream_options && body.stream_options.include_usage) {
      payload.stream_options = { include_usage: true };
    }
  }

  const started = Date.now();
  let upstream; let text = '';
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + row.provider_key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    text = await upstream.text();
  } catch (err) {
    await rpc(env, 'vp_settle', {
      p_hash: hash, p_status: 502, p_app: '', p_model: model,
      p_in: 0, p_out: 0, p_ms: Date.now() - started,
    });
    return json({ error: `could not reach ${host}: ${err.message}` }, 502, request);
  }

  const settle = (status, usage) =>
    rpc(env, 'vp_settle', {
      p_hash: hash,
      p_status: status,
      p_app: '',
      p_model: model,
      p_in: usage?.prompt_tokens || 0,
      p_out: usage?.completion_tokens || 0,
      p_ms: Date.now() - started,
    });

  const metered = {
    'X-Vpl-Credits': String(row.credits_left ?? ''),
    'X-Vpl-Calls': String(row.calls_left ?? ''),
  };

  /* A stream is relayed whole rather than chunk by chunk: the door is one call
   * at a time and it has to read the bytes anyway to count the tokens. Faster
   * looking, slower to arrive — the honest trade for this suite. */
  if (wantsStream && upstream.ok && text.trimStart().startsWith('data:')) {
    await settle(upstream.status, usageFromSse(text));
    return sse(text, upstream.status, request, metered);
  }

  let parsed = null;
  if (text && text[0] === '{') { try { parsed = JSON.parse(text); } catch { parsed = null; } }

  await settle(upstream.status, parsed && parsed.usage);

  return json(parsed || { raw: text.slice(0, 4000) }, upstream.status, request, metered);
}
