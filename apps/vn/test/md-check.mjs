/* The markdown underneath: text stays text, blank lines survive, the two
 * views keep the same shape, and a paste is cleaned at the door.
 *
 *   PORT=8102 VPL_EMAIL=… VPL_PASS=… node md-check.mjs
 */
import { chromium } from 'playwright';

const PORT = process.env.PORT || 8099;
const BASE = `http://127.0.0.1:${PORT}/`;
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;
if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to a test account, e.g.\n' +
    '  VPL_EMAIL=you@example.com VPL_PASS=… node md-check.mjs');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#pass', PASS);
await page.click('#btn-login');
await page.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await page.waitForTimeout(1200);

/* leftovers from a run that failed midway would be picked up by the filter
 * below, and the note under test must be the only 'md probe' there is */
await page.evaluate(async () => {
  const db = await import('/lib/supabase.js');
  const rows = await db.listNotes().catch(() => []);
  for (const n of rows || []) {
    if (/^md probe/.test(n.title || '')) await db.deleteNote(n.id).catch(() => {});
  }
});

/* how the app itself stores a gap: an empty paragraph is a line holding one
 * non-breaking space, a single blank line is only the separator between blocks */
const BODY = [
  'vidi http://nesto.hr i www.nesto.domena — to je tekst.',
  '',
  '\u00a0',
  '',
  'ovo je link: [terg](https://terg.hr)',
  '',
  '\u00a0',
  '',
  '\u00a0',
  '',
  'nakon dva prazna reda',
].join('\n');

const id = await page.evaluate(async (body) => {
  const db = await import('/lib/supabase.js');
  const n = await db.createNote({ title: 'md probe', body });
  return n.id;
}, BODY);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const open = async () => {
  await page.evaluate(() => {
    const q = document.getElementById('q');
    q.value = 'md probe';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await page.locator('#list-items .tree-row button[data-id]').first().click();
  await page.waitForTimeout(900);
};

/* ── text stays text ──────────────────────────────────────────────── */
await open();
await page.click('[data-mode="view"]');
await page.waitForTimeout(700);
const links = await page.evaluate(() => {
  const as = [...document.querySelectorAll('#rendered a')].map((a) => a.textContent);
  const text = document.getElementById('rendered').textContent;
  return { as, text };
});
check(links.as.length === 1 && links.as[0] === 'terg',
  'a bare url is text; only a marked link is a link', JSON.stringify(links.as));
check(/http:\/\/nesto\.hr/.test(links.text) && /www\.nesto\.domena/.test(links.text),
  'the url is still readable, as the words it is');

/* ── the two surfaces have one shape ──────────────────────────────── */
const shape = async (where) => page.evaluate((w) => {
  const root = document.getElementById(w === 'view' ? 'rendered' : 'editable');
  const ps = [...root.querySelectorAll('p')];
  const cs = getComputedStyle(root);
  return {
    line: cs.lineHeight,
    size: cs.fontSize,
    margin: ps[0] ? getComputedStyle(ps[0]).marginBottom : '',
    paragraphs: ps.length,
  };
}, where);

const viewShape = await shape('view');
await page.click('[data-mode="write"]');
await page.waitForTimeout(600);
const writeShape = await shape('write');
check(viewShape.line === writeShape.line && viewShape.size === writeShape.size,
  'write and view share line height and text size',
  `${JSON.stringify(writeShape)} vs ${JSON.stringify(viewShape)}`);
check(viewShape.margin === writeShape.margin,
  'write and view share the paragraph margin', `${writeShape.margin} / ${viewShape.margin}`);

/* ── blank lines survive a save and a reload ──────────────────────── */
const gapsBefore = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('#editable p')];
  return { lines: ps.length, blanks: ps.filter((p) => !p.textContent.trim()).length };
});
check(gapsBefore.blanks >= 2, 'the two blank lines are there when the note opens',
  JSON.stringify(gapsBefore));

/* type a third blank line, let it save, then open the note again */
await page.click('#editable');
await page.keyboard.press('Control+End');
for (const _ of [1, 2]) await page.keyboard.press('Enter');
await page.type('#editable', 'kraj');
await page.waitForTimeout(1600);                    // autosave is 800 ms

