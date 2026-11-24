/* vpl · vr — the sheet.
 *
 * One document is one table. Rows keep their names (VR-001), carry one testable
 * sentence, and say how hard they are: must, optional, wish. Everything else a
 * row may know lives in the row it belongs to, opened in place.
 *
 * The database lives in lib/db.js. The model goes through our own origin
 * (/api/chat, then api.terg.hr) because model APIs send no CORS headers.
 */

import * as db from './lib/db.js';
import * as ai from './vendor/ai.js';
import * as who from './vendor/who.js';
import { mountDock, lastField, putInto } from './vendor/dock.js';
import { mountNotice } from './vendor/notices.js';
import * as settings from './vendor/settings.js';
import * as engine from './vendor/engine.js';
import { prompts } from './prompts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* One shape per value, in the order the document lists them; colour is never the
 * only signal, and neither is a word on its own. */
const MARK = ['■', '◆', '◇', '●', '▲', '▼'];

const S = {
  session: null,
  projects: [],
  project: null,
  reqs: [],
  terms: [],
  role: 'owner',     // owner | edit | view
  guest: null,       // a public link: no session, no writes
  themes: [],
  vocab: [],         // importance, status, kind — the words this document uses
  themeId: null,     // null = everything
  q: '',
  sort: { field: 'pos', dir: 1 },
  page: 1,
  per: 20,
  all: false,        // all columns
  open: null,        // the row whose detail is open
  proposals: [],
  busy: false,
};

/* ── the document's words ─────────────────────────────────────────── */
const vocabOf = (axis) => S.vocab.filter((v) => v.axis === axis).slice().sort((a, b) => a.pos - b.pos);
const vocabRow = (axis, value) => vocabOf(axis).find((v) => v.value === value) || null;
const colorOf = (axis, value) => (vocabRow(axis, value) || {}).color || 'grey';
const orderOf = (axis, value) => {
  const row = vocabRow(axis, value);
  return row ? row.pos : 99;
};
function markOf(axis, value) {
  const i = vocabOf(axis).findIndex((v) => v.value === value);
  return MARK[Math.max(0, i) % MARK.length];
}

/* ── the document's tree ──────────────────────────────────────────── */
const themeById = (id) => S.themes.find((t) => t.id === id) || null;
const roots = () => S.themes.filter((t) => !t.parent_id);
const kids = (id) => S.themes.filter((t) => t.parent_id === id);
function themePath(id) {
  if (id === 'unfiled') return 'unfiled';
  const t = themeById(id);
  if (!t) return '';
  const p = t.parent_id ? themeById(t.parent_id) : null;
  return p ? p.name + ' / ' + t.name : t.name;
}

/* ── tiny helpers ─────────────────────────────────────────────────── */
const canWrite = () => S.role === 'owner' || S.role === 'edit';
const isOwner = () => S.role === 'owner';

let _toastT = 0;
function flash(text, state = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
  el.classList.add('on');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('on'), 1800);
}

function say(el, text, state) {
  if (!el) return;
  el.textContent = text || '';
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

function saveTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('vpl.theme', t); } catch {}
}
function toggleTheme() {
  saveTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

/* The name in the corner is the suite's, not this app's (vendor/who.js):
 * the name Google gave us, else the address tidied, else a letter. */
function displayName(session) {
  return who.whoLabel(session);
}

/* Phones capitalise the first letter of a field and computers do not. Names and
 * addresses are compared in lower case; the password never is. */
function lowerField(el) {
  el.addEventListener('input', () => {
    const low = el.value.toLowerCase();
    if (low === el.value) return;
    const at = el.selectionStart;
    el.value = low;
    try { el.setSelectionRange(at, at); } catch {}
  });
}

function toAuthEmail(v) {
  const t = v.trim();
  return t.includes('@')
    ? t.toLowerCase()
    : t.toLowerCase().replace(/\s+/g, '') + '@vpl.local';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function debounce(fn, ms = 700) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ── gate ─────────────────────────────────────────────────────────── */
async function boot() {
  wireAuth();
  lowerField($('#email'));
  const code = new URLSearchParams(location.search).get('s');
  if (code) {
    wireChrome();
    $('#gate').hidden = true;
    $('#app').hidden = false;
    await enterGuest(code);
    return;
  }

  saveTheme(document.documentElement.dataset.theme || 'light');
  $('#gate-theme').onclick = toggleTheme;
  $('#gate-form').addEventListener('submit', (e) => { e.preventDefault(); login(); });
  $('#btn-register').onclick = () => login(true);
  $('#btn-google').onclick = async () => {
    try { await db.signInWithGoogle(); }
    catch (e) { say($('#gate-msg'), e.message || String(e), 'bad'); }
  };

  db.onAuthChange((s) => { if (!s && !S.guest) showGate(); });
  S.session = await db.session();
  if (!S.session) return showGate();
  await enter();
}

function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
}

async function login(register = false) {
  const email = toAuthEmail($('#email').value);
  const pass = $('#pass').value;
  const msg = $('#gate-msg');
  if (!email || !pass) return say(msg, 'e-mail and password, please', 'bad');
  say(msg, register ? 'creating…' : 'signing in…', 'busy');
  try {
    if (register) await db.signUp(email, pass);
    else await db.signIn(email, pass);
    S.session = await db.session();
    if (!S.session) return say(msg, 'check your mailbox to confirm', 'ok');
    $('#gate').hidden = true;
    await enter();
  } catch (e) {
    say(msg, e.message || String(e), 'bad');
  }
}

/* ── entering ─────────────────────────────────────────────────────── */
async function enter() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  wireChrome();
  wireAiDialog();
  wireShare();
  wireGlossary();
  wirePaste();
  wireReview();
  $('#who').textContent = displayName(S.session);
  who.chip($('#who'));
  await loadProjects();
}

async function loadProjects() {
  try {
    S.projects = await db.listProjects();
  } catch (e) {
    console.error(e);
    S.projects = [];
  }
  paintProjects();
  const last = (() => { try { return localStorage.getItem('vpl.vr.last'); } catch { return null; } })();
  const pick = S.projects.find((p) => p.id === last) || S.projects[0];
  if (pick) await openProject(pick);
  else showWelcome();
}

function showWelcome() {
  $('#spec').hidden = true;
  $('#welcome').hidden = false;
  S.project = null;
}

function paintProjects() {
  const ul = $('#proj-list');
  ul.innerHTML = S.projects.map((p) => `
    <li class="proj-row ${S.project && p.id === S.project.id ? 'on' : ''}" data-id="${p.id}">
      <button class="pick" type="button" title="${esc(p.title)}">${esc(p.title)}</button>
      <button class="kill o-only" type="button" title="delete this document" data-del-project="${p.id}">✕</button>
    </li>`).join('');
  $('#proj-none').hidden = S.projects.length > 0;
}

/* ── a document opens ─────────────────────────────────────────────── */
async function openProject(p) {
  S.project = p;
  S.open = null;
  S.themeId = null; S.q = ''; $('#q').value = '';
  S.page = 1; S.sort = { field: 'pos', dir: 1 };
  try { localStorage.setItem('vpl.vr.last', p.id); } catch {}
  $('#welcome').hidden = true;
  $('#spec').hidden = false;
  paintProjects();
  paintHead();

  if (!S.guest) S.role = (await db.roleOn(p)) || 'view';
  applyRole();

  try {
    const [reqs, terms, themes, vocab] = await Promise.all([
      db.listReqs(p.id), db.listTerms(p.id), db.listThemes(p.id), db.listVocab(p.id),
    ]);
    S.reqs = reqs;
    S.terms = terms;
    S.themes = themes;
    S.vocab = vocab;
  } catch (e) {
    console.error(e);
    S.reqs = []; S.terms = []; S.themes = []; S.vocab = [];
  }
  paintSheet();
  paintBrief();
  paintAiHint();
}

