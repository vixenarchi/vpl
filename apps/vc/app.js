/* vpl · vc — compliance. Rules and proofs in, a verdict for every control out.
 *
 * The same desk as vd, with two piles instead of one: *standardi* (the rule)
 * and *dokazi* (the proof). The report is text a person can edit; above it a
 * strip counts the verdict lines — number and word together, never colour
 * alone. The engine is vendor/engine.js; this file owns the two piles and the
 * strip, nothing else.
 */

import * as db from './lib/db.js';
import * as ai from './vendor/ai.js';
import * as who from './vendor/who.js';
import { mountDock, lastField, putInto } from './vendor/dock.js';
import { mountNotice } from './vendor/notices.js';
import * as engine from './vendor/engine.js';
import * as settings from './vendor/settings.js';
import { TEMPLATES, DEFAULT_TEMPLATE, templateById } from './templates.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  session: null,
  projects: [],
  project: null,
  artifacts: [],
  outputs: [],
  role: null,          // owner | edit | view | null
  guest: null,         // null | 'share'
  current: null,       // the output on the desk
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

function plainAuthError(err) {
  const m = String(err?.message || err || '');
  if (/already registered/i.test(m)) return 'that address already has an account — sign in instead';
  if (/invalid format|validate email/i.test(m)) return 'that does not look like an address';
  if (/invalid login credentials/i.test(m)) return 'wrong address or password';
  return m || 'could not sign in';
}

/* ── boot ─────────────────────────────────────────────────────────── */
async function boot() {
  $('#gate-theme').onclick = applyTheme;
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
  const bring = localStorage.getItem('vd.copy');
  if (bring) {
    localStorage.removeItem('vd.copy');
    await copyFromCode(bring);
    return;
  }
  const last = localStorage.getItem('vd.last');
  const open = S.projects.find((p) => p.id === last) || S.projects[0];
  if (open) await openJob(open.id);
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
    const tpl = templateById(p.template);
    const mine = p.user_id === S.session?.user?.id;
    li.innerHTML = `<button class="pick" type="button">${esc(p.title || 'untitled job')}</button>`
      + `<span class="tpl" title="${esc(tpl.label)}">${esc(tpl.id)}</span>`
      + (mine ? '<button class="kill" type="button" title="delete the job">✕</button>' : '');
    list.append(li);
  }
  $('#proj-none').hidden = S.projects.length > 0;
}

$('#proj-list').addEventListener('click', async (e) => {
  const kill = e.target.closest('.kill');
  const row = e.target.closest('.proj-row');
  if (!row) return;
  const id = row.dataset.id;
  if (kill) {
    const p = S.projects.find((x) => x.id === id);
    if (!confirm(`delete “${p?.title || 'this job'}” and everything in it?`)) return;
    await db.deleteProject(id);
    if (S.project?.id === id) S.project = null;
    await loadProjects();
    if (S.projects[0]) await openJob(S.projects[0].id);
    else renderWelcome();
    return;
  }
  await openJob(id);
});

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
  localStorage.setItem('vd.last', id);
  S.artifacts = await db.listArtifacts(id);
  S.outputs = await db.listOutputs(id);
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
  const nStd = S.artifacts.filter((a) => a.kind === 'standard').length;
  const nEv = S.artifacts.length - nStd;
  $('#proj-meta').textContent = [
    `${nStd} standard${nStd === 1 ? '' : 'a'}`,
    `${nEv} dokaz${nEv === 1 ? '' : 'a'}`,
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
    toast('the next document follows the new template');
  } catch (err) { msg('#gen-msg', err.message, 'bad'); }
});

/* ── the two piles ────────────────────────────────────────────────── */
function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function artRow(a) {
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
    + '<button class="del" type="button" title="remove">✕</button></span>';
  return li;
}

function renderArtifacts() {
  const std = S.artifacts.filter((a) => a.kind === 'standard');
  const ev = S.artifacts.filter((a) => a.kind !== 'standard');
  for (const [sel, rows] of [['#standards', std], ['#evidence', ev]]) {
    const ul = $(sel);
    ul.innerHTML = '';
    for (const a of rows) ul.append(artRow(a));
  }
  $('#std-none').hidden = std.length > 0;
  $('#ev-none').hidden = ev.length > 0;
  $('#std-count').textContent = std.length ? String(std.length) : '';
  $('#ev-count').textContent = ev.length ? String(ev.length) : '';
}