await page.evaluate(() => { window.location.hash = ''; });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await open();
const gapsAfter = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('#editable p')];
  const words = ps.filter((p) => p.textContent.trim());
  const boxes = words.map((p) => p.getBoundingClientRect());
  const last = boxes.length - 1;
  return {
    lines: ps.length,
    blanks: ps.filter((p) => !p.textContent.trim()).length,
    ends: ps.length > 0 && /kraj/.test(ps[ps.length - 1].textContent),
    /* the space between the words before the gap and the word after it, in
     * lines — one line height is "no gap at all" */
    gap: last > 0
      ? Math.round(((boxes[last].top - boxes[last - 1].bottom) / (boxes[last].height || 1)) * 10) / 10
      : 0,
  };
});
check(gapsAfter.ends, 'the words after the gap are still there');
check(gapsAfter.blanks >= gapsBefore.blanks,
  'no blank line is eaten by saving',
  `before ${gapsBefore.blanks}, after ${gapsAfter.blanks}`);
check(gapsAfter.gap >= 1,
  'the gap is still a gap — the paragraph after it does not sit on the one before',
  `gap ${gapsAfter.gap} lines`);

/* ── N / MD ───────────────────────────────────────────────────────── */
const labelBefore = await page.textContent('#btn-src');
check(labelBefore.trim() === 'N', 'the bar says N while the surface is rich text', labelBefore);

await page.click('#btn-src');
await page.waitForTimeout(400);
const src = await page.evaluate(() => ({
  label: document.getElementById('btn-src').textContent.trim(),
  pressed: document.getElementById('btn-src').getAttribute('aria-pressed'),
  visible: !document.getElementById('md-source').hidden,
  richHidden: document.getElementById('editable').hidden,
  value: document.getElementById('md-source').value,
  bg: getComputedStyle(document.getElementById('btn-src')).backgroundColor,
  fg: getComputedStyle(document.getElementById('btn-src')).color,
}));
check(src.label === 'M' && src.pressed === 'true', 'pressing it turns the button into M');
check(src.visible && src.richHidden, 'the markdown surface replaces the rich one');
check(/\[terg\]\(https:\/\/terg\.hr\)/.test(src.value), 'it shows the markdown that is stored',
  src.value.slice(0, 60));
check(src.bg !== src.fg, 'the pressed state is a different colour, not a different weight');

await page.click('#md-source');
await page.keyboard.press('Control+End');
await page.type('#md-source', '\n\n## dodano u izvoru');
await page.waitForTimeout(1200);
const stored = await page.evaluate(() => document.getElementById('md-source').value);
check(/## dodano u izvoru/.test(stored), 'what is typed in the source is the note');
check(!/[¶·]/.test(stored), 'no mark of any kind is saved into the note');

await page.click('#btn-src');                // back to rich text
await page.waitForTimeout(500);
const asHeading = await page.evaluate(() =>
  [...document.querySelectorAll('#editable h2')].map((h) => h.textContent));
check(asHeading.includes('dodano u izvoru'),
  'markdown typed in the source is a heading in the rich surface', JSON.stringify(asHeading));

/* ── a paste is cleaned at the door ───────────────────────────────── */
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.evaluate(async () => {
  const ed = document.getElementById('editable');
  ed.focus();
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  /* a word processor's html: fonts, colours, a span where markdown wants a
   * strong — the shapes that used to show for a while and then vanish */
  const html = '<p style="color:red;font-family:Georgia"><span style="font-weight:700">podebljano</span>' +
    ' i <a href="https://terg.hr">link</a> i <span style="color:blue">plavo</span></p>';
  const item = new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob(['podebljano i link i plavo'], { type: 'text/plain' }),
  });
  await navigator.clipboard.write([item]);
});
await page.keyboard.press('Control+V');
await page.waitForTimeout(900);
const pasted = await page.evaluate(() => {
  const ed = document.getElementById('editable');
  return {
    bold: [...ed.querySelectorAll('strong')].some((s) => /podebljano/.test(s.textContent)),
    spans: ed.querySelectorAll('span[style]').length,
    link: [...ed.querySelectorAll('a')].some((a) => a.getAttribute('href') === 'https://terg.hr'),
    coloured: [...ed.querySelectorAll('[style]')].length,
    styled: [...ed.querySelectorAll('[style]')].map((e) => e.outerHTML.slice(0, 80)),
    styled: [...ed.querySelectorAll('[style]')].map((e) => e.outerHTML.slice(0, 70)),
  };
});
check(pasted.bold, 'a pasted bold word is still bold');
check(pasted.link, 'a pasted link is still a link');
check(pasted.coloured === 0, 'the colours and fonts that markdown cannot hold are gone at once',
  JSON.stringify(pasted.styled));

