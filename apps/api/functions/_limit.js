/* vpl · a speed bump at the doors, not a lock
 *
 * The doors are a relay: a page sends its own provider key (or a `vp_` credit
 * token) and the proxy forwards it, because the providers send no CORS headers.
 * The origin list stops a page from another site; it does not stop a program,
 * which can send any `Origin` it likes. That was finding C7/VP-4 and the honest
 * answer is not a fake authentication scheme — it is a bound:
 *
 *   - a page must send an `Origin` (a server has no business at this door)
 *   - a body must be json and no bigger than the route allows
 *   - one address may make a modest number of calls per minute
 *
 * The count lives in the edge cache (`caches.default`), which is per-colo and
 * eventually consistent: this is a speed bump on abuse, not a quota anybody can
 * be billed for. A determined caller with many addresses will get through most
 * of the way. What it does buy is that one machine cannot use the suite's
 * address as a free proxy in a loop, and that the cost of trying is visible.
 *
 * Nothing secret lives behind a door — the key is the caller's own, and a `vp`
 * credit is spent before the provider is called — so the worst a relay can do
 * is spend the caller's own quota.
 */

/** The client's address as Cloudflare sees it, or ''. */
export const ipOf = (request) => request.headers.get('CF-Connecting-IP') || '';

/**
 * Count one call for this address and route.
 *
 * `cache` is `caches.default` in a Pages Function and any object with
 * `match`/`put` in a test. Returns `{ ok, used, retryAfter }`.
 */
export async function take(cache, request, { route, limit = 30, window = 60, now = Date.now() } = {}) {
  const ip = ipOf(request);
  /* no cache (a local twin), or no address we can see: allow, and say so */
  if (!cache || !ip) return { ok: true, used: 0, unbounded: true };
  const bucket = Math.floor(now / 1000 / window);
  const key = new Request(`https://limits.vpl.invalid/${encodeURIComponent(route)}/${encodeURIComponent(ip)}/${bucket}`);
  try {
    const hit = await cache.match(key);
    const used = hit ? Number(await hit.text()) || 0 : 0;
    if (used >= limit) return { ok: false, used, retryAfter: window };
    await cache.put(key, new Response(String(used + 1), {
      headers: { 'cache-control': `max-age=${window * 2}` },
    }));
    return { ok: true, used: used + 1 };
  } catch {
    /* a cache that is not there is not a reason to take the doors down */
    return { ok: true, used: 0, unbounded: true };
  }
}