/* Which document the name field is currently showing. The rows arrive a moment
 * after the document does, and every repaint of the same document used to write
 * the stored name back over whatever had just been typed — on a slow connection
 * that meant naming a new document looked like it worked and silently did not.
 * The field follows the document only when the document changes. */
let headFor = null;

function paintHead() {
  const t = $('#proj-title');
  const id = S.project ? S.project.id : '';
  if (id !== headFor) {
    headFor = id;
    t.value = S.project ? S.project.title : '';
  }
  t.readOnly = !isOwner();
}

function applyRole() {
  document.body.dataset.role = S.role;
  document.body.classList.toggle('guest', !!S.guest);
  $('#btn-out').hidden = !!S.guest;
  $('#btn-share').hidden = !isOwner();
  /* A document somebody shared with you is theirs; this is how you take a copy
   * where the strengths and the order are yours. Links and signed-in readers
   * both get it, and nobody gets it on the owner's own screen. */
  $('#btn-own').hidden = isOwner() || !S.session;
  if (S.guest) {
    $('#guest-banner').hidden = false;
    $('#guest-banner').textContent = 'shared document — you are reading a link. nothing you do here is saved.';
    $('#projects').hidden = true;
  } else {
    $('#guest-banner').hidden = true;
    $('#projects').hidden = false;
  }
  $('#proj-title').readOnly = !isOwner();
  paintAiHint();
}

/* ── the sheet ────────────────────────────────────────────────────── */
function inTheme(r) {
  if (!S.themeId) return true;
  if (S.themeId === 'unfiled') return !r.theme_id;
  if (r.theme_id === S.themeId) return true;
  const sel = themeById(S.themeId);
  /* choosing a theme shows its subthemes too; a subtheme shows only itself */
  return !!(sel && !sel.parent_id && r.theme_id && themeById(r.theme_id)?.parent_id === sel.id);
}

function listed() {
  const q = S.q.trim().toLowerCase();
  return S.reqs.filter((r) => {
    if (!inTheme(r)) return false;
    if (!q) return true;
    return [r.statement, r.title, r.theme, themePath(r.theme_id), r.strength, r.status]
      .some((v) => (v || '').toLowerCase().includes(q));
  });
}

function sorted(rows) {
  const f = S.sort.field, d = S.sort.dir;
  return rows.slice().sort((a, b) => {
    let x, y;
    if (f === 'strength') { x = orderOf('importance', a.strength); y = orderOf('importance', b.strength); }
    else if (f === 'status') { x = orderOf('status', a.status); y = orderOf('status', b.status); }
    else if (f === 'theme') { x = themePath(a.theme_id).toLowerCase(); y = themePath(b.theme_id).toLowerCase(); }
    else { x = a.pos || 0; y = b.pos || 0; }
    if (x === y) return (a.pos || 0) - (b.pos || 0);
    return (x > y ? 1 : -1) * d;
  });
}

function paintSheet() {
  const rows = sorted(listed());
  const pages = Math.max(1, Math.ceil(rows.length / S.per));
  if (S.page > pages) S.page = pages;
  if (S.page < 1) S.page = 1;
  const start = (S.page - 1) * S.per;
  $('#rows').innerHTML = rows.slice(start, start + S.per).map(rowHTML).join('');
  $('#sheet').dataset.theme = S.themeId ? '1' : '0';
  paintSort();
  paintPager(rows.length, pages);
  paintMeta(rows.length);
  paintHead();
  paintTree();
  paintAddTheme();
  /* an empty theme is a place too, and it has to say so */
  const none = $('#sheet-none');
  none.hidden = rows.length > 0;
  if (!S.reqs.length) none.textContent = 'no rows yet. the first one goes in the box above.';
  else if (S.q) none.textContent = 'nothing matches that.';
  else if (S.themeId) none.textContent = 'nothing here yet — type below, it goes into ' + themePath(S.themeId) + '.';
  else none.textContent = 'no rows yet.';
}

function chipHTML(axis, value, extra = '') {
  const v = vocabRow(axis, value);
  const label = (v && v.value) || value || '—';
  return `<button class="chip-value" data-color="${esc(colorOf(axis, value))}" ${extra} type="button">
    <span class="mark" aria-hidden="true">${markOf(axis, value)}</span>${esc(label)}</button>`;
}

/* A row is a sentence and two words. No name, no id, no long version: a person
 * writes what has to be true and clicks how hard it is and where it stands. */
function rowHTML(r) {
  const text = (r.statement || r.title || '').trim();
  const open = S.open === r.id;
  return `
    <tr data-id="${r.id}" data-ref="${esc(r.ref || '')}" class="${open ? 'open' : ''}">
      <td class="c-req"><div class="req-open">${esc(text) || '<span class="muted">no sentence yet</span>'}</div></td>
      <td class="c-strength">${chipHTML('importance', r.strength, `data-s="${esc(r.strength)}" title="click to change"`)}</td>
      <td class="c-status">${chipHTML('status', r.status, `data-status="${esc(r.status)}" title="click to move it on"`)}</td>
      <td class="c-theme theme-cell" title="${esc(themePath(r.theme_id) || r.theme)}">${esc(themePath(r.theme_id) || r.theme) || '<span class="muted">—</span>'}</td>
      <td class="c-tools"><div class="row-tools">
        <button type="button" data-move="-1" title="move up" aria-label="move up">↑</button>
        <button type="button" data-move="1" title="move down" aria-label="move down">↓</button>
        <button type="button" data-del="${r.id}" class="o-only" title="delete this row" aria-label="delete">✕</button>
      </div></td>
    </tr>
    ${open ? detailHTML(r) : ''}`;
}

/* a source that is an address is a link; everything else stays words */
function sourceHTML(src) {
  const t = (src || '').trim();
  if (!t) return '—';
  if (/^https?:\/\/\S+$/i.test(t)) {
    return `<a href="${esc(t)}" target="_blank" rel="noopener noreferrer">${esc(t.replace(/^https?:\/\//, '').slice(0, 40))}</a>`;
  }
  return esc(t);
}


function sizeWord(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' kB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileBox(r) {
  if (!canWrite() && !r.file_path) return '';
  const now = r.file_path
    ? `<span class="file-now">
         <button type="button" class="file-name" data-open-file="${r.id}"
                 title="open in a new tab — the link is signed and lasts an hour">${esc(r.file_name || 'file')}</button>
         <span class="muted small">${sizeWord(r.file_size)}</span>
         ${canWrite() ? `<button class="ghost danger" type="button" data-drop-file="${r.id}">remove</button>` : ''}
       </span>`
    : `<button class="ghost" type="button" data-pick-file="${r.id}">attach a file…</button>`;
  return `<div class="wide file-box"><label>attachment — one file, up to 2 MB (a photo, a scan, a pdf)</label>
    ${now}<input type="file" data-file-input="${r.id}" hidden></div>`;
}

function vocabSelect(axis, current, id, locked) {
  const rows = vocabOf(axis);
  const known = rows.some((v) => v.value === current);
  return `<select id="${id}" data-axis="${axis}" ${locked ? 'disabled' : ''}>
    ${known ? '' : `<option value="${esc(current)}" selected>${esc(current || '—')}</option>`}
    ${rows.map((v) => `<option value="${esc(v.value)}" ${v.value === current ? 'selected' : ''}>${esc(v.value)}</option>`).join('')}
    ${locked ? '' : '<option value="__new">＋ another word…</option>'}
  </select>`;
}

function themeSelect(r, locked) {
  const opts = roots().map((t) => {
    const own = `<option value="${t.id}" ${r.theme_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`;
    const subs = kids(t.id).map((k) => `<option value="${k.id}" ${r.theme_id === k.id ? 'selected' : ''}>${esc(t.name)} / ${esc(k.name)}</option>`).join('');
    return own + subs;
  }).join('');
  return `<select id="d-${r.id}-theme" data-field="theme_id" ${locked ? 'disabled' : ''}>
    <option value="">— no theme —</option>${opts}
  </select>`;
}

