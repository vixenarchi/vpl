/* Sharing, checked against a real Supabase project and real browsers.
 *
 * Three accounts and one stranger:
 *   owner   writes a small knowledge tree and shares it
 *   viewer  has a view grant: reads, cannot write, cannot delete
 *   editor  has an edit grant: writes, owner sees it
 *   anon    no account at all, opens the public link and reads one chapter
 *
 * Every assertion is something a user or an attacker would notice.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 8093;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const srv = createServer((q, r) => {
  const u = new URL(q.url, 'http://x').pathname;
  const name = u === '/' ? '/index.html' : u;
  try {
    const body = readFileSync(join(ROOT, name));
    r.writeHead(200, { 'content-type': MIME[name.slice(name.lastIndexOf('.'))] || 'text/plain' });
    r.end(body);
  } catch { r.writeHead(404).end('not found'); }
});
await new Promise((ok) => srv.listen(PORT, '127.0.0.1', ok));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

const BASE = `http://127.0.0.1:${PORT}/`;
const stamp = Date.now();
const owner = `own-${stamp}@example.com`;
const viewer = `view-${stamp}@example.com`;
const editor = `edit-${stamp}@example.com`;

const browser = await chromium.launch();
const errors = [];

async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* a refused write is a test *expectation* here: the browser logs it as a
   * failed request, which is not an application error */
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });
  return page;
}

async function signIn(page, email) {
  await page.goto(BASE);
  await page.fill('#email', email);
  await page.fill('#pass', 'secret123');
  await page.click('#btn-register');
  await page.waitForSelector('#app', { state: 'visible', timeout: 20000 });
}

/* Signing in to an account that already exists. Since 0008 a note can only be
 * shared with an account that exists, so the two people are created *first* and
 * signed into afterwards — which is also the honest order in real life. */
async function logIn(page, email) {
  await page.goto(BASE);
  await page.fill('#email', email);
  await page.fill('#pass', 'secret123');
  await page.click('#btn-login');
  await page.waitForSelector('#app', { state: 'visible', timeout: 20000 });
}

async function makeAccount(email) {
  const p = await newPage();
  await signIn(p, email);
  await p.click('#btn-out');
  await p.waitForSelector('#btn-eye', { timeout: 20000 });
  await p.close();
}

/* ── the two people exist before anything is shared with them ──────── */
await makeAccount(viewer);
await makeAccount(editor);

/* ── owner: a knowledge tree ──────────────────────────────────────── */
const op = await newPage();
await signIn(op, owner);

const waitNew = (p) => p.waitForFunction(
  (h) => location.hash !== h && location.hash.startsWith('#/n/'), null, { timeout: 10000 });

async function create(p, title, asChild) {
  const prev = await p.evaluate(() => location.hash);
  await p.click(asChild ? '#btn-child' : '#btn-new');
  await p.waitForFunction((h) => location.hash !== h && location.hash.startsWith('#/n/'), prev, { timeout: 10000 });
  await p.fill('#title', title);
  await p.waitForTimeout(900);
}

const row = (p, title) => p.locator(`#list-items .tree-row:has(.li-title:text-is("${title}"))`);

await create(op, 'Project management', false);
await create(op, 'Waterfall', true);
await row(op, 'Project management').click();
await op.waitForFunction(() => document.getElementById('title').value === 'Project management');
await create(op, 'Agile', true);
await create(op, 'Kanban', true);
await row(op, 'Agile').click();
await op.waitForFunction(() => document.getElementById('title').value === 'Agile');
await create(op, 'Scrum', true);

/* something that must never be reachable from the share */
await row(op, 'Project management').click();
await op.waitForFunction(() => document.getElementById('title').value === 'Project management');
await op.click('#btn-new');
await op.waitForTimeout(300);
await op.waitForFunction(() => location.hash.startsWith('#/n/') && document.getElementById('title').value === '');
await op.fill('#title', 'secret plans');
await op.waitForTimeout(900);

/* ids of *this owner's* notes, not every publicly readable note */
const ids = await op.evaluate(async () => {
  const { listNotes, session } = await import('/lib/supabase.js');
  const me = (await session())?.user?.id;
  const all = await listNotes();
  return Object.fromEntries(all.filter((n) => n.user_id === me).map((n) => [n.title, n.id]));
});
check('the knowledge tree exists',
  ['Project management', 'Waterfall', 'Agile', 'Kanban', 'Scrum'].every((t) => ids[t]),
  Object.keys(ids).join(', '));

