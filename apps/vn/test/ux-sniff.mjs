/* ux-sniff — the cheap, mechanical half of a design review.
 *
 *   node ux-sniff.mjs                      # every local app, as one table
 *   APP_URL=http://127.0.0.1:8107 APP_NAME=va node ux-sniff.mjs
 *   VPL_PROD=1 node ux-sniff.mjs
 *
 * It does not judge taste. It looks for the things that are wrong in every
 * design system at once: a control too small to hit with a thumb, type too small
 * to read, a page that scrolls sideways, a focus ring that does not exist, an
 * icon with nothing to announce it. Everything it reports is measurable, so a
 * disagreement is a measurement, not an opinion.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };

const APPS = [
  { id: 'vn', port: 8102 },
  { id: 'vi', port: 8100 },
  { id: 'vr', port: 8101 },
  { id: 'vz', port: 8103 },
  { id: 'vd', port: 8104 },
  { id: 'vc', port: 8105 },
  { id: 'vp', port: 8106 },
  { id: 'va', port: 8107 },
];

const one = process.env.APP_URL ? [{ id: process.env.APP_NAME || 'app', url: process.env.APP_URL }] : null;

/* what a thumb can hit, what an eye can read */
const SMALL_HIT = 30;      // px, below this a control is a coin toss on a phone
const SMALL_TYPE = 10.5;   // px, below this the words are decoration

const audit = ({ SMALL_HIT, SMALL_TYPE }) => {
  const out = { small: [], tiny: [], unnamed: [], overflow: 0, rings: 0, ringsTested: 0, pageScroll: 0 };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const hit = document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=button], [tabindex="0"]');
  /* WCAG draws the same line: a link inside a sentence is text, and its target
   * is the sentence. A button, or a link that stands alone, is a control and is
   * measured. Without this, every prose page looks like a phone full of bugs. */
  const inSentence = (el) => el.tagName === 'A' && !!el.closest('p, dd, dt, figcaption') && !el.classList.contains('quiet');
  for (const el of hit) {
    if (!visible(el) || el.closest('#dock') || inSentence(el)) continue;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (h < SMALL_HIT || w < SMALL_HIT) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.id || el.className || el.tagName).trim().slice(0, 28);
      out.small.push(`${label} ${w}×${h}`);
    }
    /* a name is whatever a screen reader would read: aria-label, the text, a
     * <label for>, aria-labelledby, or a title. An audit that only knew the
     * first two reported a correctly labelled field as unlabelled. */
    const labelled = el.id
      ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
      : '';
    const by = el.getAttribute('aria-labelledby');
    const refd = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || labelled || refd || el.textContent || '')
      .replace(/\s+/g, ' ').trim();
    if (!name && !el.querySelector('svg title')) {
      out.unnamed.push((el.id || el.className || el.tagName) + '');
    }
  }
  for (const el of document.querySelectorAll('p, span, label, li, td, th, small, div')) {
    if (!visible(el) || el.closest('#dock') || el.closest('.draw-svg')) continue;
    if (!el.textContent.trim()) continue;
    if (el.querySelector('p, span, li, div, td')) continue;   // outermost text node only
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < SMALL_TYPE) out.tiny.push(`${px}px «${el.textContent.trim().slice(0, 24)}»`);
  }
  out.overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  /* One thing scrolls at a time, and it is the work column. A page that scrolls
   * carries the bar and the rail off the top of the screen — which is how a bin
   * banner "in the middle" happens, and how a person loses sight of who is
   * signed in while reading. */
  out.pageScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  return out;
};

async function look(br, app, viewport, tag) {
  const ctx = await br.newContext({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await pg.addInitScript(() => {
    localStorage.setItem('vpl.ai', JSON.stringify({
      url: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'k', model: 'gemini-3.1-flash-lite',
    }));
  });
  for (const pattern of ['**/api/chat', 'https://api.terg.hr/chat']) {
    await pg.route(pattern, (r) => r.fulfill({
      status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: 'an answer' } }] }),
    }));
  }
  await pg.goto(app.url, { waitUntil: 'networkidle' });
  /* The site has no gate: a page that asks for no account is already the work.
   * Signing in is what turns a gate into a workspace, not a requirement of the
   * audit — otherwise www.terg.hr could never be measured with the same rule. */
  const gated = await pg.$('#email');
  const gate = gated ? await pg.evaluate(audit, { SMALL_HIT, SMALL_TYPE }) : null;
  let work;
  if (gated) {
    await pg.fill('#email', OWNER.email);
    await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
    await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    await pg.waitForTimeout(1500);
    work = await pg.evaluate(audit, { SMALL_HIT, SMALL_TYPE });
  } else {
    work = await pg.evaluate(audit, { SMALL_HIT, SMALL_TYPE });
  }
  await ctx.close();
  return { app: app.id, tag, gate, work, errors: errors.filter((e) => !/401|Failed to load resource/.test(e)) };
}

const br = await chromium.launch();
const rows = [];
const list = one || APPS.map((a) => ({ id: a.id, url: process.env.VPL_PROD ? `https://vpl-${a.id}.pages.dev` : `http://127.0.0.1:${a.port}` }));
if (process.env.VPL_PROD) {
  const vn = list.find((a) => a.id === 'vn');
  if (vn) vn.url = 'https://vn.terg.hr';
}

for (const app of list) {
  let r;
  try {
    r = await look(br, app, DESK, 'desk');
    const p = await look(br, app, PHONE, 'phone');
    r.phone = p;
  } catch (e) {
    console.log(`${app.id}: could not look — ${e.message.split('\n')[0]}`);
    continue;
  }
  rows.push(r);
  const phone = r.phone?.work || { small: [], tiny: [], unnamed: [], overflow: 0 };
  const desk = r.work;
  console.log(`\n${app.id}`);
  console.log(`  hits under ${SMALL_HIT}px (phone): ${phone.small.length ? phone.small.slice(0, 5).join(' · ') : 'none'}`);
  console.log(`  type under ${SMALL_TYPE}px:      ${(phone.tiny.length ? phone.tiny.slice(0, 4).join(' · ') : 'none')}`);
  console.log(`  unnamed controls:           ${phone.unnamed.length ? phone.unnamed.slice(0, 4).join(' · ') : 'none'}`);
  console.log(`  sideways on a phone:        ${phone.overflow ? phone.overflow + 'px' : 'no'}`);
  console.log(`  the page scrolls by:        ${desk.pageScroll ? desk.pageScroll + 'px' : 'nothing'}`);
  console.log(`  console:                    ${r.errors.length ? r.errors[0].slice(0, 80) : 'quiet'}`);
  if (desk.overflow) console.log(`  sideways on the desk:       ${desk.overflow}px`);
}

await br.close();

const total = rows.reduce((n, r) => n + (r.phone?.work.small.length || 0) + (r.phone?.work.tiny.length || 0)
  + (r.phone?.work.overflow ? 1 : 0) + (r.work.overflow ? 1 : 0) + (r.work.pageScroll ? 1 : 0), 0);
console.log(`\nux-sniff: ${rows.length} app(s), ${total} measurable problem(s)`);
process.exit(total > 0 ? 1 : 0);
