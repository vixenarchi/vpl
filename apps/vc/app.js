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
import { TEMPLATES, DEFAULT_TEMPLATE, templateById, nounsFor } from './templates.js';
import { plainAuthError, guestLine } from './vendor/words.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  session: null,
  projects: [],
  project: null,
  artifacts: [],       // the check's own pile (rules, and shared proofs)
  tArtifacts: [],      // the selected row's own proofs
  targets: [],         // the batch: one row is one check
  targetBin: [],
  target: null,        // which row is on the desk; null is the check itself
  batch: false,        // a run is in flight (stop is the only verb)
  bin: [],             // inputs in the recycle bin
  binMode: false,
  jobBin: false,
  jobsBinned: 0,
  outputs: [],
  role: null,          // owner | edit | view | null
  guest: null,         // null | 'share'
  current: null,       // the output on the desk
  artDraft: null,      // the input open in the dialog
  lib: [],             // the standards this person keeps
  libBin: [],          // standards in the bin
  libShowBin: false,
  libDraft: null,      // the standard open in the library editor
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
  /* the drawer is small and private: it comes with the account, so an input can
   * always say which standard it was copied from */
  loadLibrary().catch(() => {});
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
      ? `<span class="pick bin-row-name">${esc(p.title || 'untitled check')}</span>`
        + `<span class="tpl" title="${esc(tpl.label)}">${esc(tpl.id)}</span>`
        + '<span class="tools">'
        + '<button class="row-restore" type="button" data-back title="put it back">restore</button>'
        + '<button class="kill" type="button" data-purge title="delete it for good">✕</button>'
        + '</span>'
      : `<button class="pick" type="button">${esc(p.title || 'untitled check')}</button>`
        + `<span class="tpl" title="${esc(tpl.label)}">${esc(tpl.id)}</span>`
        + (mine ? '<button class="kill" type="button" title="move the check to the recycle bin">✕</button>' : '');
    list.append(li);
  }
  $('#proj-none').hidden = S.projects.length > 0;
  $('#proj-none').textContent = S.jobBin
    ? 'nothing in the bin.'
    : 'nothing checked yet. one check is one set of rules held against one set of proofs.';
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
    toast('“' + (p?.title || 'the check') + '” is back');
    return;
  }
  if (purge) {
    const p = S.projects.find((x) => x.id === id);
    if (!confirm(`delete “${p?.title || 'this check'}” for good? it takes its proofs and reports with it.`)) return;
    await db.deleteProject(id);
    await loadProjects();
    return;
  }
  if (kill) {
    const p = S.projects.find((x) => x.id === id);
    await db.binProject(id);
    if (S.project?.id === id) S.project = null;
    await loadProjects();
    if (S.projects[0]) await openJob(S.projects[0].id);
    else renderWelcome();
    toast('“' + (p?.title || 'the check') + '” is in the recycle bin');
    return;
  }
  await openJob(id);
});

/* The bin in the rail: a switch, a count, a sentence. */
function paintJobBin() {
  const btn = $('#btn-job-bin');
  if (!btn) return;
  const n = S.jobsBinned || 0;
  btn.setAttribute('aria-pressed', String(S.jobBin));
  btn.classList.toggle('on', S.jobBin);
  btn.title = S.jobBin ? 'back to the checks' : 'the recycle bin of checks (' + n + ')';
  $('#job-bin-count').textContent = n ? String(n) : '';
  $('#job-bin-banner').hidden = !S.jobBin;
  $('#job-bin-note').textContent = S.jobBin
    ? (n ? `${n} check${n === 1 ? '' : 's'} binned — restore one, or delete it for good`
         : 'nothing in it — a deleted check waits here')
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
  localStorage.setItem('vd.last', id);
  S.artifacts = await db.listArtifacts(id);
  S.targets = await db.listTargets(id).catch(() => []);
  S.targetBin = [];
  /* a queue never survives a page: nobody is watching a row that says it is
   * running, so it is queued again, in its own place */
  if (S.targets.some((t) => t.status === 'running')) db.requeueRunning(id).catch(() => {});
  S.target = S.targets[0]?.id || null;
  S.tArtifacts = S.target ? await db.listArtifacts(id, { targetId: S.target }) : [];
  S.bin = await db.listArtifacts(id, { bin: true }).catch(() => []);
  S.outputs = await db.listOutputs(id, { targetId: S.target });
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

  const n = tpl.nouns;
  const pile = evRows();
  /* Croatian counts the genitive plural after any number but one: 1 standard,
   * 2 standarda — the same noun cannot serve both, so the pack carries both */
  const words = [...S.artifacts, ...pile].reduce((k, a) => k + engine.countWords(a.text), 0);
  const nStd = S.artifacts.filter((a) => a.kind === 'standard').length;
  const nEv = pile.length;
  $('#proj-meta').textContent = [
    `${nStd} ${nStd === 1 ? n.rule : n.ruleCount}`,
    `${nEv} ${nEv === 1 ? n.proof : n.proofCount}`,
    S.targets.length ? `${S.targets.length} ${S.targets.length === 1 ? n.target : n.targetCount}` : '',
    words ? `${words.toLocaleString()} words to read` : 'nothing to read yet',
    engine.hasKey() ? engine.modelName() : 'no model key yet',
  ].filter(Boolean).join(' · ');

  paintNouns(tpl);
  renderArtifacts();
  paintTargets();
  paintOutput();
  $('#btn-first-generate').hidden = S.role === 'view';
  /* the library is the owner's drawer: a guest never sees the door */
  $('#btn-from-lib').hidden = S.role !== 'owner';
}

