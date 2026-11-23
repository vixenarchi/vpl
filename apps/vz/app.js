import * as settings from './vendor/settings.js';
import * as engine from './vendor/engine.js';
import * as who from './vendor/who.js';
import { mountDock } from './vendor/dock.js';
/* vpl · vz — zed. A project is a dictionary; a row is a key and a value.
 *
 * The screen is one list. Keys are monospace and always visible; values stay
 * folded (either because the project hides them, or because a long value would
 * eat the sheet) and open one at a time. Nothing here renders markdown: the
 * value is text, shown as text.
 */

import * as db from './lib/db.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PER = 20;

const S = {
  session: null,
  projects: [],
  project: null,
  pairs: [],
  bin: [],
  shares: [],
  role: null,
  guest: null,          // null | 'share' | 'public'
  q: '',
  page: 0,
  openId: null,         // the row whose value is unfolded
  editId: null,         // the row being edited
  showAll: false,
  saveTimer: null,
  binTimer: null,
};

/* ── window dressing ──────────────────────────────────────────────── */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 2200);
}

function msg(el, text, state = '') {
  el.textContent = text;
  if (state) el.dataset.state = state; else delete el.dataset.state;
}

function applyTheme() {
  const now = document.documentElement.dataset.theme;
  const next = now === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('vpl.theme', next); } catch { /* private mode */ }
}

/* Phones capitalise the first letter of a field and computers do not. Names and
 * addresses are compared in lower case; the password never is. A bare name is
 * an account at @vpl.local, exactly as in vn, vi and vr. */
function lowerField(el) {
  el.addEventListener('input', () => {
    const low = el.value.toLowerCase();
    if (low === el.value) return;
    const at = el.selectionStart;
    el.value = low;
    try { el.setSelectionRange(at, at); } catch { /* not focusable yet */ }
  });
}

function toAuthEmail(v) {
  const t = v.trim();
  return t.includes('@')
    ? t.toLowerCase()
    : t.toLowerCase().replace(/\s+/g, '') + '@vpl.local';
}

/* The name in the corner is the suite's, not this app's (vendor/who.js):
 * the name Google gave us, else the address tidied, else a letter. */
function displayName(session) {
  return who.whoLabel(session);
}

/* Supabase says "User already registered" and "Unable to validate email
 * address"; a person deserves the same fact in fewer words. */
function plainAuthError(err) {
  const m = String(err?.message || err || '');
  if (/already registered/i.test(m)) return 'that address already has an account — sign in instead';
  if (/invalid format|validate email/i.test(m)) return 'that does not look like an address';
  if (/invalid login credentials/i.test(m)) return 'wrong address or password';
  return m || 'could not sign in';
}

function until(fn, ms = 8000) {
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v;
      try { v = fn(); } catch { v = false; }
      if (v) return resolve(v);
      if (performance.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(tick, 60);
    };
    tick();
  });
}

/* ── boot ─────────────────────────────────────────────────────────── */
async function boot() {
  $('#btn-theme').onclick = applyTheme;
  $('#gate-theme').onclick = applyTheme;
  lowerField($('#email'));
  wireGate();

  const params = new URLSearchParams(location.search);
  const shareCode = params.get('s');
  const pubCode = params.get('p');
  if (shareCode) return openGuest(shareCode, 'share');
  if (pubCode) return openGuest(pubCode, 'public');

  S.session = await db.session().catch(() => null);
  if (!S.session) { showGate(); return; }
  await enterApp();
}

function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  $('#email').focus();
}