for (const sel of ['#standards', '#evidence']) $(sel).addEventListener('click', async (e) => {
  const li = e.target.closest('.art');
  if (!li) return;
  const a = S.artifacts.find((x) => x.id === li.dataset.id);
  if (!a) return;

  if (e.target.closest('.del')) {
    if (!confirm(`remove “${a.title || 'this input'}” from this job?`)) return;
    await db.deleteArtifact(a.id);
    S.artifacts = S.artifacts.filter((x) => x.id !== a.id);
    renderArtifacts();
    paintSpec();
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

function openArtifact(a, kind = 'evidence') {
  S.artDraft = a ? { ...a } : { kind, title: '', text: '' };
  $('#art-head').textContent = a
    ? (a.kind === 'standard' ? 'standard' : 'dokaz')
    : (kind === 'standard' ? 'a new standard' : 'a new dokaz');
  $('#art-title').value = S.artDraft.title || '';
  $('#art-text').value = S.artDraft.text || '';
  const cold = S.role === 'view';
  $('#art-title').readOnly = cold;
  $('#art-text').readOnly = cold;
  $('#art-del').hidden = !a;
  const f = $('#art-file');
  f.hidden = !a?.file_name;
  if (a?.file_name) f.textContent = `original: ${a.file_name} · ${fmtSize(a.file_size)}`;
  msg('#art-msg', '');
  $('#art-dialog').showModal();
  setTimeout(() => (a ? $('#art-text') : $('#art-title')).focus(), 60);
}

$('#btn-add-standard').onclick = () => openArtifact(null, 'standard');
$('#btn-add-evidence').onclick = () => openArtifact(null, 'evidence');
$('#art-x').onclick = () => $('#art-dialog').close();
$('#art-x2').onclick = () => $('#art-dialog').close();

$('#art-save').onclick = async () => {
  const d = S.artDraft;
  if (!d || !S.project) return;
  const title = $('#art-title').value.trim() || 'untitled input';
  const text = $('#art-text').value;
  msg('#art-save', 'saving…', 'busy');
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
  } catch (err) { msg('#art-msg', err.message, 'bad'); }
};

$('#art-del').onclick = async () => {
  const d = S.artDraft;
  if (!d?.id) return;
  if (!confirm(`remove “${d.title || 'this input'}” from this job?`)) return;
  try {
    await db.deleteArtifact(d.id);
    S.artifacts = S.artifacts.filter((x) => x.id !== d.id);
    $('#art-dialog').close();
    renderArtifacts();
    paintSpec();
  } catch (err) { msg('#art-msg', err.message, 'bad'); }
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

const VERDICT = /^-\s*(PASS|FAIL|UNKNOWN)\b/i;

function countVerdicts(body) {
  const c = { pass: 0, fail: 0, unknown: 0 };
  for (const line of String(body || '').split('\n')) {
    const m = VERDICT.exec(line.trim());
    if (m) c[m[1].toLowerCase()] += 1;
  }
  return c;
}

/* The strip is the only place this app knows more than a text editor: it reads
 * the report's own lines. Number and word together — colour is never alone. */
function paintFindings(body) {
  const c = countVerdicts(body);
  const total = c.pass + c.fail + c.unknown;
  $('#findings').hidden = total === 0;
  $('#n-pass').textContent = String(c.pass);
  $('#n-fail').textContent = String(c.fail);
  $('#n-unknown').textContent = String(c.unknown);
  $('#findings-note').textContent = total
    ? `${total} control${total === 1 ? '' : 's'} on the report`
    : 'no verdict line yet — a report says PASS, FAIL or UNKNOWN per line';
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
    $('#findings').hidden = true;
    return;
  }
  none.hidden = true;
  body.hidden = false;
  if (body.value !== o.body) body.value = o.body;
  body.readOnly = S.role === 'view';

  versions.hidden = S.outputs.length < 2;
  versions.innerHTML = S.outputs.map((x, i) => {
    const label = i === 0 ? 'just now' : engine.when(x.created_at);
    return `<option value="${x.id}">${esc(label)} · ${engine.countWords(x.body)} words</option>`;
  }).join('');
  versions.value = o.id;
  $('#out-meta').textContent = `${engine.countWords(o.body).toLocaleString()} words · ${engine.when(o.created_at)}`;
  paintFindings(o.body);
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

$('#out-body').addEventListener('input', () => {
  paintFindings($('#out-body').value);
  saveOutput();
});

$('#btn-copy').onclick = async () => {
  const o = currentOutput();
  const text = o ? o.body : '';
  if (!text) return toast('nothing to copy yet');
  try {
    await navigator.clipboard.writeText(text);
    toast('the document is on the clipboard');
  } catch { toast('the browser refused the clipboard'); }
};

$('#btn-print').onclick = () => {
  const o = currentOutput();
  if (!o) return toast('nothing to print yet');
  $('#print-doc').textContent = `${S.project?.title || ''}\n\n${o.body}`;
  window.print();
};

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

/* ── the model's door and its key ────────────────────────────────── */
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

/* ── settings: one component, the same dialog in every app ──────────
 * The provider list, the tabs, the test call and the theme all live in
 * vendor/settings.js, so two apps cannot drift into two settings dialogs. */
let SET = null;

function wireAi() {
  SET = settings.mountSettings({
    dialog: $('#ai-dialog'),
    proxy: engine.PROXY,
    onSaved: () => paintSpec(),
  });
  $('#btn-ai').onclick = () => openAi();
}

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
  $('#guest-banner').textContent = 'you are reading a shared check. a copy can become yours — it never writes back.';
  $('#btn-own').hidden = false;
  $('#btn-own').textContent = 'copy to mine';
  paintSpec();
}

$('#btn-own').onclick = async () => {
  const code = new URLSearchParams(location.search).get('s');
  if (!S.session) {
    /* the gate is one page away: keep the link, sign in, and the copy is made
     * on the way in, so nobody has to find the link again */
    try { if (code) localStorage.setItem('vd.copy', code); } catch { /* private mode */ }
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
  app: 'vc',
  openSettings: () => SET && SET.open(),
  context: dockContext,
  onUse: useFromDock,
});
mountNotice({ app: 'vc', host: '#spec' });
mountNotice({ app: 'vc', host: '#welcome' });