async function takeFile(inp) {
  const id = inp.dataset.fileInput;
  const row = S.reqs.find((r) => r.id === id);
  const file = inp.files && inp.files[0];
  inp.value = '';                       // choosing the same file twice must work
  if (!row || !file) return;
  const msg = () => $(`#d-msg-${id}`);
  if (file.size > db.MAX_FILE) {
    return say(msg(), '2 MB is the limit — a photo, a scan or a short pdf', 'bad');
  }
  say(msg(), 'uploading…', 'busy');
  try {
    const path = await db.uploadFile(S.project.id, id, file);
    const patch = {
      file_path: path,
      file_name: file.name.slice(0, 120),
      file_size: file.size,
      file_mime: file.type || '',
    };
    await db.updateReq(id, patch);
    Object.assign(row, patch);
    S.open = id;
    paintSheet();
    say($(`#d-msg-${id}`), 'attached', 'ok');
  } catch (e) {
    say(msg(), e.message || String(e), 'bad');
  }
}

async function openFile(id) {
  const row = S.reqs.find((r) => r.id === id);
  if (!row?.file_path) return;
  const msg = () => $(`#d-msg-${id}`);
  try {
    say(msg(), 'opening…', 'busy');
    const url = await db.signFile(row.file_path);
    window.open(url, '_blank', 'noopener');
    say(msg(), '');
  } catch (e) {
    say(msg(), e.message || String(e), 'bad');
  }
}

async function dropFile(id) {
  if (!canWrite()) return;
  const row = S.reqs.find((r) => r.id === id);
  if (!row) return;
  const msg = () => $(`#d-msg-${id}`);
  try {
    await db.removeFile(row.file_path);
    const patch = { file_path: null, file_name: null, file_size: null, file_mime: null };
    await db.updateReq(id, patch);
    Object.assign(row, patch);
    paintSheet();
    say($(`#d-msg-${id}`), 'attachment removed', 'ok');
  } catch (e) {
    say(msg(), e.message || String(e), 'bad');
  }
}

/* A row opens into two short lines, not a form: the sentence, then its words.
 * Labels are inline and small; nothing here is bigger than the sheet above it. */
function detailHTML(r) {
  const word = (key, html) => `<span class="d-w"><span class="d-k">${key}</span>${html}</span>`;
  return `<tr class="detail"><td colspan="5">
    <div class="d-row">
      <label class="sr-only" for="d-${r.id}-statement">the requirement</label>
      <textarea id="d-${r.id}-statement" class="d-sentence" data-field="statement" rows="2"
        placeholder="the requirement, in one testable sentence">${esc(r.statement)}</textarea>
      <div class="d-words">
        ${word('theme', themeSelect(r, !canWrite()))}
        ${word('kind', vocabSelect('kind', r.kind, `d-${r.id}-kind`, !canWrite()))}
        ${word('how hard', vocabSelect('importance', r.strength, `d-${r.id}-strength`, !isOwner()))}
        ${word('status', vocabSelect('status', r.status, `d-${r.id}-status`, !canWrite()))}
        ${fileBox(r)}
        <span class="msg" id="d-msg-${r.id}"></span>
        <button class="ghost d-close" type="button" data-close="${r.id}" aria-label="close">✕</button>
      </div>
    </div>
  </td></tr>`;
}

/* counts above the sheet, and what is missing */
function paintMeta(shown) {
  if (!S.project) return;
  const n = S.reqs.length;
  const bits = [`${n} row${n === 1 ? '' : 's'}`];
  if (shown !== n) bits.push(`${shown} shown`);
  if (S.role !== 'owner') bits.push(S.role === 'edit' ? 'you may write, not decide' : 'read only');
  $('#proj-meta').textContent = bits.join(' · ');

  const when = new Date().toLocaleDateString();
  $('#print-meta').textContent = S.project
    ? `${when} · ${S.project.title} · ${bits.join(' · ')} · vr`
    : '';
}

/* where you are, two words */
function paintCrumb() {
  $('#crumb-doc').textContent = S.project ? S.project.title : 'document';
  $('#crumb-theme').textContent = S.themeId
    ? (themePath(S.themeId) || 'everything')
    : 'everything';
}

function paintTree() {
  const box = $('#theme-tree');
  const wrap = $('#themes');
  wrap.hidden = !S.project;
  const total = S.reqs.length;
  const countIn = (t) => S.reqs.filter((r) => r.theme_id === t.id
    || (kids(t.id).some((k) => k.id === r.theme_id))).length;

  const li = [];
  li.push(`<li class="tt-row tt-all ${S.themeId ? '' : 'on'}">
    <button type="button" class="tt-pick" data-theme="">everything <b>${total}</b></button></li>`);
  const unfiled = S.reqs.filter((r) => !r.theme_id).length;
  if (unfiled) {
    li.push(`<li class="tt-row tt-unfiled ${S.themeId === 'unfiled' ? 'on' : ''}">
      <button type="button" class="tt-pick" data-theme="unfiled" title="rows that belong to no theme yet">unfiled <b>${unfiled}</b></button></li>`);
  }
  for (const t of roots()) {
    li.push(`<li class="tt-row tt-root ${S.themeId === t.id ? 'on' : ''}">
      <button type="button" class="tt-pick" data-theme="${t.id}" title="${esc(t.name)}">${esc(t.name)} <b>${countIn(t)}</b></button>
      <span class="tt-tools"><button type="button" class="w-only" data-sub="${t.id}" title="a subtheme">＋</button>
        <button type="button" class="o-only" data-del-theme="${t.id}" title="delete this theme">✕</button></span>
    </li>`);
    /* subthemes open only under the theme you are standing in: a rail is a
     * place, not a filing cabinet */
    const openRoot = S.themeId === t.id || (S.themeId && themeById(S.themeId)?.parent_id === t.id);
    for (const k of (openRoot ? kids(t.id) : [])) {
      li.push(`<li class="tt-row tt-kid ${S.themeId === k.id ? 'on' : ''}">
        <button type="button" class="tt-pick" data-theme="${k.id}" title="${esc(t.name)} / ${esc(k.name)}">${esc(k.name)} <b>${S.reqs.filter((r) => r.theme_id === k.id).length}</b></button>
        <span class="tt-tools"><button type="button" class="o-only" data-del-theme="${k.id}" title="delete this theme">✕</button></span>
      </li>`);
    }
  }
  if (!roots().length) {
    li.push(`<li class="tt-empty muted">no themes yet${canWrite() ? ' — ＋ makes the first' : ''}</li>`);
  }
  box.innerHTML = li.join('');
  paintCrumb();
}

function paintAddTheme() {
  const el = $('#add-theme');
  if (!el) return;
  if (!S.project) { el.textContent = ''; return; }
  el.textContent = S.themeId ? 'goes into ' + themePath(S.themeId) : 'goes into no theme — pick one on the left';
}

function paintPager(total, pages) {
  const el = $('#pager');
  if (total <= S.per) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `
    <button type="button" data-page="-1" ${S.page <= 1 ? 'disabled' : ''} aria-label="previous page">←</button>
    <span>page <b>${S.page}</b> / ${pages} · ${total} rows</span>
    <button type="button" data-page="1" ${S.page >= pages ? 'disabled' : ''} aria-label="next page">→</button>`;
}

function paintSort() {
  $$('#sheet thead th.sortable').forEach((th) => {
    const on = th.dataset.sort === S.sort.field;
    th.dataset.dir = on ? (S.sort.dir > 0 ? 'asc' : 'desc') : '';
    th.setAttribute('aria-sort', on ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
  });
}

/* ── editing a row ────────────────────────────────────────────────── */
const pending = new Map();
function queue(id, field, value) {
  const key = id + ':' + field;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(async () => {
    pending.delete(key);
    try {
      const patch = { [field]: value };
      const row = await db.updateReq(id, patch);
      const at = S.reqs.findIndex((r) => r.id === id);
      if (at >= 0) S.reqs[at] = row;
      if (['strength', 'status', 'kind', 'theme', 'theme_id'].includes(field)) {
        paintSheet();
      } else if (field === 'title' || field === 'statement') {
        // repaint the line above the detail without closing it
        const tr = $(`tr[data-id="${id}"]`);
        if (tr) tr.querySelector('.req-open').innerHTML = lineHTML(row);
      }
      say($(`#d-msg-${id}`), 'saved', 'ok');
      setTimeout(() => { const m = $(`#d-msg-${id}`); if (m && m.textContent === 'saved') say(m, ''); }, 1400);
    } catch (e) {
      say($(`#d-msg-${id}`), e.message || String(e), 'bad');
    }
  }, 700));
}