function wireGate() {
  $('#gate-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = toAuthEmail($('#email').value);
    const pass = $('#pass').value;
    msg($('#gate-msg'), 'signing in…', 'busy');
    try {
      await db.signIn(email, pass);
      $('#gate-msg').textContent = '';
      S.session = await db.session();
      await enterApp();
    } catch (err) {
      msg($('#gate-msg'), plainAuthError(err), 'bad');
    }
  };
  $('#btn-register').onclick = async () => {
    const email = toAuthEmail($('#email').value);
    const pass = $('#pass').value;
    if (!email || pass.length < 6) {
      return msg($('#gate-msg'), 'a name or an address, and a password of six characters or more', 'bad');
    }
    try {
      await db.signUp(email, pass);
      S.session = await db.session();
      await enterApp();
    } catch (err) {
      msg($('#gate-msg'), plainAuthError(err), 'bad');
    }
  };
  $('#btn-google').onclick = async () => {
    try { await db.signInWithGoogle(); } catch (err) { msg($('#gate-msg'), err.message, 'bad'); }
  };
}

async function enterApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = displayName(S.session);
  $('#who').title = S.session?.user?.email || '';
  await loadProjects();
  const last = localStorage.getItem('vz.last');
  const open = S.projects.find((p) => p.id === last) || S.projects[0];
  if (open) await openProject(open.id);
  else renderWelcome();
}

/* ── the rail ─────────────────────────────────────────────────────── */
async function loadProjects() {
  S.projects = await db.listProjects();
  renderRail();
}

function renderRail() {
  const list = $('#proj-list');
  list.innerHTML = '';
  for (const p of S.projects) {
    const li = document.createElement('li');
    li.className = 'proj-row' + (p.id === S.project?.id ? ' on' : '');
    li.dataset.id = p.id;
    li.innerHTML = `<button class="pick" type="button">${esc(p.title || 'untitled')}</button>`
      + (p.published ? '<span class="n" title="published">pub</span>' : '')
      + '<button class="kill" type="button" title="delete the project">✕</button>';
    list.append(li);
  }
  $('#proj-none').hidden = S.projects.length > 0;
  $('#btn-new-project').hidden = !!S.guest;
  const count = S.bin.length;
  $('#bin-rail').hidden = !S.project || !!S.guest;
  $('#bin-count').textContent = count ? String(count) : '';
}

$('#proj-list').addEventListener('click', async (e) => {
  const li = e.target.closest('.proj-row');
  if (!li) return;
  if (e.target.classList.contains('kill')) {
    const p = S.projects.find((x) => x.id === li.dataset.id);
    if (!p) return;
    if (!confirm(`delete "${p.title}" and every key in it?`)) return;
    await db.deleteProject(p.id);
    if (S.project?.id === p.id) { S.project = null; S.pairs = []; }
    await loadProjects();
    if (S.projects[0]) await openProject(S.projects[0].id);
    else renderWelcome();
    return;
  }
  await openProject(li.dataset.id);
});

$('#btn-new-project').onclick = async () => {
  const p = await db.createProject('untitled');
  await loadProjects();
  await openProject(p.id);
  $('#proj-title').focus();
  $('#proj-title').select();
};

$('#btn-first').onclick = () => $('#btn-new-project').click();

function renderWelcome() {
  $('#welcome').hidden = false;
  $('#spec').hidden = true;
  $('#binview').hidden = true;
  renderRail();
}

/* ── one project ──────────────────────────────────────────────────── */
async function openProject(id) {
  const project = S.projects.find((p) => p.id === id) || null;
  if (!project) return renderWelcome();
  S.project = project;
  S.role = await db.roleOn(project).catch(() => null);
  S.guest = null;
  S.q = '';
  $('#q').value = '';
  S.page = 0;
  S.openId = null;
  S.editId = null;
  S.showAll = project.hide_values === false;
  localStorage.setItem('vz.last', id);
  history.replaceState(null, '', location.pathname);

  $('#welcome').hidden = true;
  $('#binview').hidden = true;
  $('#spec').hidden = false;
  $('#projects').hidden = false;
  $('#btn-projects').hidden = false;
  document.body.dataset.guest = '';

  applyRole();
  await refresh();
}

