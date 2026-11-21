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
import { prompts } from './prompts.js';

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
  pick: null,      // idea id being explored
  busy: false,
};

/* ── tiny helpers ─────────────────────────────────────────────────── */
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

function displayName(session) {
  if (!session) return '';
  const m = session.user.user_metadata || {};
  const mail = session.user.email || '';
  const name = m.full_name || m.name || (mail.endsWith('@vpl.local') ? mail.split('@')[0] : mail);
  return name;
}

function toAuthEmail(v) {
  const t = v.trim();
  return t.includes('@') ? t.toLowerCase() : t.toLowerCase().replace(/\s+/g, '') + '@vpl.local';
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── gate ─────────────────────────────────────────────────────────── */
async function boot() {
  saveTheme(document.documentElement.dataset.theme || 'light');
  $('#gate-theme').onclick = toggleTheme;
  $('#gate-form').addEventListener('submit', (e) => { e.preventDefault(); login(); });
  $('#btn-register').onclick = () => login(true);
  $('#btn-theme').onclick = toggleTheme;
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
  $('#who').title = S.session.user.email;

  $('#btn-ai').onclick = openAiDialog;
  $('#btn-projects').onclick = () => $('#projects').classList.toggle('open');
  $('#btn-new-project').onclick = newProject;
  $('#btn-first').onclick = newProject;

  $('#proj-title').addEventListener('change', saveTitle);
  $('#proj-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  $$('.step').forEach((b) => (b.onclick = () => setStage(b.dataset.stage)));
  $$('.band').forEach((b) => (b.onclick = () => setStage(b.dataset.stage)));
  $$('[data-next]').forEach((b) => (b.onclick = () => setStage(b.dataset.next)));

  $('#note-form').addEventListener('submit', (e) => { e.preventDefault(); addNote(); });
  $('#notes-ai').onclick = notesWithAi;
  $('#ctx-save').onclick = saveContext;
  $('#ctx-formulate').onclick = formulateContext;
  $('#explore-save').onclick = saveExploration;
  $('#explore-ai').onclick = exploreWithAi;
  $('#sim-save').onclick = saveSimulation;
  $('#sim-ai').onclick = simulateWithAi;
  $('#pick-ai').onclick = suggestWithAi;

  wireAiDialog();
  await loadProjects();
}

/* ── projects rail ────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    S.projects = await db.listProjects();
  } catch (e) {
    console.error(e);
    S.projects = [];
  }
  paintProjects();
  const last = sessionStorage.getItem('vi.project');
  const first = S.projects.find((p) => p.id === last) || S.projects[0];
  if (first) await openProject(first.id);
  else showWelcome();
}

function paintProjects() {
  const ul = $('#proj-list');
  ul.innerHTML = '';
  S.projects.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'proj-row' + (S.project && p.id === S.project.id ? ' on' : '');
    li.innerHTML = `<button class="pick" type="button">${esc(p.title)}</button>
      <span class="n" title="ideas">·</span>
      <button class="kill" type="button" title="delete this funnel">✕</button>`;
    li.querySelector('.pick').onclick = () => openProject(p.id);
    li.querySelector('.kill').onclick = () => removeProject(p);
    ul.append(li);
  });
  $('#proj-none').hidden = S.projects.length > 0;
}

async function newProject() {
  const p = await db.createProject();
  S.projects.unshift(p);
  await openProject(p.id);
  const t = $('#proj-title');
  t.focus();
  t.select();
}

async function removeProject(p) {
  if (!confirm(`delete “${p.title}” and everything in it?`)) return;
  await db.deleteProject(p.id);
  if (S.project && S.project.id === p.id) S.project = null;
  await loadProjects();
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

/* ── context ──────────────────────────────────────────────────────── */
async function saveContext() {
  const msg = $('#ctx-msg');
  const context = $('#ctx-text').value;
  try {
    S.project = await db.updateProject(S.project.id, { context });
    say(msg, 'saved', 'ok');
    paintSteps();
  } catch (e) { say(msg, e.message, 'bad'); }
}

async function formulateContext() {
  const msg = $('#ctx-msg');
  const raw = $('#ctx-text').value.trim();
  if (!raw) return say(msg, 'write a pile of words first, then formulate', 'bad');
  say(msg, 'thinking…', 'busy');
  try {
    const out = await ask(prompts.context(raw));
    $('#ctx-text').value = out.trim();
    say(msg, 'a first pass — fix it by hand, then save', 'ok');
  } catch (e) { say(msg, e.message, 'bad'); }
}

/* ── ideation ─────────────────────────────────────────────────────── */
function paintNotes() {
  const ul = $('#notes');
  ul.innerHTML = '';
  const list = working();
  list.forEach((n, i) => {
    const li = document.createElement('li');
    li.className = 'note';
    li.dataset.color = n.color || COLORS[i % COLORS.length];
    li.style.setProperty('--tilt', TILT[i % TILT.length]);
    li.innerHTML = `<span>${esc(n.text)}</span>
      ${n.stage === 'selected' ? '<span class="note-flag">chosen</span>' : ''}
      <button class="go" type="button" title="explore this one">explore</button>
      <button class="kill" type="button" title="remove this note">✕</button>`;
    li.querySelector('.kill').onclick = () => killNote(n);
    li.querySelector('.go').onclick = () => { S.pick = n.id; setStage('exploration'); paintExplore(); };
    ul.append(li);
  });
  $('#notes-none').hidden = list.length > 0;
}

async function addNote() {
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

async function killNote(n) {
  try {
    await db.deleteIdea(n.id);
    S.ideas = S.ideas.filter((x) => x.id !== n.id);
    if (S.pick === n.id) S.pick = null;
    paintAll();
  } catch (e) { say($('#notes-msg'), e.message, 'bad'); }
}

async function notesWithAi() {
  const msg = $('#notes-msg');
  say(msg, 'thinking…', 'busy');
  try {
    const out = await ask(prompts.ideate(S.project.title, S.project.context,
      working().map((i) => i.text)));
    const lines = out.split('\n').map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter((l) => l.length > 3).slice(0, 8);
    if (!lines.length) throw new Error('the model returned nothing usable');
    const rows = await db.addIdeas(S.project.id, lines, (i) => COLORS[(total() + i) % COLORS.length]);
    S.ideas.push(...rows);
    say(msg, `${rows.length} notes added — delete what does not fit`, 'ok');
    paintAll();
  } catch (e) { say(msg, e.message, 'bad'); }
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
  const msg = $('#explore-msg');
  const n = S.ideas.find((i) => i.id === S.pick);
  if (!n) return;
  say(msg, 'thinking…', 'busy');
  try {
    const out = await ask(prompts.explore(n.text, S.project.context, n.exploration));
    const ta = $('#explore-text');
    ta.value = (n.exploration ? n.exploration.trim() + '\n\n' : '') + out.trim();
    say(msg, 'a first pass — keep what is true, cut the rest, then save', 'ok');
  } catch (e) { say(msg, e.message, 'bad'); }
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
      <button type="button" class="${n.stage === 'selected' ? 'ghost' : 'primary'}">${n.stage === 'selected' ? 'chosen' : 'choose'}</button>`;
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

async function suggestWithAi() {
  const list = explored().filter((i) => i.stage !== 'parked');
  if (list.length < 2) return say($('#notes-msg'), 'explore at least two ideas first', 'bad');
  const msg = $('#pick-reason');
  msg.placeholder = 'thinking…';
  try {
    const out = await ask(prompts.select(list));
    const m = out.match(/pick:\s*(.+)/i);
    const w = out.match(/why:\s*(.+)/i);
    const best = m && list.find((n) => n.text.toLowerCase().includes(m[1].trim().toLowerCase().slice(0, 24)));
    if (best) { S.pick = best.id; paintSelect(); }
    msg.value = (w ? w[1] : '').trim().slice(0, 200);
    msg.placeholder = 'why this one, in one line';
  } catch (e) {
    msg.placeholder = 'why this one, in one line';
    say($('#notes-msg'), e.message, 'bad');
  }
}

/* ── simulation ───────────────────────────────────────────────────── */
function paintSim() {
  const c = chosen();
  $('#sim-who').textContent = c
    ? `simulating: ${c.text}`
    : 'nothing chosen yet — select one first, or write freely below.';
}

async function saveSimulation() {
  const msg = $('#sim-msg');
  try {
    S.project = await db.updateProject(S.project.id, { simulation: $('#sim-text').value });
    say(msg, 'saved', 'ok');
    paintSteps(); paintBands();
  } catch (e) { say(msg, e.message, 'bad'); }
}

async function simulateWithAi() {
  const msg = $('#sim-msg');
  const c = chosen();
  say(msg, 'thinking…', 'busy');
  try {
    const out = await ask(prompts.simulate(c, S.project.context, $('#sim-text').value));
    const ta = $('#sim-text');
    ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + out.trim();
    say(msg, 'a first pass — cut what you cannot test, then save', 'ok');
  } catch (e) { say(msg, e.message, 'bad'); }
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
      <div class="acts">
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
  try {
    const row = await db.updateIdea(n.id, { reason });
    Object.assign(n, row);
    paintSelect();
  } catch (e) { console.error(e); }
}

async function restore(n) {
  try {
    const row = await db.updateIdea(n.id, { stage: 'ideation', reason: '' });
    Object.assign(n, row);
    paintAll();
    setStage('ideation');
  } catch (e) { console.error(e); }
}

async function swap(n) {
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

/* ── the model ────────────────────────────────────────────────────── */
const SHARED_PROXY = 'https://api.terg.hr/chat';
const AI_KEY = 'vpl.ai';

function aiCfg() {
  try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch { return {}; }
}

function wireAiDialog() {
  const dlg = $('#ai-dialog');
  $('#ai-x').onclick = () => dlg.close();
  $('#ai-save').onclick = () => {
    const url = $('#ai-url').value.trim();
    const key = $('#ai-key').value.trim();
    const model = $('#ai-model').value.trim() || 'gpt-4o-mini';
    if (!url || !key) return say($('#ai-msg'), 'both url and key, please', 'bad');
    localStorage.setItem(AI_KEY, JSON.stringify({ url, key, model }));
    say($('#ai-msg'), 'saved in this browser', 'ok');
  };
  $('#ai-forget').onclick = () => {
    localStorage.removeItem(AI_KEY);
    $('#ai-key').value = '';
    say($('#ai-msg'), 'key forgotten', 'ok');
  };
}

function openAiDialog() {
  const c = aiCfg();
  $('#ai-url').value = c.url || '';
  $('#ai-key').value = c.key || '';
  $('#ai-model').value = c.model || 'gpt-4o-mini';
  say($('#ai-msg'), '');
  $('#ai-dialog').showModal();
}

/* A base URL or the full one; people paste both. */
function aiEndpoint(url) {
  const u = (url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v\d+$/.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

async function ask(messages) {
  const c = aiCfg();
  if (!c.key) {
    openAiDialog();
    say($('#ai-msg'), 'no key yet — paste one here, once', 'bad');
    throw new Error('no model key');
  }
  const endpoint = aiEndpoint(c.url);
  const body = { url: endpoint, key: c.key, model: c.model || 'gpt-4o-mini', messages };
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
  try { data = JSON.parse(text); } catch { return text; }
  return (data.choices?.[0]?.message?.content || data.content || '').trim();
}

/* ── title ────────────────────────────────────────────────────────── */
async function saveTitle() {
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
