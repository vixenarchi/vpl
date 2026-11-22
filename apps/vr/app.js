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
import { prompts } from './prompts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const STRENGTH = ['must', 'optional', 'wish'];
const MARK = { must: '■', optional: '◆', wish: '◇' };
const KIND_LABEL = {
  functional: 'functional', nonfunctional: 'non-functional',
  constraint: 'constraint', rule: 'rule',
};

const S = {
  session: null,
  projects: [],
  project: null,
  reqs: [],
  terms: [],
  role: 'owner',     // owner | edit | view
  guest: null,       // a public link: no session, no writes
  filter: 'all',     // all | must | optional | wish
  gap: '',           // '' | noproof | nonumber
  q: '',
  all: false,        // all columns
  open: null,        // the row whose detail is open
  proposals: [],
  busy: false,
};

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

function displayName(session) {
  if (!session) return '';
  const m = session.user.user_metadata || {};
  const mail = session.user.email || '';
  return m.full_name || m.name || (mail.endsWith('@vpl.local') ? mail.split('@')[0] : mail);
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
  S.filter = 'all'; S.gap = ''; S.q = ''; $('#q').value = '';
  try { localStorage.setItem('vpl.vr.last', p.id); } catch {}
  $('#welcome').hidden = true;
  $('#spec').hidden = false;
  paintProjects();
  paintHead();

  if (!S.guest) S.role = (await db.roleOn(p)) || 'view';
  applyRole();

  try {
    const [reqs, terms] = await Promise.all([db.listReqs(p.id), db.listTerms(p.id)]);
    S.reqs = reqs;
    S.terms = terms;
  } catch (e) {
    console.error(e);
    S.reqs = []; S.terms = [];
  }
  paintSheet();
  paintBrief();
  paintAiHint();
  paintFilters();
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
function visible() {
  const q = S.q.trim().toLowerCase();
  return S.reqs.slice()
    .sort((a, b) => (a.pos || 0) - (b.pos || 0))
    .filter((r) => {
    if (S.filter !== 'all' && r.strength !== S.filter) return false;
    if (S.gap === 'noproof' && r.verification) return false;
    if (S.gap === 'nonumber' && !(r.kind === 'nonfunctional' && !r.metric.trim())) return false;
    if (S.gap === 'nostatement' && (r.statement || r.title)) return false;
    if (!q) return true;
    return [r.ref, r.title, r.statement, r.theme, r.category, r.source, r.verification, r.clause]
      .some((v) => (v || '').toLowerCase().includes(q));
  });
}

function paintFilters() {
  const counts = { all: S.reqs.length, must: 0, optional: 0, wish: 0 };
  for (const r of S.reqs) counts[r.strength] = (counts[r.strength] || 0) + 1;
  $$('#filters .chip').forEach((b) => {
    b.classList.toggle('on', b.dataset.f === S.filter && !S.gap);
    b.querySelector('b').textContent = counts[b.dataset.f] ?? 0;
  });
}

function paintSheet() {
  const rows = visible();
  const body = $('#rows');
  body.innerHTML = rows.map(rowHTML).join('');
  $('#sheet-none').hidden = S.reqs.length > 0;
  $('#sheet').dataset.all = S.all ? '1' : '0';
  paintFilters();
  paintGaps();
  paintMeta(rows.length);
  paintHead();
}

function rowHTML(r) {
  const title = r.title ? `<span class="req-title">${esc(r.title)}</span>` : '';
  const statement = r.statement || '';
  const line = statement && statement !== r.title
    ? `<span class="req-statement">${esc(statement)}</span>` : '';
  const open = S.open === r.id;
  return `
    <tr data-id="${r.id}" class="${open ? 'open' : ''}">
      <td class="c-ref">${esc(r.ref || '—')}</td>
      <td class="c-req"><div class="req-open">${title || esc(statement) || '<span class="muted">no sentence yet</span>'}${title && line ? '<br>' + line : ''}</div></td>
      <td class="c-strength">${strengthHTML(r)}</td>
      <td class="c-theme theme-cell" title="${esc(r.theme)}">${esc(r.theme) || '<span class="muted">—</span>'}</td>
      ${extraCells(r)}
      <td class="c-tools"><div class="row-tools">
        <button type="button" data-move="-1" title="move up" aria-label="move up">↑</button>
        <button type="button" data-move="1" title="move down" aria-label="move down">↓</button>
        <button type="button" data-del="${r.id}" class="o-only" title="delete this row" aria-label="delete">✕</button>
      </div></td>
    </tr>
    ${open ? detailHTML(r) : ''}`;
}

function extraCells(r) {
  return `
    <td class="c-extra extra-cell">${esc(KIND_LABEL[r.kind] || r.kind)}</td>
    <td class="c-extra extra-cell ${r.verification ? '' : 'empty'}">${esc(r.verification) || 'no proof'}</td>
    <td class="c-extra extra-cell ${r.source ? '' : 'empty'}">${esc(r.source) || '—'}</td>
    <td class="c-extra extra-cell ${r.horizon ? '' : 'empty'}">${esc(r.horizon) || '—'}</td>
    <td class="c-extra extra-cell">${esc(r.status)}</td>`;
}

function strengthHTML(r) {
  const s = STRENGTH.includes(r.strength) ? r.strength : 'must';
  return `<button class="strength" data-s="${s}" type="button" title="click to change: must → optional → wish">
    <span class="mark" aria-hidden="true">${MARK[s]}</span>${s}</button>`;
}

const DETAIL_FIELDS = [
  ['statement', 'one testable sentence', 'textarea', 'wide'],
  ['detail', 'the long version', 'textarea', 'wide'],
  ['asis', 'what it is today', 'textarea', ''],
  ['tobe', 'what it should be', 'textarea', ''],
  ['theme', 'theme (the group it belongs to)', 'text', ''],
  ['category', 'category, one level down', 'text', ''],
  ['horizon', 'when — free text: short, 2014/15, Q3', 'text', ''],
  ['source', 'who asked, or what forces it', 'text', ''],
  ['verification', 'how we will know — test, review, demo', 'text', ''],
  ['metric', 'for a non-functional: the measured thing', 'text', ''],
  ['target', 'the number it must reach', 'text', ''],
  ['conditions', 'under what conditions', 'text', ''],
  ['clause', 'a law or standard, down to the clause', 'text', ''],
];

function detailHTML(r) {
  const fields = DETAIL_FIELDS.map(([name, label, kind, cls]) => {
    const ownerOnly = name === 'kind' ? '' : '';
    if (kind === 'textarea') {
      return `<div class="${cls}"><label for="d-${r.id}-${name}">${label}</label>
        <textarea id="d-${r.id}-${name}" data-field="${name}" rows="${name === 'statement' || name === 'detail' ? 3 : 2}"
          >${esc(r[name])}</textarea></div>`;
    }
    return `<div class="${cls}"><label for="d-${r.id}-${name}">${label}</label>
      <input id="d-${r.id}-${name}" type="text" data-field="${name}" value="${esc(r[name])}"></div>`;
  }).join('');

  const decisions = `
    <div><label for="d-${r.id}-kind">kind</label>
      <select id="d-${r.id}-kind" data-field="kind" ${isOwner() ? '' : 'disabled'}>
        ${Object.entries(KIND_LABEL).map(([v, l]) => `<option value="${v}" ${r.kind === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
    <div><label for="d-${r.id}-status">status</label>
      <select id="d-${r.id}-status" data-field="status" ${isOwner() ? '' : 'disabled'}>
        ${['draft', 'agreed', 'built', 'verified', 'dropped'].map((v) => `<option ${r.status === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>
    <div><label for="d-${r.id}-strength">how hard</label>
      <select id="d-${r.id}-strength" data-field="strength" ${isOwner() ? '' : 'disabled'}>
        ${STRENGTH.map((v) => `<option ${r.strength === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>`;

  return `<tr class="detail"><td colspan="10">
    <div class="detail-grid">
      <div class="wide"><label for="d-${r.id}-title">title — a few words, for the sheet</label>
        <input id="d-${r.id}-title" type="text" data-field="title" value="${esc(r.title)}" ${isOwner() ? '' : 'disabled'}></div>
      ${fields}
      ${decisions}
    </div>
    <div class="detail-foot">
      <span class="msg" id="d-msg-${r.id}"></span>
      <span class="muted small">${esc(r.ref)} — every change is saved</span>
      <button class="ghost" type="button" data-close="${r.id}">close</button>
    </div>
  </td></tr>`;
}

/* counts above the sheet, and what is missing */
function paintMeta(shown) {
  if (!S.project) return;
  const n = S.reqs.length;
  const must = S.reqs.filter((r) => r.strength === 'must').length;
  const optional = S.reqs.filter((r) => r.strength === 'optional').length;
  const wish = S.reqs.filter((r) => r.strength === 'wish').length;
  const parts = [`${n} row${n === 1 ? '' : 's'}`, `${must} must`];
  if (optional) parts.push(`${optional} optional`);
  parts.push(`${wish} wish`);
  if (shown !== n) parts.push(`${shown} shown`);
  if (S.role !== 'owner') parts.push(S.role === 'edit' ? 'you may write, not decide' : 'read only');
  $('#proj-meta').textContent = parts.join(' · ');

  const when = new Date().toLocaleDateString();
  $('#print-meta').textContent = S.project
    ? `${when} · ${S.project.title} · ${parts.join(' · ')} · vr.terg.hr`
    : '';
}

function paintGaps() {
  const noProof = S.reqs.filter((r) => !r.verification && r.strength === 'must').length;
  const noNumber = S.reqs.filter((r) => r.kind === 'nonfunctional' && !r.metric.trim()).length;
  const noSource = S.reqs.filter((r) => !r.source).length;
  const el = $('#gaps');
  const bits = [];
  if (noProof) bits.push(`<button type="button" data-gap="noproof">${noProof} must without proof</button>`);
  if (noNumber) bits.push(`<button type="button" data-gap="nonumber">${noNumber} non-functional without a number</button>`);
  if (S.all && noSource) bits.push(`<span>${noSource} without a source</span>`);
  if (S.gap) bits.push(`<button type="button" data-gap="">clear</button>`);
  el.hidden = bits.length === 0;
  el.innerHTML = bits.length ? bits.join('') : '';
  if (!bits.length && S.reqs.length) {
    el.hidden = false;
    el.innerHTML = `<span class="none">every must has a proof, every non-functional has a number.</span>`;
  }
}

/* ── editing a row ────────────────────────────────────────────────── */
const pending = new Map();
function queue(id, field, value) {
  const key = id + ':' + field;
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(async () => {
    pending.delete(key);
    try {
      const row = await db.updateReq(id, { [field]: value });
      const at = S.reqs.findIndex((r) => r.id === id);
      if (at >= 0) S.reqs[at] = row;
      if (['strength', 'verification', 'metric', 'kind', 'source', 'theme'].includes(field)) {
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
  const title = r.title ? `<span class="req-title">${esc(r.title)}</span>` : '';
  const line = r.statement && r.statement !== r.title
    ? `<span class="req-statement">${esc(r.statement)}</span>` : '';
  return title || esc(r.statement) || '<span class="muted">no sentence yet</span>';
}

async function addRow(text) {
  if (!canWrite()) return;
  const sentence = text.trim();
  if (!sentence) return;
  const pos = S.reqs.reduce((n, r) => Math.max(n, r.pos || 0), 0) + 1;
  try {
    const row = await db.addReq(S.project.id, { statement: sentence, pos });
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
  const next = STRENGTH[(STRENGTH.indexOf(r.strength) + 1) % STRENGTH.length];
  try {
    const row = await db.updateReq(id, { strength: next });
    Object.assign(r, row);
    paintSheet();
  } catch (e) { console.error(e); }
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
const SHARED_PROXY = 'https://api.terg.hr/chat';
const aiCfg = () => ai.readAi();
const aiEndpoint = ai.aiEndpoint;

function wireAiDialog() {
  const dlg = $('#ai-dialog');
  $('#btn-ai').onclick = () => openAiDialog();
  $('#ai-hint-open').onclick = () => openAiDialog();
  $('#ai-x').onclick = () => dlg.close();
  const form = ai.mountAi({
    provider: $('#ai-provider'), url: $('#ai-url'),
    model: $('#ai-model'), models: $('#ai-models'),
  });
  $('#search-provider').innerHTML = ai.SEARCH_PROVIDERS
    .map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

  $('#ai-save').onclick = () => {
    const { url, model } = form.read();
    const key = $('#ai-key').value.trim() || aiCfg().key;
    if (!url || !key) return say($('#ai-msg'), 'both url and key, please', 'bad');
    ai.writeAi({ url, key, model: model || 'gpt-4o-mini' });
    const provider = $('#search-provider').value;
    const searchKey = $('#search-key').value.trim();
    ai.writeSearch({ provider: provider && searchKey ? provider : '', key: provider && searchKey ? searchKey : '' });
    say($('#ai-msg'), 'saved in this browser', 'ok');
    paintAiHint();
  };
  $('#ai-forget').onclick = () => {
    ai.forgetKeys();
    $('#ai-key').value = ''; $('#search-key').value = '';
    say($('#ai-msg'), 'keys forgotten', 'ok');
    paintAiHint();
  };
}

function openAiDialog() {
  const c = aiCfg();
  $('#ai-key').value = c.key || '';
  const sc = ai.readSearch();
  $('#search-provider').value = sc.provider || '';
  $('#search-key').value = sc.key || '';
  say($('#ai-msg'), '');
  $('#ai-dialog').showModal();
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
    say($('#ai-msg'), 'no key yet — paste one here, once', 'bad');
    throw new Error('no model key');
  }
  const body = {
    url: aiEndpoint(c.url), key: c.key,
    model: c.model || 'gpt-4o-mini', messages,
  };
  let res = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.status === 404 || res.status === 405) {
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

const FIELDS = ['theme', 'kind', 'strength', 'verification', 'metric'];

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
  const groups = new Map();
  for (const r of S.reqs) {
    const k = r.theme || 'no theme';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [theme, rows] of groups) {
    L.push(`## ${theme}`, '');
    for (const r of rows) {
      L.push(`- **${r.ref}**${r.title ? ' ' + r.title + ' —' : ''} ${r.statement || '(no sentence)'}  `);
      const meta = [r.strength, KIND_LABEL[r.kind] || r.kind];
      if (r.horizon) meta.push(r.horizon);
      if (r.source) meta.push(`from ${r.source}`);
      L.push(`  _${meta.join(' · ')}_`);
      if (r.verification) L.push(`  proof: ${r.verification}`);
      if (r.metric) L.push(`  number: ${r.metric}${r.target ? ' ≥ ' + r.target : ''}${r.conditions ? ' under ' + r.conditions : ''}`);
      if (r.clause) L.push(`  reference: ${r.clause}`);
      if (r.asis || r.tobe) L.push(`  today: ${r.asis || '—'} → wanted: ${r.tobe || '—'}`);
      if (r.detail) L.push('', r.detail);
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
    S.all = S.reqs.some((r) => r.verification || r.source || r.clause || r.horizon);
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
  $('#btn-theme').onclick = toggleTheme;
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

  $('#btn-new-project').onclick = newProject;
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
      const close = e.target.closest('button[data-close]');
      if (close) { S.open = null; paintSheet(); }
      return;
    }
    const id = tr.dataset.id;
    if (e.target.closest('.strength')) return cycleStrength(id);
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
    const tr = e.target.closest('tr.detail');
    if (!tr || !canWrite()) return;
    const field = e.target.dataset.field;
    if (!field || !/^(kind|status|strength)$/.test(field)) return;
    if (!isOwner()) return;
    const rowId = tr.previousElementSibling?.dataset.id;
    if (!rowId) return;
    queue(rowId, field, e.target.value);
  });

  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    S.filter = b.dataset.f;
    S.gap = '';
    paintSheet();
  });
  $('#gaps').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-gap]');
    if (!b) return;
    S.gap = b.dataset.gap;
    S.filter = 'all';
    paintSheet();
  });
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; paintSheet(); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $('#q').value = ''; S.q = ''; paintSheet();
  });

  try {
    S.all = localStorage.getItem('vpl.vr.columns') === '1';
    $('#btn-columns').setAttribute('aria-pressed', S.all ? 'true' : 'false');
  } catch {}

  $('#btn-columns').onclick = () => {
    S.all = !S.all;
    $('#btn-columns').setAttribute('aria-pressed', S.all ? 'true' : 'false');
    try { localStorage.setItem('vpl.vr.columns', S.all ? '1' : '0'); } catch {}
    paintSheet();
  };
  $('#btn-copy').onclick = copyDoc;

  /* Print is the document, so the brief opens for the paper and closes again
   * for the screen; the strip under the title carries what a page needs. */
  let wasOpen = false;
  window.addEventListener('beforeprint', () => {
    wasOpen = $('#brief').open;
    $('#brief').open = true;
    const when = new Date().toLocaleDateString();
    const must = S.reqs.filter((r) => r.strength === 'must').length;
    $('#print-meta').textContent = `${when} · ${S.reqs.length} rows · ${must} must · vr.terg.hr`;
  });
  window.addEventListener('afterprint', () => {
    if (!wasOpen) $('#brief').open = false;
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