function applyRole() {
  const owner = S.role === 'owner';
  const mayWrite = owner || S.role === 'edit';
  const guest = !!S.guest;
  document.body.dataset.role = guest ? 'guest' : S.role || 'view';
  document.body.dataset.guest = guest ? '1' : '';
  $('#proj-title').readOnly = !owner;
  $('#proj-title').classList.toggle('ro', !owner);
  $('#add').hidden = !mayWrite;
  $('#btn-share').hidden = !owner;
  $('#btn-paste').hidden = !mayWrite;

  const banner = $('#guest-banner');
  if (guest && S.guest === 'public') {
    banner.hidden = false;
    banner.innerHTML = 'a <b>published</b> project — anyone with the link reads it. '
      + 'You are reading a copy of the sheet, not the sheet itself.';
  } else if (guest && S.role === 'edit') {
    banner.hidden = false;
    banner.innerHTML = 'shared with you — you may <b>write</b> keys and values. '
      + 'The name, hiding, publishing and emptying the bin stay with the owner.';
  } else if (guest) {
    banner.hidden = false;
    banner.innerHTML = 'shared with you, <b>read only</b>. '
      + (S.session
        ? '<b>copy to mine</b> makes a project where the keys are yours.'
        : '<b>copy</b> takes the sheet as text; <b>copy to mine</b> needs an account.');
  } else if (S.role === 'edit') {
    banner.hidden = false;
    banner.innerHTML = 'shared with you — you may <b>write</b> keys and values and move them to the bin. '
      + 'The name, hiding, publishing and emptying the bin stay with the owner.';
  } else if (S.role === 'view') {
    banner.hidden = false;
    banner.innerHTML = 'shared with you, <b>read only</b>.';
  } else {
    banner.hidden = true;
  }
  $('#btn-own').hidden = owner || !S.project;
}

/* ── data in, sheet out ───────────────────────────────────────────── */
let _loadSeq = 0;

async function refresh() {
  if (!S.project) return;
  /* Two saves can be in the air at once (type, Enter, type, Enter). The older
   * answer must not paint over the newer one, so only the last request counts. */
  const seq = ++_loadSeq;
  const pairs = await db.listPairs(S.project.id);
  const bin = S.role === 'owner' || S.role === 'edit'
    ? await db.listPairs(S.project.id, { bin: true }).catch(() => [])
    : [];
  if (seq !== _loadSeq) return;
  S.pairs = pairs;
  S.bin = bin;
  renderMeta();
  renderSheet();
  renderRail();
}

function renderMeta() {
  const p = S.project;
  const n = S.pairs.length;
  const bits = [`<b>${n}</b> ${n === 1 ? 'key' : 'keys'}`];
  bits.push(p.hide_values === false ? 'values on the sheet' : 'values hidden until opened');
  if (p.published) bits.push('<b>published</b>');
  if (S.guest) bits.push('a copy, read only');
  $('#proj-meta').innerHTML = bits.join(' · ');
  $('#proj-title').value = p.title || '';
}

function sorted() {
  return S.pairs.slice().sort((a, b) => {
    const x = a.key.toLowerCase(); const y = b.key.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function visible() {
  const q = S.q.trim().toLowerCase();
  let rows = sorted();
  if (q) rows = rows.filter((r) => r.key.toLowerCase().includes(q) || (r.value || '').toLowerCase().includes(q));
  return rows;
}

function renderSheet() {
  const rows = visible();
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  if (S.page >= pages) S.page = pages - 1;
  const from = S.page * PER;
  const slice = rows.slice(from, from + PER);

  const list = $('#pairs');
  list.innerHTML = slice.map(pairHTML).join('');
  $('#pairs-none').hidden = rows.length > 0;
  if (!rows.length && S.pairs.length) {
    $('#pairs-none').textContent = `nothing matches “${S.q}”.`;
  } else if (!rows.length) {
    $('#pairs-none').textContent = 'nothing here yet — a key and a value go in the boxes below.';
  }

  renderPager(rows.length, pages);
  $('#btn-values').textContent = S.showAll ? 'hide values' : 'show values';
  $('#btn-values').setAttribute('aria-pressed', S.showAll ? 'true' : 'false');
}

function renderPager(total, pages) {
  const el = $('#pager');
  if (total <= PER) { el.innerHTML = total ? `<b>${total}</b> ${total === 1 ? 'key' : 'keys'}` : ''; return; }
  el.innerHTML = `<button type="button" data-pg="-1" ${S.page === 0 ? 'disabled' : ''} aria-label="previous page">←</button>`
    + `<span>page <b>${S.page + 1}</b> / ${pages}</span>`
    + `<button type="button" data-pg="1" ${S.page >= pages - 1 ? 'disabled' : ''} aria-label="next page">→</button>`;
}

$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pg]');
  if (!b) return;
  S.page = Math.max(0, S.page + Number(b.dataset.pg));
  renderSheet();
});

