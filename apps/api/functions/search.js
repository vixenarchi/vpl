/* vpl · shared proxy — evidence, the same way as chat.
 *
 *   POST https://api.terg.hr/search
 *   { provider: 'tavily' | 'serper', key, query, results?: 3 }
 *
 * A model writes plausible text; a search returns the thing that can be
 * checked. The used idea funnel asks for one or two facts with a source before
 * an idea may leave exploration.
 *
 * Rules mirror chat: origin must be on the list, the key travels in the body,
 * is used once, never logged. No host allowlist is needed here because the
 * destination is fixed per provider — the caller chooses a provider, not a URL.
 */

import { corsFor } from './_origins.js';

const PROVIDERS = {
  tavily: {
    url: 'https://api.tavily.com/search',
    call: (key, query, results) => ({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: results, search_depth: 'basic', include_answer: false }),
    }),
    read: (d) => (d.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
  },
  serper: {
    url: 'https://google.serper.dev/search',
    call: (key, query, results) => ({
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: results }),
    }),
    read: (d) => (d.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })),
  },
};

/* Who may call this door — same list as chat.js, on purpose. Two lists that
 * must agree should live in one file; they live in two because each function is
 * deployed alone. Keep them identical. */
const json = (body, status, request) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Vpl-Proxy': '1',
  };
  const allow = corsFor(request);
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow;
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
  if (!allow) return json({ error: 'this origin may not use the proxy' }, 403, request);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'send json' }, 400, request); }

  const { provider, key, query } = body || {};
  const p = PROVIDERS[String(provider || '').toLowerCase()];
  if (!p) return json({ error: `unknown provider: ${provider}. try tavily or serper.` }, 400, request);
  if (!key) return json({ error: 'no key' }, 400, request);
  if (!query || String(query).trim().length < 2) return json({ error: 'empty query' }, 400, request);

  const results = Math.min(Math.max(Number(body.results) || 3, 1), 8);
  const { headers, body: payload } = p.call(key, String(query).trim(), results);

  let upstream;
  try {
    upstream = await fetch(p.url, {
      method: 'POST', headers, body: payload, signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return json({ error: `could not reach ${provider}: ${err.message}` }, 502, request);
  }

  const text = await upstream.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!upstream.ok || !data) {
    return json({ error: (data && (data.detail || data.error || data.message)) || text.slice(0, 200) || `http ${upstream.status}` }, upstream.status, request);
  }

  const out = p.read(data).filter((r) => r.url).slice(0, results);
  return json({ provider, query, results: out }, 200, request);
}
