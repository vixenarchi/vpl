/* The `/fetch` door, walked the way an attacker would walk it.
 *
 * VC-3 in docs/security.md: the door followed a redirect with `redirect:
 * 'follow'` and checked the host afterwards — so one allowed source could name
 * any host in a redirect and the request had already been made. It is the
 * classic blind SSRF: the body is never returned, but "did that address answer"
 * is a fact worth having, especially when the address is inside a network.
 *
 * The fix is a walk: `redirect: 'manual'`, each hop checked *before* it is
 * fetched, at most three hops. This test replaces the global `fetch` with a
 * recorder, so nothing leaves the machine and every hop is visible:
 *
 *   - an off-list redirect is refused and **never fetched**
 *   - a redirect to http: is refused before it is fetched
 *   - a chain of on-list hops is followed, and the last one is the answer
 *   - a loop stops at the hop limit instead of trying forever
 *   - a 3 MB page is a sentence, not a hang
 *   - a pdf answers with "download it and drop it in"
 *
 *   node fetch-check.mjs
 */
import { onRequestPost } from '../../../apps/api/functions/fetch.js';

let pass = 0;
let fail = 0;
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${what}`); return true; }
  fail++; console.log(`  FAIL ${what}${extra ? ' — ' + extra : ''}`);
  return false;
};

const PAGE = `<html><head><title>A law</title></head><body><p>${'Članak 1. '.repeat(40)}</p></body></html>`;
const realFetch = globalThis.fetch;
let calls = [];
let script = [];

/* a fetch that answers from a script and records every address it was asked for */
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, redirect: init.redirect, method: init.method || 'GET' });
  const step = script.shift();
  if (!step) throw new Error('the test ran out of answers for ' + u);
  const [status, body, headers] = step;
  return new Response(body ?? '', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(headers || {}) },
  });
};

const door = async (url, extra = {}) => {
  const headerList = new Headers({
    origin: 'https://vc.terg.hr',
    'content-type': 'application/json',
    ...extra,
  });
  const req = new Request('https://api.terg.hr/fetch', {
    method: 'POST', headers: headerList, body: JSON.stringify({ url }),
  });
  const res = await onRequestPost({ request: req });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const reset = (...steps) => { calls = []; script = steps.slice(); };

console.log('\nfetch · the redirect walk\n');

/* ── 1. an off-list redirect is refused, and not fetched ─────────────── */
reset([302, '', { location: 'https://169.254.169.254/latest/meta-data/' }]);
let r = await door('https://eur-lex.europa.eu/eli/reg/2016/679/oj');
ok(r.status === 422 && /not on the list/.test(r.body?.error || ''), 'an off-list redirect is refused', `${r.status} ${JSON.stringify(r.body)}`);
ok(calls.length === 1, 'and the target was never fetched — one request, not two', `${calls.length} request(s): ${calls.map((c) => c.url).join(', ')}`);
ok(calls.every((c) => c.redirect === 'manual'), 'the door asks the runtime not to follow anything by itself');

/* ── 2. a redirect away from https is refused ───────────────────────── */
reset([301, '', { location: 'http://narodne-novine.nn.hr/clanci/' }]);
r = await door('https://narodne-novine.nn.hr/');
ok(r.status === 422 && /https/.test(r.body?.error || ''), 'a redirect to http: is refused', `${r.status} ${JSON.stringify(r.body)}`);
ok(calls.length === 1, 'and nothing was fetched from it either');

/* ── 3. a chain of on-list hops is followed, in order ───────────────── */
reset([302, '', { location: 'https://www.zakon.hr/z/1/' }], [200, PAGE]);
r = await door('https://zakon.hr/');
ok(r.status === 200 && r.body?.title === 'A law', 'an on-list hop is followed and the page is read', `${r.status} ${r.body?.title}`);
ok(calls.length === 2, 'two requests, the hop then the page', calls.map((c) => c.url).join(' → '));
ok(r.body?.url === 'https://www.zakon.hr/z/1/' || r.body?.url === 'https://zakon.hr/', 'the answer says where it actually read', String(r.body?.url));

/* ── 4. a loop stops at the hop limit ──────────────────────────────── */
reset(
  [302, '', { location: 'https://zakon.hr/a' }],
  [302, '', { location: 'https://zakon.hr/b' }],
  [302, '', { location: 'https://zakon.hr/c' }],
  [302, '', { location: 'https://zakon.hr/d' }],
  [200, PAGE],
);
r = await door('https://zakon.hr/loop');
ok(r.status === 422 && /redirected more than/.test(r.body?.error || ''), 'a redirect loop stops at the hop limit', `${r.status} ${JSON.stringify(r.body)}`);
ok(calls.length === 4, 'having tried four times, not forever', `${calls.length} requests`);

/* ── 5. the size cap is a sentence ─────────────────────────────────── */
const big = `<html><body>${'x'.repeat(3 * 1024 * 1024 + 10)}</body></html>`;
reset([200, big]);
r = await door('https://zakon.hr/big');
ok(r.status === 413 && /3 MB/.test(r.body?.error || ''), 'a page over 3 MB is refused with a sentence', `${r.status} ${JSON.stringify(r.body)}`);

/* ── 6. a pdf is not read here ─────────────────────────────────────── */
reset([200, '%PDF-1.4', { 'content-type': 'application/pdf' }]);
r = await door('https://www.azop.hr/dokument.pdf');
ok(r.status === 422 && r.body?.isPdf === true, 'a pdf answers "download it and drop it in"', `${r.status} ${JSON.stringify(r.body)}`);

/* ── 7. the door's own manners ─────────────────────────────────────── */
reset([200, PAGE]);
r = await door('http://zakon.hr/');
ok(r.status === 400 && /https/.test(r.body?.error || ''), 'a plain http url is refused before any request', String(r.status));
reset([200, PAGE]);
r = await door('https://example.com/');
ok(r.status === 422 && r.body?.source === false, 'a host that is not a legal source is refused', String(r.status));
ok(calls.length === 0, 'and neither of those made a request');

globalThis.fetch = realFetch;
console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
