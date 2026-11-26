/* vpl · va — architecture. The pile in, the picture out.
 *
 * The screen is a desk: the pile you were given on the left, the answer you
 * will keep on the right. The model is behind one button, and what it writes
 * lands in a textarea, not in the database's idea of truth — the person edits
 * it, and what is written is theirs.
 *
 * The machine is vendor/engine.js, copied from the suite's shell. This file
 * owns only the desk: which template, which inputs, which output is open.
 */

import * as db from './lib/db.js';
import * as ai from './vendor/ai.js';
import * as who from './vendor/who.js';
import { mountDock, lastField, putInto } from './vendor/dock.js';
import { mountNotice } from './vendor/notices.js';
import * as engine from './vendor/engine.js';
import * as settings from './vendor/settings.js';
import { TEMPLATES, DEFAULT_TEMPLATE, templateById } from './templates.js';
import { parseDocument, setXY, VIEWS } from './lib/boxes.js';
import { draw } from './lib/draw.js';
import { plainAuthError, guestLine } from './vendor/words.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  session: null,
  projects: [],
  project: null,
  artifacts: [],
  bin: [],             // inputs in the recycle bin
  binMode: false,
  jobBin: false,
  jobsBinned: 0,
  outputs: [],
  jobs: [],
  role: null,          // owner | edit | view | null
  guest: null,         // null | 'share'
  current: null,       // the output on the desk
  drawing: false,      // the answer read as shapes instead of words
  view: 'all',         // a filter over one box list, not a schema
  artDraft: null,      // the input open in the dialog
  notes: '',
  busy: false,
  lastMs: 0,
};

/* ── window dressing ──────────────────────────────────────────────── */
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 2400);
}

function msg(el, text, state = '') {
  const node = typeof el === 'string' ? $(el) : el;
  if (!node) return;
  node.textContent = text;
  if (state) node.dataset.state = state; else delete node.dataset.state;
}

function applyTheme() {
  const now = document.documentElement.dataset.theme;
  const next = now === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('vpl.theme', next); } catch { /* private mode */ }
}

function debounce(fn, ms = 750) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* Names and addresses ignore case; passwords never do. A bare name is an
 * account at @vpl.local, exactly as in vn, vi, vr and vz. */
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

/* ── boot ─────────────────────────────────────────────────────────── */
async function boot() {
  $('#gate-theme').onclick = () => settings.cycleTheme();
  lowerField($('#email'));
  wireGate();
  wireApp();
  wireAuth();

  const params = new URLSearchParams(location.search);
  const code = params.get('s');
  if (code) return openGuest(code);

  S.session = await db.session().catch(() => null);
  if (!S.session) { showGate(); return; }
  await enterApp();
}

/* ── who is signed in, and whether it is still who was here ─────────
 * One person per tab is not something a browser promises: a second tab can
 * sign in as somebody else, and the session in storage is shared. So this tab
 * asks again whenever it comes back into view, and reloads when the answer is
 * not the person whose rows are on screen. Reloading is the honest fix: the
 * alternative is sniffing which row belongs to whom, and getting it wrong. */
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

function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  $('#email').focus();
}

function wireGate() {
  $('#gate-form').onsubmit = async (e) => {
    e.preventDefault();
    msg('#gate-msg', 'signing in…', 'busy');
    try {
      await db.signIn(toAuthEmail($('#email').value), $('#pass').value);
      $('#gate-msg').textContent = '';
      S.session = await db.session();
      await enterApp();
    } catch (err) {
      msg('#gate-msg', plainAuthError(err), 'bad');
    }
  };
  $('#btn-register').onclick = async () => {
    const email = toAuthEmail($('#email').value);
    const pass = $('#pass').value;
    if (!email || pass.length < 6) {
      return msg('#gate-msg', 'a name or an address, and a password of six characters or more', 'bad');
    }
    try {
      await db.signUp(email, pass);
      S.session = await db.session();
      await enterApp();
    } catch (err) {
      msg('#gate-msg', plainAuthError(err), 'bad');
    }
  };
  $('#btn-google').onclick = async () => {
    try { await db.signInWithGoogle(); } catch (err) { msg('#gate-msg', err.message, 'bad'); }
  };
}

async function enterApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = displayName(S.session);
  who.chip($('#who'));
  $('#who').title = S.session?.user?.email || '';
  wireAi();
  await loadProjects();
  const bring = localStorage.getItem('va.copy');
  if (bring) {
    localStorage.removeItem('va.copy');
    await copyFromCode(bring);
    return;
  }
  const last = localStorage.getItem('va.last');
  const open = S.projects.find((p) => p.id === last) || S.projects[0];
  if (open) await openJob(open.id);
  else renderWelcome();
}

/* ── the rail ─────────────────────────────────────────────────────── */
async function loadProjects() {
  S.projects = await db.listProjects({ bin: S.jobBin });
  /* the count on the switch is how a person knows there is a way back, so it is
   * read whether the bin is open or not — one small query, and only when shut */
  S.jobsBinned = S.jobBin
    ? S.projects.length
    : await db.listProjects({ bin: true }).then((r) => r.length).catch(() => S.jobsBinned || 0);
  renderRail();
  paintJobBin();
}