function pairHTML(r) {
  const open = S.openId === r.id;
  const editing = S.editId === r.id;
  const hasValue = (r.value || '').length > 0;
  const folded = !open && !S.showAll && S.project.hide_values !== false && hasValue;
  const valClass = !hasValue && !open ? 'val empty'
    : open ? 'val open'
    : folded ? 'val folded' : 'val';
  const valText = open ? esc(r.value || '')
    : !hasValue ? '(empty)'
    : folded ? '·····' : esc(firstLine(r.value));

  return `<li class="pair${open ? ' on' : ''}" data-id="${r.id}">
    <div class="pair-line">
      <button class="key" type="button" data-reveal title="${open ? 'fold the value' : 'show the value'}">${esc(r.key)}</button>
      <span class="${valClass}">${valText}</span>
      <span class="row-tools">
        <button type="button" data-edit title="edit this key">✎</button>
        <button type="button" data-bin title="move to the recycle bin">✕</button>
      </span>
    </div>
    ${editing ? editHTML(r) : ''}
  </li>`;
}

function firstLine(v) {
  const s = String(v || '').split('\n')[0];
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

function editHTML(r) {
  return `<div class="pair-edit">
    <input class="e-key" type="text" spellcheck="false" autocapitalize="none" value="${esc(r.key)}" aria-label="key">
    <textarea class="e-val" rows="${Math.min(12, Math.max(3, (r.value || '').split('\n').length + 1))}"
              spellcheck="true" aria-label="value">${esc(r.value || '')}</textarea>
    <div class="e-foot">
      <span class="msg" data-state="ok">saved</span>
      <span class="grow"></span>
      <button class="ghost" type="button" data-save>save</button>
      <button class="ghost" type="button" data-close title="close">✕</button>
    </div>
  </div>`;
}

/* ── what a row does when you touch it ────────────────────────────── */
$('#pairs').addEventListener('click', async (e) => {
  const li = e.target.closest('.pair');
  if (!li) return;
  const id = li.dataset.id;
  const r = S.pairs.find((x) => x.id === id);
  if (!r) return;

  if (e.target.closest('[data-reveal]')) {
    S.editId = null;
    S.openId = S.openId === id ? null : id;
    return renderSheet();
  }
  if (e.target.closest('[data-edit]')) {
    S.editId = S.editId === id ? null : id;
    S.openId = id;
    return renderSheet();
  }
  if (e.target.closest('[data-bin]')) {
    await db.binPair(id);
    S.pairs = S.pairs.filter((x) => x.id !== id);
    S.openId = S.openId === id ? null : S.openId;
    S.editId = S.editId === id ? null : S.editId;
    await refresh();
    toast(`“${r.key}” is in the bin`);
    return;
  }
  if (e.target.closest('[data-close]')) {
    S.editId = null;
    return renderSheet();
  }
  if (e.target.closest('[data-save]')) {
    return saveEdit(li, r, true);
  }
});

$('#pairs').addEventListener('input', (e) => {
  if (!e.target.classList.contains('e-key') && !e.target.classList.contains('e-val')) return;
  const li = e.target.closest('.pair');
  const r = S.pairs.find((x) => x.id === li.dataset.id);
  if (!r) return;
  msg(li.querySelector('.e-foot .msg'), 'saving…', 'busy');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => saveEdit(li, r, false), 700);
});

