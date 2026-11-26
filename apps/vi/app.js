/* vpl · vi — the funnel screen.
 *
 * One project is one funnel. Four numbered steps plus an optional context, and
 * a picture of the same thing underneath (the bands). Both navigate. Nothing
 * here is clever: the model writes a first pass, the person decides, and every
 * decision carries a reason.
 *
 * The database lives in lib/db.js. The model goes through our own origin
 * (/api/chat, then api.terg.hr) because model APIs send no CORS headers.
 */

import * as db from './lib/db.js';
import * as ai from './vendor/ai.js';
import * as who from './vendor/who.js';
import { mountDock, lastField, putInto } from './vendor/dock.js';
import { mountNotice } from './vendor/notices.js';
import { mountRail } from './vendor/rail.js';
import * as settings from './vendor/settings.js';
import * as engine from './vendor/engine.js';
import { prompts } from './prompts.js';
import { guestLine } from './vendor/words.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const COLORS = ['butter', 'rose', 'mint', 'sky'];
const TILT = ['-0.6deg', '0.4deg', '-0.3deg', '0.7deg'];

const S = {
  session: null,
  projects: [],
  project: null,
  ideas: [],
  stage: 'ideation',
  bin: [],         // notes in the recycle bin — the same rows, deleted
  showingBin: false,
  jobBin: false,   // the rail is showing binned funnels instead of live ones
  funnelsBinned: 0,
  pick: null,      // idea id being explored
  facts: {},       // idea id → the search results this session saw
  busy: false,
  role: 'owner',   // owner | edit | view — what this person may do here
  guest: null,     // a public link: no session, no writes, no rail
};

/* ── tiny helpers ─────────────────────────────────────────────────── */
const canWrite = () => S.role === 'owner' || S.role === 'edit';
const isOwner = () => S.role === 'owner';

async function guard() {
  if (canWrite()) return true;
  say($('.msg', $(`.panel[data-stage="${S.stage}"]`) || document.body), 'this funnel is shared read-only', 'bad');
  return false;
}
function say(el, text, state) {
  el.textContent = text || '';
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

function saveTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('vpl.theme', t); } catch {}
}

function toggleTheme() {
  const now = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  saveTheme(now);
}

/* The name in the corner is the suite's, not this app's (vendor/who.js):
 * the name Google gave us, else the address tidied, else a letter. */
function displayName(session) {
  return who.whoLabel(session);
}

/* Phones capitalise the first letter of a text field and computers do not, so
 * the same person types two different names. Names and addresses are compared
 * in lower case — the password is not touched, ever. */
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
  return t.includes('@') ? t.toLowerCase() : t.toLowerCase().replace(/\s+/g, '') + '@vpl.local';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── gate ─────────────────────────────────────────────────────────── */
async function boot() {
  wireAuth();
  lowerField($('#email'));
  const code = new URLSearchParams(location.search).get('s');
  if (code) {
    wireChrome();
    $('#gate').hidden = true;
    /* a link is readable without an account, but a signed-in reader may still
     * take a copy home — so ask who is here, and do not insist on an answer */
    S.session = await db.session().catch(() => null);
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
  $('#btn-out').onclick = async () => { await db.signOut(); location.reload(); };

  db.onAuthChange((s) => { if (!s) showGate(); });
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

/* ── entering the app ─────────────────────────────────────────────── */
async function enter() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = displayName(S.session);
  who.chip($('#who'));
  $('#who').title = S.session.user.email;
  wireChrome();
  await loadProjects();
}

/* Everything that reacts to a press. Wire it once, for a signed-in person and
 * for a guest alike — the role, not the wiring, decides what may happen. */
function wireChrome() {
  $('#btn-ai').onclick = openAiDialog;
  $('#btn-projects').onclick = () => $('#projects').classList.toggle('open');
  $('#btn-new').onclick = newProject;
  $('#btn-first').onclick = newProject;

  $('#proj-title').addEventListener('change', saveTitle);
  $('#proj-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $$('.step').forEach((b) => (b.onclick = () => setStage(b.dataset.stage)));
  $$('.band').forEach((b) => (b.onclick = () => setStage(b.dataset.stage)));
  $$('[data-next]').forEach((b) => (b.onclick = () => setStage(b.dataset.next)));

  $('#btn-bin').onclick = toggleBin;
$('#btn-bin-empty').onclick = emptyBin;

$('#note-form').addEventListener('submit', (e) => { e.preventDefault(); addNote(); });
  $('#notes-ai').onclick = notesWithAi;
  $('#ctx-save').onclick = saveContext;
  $('#ctx-formulate').onclick = formulateContext;
  $('#explore-save').onclick = saveExploration;
  $('#explore-ai').onclick = exploreWithAi;
  $('#explore-search').onclick = searchFacts;
  $('#sim-save').onclick = saveSimulation;
  $('#sim-ai').onclick = simulateWithAi;
  $('#pick-ai').onclick = suggestWithAi;

  wireAiDialog();
  wireShare();
  $('#btn-md').onclick = copyMarkdown;
  $('#btn-own').onclick = copyToMine;
  $('#ai-hint-open').onclick = openAiDialog;
  paintAiHint();
}

/* ── projects rail ────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    S.projects = await db.listProjects({ bin: S.jobBin });
    S.funnelsBinned = S.jobBin
      ? S.projects.length
      : await db.listProjects({ bin: true }).then((r) => r.length).catch(() => S.funnelsBinned || 0);
  } catch (e) {
    console.error(e);
    S.projects = [];
  }
  paintProjects();
  paintJobBin();
  // if the person already opened or made a funnel while this list was on its
  // way, that choice wins; the welcome screen must not appear over it.
  if (S.project) return;
  const last = sessionStorage.getItem('vi.project');
  const first = S.projects.find((p) => p.id === last) || S.projects[0];
  if (first) await openProject(first.id);
  else showWelcome();
}

function paintProjects() {
  const ul = $('#proj-list');
  ul.innerHTML = '';
  ul.classList.toggle('bin-mode', S.jobBin);
  S.projects.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'proj-row' + (S.project && p.id === S.project.id ? ' on' : '');
    if (S.jobBin) {
      /* a binned funnel has two doors and no pick: put it back, or end it. The
       * rows inside it are untouched, so a restore loses nothing. */
      li.innerHTML = `<span class="pick">${esc(p.title)}</span>
        <button class="row-restore" type="button" title="put it back">restore</button>
        <button class="kill" type="button" title="delete it for good">✕</button>`;
      li.querySelector('.row-restore').onclick = () => restoreProject(p);
      li.querySelector('.kill').onclick = () => purgeProject(p);
      ul.append(li);
      return;
    }
    li.innerHTML = `<button class="pick" type="button">${esc(p.title)}</button>
      <span class="n" title="ideas">·</span>
      <button class="kill" type="button" title="move this funnel to the recycle bin">✕</button>`;
    li.querySelector('.pick').onclick = () => openProject(p.id);
    li.querySelector('.kill').onclick = () => removeProject(p);
    ul.append(li);
  });
  $('#proj-none').hidden = S.projects.length > 0;
  $('#proj-none').textContent = S.jobBin
    ? 'nothing in the bin.'
    : 'no funnels yet. one project is one funnel.';
}

