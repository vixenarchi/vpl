/* The policy every deployed page carries, checked in a browser.
 *
 * C8 in docs/security.md: there was no Content-Security-Policy in any of the
 * eight, and the model key and the session live in `localStorage` — so any XSS
 * in any app is a stolen key, not a stolen paragraph. The fix is a header, and a
 * header is only worth what the page still does under it.
 *
 * So this walks each app the way a person does — sign in, open the thing, open
 * the settings, switch the theme, import a pdf — and counts two things:
 *
 *   1. **violations**: the browser's own "Refused to…" complaints. One is a
 *      bug: something in the app would have worked before and will not now.
 *   2. **the header**: present, and carrying the directives that carry weight
 *      (no inline scripts, no eval, no framing, no base retarget, no object).
 *
 * The pdf step is the interesting one: it imports pdf.js as a module from the
 * CDN and starts its worker, which is the only path in the suite that needs
 * `worker-src` and `'wasm-unsafe-eval'`.
 *
 *   node csp-check.mjs                 # all eight, locally
 *   APP=vc PORT=8105 node csp-check.mjs
 *   APP=vc BASE_URL=https://vpl-vc.pages.dev node csp-check.mjs   # a deployment
 *   VPL_PROD=1 node csp-check.mjs      # all eight, on Pages
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const APPS = [
  { id: 'vn', port: 8102, prod: 'https://vn.terg.hr' },
  { id: 'vi', port: 8100, prod: 'https://vpl-vi.pages.dev' },
  { id: 'vr', port: 8101, prod: 'https://vpl-vr.pages.dev' },
  { id: 'vz', port: 8103, prod: 'https://vpl-vz.pages.dev' },
  { id: 'vd', port: 8104, prod: 'https://vpl-vd.pages.dev' },
  { id: 'vc', port: 8105, prod: 'https://vpl-vc.pages.dev' },
  { id: 'vp', port: 8106, prod: 'https://vpl-vp.pages.dev' },
  { id: 'va', port: 8107, prod: 'https://vpl-va.pages.dev' },
];

const one = process.env.APP;
const list = one
  ? [{ id: one, url: process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 8102}` }]
  : APPS.map((a) => ({ id: a.id, url: process.env.VPL_PROD ? a.prod : `http://127.0.0.1:${a.port}` }));

let pass = 0;
let fail = 0;
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; return true; }
  fail++; console.log(`  FAIL ${what}${extra ? ' — ' + extra : ''}`);
  return false;
};
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch {}
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 120));
  }
};

/* The directives that carry weight, and what they must be. A policy that says
 * `script-src *` would still be "a CSP" and would stop nothing. */
const REQUIRED = [
  [/default-src 'self'/, "default-src 'self'"],
  [/script-src [^;]*'self'/, "script-src names 'self'"],
  [/worker-src [^;]*blob:/, 'worker-src allows the pdf worker'],
  [/object-src 'none'/, "object-src 'none'"],
  [/base-uri 'self'/, "base-uri 'self'"],
  [/frame-ancestors 'none'/, "frame-ancestors 'none'"],
  [/form-action 'self'/, "form-action 'self'"],
];
const FORBIDDEN = [
  [/script-src [^;]*'unsafe-inline'/, "script-src has no 'unsafe-inline'"],
  [/script-src [^;]*'unsafe-eval'/, "script-src has no 'unsafe-eval'"],
  /* every host in bundles this app itself loads */
  [/(?<=script-src )\*(?![^;])/, 'script-src is not a wildcard'],
  [/script-src [^;]*\bhttps:(?!\/\/)/, 'script-src names hosts, not the whole scheme'],
];

const br = await chromium.launch();
console.log('');