function lineHTML(r) {
  const text = (r.statement || r.title || '').trim();
  return esc(text) || '<span class="muted">no sentence yet</span>';
}

async function addRow(text) {
  if (!canWrite()) return;
  const sentence = text.trim();
  if (!sentence) return;
  const pos = S.reqs.reduce((n, r) => Math.max(n, r.pos || 0), 0) + 1;
  const themeId = S.themeId && S.themeId !== 'unfiled' ? S.themeId : null;
  const themeName = themeId ? (themeById(themeId)?.name || '') : '';
  const first = (vocabOf('importance')[0] || {}).value || 'must';
  try {
    const row = await db.addReq(S.project.id, {
      statement: sentence, pos, theme_id: themeId, theme: themeName, strength: first,
      status: (vocabOf('status')[0] || {}).value || 'draft',
    });
    S.reqs.push(row);
    paintSheet();
    $('#req-add').value = '';
    $('#req-add').focus();
  } catch (e) {
    console.error(e);
    say($('#brief-msg'), e.message || String(e), 'bad');
  }
}

async function cycleStrength(id) {
  if (!isOwner()) return;
  const r = S.reqs.find((x) => x.id === id);
  if (!r) return;
  const words = vocabOf('importance').map((v) => v.value);
  if (!words.length) return;
  const next = words[(words.indexOf(r.strength) + 1) % words.length];
  try {
    const row = await db.updateReq(id, { strength: next });
    Object.assign(r, row);
    paintSheet();
  } catch (e) { console.error(e); }
}

/* status is progress, not a decision: an editor moves it, the log remembers */
async function cycleStatus(id) {
  if (!canWrite()) return;
  const r = S.reqs.find((x) => x.id === id);
  if (!r) return;
  const words = vocabOf('status').map((v) => v.value);
  if (!words.length) return;
  const next = words[(words.indexOf(r.status) + 1) % words.length];
  try {
    const row = await db.updateReq(id, { status: next });
    Object.assign(r, row);
    paintSheet();
  } catch (e) {
    console.error(e);
    flash(e.message || 'the status did not change', 'bad');
  }
}

/* adding a word to the document's vocabulary, from any select */
async function addWord(axis, back) {
  const word = (prompt(`a new word for ${axis}`) || '').trim();
  if (!word) { paintSheet(); return; }
  const colors = ['red', 'amber', 'slate', 'green', 'blue', 'violet'];
  try {
    const v = await db.addVocab(S.project.id, axis, word, colors[vocabOf(axis).length % colors.length]);
    S.vocab.push(v);
    if (back) await back(v.value);
    paintSheet();
  } catch (e) {
    flash(e.message || 'that word could not be added', 'bad');
    paintSheet();
  }
}

function renumber() {
  S.reqs.forEach((r, i) => { r.pos = i + 1; });
}

async function moveRow(id, dir) {
  if (!isOwner()) return;
  const ordered = S.reqs.slice().sort((a, b) => (a.pos || 0) - (b.pos || 0));
  const i = ordered.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return;
  const a = ordered[i], b = ordered[j];
  const pa = a.pos, pb = b.pos;
  a.pos = pb; b.pos = pa;
  if (pa === pb) renumber();
  paintSheet();
  try {
    await Promise.all([
      db.updateReq(a.id, { pos: a.pos }),
      db.updateReq(b.id, { pos: b.pos }),
    ]);
  } catch (e) {
    console.error(e);
    // put the list back the way the database has it
    S.reqs = await db.listReqs(S.project.id);
    paintSheet();
  }
}

async function deleteRow(id) {
  if (!isOwner()) return;
  const r = S.reqs.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`Delete ${r.ref}? The name is not reused.`)) return;
  try {
    await db.deleteReq(id);
    S.reqs = S.reqs.filter((x) => x.id !== id);
    if (S.open === id) S.open = null;
    paintSheet();
  } catch (e) { console.error(e); }
}

/* ── the brief ────────────────────────────────────────────────────── */
function paintBrief() {
  $('#brief-text').value = S.project.brief || '';
  $('#brief-assume').value = S.project.assumptions || '';
  $('#brief-scope').value = S.project.scope || '';
}

async function saveBrief() {
  if (!canWrite() || !S.project) return;
  const patch = {
    brief: $('#brief-text').value,
    assumptions: $('#brief-assume').value,
    scope: $('#brief-scope').value,
  };
  try {
    S.project = await db.updateProject(S.project.id, patch);
    const row = S.projects.find((p) => p.id === S.project.id);
    if (row) Object.assign(row, patch);
    say($('#brief-msg'), 'saved', 'ok');
    setTimeout(() => say($('#brief-msg'), ''), 1400);
  } catch (e) {
    say($('#brief-msg'), e.message || String(e), 'bad');
  }
}

/* ── the glossary ─────────────────────────────────────────────────── */
function wireGlossary() {
  const dlg = $('#glossary-dialog');
  $('#btn-glossary').onclick = () => { paintTerms(); dlg.showModal(); };
  $('#glossary-x').onclick = () => dlg.close();
  $('#term-add-b').onclick = addTermFromForm;
  $('#term-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#term-mean').focus(); } });
  $('#term-mean').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTermFromForm(); } });
  $('#term-suggest').onclick = suggestTerms;
  $('#term-list').addEventListener('click', async (e) => {
    const del = e.target.closest('button[data-del-term]');
    if (del) {
      if (!isOwner()) return;
      try { await db.deleteTerm(del.dataset.delTerm); S.terms = S.terms.filter((t) => t.id !== del.dataset.delTerm); paintTerms(); }
      catch (err) { say($('#term-msg'), err.message || String(err), 'bad'); }
    }
  });
  $('#term-list').addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-term]');
    if (!inp) return;
    const id = inp.dataset.term;
    clearTimeout(inp._t);
    inp._t = setTimeout(async () => {
      try { const t = await db.updateTerm(id, { meaning: inp.value }); const at = S.terms.findIndex((x) => x.id === id); if (at >= 0) S.terms[at] = t; }
      catch (err) { say($('#term-msg'), err.message || String(err), 'bad'); }
    }, 700);
  });
}

function paintTerms() {
  const ul = $('#term-list');
  ul.innerHTML = S.terms.map((t) => `
    <li data-term-row="${t.id}">
      <span class="t">${esc(t.term)}</span>
      <input type="text" value="${esc(t.meaning)}" data-term="${t.id}"
             aria-label="meaning of ${esc(t.term)}" spellcheck="true">
      <button class="ghost o-only" type="button" data-del-term="${t.id}" title="delete this word">✕</button>
    </li>`).join('');
  $('#term-none').hidden = S.terms.length > 0;
  $$('#term-list input').forEach((i) => { if (!canWrite()) i.readOnly = true; });
}

async function addTermFromForm() {
  if (!canWrite()) return;
  const term = $('#term-word').value.trim();
  const meaning = $('#term-mean').value.trim();
  if (!term) return say($('#term-msg'), 'a word first', 'bad');
  try {
    const t = await db.addTerm(S.project.id, term, meaning);
    S.terms.push(t);
    S.terms.sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()));
    $('#term-word').value = ''; $('#term-mean').value = '';
    $('#term-word').focus();
    paintTerms();
    say($('#term-msg'), 'added', 'ok');
  } catch (e) {
    say($('#term-msg'), /duplicate|unique/i.test(e.message || '') ? 'that word is already here' : (e.message || String(e)), 'bad');
  }
}