/* The rail's own bin: a switch with a count, a sentence inside the list, and an
 * emptying that says how many funnels it takes. */
function paintJobBin() {
  const btn = $('#btn-job-bin');
  const n = S.funnelsBinned || 0;
  btn.setAttribute('aria-pressed', String(S.jobBin));
  btn.classList.toggle('on', S.jobBin);
  btn.title = S.jobBin ? 'back to the funnels' : `funnels in the recycle bin (${n})`;
  $('#job-bin-count').textContent = n ? String(n) : '';
  $('#job-bin-banner').hidden = !S.jobBin;
  $('#job-bin-note').textContent = S.jobBin
    ? (n ? `${n} funnel${n === 1 ? '' : 's'} binned — restore one, or delete it for good`
         : 'nothing in it — a deleted funnel waits here')
    : '';
}

$('#btn-job-bin').onclick = async () => {
  S.jobBin = !S.jobBin;
  await loadProjects();
  if (!S.jobBin && !S.project && S.projects[0]) await openProject(S.projects[0].id);
};

async function restoreProject(p) {
  if (!isOwner()) return;
  await db.restoreProject(p.id);
  /* restoring leaves the bin and opens what came back: a funnel that returns
   * into a list nobody is looking at returned silently */
  S.jobBin = false;
  await loadProjects();
  await openProject(p.id).catch(() => {});
  say($('#notes-msg'), `“${p.title}” is back`, 'ok');
}

async function purgeProject(p) {
  if (!isOwner()) return;
  if (!confirm(`delete “${p.title}” and everything in it, for good?`)) return;
  await db.deleteProject(p.id);
  await loadProjects();
}

async function newProject() {
  if (!isOwner()) return;
  const p = await db.createProject();
  S.projects.unshift(p);
  await openProject(p.id);
  const t = $('#proj-title');
  t.focus();
  t.select();
}

/* ✕ is not "delete". A funnel holds the whole funnel's words, so it goes to the
 * rail's bin and the list keeps the way back — the same promise the notes get. */
async function removeProject(p) {
  if (!isOwner()) return;
  await db.binProject(p.id);
  if (S.project && S.project.id === p.id) S.project = null;
  await loadProjects();
  if (!S.project && S.projects[0]) await openProject(S.projects[0].id);
  else if (!S.project) showWelcome();
  say($('#notes-msg'), `“${p.title}” is in the recycle bin`, 'ok');
}

/* One attribute, one place: CSS hides what this person may not press, and the
 * painters still add .o-only to the buttons they build themselves. */
function applyRole() {
  document.body.dataset.role = S.role;
  document.body.classList.toggle('guest', !!S.guest);
  $('#btn-out').hidden = !!S.guest;   // a guest was never signed in
  // a reader has no model, so the "set a key" hint is not their business
  const hint = $('#ai-hint');
  if (hint && S.role === 'view') hint.hidden = true;
  const banner = $('#guest-banner');
  if (S.guest) {
    banner.hidden = false;
    banner.textContent = guestLine({ thing: 'funnel', signedIn: !!S.session });
  } else {
    banner.hidden = true;
    if (S.role === 'view') {
      banner.hidden = false;
      banner.textContent = guestLine({ thing: 'funnel', signedIn: true });
    } else if (S.role === 'edit') {
      banner.hidden = false;
      banner.textContent = guestLine({ thing: 'funnel', role: 'edit', signedIn: true });
    }
  }
  /* a guest has no rail; everybody else does, including a reader who has just
   * taken a copy home and is no longer a guest at all */
  $('#projects').hidden = !!S.guest;
  $('#btn-projects').hidden = !!S.guest;
  $('#proj-title').readOnly = S.role !== 'owner';
  $('#btn-share').hidden = S.role !== 'owner';
  /* the copy is the honest answer to "I was given this funnel and I disagree
   * with it": a copy needs an account to land in, the original is untouched */
  const own = $('#btn-own');
  if (own) own.hidden = S.role === 'owner' || !S.session;
}

function showWelcome() {
  $('#funnel').hidden = true;
  $('#welcome').hidden = false;
}

async function openProject(id) {
  const p = S.projects.find((x) => x.id === id) || (await db.listProjects()).find((x) => x.id === id);
  if (!p) return showWelcome();
  S.project = p;
  sessionStorage.setItem('vi.project', id);
  $('#welcome').hidden = true;
  $('#funnel').hidden = false;
  $('#proj-title').value = p.title;
  $('#ctx-text').value = p.context || '';
  $('#sim-text').value = p.simulation || '';
  paintProjects();
  S.role = (await db.roleOn(p)) || 'owner';
  applyRole();
  await loadIdeas();
  setStage(defaultStage());
  $('#projects').classList.remove('open');
}

function defaultStage() {
  if (!S.ideas.length) return 'ideation';
  if (!S.ideas.some((i) => i.stage === 'selected')) {
    return S.ideas.some((i) => i.exploration) ? 'selection' : 'exploration';
  }
  return S.project.simulation ? 'simulation' : 'exploration';
}