/* Every noun on this screen comes from the template pack, so a job ad does not
 * read like an audit. One place, so the head, the button and the empty line
 * agree with each other. */
function paintNouns(tpl) {
  const n = tpl.nouns;
  $('#std-head').textContent = n.rules;
  $('#ev-head').textContent = n.proofs;
  $('#tgt-head').textContent = n.targets;
  $('#btn-add-standard').textContent = '＋ ' + n.rule;
  $('#btn-add-evidence').textContent = '＋ ' + n.proof;
  $('#btn-add-target').textContent = '＋ ' + n.target;
  $('#btn-add-target').title = S.targets.length >= MAX_TARGETS
    ? `${MAX_TARGETS} is the cap — one call each, and somebody has to read them`
    : 'add one more';
  $('#std-note').textContent = `the rules — a policy, a checklist, a law's paragraph.`;
  $('#ev-note').textContent = S.target
    ? `what proves it for this ${n.target} — this pile is only theirs.`
    : `what proves it — minutes, a configuration, a screenshot, a pdf.`;
  const who = S.targets.find((t) => t.id === S.target);
  $('#ev-who').hidden = !who;
  if (who) {
    $('#ev-who').innerHTML = `<button type="button" class="ev-clear" title="back to the whole check">${esc(who.name || 'unnamed')} ✕</button>`;
  }
}