await page.evaluate(() => {
  const q = document.getElementById('q');
  q.value = 'md probe';
  q.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(400);

await page.waitForTimeout(1200);
const stable = await page.evaluate(() => document.getElementById('editable').innerHTML);
check(/podebljano/.test(stable), 'what is on screen after the paste is what is kept');

/* ── the settings switch is the icon again ────────────────────────── */
await page.click('#btn-ai');
await page.waitForTimeout(500);
const modeBtn = await page.evaluate(() => {
  const b = document.querySelector('#ai-dialog [data-a=mode]');
  return b ? { text: b.textContent.trim(), size: parseFloat(getComputedStyle(b).fontSize) } : null;
});
check(modeBtn && /[◐☀]/.test(modeBtn.text),
  'the dark/normal switch inside settings is the icon, not a word',
  JSON.stringify(modeBtn));
check(modeBtn && modeBtn.size >= 13, 'and the icon is big enough to read', String(modeBtn && modeBtn.size));
await page.keyboard.press('Escape');

/* ── a link is an address, not a way in ─────────────────────────────
 * VN-1: the editor's own markdown-to-html let a note carry
 * `[x](" autofocus onfocus="alert(1)" x=")` — a quote closed href="…" early
 * and the rest of it became attributes that run on open. The note is written
 * straight into the database here, because the point is a note somebody else
 * could have written. */
const PAYLOADS = [
  '[x](javascript:alert%281%29)',
  '[x](" autofocus onfocus="alert(1)" x=")',
  'plain <img src=x onerror=alert(1)> text',
];
const xssId = await page.evaluate(async (body) => {
  const db = await import('/lib/supabase.js');
  const n = await db.createNote({ title: 'xss probe', body, parent_id: null });
  await db.updateNote(n.id, { body });
  return n.id;
}, PAYLOADS.join('\n\n'));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#app', { state: 'visible', timeout: 25000 });
await page.waitForTimeout(900);
await page.evaluate(async (id) => {
  const db = await import('/lib/supabase.js');
  await db.openNote(id);
}, xssId).catch(() => {});
/* open it the way a person would: through the list */
await page.locator(`[data-id="${xssId}"]`).click();
await page.waitForTimeout(600);

const surface = await page.evaluate(() => {
  const ed = document.getElementById('editable');
  if (!ed) return { html: '', bad: ['no editor'] };
  const bad = [];
  for (const el of ed.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) bad.push(`${el.tagName} ${a.name}`);
      if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) bad.push(`${el.tagName} ${a.name}=${a.value}`);
    }
  }
  const title = document.getElementById('title')?.value ?? '';
  return { html: ed.innerHTML.slice(0, 400), bad, text: ed.textContent, title };
});
check(surface.bad.length === 0, 'a note cannot carry a way in: no on* and no javascript: in the editor',
  JSON.stringify(surface.bad) + ' ' + surface.html);
check(surface.title === 'xss probe', 'the probe note is the one on screen', JSON.stringify(surface.title));
check(/onerror=alert/.test(surface.text), 'an address nobody meant is dropped, the words stay',
  JSON.stringify(surface.text.slice(0, 200)));
check(!/javascript:/i.test(surface.html), 'javascript: never reaches the editor at all',
  surface.html);

await page.evaluate(async (id) => {
  const db = await import('/lib/supabase.js');
  await db.deleteNote(id);
}, xssId).catch(() => {});

/* ── tidy ─────────────────────────────────────────────────────────── */
await page.evaluate(async (probe) => {
  const db = await import('/lib/supabase.js');
  await db.deleteNote(probe);
}, id).catch(() => {});

check(errors.length === 0, 'no page errors', errors.join(' | '));

console.log(`\n${pass}/${pass + fail} markdown checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
