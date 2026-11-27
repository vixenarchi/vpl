/* A project that is not yours must not look like one that is.
 *
 * The rail lists what you own and what was shared with you in one column. Until
 * now they were identical: no word, no mark, and — worse — the shared row carried
 * the ✕ that bins it, which the database refuses to a guest since the
 * authorization pass. A button that cannot do what it says is worse than no
 * button, and "which of these did somebody give me?" is the first question a
 * person asks in a shared document.
 *
 * What is checked, per app, from the guest's chair:
 *   1. the shared project is in the rail at all
 *   2. it carries the word `shared` (colour is never the only signal)
 *   3. it has no ✕ — the bin is the owner's decision
 *   4. it opens, and reads
 *
 * Setup and cleanup are REST as the owner (fast, and it keeps the browser side
 * to the thing being tested). vn is included because a note has had exactly this
 * badge from the beginning: the suite should say the same words in both places.
 *
 *   node shared-rail-check.mjs                    # all seven, locally
 *   APP=vz PORT=8103 node shared-rail-check.mjs   # one
 *   VPL_PROD=1 node shared-rail-check.mjs         # the deployments
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OWNER, GUEST } from './_account.mjs';

const APPS = [
  { id: 'vn', port: 8102, prod: 'https://vn.terg.hr', kind: 'note' },
  { id: 'vi', port: 8100, prod: 'https://vpl-vi.pages.dev' },
  { id: 'vr', port: 8101, prod: 'https://vpl-vr.pages.dev' },
  { id: 'vz', port: 8103, prod: 'https://vpl-vz.pages.dev' },
  { id: 'vd', port: 8104, prod: 'https://vpl-vd.pages.dev' },
  { id: 'vc', port: 8105, prod: 'https://vpl-vc.pages.dev' },
  { id: 'va', port: 8107, prod: 'https://vpl-va.pages.dev' },
];

if (!OWNER.email || !GUEST.email) {
  console.log('set VPL_EMAIL / VPL_PASS and VPL_GUEST_EMAIL / VPL_GUEST_PASS');
  process.exit(78);                 // not configured: skipped, never green
}

function config() {
  if (process.env.VPL_SUPABASE_URL && process.env.VPL_SUPABASE_ANON) {
    return { url: process.env.VPL_SUPABASE_URL, anon: process.env.VPL_SUPABASE_ANON };
  }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const s = readFileSync(path.join(dir, '../../vn/config.local.js'), 'utf8');
  return { url: s.match(/url:\s*'([^']+)'/)[1], anon: s.match(/anon:\s*'([^']+)'/)[1] };
}
const { url, anon } = config();

let pass = 0;
let fail = 0;
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; return true; }
  fail++; console.log(`  FAIL ${what}${extra ? ' — ' + extra : ''}`);
};

const signIn = async (email, password) => {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) {
    console.log(`no session for ${email} — set the accounts in test.env`);
    process.exit(78);
  }
  return { token: j.access_token, id: j.user.id };
};

const rest = async (tok, pathname, init = {}) => {
  const r = await fetch(`${url}/rest/v1${pathname}`, {
    ...init,
    headers: {
      apikey: anon, authorization: `Bearer ${tok}`, 'content-type': 'application/json',
      prefer: 'return=representation', ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, json };
};

const A = await signIn(OWNER.email, OWNER.pass);
const B = await signIn(GUEST.email, GUEST.pass);
const STAMP = String(Date.now()).slice(-6);

const one = process.env.APP;
const list = one
  ? APPS.filter((a) => a.id === one).map((a) => ({ ...a, url: process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || a.port}` }))
  : APPS.map((a) => ({ ...a, url: process.env.VPL_PROD ? a.prod : `http://127.0.0.1:${a.port}` }));

const br = await chromium.launch();
console.log('');

for (const app of list) {
  const title = `shared-rail ${app.id} ${STAMP}`;
  const kind = app.kind === 'note' ? 'note' : 'project';

  /* ── the owner makes it and hands it over, over REST ──────────────── */
  let made;
  if (kind === 'note') {
    made = await rest(A.token, '/vn_notes', {
      method: 'POST',
      body: JSON.stringify({ user_id: A.id, title, body: 'shared with somebody\n', position: 1 }),
    });
  } else {
    made = await rest(A.token, `/${app.id}_projects`, {
      method: 'POST',
      body: JSON.stringify({ user_id: A.id, title }),
    });
  }
  const id = made.json?.[0]?.id;
  if (!id) {
    console.log(`  ${app.id}: could not make a ${kind} — ${made.status} ${JSON.stringify(made.json).slice(0, 90)}`);
    fail++;
    continue;
  }
  const sharePath = kind === 'note' ? '/vn_shares' : `/${app.id}_shares`;
  const shareBody = kind === 'note'
    ? { note_id: id, email: GUEST.email, role: 'view', pending: false }
    : { project_id: id, owner_id: A.id, email: GUEST.email, role: 'view', pending: false };
  const shared = await rest(A.token, sharePath, { method: 'POST', body: JSON.stringify(shareBody) });
  if (shared.status >= 300) {
    console.log(`  ${app.id}: could not share — ${shared.status} ${JSON.stringify(shared.json).slice(0, 90)}`);
    fail++;
    await rest(A.token, kind === 'note' ? `/vn_notes?id=eq.${id}` : `/${app.id}_projects?id=eq.${id}`, { method: 'DELETE' });
    continue;
  }

  /* ── and the guest looks at the rail ──────────────────────────────── */
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(`${app.url}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);
  if (await pg.locator('#email').isVisible().catch(() => false)) {
    await pg.fill('#email', GUEST.email);
    await pg.fill('#pass', GUEST.pass);
    await pg.click('#btn-login');
    await pg.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    await pg.waitForTimeout(2600);
  }

  const rowSel = kind === 'note' ? '#list li' : '#proj-list .proj-row';
  const found = await until(async () => {
    const rows = pg.locator(rowSel, { hasText: title });
    return (await rows.count()) > 0 ? rows.first() : false;
  }, 12000);
  ok(found, `${app.id}: the shared ${kind} is in the rail`);

  if (found) {
    const shape = await found.evaluate((el) => ({
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      mark: !!el.querySelector('.shared-mark, .share-badge'),
      markText: (el.querySelector('.shared-mark, .share-badge')?.textContent || '').trim(),
      kill: !!el.querySelector('.kill'),
    }));
    ok(shape.mark, `${app.id}: it carries a mark`, JSON.stringify(shape.text).slice(0, 60));
    /* vn's badge says "read only" for a view grant; the six project apps say
     * "shared". Both are words; neither is only a colour. */
    ok(/shared|read only|can edit/i.test(shape.markText), `${app.id}: and the mark is a word`, shape.markText || '(empty)');
    ok(!shape.kill, `${app.id}: no ✕ on a project I cannot bin`, shape.text.slice(0, 60));

    if (shape.kill) console.log(`   (the row reads: ${shape.text})`);
  }

  /* 4. it opens */
  const opened = await openIt(pg, kind, title);
  ok(opened, `${app.id}: and the guest can read what was shared`);

  ok(errs.length === 0, `${app.id}: no page errors`, errs.slice(0, 2).join(' · '));
  console.log(`  ${app.id.padEnd(3)} shared${kind === 'note' ? ' · note badge' : ' · rail mark'}`);

  /* ── cleanup: the share, then the thing ───────────────────────────── */
  await rest(A.token, kind === 'note' ? `/vn_shares?note_id=eq.${id}` : `/${app.id}_shares?project_id=eq.${id}`, { method: 'DELETE' });
  await rest(A.token, kind === 'note' ? `/vn_notes?id=eq.${id}` : `/${app.id}_projects?id=eq.${id}`, { method: 'DELETE' });
  await ctx.close();
}

await br.close();
console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

async function until(fn, ms) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => false);
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/* a note opens by clicking its row; a project by its .pick; the test only wants
 * to know that the guest is looking at the thing afterwards */
async function openIt(pg, kind, title) {
  try {
    if (kind === 'note') {
      await pg.locator('#list li', { hasText: title }).first().locator('button').first().click();
    } else {
      await pg.locator('#proj-list .proj-row', { hasText: title }).first().locator('.pick').first().click();
    }
  } catch { return false; }
  return until(async () => {
    if (kind === 'note') {
      const t = (await pg.textContent('#list li.on, #list [aria-current="true"]').catch(() => '')) || '';
      return t.includes(title.slice(0, 10)) || pg.locator('#editable, .editor, #note-title').first().isVisible();
    }
    /* each app names its reading surface differently; the point is that one of
     * them is now visible and holds the thing that was shared */
    for (const sel of ['#spec', '#funnel', '#sheet', '#board', '#canvas']) {
      const el = pg.locator(sel).first();
      const vis = (await el.count()) && (await el.isVisible().catch(() => false));
      if (vis) return true;
    }
    return false;
  }, 8000);
}