/* ── ideas ────────────────────────────────────────────────────────── */
async function loadIdeas() {
  S.ideas = await db.listIdeas(S.project.id);
  S.bin = canWrite() ? await db.listIdeas(S.project.id, { bin: true }).catch(() => []) : [];
  S.pick = (S.ideas.find((i) => i.id === (S.pick || ''))
    || S.ideas.find((i) => i.stage === 'selected')
    || S.ideas.find((i) => i.exploration)
    || S.ideas[0] || {}).id || null;
  paintAll();
}

const total = () => S.ideas.length;
const explored = () => S.ideas.filter((i) => i.exploration && i.exploration.trim());
const chosen = () => S.ideas.find((i) => i.stage === 'selected') || null;
const parked = () => S.ideas.filter((i) => i.stage === 'parked');
const working = () => S.ideas.filter((i) => i.stage === 'ideation' || i.stage === 'selected');

function paintAll() {
  paintMeta();
  paintSteps();
  paintBands();
  paintNotes();
  paintExplore();
  paintSelect();
  paintSim();
  paintParked();
}

/* ── taking a funnel with you ─────────────────────────────────────── */

const STAGE_NAMES = [
  ['selected', 'chosen'],
  ['ideation', 'ideation'],
  ['exploration', 'exploration'],
  ['simulation', 'simulation'],
  ['selection', 'selection'],
  ['parked', 'parked'],
];

/* A funnel is not markdown, so the writer has to decide what a funnel *is* when
 * it is written down: the question, then each band, then the choice first. */