function renderRail() {
  const list = $('#proj-list');
  list.innerHTML = '';
  for (const p of S.projects) {
    const li = document.createElement('li');
    li.className = 'proj-row' + (p.id === S.project?.id ? ' on' : '') + (S.jobBin ? ' bin-row' : '');
    li.dataset.id = p.id;
    const tpl = templateById(p.template);
    const mine = p.user_id === S.session?.user?.id;
    /* in the bin a row has two doors and no pick: put it back, or end it */
    li.innerHTML = S.jobBin
      ? `<span class="pick bin-row-name">${esc(p.title || 'untitled job')}</span>`
        + `<span class="tpl" title="${esc(tpl.label)}">${esc(tpl.id)}</span>`
        + '<span class="tools">'
        + '<button class="row-restore" type="button" data-back title="put it back">restore</button>'
        + '<button class="kill" type="button" data-purge title="delete it for good">✕</button>'
        + '</span>'
      : `<button class="pick" type="button">${esc(p.title || 'untitled job')}</button>`
        + `<span class="tpl" title="${esc(tpl.label)}">${esc(tpl.id)}</span>`
        + (mine ? '<button class="kill" type="button" title="move the job to the recycle bin">✕</button>' : '');
    list.append(li);
  }
  $('#proj-none').hidden = S.projects.length > 0;
  $('#proj-none').textContent = S.jobBin ? 'nothing in the bin.' : 'no jobs yet. one job is one picture you have to draw in words.';
}

$('#proj-list').addEventListener('click', async (e) => {
  const kill = e.target.closest('.kill');
  const back = e.target.closest('[data-back]');
  const purge = e.target.closest('[data-purge]');
  const row = e.target.closest('.proj-row');
  if (!row) return;
  const id = row.dataset.id;
  if (back) {
    const p = S.projects.find((x) => x.id === id);
    await db.restoreProject(id);
    /* restoring leaves the bin and opens what was restored: a job that comes
     * back into a list you are not looking at is a job that came back silently */
    S.jobBin = false;
    await loadProjects();
    await openJob(id).catch(() => {});
    toast('“' + (p?.title || 'the job') + '” is back');
    return;
  }
  if (purge) {
    const p = S.projects.find((x) => x.id === id);
    if (!confirm(`delete “${p?.title || 'this job'}” for good?`)) return;
    await db.deleteProject(id);
    await loadProjects();
    return;
  }
  if (kill) {
    const p = S.projects.find((x) => x.id === id);
    /* ✕ bins. A job holds a whole document, so it keeps its words and the
     * rail's bin is the way back; nothing is destroyed from the live list. */
    await db.binProject(id);
    if (S.project?.id === id) S.project = null;
    await loadProjects();
    if (S.projects[0]) await openJob(S.projects[0].id);
    else renderWelcome();
    toast('“' + (p?.title || 'the job') + '” is in the recycle bin');
    return;
  }
  await openJob(id);
});

/* The bin in the rail: a switch, a count, a sentence, and an emptying that asks
 * with a number in it. */
function paintJobBin() {
  const btn = $('#btn-job-bin');
  if (!btn) return;
  const n = S.jobsBinned || 0;
  btn.setAttribute('aria-pressed', String(S.jobBin));
  btn.classList.toggle('on', S.jobBin);
  btn.title = S.jobBin ? 'back to the jobs' : 'the recycle bin of jobs (' + n + ')';
  $('#job-bin-count').textContent = n ? String(n) : '';
  $('#job-bin-banner').hidden = !S.jobBin;
  $('#job-bin-note').textContent = S.jobBin
    ? (n ? `${n} job${n === 1 ? '' : 's'} binned — restore one, or delete it for good`
         : 'nothing in it — a deleted job waits here')
    : '';
  $('#proj-list').classList.toggle('bin-mode', S.jobBin);
}

$('#btn-job-bin').onclick = async () => {
  S.jobBin = !S.jobBin;
  await loadProjects();
};

$('#btn-new').onclick = async () => {
  const p = await db.createProject('untitled job', DEFAULT_TEMPLATE);
  await loadProjects();
  await openJob(p.id);
  $('#proj-title').focus();
  $('#proj-title').select();
  document.body.dataset.rail = '';
};

$('#btn-first').onclick = () => $('#btn-new').click();

$('#btn-projects').onclick = () => {
  document.body.dataset.rail = document.body.dataset.rail === 'open' ? '' : 'open';
};

/* ── a job on the desk ────────────────────────────────────────────── */
function renderWelcome() {
  $('#spec').hidden = true;
  $('#welcome').hidden = false;
}

let _loadSeq = 0;

async function openJob(id) {
  const seq = ++_loadSeq;
  S.project = S.projects.find((p) => p.id === id) || null;
  if (!S.project) return renderWelcome();
  localStorage.setItem('va.last', id);
  S.artifacts = await db.listArtifacts(id);
  S.bin = await db.listArtifacts(id, { bin: true }).catch(() => []);
  S.outputs = await db.listOutputs(id);
  S.jobs = await db.listJobs(id).catch(() => []);
  S.role = await db.roleOn(S.project);
  if (seq !== _loadSeq) return;             // only the last answer counts
  S.current = S.outputs[0]?.id || null;
  document.body.dataset.role = S.role || 'view';
  document.body.dataset.guest = '';
  $('#welcome').hidden = true;
  $('#spec').hidden = false;
  $('#btn-own').hidden = S.role === 'owner' || !S.role;
  $('#guest-banner').hidden = true;
  renderRail();
  paintSpec();
  paintJobs();
}

function paintSpec() {
  const p = S.project;
  if (!p) return renderWelcome();
  /* never write into a field the person is typing in: a late repaint must not
   * eat the words between two keystrokes */
  const title = $('#proj-title');
  if (document.activeElement !== title && title.value !== p.title) title.value = p.title;
  title.readOnly = S.role !== 'owner';
  const brief = $('#brief');
  if (document.activeElement !== brief && brief.value !== (p.brief || '')) brief.value = p.brief || '';
  growBrief(brief);

  const sel = $('#template');
  if (!sel.options.length || sel.dataset.for !== 'x') {
    sel.innerHTML = TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
    sel.dataset.for = 'x';
  }
  sel.value = p.template || DEFAULT_TEMPLATE;
  const tpl = templateById(p.template);
  $('#template-about').textContent = `— ${tpl.about}. expects: ${tpl.needs}.`;

  const words = S.artifacts.reduce((n, a) => n + engine.countWords(a.text), 0);
  $('#proj-meta').textContent = [
    `${S.artifacts.length} input${S.artifacts.length === 1 ? '' : 's'}`,
    words ? `${words.toLocaleString()} words to read` : 'nothing to read yet',
    engine.hasKey() ? engine.modelName() : 'no model key yet',
  ].join(' · ');

  renderArtifacts();
  paintOutput();
  $('#btn-first-generate').hidden = S.role === 'view';
}