async function saveEdit(li, r, alsoClose) {
  clearTimeout(S.saveTimer);
  const key = li.querySelector('.e-key').value.trim();
  const value = li.querySelector('.e-val').value;
  const note = li.querySelector('.e-foot .msg');
  if (!key) { msg(note, 'a key cannot be empty', 'bad'); return; }
  const clash = S.pairs.find((x) => x.id !== r.id && x.key.toLowerCase() === key.toLowerCase());
  if (clash) { msg(note, `“${clash.key}” already has this name`, 'bad'); return; }
  try {
    await db.updatePair(r.id, { key, value });
    Object.assign(r, { key, value });
    if (alsoClose) { S.editId = null; renderSheet(); }
    else { msg(note, 'saved', 'ok'); renderMeta(); }
  } catch (err) {
    msg(note, err.message || 'could not save', 'bad');
  }
}

/* ── the add box: one key, one value, Enter ────────────────────────── */
$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyEl = $('#add-key');
  const valEl = $('#add-val');
  const key = keyEl.value.trim();
  if (!key) { keyEl.focus(); return; }
  const value = valEl.value;
  const existing = S.pairs.find((x) => x.key.toLowerCase() === key.toLowerCase());
  try {
    if (existing) await db.updatePair(existing.id, { value });
    else await db.addPair(S.project.id, key, value);
    keyEl.value = '';
    valEl.value = '';
    keyEl.focus();
    await refresh();
    S.page = 0;
    renderSheet();
    msg($('#add-msg'), existing ? `“${key}” replaced` : `“${key}” added`, 'ok');
  } catch (err) {
    msg($('#add-msg'), err.message || 'could not add the key', 'bad');
  }
});

$('#add-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#add-val').focus(); }
});
$('#add-val').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#add').requestSubmit(); }
});

/* ── search ───────────────────────────────────────────────────────── */
$('#q').addEventListener('input', () => {
  S.q = $('#q').value;
  S.page = 0;
  S.openId = null;
  renderSheet();
});

/* ── show or hide every value (a reading comfort, not a lock) ─────── */
$('#btn-values').onclick = async () => {
  S.showAll = !S.showAll;
  renderSheet();
  if (S.role === 'owner' && !S.guest) {
    const p = await db.setHideValues(S.project, !S.showAll).catch(() => null);
    if (p) { Object.assign(S.project, p); renderMeta(); }
  }
};

/* ── copy: the sheet as markdown, and the sheet as yours ──────────── */
function markdown() {
  const p = S.project;
  const out = [`# ${p.title || 'untitled'}`, ''];
  if (p.note) out.push(p.note, '');
  const rows = visible();
  out.push(rows.length ? '' : '_empty_');
  for (const r of rows) {
    const v = r.value || '';
    if (v.includes('\n')) {
      out.push(`- **${r.key}**`, '', '  ```', ...v.split('\n').map((l) => '  ' + l), '  ```');
    } else {
      out.push(`- **${r.key}** — ${v}`);
    }
  }
  if (S.guest) out.push('', `_shared from ${location.host}_`);
  return out.join('\n');
}

async function copyText(text, what = 'copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(what);
  }
}

$('#btn-copy').onclick = () => copyText(markdown(), 'the sheet is on the clipboard');

$('#btn-own').onclick = async () => {
  if (!S.project) return;
  if (!S.session) {
    toast('copy to mine needs an account — sign in first');
    return;
  }
  const before = S.pairs.length;
  try {
    const p = await db.copyToMe(S.project, S.pairs);
    S.guest = null;
    S.role = 'owner';
    history.replaceState(null, '', location.pathname);
    await loadProjects();
    await openProject(p.id);
    toast(`${before} ${before === 1 ? 'key' : 'keys'} copied to your projects`);
  } catch (err) {
    toast(err.message || 'could not copy');
  }
};

$('#btn-print').onclick = () => window.print();