/* ── the model ────────────────────────────────────────────────────── */
/* The shared door, if this deployment has one. `proxy` in config.local.js names
 * it; with no value the app uses its own /api/chat and stops there. Nothing
 * here has a default that points at somebody else's server. */
const SHARED_PROXY = ((window.__VPL_CONFIG__ || {}).proxy || '').replace(/\/$/, '');
const aiCfg = () => ai.readAi();
const aiEndpoint = ai.aiEndpoint;

let aiAccount = null;

/* ── who is signed in, and whether it is still who was here ─────────
 * A browser does not promise one person per tab: a second tab can sign in as
 * somebody else and the session in storage is shared. So this tab asks again
 * whenever it becomes visible, and reloads when the answer is not the person
 * whose rows are on screen. Reloading is the honest fix — guessing which row
 * belongs to whom is how one account's data ends up under another's name. */
function wireAuth() {
  ai.setTokenSource(db.currentToken);
  /* The very first event arrives before a session is read, and reloading on it
   * would be a loop. Only a page that is already showing somebody can be
   * showing the wrong somebody. */
  db.watchAuth((event, id) => {
    const mine = S.session?.user?.id;
    if (!mine) return;
    if (!id || event === 'SIGNED_OUT') { location.reload(); return; }
    if (id !== mine) location.reload();
  }).catch(() => {});
  /* Three ways to notice, because one is not enough: coming back into view, the
   * storage event another tab's sign-in fires, and the client's own state. The
   * first two ask storage — the client in this tab still believes it is the
   * person who loaded the page. */
  const check = () => {
    const now = ai.storedId() || null;
    /* sitting on the gate while another tab signs in is the same question in
     * reverse: if a session exists and this page has nobody, take it */
    if (!S.session) {
      if (now) location.reload();
      return;
    }
    if (now !== S.session.user?.id) location.reload();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.includes('-auth-token')) check();
  });
}

/* ── settings: one component, the same dialog in every app ────────── */
let SET = null;

function wireAiDialog() {
  SET = settings.mountSettings({
    dialog: $('#ai-dialog'),
    proxy: engine.PROXY,
    onSaved: () => { try { paintAiHint(); } catch {} },
  });
  $('#btn-ai').onclick = () => openAiDialog();
  const hint = $('#ai-hint-open');
  if (hint) hint.onclick = () => openAiDialog();
}

async function openAiDialog() {
  if (await ai.adoptAccountAi()) { try { paintAiHint(); } catch {} }
  SET.open();
}

function paintAiHint() {
  const el = $('#ai-hint');
  if (!el) return;
  el.hidden = !!aiCfg().key || !canWrite();
}

/* Models obey the shape, then decorate it. Strip what the app does not render. */
function plain(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[*-]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function ask(messages) {
  const c = aiCfg();
  if (!c.key) {
    openAiDialog();
    SET?.say?.('no key yet — paste one here, once', 'bad');
    throw new Error('no model key');
  }
  const body = {
    url: aiEndpoint(c.url), key: c.key,
    model: c.model || 'gpt-4o-mini', messages,
  };
  let res = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if ((res.status === 404 || res.status === 405) && SHARED_PROXY) {
    res = await fetch(SHARED_PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }
  const text = await res.text();
  if (!res.ok) {
    let d = null;
    try { d = JSON.parse(text); } catch {}
    const why = (d && (d.error?.message || d.error || d.raw)) || text || '';
    throw new Error(('the model said: ' + (why || 'http ' + res.status)).slice(0, 180));
  }
  let data;
  try { data = JSON.parse(text); } catch { return plain(text); }
  return plain(data.choices?.[0]?.message?.content || data.content || '');
}

/* ── the model's reading: proposals, never edits ──────────────────── */
function wireReview() {
  const dlg = $('#review-dialog');
  $('#review-x').onclick = () => dlg.close();
  $('#btn-review').onclick = runReview;
  $('#brief-ai').onclick = draftFromBrief;
  $('#review-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-use]');
    if (!b) return;
    const i = Number(b.dataset.use);
    await applyProposal(i);
    b.closest('li').remove();
    afterReview();
    // the last one used: the sheet is behind the dialog and wants the room
    if (!$('#review-list').children.length) $('#review-dialog').close();
  });
  $('#review-all').onclick = async () => {
    for (let i = 0; i < S.proposals.length; i++) {
      if (!S.proposals[i]) continue;
      await applyProposal(i);
    }
    $('#review-list').innerHTML = '';
    S.proposals = [];
    afterReview();
    $('#review-dialog').close();
  };
}

function afterReview() {
  const left = $('#review-list').children.length;
  $('#review-none').hidden = left > 0;
  paintSheet();
}

async function runReview() {
  if (!canWrite() || S.busy) return;
  const rows = S.reqs
    .filter((r) => r.statement || r.title)
    .sort((a, b) => (a.strength === 'must' ? -1 : 0) - (b.strength === 'must' ? -1 : 0))
    .slice(0, 40);
  if (!rows.length) return say($('#brief-msg'), 'nothing to read yet', 'bad');
  S.busy = true;
  say($('#brief-msg'), 'reading the sheet…', 'busy');
  try {
    const out = await ask(prompts.review(S.project, rows));
    S.proposals = parseReview(out, rows);
    paintProposals();
    say($('#brief-msg'), '');
    if (!S.proposals.length) say($('#review-msg'), 'nothing to change', 'ok');
    else { $('#review-none').hidden = true; $('#review-dialog').showModal(); }
  } catch (e) {
    say($('#brief-msg'), e.message || String(e), 'bad');
  } finally {
    S.busy = false;
  }
}

/* the sheet shows a sentence and two words, so the reading proposes only what
 * can land on the screen — a proposal into a hidden field would be invisible */
const FIELDS = ['statement', 'theme', 'kind', 'strength'];

/* Read the answer, not the shape: a model may add quotes, a colon, or a whole
 * preamble, but the four parts of a proposal are always there in order. */
function parseReview(text, rows) {
  const byRef = new Map(rows.map((r) => [r.ref, r]));
  const byNum = new Map(rows.map((r) => [String(r.ref).replace(/\D/g, ''), r]));
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^[\s|]+|[\s|]+$/g, '');
    if (!line || /^nothing$/i.test(line)) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 3) continue;
    const ref = parts[0].replace(/[^\w-]/g, '');
    const row = byRef.get(ref) || byNum.get(ref.replace(/\D/g, ''));
    if (!row) continue;
    const field = parts[1].toLowerCase().replace(/[^a-z]/g, '');
    if (!FIELDS.includes(field)) continue;
    let value = parts[2].replace(/^["'“]|["'”]$/g, '').trim();
    if (field === 'kind') {
      const k = value.toLowerCase();
      value = k.startsWith('non') ? 'nonfunctional'
        : k.startsWith('func') ? 'functional'
        : k.startsWith('cons') ? 'constraint'
        : k.startsWith('rule') ? 'rule' : '';
      if (!value) continue;
    }
    if (field === 'strength') {
      const s = value.toLowerCase();
      value = /must|hard|mandatory/.test(s) ? 'must'
        : /opt|should|nice/.test(s) ? 'optional'
        : /wish|want|could/.test(s) ? 'wish' : '';
      if (!value) continue;
    }
    if (!value) continue;
    if ((row[field] || '').trim() === value) continue;
    out.push({
      kind: 'edit', id: row.id, ref: row.ref, field,
      value, why: parts[3] || '', before: row[field] || '',
    });
  }
  return out.slice(0, 20);
}