function growBrief(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(24, el.scrollHeight) + 'px';
}

/* title and brief save themselves; a job with no name is a job you lose */
const saveProject = debounce(async () => {
  if (!S.project || S.role !== 'owner') return;
  const title = $('#proj-title').value.trim() || 'untitled job';
  const brief = $('#brief').value;
  try {
    S.project = await db.updateProject(S.project.id, { title, brief });
    const row = S.projects.find((p) => p.id === S.project.id);
    if (row) Object.assign(row, S.project);
    renderRail();
  } catch (err) { toast(err.message); }
});

$('#proj-title').addEventListener('input', saveProject);
$('#brief').addEventListener('input', () => { growBrief($('#brief')); saveProject(); });

$('#template').addEventListener('change', async () => {
  if (S.role !== 'owner' || !S.project) return;
  try {
    S.project = await db.updateProject(S.project.id, { template: $('#template').value });
    const row = S.projects.find((p) => p.id === S.project.id);
    if (row) Object.assign(row, S.project);
    renderRail();
    paintSpec();
    toast('the next answer follows the new template');
  } catch (err) { msg('#gen-msg', err.message, 'bad'); }
});

/* ── the pile of inputs ───────────────────────────────────────────── */
function renderArtifacts() {
  const list = $('#artifacts');
  list.innerHTML = '';
  list.classList.toggle('bin-mode', S.binMode);
  if (S.binMode) {
    for (const a of S.bin) list.insertAdjacentHTML('beforeend', binRowHTML(a));
    $('#art-none').hidden = S.bin.length > 0;
    $('#art-none').textContent = S.bin.length ? '' : 'the recycle bin is empty — a removed input waits here';
    $('#art-count').textContent = S.bin.length ? String(S.bin.length) : '';
    paintBin();
    return;
  }
  for (const a of S.artifacts) {
    const li = document.createElement('li');
    li.className = 'art';
    li.dataset.id = a.id;
    const n = engine.countWords(a.text);
    const line = a.file_name
      ? `${a.file_name} · ${fmtSize(a.file_size)}`
      : n ? `${n.toLocaleString()} words` : 'no text';
    li.innerHTML = `<span class="kind">${esc(a.kind)}</span>`
      + `<span class="what"><button class="name" type="button">${esc(a.title || 'untitled input')}</button>`
      + `<span class="line">${esc(line)}</span></span>`
      + `<span class="tools w-only">`
      + (a.file_path ? '<button class="dl" type="button" title="download the original">↓</button>' : '')
      + '<button class="del" type="button" title="remove from this job">✕</button></span>';
    list.append(li);
  }
  $('#art-none').hidden = S.artifacts.length > 0;
  $('#art-none').textContent = 'nothing to read yet. paste a text or bring a file.';
  $('#art-count').textContent = S.artifacts.length ? `${S.artifacts.length}` : '';
  paintBin();
}

/* ── the recycle bin ───────────────────────────────────────────────
 * Four signals, none of them colour alone: the banner names the place and
 * counts it, each list is tinted with a mark strip, the button under the lists
 * is filled, and every row says *restore* instead of the usual tools. */
function paintBin() {
  const n = S.bin.length;
  const btn = $('#btn-bin');
  btn.setAttribute('aria-pressed', String(S.binMode));
  btn.title = S.binMode ? 'close the recycle bin and go back to the inputs'
    : n ? `open the recycle bin (${n})` : 'the recycle bin is empty';
  $('.bin-label', btn).textContent = S.binMode ? 'back to the inputs' : 'recycle bin';
  $('#bin-count').textContent = n ? String(n) : '';
  $('#bin-banner').hidden = !S.binMode;
  $('#bin-banner-note').textContent = n
    ? `${n} input${n === 1 ? '' : 's'} in the bin — restore one, or delete it for good`
    : 'nothing in it — a removed input waits here';
  $('#btn-bin-empty').hidden = !S.binMode || !n;
}

function binRowHTML(a) {
  const n = engine.countWords(a.text);
  const line = a.file_name
    ? `${a.file_name} · ${fmtSize(a.file_size)}`
    : n ? `${n.toLocaleString()} words` : 'no text';
  return `<li class="art in-bin" data-id="${a.id}">
      <span class="kind">${esc(a.kind)}</span>
      <span class="what"><span class="name">${esc(a.title || 'untitled input')}</span>
        <span class="line">${esc(line)}</span></span>
      <span class="tools">
        <button class="row-restore" type="button" data-back title="put it back">restore</button>
        <button class="del" type="button" data-purge title="delete it for good">✕</button>
      </span>
    </li>`;
}


/* Opening the bin from halfway down a long list showed a tinted list and
 * nothing else: the banner that names the place was above the fold. The place
 * announces itself when you enter it. */
