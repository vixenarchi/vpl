/* vpl · the edge of the proxy: one bound, in one place
 *
 * The four doors (`/chat`, `/search`, `/fetch`, `/vp`) each check their own
 * manners (`_door.js`) because a door must be safe on its own — but the *count*
 * lives here, once, for two reasons:
 *
 *   1. a count that each door keeps is four counts that drift, and the one that
 *      is forgotten is the one that matters;
 *   2. a limit nobody can see is not evidence. Every answer from a door now
 *      carries `X-Vpl-Limit: 12/60`, or `unbounded` when the edge has no cache
 *      or no address to count — so "the bound works" is a header, not a claim.
 *
 * A preflight is not counted: it has no body to forward, and a page that asks
 * twice because its first attempt was refused should not spend its allowance
 * asking.
 */
import { refusal, tooMany } from './_door.js';
import { take } from './_limit.js';

const LIMITS = {
  '/chat': { limit: 60, maxBytes: 512 * 1024 },
  '/search': { limit: 20, maxBytes: 16 * 1024 },
  '/fetch': { limit: 30, maxBytes: 8 * 1024 },
  '/vp': { limit: 60, maxBytes: 1024 * 1024 },
};

export async function onRequest({ request, next }) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const route = Object.keys(LIMITS).find((r) => path === r || path.startsWith(r + '/'));
  if (!route) return next();                       // a static file, not a door
  if (request.method === 'OPTIONS') return next(); // a preflight is free

  const { limit, maxBytes } = LIMITS[route];

  /* the door's own manners: also checked inside each function, so a door is
   * safe when it is imported by a test or by another worker */
  const early = refusal(request, { route, maxBytes });
  if (early) return early;

  const gate = await take(globalThis.caches?.default, request, { route, limit, window: 60 });
  if (!gate.ok) return tooMany(request, gate.retryAfter);

  const res = await next();
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  out.headers.set('x-vpl-limit', gate.unbounded ? 'unbounded' : `${gate.used}/${limit}`);
  const exposed = out.headers.get('access-control-expose-headers') || '';
  out.headers.set('access-control-expose-headers',
    exposed.includes('X-Vpl-Limit') ? exposed : `${exposed ? exposed + ', ' : ''}X-Vpl-Limit`);
  return out;
}