function paintProposals() {
  const ul = $('#review-list');
  ul.innerHTML = S.proposals.map((p, i) => `
    <li>
      <span class="r">${esc(p.ref || 'new')}</span>
      <span>
        <span class="f">${esc(p.kind === 'term' ? 'glossary' : (p.field || 'row'))}</span>
        <span class="v">${esc(p.kind === 'term' ? p.term : (p.value || p.statement || ''))}</span>
        ${p.kind === 'term' ? `<span class="w">${esc(p.value)}</span>` : ''}
        ${p.why ? `<span class="w">${esc(p.why)}</span>` : ''}
        ${p.before ? `<span class="w">was: ${esc(String(p.before).slice(0, 60))}</span>` : ''}
      </span>
      <button class="ghost" type="button" data-use="${i}">use it</button>
    </li>`).join('');
  $('#review-none').hidden = S.proposals.length > 0;
}

async function applyProposal(i) {
  const p = S.proposals[i];
  if (!p || !canWrite()) return;
  try {
    if (p.kind === 'edit') {
      const row = await db.updateReq(p.id, { [p.field]: p.value });
      const at = S.reqs.findIndex((r) => r.id === p.id);
      if (at >= 0) S.reqs[at] = row;
      say($('#review-msg'), `${p.ref} ${p.field} → used`, 'ok');
    } else if (p.kind === 'term') {
      const term = await db.addTerm(S.project.id, p.term, p.value);
      S.terms.push(term);
      S.terms.sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()));
      paintTerms();
      say($('#review-msg'), `${p.term} → glossary`, 'ok');
    } else if (p.kind === 'new') {
      const pos = S.reqs.reduce((n, r) => Math.max(n, r.pos || 0), 0) + 1;
      const row = await db.addReq(S.project.id, {
        statement: p.statement, strength: p.strength || 'must', theme: p.theme || '', pos,
      });
      S.reqs.push(row);
      say($('#review-msg'), `${row.ref} added`, 'ok');
    }
  } catch (e) {
    say($('#review-msg'), e.message || String(e), 'bad');
    return;
  }
  S.proposals[i] = null;
}