function scrollBinIntoView() {
  requestAnimationFrame(() => {
    const b = document.querySelector('.bin-banner');
    if (b) b.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

async function toggleBin() {
  if (!S.project) return;
  S.binMode = !S.binMode;
  if (S.binMode) {
    try { S.bin = await db.listArtifacts(S.project.id, { bin: true }); } catch { S.bin = []; }
  }
  renderArtifacts();
  paintBin();
  if (S.binMode) scrollBinIntoView();
}

async function restoreInput(a) {
  try {
    await db.restoreArtifact(a.id);
    S.bin = S.bin.filter((x) => x.id !== a.id);
    S.artifacts = [...S.artifacts, { ...a, deleted_at: null }];
    renderArtifacts();
    paintSpec();
    toast('“' + (a.title || 'the input') + '” is back');
  } catch (err) { toast('could not restore it: ' + err.message); }
}

async function purgeInput(a) {
  try {
    await db.deleteArtifact(a.id);
    S.bin = S.bin.filter((x) => x.id !== a.id);
    renderArtifacts();
  } catch (err) { toast('could not delete it: ' + err.message); }
}

async function emptyBin() {
  if (!S.bin.length) return;
  const n = S.bin.length;
  try {
    await db.emptyBin(S.project.id);
    S.bin = [];
    renderArtifacts();
    toast(`${n} input${n === 1 ? '' : 's'} deleted for good`);
  } catch (err) { toast(err.message); }
}

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

$('#artifacts').addEventListener('click', async (e) => {
  const li = e.target.closest('.art');
  if (!li) return;
  const a = S.binMode
    ? S.bin.find((x) => x.id === li.dataset.id)
    : S.artifacts.find((x) => x.id === li.dataset.id);
  if (!a) return;

  if (e.target.closest('[data-back]')) return restoreInput(a);
  if (e.target.closest('[data-purge]')) return purgeInput(a);

  if (e.target.closest('.del')) {
    /* ✕ removes it from the job, not from the world: the words go to the bin */
    await db.binArtifact(a.id);
    S.artifacts = S.artifacts.filter((x) => x.id !== a.id);
    S.bin = [{ ...a, deleted_at: new Date().toISOString() }, ...S.bin];
    renderArtifacts();
    paintSpec();
    toast('“' + (a.title || 'the input') + '” is in the recycle bin');
    return;
  }
  if (e.target.closest('.dl')) {
    try {
      const url = await db.fileUrl(a.file_path);
      window.open(url, '_blank', 'noopener');
    } catch (err) { toast(err.message); }
    return;
  }
  openArtifact(a);
});

function openArtifact(a) {
  S.artDraft = a ? { ...a } : { kind: 'text', title: '', text: '' };
  $('#art-head').textContent = a ? 'input' : 'a new input';
  $('#art-title').value = S.artDraft.title || '';
  $('#art-text').value = S.artDraft.text || '';
  const cold = S.role === 'view';
  $('#art-title').readOnly = cold;
  $('#art-text').readOnly = cold;
  $('#art-del').hidden = !a;
  const f = $('#art-file');
  f.hidden = !a?.file_name;
  if (a?.file_name) f.textContent = `original: ${a.file_name} · ${fmtSize(a.file_size)}`;
  msg('#art-dlg-msg', '');
  $('#art-dialog').showModal();
  setTimeout(() => (a ? $('#art-text') : $('#art-title')).focus(), 60);
}

$('#btn-bin').onclick = toggleBin;
$('#btn-bin-empty').onclick = emptyBin;

$('#btn-add-text').onclick = () => openArtifact(null);
$('#art-x').onclick = () => $('#art-dialog').close();
$('#art-x2').onclick = () => $('#art-dialog').close();

$('#art-save').onclick = async () => {
  const d = S.artDraft;
  if (!d || !S.project) return;
  const title = $('#art-title').value.trim() || 'untitled input';
  const text = $('#art-text').value;
  msg('#art-dlg-msg', 'saving…', 'busy');
  try {
    if (d.id) {
      const row = await db.updateArtifact(d.id, { title, text });
      const i = S.artifacts.findIndex((x) => x.id === d.id);
      if (i >= 0) S.artifacts[i] = row;
    } else {
      const row = await db.addArtifact(S.project.id, {
        kind: d.kind || 'text', title, text,
        file_path: d.file_path, file_name: d.file_name,
        file_size: d.file_size, file_mime: d.file_mime,
      });
      S.artifacts.push(row);
    }
    $('#art-dialog').close();
    renderArtifacts();
    paintSpec();
  } catch (err) { msg('#art-dlg-msg', err.message, 'bad'); }
};

$('#art-del').onclick = async () => {
  const d = S.artDraft;
  if (!d?.id) return;
  try {
    await db.binArtifact(d.id);
    const gone = S.artifacts.find((x) => x.id === d.id);
    if (gone) S.bin = [{ ...gone, deleted_at: new Date().toISOString() }, ...S.bin];
    S.artifacts = S.artifacts.filter((x) => x.id !== d.id);
    $('#art-dialog').close();
    renderArtifacts();
    paintSpec();
  } catch (err) { msg('#art-dlg-msg', err.message, 'bad'); }
};

/* ── files: a pdf becomes text, the original stays in the bucket ──── */
$('#btn-add-file').onclick = () => $('#file-input').click();

$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !S.project) return;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    msg('#art-msg', `reading ${file.name} (${i + 1}/${files.length})…`, 'busy');
    let stored = null;
    try {
      stored = await db.uploadFile(S.project.id, file);
    } catch (err) {
      msg('#art-msg', `${file.name}: ${err.message}`, 'bad');
      continue;
    }
    const got = await engine.extract(file, (page, pages) => {
      msg('#art-msg', `${file.name} — page ${page} of ${pages}`, 'busy');
    });
    try {
      const row = await db.addArtifact(S.project.id, {
        kind: got.kind,
        title: file.name,
        text: got.text,
        file_path: stored.path, file_name: stored.name,
        file_size: stored.size, file_mime: stored.mime,
      });
      S.artifacts.push(row);
    } catch (err) {
      msg('#art-msg', `${file.name}: ${err.message}`, 'bad');
    }
  }
  renderArtifacts();
  paintSpec();
  msg('#art-msg', `${files.length} added`, 'ok');
  toast('read it, then generate');
});

/* ── the output on the desk ───────────────────────────────────────── */
function currentOutput() {
  return S.outputs.find((o) => o.id === S.current) || S.outputs[0] || null;
}

