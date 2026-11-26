/* The doors, asked the questions they answer.
 *
 * C7/VP-4: `Origin` is not authentication — a program can send any origin it
 * likes — so the honest fix is not a fake login at the edge, it is a bound. The
 * four doors now refuse before they read a body (`_door.js`) and count calls per
 * address (`_limit.js`). This checks both, and the origin list, without a
 * network: the modules are imported and the requests are made up.
 *
 * The one thing this cannot prove is how a real relay behaves under real abuse;
 * that is a rate in a cache, and it is written down as a speed bump in
 * docs/security.md rather than as a lock.
 *
 *   node door-check.mjs
 */
import { refusal, tooMany } from '../../../apps/api/functions/_door.js';
import { take, ipOf } from '../../../apps/api/functions/_limit.js';
import { corsFor } from '../../../apps/api/functions/_origins.js';

let pass = 0;
let fail = 0;
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${what}`); return true; }
  fail++; console.log(`  FAIL ${what}${extra ? ' — ' + extra : ''}`);
  return false;
};

/* a request the way a page sends one, with knobs for the four refusals */
const req = ({ method = 'POST', origin = 'https://vn.terg.hr', type = 'application/json', length, url = 'https://api.terg.hr/chat' } = {}) => {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (type) headers.set('content-type', type);
  if (length) headers.set('content-length', String(length));
  return new Request(url, { method, headers, body: method === 'GET' ? undefined : '{}' });
};

console.log('\ndoors · the four refusals, and the bound\n');

/* ── 1. the refusals ─────────────────────────────────────────────────── */
const good = req();
ok(refusal(good, { route: '/chat' }) === null, 'a proper page request passes the door');

const get = refusal(req({ method: 'GET' }), { route: '/chat' });
ok(get && get.status === 405, 'GET is refused (405)', get ? String(get.status) : 'allowed');
ok(get?.headers.get('allow') === 'POST, OPTIONS', 'and says what it does answer');

const noOrigin = refusal(req({ origin: '' }), { route: '/chat' });
ok(noOrigin && noOrigin.status === 403, 'no Origin at all is refused (403) — a door is for pages');
const noOriginBody = await noOrigin?.clone().json().catch(() => ({}));
ok(String(noOriginBody?.error || '').includes('Origin'), 'and the sentence says so', JSON.stringify(noOriginBody));

const form = refusal(req({ type: 'application/x-www-form-urlencoded' }), { route: '/chat' });
ok(form && form.status === 415, 'a form post is refused (415), not parsed');

const big = refusal(req({ length: 2 * 1024 * 1024 }), { route: '/vp', maxBytes: 1024 * 1024 });
ok(big && big.status === 413, 'a body over the route cap is refused (413)');

const small = refusal(req({ length: 400 }), { route: '/search', maxBytes: 16 * 1024 });
ok(small === null, 'a small json body passes');

/* a refusal a browser can read: the origin is echoed, or the page sees a
 * network error instead of the sentence */
ok(noOrigin.headers.get('access-control-allow-origin') === null,
  'the no-origin refusal carries no CORS promise (there is nobody to promise)');
const bigHeaders = big.headers.get('access-control-allow-origin');
ok(bigHeaders === 'https://vn.terg.hr', 'a refusal to a known page is readable by it', String(bigHeaders));

const too = tooMany(req(), 60);
ok(too.status === 429 && too.headers.get('retry-after') === '60', '429 says how long to wait');
ok(too.headers.get('access-control-allow-origin') === 'https://vn.terg.hr', 'and is readable by the page');

/* ── 2. the origin list ──────────────────────────────────────────────── */
ok(corsFor(req()) === 'https://vn.terg.hr', 'a listed origin is echoed');
ok(corsFor(req({ origin: 'https://vpl-vi.pages.dev' })) === 'https://vpl-vi.pages.dev', 'a pages.dev preview is allowed by suffix');
ok(corsFor(req({ origin: 'http://127.0.0.1:8102' })) === 'http://127.0.0.1:8102', 'a local server is a page too');
ok(corsFor(req({ origin: 'https://evil.example' })) === '', 'an unlisted origin gets nothing');
ok(corsFor(req({ origin: '' })) === '', 'and no origin gets nothing');

/* ── 3. the bound ────────────────────────────────────────────────────── */
const fakeCache = () => {
  const store = new Map();
  return {
    store,
    match: async (k) => (store.has(k.url) ? new Response(store.get(k.url)) : undefined),
    put: async (k, res) => { store.set(k.url, await res.text()); },
  };
};
const cache = fakeCache();
const at = (ip, extra = {}) => {
  const h = new Headers({ origin: 'https://vn.terg.hr', 'content-type': 'application/json' });
  if (ip) h.set('cf-connecting-ip', ip);
  return new Request('https://api.terg.hr/chat', { method: 'POST', headers: h, body: '{}', ...extra });
};

let allowed = 0;
for (let i = 0; i < 12; i++) {
  const r = await take(cache, at('203.0.113.7'), { route: '/chat', limit: 10, window: 60, now: 1_700_000_000_000 });
  if (r.ok) allowed++;
}
ok(allowed === 10, 'ten calls from one address pass, the eleventh does not', `allowed ${allowed}`);

const over = await take(cache, at('203.0.113.7'), { route: '/chat', limit: 10, window: 60, now: 1_700_000_000_000 });
ok(over.ok === false && over.retryAfter === 60, 'the eleventh is refused, with a window to wait');

const other = await take(cache, at('198.51.100.9'), { route: '/chat', limit: 10, window: 60, now: 1_700_000_000_000 });
ok(other.ok === true, 'a second address is not punished for the first');

const otherRoute = await take(cache, at('203.0.113.7'), { route: '/fetch', limit: 10, window: 60, now: 1_700_000_000_000 });
ok(otherRoute.ok === true, 'and a busy /chat does not close /fetch');

const nextMinute = await take(cache, at('203.0.113.7'), { route: '/chat', limit: 10, window: 60, now: 1_700_000_060_000 });
ok(nextMinute.ok === true, 'a new minute starts a new count');

const noIp = await take(cache, at(''), { route: '/chat', limit: 10, window: 60 });
ok(noIp.ok === true && noIp.unbounded === true, 'no address we can see means no count (and it says so)');
const noCache = await take(null, at('203.0.113.7'), { route: '/chat', limit: 1 });
ok(noCache.ok === true && noCache.unbounded === true, 'a cache that is not there does not take the door down');

const broken = { match: async () => { throw new Error('cache down'); }, put: async () => {} };
const survives = await take(broken, at('203.0.113.7'), { route: '/chat', limit: 1 });
ok(survives.ok === true, 'a cache that throws does not break the door either');

ok(ipOf(at('203.0.113.7')) === '203.0.113.7', 'the address is the edge\'s, not a header the caller chose');

console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
