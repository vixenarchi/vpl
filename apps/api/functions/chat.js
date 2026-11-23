/* vpl · shared proxy — one door for every app in the suite.
 *
 *   POST https://api.terg.hr/chat
 *
 * Why it is its own project instead of a copy inside each app: the allowlist
 * below is a security decision, and five copies of a security decision drift
 * apart. One place to add a provider, one place to read when something is
 * refused.
 *
 * The rules are unchanged from the app-local version: https only, host must be
 * on the list, the key travels in the body, is used once, and is never logged
 * or stored. An app calls it from the page; nothing here needs a cookie, so
 * the CORS answer names the caller's origin and no credentials.
 */

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

/* Who may call this door. The key is the caller's own, so a wrong origin can
 * only spend its own quota — but an open relay is still an open relay, and a
 * list is cheaper than an incident. Local development is allowed on purpose. */
const ORIGINS = [
  'https://vn.terg.hr',
  'https://vi.terg.hr',
  'https://vr.terg.hr',
  'https://va.terg.hr',
  'https://vg.terg.hr',
  'https://vpl-ae9.pages.dev',
  '.vpl-ae9.pages.dev',
  'https://vpl-vr.pages.dev',
  'https://vd.terg.hr',
  'https://vc.terg.hr',
  'https://vz.terg.hr',
  'https://vpl-vd.pages.dev',
  'https://vpl-vc.pages.dev',
  '.vpl-vd.pages.dev',
  '.vpl-vc.pages.dev',
  '.vpl-vz.pages.dev',
  '.vpl-vr.pages.dev',
];

function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  let host = '';
  try { host = new URL(origin).hostname.toLowerCase(); } catch { host = ''; }
  const local = host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
  const ok = local || ORIGINS.some((o) => (o.startsWith('.') ? host.endsWith(o) : origin === o));
  return ok ? origin : '';
}

const json = (body, status, request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Vpl-Proxy': '1',
  };
  const allow = corsFor(request);
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow;
    /* Without this the page cannot read X-Vpl-Proxy, and the app would think
     * the proxy never answered — the header is the app's only proof that the
     * call left from our own origin. */
    headers['Access-Control-Expose-Headers'] = 'X-Vpl-Proxy';
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
};

export async function onRequestOptions({ request }) {
  const headers = {
    'X-Vpl-Proxy': '1',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const allow = corsFor(request);
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow;
    headers['Access-Control-Expose-Headers'] = 'X-Vpl-Proxy';
  }
  return new Response(null, { status: 204, headers });
}

export async function onRequestPost({ request }) {
  const allow = corsFor(request);
  if (!allow) {
    return json({ error: 'this origin may not use the proxy' }, 403, request);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'send json' }, 400, request);
  }

  const { url, key, model, messages, max_tokens, temperature } = body || {};
  if (!url || !/^https:\/\//i.test(String(url))) {
    return json({ error: 'only https endpoints' }, 400, request);
  }
  if (!key) return json({ error: 'no key' }, 400, request);
  if (!Array.isArray(messages) || !messages.length) {
    return json({ error: 'no messages' }, 400, request);
  }

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return json({ error: 'that is not a url' }, 400, request);
  }

  const allowedHost = ALLOWED.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
  if (!allowedHost) {
    return json(
      { error: `the vpl proxy will not forward to ${host}. add it to ALLOWED in apps/api/functions/chat.js if you trust it.` },
      403,
      request,
    );
  }

  const payload = { model, messages };
  if (typeof max_tokens === 'number') payload.max_tokens = max_tokens;
  if (typeof temperature === 'number') payload.temperature = temperature;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    return json({ error: `could not reach ${host}: ${err.message}` }, 502, request);
  }

  const text = await upstream.text();
  return json(text.length && text[0] === '{' ? JSON.parse(text) : { raw: text }, upstream.status, request);
}