function paintOutput() {
  const o = currentOutput();
  const body = $('#out-body');
  const none = $('#out-none');
  const versions = $('#out-versions');

  if (!o) {
    none.hidden = false;
    body.hidden = true;
    versions.hidden = true;
    $('#out-meta').textContent = '';
    body.value = '';
    S.drawing = false;
    paintDrawing();
    return;
  }
  none.hidden = true;
  body.hidden = !!S.drawing;            // read as words, or read as shapes
  if (body.value !== o.body) body.value = o.body;
  body.readOnly = S.role === 'view';

  versions.hidden = S.outputs.length < 2;
  /* an answer is a paper, and a paper has a name: two reports from two evenings
   * should not be told apart by a word count alone */
  versions.innerHTML = S.outputs.map((x, i) => {
    const label = x.title || (i === 0 ? 'just now' : engine.when(x.created_at));
    return `<option value="${x.id}">${esc(label)} · ${engine.countWords(x.body)} words</option>`;
  }).join('');
  versions.value = o.id;
  $('#out-meta').textContent = `${engine.countWords(o.body).toLocaleString()} words · ${engine.when(o.created_at)}`;
  paintDrawing();
}

$('#out-versions').addEventListener('change', () => {
  S.current = $('#out-versions').value;
  paintOutput();
});

/* Autosave the document. Silent by design: the person writes, the row follows
 * 750 ms later, and nothing jumps. */
const saveOutput = debounce(async () => {
  const o = currentOutput();
  if (!o || S.role === 'view') return;
  const body = $('#out-body').value;
  if (body === o.body) return;
  try {
    const row = await db.updateOutput(o.id, { body });
    o.body = row.body;
    o.updated_at = row.updated_at;
    $('#out-meta').textContent = `${engine.countWords(o.body).toLocaleString()} words · ${engine.when(o.updated_at)}`;
  } catch (err) { toast('could not save: ' + err.message); }
});

$('#out-body').addEventListener('input', saveOutput);

/* ── the drawing: the same answer, read as shapes ───────────────────
 * The text is the truth. This parses the answer's fenced box list, draws it,
 * and the only thing it may write back is where a box sits — because a drag is
 * a way of editing `x` and `y`, and those are lines in the yaml like any other.
 * Nothing here decides what the architecture is; it shows what somebody wrote. */
function listOfAnswer() {
  const o = currentOutput();
  return o ? parseDocument(o.body) : { boxes: [], arrows: [], problems: [], blocks: 0 };
}

function paintDrawing() {
  const o = currentOutput();
  const wrap = $('#draw');
  const btn = $('#btn-draw');
  const list = listOfAnswer();
  const has = list.boxes.length > 0;

  btn.hidden = !has;
  if (!has) { S.drawing = false; }
  if (!has || !S.drawing) { wrap.hidden = true; btn.classList.remove('on'); return; }

  wrap.hidden = false;
  btn.classList.add('on');
  btn.textContent = 'text';
  for (const b of document.querySelectorAll('#draw-views .view')) b.classList.toggle('on', b.dataset.view === S.view);

  const counted = draw($('#draw-svg'), list, {
    view: S.view,
    onMove: (id, x, y) => moveBox(id, x, y),
  });

  $('#draw-count').textContent = `${counted.boxes} boxes · ${counted.arrows} arrows`
    + (S.view === 'all' ? '' : ` · ${S.view}`);

  const strip = $('#draw-strip');
  const problems = list.problems;
  strip.hidden = !problems.length;
  if (problems.length) {
    strip.textContent = problems.length === 1
      ? '1 thing to fix: ' + problems[0]
      : `${problems.length} things to fix: ` + problems.slice(0, 3).join(' · ')
        + (problems.length > 3 ? ' · …' : '');
  }
  if (!o) strip.hidden = true;
}

/* a drag writes two lines and saves like typing does */
function moveBox(id, x, y) {
  const o = currentOutput();
  if (!o || S.role === 'view') return;
  const next = setXY($('#out-body').value, id, x, y);
  if (next === $('#out-body').value) return;
  $('#out-body').value = next;
  saveOutput();
  paintDrawing();
}

$('#btn-draw').onclick = () => {
  S.drawing = !S.drawing;
  $('#btn-draw').textContent = S.drawing ? 'text' : 'drawing';
  paintOutput();
};

$('#draw-views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  S.view = b.dataset.view;
  paintDrawing();
});

$('#btn-copy').onclick = async () => {
  const o = currentOutput();
  const text = o ? o.body : '';
  if (!text) return toast('nothing to copy yet');
  try {
    await navigator.clipboard.writeText(text);
    toast('the answer is on the clipboard');
  } catch { toast('the browser refused the clipboard'); }
};

$('#btn-print').onclick = () => {
  const o = currentOutput();
  if (!o) return toast('nothing to print yet');
  fillPrintDoc();
  window.print();
};

/* Ctrl+P is the other way to print, and it used to print a blank page: the
 * `.print-doc` sheet is what the print CSS shows, and it was only ever filled by
 * the button. The work is the same either way — the whole document, once. */
function fillPrintDoc() {
  const o = currentOutput();
  $('#print-doc').textContent = `${S.project?.title || ''}\n\n${o?.body || ''}`;
}
window.addEventListener('beforeprint', fillPrintDoc);


/* ── the hand-off ─────────────────────────────────────────────────── */
/* The desk never commands a shell. It writes a folder — task.md plus the pile
 * as text — and a row that says "queued". An agent that already has an account
 * and a shell polls the row, works in the folder, and writes its answer back.
 * Nothing here can execute anything, which is the only reason it is safe to
 * leave a page like this on the open internet. */

const JOB_WORDS = { queued: 'waiting', running: 'working', done: 'answered', failed: 'gave up' };

function jobWhen(j) {
  return engine.when(j.done_at || j.started_at || j.created_at);
}

function slugName(s, i) {
  const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40) || 'input';
  return String(i + 1).padStart(2, '0') + '-' + base + '.md';
}

/* The task the agent reads: our template id in the front matter, then the brief,
 * the note, and a list of what is in inputs/ — no paths it did not get. */
