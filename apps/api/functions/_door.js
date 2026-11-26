/* vpl · the four things every door refuses before it reads a body
 *
 * One function, so the four doors cannot drift: a door that forgot one of these
 * was how `vp` came to accept a megabyte of JSON and how `/chat` came to accept
 * a form post. A refusal is a Response; `null` means "carry on".
 *
 * Why each one, in the order a caller meets them:
 *
 *   405  a door answers POST. Nothing else has a body to forward.
 *   403  no `Origin` at all. A browser always sends one; a program that sends
 *        none is not a page, and this door exists because pages cannot call
 *        providers directly. (A program *can* send one — see `_limit.js`: that
 *        is why the bound is a rate, not a lock.)
 *   415  not json. Every door speaks json, and a form post is a reflected-error
 *        trick waiting to happen.
 *   413  bigger than the route allows. `/chat` may carry a conversation,
 *        `/fetch` a url, `/vp` a prompt; none of them may carry a file.
 */
import { corsFor } from './_origins.js';

const JSON_TYPE = /^application\/json\b/i;

/* a refusal a browser can read: without the origin echoed back, the page sees a
 * network error instead of the sentence saying what is wrong */
function headersFor(request, extra = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra };
  const allow = corsFor(request);
  if (allow) { headers['Access-Control-Allow-Origin'] = allow; headers['Vary'] = 'Origin'; }
  return headers;
}

export function refusal(request, { route, maxBytes = 256 * 1024 } = {}) {
  const json = (body, status, extra = {}) => new Response(JSON.stringify(body), {
    status,
    headers: headersFor(request, extra),
  });

  if (request.method !== 'POST') {
    return json({ error: `${route} answers POST` }, 405, { allow: 'POST, OPTIONS' });
  }
  if (!request.headers.get('Origin')) {
    return json({ error: 'this door is for pages: an Origin is required' }, 403);
  }
  if (!JSON_TYPE.test(request.headers.get('content-type') || '')) {
    return json({ error: 'send json' }, 415);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) {
    return json({ error: `that request is too big for this door (${Math.round(maxBytes / 1024)} KB)` }, 413);
  }
  return null;
}

/** The refusal for a caller over the rate (`_limit.js`). */
export function tooMany(request, retryAfter) {
  return new Response(JSON.stringify({ error: 'slow down: too many calls from this address', retry_after: retryAfter }), {
    status: 429,
    headers: headersFor(request, { 'retry-after': String(retryAfter) }),
  });
}
