/* www.terg.hr — the front door, tested like the apps it describes.
 *
 *   node www-check.mjs                        # http://127.0.0.1:8108
 *   WWW_URL=https://www.terg.hr node www-check.mjs
 *
 * What it asserts is the promise the site makes about itself: no third-party
 * requests, no cookies, nothing to consent to, one heading, every link honest,
 * and a page that fits a phone. Plus the two things a marketing page usually
 * gets wrong: a claim that is not true of the product, and a launch placeholder
 * left on a public page.
 */
import { chromium } from 'playwright';

const B = process.env.WWW_URL || 'http://127.0.0.1:8108';
const PAGES = ['/', '/faq.html', '/privacy.html', '/imprint.html', '/404.html'];

let pass = 0; let fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } };

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
const errors = [];
const foreign = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const HOME = new URL(B).hostname;
pg.on('request', (r) => {
  const u = new URL(r.url());
  const mine = u.hostname === HOME || u.hostname.endsWith('terg.hr') || u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (!mine) foreign.push(u.href);
});

/* ── the front page ───────────────────────────────────────────────── */
await pg.goto(B, { waitUntil: 'networkidle' });
ok((await pg.title()).startsWith('Terg'), 'the title starts with the name');
const desc = await pg.getAttribute('meta[name=description]', 'content');
ok(!!desc && desc.length > 60, 'there is a description a search engine can use');
ok((await pg.getAttribute('html', 'lang')) === 'en', 'the page says what language it is in');
ok((await pg.evaluate(() => document.querySelectorAll('h1').length)) === 1, 'one h1, so the outline has a top');
ok((await pg.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgba(0, 0, 0, 0)', 'the page paints its own paper');

/* the eight addresses are the product; every one must be a real link */
const apps = await pg.evaluate(() => [...document.querySelectorAll('.apps a')].map((a) => a.href));
ok(apps.length === 8, 'eight applications are listed (' + apps.length + ')');
ok(apps.every((h) => /^https:\/\/v[a-z]\.terg\.hr\/$/.test(h)), 'each links to its own address over https');
ok(new Set(apps).size === 8, 'and no address is listed twice');

/* the words the product actually keeps */
const text = (await pg.textContent('body')).replace(/\s+/g, ' ');
ok(/one account/i.test(text), 'it says one account for the whole suite');
ok(/no analytics/i.test(text), 'it says there is no analytics');
ok(!/revolution|world-class|cutting-edge|synerg|game-chang/i.test(text), 'and no adjective is doing the work of a fact');

/* it has to be clear where to go */
ok(await pg.locator('a.go[href^="https://vn.terg.hr"]').first().isVisible(), 'the one action opens the suite');

/* no cookies, no storage beyond the theme */
const cookies = await ctx.cookies();
ok(cookies.length === 0, 'the site sets no cookies (' + cookies.length + ')');
const keys = await pg.evaluate(() => Object.keys(localStorage));
ok(keys.every((k) => k === 'vpl.theme'), 'the only thing stored is the theme choice (' + (keys.join(',') || 'nothing') + ')');

/* the theme is the suite's, and it sticks */
await pg.click('#theme');
const theme1 = await pg.evaluate(() => document.documentElement.dataset.theme || 'light');
ok(['dark', 'vi'].includes(theme1), 'the ◐ changes the theme (' + theme1 + ')');
await pg.reload({ waitUntil: 'networkidle' });
ok((await pg.evaluate(() => document.documentElement.dataset.theme || 'light')) === theme1, 'and it survives a reload');
await pg.evaluate(() => localStorage.clear());
await pg.reload({ waitUntil: 'networkidle' });

/* ── every page: structure, links, headings ───────────────────────── */
for (const path of PAGES.slice(1)) {
  await pg.goto(B + path, { waitUntil: 'networkidle' });
  const h1 = await pg.evaluate(() => document.querySelectorAll('h1').length);
  const dead = await pg.evaluate(async () => {
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^(mailto:|https?:)/.test(href)) continue;
      const res = await fetch(new URL(href, location.href), { method: 'GET' });
      if (!res.ok) out.push(href + ' → ' + res.status);
    }
    return out;
  });
  ok(h1 === 1, path + ': one h1');
  ok(dead.length === 0, path + ': every internal link resolves (' + (dead.join(', ') || 'all good') + ')');
}

/* ── the launch list: no placeholder may reach a public page ─────── */
await pg.goto(B + '/imprint.html', { waitUntil: 'networkidle' });
const fills = await pg.locator('.fill').count();
const noteVisible = await pg.locator('#launch-note').isVisible();
if ((process.env.WWW_URL || '').includes('www.terg.hr')) {
  ok(fills === 0 && !noteVisible, 'a published imprint has no placeholders left');
} else {
  ok(fills > 0 && noteVisible, 'staged imprint still marks the fields the owner must fill (' + fills + ')');
  console.log('   (that check flips once WWW_URL points at the published site)');
}

/* ── a phone ──────────────────────────────────────────────────────── */
const phone = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
for (const path of PAGES) {
  await pp.goto(B + path, { waitUntil: 'networkidle' });
  const wide = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(wide === 0, path + ': no sideways scroll on a phone (' + wide + 'px)');
  /* A link inside a sentence is text, and WCAG says so: the target rule is for
   * buttons and for links that stand alone. Those are measured. */
  const small = await pp.evaluate(() => {
    const out = [];
    const inline = (el) => !!el.closest('p, li, dd, dt, h1, h2, h3');
    for (const el of document.querySelectorAll('a[href], button')) {
      if (inline(el) && !el.classList.contains('go')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.height < 30 || r.width < 20) out.push((el.textContent || el.id || 'link').trim().slice(0, 18) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    }
    return out;
  });
  ok(small.length === 0, path + ': every link and button is hittable on a phone (' + (small.slice(0, 3).join(', ') || 'all') + ')');
}

/* ── no third party ──────────────────────────────────────────────── */
ok(foreign.length === 0, 'nothing is loaded from anybody else (' + (foreign.slice(0, 2).join(', ') || 'nothing') + ')');
ok(errors.length === 0, 'no console errors (' + (errors[0] || 'none') + ')');

await br.close();
console.log(`\nwww: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
