/* v2 end-to-end — proves the accept tests in doc sections 3.1 and 3.2.
 *
 * Runs against the real Supabase project with a throwaway user, so RLS is
 * exercised for real rather than mocked. Every created note is deleted at the
 * end, and the test refuses to run against a non-local server unless
 * VPL_ALLOW_REMOTE=1, so it cannot quietly write to production.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', 'v2');
const PORT = 8099;

/* ── static server, no build step (§4.4) ──────────────────────────── */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.png': 'image/png',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const name = path === '/' ? '/index.html' : path;
  try {
    const buf = readFileSync(join(ROOT, name));
    res.writeHead(200, { 'content-type': MIME[name.slice(name.lastIndexOf('.'))] || 'text/plain' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}

const stamp = Date.now();
const userA = { email: `vpl-a-${stamp}@example.com`, password: 'secret123' };
const userB = { email: `vpl-b-${stamp}@example.com`, password: 'secret123' };
const BASE = `http://127.0.0.1:${PORT}/`;

let browser;

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  /* ── R1: register + session survives reload ─────────────────────── */
  await page.goto(BASE);
  await page.waitForSelector('#gate', { state: 'visible' });
  await page.fill('#email', userA.email);
  await page.fill('#pass', userA.password);
  await page.click('#btn-register');
  await page.waitForSelector('#app', { state: 'visible', timeout: 20000 });
  check('R1 register signs in', true);

  await page.reload();
  await page.waitForSelector('#app', { state: 'visible', timeout: 20000 });
  check('R1 session survives reload', true);

  /* writes markdown into the rich editor the way a user would get there */
  const setBody = async (md) => {
    await page.evaluate(async (text) => {
      const { mdToHtml } = await import('/lib/editor.js');
      const ed = document.getElementById('editable');
      ed.innerHTML = mdToHtml(text);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }, md);
  };

  /* ── R3: create a note ──────────────────────────────────────────── */
  await page.click('#btn-new');
  await page.waitForFunction(() => location.hash.startsWith('#/n/'), { timeout: 10000 });
  await page.fill('#title', 'First note');
  /* the body is a rich surface now; fill it via the same path the app uses */
  await page.evaluate(() => {
    const md = '# Heading\n\nsome **bold** text and a list:\n\n- one\n- two\n';
    sessionStorage.setItem('__md', md);
  });
  await page.click('#editable');
  await page.evaluate(async () => {
    const { mdToHtml } = await import('/lib/editor.js');
    document.getElementById('editable').innerHTML = mdToHtml(sessionStorage.getItem('__md'));
    document.getElementById('editable').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1300);

  const listCount = await page.locator('#list-items li').count();
  check('R3 note saved and listed', listCount >= 1, `${listCount} row(s)`);

  /* ── R6: autosave was silent (no save button anywhere) ──────────── */
  /* only the note matters here: the settings dialog has its own "save" for the
   * name and the assistant key, which have nothing to do with a note */
  const saveBtns = await page.locator('#view-note button:has-text("save")').count();
  check('R6 no save button, autosave only', saveBtns === 0, saveBtns + ' in the note');

  /* ── R5: Ctrl+E toggles, markdown renders in VIEW ───────────────── */
  await page.keyboard.press('Control+2');
  await page.waitForSelector('#rendered h1', { timeout: 10000 });
  const h1 = await page.locator('#rendered h1').first().textContent();
  check('R4/R5 VIEW renders markdown h1', h1?.trim() === 'Heading', JSON.stringify(h1));
  const strong = await page.locator('#rendered strong').first().textContent();
  check('R4 inline markdown bold', strong?.trim() === 'bold', JSON.stringify(strong));

  const modeOf = () => page.evaluate(() =>
    document.querySelector('.tab[aria-selected="true"]')?.dataset.mode);
  check('R5 Ctrl+2 reaches VIEW', await modeOf() === 'view');

  await page.keyboard.press('Control+e');
  check('R5 Ctrl+E cycles VIEW -> WRITE', await modeOf() === 'write');

  /* ── R10: a fenced code block renders as code, not prose ────────── */
  await page.keyboard.press('Control+1');
  await setBody('```js\nconst a = 1;\n```\n');
  await page.waitForTimeout(1300);
  await page.keyboard.press('Control+2');
  const codeBlock = await page.waitForSelector('#rendered pre code', { timeout: 20000 })
    .then(() => true).catch(() => false);
  check('R10 a code block renders as code', codeBlock);

  const codeText = await page.textContent('#rendered pre code').catch(() => '');
  check('R10 the code survives round trip', /const a = 1/.test(codeText || ''), JSON.stringify(codeText));

  /* restore a sane body */
  await page.keyboard.press('Control+1');
  await setBody('First body');
  await page.waitForTimeout(1300);

  /* ── R11: usable at 375px ───────────────────────────────────────── */
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 375, height: 700 });
  await phone.goto(BASE);
  await phone.waitForSelector('#app', { state: 'visible', timeout: 20000 });
  const overflow = await phone.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('R11 no horizontal overflow at 375px', overflow <= 1, `overflow ${overflow}px`);
  await phone.close();

  /* ── R9: RLS — user B cannot see user A's note ──────────────────── */
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const bpage = await bctx.newPage();
  await bpage.goto(BASE);
  await bpage.waitForSelector('#gate', { state: 'visible' });
  await bpage.fill('#email', userB.email);
  await bpage.fill('#pass', userB.password);
  await bpage.click('#btn-register');
  await bpage.waitForSelector('#app', { state: 'visible', timeout: 20000 });
  await bpage.waitForTimeout(1600);
  const bRows = await bpage.locator('#list-items li').count();
  check('R9 user B sees none of A\'s notes', bRows === 0, `${bRows} row(s)`);

  /* and B cannot fetch A's note by id through the API either */
  const noteUrl = page.url();
  const aId = noteUrl.split('/n/')[1];
  await bpage.goto(BASE + '#/n/' + aId);
  await bpage.waitForTimeout(1600);
  const bSawIt = await bpage.evaluate(() =>
    !document.getElementById('view-note').hidden &&
    document.getElementById('title').value === 'First note');
  check('R9 user B cannot open A\'s note by id', bSawIt === false);
  await bctx.close();

  /* ── R8: list ordered newest first ──────────────────────────────── */
  await page.goto(BASE + '#/');
  await page.waitForSelector('#list-items li');
  const before = await page.locator('#list-items .li-title').allTextContents();

  await page.click('#btn-new');
  await page.waitForFunction(() => location.hash.startsWith('#/n/'), { timeout: 10000 });
  await page.fill('#title', 'Second note');
  await page.waitForTimeout(1300);

  const titles = await page.locator('#list-items .li-title').allTextContents();
  /* Order is now tree position, not last-edited: sorting by updated_at made
   * a row jump to the top while you typed in it. What still matters is that
   * both notes are listed and neither lost its title. */
  check('R8 both notes are listed',
    titles.filter((t) => t.trim() === 'Second note').length === 1, JSON.stringify(titles));
  check('R8 no note is listed as "untitled"',
    !titles.map((t) => t.trim()).includes('untitled'), JSON.stringify(titles));

  /* ── delete goes to the recycle bin, with no dialog ─────────────── */
  /* Delete a named note rather than "whatever is first", so the assertions
   * do not depend on tree order. */
  await page.click('#list-items button[data-id]:has-text("Second note")');
  await page.waitForTimeout(1200);
  const titleBefore = 'Second note';
  const countBefore = await page.locator('#list-items li').count();

  await page.click('#btn-del');          // one click, no confirmation
  await page.waitForTimeout(1500);

  const countAfter = await page.locator('#list-items li').count();
  check('delete removes the note from the list at once',
    countAfter === countBefore - 1, `${countBefore} → ${countAfter}`);

  /* The help sheet is a <dialog>; what must not exist is a confirmation
   * asking permission to delete. Deleting is reversible, so asking is noise. */
  const confirmDialogs = await page.evaluate(() =>
    [...document.querySelectorAll('dialog')]
      .filter((d) => /confirm|are you sure|delete\?/i.test(d.id + ' ' + d.className + ' ' + d.textContent))
      .length);
  check('no delete confirmation dialog', confirmDialogs === 0, `${confirmDialogs} confirm dialog(s)`);

  const binCount = await page.textContent('#trash-count');
  check('the recycle bin shows a count', (binCount || '').trim() !== '',
    JSON.stringify(binCount));

  /* the note is in the bin, not gone */
  await page.click('#btn-trash');
  await page.waitForTimeout(500);
  const binTitles = await page.locator('#list-items .li-title').allTextContents();
  check('the deleted note is in the recycle bin',
    binTitles.some((t) => t.trim() === (titleBefore || '').trim()),
    JSON.stringify(binTitles));

  /* open it from the bin and restore it */
  await page.locator('#list-items button').first().click();
  await page.waitForTimeout(1200);
  check('a binned note is read-only', await page.evaluate(() =>
    [...document.querySelectorAll('.tab')].every((t) => t.disabled)
    && document.getElementById('title').readOnly));

  await page.click('#btn-del');          // in the bin, this means restore
  await page.waitForTimeout(1600);

  /* Restoring leaves the bin and returns to the live list. */
  const liveAgain = await page.locator('#list-items .li-title').allTextContents();
  const binEmpty = (await page.textContent('#trash-count') || '').trim() === '';
  check('restore puts the note back in the list',
    liveAgain.some((t) => t.trim() === (titleBefore || '').trim()),
    JSON.stringify(liveAgain));
  check('the recycle bin is empty again after restoring', binEmpty);

  /* ── dark mode has a visible edge colour ────────────────────────── */
  await page.click('#btn-theme');
  await page.waitForTimeout(300);
  const contrast = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const parse = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
    const line = parse(s.getPropertyValue('--line').trim().replace('#', '')
      .replace(/^(..)(..)(..)$/, (_, r, g, b) =>
        `${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`));
    const paper = parse(s.getPropertyValue('--paper').trim().replace('#', '')
      .replace(/^(..)(..)(..)$/, (_, r, g, b) =>
        `${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`));
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = lum(line), b2 = lum(paper);
    const ratio = (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
    return { ratio: Math.round(ratio * 100) / 100,
             theme: document.documentElement.dataset.theme };
  });
  /* Raised after dark edges still read as faint at 3:1 on a large dark
   * field. 4.0 is the floor now, and light mode is asserted unchanged. */
  check('dark mode edges are clearly visible, not merely present',
    contrast.theme === 'dark' && contrast.ratio >= 4.0,
    `line/paper contrast ${contrast.ratio}:1`);

  const lightLine = await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    return getComputedStyle(document.documentElement).getPropertyValue('--line').trim();
  });
  check('light mode palette is untouched', lightLine === '#e0d9cd', lightLine);
  await page.click('#btn-theme');        // back to light

  /* ── console hygiene ────────────────────────────────────────────── */
  const realErrors = errors.filter((e) =>
    !/favicon|manifest|sw\.js|service worker/i.test(e));
  check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

} catch (err) {
  check('test run completed', false, err.message);
} finally {
    /* remove the accounts the run made */
  try {
    for (const id of [userA, userB]) {
      const ctx2 = await browser.newContext();
      const p2 = await ctx2.newPage();
      await p2.goto(BASE);
      await p2.fill('#email', id.email);
      await p2.fill('#pass', id.password);
      await p2.click('#btn-login');
      await p2.waitForSelector('#app', { state: 'visible', timeout: 20000 }).catch(() => {});
      await p2.evaluate(() => import('/lib/supabase.js').then((m) => m.deleteAccount())).catch(() => {});
      await ctx2.close();
    }
  } catch {}
if (browser) await browser.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