for (const app of list) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const noise = [];
  const edge = [];
  /* One name is not ours. Cloudflare's Web Analytics beacon is injected at the
   * edge on a proxied zone, and it was on every *.terg.hr address until it was
   * switched off at the account (Analytics, Web Analytics, Manage site, Disable)
   * on 27 Nov. The policy still refuses it, because a switch somebody can flip
   * back is not a guarantee — "no third-party script" is a rule of this suite.
   * So the check reports the name rather than widening the policy, and now also
   * says out loud whether it came back. */
  const EDGE_HOST = 'static.cloudflareinsights.com';
  pg.on('console', (m) => {
    const t = m.text();
    if (!/Content Security Policy|Refused to (load|execute|apply|connect|frame|eval)/i.test(t)) return;
    if (t.includes(EDGE_HOST)) { edge.push(t.slice(0, 120)); return; }
    noise.push(t.slice(0, 180));
  });
  pg.on('pageerror', (e) => noise.push('pageerror: ' + e.message.slice(0, 160)));
  pg.on('dialog', (d) => d.accept());

  await pg.goto(`${app.url}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);

  /* 1. the header */
  const csp = await pg.evaluate(async () => {
    const r = await fetch('/', { cache: 'no-store' });
    return r.headers.get('content-security-policy') || '';
  });
  const before = noise.length;
  ok(!!csp, `${app.id}: the page carries a Content-Security-Policy`, 'no header at all');
  for (const [re, label] of REQUIRED) ok(!csp || re.test(csp), `${app.id}: ${label}`);
  for (const [re, label] of FORBIDDEN) ok(!csp || !re.test(csp), `${app.id}: ${label}`);
  ok(noise.length === before, `${app.id}: the bare page breaks nothing`, noise.slice(before).join(' · '));

  /* 2. the app, used: sign in, open something, the settings, the theme */
  const gate = pg.locator('#email');
  if (await gate.isVisible().catch(() => false)) {
    await gate.fill(OWNER.email);
    await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
    await until(async () => pg.locator('#app:not([hidden])').count(), 15000);
    await pg.waitForTimeout(1600);
  }
  if (app.id === 'vn') {
    await pg.locator('#list .note-row, #list li').first().click().catch(() => {});
  } else if (app.id !== 'vp') {
    const row = pg.locator('#proj-list .proj-row').first();
    if (await row.count()) await row.locator('.pick').first().click().catch(() => {});
    else await pg.click('#btn-new').catch(() => {});
  }
  await pg.waitForTimeout(900);

  const mark = noise.length;
  const gear = pg.locator('#btn-ai');
  if (await gear.count()) {
    await gear.click();
    await until(async () => pg.locator('#ai-dialog[open]').count(), 6000);
    await pg.click('#ai-dialog [data-tab=theme]').catch(() => {});
    await pg.click('#ai-dialog .set-theme[data-theme=vi]').catch(() => {});
    await pg.click('#ai-dialog [data-a=save]').catch(() => {});
    await pg.waitForTimeout(400);
    await pg.click('#ai-dialog [data-a=close]').catch(() => {});
    await until(async () => !(await pg.locator('#ai-dialog[open]').count()), 6000);
    await pg.click('#ai-dialog [data-a=close]').catch(() => {});
  }
  ok(noise.length === mark, `${app.id}: the settings and the theme still work`, noise.slice(mark).join(' · '));

  /* 3. the one path that needs worker-src: pdf.js, imported and started */
  const pdf = await pg.evaluate(async () => {
    const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';
    const bytes = new TextEncoder().encode(['%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 20 20]>>endobj',
      'trailer<</Root 1 0 R>>', '%%EOF'].join('\n'));
    try {
      const doc = await lib.getDocument({ data: bytes }).promise;
      return { pages: doc.numPages };
    } catch (e) { return { error: String(e).slice(0, 120) }; }
  });
  ok(pdf.pages === 1, `${app.id}: pdf.js loads, and its worker starts`, pdf.error || `pages ${pdf.pages}`);

  const left = noise.length;
  ok(left === 0, `${app.id}: no policy violations in the whole walk`, noise.slice(0, 2).join(' · '));
  const note = edge.length ? ` · EDGE INJECTS ${EDGE_HOST} AGAIN (blocked, but the switch is back on)` : ' · no edge beacon';
  console.log(`  ${app.id.padEnd(3)} ${left === 0 ? 'clean' : left + ' violation(s)'} · ${(csp || '').split(';').length} directives${note}`);
  await ctx.close();
}

await br.close();
console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