function taskFor(job, refs) {
  const p = S.project;
  const lines = [
    '---',
    'template: ' + job.template,
    'title: ' + (p?.title || 'untitled job'),
    '---',
    '',
    '## What is asked',
    (p?.brief || '').trim() || '[no brief — say so in the report rather than inventing one]',
    '',
  ];
  if (job.note.trim()) lines.push('## How it should be done', job.note.trim(), '');
  lines.push('## On the pile', ...refs.map((r) => '- inputs/' + r), '');
  return lines.join('\n');
}

async function handOver() {
  const p = S.project;
  if (!p || S.role === 'view') return;
  const texts = S.artifacts.filter((a) => (a.text || '').trim());
  if (!texts.length) return toast('the pile is empty — paste the brief first');
  const btn = $('#btn-hand');
  btn.disabled = true;
  msg('#hand-msg', 'writing the job…', 'busy');
  try {
    const job = await db.addJob(p.id, {
      template: $('#template').value,
      note: $('#notes').value.trim(),
      task: (p.brief || '').trim(),
    });
    const dir = p.id + '/jobs/' + job.id;
    const refs = texts.map((a, i) => ({ a, name: slugName(a.title, i) }));
    for (const r of refs) {
      await db.jobPut(dir + '/inputs/' + r.name,
        '# ' + (r.a.title || 'input') + '\n\n' + r.a.text);
    }
    const files = S.artifacts.filter((a) => a.file_path);
    await db.jobPut(dir + '/task.md', taskFor({ ...job, note: $('#notes').value.trim() }, refs.map((r) => r.name))
      + (files.length ? '\n## Files that did not travel\n'
        + files.map((f) => '- ' + f.file_name + ' (in the desk, not in this folder)').join('\n') + '\n' : ''));
    const saved = await db.updateJob(job.id, { path: dir });
    S.jobs.unshift(saved);
    paintJobs();
    msg('#hand-msg', 'handed over — an agent picks it up when it is running', 'good');
    startPolling();
  } catch (err) {
    msg('#hand-msg', 'could not hand it over: ' + err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

$('#btn-hand').onclick = handOver;

function paintJobs() {
  const list = $('#jobs');
  const mine = S.jobs || [];
  list.innerHTML = '';
  $('#handoff').hidden = S.role === 'view' || !S.project;
  if (!mine.length) return;
  for (const j of mine) {
    const li = document.createElement('li');
    li.className = 'job ' + j.status;
    const files = Array.isArray(j.files) ? j.files : [];
    li.innerHTML = `<div class="job-line">
        <span class="job-what">${esc(templateById(j.template)?.label || j.template)}</span>
        <span class="job-state"><i class="mark"></i>${esc(JOB_WORDS[j.status] || j.status)}</span>
        <span class="job-when muted">${esc(jobWhen(j))}</span>
      </div>`
      + (j.error ? `<p class="job-err">${esc(j.error)}</p>` : '')
      + (j.status === 'done'
        ? `<div class="job-acts">
             <button class="ghost" type="button" data-act="keep">keep what came back</button>
             <button class="link" type="button" data-act="drop">drop</button>
           </div>`
        : (j.status === 'failed'
          ? `<div class="job-acts"><button class="link" type="button" data-act="drop">drop</button></div>`
          : '<p class="job-wait muted">the desk checks again by itself</p>'));
    if (j.status === 'done' && files.length) {
      li.insertAdjacentHTML('beforeend', '<ul class="job-files">'
        + files.map((f) => `<li><span>${esc(f.name)}</span>`
          + (/\.ya?ml$/i.test(f.name) ? '<em class="job-draw">a list the desk can draw</em>' : '')
          + '</li>').join('') + '</ul>');
    }
    li.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => (b.dataset.act === 'keep' ? keepJob(j) : dropJob(j));
    });
    list.append(li);
  }
}

/* The reverse pull, in its smallest form. An agent that read a real environment
 * comes back with a list of boxes; a list of boxes is a drawing. So keeping the
 * job keeps the report *and*, if one of the files is a list, the list as an
 * answer of its own — the canvas reads answers, so nothing new is stored and no
 * second kind of truth appears. If the file cannot be read, the report is still
 * kept: one unreadable file is not a reason to lose the answer. */
async function listFromJob(j) {
  const files = (Array.isArray(j.files) ? j.files : []);
  for (const f of files) {
    if (!/\.ya?ml$/i.test(f.name)) continue;
    try {
      const text = await db.jobText(j.path + '/out/files/' + f.name);
      if (parseDocument(text).boxes.length) return { name: f.name, text };
    } catch { /* fall through to the next file */ }
  }
  return null;
}

async function keepJob(j) {
  const title = (templateById(j.template)?.label || j.template) + ' — ' + jobWhen(j);
  try {
    const body = (j.report || '').trim() || '[the agent said nothing]';
    const out = await db.addOutput(S.project.id, { kind: 'report', title, body });
    S.outputs.unshift(out);

    /* a list came back? then the person gets the picture with the paper */
    const pulled = await listFromJob(j);
    let drawn = null;
    if (pulled) {
      drawn = await db.addOutput(S.project.id, {
        kind: 'code', title: pulled.name + ' — ' + jobWhen(j), body: pulled.text,
      });
      S.outputs.unshift(drawn);
    }

    S.current = drawn ? drawn.id : out.id;
    paintOutput();
    if (drawn) { S.drawing = true; S.view = 'all'; paintOutput(); }

    const files = (Array.isArray(j.files) ? j.files : []);
    for (const [i, f] of files.entries()) {
      const a = await db.addArtifact(S.project.id, {
        kind: 'file', title: f.name, text: '', file_path: j.path + '/out/files/' + f.name,
        file_name: f.name, file_size: f.size || 0, file_mime: '', pos: 90 + i,
      });
      S.artifacts.push(a);
    }
    await db.updateJob(j.id, { status: 'done' });
    renderArtifacts();
    paintSpec();
    if (drawn) toast('kept — the report, the file on the pile, and a drawing of the list');
    else toast(files.length ? 'kept, with ' + files.length + ' file(s) on the pile' : 'kept as a new answer');
  } catch (err) { toast('could not keep it: ' + err.message); }
}

async function dropJob(j) {
  try {
    await db.deleteJob(j.id);
    S.jobs = S.jobs.filter((x) => x.id !== j.id);
    paintJobs();
  } catch (err) { toast('could not drop it: ' + err.message); }
}

/* A job in flight is the only reason to ask again. Nothing polls a settled list. */
function startPolling() {
  clearInterval(startPolling._t);
  const flight = (S.jobs || []).some((j) => j.status === 'queued' || j.status === 'running');
  if (!flight || !S.project) return;
  startPolling._t = setInterval(async () => {
    if (!S.project) return clearInterval(startPolling._t);
    try {
      const fresh = await db.listJobs(S.project.id);
      const changed = JSON.stringify(fresh) !== JSON.stringify(S.jobs);
      S.jobs = fresh;
      if (changed) paintJobs();
      if (!fresh.some((j) => j.status === 'queued' || j.status === 'running')) {
        clearInterval(startPolling._t);
      }
    } catch { /* the desk is not the thing that broke */ }
  }, 6000);
}

/* ── generate ─────────────────────────────────────────────────────── */
$('#gen').onsubmit = (e) => { e.preventDefault(); generate(); };
$('#btn-first-generate').onclick = () => generate();
$('#notes').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); }
});