async function draftFromBrief() {
  if (!canWrite() || S.busy) return;
  const text = [$('#brief-text').value, $('#brief-assume').value, $('#brief-scope').value]
    .filter(Boolean).join('\n\n').trim();
  if (!text) return say($('#brief-msg'), 'write the brief first — the model works from it', 'bad');
  S.busy = true;
  say($('#brief-msg'), 'drafting rows…', 'busy');
  try {
    const out = await ask(prompts.draft(S.project, text));
    const rows = String(out).split('\n').map((raw) => {
      const parts = raw.split('|').map((s) => s.trim());
      if (!parts[0] || /^nothing$/i.test(parts[0])) return null;
      const s = (parts[1] || '').toLowerCase();
      return {
        kind: 'new',
        ref: '',
        field: 'new row',
        statement: parts[0].replace(/^["'“]|["'”]$/g, ''),
        strength: /opt|should|nice/.test(s) ? 'optional' : /wish|want/.test(s) ? 'wish' : 'must',
        theme: parts[2] || '',
      };
    }).filter(Boolean).slice(0, 12);
    if (!rows.length) { say($('#brief-msg'), 'the model had nothing usable', 'bad'); return; }
    S.proposals = rows;
    paintProposals();
    say($('#brief-msg'), '');
    $('#review-dialog').showModal();
  } catch (e) {
    say($('#brief-msg'), e.message || String(e), 'bad');
  } finally {
    S.busy = false;
  }
}

async function suggestTerms() {
  if (!canWrite() || S.busy) return;
  const rows = S.reqs.filter((r) => r.statement || r.title).slice(0, 60);
  if (!rows.length) return say($('#term-msg'), 'no rows to read yet', 'bad');
  S.busy = true;
  say($('#term-msg'), 'reading the rows…', 'busy');
  try {
    const out = await ask(prompts.glossary(S.project, rows));
    const words = String(out).split('\n').map((raw) => {
      const parts = raw.split('|').map((s) => s.trim());
      if (!parts[0] || /^nothing$/i.test(parts[0])) return null;
      return { term: parts[0].replace(/^["'“]|["'”]$/g, ''), meaning: parts[1] || '' };
    }).filter(Boolean).slice(0, 10);
    if (!words.length) { say($('#term-msg'), 'no words worth adding', 'ok'); return; }
    S.proposals = words.map((w) => ({ kind: 'term', ref: 'word', field: 'glossary', value: w.meaning, term: w.term, why: '' }));
    paintProposals();
    say($('#term-msg'), `${words.length} words proposed — use them from the list`, 'ok');
    // terms are applied in the same review list, so a word needs one extra line
    const ul = $('#review-list');
    ul.innerHTML += '';
    $('#review-dialog').showModal();
  } catch (e) {
    say($('#term-msg'), e.message || String(e), 'bad');
  } finally {
    S.busy = false;
  }
}

/* ── paste from a spreadsheet ─────────────────────────────────────── */
function wirePaste() {
  const dlg = $('#paste-dialog');
  $('#btn-paste').onclick = () => { $('#paste-text').value = ''; say($('#paste-msg'), ''); dlg.showModal(); };
  $('#paste-x').onclick = () => dlg.close();
  $('#paste-x2').onclick = () => dlg.close();
  $('#paste-text').addEventListener('input', () => {
    const rows = parsePaste($('#paste-text').value);
    say($('#paste-msg'), rows.length ? `${rows.length} rows ready` : '', 'ok');
  });
  $('#paste-do').onclick = async () => {
    const rows = parsePaste($('#paste-text').value);
    if (!rows.length) return say($('#paste-msg'), 'nothing that looks like a row', 'bad');
    try {
      let pos = S.reqs.reduce((n, r) => Math.max(n, r.pos || 0), 0);
      const payload = rows.map((r, i) => ({
        ...r, pos: pos + i + 1, ref: db.nextRef(S.reqs, i + 1),
      }));
      const added = await db.addReqs(S.project.id, payload);
      S.reqs.push(...added);
      paintSheet();
      dlg.close();
      say($('#brief-msg'), `${added.length} rows added`, 'ok');
    } catch (e) {
      say($('#paste-msg'), e.message || String(e), 'bad');
    }
  };
}

/* Tab first (Excel), then comma. Quoted commas stay together. */
function splitLine(line) {
  if (line.includes('\t')) return line.split('\t');
  const cells = [];
  let cur = '', quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (quote && line[i + 1] === '"') { cur += '"'; i++; } else quote = !quote; }
    else if (c === ',' && !quote) { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

const STRENGTH_WORD = /^(must|mandatory|hard|optional|should|nice to have|wish|want|could)$/i;
const KIND_WORD = /^(functional|non-?functional|nfr|constraint|business rule|rule)$/i;

function parsePaste(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cells = splitLine(line).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!cells.some((c) => c)) continue;
    if (/^vr-?\d+$/i.test(cells[0])) cells.shift();
    if (out.length === 0 && cells.join(' ').match(/vrst|kategor|opis zahtjeva|requirement|statement/i)) continue;

    let strength = 'must';
    let kind = 'functional';
    const rest = [];
    for (const c of cells) {
      if (!c) continue;
      if (STRENGTH_WORD.test(c)) {
        strength = /opt|should|nice/i.test(c) ? 'optional'
          : /wish|want|could/i.test(c) ? 'wish' : 'must';
      } else if (KIND_WORD.test(c)) {
        kind = /non|nfr/i.test(c) ? 'nonfunctional'
          : /constraint/i.test(c) ? 'constraint'
          : /rule/i.test(c) ? 'rule' : 'functional';
      } else rest.push(c);
    }
    if (!rest.length) continue;
    // the sentence is the longest cell, whatever order the spreadsheet had;
    // a short cell beside it is the theme, the rest is the long version
    rest.sort((a, b) => b.length - a.length);
    const statement = rest.shift();
    // "the visit" is a theme, not a requirement: a row needs a sentence
    if (!statement || statement.trim().length < 12) continue;
    const theme = rest.length && rest[0].length <= 40 ? rest.shift() : '';
    const detail = rest.join(' ').slice(0, 2000);
    out.push({ statement, strength, kind, theme, detail });
  }
  return out;
}

/* ── copy the document as markdown ────────────────────────────────── */
async function copyDoc() {
  const md = toMarkdown();
  try {
    await navigator.clipboard.writeText(md);
    flash(`copied ${S.reqs.length} rows as markdown`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); flash(`copied ${S.reqs.length} rows as markdown`); }
    catch { flash('the browser would not copy; print instead', 'bad'); }
    ta.remove();
  }
}

function toMarkdown() {
  const p = S.project;
  const L = [`# ${p.title}`, ''];
  if (p.brief) L.push(p.brief, '');
  if (p.assumptions) L.push('## assumptions', '', ...p.assumptions.split('\n').map((l) => `- ${l}`), '');
  if (p.scope) L.push('## out of scope', '', ...p.scope.split('\n').map((l) => `- ${l}`), '');
  if (S.terms.length) {
    L.push('## glossary', '');
    for (const t of S.terms) L.push(`- **${t.term}** — ${t.meaning}`);
    L.push('');
  }
  /* What a person reads, not what the table holds: the sentence, how hard it is,
   * what kind of thing it is, and the name of the proof if there is one. No
   * names, no ids, no long version — the sheet is small enough to read. */
  const groups = new Map();
  for (const r of S.reqs) {
    const k = themePath(r.theme_id) || r.theme || 'no theme';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [theme, rows] of groups) {
    L.push(`## ${theme}`, '');
    for (const r of rows) {
      L.push(`- ${(r.statement || r.title || '(no sentence)').trim()}`);
      const meta = [r.strength, r.kind].filter(Boolean);
      if (r.file_name) meta.push('file: ' + r.file_name);
      L.push(`  _${meta.join(' · ')}_`);
    }
    L.push('');
  }
  return L.join('\n').trim() + '\n';
}

/* ── sharing ──────────────────────────────────────────────────────── */
function wireShare() {
  const dlg = $('#share-dialog');
  $('#btn-share').onclick = () => openShare();
  $('#share-x').onclick = () => dlg.close();
  $('#share-make').onclick = async () => {
    try {
      const s = await db.makeLink(S.project.id);
      $('#share-link').value = location.origin + '/?s=' + s.code;
      await paintShares();
      say($('#share-msg'), 'link made — anyone with it can read', 'ok');
    } catch (e) { say($('#share-msg'), e.message || String(e), 'bad'); }
  };
  $('#share-copy').onclick = async () => {
    const v = $('#share-link').value;
    if (!v) return say($('#share-msg'), 'no link yet', 'bad');
    try { await navigator.clipboard.writeText(v); say($('#share-msg'), 'copied', 'ok'); }
    catch { $('#share-link').select(); say($('#share-msg'), 'select and copy', 'bad'); }
  };
  $('#share-add').onclick = async () => {
    try {
      await db.shareWith(S.project.id, $('#share-email').value, $('#share-role').value);
      $('#share-email').value = '';
      await paintShares();
      say($('#share-msg'), 'shared', 'ok');
    } catch (e) { say($('#share-msg'), e.message || String(e), 'bad'); }
  };
  $('#share-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-revoke]');
    if (!b) return;
    try { await db.revokeShare(b.dataset.revoke); await paintShares(); say($('#share-msg'), 'revoked', 'ok'); }
    catch (err) { say($('#share-msg'), err.message || String(err), 'bad'); }
  });
}

async function openShare() {
  say($('#share-msg'), '');
  $('#share-link').value = '';
  $('#share-dialog').showModal();
  await paintShares();
}

async function paintShares() {
  if (!S.project) return;
  let rows = [];
  try { rows = await db.listShares(S.project.id); } catch {}
  const link = rows.find((s) => s.code);
  if (link) $('#share-link').value = location.origin + '/?s=' + link.code;
  $('#share-list').innerHTML = rows.map((s) => `
    <li>
      <span class="who">${s.code ? 'anyone with the link' : esc(s.email)}</span>
      <span class="role">${s.role === 'edit' ? 'can write' : 'can read'}</span>
      <button class="ghost" type="button" data-revoke="${s.id}">revoke</button>
    </li>`).join('');
}

/* ── a guest opens a link ─────────────────────────────────────────── */
async function enterGuest(code) {
  S.guest = code;
  S.role = 'view';
  wireGlossary();
  try {
    const data = await db.readShare(code);
    if (!data || !data.project) throw new Error('this link is not valid any more');
    S.project = data.project;
    S.reqs = data.reqs || [];
    S.terms = data.terms || [];
    $('#spec').hidden = false;
    $('#welcome').hidden = true;
    applyRole();
    paintSheet();
    paintBrief();
    paintAiHint();
  } catch (e) {
    $('#app').hidden = true;
    $('#gate').hidden = false;
    say($('#gate-msg'), e.message || String(e), 'bad');
  }
}

/* ── wiring ───────────────────────────────────────────────────────── */
function wireChrome() {
  $('#btn-out').onclick = async () => { await db.signOut(); location.reload(); };
  $('#btn-projects').onclick = () => {
    document.body.dataset.rail = document.body.dataset.rail === 'open' ? '' : 'open';
  };

  const saveTitle = debounce(async () => {
    if (!isOwner() || !S.project) return;
    const title = $('#proj-title').value.trim() || 'untitled spec';
    if (title === S.project.title) return;
    try {
      S.project = await db.updateProject(S.project.id, { title });
      const row = S.projects.find((p) => p.id === S.project.id);
      if (row) row.title = title;
      if (document.activeElement !== $('#proj-title')) $('#proj-title').value = title;
      paintProjects();
    } catch (e) { console.error(e); }
  }, 600);
  $('#proj-title').addEventListener('input', saveTitle);

  $('#btn-own').onclick = async () => {
    if (!S.project) return;
    if (!confirm('Copy this document into your own documents?')) return;
    flash('copying…', 'ok');
    try {
      const p = await db.copyToMe(S.project, S.reqs, S.terms, S.themes, S.vocab);
      try { localStorage.setItem('vpl.vr.last', p.id); } catch {}
      location.href = location.pathname;
    } catch (e) {
      flash(e.message || 'the copy failed', 'bad');
    }
  };

  $('#btn-new').onclick = newProject;
  $('#btn-first').onclick = newProject;
  $('#proj-list').addEventListener('click', (e) => {
    const del = e.target.closest('button[data-del-project]');
    if (del) return removeProject(del.dataset.delProject);
    const row = e.target.closest('.proj-row');
    if (!row) return;
    const p = S.projects.find((x) => x.id === row.dataset.id);
    document.body.dataset.rail = '';   // the drawer on a phone closes behind you
    if (p) openProject(p);
  });

  $('#req-add').setAttribute('aria-label', 'a new requirement');
  $('#req-add').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addRow(e.target.value);
  });
  $('#req-add').addEventListener('input', () => {
    const v = $('#req-add').value.trim();
    $('#sheet-none').hidden = S.reqs.length > 0 || !v;
  });

  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) {
      const pick = e.target.closest('button[data-pick-file]');
      if (pick) {
        $(`input[data-file-input="${pick.dataset.pickFile}"]`)?.click();
        return;
      }
      const open = e.target.closest('button[data-open-file]');
      if (open) return openFile(open.dataset.openFile);
      const drop = e.target.closest('button[data-drop-file]');
      if (drop) return dropFile(drop.dataset.dropFile);
      const close = e.target.closest('button[data-close]');
      if (close) { S.open = null; paintSheet(); }
      return;
    }
    const id = tr.dataset.id;
    if (e.target.closest('.c-strength .chip-value')) return cycleStrength(id);
    if (e.target.closest('.c-status .chip-value')) return cycleStatus(id);
    if (e.target.closest('.req-open')) { S.open = S.open === id ? null : id; return paintSheet(); }
    const mv = e.target.closest('button[data-move]');
    if (mv) return moveRow(id, Number(mv.dataset.move));
    const del = e.target.closest('button[data-del]');
    if (del) return deleteRow(id);
    const close = e.target.closest('button[data-close]');
    if (close) { S.open = null; paintSheet(); }
  });

  $('#rows').addEventListener('input', (e) => {
    const tr = e.target.closest('tr.detail');
    if (!tr || !canWrite()) return;
    const field = e.target.dataset.field;
    if (!field) return;
    if (!isOwner() && ['kind', 'status', 'strength', 'title'].includes(field)) return;
    const rowId = tr.previousElementSibling?.dataset.id;
    if (!rowId) return;
    queue(rowId, field, e.target.value);
  });
  $('#rows').addEventListener('change', (e) => {
    const fin = e.target.closest('input[data-file-input]');
    if (fin) return takeFile(fin);
    const tr = e.target.closest('tr.detail');
    if (!tr || !canWrite()) return;
    const rowId = tr.previousElementSibling?.dataset.id;
    if (!rowId) return;
    const row = S.reqs.find((r) => r.id === rowId);

    const axis = e.target.dataset.axis;
    if (axis) {
      if (e.target.value === '__new') {
        addWord(axis, (word) => queue(rowId, axis === 'importance' ? 'strength' : axis, word));
        return;
      }
      if (axis === 'importance' && !isOwner()) return;
      queue(rowId, axis === 'importance' ? 'strength' : axis, e.target.value);
      return;
    }
    if (e.target.dataset.field === 'theme_id') {
      const id = e.target.value || null;
      const t = themeById(id);
      /* keep the printed word in step with the tree */
      if (row) row.theme = t ? t.name : '';
      queue(rowId, 'theme_id', id);
      if (t) queue(rowId, 'theme', t.name);
      return;
    }
  });

  $('#q').addEventListener('input', (e) => { S.q = e.target.value; S.page = 1; paintSheet(); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $('#q').value = ''; S.q = ''; S.page = 1; paintSheet();
  });

  /* a column heading sorts; a second click turns it round */
  $('#sheet thead').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const field = th.dataset.sort;
    S.sort = S.sort.field === field
      ? { field, dir: -S.sort.dir }
      : { field, dir: field === 'pos' || field === 'ref' ? 1 : 1 };
    S.page = 1;
    paintSheet();
  });

  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b || b.disabled) return;
    S.page += Number(b.dataset.page);
    paintSheet();
  });

  /* the tree: pick a theme, add one under it, or delete one */
  $('#theme-tree').addEventListener('click', async (e) => {
    const pick = e.target.closest('button[data-theme]');
    if (pick) {
      S.themeId = pick.dataset.theme || null;
      S.page = 1;
      document.body.dataset.rail = '';
      paintSheet();
      return;
    }
    const sub = e.target.closest('button[data-sub]');
    if (sub && canWrite()) {
      const name = (prompt('a subtheme inside ' + (themeById(sub.dataset.sub)?.name || 'this theme')) || '').trim();
      if (!name) return;
      try {
        const t = await db.addTheme(S.project.id, name, sub.dataset.sub);
        S.themes.push(t);
        paintSheet();
      } catch (err) { flash(err.message || 'the theme could not be added', 'bad'); }
      return;
    }
    const del = e.target.closest('button[data-del-theme]');
    if (del && isOwner()) {
      const t = themeById(del.dataset.delTheme);
      if (!t) return;
      if (!confirm(`Delete the theme "${themePath(t.id)}"? Its rows stay, without a theme.`)) return;
      try {
        await db.deleteTheme(t.id);
        S.themes = S.themes.filter((x) => x.id !== t.id && x.parent_id !== t.id);
        S.reqs.forEach((r) => { if (r.theme_id === t.id) r.theme_id = null; });
        if (S.themeId === t.id) S.themeId = null;
        paintSheet();
      } catch (err) { flash(err.message || 'the theme could not be deleted', 'bad'); }
    }
  });

  $('#btn-new-theme').onclick = async () => {
    if (!canWrite() || !S.project) return;
    const name = (prompt('a new theme') || '').trim();
    if (!name) return;
    try {
      const t = await db.addTheme(S.project.id, name, null);
      S.themes.push(t);
      S.themeId = t.id;
      paintSheet();
    } catch (e) { flash(e.message || 'the theme could not be added', 'bad'); }
  };

  /* the breadcrumb is the door to the tree on a phone */
  $('#crumb').onclick = () => {
    const narrow = window.matchMedia('(max-width: 780px)').matches;
    if (narrow) document.body.dataset.rail = 'open';
    else document.getElementById('theme-tree')?.scrollIntoView({ block: 'nearest' });
  };

  try {
  } catch {}

  $('#btn-copy').onclick = copyDoc;

  /* Print is the document, so the brief opens for the paper and closes again
   * for the screen; the strip under the title carries what a page needs. */
  let wasOpen = false;
  let printPer = 20;
  window.addEventListener('beforeprint', () => {
    wasOpen = $('#brief').open;
    $('#brief').open = true;
    /* paper is not paged: the document prints whole, whatever the screen shows */
    printPer = S.per;
    S.per = 100000;
    paintSheet();
  });
  window.addEventListener('afterprint', () => {
    if (!wasOpen) $('#brief').open = false;
    S.per = printPer;
    paintSheet();
  });
  $('#brief-save').onclick = saveBrief;

  // Alt+↑ / Alt+↓ moves the row the caret is in
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const tr = document.activeElement.closest?.('tr[data-id], tr.detail');
    if (!tr) return;
    const row = tr.dataset.id ? tr : tr.previousElementSibling;
    if (!row?.dataset.id) return;
    e.preventDefault();
    moveRow(row.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
  });
}

