/* /api/chat — a door to a model endpoint, opened from our own origin.
 *
 * Why this exists: almost every model API (NVIDIA's included) answers the
 * browser without an Access-Control-Allow-Origin header, and the browser then
 * throws the answer away. curl and Node do not care, which is why the same
 * key works in a shell and not on a page. A request from this function goes
 * server to server, where CORS does not apply, and comes back to the page
 * from the same origin it was made on.
 *
 * What this is not: a secret store. The key arrives in the request body, is
 * used once, and is never logged or kept. It is the caller's own key, and the
 * caller is the person typing it into their own browser.
 *
 * The allowlist is the guard rail: without it this path would forward to any
 * address on the internet on someone else's behalf.
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
  /* the suite's own door: a vp key is used against api.terg.hr/vp, and an app
   * with its own /api/chat forwards to it like any other endpoint */
  'api.terg.hr',
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Vpl-Proxy': '1',
    },
  });

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'X-Vpl-Proxy': '1',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'send json' }, 400);
  }

  const { url, key, model, messages, max_tokens, temperature } = body || {};
  if (!url || !/^https:\/\//i.test(String(url))) {
    return json({ error: 'only https endpoints' }, 400);
  }
  if (!key) return json({ error: 'no key' }, 400);
  if (!Array.isArray(messages) || !messages.length) {
    return json({ error: 'no messages' }, 400);
  }

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return json({ error: 'that is not a url' }, 400);
  }

  const allowed = ALLOWED.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
  if (!allowed) {
    return json(
      {
        error: `this app will not forward to ${host}. add it to ALLOWED in functions/api/chat.js if you trust it.`,
      },
      403,
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
    return json({ error: `could not reach ${host}: ${err.message}` }, 502);
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
      'X-Vpl-Proxy': '1',
    },
  });
}