/* ── paste: .env, two columns, or a JSON object ───────────────────── */
function parsePaste(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const obj = JSON.parse(t);
      const src = Array.isArray(obj) ? Object.assign({}, ...obj) : obj;
      return Object.entries(src)
        .filter(([k]) => String(k).trim())
        .map(([k, v]) => ({
          key: String(k).trim(),
          value: typeof v === 'string' ? v : JSON.stringify(v, null, 2),
        }));
    } catch { /* not JSON after all — fall through to lines */ }
  }
  const out = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/^\s*export\s+/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    /* a JSON object on its own line is a handful of keys, not a pair */
    if (line.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(line.trim());
        for (const [k, v] of Object.entries(obj)) {
          out.push({ key: String(k).trim(), value: typeof v === 'string' ? v : JSON.stringify(v, null, 2) });
        }
        continue;
      } catch { /* an ordinary line that happens to begin with a brace */ }
    }
    const tab = line.indexOf('\t');
    const eq = line.indexOf('=');
    let k; let v;
    if (tab > 0) { k = line.slice(0, tab); v = line.slice(tab + 1); }
    else if (eq > 0) { k = line.slice(0, eq); v = line.slice(eq + 1); }
    else continue;
    k = k.trim().replace(/^["']|["']$/g, '');
    v = v.trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    if (k) out.push({ key: k, value: v });
  }
  return out;
}

$('#btn-paste').onclick = () => {
  $('#paste-text').value = '';
  msg($('#paste-msg'), '');
  $('#paste-dialog').showModal();
  $('#paste-text').focus();
};
$('#paste-x').onclick = () => $('#paste-dialog').close();
$('#paste-x2').onclick = () => $('#paste-dialog').close();

$('#paste-do').onclick = async () => {
  const rows = parsePaste($('#paste-text').value);
  if (!rows.length) return msg($('#paste-msg'), 'no key=value lines in there', 'bad');
  msg($('#paste-msg'), `adding ${rows.length}…`, 'busy');
  const fresh = [];
  let replaced = 0;
  const byKey = new Map(S.pairs.map((r) => [r.key.toLowerCase(), r]));
  for (const r of rows) {
    const had = byKey.get(r.key.toLowerCase());
    if (had) {
      try { await db.updatePair(had.id, { value: r.value }); replaced++; } catch { /* keep going */ }
    } else {
      fresh.push(r);
      byKey.set(r.key.toLowerCase(), r);
    }
  }
  try {
    for (let i = 0; i < fresh.length; i += 50) await db.addPairs(S.project.id, fresh.slice(i, i + 50));
  } catch (err) {
    return msg($('#paste-msg'), err.message || 'could not add the keys', 'bad');
  }
  $('#paste-dialog').close();
  await refresh();
  toast(`${fresh.length} added${replaced ? `, ${replaced} replaced` : ''}`);
};

/* ── share: link, person, published service ───────────────────────── */
async function openShare() {
  if (!S.project) return;
  S.shares = await db.listShares(S.project.id).catch(() => []);
  $('#share-email').value = '';
  msg($('#share-msg'), '');
  renderShare();
  $('#share-dialog').showModal();
}

function renderShare() {
  const link = S.shares.find((s) => s.code);
  $('#share-link').value = link ? `${location.origin}/?s=${link.code}` : '';
  const people = S.shares.filter((s) => s.email);
  const list = $('#share-list');
  list.innerHTML = people.map((s) => `<li data-id="${s.id}">
      <span class="who">${esc(s.email)}</span>
      <span class="role">${s.role === 'edit' ? 'can write' : 'can read'}</span>
      <button type="button" data-revoke>revoke</button>
    </li>`).join('');

  const p = S.project;
  $('#publish-on').checked = !!p.published;
  const urls = $('#publish-urls');
  urls.hidden = !p.published || !p.publish_code;
  if (p.published && p.publish_code) {
    const base = `${location.origin}/p/${p.publish_code}`;
    const sample = sorted()[0];
    $('#pub-human').value = `${location.origin}/?p=${p.publish_code}`;
    $('#pub-map').value = base;
    $('#pub-one').value = sample ? `${base}/${encodeURIComponent(sample.key)}` : base + '/<key>';
  }
}