function paintBusy(on, t0 = 0) {
  S.busy = on;
  $('#btn-generate').disabled = on;
  $('#btn-generate').textContent = on ? 'thinking…' : 'generate';
  clearInterval(paintBusy._t);
  if (!on) return;
  const tick = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    msg('#gen-msg', `thinking — ${s}s. a long tender takes a minute.`, 'busy');
  };
  tick();
  paintBusy._t = setInterval(tick, 1000);
}

async function generate() {
  if (S.busy || !S.project) return;
  if (S.role === 'view') return;
  const tpl = templateById(S.project.template);
  if (!S.artifacts.length) {
    msg('#gen-msg', 'nothing to read yet — add an input first', 'bad');
    return;
  }
  if (!engine.hasKey()) {
    msg('#gen-msg', 'no model key yet — paste one in the settings', 'bad');
    openAi();
    return;
  }

  const notes = $('#notes').value.trim();
  const messages = engine.buildMessages({
    template: tpl, project: S.project, artifacts: S.artifacts, notes,
  });
  const promptNote = [
    `template: ${tpl.id}`,
    `inputs: ${S.artifacts.map((a) => a.title || a.kind).join(' · ')}`,
    notes ? `notes: ${notes}` : '',
  ].filter(Boolean).join('\n').slice(0, 8000);

  const t0 = Date.now();
  paintBusy(true, t0);
  let run = null;
  try {
    run = await db.startRun(S.project.id, {
      template: tpl.id, model: engine.modelName(), notes, prompt: promptNote,
    });
    const answer = await engine.callModel(messages);
    if (!answer || !answer.trim()) throw new Error('the model answered with nothing');
    await db.finishRun(run.id, { status: 'done', took_ms: Date.now() - t0 });
    const out = await db.addOutput(S.project.id, {
      run_id: run.id, kind: tpl.kind, title: tpl.out, body: answer,
    });
    S.outputs.unshift(out);
    S.current = out.id;
    S.notes = '';
    $('#notes').value = '';
    paintOutput();
    msg('#gen-msg', `written in ${Math.round((Date.now() - t0) / 1000)} s — read it, then change what is not true`, 'ok');
  } catch (err) {
    if (run) {
      await db.finishRun(run.id, {
        status: 'failed', error: String(err.message || err).slice(0, 300),
        took_ms: Date.now() - t0,
      }).catch(() => {});
    }
    if (err.code === engine.NO_KEY) openAi();
    msg('#gen-msg', String(err.message || 'the model did not answer').slice(0, 220), 'bad');
  } finally {
    paintBusy(false);
  }
}

/* ── settings: one component, the same dialog in every app ──────────
 * The list of providers, the tabs, the test call and the theme all live in
 * vendor/settings.js. This file only says where the dialog is and what to
 * repaint after a key changes. */
let SET = null;

function wireAi() {
  SET = settings.mountSettings({
    dialog: $('#ai-dialog'),
    proxy: engine.PROXY,
    onSaved: () => { paintSpec(); paintJobs(); },
    /* the same account in every app: a name and a password are auth calls */
    account: {
      who: async () => {
        const s = await db.session();
        const u = s?.user;
        if (!u) return null;
        return {
          name: u.user_metadata?.full_name || u.user_metadata?.name || '',
          email: u.email || '',
          google: u.app_metadata?.provider === 'google',
        };
      },
      rename: (name) => db.setAccount({ name }),
      password: (pw) => db.setAccount({ password: pw }),
    },
  });
  $('#btn-ai').onclick = () => openAi();
  $('#ai-hint-open')?.addEventListener('click', () => openAi());
}

/* A browser with no key takes the account's, so the pane is never empty just
 * because this is a different machine. */
async function openAi() {
  if (await ai.adoptAccountAi()) paintSpec();
  SET.open();
}

/* ── sharing ──────────────────────────────────────────────────────── */
$('#btn-share').onclick = async () => {
  if (!S.project) return;
  msg('#share-msg', '');
  $('#share-email').value = '';
  await paintShares();
  $('#share-dialog').showModal();
};