/* ── share the root: a public link, and two people ────────────────── */
await row(op, 'Project management').click();
await op.waitForFunction(() => document.getElementById('title').value === 'Project management');
await op.click('#btn-share');
await op.waitForSelector('#share[open]', { timeout: 5000 });

await op.check('#share-public');
await op.waitForFunction(() => !document.getElementById('share-link-row').hidden, { timeout: 10000 });
const link = await op.inputValue('#share-link');
check('a public link is generated', /#\/s\/[0-9a-z]{8,}$/i.test(link), link);

for (const [email, role] of [[viewer, 'view'], [editor, 'edit']]) {
  await op.fill('#share-email', email);
  await op.selectOption('#share-role', role);
  await op.click('#share-add button[type=submit]');
  await op.waitForFunction((e) => document.getElementById('share-list').textContent.includes(e),
    email, { timeout: 10000 });
}
const people = await op.$$eval('.share-person', (els) => els.map((e) => e.textContent.trim()));
check('both people are listed with a role', people.length === 2, JSON.stringify(people));
await op.click('#share-close');

/* ── the stranger with the link ───────────────────────────────────── */
const anon = await newPage();
await anon.goto(link);
await anon.waitForSelector('#reader:not([hidden])', { timeout: 20000 });
await anon.waitForFunction(() => document.getElementById('reader-title').textContent.trim() !== '', { timeout: 20000 });

check('the public link opens with no account',
  (await anon.textContent('#reader-title')).trim() === 'Project management',
  await anon.textContent('#reader-title'));

const chapters = await anon.$$eval('.reader-link', (as) => as.map((a) => a.textContent.trim()));
check('the whole chapter is listed', JSON.stringify(chapters) ===
  JSON.stringify(['Project management', 'Waterfall', 'Agile', 'Kanban', 'Scrum']),
  JSON.stringify(chapters));

check('the reader has no editor',
  (await anon.locator('#pane-write').count()) === 0
  || (await anon.locator('#pane-write').isHidden()),
  'write pane hidden');

/* a phone must not be able to scroll sideways, whatever the note contains */
const phone = await newPage();
await phone.setViewportSize({ width: 320, height: 720 });
await phone.goto(link);
await phone.waitForSelector('#reader:not([hidden])', { timeout: 20000 });
await phone.waitForFunction(() => !/loading…/.test(document.getElementById('reader-md').textContent),
  { timeout: 20000 }).catch(() => {});
await phone.waitForTimeout(400);
const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('the reader fits a 320 px phone', wide <= 0, wide + ' px over');
await phone.close();

/* a chapter has its own address inside the link */
await anon.click('.reader-link:text-is("Kanban")');
await anon.waitForFunction(() => document.getElementById('reader-title').textContent.trim() === 'Kanban',
  { timeout: 20000 });
check('a chapter can be linked to directly', anon.url().includes('#/s/'), ananonSafe(anon.url()));
function ananonSafe(u) { return u.replace(/#\/s\/([0-9a-z]{6})[0-9a-z]*/i, '#/s/$1…'); }

/* ── and what the database gives an anonymous reader ────────────────
 * A code is a capability, not a grant: it must not turn into a listing, and
 * it must still return exactly its own subtree when you have it. */
const ownerId = await op.evaluate(async () => (await import('/lib/supabase.js')).session().then((s) => s.user.id));
const shareCode = (link.match(/#\/s\/([0-9a-z]+)/) || [])[1] || '';

const anonTable = await anon.evaluate(async (me) => {
  const { listNotes } = await import('/lib/supabase.js');
  return (await listNotes()).filter((n) => n.user_id === me).map((n) => n.title);
}, ownerId);
check('a link is not a listing — the notes table shows an outsider nothing',
  anonTable.length === 0, JSON.stringify(anonTable));

const anonLink = await anon.evaluate(async (code) => {
  const { readShare } = await import('/lib/supabase.js');
  return [...new Set((await readShare(code)).map((n) => n.title))].sort();
}, shareCode);
check('the code itself reads exactly the shared subtree',
  anonLink.join(',') === ['Agile', 'Kanban', 'Project management', 'Scrum', 'Waterfall'].join(','),
  JSON.stringify(anonLink));
check('the shared note hides what sits outside it',
  !anonLink.includes('secret plans'));

/* ── the viewer: reads, and cannot write ──────────────────────────── */
const vp = await newPage();
await logIn(vp, viewer);
await vp.waitForTimeout(1500);

const viewerBadge = await row(vp, 'Project management').textContent().catch(() => '');
check('a shared note is marked in the list', /read only/i.test(viewerBadge), viewerBadge.trim());

await row(vp, 'Project management').click();
await vp.waitForFunction(() => document.getElementById('title').value === 'Project management', { timeout: 10000 });

const viewerUi = await vp.evaluate(() => ({
  locked: document.getElementById('title').readOnly,
  del: document.getElementById('btn-del').hidden,
  share: document.getElementById('btn-share').hidden,
  writeTab: document.querySelector('.tab[data-mode=write]').disabled,
  status: document.getElementById('note-status').textContent,
}));
check('a view grant opens read-only',
  viewerUi.locked && viewerUi.del && viewerUi.share && viewerUi.writeTab,
  JSON.stringify(viewerUi));

const viewerWrite = await vp.evaluate(async (id) => {
  try {
    const { updateNote } = await import('/lib/supabase.js');
    await updateNote(id, { title: 'defaced' });
    return 'allowed';
  } catch (e) { return 'refused'; }
}, ids['Kanban']);
check('the database refuses a write from a view grant', viewerWrite === 'refused', viewerWrite);

/* ── the editor: writes, and the owner sees it ────────────────────── */
const ep = await newPage();
await logIn(ep, editor);
await ep.waitForTimeout(1500);

const editorBadge = await row(ep, 'Project management').textContent().catch(() => '');
check('an edit grant is marked as such', /can edit/i.test(editorBadge), editorBadge.trim());

await row(ep, 'Kanban').click();
await ep.waitForFunction(() => document.getElementById('title').value === 'Kanban', { timeout: 10000 });
const editorUi = await ep.evaluate(() => ({
  locked: document.getElementById('title').readOnly,
  tab: document.querySelector('.tab[data-mode=write]').disabled,
}));
check('an edit grant opens editable', !editorUi.locked && !editorUi.tab, JSON.stringify(editorUi));

await ep.fill('#title', 'Kanban (edited by a friend)');
await ep.waitForTimeout(1400);

await op.reload();
await op.waitForSelector('#list-items li', { timeout: 20000 });
await op.waitForTimeout(1200);
const ownerSees = await op.$$eval('.li-title', (els) => els.map((e) => e.textContent));
check('the owner sees the editor\'s change',
  ownerSees.some((t) => t.includes('Kanban (edited by a friend)')), JSON.stringify(ownerSees));

/* the editor must not be able to bin someone else's note */
const editorBin = await ep.evaluate(async (id) => {
  try {
    const { updateNote } = await import('/lib/supabase.js');
    await updateNote(id, { deleted_at: new Date().toISOString() });
    return 'allowed';
  } catch (e) { return 'refused'; }
}, ids['Scrum']);
check('an edit grant cannot be used to delete', editorBin === 'refused', editorBin);

/* ── a stranger with an account sees nothing ──────────────────────── */
const stranger = await newPage();
await signIn(stranger, `nos-${stamp}@example.com`);
await stranger.waitForTimeout(1200);
const strangerRows = await stranger.$$eval('#list-items .li-title', (els) => els.map((e) => e.textContent));
check('an account with no grant sees nothing', strangerRows.length === 0, JSON.stringify(strangerRows));

/* ── switching the link off kills it ──────────────────────────────── */
await row(op, 'Project management').click();
await op.waitForFunction(() => document.getElementById('title').value === 'Project management');
await op.click('#btn-share');
await op.waitForSelector('#share[open]');
await op.uncheck('#share-public');
await op.waitForFunction(() => document.getElementById('share-link-row').hidden, { timeout: 10000 });
await op.click('#share-close');

await anon.goto(link);
await anon.waitForFunction(() =>
  /not live|no longer shared|could not/.test(document.getElementById('reader-md').textContent),
  { timeout: 20000 }).catch(() => {});
const dead = await anon.textContent('#reader-md');
check('a link switched off stops working', /not live|no longer shared/.test(dead), dead.slice(0, 60));

/* the people grants are still alive after the link dies */
const editorStill = await ep.evaluate(async () => {
  const { listNotes } = await import('/lib/supabase.js');
  return (await listNotes()).map((n) => n.title);
});
check('switching the public link off does not revoke people',
  editorStill.some((t) => t.startsWith('Project management')), JSON.stringify(editorStill.slice(0, 4)));

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${pass}/${pass + fail} sharing checks passed`);
/* leave nothing behind in the project's database */
for (const p of [op, vp, ep, stranger]) {
  await p.evaluate(() => import('/lib/supabase.js').then((m) => m.deleteAccount())).catch(() => {});
}
await browser.close();
srv.close();
process.exit(fail ? 1 : 0);