/* Which proofs belong to the desk: the selected row's own, or the check's. */
function evRows() {
  return S.target ? S.tArtifacts : S.artifacts.filter((a) => a.kind !== 'standard');
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
/* ── the recycle bin ───────────────────────────────────────────────
 * Four signals, none of them colour alone: the banner names the place and
 * counts it, each list is tinted with a mark strip, the button under the lists
 * is filled, and every row says *restore* instead of the usual tools. */
function paintBin() {
  const n = S.bin.length + S.targetBin.length;
  const btn = $('#btn-bin');
  btn.setAttribute('aria-pressed', String(S.binMode));
  btn.title = S.binMode ? 'close the recycle bin and go back to the inputs'
    : n ? `open the recycle bin (${n})` : 'the recycle bin is empty';
  $('.bin-label', btn).textContent = S.binMode ? 'back to the inputs' : 'recycle bin';
  $('#bin-count').textContent = n ? String(n) : '';
  $('#bin-banner').hidden = !S.binMode;
  $('#bin-banner-note').textContent = n
    ? `${n} thing${n === 1 ? '' : 's'} in the bin — restore one, or delete it for good`
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


/* ── the batch ─────────────────────────────────────────────────────── */
/* Fifty offers, or one job ad and a pile of CVs. One row is one check: its own
 * proofs, its own report, its own counts. The queue moves because a person
 * pressed a button and stops when they leave — there is no scheduler here. */
const MAX_TARGETS = 50;
const TGT_WORD = { queued: 'waiting', running: 'running', done: 'done', failed: 'failed' };

function targetRow(t, i) {
  const on = t.id === S.target;
  const c = { pass: t.n_pass, fail: t.n_fail, unknown: t.n_unknown };
  const tally = t.status === 'done'
    ? `<span class="verdict pass"><b>${c.pass}</b> pass</span>`
      + `<span class="verdict fail"><b>${c.fail}</b> fail</span>`
      + `<span class="verdict unknown"><b>${c.unknown}</b> unknown</span>`
    : t.error ? `<span class="tgt-why">${esc(t.error.slice(0, 80))}</span>`
      : '';
  return `<li class="tgt st-${t.status}${on ? ' on' : ''}" data-id="${t.id}">
      <button class="tgt-pick" type="button" aria-pressed="${on}"
              title="put this one on the desk"><span class="pos">${i + 1}</span></button>
      <input class="tgt-name" type="text" value="${esc(t.name || '')}"
             aria-label="name of this row" spellcheck="false"${S.role === 'view' ? ' readonly' : ''}>
      <span class="tgt-state">${t.status === 'queued' ? 'not run yet' : (TGT_WORD[t.status] || esc(t.status))}</span>
      <span class="tgt-tally">${tally}</span>
      <button class="tgt-del" type="button" title="remove — it waits in the recycle bin"
              ${S.role === 'view' ? 'hidden' : ''}>✕</button>
    </li>`;
}

function targetBinRows() {
  return S.targetBin.map((t) => `<li class="art in-bin tgt-bin" data-id="${t.id}" data-tgt="1">
      <span class="kind">row</span>
      <span class="what"><span class="name">${esc(t.name || 'unnamed row')}</span>
        <span class="line">its own ${esc(nounsFor(S.project?.template).proofs)} and report</span></span>
      <span class="tools">
        <button class="row-restore" type="button" data-back title="put it back">restore</button>
        <button class="del" type="button" data-purge title="delete it for good">✕</button>
      </span>
    </li>`).join('');
}

function paintTargets() {
  const tpl = templateById(S.project?.template);
  const n = tpl.nouns;
  const wrap = $('#targets-wrap');
  const show = !!n.batch || S.targets.length > 0;
  wrap.hidden = !show;
  if (!show) return;
  $('#tgt-count').textContent = S.targets.length ? String(S.targets.length) : '';
  $('#btn-add-target').disabled = S.targets.length >= MAX_TARGETS || S.role === 'view';
  /* a repaint that rebuilds the list must give the caret back to the field it
   * took it from: a change of selection is not a reason to stop typing */
  const live = document.activeElement;
  const keep = live?.classList?.contains('tgt-name') ? live.closest('.tgt')?.dataset.id : null;
  let caret = null;
  try { caret = keep ? [live.selectionStart, live.selectionEnd] : null; } catch { caret = null; }
  $('#targets').innerHTML = S.targets.map(targetRow).join('');
  if (keep) {
    const inp = $(`#targets .tgt[data-id="${keep}"] .tgt-name`);
    if (inp) {
      inp.focus();
      try { inp.setSelectionRange(caret[0] ?? inp.value.length, caret[1] ?? inp.value.length); } catch { /* readonly */ }
    }
  }
  const run = $('#btn-run-all');
  run.disabled = S.batch || S.role === 'view' || !S.targets.length;
  run.textContent = S.batch ? 'running…' : `run all ${S.targets.length || ''}`.trim();
  run.title = S.batch ? 'one at a time — stop finishes the one in flight'
    : `${S.targets.length} call${S.targets.length === 1 ? '' : 's'}, one after another`;
  $('#btn-stop').hidden = !S.batch;
  if (!S.batch && !$('#tgt-run-msg').dataset.keep) {
    $('#tgt-run-msg').textContent = S.targets.length
      ? `${S.targets.length} × 1 call`
      : '';
  }
}

async function selectTarget(id) {
  S.target = id || null;
  const projectId = S.project?.id;
  if (!projectId) return;
  S.tArtifacts = S.target ? await db.listArtifacts(projectId, { targetId: S.target }) : [];
  S.outputs = await db.listOutputs(projectId, { targetId: S.target });
  S.current = S.outputs[0]?.id || null;
  paintNouns(templateById(S.project.template));
  renderArtifacts();
  paintTargets();
  paintOutput();
}

async function addTargetRow() {
  if (S.role === 'view' || !S.project) return;
  const n = nounsFor(S.project.template);
  if (S.targets.length >= MAX_TARGETS) {
    return toast(`${MAX_TARGETS} is the cap — one call each`);
  }
  try {
    const t = await db.addTarget(S.project.id, `${n.target} ${S.targets.length + 1}`);
    S.targets.push(t);
    await selectTarget(t.id);
    const inp = $(`#targets .tgt[data-id="${t.id}"] .tgt-name`);
    if (inp) { inp.focus(); inp.select(); }
  } catch (err) { toast('could not add it: ' + err.message); }
}

async function binTargetRow(t) {
  try {
    await db.binTarget(t.id);
    S.targets = S.targets.filter((x) => x.id !== t.id);
    S.targetBin = [{ ...t, deleted_at: new Date().toISOString() }, ...S.targetBin];
    if (S.target === t.id) await selectTarget(S.targets[0]?.id || null);
    else { renderArtifacts(); paintTargets(); }
    toast('“' + (t.name || 'the row') + '” is in the recycle bin');
  } catch (err) { toast('could not remove it: ' + err.message); }
}

async function restoreTarget(t) {
  try {
    await db.restoreTarget(t.id);
    S.targetBin = S.targetBin.filter((x) => x.id !== t.id);
    S.targets = await db.listTargets(S.project.id);
    renderArtifacts();
    paintTargets();
    toast('“' + (t.name || 'the row') + '” is back');
  } catch (err) { toast('could not restore it: ' + err.message); }
}

async function purgeTarget(t) {
  try {
    await db.deleteTarget(t.id);
    S.targetBin = S.targetBin.filter((x) => x.id !== t.id);
    renderArtifacts();
    paintTargets();
  } catch (err) { toast('could not delete it: ' + err.message); }
}

/* What a batch needs from the model is a fraction of what a chat needs: the
 * rules do not change between rows, so the rules are sent once per row anyway —
 * one request per row keeps a failure to one row. */
async function runRow(row, tpl, rules) {
  const projectId = S.project.id;
  await db.updateTarget(row.id, { status: 'running', error: '' });
  row.status = 'running';
  paintTargets();
  const proofs = await db.listArtifacts(projectId, { targetId: row.id });
  const messages = engine.buildMessages({
    template: tpl, project: S.project, artifacts: [...rules, ...proofs], notes: '',
  });
  const t0 = Date.now();
  const run = await db.startRun(projectId, {
    template: tpl.id, model: engine.modelName(), notes: '',
    prompt: `template: ${tpl.id}\ntarget: ${row.name || row.id}\ninputs: ${proofs.map((a) => a.title || a.kind).join(' · ')}`,
    targetId: row.id,
  });
  const answer = await engine.callModel(messages);
  if (!answer || !answer.trim()) throw new Error('the model answered with nothing');
  await db.finishRun(run.id, { status: 'done', took_ms: Date.now() - t0 });
  const out = await db.addOutput(projectId, {
    run_id: run.id, kind: tpl.kind, title: tpl.out, body: answer, target_id: row.id,
  });
  const c = countVerdicts(answer);
  const upd = await db.updateTarget(row.id, {
    status: 'done', n_pass: c.pass, n_fail: c.fail, n_unknown: c.unknown, error: '',
  });
  Object.assign(row, upd);
  return out;
}

let STOP_BATCH = false;

async function runBatch() {
  if (S.batch || !S.project || S.role === 'view') return;
  const tpl = templateById(S.project.template);
  const n = tpl.nouns;
  if (!engine.hasKey()) {
    msg('#tgt-run-msg', 'no model key yet — paste one in the settings', 'bad');
    openAi();
    return;
  }
  const rules = S.artifacts.filter((a) => a.kind === 'standard');
  if (!rules.length) {
    msg('#tgt-run-msg', `no ${n.rules} yet — each row needs something to be measured against`, 'bad');
    return;
  }
  if (S.targets.length > MAX_TARGETS) {
    msg('#tgt-run-msg', `${MAX_TARGETS} is the cap`, 'bad');
    return;
  }
  const queue = [...S.targets];
  S.batch = true;
  STOP_BATCH = false;
  paintTargets();
  paintBusy(true, Date.now());
  let done = 0;
  let failed = 0;
  try {
    for (const row of queue) {
      if (STOP_BATCH) break;
      $('#tgt-run-msg').dataset.keep = '1';
      msg('#tgt-run-msg', `${done + failed + 1} of ${queue.length} — ${row.name || 'row'}`, 'busy');
      try {
        const out = await runRow(row, tpl, rules);
        if (row.id === S.target) {
          S.outputs.unshift(out);
          S.current = out.id;
          paintOutput();
        }
        done += 1;
      } catch (err) {
        failed += 1;
        row.status = 'failed';
        row.error = String(err.message || err).slice(0, 200);
        db.updateTarget(row.id, { status: 'failed', error: row.error }).catch(() => {});
        if (err.code === engine.NO_KEY) { STOP_BATCH = true; openAi(); }
      }
      paintTargets();
    }
  } finally {
    S.batch = false;
    paintBusy(false);
    delete $('#tgt-run-msg').dataset.keep;
    paintTargets();
  }
  const stopped = STOP_BATCH && done + failed < queue.length;
  msg('#tgt-run-msg',
    `done: ${done} of ${queue.length}${failed ? `, ${failed} failed` : ''}`
    + (stopped ? ' — stopped after the one in flight' : ''),
    failed ? 'bad' : 'ok');
}

/* ── the bin, closing over both kinds of row ───────────────────────── */

/* Opening the bin from halfway down a long list used to show a tinted list and
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
    try { S.targetBin = await db.listTargets(S.project.id, { bin: true }); } catch { S.targetBin = []; }
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
    if (a.target_id && S.target === a.target_id) {
      S.tArtifacts = [...S.tArtifacts, { ...a, deleted_at: null }];
    }
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
  if (!S.bin.length && !S.targetBin.length) return;
  const n = S.bin.length + S.targetBin.length;
  try {
    for (const t of S.targetBin) await db.deleteTarget(t.id);
    await db.emptyBin(S.project.id);
    S.bin = [];
    S.targetBin = [];
    renderArtifacts();
    toast(`${n} ${n === 1 ? 'thing' : 'things'} deleted for good`);
  } catch (err) { toast(err.message); }
}

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
  /* In the bin both lists are one drawer: a standard and a dokaz are the same
   * kind of thing to lose, and the row's kind word says which it was. */
  if (S.binMode) {
    $('#standards').classList.add('bin-mode');
    $('#evidence').classList.remove('bin-mode');
    /* a binned row of a batch is one thing to lose too: it says `target` and
     * takes its proofs with it when it is destroyed */
    $('#standards').innerHTML = targetBinRows() + S.bin.map(binRowHTML).join('');
    $('#evidence').innerHTML = '';
    const many = S.bin.length + S.targetBin.length;
    $('#std-none').hidden = many > 0;
    $('#std-none').textContent = many ? '' : 'the recycle bin is empty — a removed input waits here';
    $('#ev-none').hidden = true;
    $('#std-count').textContent = many ? String(many) : '';
    $('#ev-count').textContent = '';
    paintBin();
    return;
  }
  $('#standards').classList.remove('bin-mode');
  const std = S.artifacts.filter((a) => a.kind === 'standard');
  const ev = evRows();
  for (const [sel, rows] of [['#standards', std], ['#evidence', ev]]) {
    const ul = $(sel);
    ul.innerHTML = '';
    for (const a of rows) ul.append(artRow(a));
  }
  $('#std-none').hidden = std.length > 0;
  $('#std-none').textContent = 'no rules yet — without them there is nothing to check against.';
  $('#ev-none').hidden = ev.length > 0;
  $('#ev-none').textContent = S.target
    ? 'nothing here yet — this row is checked against the rules and nothing else.'
    : 'no evidence yet. a report will be honest and useless.';
  $('#std-count').textContent = std.length ? String(std.length) : '';
  $('#ev-count').textContent = ev.length ? String(ev.length) : '';
  paintBin();
}

for (const sel of ['#standards', '#evidence']) $(sel).addEventListener('click', async (e) => {
  const li = e.target.closest('.art');
  if (!li) return;
  /* the drawer holds rows of a batch next to the inputs, so ✕ and restore look
   * at which of the two this row is before it looks at anything else */
  if (li.dataset.tgt) {
    const t = S.targetBin.find((x) => x.id === li.dataset.id)
      || S.targets.find((x) => x.id === li.dataset.id);
    if (!t) return;
    if (e.target.closest('[data-back]')) return restoreTarget(t);
    if (e.target.closest('[data-purge]')) return purgeTarget(t);
    return;
  }
  const a = S.binMode
    ? S.bin.find((x) => x.id === li.dataset.id)
    : [...S.artifacts, ...S.tArtifacts].find((x) => x.id === li.dataset.id);
  if (!a) return;

  if (e.target.closest('[data-back]')) return restoreInput(a);
  if (e.target.closest('[data-purge]')) return purgeInput(a);

  if (e.target.closest('.del')) {
    /* ✕ removes it from the job, not from the world: the words go to the bin */
    await db.binArtifact(a.id);
    S.artifacts = S.artifacts.filter((x) => x.id !== a.id);
    S.tArtifacts = S.tArtifacts.filter((x) => x.id !== a.id);
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
  paintFrom(a);
  if (a?.file_name) f.textContent = `original: ${a.file_name} · ${fmtSize(a.file_size)}`;
  msg('#art-dlg-msg', '');
  $('#art-dialog').showModal();
  setTimeout(() => (a ? $('#art-text') : $('#art-title')).focus(), 60);
}

$('#btn-bin').onclick = toggleBin;
$('#btn-bin-empty').onclick = emptyBin;

$('#btn-add-standard').onclick = () => openArtifact(null, 'standard');
$('#btn-add-evidence').onclick = () => openArtifact(null, 'evidence');
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
      const j = S.tArtifacts.findIndex((x) => x.id === d.id);
      if (j >= 0) S.tArtifacts[j] = row;
    } else {
      /* a new proof belongs to the row that is on the desk; a standard belongs
       * to the check, because a rule is the same rule for every row */
      const row = await db.addArtifact(S.project.id, {
        kind: d.kind || 'text', title, text,
        file_path: d.file_path, file_name: d.file_name,
        file_size: d.file_size, file_mime: d.file_mime,
        target_id: d.kind === 'standard' ? null : S.target,
      });
      if (row.target_id) S.tArtifacts.push(row);
      else S.artifacts.push(row);
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

/* Did this input come from the library? Provenance, not a link: the text is a
 * copy, and a standard that was replaced or binned does not touch it. */
function paintFrom(a) {
  const line = $('#art-from');
  if (!a?.from_standard) { line.hidden = true; line.textContent = ''; return; }
  const from = S.lib.find((x) => x.id === a.from_standard)
    || S.libBin.find((x) => x.id === a.from_standard);
  line.hidden = false;
  line.textContent = from
    ? 'copied from the library — ' + (from.title || 'a standard without a name')
    : 'copied from the library — that standard is no longer there';
}

/* ── the library: a law you keep, so you stop pasting it ────────────
 * Private to the person, never shared, never pointed at. "add" copies the text
 * into this check and remembers which library row it came from. A law replaced
 * next year cannot change a report written today. */
const LIB_KIND = ['law', 'standard', 'policy', 'terms', 'job-ad'];

function charsLine(st) {
  const n = (st?.text || '').length;
  if (!n) return 'no text yet';
  return n.toLocaleString() + (n === 1 ? ' character' : ' characters');
}

async function loadLibrary() {
  [S.lib, S.libBin] = await Promise.all([
    db.listStandards().catch(() => []),
    db.listStandards({ bin: true }).catch(() => []),
  ]);
}

function libRow(st) {
  const bin = S.libShowBin;
  return `<li class="lib-item" data-id="${esc(st.id)}">`
    + `<span class="kind">${esc(st.kind)}</span>`
    + `<span class="what"><button class="name" type="button">${esc(st.title || 'a standard without a name')}</button>`
    + `<span class="line">${esc(charsLine(st))}${st.source_url ? ' · linked' : ''}</span></span>`
    + '<span class="tools">'
    + (bin
      ? '<button class="back" type="button" title="back into the library">back</button>'
        + '<button class="del" type="button" title="delete for good">✕</button>'
      : '<button class="add" type="button" title="copy it into this check">add</button>'
        + '<button class="del" type="button" title="put it in the bin">✕</button>')
    + '</span></li>';
}

function renderLibrary() {
  const rows = S.libShowBin ? S.libBin : S.lib;
  $('#lib-list').innerHTML = rows.map(libRow).join('');
  $('#lib-none').hidden = rows.length > 0;
  $('#lib-none').textContent = S.libShowBin
    ? 'the bin is empty — nothing was removed.'
    : 'nothing kept yet — a law, a policy, a job ad.';
  const n = S.libBin.length;
  const line = $('#lib-bin-line');
  line.hidden = n === 0;
  line.textContent = '';
  if (n) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost';
    b.textContent = S.libShowBin
      ? 'back to the library'
      : `${n} in the bin — show ${n === 1 ? 'it' : 'them'}`;
    b.onclick = () => { S.libShowBin = !S.libShowBin; renderLibrary(); };
    line.append(b);
  }
}

function showLibEditor(st) {
  S.libDraft = st ? { ...st } : { kind: 'law', title: '', text: '' };
  /* one thing at a time: the list steps aside while a standard is open, so the
   * row above and the field below cannot both claim to be the same document */
  for (const sel of ['#lib-list', '#lib-none', '#lib-bin-line', '#lib-new']) $(sel).hidden = true;
  $('#lib-edit').hidden = false;
  $('#lib-title').value = S.libDraft.title || '';
  $('#lib-kind').value = LIB_KIND.includes(S.libDraft.kind) ? S.libDraft.kind : 'law';
  $('#lib-text').value = S.libDraft.text || '';
  $('#lib-url').value = S.libDraft.source_url || '';
  $('#lib-chars').textContent = charsLine(S.libDraft);
  paintLibFile(S.libDraft);
  msg('#lib-src-msg', '');
  msg('#lib-msg', '');
  $('#lib-del').hidden = !st?.id;
  $('#lib-add').hidden = !st?.id;
  setTimeout(() => $('#lib-title').focus(), 50);
}

/* A standard's original: named, sized, and openable — the person may want page
 * 47 even when the text is already in the drawer. */
function paintLibFile(st) {
  const line = $('#lib-file-line');
  if (!st?.file_name) { line.hidden = true; line.textContent = ''; return; }
  line.hidden = false;
  line.innerHTML = 'original: <a href="#" id="lib-file-open">' + esc(st.file_name) + '</a> · '
    + esc(fmtSize(st.file_size) || '');
  const a = $('#lib-file-open');
  if (a) {
    a.onclick = async (e) => {
      e.preventDefault();
      try {
        const url = await db.fileUrl(st.file_path);
        window.open(url, '_blank', 'noopener');
      } catch (err) { msg('#lib-src-msg', err.message, 'bad'); }
    };
  }
}

/* The fetch door is the model door's sibling: same address, different name.
 * Local development answers /api/fetch; a Pages deployment without functions
 * falls back to the suite's shared proxy, exactly as /api/chat does. */
function fetchDoor() {
  const door = String(engine.PROXY || '');
  return door ? door.replace(/\/chat\/?$/, '/fetch') : '';
}

async function fetchLaw(raw) {
  const url = String(raw || '').trim();
  if (!/^https:\/\//i.test(url)) return msg('#lib-src-msg', 'a link starts with https://', 'bad');
  const send = (to) => fetch(to, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  msg('#lib-src-msg', 'reading the page…', 'busy');
  try {
    let res = await send('/api/fetch');
    if (res.status === 404 || res.status === 405) {
      const door = fetchDoor();
      if (door) res = await send(door);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.text) {
      const why = data?.error || ('the door answered ' + res.status);
      msg('#lib-src-msg', String(why).slice(0, 220), 'bad');
      if (data?.isPdf) $('#lib-file-btn').focus();
      return;
    }
    $('#lib-text').value = data.text;
    $('#lib-url').value = data.url || url;
    $('#lib-chars').textContent = charsLine({ text: data.text });
    msg('#lib-src-msg',
      'read ' + data.chars.toLocaleString() + ' characters'
      + (data.title ? ' from “' + String(data.title).slice(0, 60) + '”' : '') + ' — keep it to save',
      'ok');
  } catch (err) {
    msg('#lib-src-msg', 'could not reach the door: ' + String(err.message || err).slice(0, 160), 'bad');
  }
}

/* A pdf becomes text in the browser and the original goes to the bucket. A
 * standard has to exist before its file has somewhere to live, so a file chosen
 * in a fresh draft keeps the standard first, then fills it. */
async function readStandardFile(file) {
  if (!file) return;
  let st = S.libDraft;
  msg('#lib-src-msg', 'reading ' + file.name + '…', 'busy');
  try {
    if (!st?.id) {
      st = await db.addStandard({
        title: $('#lib-title').value.trim() || file.name,
        kind: $('#lib-kind').value, text: '',
      });
      S.lib = [st, ...S.lib];
      S.libDraft = { ...st };
      $('#lib-title').value = st.title;
      $('#lib-del').hidden = false;
      $('#lib-add').hidden = false;
      renderLibrary();
    }
    const stored = await db.uploadStandardFile(st.id, file);
    const got = await engine.extract(file, (page, pages) => {
      msg('#lib-src-msg', file.name + ' — page ' + page + ' of ' + pages, 'busy');
    });
    const row = await db.updateStandard(st.id, {
      title: $('#lib-title').value.trim() || st.title,
      text: got.text || st.text || '',
      file_path: stored.path, file_name: stored.name,
      file_size: stored.size, file_mime: stored.mime,
    });
    const i = S.lib.findIndex((x) => x.id === row.id);
    if (i >= 0) S.lib[i] = row;
    S.libDraft = { ...row };
    $('#lib-text').value = row.text || '';
    $('#lib-chars').textContent = charsLine(row);
    paintLibFile(row);
    msg('#lib-src-msg', got.text
      ? (got.note || 'text taken from ' + file.name)
      : (got.note || 'the file is kept, but there is no text in it to read'),
      got.text ? 'ok' : '');
  } catch (err) {
    msg('#lib-src-msg', String(err.message || err).slice(0, 200), 'bad');
  }
}

function hideLibEditor() {
  S.libDraft = null;
  $('#lib-edit').hidden = true;
  $('#lib-new').hidden = false;
  $('#lib-list').hidden = false;
  msg('#lib-msg', '');
  renderLibrary();
}

async function openLibrary() {
  if (S.role !== 'owner') return toast('the library is yours alone');
  $('#lib-dialog').showModal();
  hideLibEditor();
  S.libShowBin = false;
  renderLibrary();
  try {
    await loadLibrary();
    renderLibrary();
  } catch (err) { msg('#lib-msg', err.message, 'bad'); }
}

$('#btn-from-lib').onclick = () => openLibrary();
$('#lib-x').onclick = () => $('#lib-dialog').close();
$('#lib-cancel').onclick = hideLibEditor;
$('#lib-new').onclick = () => showLibEditor(null);
$('#lib-fetch').onclick = () => fetchLaw($('#lib-url').value);
$('#lib-file-btn').onclick = () => $('#lib-file').click();
$('#lib-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  await readStandardFile(file);
});
$('#lib-text').addEventListener('input', () => {
  $('#lib-chars').textContent = charsLine({ text: $('#lib-text').value });
});

async function addFromLibrary(st) {
  if (!S.project) return toast('open a check first — a standard belongs to one');
  try {
    const row = await db.addArtifact(S.project.id, {
      kind: 'standard', title: st.title || 'a standard', text: st.text || '',
      from_standard: st.id,
    });
    S.artifacts.push(row);
    renderArtifacts();
    paintSpec();
    $('#lib-dialog').close();
    toast('“' + (st.title || 'the standard') + '” is in this check — the text is a copy');
  } catch (err) { msg('#lib-msg', err.message, 'bad'); }
}

$('#lib-add').onclick = async () => {
  const st = S.libDraft;
  if (!st?.id) return;
  /* what is on screen is what gets copied: a person who edited the text and
   * pressed add means the words they just wrote */
  const text = $('#lib-text').value;
  const title = $('#lib-title').value.trim();
  const source_url = $('#lib-url').value.trim() || null;
  if (text !== (st.text || '') || title !== (st.title || '') || source_url !== (st.source_url || null)) {
    try {
      const kept = await db.updateStandard(st.id, { text, title, kind: $('#lib-kind').value, source_url });
      const i = S.lib.findIndex((x) => x.id === kept.id);
      if (i >= 0) S.lib[i] = kept;
      S.libDraft = { ...kept };
    } catch (err) { return msg('#lib-msg', err.message, 'bad'); }
  }
  return addFromLibrary({ ...(S.libDraft || st), text, title });
};

$('#lib-save').onclick = async () => {
  const title = $('#lib-title').value.trim();
  const text = $('#lib-text').value;
  const kind = $('#lib-kind').value;
  if (!title) return msg('#lib-msg', 'a name first, so you can find it again', 'bad');
  if (!text.trim()) return msg('#lib-msg', 'and the text you are held to', 'bad');
  const btn = $('#lib-save');
  btn.disabled = true;
  msg('#lib-msg', 'keeping…', 'busy');
  try {
    const d = S.libDraft;
    const source_url = $('#lib-url').value.trim() || null;
    if (d?.id) {
      const row = await db.updateStandard(d.id, { title, text, kind, source_url });
      const i = S.lib.findIndex((x) => x.id === row.id);
      if (i >= 0) S.lib[i] = row;
      S.libDraft = { ...row };
      hideLibEditor();
      renderLibrary();
      toast('kept — press add to put it in this check');
    } else {
      const row = await db.addStandard({ title, text, kind, source_url });
      S.lib = [row, ...S.lib];
      hideLibEditor();
      renderLibrary();
      toast('kept — press add to put it in this check');
    }
  } catch (err) { msg('#lib-msg', err.message, 'bad'); }
  finally { btn.disabled = false; }
};

$('#lib-del').onclick = async () => {
  const d = S.libDraft;
  if (!d?.id) return;
  try {
    await db.binStandard(d.id);
    const gone = S.lib.find((x) => x.id === d.id);
    if (gone) S.libBin = [{ ...gone, deleted_at: new Date().toISOString() }, ...S.libBin];
    S.lib = S.lib.filter((x) => x.id !== d.id);
    hideLibEditor();
    renderLibrary();
    toast('“' + (gone?.title || 'the standard') + '” is in the bin');
  } catch (err) { msg('#lib-msg', err.message, 'bad'); }
};

$('#lib-list').addEventListener('click', async (e) => {
  const li = e.target.closest('.lib-item');
  if (!li) return;
  const st = (S.libShowBin ? S.libBin : S.lib).find((x) => x.id === li.dataset.id);
  if (!st) return;

  if (e.target.closest('.add')) return addFromLibrary(st);

  if (e.target.closest('.del')) {
    if (!S.libShowBin) {
      try {
        await db.binStandard(st.id);
        S.lib = S.lib.filter((x) => x.id !== st.id);
        S.libBin = [{ ...st, deleted_at: new Date().toISOString() }, ...S.libBin];
        renderLibrary();
        toast('“' + (st.title || 'the standard') + '” is in the bin');
      } catch (err) { msg('#lib-msg', err.message, 'bad'); }
      return;
    }
    /* a second press, in the bin, is the only one that destroys */
    try {
      await db.deleteStandard(st.id);
      S.libBin = S.libBin.filter((x) => x.id !== st.id);
      renderLibrary();
      toast('gone for good');
    } catch (err) { msg('#lib-msg', err.message, 'bad'); }
    return;
  }

  if (e.target.closest('.back')) {
    try {
      const row = await db.restoreStandard(st.id);
      S.libBin = S.libBin.filter((x) => x.id !== st.id);
      S.lib = [row, ...S.lib];
      /* taking the last one back leaves nothing to look at in the bin: go back
       * to the library, or the restored standard looks like it vanished */
      S.libShowBin = S.libBin.length > 0;
      renderLibrary();
      toast('back in the library');
    } catch (err) { msg('#lib-msg', err.message, 'bad'); }
    return;
  }

  if (e.target.closest('.name')) {
    if (S.libShowBin) return;
    showLibEditor(st);
  }
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

/* ── generate ─────────────────────────────────────────────────────── */
$('#gen').onsubmit = (e) => { e.preventDefault(); generate(); };
$('#btn-first-generate').onclick = () => generate();
$('#btn-add-target').onclick = () => addTargetRow();
$('#btn-run-all').onclick = () => runBatch();
$('#btn-stop').onclick = () => {
  STOP_BATCH = true;
  if (!S.batch) return;
  msg('#tgt-run-msg', 'stopping after the one in flight…', 'busy');
};
/* the row is a name you can change in place: no second dialog for one word */
$('#targets').addEventListener('click', async (e) => {
  const li = e.target.closest('.tgt');
  if (!li) return;
  const t = S.targets.find((x) => x.id === li.dataset.id);
  if (!t) return;
  if (e.target.closest('.tgt-del')) return binTargetRow(t);
  if (S.target !== t.id) await selectTarget(t.id);
});
$('#targets').addEventListener('change', async (e) => {
  const inp = e.target.closest('.tgt-name');
  if (!inp) return;
  const id = inp.closest('.tgt').dataset.id;
  const row = S.targets.find((x) => x.id === id);
  if (!row) return;
  const name = inp.value.trim();
  if (name === (row.name || '')) return;
  try {
    Object.assign(row, await db.updateTarget(id, { name }));
    if (S.target === id) paintNouns(templateById(S.project.template));
  } catch (err) { msg('#tgt-run-msg', 'could not rename it: ' + err.message, 'bad'); }
});
$('#ev-who').addEventListener('click', (e) => {
  if (!e.target.closest('.ev-clear')) return;
  if (S.targets.length) selectTarget(S.targets[0].id);
  else selectTarget(null);
});
$('#notes').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); }
});

function paintBusy(on, t0 = 0) {
  S.busy = on;
  $('#btn-generate').disabled = on;
  $('#btn-run-all').disabled = on || S.role === 'view' || !S.targets.length;
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
  /* what the model reads: the rules, and the proofs of the row on the desk */
  const pile = [...S.artifacts.filter((a) => a.kind === 'standard'), ...evRows()];
  if (!pile.length) {
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
    template: tpl, project: S.project, artifacts: pile, notes,
  });
  const promptNote = [
    `template: ${tpl.id}`,
    S.target ? `target: ${S.targets.find((t) => t.id === S.target)?.name || S.target}` : '',
    `inputs: ${pile.map((a) => a.title || a.kind).join(' · ')}`,
    notes ? `notes: ${notes}` : '',
  ].filter(Boolean).join('\n').slice(0, 8000);

  const t0 = Date.now();
  paintBusy(true, t0);
  let run = null;
  try {
    run = await db.startRun(S.project.id, {
      template: tpl.id, model: engine.modelName(), notes, prompt: promptNote,
      targetId: S.target,
    });
    const answer = await engine.callModel(messages);
    if (!answer || !answer.trim()) throw new Error('the model answered with nothing');
    await db.finishRun(run.id, { status: 'done', took_ms: Date.now() - t0 });
    const out = await db.addOutput(S.project.id, {
      run_id: run.id, kind: tpl.kind, title: tpl.out, body: answer, target_id: S.target,
    });
    S.outputs.unshift(out);
    S.current = out.id;
    /* a row that has a report has a tally: the list sorts by what was found */
    if (S.target) {
      const c = countVerdicts(answer);
      const row = S.targets.find((t) => t.id === S.target);
      try {
        const upd = await db.updateTarget(S.target, {
          status: 'done', n_pass: c.pass, n_fail: c.fail, n_unknown: c.unknown, error: '',
        });
        if (row) Object.assign(row, upd);
        paintTargets();
      } catch { /* the report is written; a tally that failed is not a lost report */ }
    }
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
  $('#guest-banner').textContent = guestLine({ thing: 'check', signedIn: !!S.session });
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
  parts.push('vpl · vc, a compliance desk: standards and evidence in, a report '
    + 'out that says PASS, FAIL or UNKNOWN for each line.');
  parts.push(S.project
    ? 'Job: ' + (S.project.title || S.project.name || 'untitled')
    : 'No job is open.');
  if (o) parts.push(`The document on the desk (${o.kind || 'doc'}):\n` + (o.body || ''));
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
mountNotice({ app: 'vc', column: ['#spec', '#welcome'] });