$('#btn-share').onclick = openShare;
$('#share-x').onclick = () => $('#share-dialog').close();

$('#share-make').onclick = async () => {
  try {
    await db.makeLink(S.project.id);
    S.shares = await db.listShares(S.project.id);
    renderShare();
    msg($('#share-msg'), 'a link that anyone can read', 'ok');
  } catch (err) { msg($('#share-msg'), err.message || 'could not make a link', 'bad'); }
};

$('#share-copy').onclick = () => {
  const v = $('#share-link').value;
  if (v) copyText(v, 'the link is on the clipboard');
};

$('#share-add').onclick = async () => {
  const email = $('#share-email').value.trim();
  const role = $('#share-role').value;
  try {
    await db.shareWith(S.project.id, email, role);
    S.shares = await db.listShares(S.project.id);
    $('#share-email').value = '';
    renderShare();
    msg($('#share-msg'), `${email} can ${role === 'edit' ? 'write' : 'read'}`, 'ok');
  } catch (err) { msg($('#share-msg'), err.message || 'could not share', 'bad'); }
};

$('#share-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-revoke]');
  if (!b) return;
  const li = b.closest('li');
  try {
    await db.revokeShare(li.dataset.id);
    S.shares = await db.listShares(S.project.id);
    renderShare();
    msg($('#share-msg'), 'revoked', 'ok');
  } catch (err) { msg($('#share-msg'), err.message || 'could not revoke', 'bad'); }
});

$('#publish-on').onchange = async (e) => {
  const on = e.target.checked;
  if (on && !confirm('publish this project? every key and value here becomes public '
    + 'text on the internet, including the ones the screen hides.')) {
    e.target.checked = false;
    return;
  }
  try {
    const p = await db.setPublished(S.project, on);
    Object.assign(S.project, p);
    renderShare();
    renderMeta();
    renderRail();
    msg($('#share-msg'), on ? 'published — the service is live' : 'unpublished', 'ok');
  } catch (err) {
    e.target.checked = !on;
    msg($('#share-msg'), err.message || 'could not change publishing', 'bad');
  }
};

/* ── the bin ──────────────────────────────────────────────────────── */
async function openBin() {
  if (!S.project) return;
  S.bin = await db.listPairs(S.project.id, { bin: true });
  $('#spec').hidden = true;
  $('#binview').hidden = false;
  $('#welcome').hidden = true;
  renderBin();
}