function funnelMarkdown() {
  const p = S.project || {};
  const out = [`# ${(p.title || 'untitled funnel').trim()}`, ''];
  if (p.context?.trim()) out.push(p.context.trim(), '');
  if (p.exploration?.trim()) out.push('## what we found', '', p.exploration.trim(), '');
  if (p.simulation?.trim()) out.push('## what it would cost', '', p.simulation.trim(), '');

  for (const [stage, name] of STAGE_NAMES) {
    const list = S.ideas.filter((i) => (stage === 'selected' ? i.stage === 'selected' : i.stage === stage));
    if (!list.length) continue;
    out.push(`## ${name}`, '');
    for (const i of list) {
      const text = (i.text || '').trim().replace(/\n+/g, ' ');
      out.push(`- ${stage === 'selected' ? '**' + text + '**' : text}${i.reason?.trim() ? ' — ' + i.reason.trim() : ''}`);
      if (i.exploration?.trim()) out.push(`  ${i.exploration.trim().replace(/\n+/g, ' ')}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function copyMarkdown() {
  const btn = $('#btn-md');
  const was = btn.textContent;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(funnelMarkdown());
    else throw new Error('no clipboard here');
    btn.textContent = 'copied';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1500);
  } catch {
    say($('#proj-meta'), 'the clipboard said no — the funnel can still be selected and copied by hand', 'bad');
  }
}

async function copyToMine() {
  const btn = $('#btn-own');
  if (!S.session) return say($('#proj-meta'), 'sign in first — a copy needs an owner', 'bad');
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'copying…';
  try {
    const made = await db.copyToMe({
      title: S.project.title,
      context: S.project.context,
      exploration: S.project.exploration,
      simulation: S.project.simulation,
      chosen_id: S.project.chosen_id,
    }, S.ideas);
    /* the copy is not the shared funnel: drop the guest mode and the code from
     * the address, or the reader stays locked out of their own rail */
    S.guest = null;
    history.replaceState(null, '', location.pathname);
    await loadProjects();
    await openProject(made.id);
    say($('#proj-meta'), 'this funnel is yours now.', 'ok');
  } catch (e) {
    say($('#proj-meta'), e.message || String(e), 'bad');
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = was; }, 1500);
  }
}

function paintMeta() {
  $('#proj-meta').textContent = [
    `${total()} idea${total() === 1 ? '' : 's'}`,
    `${explored().length} explored`,
    chosen() ? `chosen: ${chosen().text}` : 'nothing chosen yet',
  ].join(' · ');
}

function paintSteps() {
  const done = {
    ideation: total() > 0,
    exploration: explored().length > 0,
    selection: !!chosen(),
    simulation: !!(S.project.simulation || '').trim(),
    context: !!(S.project.context || '').trim(),
  };
  $$('.step').forEach((b) => {
    const st = b.dataset.stage;
    b.classList.toggle('on', st === S.stage);
    b.classList.toggle('done', !!done[st] && st !== S.stage);
  });
  $$('.band').forEach((b) => b.classList.toggle('here', b.dataset.stage === S.stage));
}

function paintBands() {
  const n = {
    ideation: total(),
    exploration: explored().length,
    selection: chosen() ? 1 : 0,
    simulation: (S.project.simulation || '').trim() ? 1 : 0,
  };
  Object.entries(n).forEach(([k, v]) => { const el = $('#band-' + k); if (el) el.textContent = v; });
}

/* ── stage switching ──────────────────────────────────────────────── */
function setStage(stage) {
  S.stage = stage;
  $$('.panel').forEach((p) => (p.hidden = p.dataset.stage !== stage));
  paintSteps();
  const t = { context: '#ctx-text', ideation: '#note-input', exploration: '#explore-text', selection: '#pick-reason', simulation: '#sim-text' }[stage];
  if (window.innerWidth > 740 && stage !== 'ideation') $(t)?.focus({ preventScroll: true });
}

/* ── the balloon ──────────────────────────────────────────────────
 * The model never writes into a field silently. It says something in a balloon,
 * and the person either takes it or drops it. That is the whole etiquette. */
function clearBubble(stage) {
  $$(`.panel[data-stage="${stage}"] .bubble`).forEach((b) => b.remove());
}

function bubble(stage, { text, label, onUse, links = [], busy = false }) {
  const panel = $(`.panel[data-stage="${stage}"]`);
  if (!panel) return null;
  clearBubble(stage);
  const b = document.createElement('div');
  b.className = 'bubble' + (busy ? ' bubble-busy' : '');
  const p = document.createElement('p');
  p.className = 'bubble-text';
  p.textContent = text;
  b.append(p);
  links.forEach((l) => {
    const a = document.createElement('a');
    a.className = 'bubble-src';
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    let host = '';
    try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch {}
    a.textContent = (l.title || l.url) + (host ? ` — ${host}` : '');
    b.append(a);
  });
  if (label) {
    const row = document.createElement('div');
    row.className = 'bubble-act';
    const use = document.createElement('button');
    use.type = 'button'; use.className = 'primary'; use.textContent = label;
    use.onclick = async () => {
      try { await onUse(text, links); b.remove(); } catch (e) { say($('.msg', panel), e.message, 'bad'); }
    };
    const drop = document.createElement('button');
    drop.type = 'button'; drop.className = 'ghost'; drop.textContent = 'drop';
    drop.onclick = () => b.remove();
    row.append(use, drop);
    b.append(row);
  }
  const head = panel.querySelector('.panel-head');
  head ? head.after(b) : panel.prepend(b);
  return b;
}

/* ── context ──────────────────────────────────────────────────────── */
async function saveContext() {
  if (!canWrite()) return;
  const msg = $('#ctx-msg');
  const context = $('#ctx-text').value;
  try {
    S.project = await db.updateProject(S.project.id, { context });
    say(msg, 'saved', 'ok');
    paintSteps();
  } catch (e) { say(msg, e.message, 'bad'); }
}

async function formulateContext() {
  if (!canWrite()) return;
  const msg = $('#ctx-msg');
  const raw = $('#ctx-text').value.trim();
  if (!raw) return say(msg, 'write a pile of words first, then formulate', 'bad');
  bubble('context', { text: 'reading your notes', busy: true });
  try {
    const out = (await ask(prompts.context(raw))).trim();
    bubble('context', {
      text: out,
      label: 'use these sentences',
      onUse: (t) => { $('#ctx-text').value = t; say(msg, 'fix it by hand, then save', 'ok'); },
    });
  } catch (e) { clearBubble('context'); say(msg, e.message, 'bad'); }
}

/* ── ideation ─────────────────────────────────────────────────────── */
function paintNotes() {
  const ul = $('#notes');
  ul.innerHTML = '';
  ul.classList.toggle('bin-mode', S.showingBin);
  const list = S.showingBin ? S.bin : working();
  paintBin();
  list.forEach((n, i) => {
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.color = n.color || COLORS[i % COLORS.length];
    li.style.setProperty('--tilt', TILT[i % TILT.length]);
    if (S.showingBin) {
      li.classList.add('in-bin');
      li.innerHTML = `<span>${esc(n.text)}</span>
        <button class="row-restore" type="button" title="put it back on the wall">restore</button>
        <button class="kill" type="button" title="delete it for good">✕</button>`;
      li.querySelector('.row-restore').onclick = () => restoreNote(n);
      li.querySelector('.kill').onclick = () => purgeNote(n);
      ul.append(li);
      return;
    }
    li.innerHTML = `<span>${esc(n.text)}</span>
      ${n.stage === 'selected' ? '<span class="note-flag">chosen</span>' : ''}
      <button class="go" type="button" title="explore this one">explore</button>
      <button class="kill o-only" type="button" title="move this note to the recycle bin">✕</button>`;
    li.querySelector('.kill').onclick = () => killNote(n);
    li.querySelector('.go').onclick = () => { S.pick = n.id; setStage('exploration'); paintExplore(); };
    ul.append(li);
  });
  $('#notes-none').hidden = list.length > 0;
  $('#notes-none').textContent = S.showingBin
    ? (S.bin.length ? '' : 'the recycle bin is empty — a deleted note waits here')
    : 'nothing on the wall yet.';
}

/* The bin is one button under the wall: it opens, it says how many are inside,
 * and while it is open the wall is a different place in four ways at once. */
function paintBin() {
  const n = S.bin.length;
  const btn = $('#btn-bin');
  /* a chip in the rail, so it carries a word and a number and not a sentence:
   * the banner inside the list names the place once you are in it */
  btn.hidden = !S.project;
  /* vi calls the state showingBin — one name per app, and the chip reads it */
  btn.classList.toggle('on', S.showingBin);
  btn.setAttribute('aria-pressed', String(S.showingBin));
  btn.title = S.showingBin ? 'close the recycle bin and go back to the wall'
    : n ? `the recycle bin of notes (${n})` : 'the recycle bin of notes is empty';
  btn.setAttribute('aria-label', btn.title);
  $('#bin-count').textContent = n ? String(n) : '';
  $('#bin-banner').hidden = !S.showingBin;
  $('#bin-banner-note').textContent = n
    ? `${n} note${n === 1 ? '' : 's'} in the bin — restore one, or delete it for good`
    : 'nothing in it — a removed note waits here';
  $('#btn-bin-empty').hidden = !S.showingBin || !n;
}


/* Opening the bin from halfway down a long list showed a tinted list and
 * nothing else: the banner that names the place was above the fold. The place
 * announces itself when you enter it. */
function scrollBinIntoView() {
  requestAnimationFrame(() => {
    const b = document.querySelector('.bin-banner, .trash-banner, #binview .bin-banner');
    if (b) b.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

function toggleBin() {
  if (!canWrite()) return;
  S.showingBin = !S.showingBin;
  S.stage = 'ideation';
  paintAll();
  if (S.showingBin) scrollBinIntoView();
}

async function restoreNote(n) {
  try {
    await db.restoreIdea(n.id);
    S.ideas.push({ ...n, deleted_at: null });
    S.bin = S.bin.filter((x) => x.id !== n.id);
    paintAll();
    say($('#notes-msg'), `“${n.text.slice(0, 24)}…” is back on the wall`, 'ok');
  } catch (e) { say($('#notes-msg'), e.message, 'bad'); }
}

async function purgeNote(n) {
  try {
    await db.deleteIdea(n.id);
    S.bin = S.bin.filter((x) => x.id !== n.id);
    paintAll();
  } catch (e) { say($('#notes-msg'), e.message, 'bad'); }
}

async function emptyBin() {
  if (!S.bin.length) return;
  const n = S.bin.length;
  try {
    await db.emptyBin(S.project.id);
    S.bin = [];
    paintAll();
    say($('#notes-msg'), `${n} note${n === 1 ? '' : 's'} deleted for good`, 'ok');
  } catch (e) { say($('#notes-msg'), e.message, 'bad'); }
}

async function addNote() {
  if (!canWrite()) return;
  const input = $('#note-input');
  const text = input.value.trim();
  if (!text) return;
  const msg = $('#notes-msg');
  const color = COLORS[total() % COLORS.length];
  try {
    const row = await db.addIdea(S.project.id, text, color);
    S.ideas.push(row);
    input.value = '';
    input.focus();
    say(msg, '', '');
    paintAll();
  } catch (e) { say(msg, e.message, 'bad'); }
}

/* ✕ is not "delete": the note goes to the bin, with its words, and the message
 * says where it went — a person should never wonder what just happened. */
async function killNote(n) {
  if (!canWrite()) return;
  try {
    await db.binIdea(n.id);
    S.ideas = S.ideas.filter((x) => x.id !== n.id);
    S.bin = [{ ...n, deleted_at: new Date().toISOString() }, ...S.bin];
    if (S.pick === n.id) S.pick = null;
    paintAll();
    say($('#notes-msg'), `“${n.text.slice(0, 24)}…” is in the recycle bin`, 'ok');
  } catch (e) { say($('#notes-msg'), e.message, 'bad'); }
}

async function notesWithAi() {
  if (!canWrite()) return;
  const msg = $('#notes-msg');
  bubble('ideation', { text: 'thinking of a few', busy: true });
  try {
    const out = await ask(prompts.ideate(S.project.title, S.project.context,
      working().map((i) => i.text)));
    const lines = out.split('\n').map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter((l) => l.length > 3).slice(0, 8);
    if (!lines.length) throw new Error('the model returned nothing usable');
    bubble('ideation', {
      text: lines.map((l, i) => `${i + 1}. ${l}`).join('\n'),
      label: `put ${lines.length} on the wall`,
      onUse: async () => {
        const rows = await db.addIdeas(S.project.id, lines, (i) => COLORS[(total() + i) % COLORS.length]);
        S.ideas.push(...rows);
        say(msg, `${rows.length} notes added — delete what does not fit`, 'ok');
        paintAll();
      },
    });
  } catch (e) { clearBubble('ideation'); say(msg, e.message, 'bad'); }
}

/* ── exploration ──────────────────────────────────────────────────── */
function paintExplore() {
  const picks = $('#explore-pick');
  picks.innerHTML = '';
  const list = working();
  $('#explore-none').hidden = list.length > 0;
  $('#explore-work').hidden = !S.pick;
  list.forEach((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-btn' + (n.id === S.pick ? ' on' : '') + (n.exploration ? ' done' : '');
    b.textContent = n.text;
    b.onclick = () => { S.pick = n.id; paintExplore(); };
    picks.append(b);
  });
  let n = S.ideas.find((i) => i.id === S.pick);
  if (!n || n.stage === 'parked') {
    n = list[0] || null;
    S.pick = n ? n.id : null;
    $('#explore-work').hidden = !n;
    if (n) { S.pick = n.id; paintExplore(); return; }
  }
  if (!n) return;
  $('#explore-who').textContent = n.exploration
    ? `exploring: ${n.text} · a draft from ${new Date(n.explored_at || n.updated_at).toLocaleDateString()}`
    : `exploring: ${n.text}`;
  $('#explore-text').value = n.exploration || '';
}

async function saveExploration() {
  if (!canWrite()) return;
  const msg = $('#explore-msg');
  const n = S.ideas.find((i) => i.id === S.pick);
  if (!n) return;
  const exploration = $('#explore-text').value;
  try {
    const row = await db.updateIdea(n.id, { exploration, explored_at: new Date().toISOString() });
    Object.assign(n, row);
    say(msg, 'saved', 'ok');
    paintAll();
  } catch (e) { say(msg, e.message, 'bad'); }
}

async function exploreWithAi() {
  if (!canWrite()) return;
  const msg = $('#explore-msg');
  const n = S.ideas.find((i) => i.id === S.pick);
  if (!n) return;
  const hasSearch = !!(searchCfg().key && searchCfg().provider);
  bubble('exploration', {
    text: hasSearch ? 'looking for facts first' : 'sketching the business',
    busy: true,
  });
  try {
    // Evidence before prose: the model gets real results and may not invent a
    // figure that is not in them. If search is not configured, it still works —
    // every number is then an [assumption], which is the honest answer.
    let facts = [];
    if (hasSearch) {
      try {
        facts = await lookupFacts(n, factQuery(n));
        bubble('exploration', {
          text: facts.length ? `${facts.length} sources found, sketching on them` : 'nothing found, sketching on assumptions',
          busy: true,
        });
      } catch (e) {
        say(msg, `search said: ${e.message.slice(0, 80)} — sketching on assumptions`, 'bad');
      }
    }
    const out = (await ask(prompts.explore(n.text, S.project.context, n.exploration, facts))).trim();
    bubble('exploration', {
      text: out,
      links: facts.map((f) => ({ title: f.title, url: f.url })),
      label: 'use as draft',
      onUse: (t) => {
        const ta = $('#explore-text');
        ta.value = (n.exploration ? n.exploration.trim() + '\n\n' : '') + t;
        say(msg, 'keep what is true, cut the rest, then save', 'ok');
      },
    });
  } catch (e) { clearBubble('exploration'); say(msg, e.message, 'bad'); }
}

/* ── selection ────────────────────────────────────────────────────── */
function paintSelect() {
  const box = $('#pick-list');
  box.innerHTML = '';
  const list = explored().filter((i) => i.stage !== 'parked');
  $('#pick-none').hidden = list.length > 0;
  list.forEach((n, i) => {
    const c = document.createElement('div');
    c.className = 'pick-card' + (n.stage === 'selected' ? ' on' : '');
    c.innerHTML = `<span class="num">${n.stage === 'selected' ? '✓' : i + 1}</span>
      <div><h3>${esc(n.text)}</h3><p>${esc((n.exploration || '').slice(0, 260))}</p></div>
      <button type="button" class="${n.stage === 'selected' ? 'ghost' : 'primary'} o-only">${n.stage === 'selected' ? 'chosen' : 'choose'}</button>`;
    c.querySelector('button').onclick = () => choose(n);
    box.append(c);
  });

  const c = chosen();
  $('#chosen').hidden = !c;
  if (c) {
    $('#chosen').innerHTML = `<h3>the one: ${esc(c.text)}</h3>
      <p>${esc(c.reason || 'no reason written yet — say why in one line, or you will forget.')}</p>
      <p class="muted">${parked().length} parked · next: simulate</p>`;
  }
}

async function choose(n) {
  if (!isOwner()) return;
  const reason = $('#pick-reason').value.trim();
  try {
    const old = chosen();
    if (old && old.id !== n.id) {
      const r = await db.updateIdea(old.id, { stage: 'parked', reason: old.reason || 'replaced this round' });
      Object.assign(old, r);
    }
    const row = await db.updateIdea(n.id, { stage: 'selected', reason: reason || '' });
    Object.assign(n, row);
    // everything else that was explored is now parked, with a reason, not deleted
    const rest = S.ideas.filter((i) => i.id !== n.id && i.stage !== 'selected' && i.stage !== 'parked' && i.exploration);
    for (const o of rest) {
      Object.assign(o, await db.updateIdea(o.id, { stage: 'parked', reason: o.reason || 'not chosen this round' }));
    }
    // open the box so nobody wonders where the other ideas went
    if (rest.length) $('#parked-box').open = true;
    S.project = await db.updateProject(S.project.id, { chosen_id: n.id });
    $('#pick-reason').value = '';
    say($('#pick-none'), '', '');
    paintAll();
    setStage('simulation');
  } catch (e) {
    console.error(e);
    say($('#sim-msg'), e.message, 'bad');
  }
}

/* Models are asked for `pick: …` and `why: …` and half the time answer with a
 * paragraph. So the answer is read, not parsed: the words of a real candidate
 * make the pick, whatever the shape of the reply. */
function pickOut(out, list) {
  const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const cands = list.map((i) => ({ i, n: norm(i.text) })).sort((a, b) => b.n.length - a.n.length);
  const lines = out.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  let idea = null;
  let why = '';
  // 1. a line that begins with a candidate's own words, from the bottom up
  for (let k = lines.length - 1; k >= 0 && !idea; k--) {
    const hit = cands.find((c) => norm(lines[k]).startsWith(c.n));
    if (hit) { idea = hit.i; why = lines.slice(k + 1).join(' '); }
  }
  // 2. labelled anyway
  if (!idea) {
    const m = out.match(/pick:\s*(.+)/i);
    if (m) {
      const hit = cands.find((c) => norm(m[1]).includes(c.n) || c.n.includes(norm(m[1])));
      if (hit) { idea = hit.i; why = (out.match(/why:\s*([\s\S]+)/i) || [])[1] || ''; }
    }
  }
  // 3. only one candidate mentioned at all
  if (!idea) {
    const seen = cands.filter((c) => norm(out).includes(c.n));
    if (seen.length === 1) idea = seen[0].i;
  }
  why = why.replace(/^(why|because)\s*:?\s*/i, '').replace(/^["“]|["”]$/g, '').trim();
  if (!why) why = lines.map((l) => l.replace(/^["“]|["”]$/g, ''))
    .filter((l) => !cands.some((c) => norm(l).startsWith(c.n))).sort((a, b) => b.length - a.length)[0] || '';
  return { idea, why };
}

async function suggestWithAi() {
  if (!canWrite()) return;
  const list = explored().filter((i) => i.stage !== 'parked');
  if (list.length < 2) return say($('#notes-msg'), 'explore at least two ideas first', 'bad');
  bubble('selection', { text: 'weighing the two', busy: true });
  try {
    const out = await ask(prompts.select(list));
    const best = pickOut(out, list);
    bubble('selection', {
      text: `${best.idea ? best.idea.text : 'no clear pick'}\n\n${best.why || 'the model gave no reason — ask it again, or write your own'}`,
      label: 'use this reason',
      onUse: () => {
        if (best.why) $('#pick-reason').value = best.why.slice(0, 200);
        if (best.idea) { S.pick = best.idea.id; paintSelect(); }
      },
    });
  } catch (e) { clearBubble('selection'); say($('#pick-reason'), e.message.slice(0, 90), 'bad'); }
}

/* ── simulation ───────────────────────────────────────────────────── */
function paintSim() {
  const c = chosen();
  $('#sim-who').textContent = c
    ? `simulating: ${c.text}`
    : 'nothing chosen yet — select one first, or write freely below.';
}

async function saveSimulation() {
  if (!canWrite()) return;
  const msg = $('#sim-msg');
  try {
    S.project = await db.updateProject(S.project.id, { simulation: $('#sim-text').value });
    say(msg, 'saved', 'ok');
    paintSteps(); paintBands();
  } catch (e) { say(msg, e.message, 'bad'); }
}

async function simulateWithAi() {
  if (!canWrite()) return;
  const msg = $('#sim-msg');
  const c = chosen();
  bubble('simulation', { text: 'sketching the tests', busy: true });
  try {
    const out = (await ask(prompts.simulate(c, S.project.context, $('#sim-text').value))).trim();
    bubble('simulation', {
      text: out,
      label: 'use as draft',
      onUse: (t) => {
        const ta = $('#sim-text');
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + t;
        say(msg, 'cut what you cannot test, then save', 'ok');
      },
    });
  } catch (e) { clearBubble('simulation'); say(msg, e.message, 'bad'); }
}

/* ── parked box ───────────────────────────────────────────────────── */
function paintParked() {
  const list = parked();
  $('#parked-n').textContent = list.length;
  const ul = $('#parked-list');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li class="parked-empty">nothing parked. ideas land here when you choose another.</li>';
    return;
  }
  list.forEach((n) => {
    const li = document.createElement('li');
    const hasChosen = !!chosen();
    li.innerHTML = `<div><div class="t">${esc(n.text)}</div>
        <input class="r" type="text" value="${esc(n.reason)}" placeholder="why not now" aria-label="reason"></div>
      <div class="acts o-only">
        <button type="button" class="ghost" data-a="restore">restore</button>
        ${hasChosen ? '<button type="button" class="ghost" data-a="swap">swap</button>' : ''}
      </div>`;
    li.querySelector('.r').addEventListener('change', (e) => setReason(n, e.target.value));
    li.querySelector('[data-a="restore"]').onclick = () => restore(n);
    const sw = li.querySelector('[data-a="swap"]');
    if (sw) sw.onclick = () => swap(n);
    ul.append(li);
  });
}

async function setReason(n, reason) {
  if (!isOwner()) return;
  try {
    const row = await db.updateIdea(n.id, { reason });
    Object.assign(n, row);
    paintSelect();
  } catch (e) { console.error(e); }
}

async function restore(n) {
  if (!isOwner()) return;
  try {
    const row = await db.updateIdea(n.id, { stage: 'ideation', reason: '' });
    Object.assign(n, row);
    paintAll();
    setStage('ideation');
  } catch (e) { console.error(e); }
}

async function swap(n) {
  if (!isOwner()) return;
  const c = chosen();
  if (!c) return;
  try {
    const a = await db.updateIdea(c.id, { stage: 'parked', reason: c.reason || 'swapped out' });
    Object.assign(c, a);
    // a parking reason does not carry over: it answered "why not now", and the
    // answer to "why this one" is a different sentence
    const b = await db.updateIdea(n.id, { stage: 'selected', reason: '' });
    Object.assign(n, b);
    S.project = await db.updateProject(S.project.id, { chosen_id: n.id });
    paintAll();
  } catch (e) { console.error(e); }
}

/* ── evidence: one query, a few results with sources ──────────────── */
const SHARED_SEARCH = ((window.__VPL_CONFIG__ || {}).search || '').replace(/\/$/, '');

function searchCfg() { return ai.readSearch(); }

/* One query, two to four results with sources. Returns rows, throws with a
 * sentence a person can act on. The key travels in the body and is never kept
 * anywhere but this browser. */
function factQuery(n) {
  return [n.text, (S.project.context || '').split(/[·.]/)[0]].filter(Boolean).join(' — ').slice(0, 240);
}

async function lookupFacts(n, query) {
  const c = searchCfg();
  if (!c.key || !c.provider) return [];
  const body = JSON.stringify({ provider: c.provider, key: c.key, query, results: 4 });
  let res = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(SHARED_SEARCH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error((data && (data.error?.message || data.error)) || text.slice(0, 160) || 'search failed');
  const rows = ((data && data.results) || []).map((r) => {
    let host = '';
    try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return { ...r, host };
  });
  S.facts[n.id] = rows;
  return rows;
}

async function searchFacts() {
  if (!canWrite()) return;
  const msg = $('#explore-msg');
  const n = S.ideas.find((i) => i.id === S.pick);
  if (!n) return;
  const c = searchCfg();
  if (!c.key || !c.provider) {
    openAiDialog();
    SET?.say?.('add a search key below — one per browser', 'bad');
    return;
  }
  const query = factQuery(n);
  bubble('exploration', { text: `searching: ${query}`, busy: true });
  try {
    const rows = await lookupFacts(n, query);
    if (!rows.length) throw new Error('nothing found for that wording');
    const lines = rows.map((r) => `— ${(r.snippet || '').replace(/\s+/g, ' ').slice(0, 190)} (${r.host})`);
    bubble('exploration', {
      text: lines.join('\n'),
      links: rows.map((r) => ({ title: r.title, url: r.url })),
      label: 'add as facts',
      onUse: () => {
        const ta = $('#explore-text');
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + lines.join('\n') + '\n';
        say(msg, 'facts with a source — now say what they mean', 'ok');
      },
    });
  } catch (e) { clearBubble('exploration'); say(msg, e.message, 'bad'); }
}

/* ── sharing ──────────────────────────────────────────────────────── */
function shareLink(row) {
  return `${location.origin}${location.pathname}?s=${row.code}`;
}

async function paintShares() {
  const ul = $('#share-list');
  ul.innerHTML = '';
  if (!S.project) return;
  const rows = await db.listShares(S.project.id);
  const link = rows.find((r) => r.code);
  $('#share-link').value = link ? shareLink(link) : '';
  $('#share-make').textContent = link ? 'new link' : 'make link';
  $('#share-copy').disabled = !link;
  rows.forEach((r) => {
    const li = document.createElement('li');
    const who = r.code ? 'anyone with the link' : r.email;
    li.innerHTML = `<span class="who">${esc(who)}</span>
      <span class="role">${r.code ? 'read' : r.role}</span>
      <button class="ghost" type="button">revoke</button>`;
    li.querySelector('button').onclick = async () => {
      await db.revokeShare(r.id);
      say($('#share-msg'), 'revoked', 'ok');
      paintShares();
    };
    ul.append(li);
  });
  if (!rows.length) ul.innerHTML = '<li class="muted">not shared with anyone yet.</li>';
}

function openShare() {
  if (!isOwner()) return;
  say($('#share-msg'), '');
  $('#share-email').value = '';
  $('#share-link').value = '';
  paintShares().catch((e) => say($('#share-msg'), e.message, 'bad'));
  $('#share-dialog').showModal();
}

function wireShare() {
  $('#btn-share').onclick = openShare;
  $('#share-x').onclick = () => $('#share-dialog').close();
  $('#share-make').onclick = async () => {
    try {
      const rows = await db.listShares(S.project.id);
      const old = rows.find((r) => r.code);
      if (old) await db.revokeShare(old.id);
      const row = await db.makeLink(S.project.id);
      $('#share-link').value = shareLink(row);
      say($('#share-msg'), 'link ready — copy it, anyone with it can read', 'ok');
      paintShares();
    } catch (e) { say($('#share-msg'), e.message, 'bad'); }
  };
  $('#share-copy').onclick = async () => {
    const v = $('#share-link').value;
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      say($('#share-msg'), 'copied', 'ok');
    } catch {
      $('#share-link').select();
      say($('#share-msg'), 'press ⌘C / Ctrl+C — it is selected', 'ok');
    }
  };
  $('#share-add').onclick = async () => {
    const email = $('#share-email').value.trim().toLowerCase();
    if (!email) return say($('#share-msg'), 'an address, please', 'bad');
    try {
      await db.shareWith(S.project.id, email, $('#share-role').value);
      say($('#share-msg'), `shared with ${email}`, 'ok');
      $('#share-email').value = '';
      paintShares();
    } catch (e) { say($('#share-msg'), e.message, 'bad'); }
  };
}

/* A public link: the funnel is fetched by its code, no session, no rail, no
 * writes. It is the same screen with every verb hidden by applyRole(). */
async function enterGuest(code) {
  const rows = await db.readShare(code).catch(() => []);
  if (!rows.length) {
    $('#gate').hidden = false;
    return say($('#gate-msg'), 'that link leads nowhere — ask for a fresh one', 'bad');
  }
  const p = rows[0];
  S.guest = code;
  S.role = 'view';
  S.project = {
    id: p.project_id, title: p.title, context: p.context, exploration: p.exploration,
    simulation: p.simulation, chosen_id: p.chosen_id, user_id: null,
  };
  S.ideas = rows.filter((r) => r.idea_id).map((r) => ({
    id: r.idea_id, text: r.idea_text, stage: r.stage, color: r.color, reason: r.reason,
    exploration: r.idea_exploration, position: r.position, project_id: p.project_id,
  }));
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = 'guest';
  who.chip($('#who'));
  $('#who').title = '';
  $('#welcome').hidden = true;
  $('#funnel').hidden = false;
  $('#proj-title').value = p.title;
  $('#ctx-text').value = p.context || '';
  $('#sim-text').value = p.simulation || '';
  applyRole();
  paintAll();
  setStage(defaultStage());
}

/* ── the model ────────────────────────────────────────────────────── */
/* The shared door, if this deployment has one. `proxy` in config.local.js names
 * it; with no value the app uses its own /api/chat and stops there. Nothing
 * here has a default that points at somebody else's server. */
const SHARED_PROXY = ((window.__VPL_CONFIG__ || {}).proxy || '').replace(/\/$/, '');

function aiCfg() { return ai.readAi(); }

let aiAccount = null;

/* No key, no balloon: say that out loud instead of letting a click open a
 * dialog nobody asked for. The hint disappears the moment a key exists. */
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
  if (el) el.hidden = !!aiCfg().key;
}

/* The suite's rule for endpoints lives in vendor/ai.js now, so vn and vi cannot
 * disagree about whether Gemini wants /v1 or not. */
const aiEndpoint = ai.aiEndpoint;

/* The prompts ask for plain text. Models sometimes answer in markdown anyway,
 * and a draft full of ** and ## is not a draft. This is the belt, the prompt is
 * the braces. */
function plain(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[*-]\s+/gm, '- ')
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
  const endpoint = aiEndpoint(c.url);
  const body = { url: endpoint, key: c.key, model: c.model || 'gpt-4o-mini', messages };
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
  try { data = JSON.parse(text); } catch { return text; }
  return plain(data.choices?.[0]?.message?.content || data.content || '');
}

/* ── title ────────────────────────────────────────────────────────── */
async function saveTitle() {
  if (!canWrite()) return;
  const title = $('#proj-title').value.trim() || 'untitled funnel';
  if (S.project.title === title) return;
  try {
    S.project = await db.updateProject(S.project.id, { title });
    const row = S.projects.find((p) => p.id === S.project.id);
    if (row) row.title = title;
    paintProjects();
  } catch (e) { console.error(e); }
}

boot();

/* ── the settings dialog, and the dock ─────────────────────────────
 * Same dialog as every other app, same dock. The dock reads what is on
 * screen and answers about it; nothing it writes lands anywhere until a
 * person says so. */
/* *use it* means "this becomes a card on the wall" — one idea, nothing else. */
async function useFromDock(text) {
  if (!S.project) return 'open a project first — an idea needs a wall';
  if (!canWrite()) return 'this wall is read-only for you';
  const color = COLORS[total() % COLORS.length];
  try {
    const row = await db.addIdea(S.project.id, text, color);
    S.ideas.push(row);
    paintAll();
  } catch (e) { console.warn(e); }
}

/* What the model is given: the wall, and the idea in front of you. Nothing
 * scraped from the page — a card is text, and this app knows which one. */
function dockContext() {
  /* With no wall open the dock still gets a place to stand: what this app is.
   * An assistant handed an empty string can only ask a question back. */
  if (!S.project) {
    return {
      text: 'vpl · vi, an idea funnel. No wall is open. A wall is a pile of short '
        + 'notes; one is picked, then explored into something worth building.',
      selection: '',
    };
  }
  const pick = S.ideas.find((i) => i.id === S.pick);
  const parts = [
    'vpl · vi, an idea funnel: short notes on a wall, one picked and explored.',
    `Project: ${S.project.name || S.project.title || 'untitled'}`,
  ];
  if (pick) parts.push(`The idea in front of you: ${pick.text}`);
  const wall = S.ideas.slice(0, 40).map((i) => '- ' + String(i.text || '').replace(/\s+/g, ' ').trim());
  if (wall.length) parts.push('On the wall:\n' + wall.join('\n'));
  const field = lastField();
  const sel = field && field.selectionEnd > field.selectionStart
    ? field.value.slice(field.selectionStart, field.selectionEnd) : '';
  return { text: parts.join('\n\n'), selection: sel };
}

const DOCK = mountDock({
  app: 'vi',
  openSettings: () => SET && SET.open(),
  context: dockContext,
  onUse: useFromDock,
});
mountNotice({ app: 'vi', column: '#funnel' });

/* The rail is a place where words pile up, so its width is the person's
 * to choose; the grip on its edge writes --rail-w and this app's layout
 * already asks for that width. */
mountRail(document.getElementById('projects'), { app: 'vi' });