async function paintShares() {
  const rows = await db.listShares(S.project.id);
  const link = rows.find((r) => r.code);
  $('#share-link').value = link ? `${location.origin}/?s=${link.code}` : '';
  const list = $('#share-list');
  list.innerHTML = '';
  for (const r of rows.filter((x) => !x.code)) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="who">${esc(r.email)}</span>`
      + `<span class="role">${r.role === 'edit' ? 'can write' : 'can read'}</span>`
      + `<button class="ghost" type="button" data-off="${r.id}">remove</button>`;
    list.append(li);
  }
}

$('#share-dialog').addEventListener('click', async (e) => {
  const off = e.target.closest('[data-off]');
  if (!off) return;
  await db.revokeShare(off.dataset.off);
  await paintShares();
});

$('#share-x').onclick = () => $('#share-dialog').close();
$('#share-make').onclick = async () => {
  try {
    const row = await db.makeLink(S.project.id);
    $('#share-link').value = `${location.origin}/?s=${row.code}`;
    msg('#share-msg', 'a link that reads; it never writes', 'ok');
  } catch (err) { msg('#share-msg', err.message, 'bad'); }
};
$('#share-copy').onclick = async () => {
  const v = $('#share-link').value;
  if (!v) return msg('#share-msg', 'make the link first', 'bad');
  try { await navigator.clipboard.writeText(v); msg('#share-msg', 'copied', 'ok'); }
  catch { msg('#share-msg', 'the browser refused the clipboard', 'bad'); }
};
$('#share-add').onclick = async () => {
  const email = $('#share-email').value.trim();
  const role = $('#share-role').value;
  if (!email) return msg('#share-msg', 'an address or a username', 'bad');
  try {
    await db.shareWith(S.project.id, email, role);
    $('#share-email').value = '';
    await paintShares();
    msg('#share-msg', `${email} sees it as ${role === 'edit' ? 'a writer' : 'a reader'}`, 'ok');
  } catch (err) { msg('#share-msg', err.message, 'bad'); }
};

/* ── a guest reads ────────────────────────────────────────────────── */
async function openGuest(code) {
  S.guest = 'share';
  S.session = await db.session().catch(() => null);
  const data = await db.readShare(code).catch(() => null);
  $('#gate').hidden = true;
  $('#app').hidden = false;
  if (!data) {
    document.body.dataset.guest = '1';
    $('#spec').hidden = false;
    $('#welcome').hidden = true;
    $('#proj-title').value = 'that link does not open anything';
    $('#proj-title').readOnly = true;
    $('#brief').value = 'the link may have been revoked, or the job deleted.';
    return;
  }
  S.project = data.project;
  S.artifacts = data.artifacts || [];
  S.outputs = data.outputs || [];
  S.role = 'view';
  S.current = S.outputs[0]?.id || null;
  document.body.dataset.guest = '1';
  document.body.dataset.role = 'view';
  $('#who').textContent = S.session ? displayName(S.session) : 'a guest';
  who.chip($('#who'));
  $('#welcome').hidden = true;
  $('#spec').hidden = false;
  $('#btn-share').hidden = true;
  $('#guest-banner').hidden = false;
  $('#guest-banner').textContent = guestLine({ thing: 'job', signedIn: !!S.session });
  $('#btn-own').hidden = false;
  $('#btn-own').textContent = 'copy to mine';
  paintSpec();
}

$('#btn-own').onclick = async () => {
  const code = new URLSearchParams(location.search).get('s');
  if (!S.session) {
    /* the gate is one page away: keep the link, sign in, and the copy is made
     * on the way in, so nobody has to find the link again */
    try { if (code) localStorage.setItem('va.copy', code); } catch { /* private mode */ }
    location.href = location.pathname;
    return;
  }
  try {
    const p = await db.copyToMe(S.project, S.artifacts, S.outputs);
    toast('a copy is yours');
    if (code) history.replaceState({}, '', location.pathname);
    await loadProjects();
    await openJob(p.id);
  } catch (err) { toast(err.message); }
};

async function copyFromCode(code) {
  const data = await db.readShare(code).catch(() => null);
  if (!data) return toast('that link no longer opens anything');
  const p = await db.copyToMe(data.project, data.artifacts || [], data.outputs || []);
  toast('the shared job is now a copy in your list');
  await loadProjects();
  await openJob(p.id);
}

/* ── keys a person reaches for ────────────────────────────────────── */
window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape' && document.body.dataset.rail === 'open') document.body.dataset.rail = '';
  if (!typing && e.key === 'n' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $('#btn-new').click();
  }
});

function wireApp() {
  $('#btn-out').onclick = async () => {
    await db.signOut();
    location.reload();
  };
}

boot().catch((err) => {
  console.error(err);
  $('#gate').hidden = false;
  msg('#gate-msg', 'could not start: ' + err.message, 'bad');
});

/* ── the settings dialog, and the dock ─────────────────────────────
 * Same dialog as every other app, same dock. The dock reads what is on
 * screen and answers about it; nothing it writes lands anywhere until a
 * person says so. */
/* The document on the desk is the context; the desk's own body field is where
 * an answer goes, through the same autosave as typing. */
function dockContext() {
  const o = currentOutput();
  const parts = [];
  if (S.project) parts.push('Job: ' + (S.project.title || S.project.name || 'untitled'));
  if (o) parts.push('The document on the desk' + (o.kind ? ` ({o.kind})` : '') + ':\n' + (o.body || ''));
  else {
    const brief = document.getElementById('brief');
    if (brief && brief.value.trim()) parts.push('The brief:\n' + brief.value.trim());
  }
  const field = lastField();
  const sel = field && field.selectionEnd > field.selectionStart
    ? field.value.slice(field.selectionStart, field.selectionEnd) : '';
  return { text: parts.join('\n\n'), selection: sel };
}

function useFromDock(text) {
  if (S.role === 'view') return 'this job is read-only for you';
  const body = document.getElementById('out-body');
  const field = (body && !body.hidden && S.current) ? body : lastField();
  if (!field) return 'open a document first — there is nothing to write into';
  return putInto(field, text, null) ? '' : 'that field will not take it';
}

const DOCK = mountDock({
  app: 'va',
  openSettings: () => SET && SET.open(),
  context: dockContext,
  onUse: useFromDock,
});
mountNotice({ app: 'va', column: ['#spec', '#welcome'] });