function renderBin() {
  const list = $('#bin-list');
  list.innerHTML = S.bin.map((r) => `<li class="pair" data-id="${r.id}">
      <div class="pair-line">
        <span class="key">${esc(r.key)}</span>
        <span class="val folded">${esc(firstLine(r.value) || '')}</span>
        <span class="bin-when">${esc(when(r.deleted_at))}</span>
        <span class="row-tools">
          <button type="button" data-restore title="put it back">restore</button>
          <button type="button" data-purge title="delete for good">✕</button>
        </span>
      </div>
    </li>`).join('');
  $('#bin-none').hidden = S.bin.length > 0;
  $('#btn-empty').hidden = S.role !== 'owner' || !S.bin.length;
  $('#btn-bin').classList.add('on');
  $('#bin-count').textContent = S.bin.length ? String(S.bin.length) : '';
  msg($('#bin-msg'), '');
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

$('#btn-bin').onclick = openBin;
$('#btn-bin-back').onclick = () => {
  $('#btn-bin').classList.remove('on');
  $('#binview').hidden = true;
  $('#spec').hidden = false;
  renderSheet();
};

$('#bin-list').addEventListener('click', async (e) => {
  const li = e.target.closest('.pair');
  if (!li) return;
  const id = li.dataset.id;
  const r = S.bin.find((x) => x.id === id);
  if (!r) return;
  if (e.target.closest('[data-restore]')) {
    const clash = S.pairs.find((x) => x.key.toLowerCase() === r.key.toLowerCase());
    if (clash) { msg($('#bin-msg'), `“${clash.key}” has that name now — rename or bin it first`, 'bad'); return; }
    await db.restorePair(id);
    await refresh();
    S.bin = await db.listPairs(S.project.id, { bin: true });
    renderBin();
    toast(`“${r.key}” is back`);
  }
  if (e.target.closest('[data-purge]')) {
    if (!confirm(`delete “${r.key}” for good?`)) return;
    await db.purgePair(id);
    S.bin = S.bin.filter((x) => x.id !== id);
    renderBin();
    renderRail();
  }
});

$('#btn-empty').onclick = async () => {
  if (!confirm(`empty the bin — ${S.bin.length} ${S.bin.length === 1 ? 'key' : 'keys'} gone for good?`)) return;
  await db.emptyBin(S.project.id);
  S.bin = [];
  renderBin();
  renderRail();
};

/* ── the project's name ───────────────────────────────────────────── */
$('#proj-title').addEventListener('change', async () => {
  if (S.role !== 'owner' || S.guest) return;
  const title = $('#proj-title').value.trim() || 'untitled';
  try {
    const p = await db.updateProject(S.project.id, { title });
    Object.assign(S.project, p);
    renderRail();
  } catch (err) { toast(err.message || 'could not rename'); }
});

/* ── reading somebody else's project ──────────────────────────────── */
async function openGuest(code, kind) {
  S.session = await db.session().catch(() => null);

  let project; let pairs;
  try {
    if (kind === 'share') {
      const data = await db.readShare(code);
      if (!data) return deadLink();
      project = data.project;
      pairs = data.pairs || [];
    } else {
      const data = await db.readPublic(code);
      if (!data) return deadLink();
      project = { id: 'public', title: data.title, hide_values: true, published: true };
      pairs = Object.entries(data.keys || {}).map(([key, value], i) => ({
        id: `p${i}`, key, value: String(value), deleted_at: null,
      }));
    }
  } catch {
    return deadLink();
  }

  S.project = project;
  S.pairs = pairs;
  S.guest = kind;
  S.role = S.session ? await db.roleOn(project).catch(() => null) : null;
  S.showAll = false;

  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#welcome').hidden = true;
  $('#binview').hidden = true;
  $('#spec').hidden = false;
  $('#projects').hidden = true;
  $('#btn-projects').hidden = true;
  document.body.dataset.guest = '1';
  $('#who').textContent = displayName(S.session);

  applyRole();
  renderMeta();
  $('#proj-meta').innerHTML = `${S.pairs.length} ${S.pairs.length === 1 ? 'key' : 'keys'} · a shared sheet`;
  renderSheet();
}

function deadLink() {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  msg($('#gate-msg'), 'that link is gone — ask for a new one', 'bad');
}

/* ── out, and start ───────────────────────────────────────────────── */
$('#btn-out').onclick = async () => {
  await db.signOut();
  location.href = location.pathname;
};

$('#btn-projects').onclick = () => {
  document.body.dataset.rail = document.body.dataset.rail === 'open' ? '' : 'open';
};

document.addEventListener('click', (e) => {
  if (e.target.closest('#projects') || e.target.closest('#btn-projects')) return;
  if (document.body.dataset.rail === 'open' && e.target !== $('#btn-projects')) {
    document.body.dataset.rail = '';
  }
});

boot().catch((err) => {
  $('#gate').hidden = false;
  msg($('#gate-msg'), err.message || 'could not start', 'bad');
});

/* ── the settings dialog, and the dock ─────────────────────────────
 * Same dialog as every other app, same dock. The dock reads what is on
 * screen and answers about it; nothing it writes lands anywhere until a
 * person says so. */
let SET = null;

function wireSettings() {
  SET = settings.mountSettings({
    dialog: $('#ai-dialog'),
    proxy: engine.PROXY,
    onSaved: () => { try { paintSpec(); } catch { } try { paintAiHint(); } catch { } },
  });
  const gear = $('#btn-ai');
  if (gear) gear.onclick = () => SET.open();
}

wireSettings();

const DOCK = mountDock({ app: 'vz', openSettings: () => SET && SET.open() });
