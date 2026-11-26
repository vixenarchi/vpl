/* api.terg.hr/fetch — read a law from an official source, when the browser cannot.
 *
 * eur-lex.europa.eu and narodne-novine.nn.hr answer with HTML and no CORS
 * headers, so a page cannot read them. This door goes server to server, strips
 * the HTML down to text, and hands back the words. It is deliberately narrow:
 *
 *   - an allowlist of legal sources (below), matched on the host;
 *   - https only, redirects followed but re-checked against the same list;
 *   - a 3 MB cap and a 15 s timeout, so a giant page is a sentence, not a hang;
 *   - HTML only. A PDF comes back as "download it and drop it here", because a
 *     file the person already has does not need a second silo.
 *
 * There is no crawling, no cache, no queue: one page, one request, on demand.
 * The caller's own page is checked against the suite's origin list, and no key
 * is involved — a text is public, and this door spends nothing.
 */

import { corsFor } from './_origins.js';
import { refusal } from './_door.js';

/* Sources a compliance check actually cites. A suffix matches its subdomains;
 * anything not on this list gets one sentence back. */
const SOURCES = [
  'eur-lex.europa.eu',
  'narodne-novine.nn.hr',
  'zakon.hr',
  'data.gov.hr',
  'www.hzinfra.hr',
  'www.azop.hr',
];

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_HOPS = 3;
const TIMEOUT_MS = 15000;

function allowed(host) {
  const h = String(host || '').toLowerCase();
  return SOURCES.some((s) => h === s || h.endsWith('.' + s));
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    },
  });
}

/* HTML to text, and nothing clever: scripts and styles go, block tags become
 * newlines, entities come back to characters, runs of blank lines collapse.
 * A reader wants the paragraphs, not the markup. */
export function toText(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|table|header|footer)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '· ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&(?:#\d+|#x[0-9a-f]+);/gi, ' ');
  s = s.replace(/\r/g, '');
  s = s.replace(/[ \t\u00a0]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function title(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return m ? toText(m[1]).replace(/\s+/g, ' ').slice(0, 200) : '';
}

export async function onRequestOptions({ request }) {
  const origin = corsFor(request);
  return new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
    },
  });
}

export async function onRequestPost({ request }) {
  /* the four things every door refuses, and then the bound: see _door.js and
   * _limit.js. Origin is not authentication (C7/VP-4) — this is what a
   * relay with no server can honestly do about that. */
  const early = refusal(request, { route: '/fetch', maxBytes: 8192 });
  if (early) return early;
  const origin = corsFor(request);
  if (request.headers.get('Origin') && !origin) {
    return json({ error: 'this address is not on the list that may call me' }, 403, '');
  }
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'send json' }, 400, origin); }

  const raw = String(body.url || '').trim();
  if (!raw) return json({ error: 'no url' }, 400, origin);
  let u;
  try { u = new URL(raw); } catch { return json({ error: 'that is not a web address' }, 400, origin); }
  if (u.protocol !== 'https:') return json({ error: 'only https' }, 400, origin);
  if (!allowed(u.hostname)) {
    return json({
      error: 'that source is not on the list — download the pdf and drop it here',
      source: false,
    }, 422, origin);
  }

  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  let res;
  let at = u;
  try {
    /* Redirects are walked here, one at a time, and every hop is checked BEFORE
     * it is fetched. `redirect: 'follow'` fetched the target first and asked
     * afterwards (VC-3), which turns one allowed source into a blind request to
     * any host a redirect names — including one inside the network. A hop limit
     * keeps a chain of redirects from being a slow loop. */
    for (let hop = 0; ; hop++) {
      res = await fetch(at.toString(), {
        redirect: 'manual',
        signal: stop.signal,
        headers: {
          /* a plain, honest agent: a site that does not want to be read this way
           * will say so, and the person gets a sentence instead of a mystery */
          'user-agent': 'vpl-vc/1.0 (compliance check; +https://terg.hr)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'accept-language': 'hr,en;q=0.8',
        },
      });
      const isRedirect = res.status >= 300 && res.status < 400;
      if (!isRedirect) break;
      const where = res.headers.get('location');
      if (!where) break;
      if (hop + 1 > MAX_HOPS) {
        clearTimeout(timer);
        return json({ error: `it redirected more than ${MAX_HOPS} times` }, 422, origin);
      }
      let next;
      try { next = new URL(where, at); } catch {
        clearTimeout(timer);
        return json({ error: 'it redirected to something that is not a web address' }, 422, origin);
      }
      if (next.protocol !== 'https:') {
        clearTimeout(timer);
        return json({ error: 'it redirected away from https' }, 422, origin);
      }
      if (!allowed(next.hostname)) {
        clearTimeout(timer);
        return json({ error: 'it redirected somewhere that is not on the list' }, 422, origin);
      }
      at = next;
    }
  } catch (err) {
    clearTimeout(timer);
    const why = err?.name === 'AbortError' ? 'it took longer than 15 seconds' : 'could not reach it';
    return json({ error: why }, 502, origin);
  }
  clearTimeout(timer);

  if (!res.ok) return json({ error: `the source answered ${res.status}` }, 502, origin);

  const finalHost = new URL(res.url || at.toString()).hostname;
  if (!allowed(finalHost)) {
    return json({ error: 'it redirected somewhere that is not on the list' }, 422, origin);
  }

  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type.includes('pdf') || /\.pdf$/i.test(u.pathname)) {
    return json({
      error: 'that is a pdf — download it and drop it into the library instead',
      isPdf: true, url: res.url || u.toString(),
    }, 422, origin);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return json({ error: `larger than 3 MB (${Math.round(buf.byteLength / 1024)} kB) — take the part you need` }, 413, origin);
  }

  const html = new TextDecoder('utf-8').decode(buf);
  const text = toText(html);
  if (!text || text.length < 40) {
    return json({ error: 'the page answered, but there was no readable text in it' }, 422, origin);
  }

  return json({
    url: res.url || u.toString(),
    title: title(html),
    text,
    chars: text.length,
  }, 200, origin);
}