async function newProject() {
  if (!isOwner()) return;
  try {
    const p = await db.createProject('untitled spec');
    S.projects.unshift(p);
    await openProject(p);
    $('#proj-title').focus();
    $('#proj-title').select();
  } catch (e) { console.error(e); }
}

async function removeProject(id) {
  if (!isOwner()) return;
  const p = S.projects.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Delete "${p.title}" and every row in it?`)) return;
  try {
    await db.deleteProject(id);
    S.projects = S.projects.filter((x) => x.id !== id);
    if (S.project && S.project.id === id) {
      const next = S.projects[0];
      if (next) await openProject(next);
      else { S.project = null; showWelcome(); }
    }
    paintProjects();
  } catch (e) { console.error(e); }
}

boot();

/* ── the settings dialog, and the dock ─────────────────────────────
 * Same dialog as every other app, same dock. The dock reads what is on
 * screen and answers about it; nothing it writes lands anywhere until a
 * person says so. */
/* The model gets the brief and the requirement that is open, in words — not a
 * scrape of a table, which would be a wall of statuses. */
function dockContext() {
  const brief = document.getElementById('brief-text');
  const parts = [];
  if (brief && brief.value.trim()) parts.push('The brief:\n' + brief.value.trim());
  const open = S.reqs.find((r) => r.id === S.open);
  if (open) {
    parts.push(['The requirement on screen:', open.statement,
      `how hard: ${open.strength || '?'} · status: ${open.status || '?'}`
      + (open.detail ? `\nnotes: ${open.detail}` : '')].join('\n'));
  }
  const field = lastField();
  const sel = field && field.selectionEnd > field.selectionStart
    ? field.value.slice(field.selectionStart, field.selectionEnd) : '';
  return { text: parts.join('\n\n'), selection: sel };
}

/* There is no single document here: the answer goes into the field the person
 * was last writing in — the brief, or the requirement's sentence. */
function useFromDock(text) {
  const field = lastField();
  if (!field) return 'open a requirement, or the brief, and put the caret in it first';
  if (!canWrite()) return 'this document is read-only for you';
  return putInto(field, text, null) ? '' : 'that field will not take it';
}

const DOCK = mountDock({
  app: 'vr',
  openSettings: () => SET && SET.open(),
  context: dockContext,
  onUse: useFromDock,
});
mountNotice({ app: 'vr', column: '#spec' });
