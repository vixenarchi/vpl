/* vpl · vi — ideas, one line each.
 *
 * The second app of the suite, and deliberately the smallest thing that can
 * stand on its own: it shares the shell's palette and page foundation, the
 * Supabase project (so the signed-in person is the same), and nothing else.
 * Its data lives in vi_ideas; it never reads vn_notes.
 *
 * No framework, no build step — the same rules as vn, kept short enough to
 * read in one sitting.
 */

const DB = '/lib/db.js';
const $ = (id) => document.getElementById(id);

const el = {
  gate: $('gate'), gateForm: $('gate-form'), email: $('email'), pass: $('pass'),
  gateMsg: $('gate-msg'), btnLogin: $('btn-login'), btnRegister: $('btn-register'),
  gateTheme: $('gate-theme'),
  app: $('app'), addForm: $('add-form'), idea: $('idea'), ideas: $('ideas'),
  empty: $('empty'), count: $('count'), who: $('who'),
  btnTheme: $('btn-theme'), btnOut: $('btn-out'),
};

let db = null;
let session = null;
let rows = [];

/* ── boot ─────────────────────────────────────────────────────────── */
boot();

async function boot() {
  wireTheme();
  el.gateForm.addEventListener('submit', (e) => { e.preventDefault(); signIn(); });
  el.btnRegister.addEventListener('click', signUp);
  el.btnOut.addEventListener('click', async () => { await db.signOut(); });
  el.addForm.addEventListener('submit', addIdea);

  db = await import(DB);
  try { session = await db.session(); } catch { session = null; }
  db.onAuthChange((s) => { session = s; s ? enter() : leave(); });

  if (session) enter(); else leave();
}

function enter() {
  el.gate.hidden = true;
  el.app.hidden = false;
  paintTheme();
  el.who.textContent = (session.user.email || '').replace(/@vpl\.local$/, '');
  load();
}

function leave() {
  el.app.hidden = true;
  el.gate.hidden = false;
  el.ideas.innerHTML = '';
  rows = [];
  paintTheme();
}

/* ── data ─────────────────────────────────────────────────────────── */
async function load() {
  try {
    rows = await db.listIdeas();
  } catch (err) {
    el.gateMsg.textContent = err.message;
    rows = [];
  }
  paint();
}

function paint() {
  el.ideas.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'idea' + (r.done ? ' done' : '');
    li.dataset.id = r.id;

    const tick = document.createElement('button');
    tick.className = 'tick';
    tick.type = 'button';
    tick.textContent = r.done ? '✓' : '·';
    tick.title = r.done ? 'mark as open' : 'mark as done';
    tick.addEventListener('click', () => toggle(r));

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = r.text;

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'delete';
    del.addEventListener('click', () => remove(r));

    li.append(tick, text, del);
    el.ideas.append(li);
  }
  const open = rows.filter((r) => !r.done).length;
  el.count.textContent = rows.length
    ? `${open} open · ${rows.length - open} done`
    : '';
  el.empty.hidden = rows.length > 0;
}

async function addIdea(e) {
  e.preventDefault();
  const text = el.idea.value.trim();
  if (!text) return;
  el.idea.value = '';
  const row = await db.addIdea(text);
  rows = [row, ...rows];
  paint();
}

async function toggle(r) {
  const next = await db.setIdeaDone(r.id, !r.done);
  rows = rows.map((x) => (x.id === next.id ? next : x));
  paint();
}

async function remove(r) {
  await db.deleteIdea(r.id);
  rows = rows.filter((x) => x.id !== r.id);
  paint();
}

/* ── sign in / out ────────────────────────────────────────────────── */
async function signIn() {
  el.gateMsg.textContent = '';
  const email = toAuthEmail(el.email.value);
  const pass = el.pass.value;
  if (!email || pass.length < 6) { el.gateMsg.textContent = 'wrong email or password.'; return; }
  el.btnLogin.disabled = true;
  try {
    await db.signIn(email, pass);
  } catch {
    el.gateMsg.textContent = 'wrong email or password.';
  } finally {
    el.btnLogin.disabled = false;
  }
}

async function signUp() {
  el.gateMsg.textContent = '';
  const email = toAuthEmail(el.email.value);
  const pass = el.pass.value;
  if (!email) { el.gateMsg.textContent = 'that does not look like an address or a name.'; return; }
  if (pass.length < 6) { el.gateMsg.textContent = 'a password needs six characters or more.'; return; }
  el.btnRegister.disabled = true;
  try {
    await db.signUp(email, pass);
  } catch (err) {
    el.gateMsg.textContent = /already/i.test(err.message)
      ? 'that account already exists — sign in instead.' : err.message;
  } finally {
    el.btnRegister.disabled = false;
  }
}

/* A bare name becomes a name@vpl.local identity, the same rule vn uses, so an
 * account made in one app can sign in to the other. */
function toAuthEmail(value) {
  const v = (value || '').trim().toLowerCase();
  if (!v) return '';
  if (!v.includes('@')) return `${v.replace(/[^a-z0-9._-]/g, '')}@vpl.local`;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : '';
}

/* ── theme, the same switch as everywhere in the suite ───────────── */
function wireTheme() {
  for (const b of [el.btnTheme, el.gateTheme]) {
    if (b) b.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('vpl.theme', dark ? 'light' : 'dark'); } catch {}
      paintTheme();
    });
  }
  paintTheme();
}

function paintTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'switch to light' : 'switch to dark';
  for (const b of [el.btnTheme, el.gateTheme]) {
    if (!b) continue;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.textContent = dark ? '☀' : '◐';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1a1816' : '#faf8f4');
}
