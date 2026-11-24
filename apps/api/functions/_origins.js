/* Who may call the doors at this address — one list, three functions.
 *
 * The three doors (chat, search, vp) are separate files but they answer the same
 * question, and three copies of a security decision drift apart. Edit this list
 * to your own addresses; nothing else in the proxy needs changing.
 *
 * An entry with a leading dot matches any subdomain (`'.example.pages.dev'`),
 * a full entry must match exactly. Local development is always allowed: a page
 * at http://127.0.0.1:8102 is a page.
 *
 * The keys the doors carry are the caller's own, so a wrong origin can only
 * spend its own quota — but an open relay is still an open relay, and a list is
 * cheaper than an incident.
 */
export const ORIGINS = [
  /* The suite's own addresses. Replace them with yours, or add to them — this
   * file is the only place anything needs to change. */
  'https://vn.terg.hr',
  'https://vi.terg.hr',
  'https://vr.terg.hr',
  'https://vz.terg.hr',
  'https://vd.terg.hr',
  'https://vc.terg.hr',
  'https://vp.terg.hr',
  'https://va.terg.hr',
  /* a Pages project answers on <hash>.<project>.pages.dev and on the stable
   * <project>.pages.dev; the leading dot allows both */
  '.vpl.pages.dev',
  '.vpl-vi.pages.dev',
  '.vpl-vr.pages.dev',
  '.vpl-vz.pages.dev',
  '.vpl-vd.pages.dev',
  '.vpl-vc.pages.dev',
  '.vpl-vp.pages.dev',
  '.vpl-va.pages.dev',
];

/* No Origin at all means a server is calling, not a page: the key it holds is
 * the credential, and CORS is not authentication. A browser always sends one,
 * so a page from the wrong place is still refused. */
export function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '';
  let host = '';
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return ''; }
  const local = host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
  const ok = local || ORIGINS.some((o) => (o.startsWith('.') ? host.endsWith(o) : origin === o));
  return ok ? origin : '';
}
