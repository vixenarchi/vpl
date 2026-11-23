/* vpl — a light notes app with a tree and a rich editor.
 *
 * Modes in the editor: WRITE (rich text) · VIEW (rendered).
 * Storage stays markdown; the rich surface is a view onto it.
 *
 * Routes: #/ (list) and #/n/:id (one note).
 * Autosave is silent (§6.5); the tab title gets a dot (§6.6).
 */

import * as db from './lib/supabase.js';
import { render as renderMd, hint } from './lib/markdown.js';
import { mdToHtml, htmlToMd, wrapInBox } from './lib/editor.js';
import * as ai from './vendor/ai.js';
import * as settings from './vendor/settings.js';
import * as engine from './vendor/engine.js';
import * as who from './vendor/who.js';
import { mountDock } from './vendor/dock.js';

/* ── elements ─────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const el = {
  gate: $('gate'), gateForm: $('gate-form'), email: $('email'), pass: $('pass'),
  btnLogin: $('btn-login'), btnRegister: $('btn-register'), btnGoogle: $('btn-google'),
  btnEye: $('btn-eye'),
  gateMsg: $('gate-msg'),

  app: $('app'),
  btnList: $('btn-list'), btnNew: $('btn-new'), btnHelp: $('btn-help'),
  btnTheme: $('btn-theme'), gateTheme: $('gate-theme'), readerTheme: $('reader-theme'), btnOut: $('btn-out'), btnSettings: $('btn-settings'),

  settings: $('settings'), setWho: $('set-who'), setClose: $('set-close'),
  setX: $('set-x'), setCancel: $('set-cancel'),
  setNameForm: $('set-name-form'), setName: $('set-name'), setNameHint: $('set-name-hint'),
  setAiUrl: $('set-ai-url'), setAiModel: $('set-ai-model'), setAiKey: $('set-ai-key'),
  setAiProvider: $('set-ai-provider'),
  setAiSave: $('set-ai-save'), setAiClear: $('set-ai-clear'), setAiMsg: $('set-ai-msg'),
  setAiTest: $('set-ai-test'), setAiEye: $('set-ai-eye'),
  setPass: $('set-pass'), setPassEye: $('set-pass-eye'), btnSetPass: $('btn-set-pass'),
  setPassMsg: $('set-pass-msg'),
  setDelMsg: $('set-del-msg'), setDelWhat: $('set-del-what'),
  btnDeleteAccount: $('btn-delete-account'),

  bar: document.querySelector('.bar'),
  agent: $('agent'), agentOpen: $('btn-agent'),
  agentForm: $('agent-form'), agentInput: $('agent-input'),
  agentGo: $('agent-go'), agentOut: $('agent-out'), agentText: $('agent-text'),
  agentAdd: $('agent-add'), agentReplace: $('agent-replace'), agentDrop: $('agent-drop'),
  agentMsg: $('agent-msg'),

  list: $('list'), q: $('q'), listItems: $('list-items'), listEmpty: $('list-empty'),
  btnTrash: $('btn-trash'), trashCount: $('trash-count'),
  trashLabel: document.querySelector('.trash-label'),

  main: $('main'),
  viewNone: $('view-none'), viewNote: $('view-note'),
  noteStatus: $('note-status'), noteVis: $('note-vis'),
  binEmpty: $('btn-bin-empty'), trashBanner: $('trash-banner'),
  purge: $('purge'), purgeTitle: $('purge-title'), purgeText: $('purge-text'),
  purgeGo: $('purge-go'), purgeCancel: $('purge-cancel'), purgeX: $('purge-x'), btnChild: $('btn-child'), btnDel: $('btn-del'),
  btnShare: $('btn-share'), title: $('title'),

  share: $('share'), shareFor: $('share-for'), shareClose: $('share-close'),
  sharePublic: $('share-public'), shareLinkRow: $('share-link-row'),
  shareLink: $('share-link'), shareCopy: $('share-copy'), shareRenew: $('share-renew'),
  shareAdd: $('share-add'), shareEmail: $('share-email'), shareRole: $('share-role'),
  shareList: $('share-list'), shareMsg: $('share-msg'), shareCopyMsg: $('share-copy-msg'),
  shareWhoHint: $('share-who-hint'), shareX: $('share-x'), shareCancel: $('share-cancel'),

  reader: $('reader'), readerNav: $('reader-nav'), readerTitle: $('reader-title'),
  readerMd: $('reader-md'), readerRole: $('reader-role'), readerHome: $('reader-home'),
  readerCopy: $('reader-copy'), readerMdCopy: $('reader-md-copy'), readerOwn: $('reader-own'),

  tabs: [...document.querySelectorAll('.tab')],
  paneWrite: $('pane-write'), paneView: $('pane-view'),
  toolbar: $('toolbar'), editable: $('editable'),
  rendered: $('rendered'),

  help: $('help'), helpClose: $('help-close'),
};

/* ── state ────────────────────────────────────────────────────────── */
const S = {
  session: null,
  notes: [],
  trash: [],
  current: null,
  mode: 'write',        // write | view
  dirty: false,
  saving: false,
  saveTimer: null,
  lastSaved: null,
  filter: '',
  route: '',
  freshId: null,
  saveAgain: false,
  opening: null,        // id of the note currently being fetched
  showingTrash: false,
  byId: new Map(),
  collapsed: new Set(JSON.parse(localStorage.getItem('vpl.collapsed') || '[]')),
  dragId: null,         // note being dragged, or null
  shares: [],           // grants this viewer may see (own, addressed to me, public)
  sharedRoots: new Map(),   // note_id -> 'view' | 'edit', grants addressed to me
};

/* who am I */
const myId = () => S.session?.user?.id || null;
const myEmail = () => (S.session?.user?.email || '').toLowerCase();

/* ── what may this viewer do ──────────────────────────────────────── */

/* The role a note is seen with, following the nearest grant that covers it
 * or one of its ancestors. 'owner' wins over everything. */
function roleOf(note) {
  if (!note) return null;
  if (note.user_id && note.user_id === myId()) return 'owner';
  if (!S.sharedRoots.size) return null;

  const byId = S.byId;
  let cur = note, guard = 0;
  while (cur && guard++ < 64) {
    if (S.sharedRoots.has(cur.id)) return S.sharedRoots.get(cur.id);
    cur = cur.parent_id ? byId?.get(cur.parent_id) : null;
  }
  return null;
}

function canEdit(note) {
  if (!note || note.deleted_at) return false;
  const r = roleOf(note);
  return r === 'owner' || r === 'edit';
}

function isSharedWithMe(note) {
  const r = roleOf(note);
  return r === 'view' || r === 'edit';
}

/* How is this note shared? One answer, used for the stripe in the list and for
 * the header of the open note, so the two can never disagree:
 *   public   anyone with the link       (red)
 *   shared   someone may edit it        (green)
 *   readonly someone may only read it   (blue) */
function noteTone(note) {
  if (!note) return null;
  if (note.user_id === myId()) {
    const grants = S.shares.filter((g) => g.owner_id === myId() && g.note_id === note.id && !g.pending);
    if (grants.some((g) => g.code)) return 'public';
    return grants.length ? 'shared' : null;
  }
  const role = roleOf(note);
  if (role === 'edit') return 'shared';
  if (role === 'view') return 'readonly';
  return null;
}

/* words to go with the colour */
function noteBadge(note) {
  const tone = noteTone(note);
  if (tone === 'public') return 'public';
  if (tone === 'readonly') return 'read only';
  if (tone === 'shared') return note.user_id === myId() ? 'shared' : 'can edit';
  return null;
}

/* split the grant rows into "mine to manage" and "addressed to me" */
function indexShares() {
  S.sharedRoots = new Map();
  const mine = myEmail();
  for (const g of S.shares) {
    if (g.email && !g.pending && mine && g.email === mine) S.sharedRoots.set(g.note_id, g.role);
  }
}

const MODES = ['write', 'view'];

/* Light or dark, everywhere the app appears: the app bar, the sign-in corner
 * and the public reader. One saved answer, so a link you open is not a
 * different colour from the app you opened it out of. */
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('vpl.theme', dark ? 'light' : 'dark'); } catch {}
  paintThemeButtons();
  if (S.current && S.mode === 'view') paintView(S.current);
}

function paintThemeButtons() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'switch to light' : 'switch to dark';
  for (const b of [el.btnTheme, el.gateTheme, el.readerTheme]) {
    if (!b) continue;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(dark));
    b.textContent = dark ? '☀' : '◐';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1a1816' : '#faf8f4');
}

/* ── boot ─────────────────────────────────────────────────────────── */

boot();

async function boot() {
  wire();
  paintThemeButtons();

  let fitTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitAgent, 120);
  });
  sayUrlTrouble();

  db.onAuthChange((s) => {
    const had = !!S.session;
    S.session = s;
    if (s && !had) enterApp();
    if (!s && had) leaveApp();
  }).catch(() => {});

  try {
    S.session = await db.session();
  } catch {
    S.session = null;
  }

  if (S.session) enterApp();
  else if (isShareRoute()) route({ force: true });   // a public link needs no account
  else leaveApp();
}

/* Supabase sends a failed sign-in back with the reason in the address:
 * ?error=access_denied&error_description=…  A bare page that just sits there is
 * the worst possible answer, so read it out loud, then tidy the address. */
function sayUrlTrouble() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const err = q.get('error') || h.get('error');
  const why = q.get('error_description') || h.get('error_description') || '';
  if (!err) return;

  gateMsg(why
    ? 'sign-in did not go through: ' + why.replace(/\+/g, ' ')
    : 'sign-in did not go through (' + err + ').');
  history.replaceState(null, '', location.pathname + (location.hash.startsWith('#/') ? location.hash : ''));
}

function enterApp() {
  el.gate.hidden = true;
  el.app.hidden = false;
  db.session().then((s) => who.paintWho(document.getElementById('who'), s)).catch(() => {});
  loadNotes();
  route();
}

function leaveApp() {
  el.app.hidden = true;
  el.gate.hidden = isShareRoute();       // reading a public link is not a login
  S.notes = [];
  S.trash = [];
  S.current = null;
  el.listItems.innerHTML = '';
  document.title = 'vpl';
}

/* ── gate ─────────────────────────────────────────────────────────── */

el.gateForm.addEventListener('submit', (e) => { e.preventDefault(); doAuth('login'); });
el.btnRegister.addEventListener('click', () => doAuth('register'));

/* the password can be looked at while typing: on a phone keyboard this is the
 * difference between one attempt and three */
el.btnEye.addEventListener('click', () => {
  const show = el.pass.type === 'password';
  el.pass.type = show ? 'text' : 'password';
  el.btnEye.setAttribute('aria-pressed', String(show));
  el.btnEye.setAttribute('aria-label', show ? 'hide password' : 'show password');
  el.btnEye.title = show ? 'hide password' : 'show password';
  el.pass.focus();
});
el.btnGoogle.addEventListener('click', () => doAuth('google'));
if (el.email) lowerField(el.email);

/* Supabase signs in with an address. A bare name is turned into one on a
 * domain that cannot receive mail — deliberately, so it is obvious that the
 * account has no recovery address and no invitations by email. */
const NAME_DOMAIN = '@vpl.local';

/* Phones capitalise the first letter of a text field and computers do not.
 * Compared in lower case, shown in lower case; the password is never touched. */
function lowerField(el) {
  el.addEventListener('input', () => {
    const low = el.value.toLowerCase();
    if (low === el.value) return;
    const at = el.selectionStart;
    el.value = low;
    try { el.setSelectionRange(at, at); } catch {}
  });
}

function toAuthEmail(raw) {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return '';
  return v.includes('@') ? v : v + NAME_DOMAIN;
}

/* what to call the person in the app: their name, else the part they typed */
/* The name in the corner is the suite's, not this app's (vendor/who.js):
 * the name Google gave us, else the address tidied, else a letter. */
function displayName(user) {
  return who.whoLabel(user);
}

async function doAuth(kind) {
  gateMsg('');
  const typed = el.email.value.trim();
  const email = toAuthEmail(typed);
  const password = el.pass.value;

  if (kind !== 'google') {
    if (!typed) return gateMsg('an email or a name is needed.');
    if (typed.includes('@') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed)) {
      return gateMsg('that address is missing its dot.');
    }
    if (!typed.includes('@') && typed.length < 2) {
      return gateMsg('a name of 2+ characters is needed.');
    }
    if (password.length < 6) return gateMsg('a password of 6+ characters is needed.');
  }

  setBusy(true);
  try {
    if (kind === 'google') {
      await db.signInWithGoogle();
    } else if (kind === 'login') {
      await db.signIn(email, password);
    } else {
      const out = await db.signUp(email, password);
      if (out?.needsConfirm) {
        gateMsg('almost — a link is on its way to ' + email +
          '. click it, then sign in here.');
        setBusy(false);
        return;
      }
    }
  } catch (err) {
    gateMsg(friendly(err));
  } finally {
    setBusy(false);
  }
}

function setBusy(on) {
  for (const b of [el.btnLogin, el.btnRegister, el.btnGoogle]) b.disabled = on;
}
function gateMsg(text) { el.gateMsg.textContent = text || ''; }

/* ── wiring ───────────────────────────────────────────────────────── */

function wire() {
  el.btnOut.addEventListener('click', async () => {
    if (S.dirty) await flush();
    await db.signOut();
  });

  for (const b of [el.btnTheme, el.gateTheme, el.readerTheme]) {
    if (b) b.addEventListener('click', toggleTheme);
  }

  el.btnList.addEventListener('click', () => el.list.classList.toggle('open'));
  el.btnNew.addEventListener('click', newNote);
  el.btnChild.addEventListener('click', () => newChildNote());
  el.btnHelp.addEventListener('click', () => el.help.showModal());
  el.helpClose.addEventListener('click', () => el.help.close());

  el.q.addEventListener('input', () => {
    S.filter = el.q.value.trim().toLowerCase();
    paintList();
  });

  el.btnTrash.addEventListener('click', toggleTrash);
  wireBinDrop();

  /* Empty space below the tree means the top level: dropping there lifts a
   * note out of its parent. Rows stop propagation, so this only fires on
   * the background. */
  el.listItems.addEventListener('dragover', (e) => {
    if (!S.dragId || !dragEnabled()) return;
    if (e.target.closest('.tree-row')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.listItems.classList.add('drop-root');
  });
  el.listItems.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && el.listItems.contains(e.relatedTarget)) return;
    el.listItems.classList.remove('drop-root');
  });
  el.listItems.addEventListener('drop', (e) => {
    if (!S.dragId) return;
    e.preventDefault();
    const from = S.dragId;
    S.dragId = null;
    clearDropMarks();
    reparent(from, null);
  });

  for (const tab of el.tabs) {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  }

  el.toolbar.addEventListener('mousedown', (e) => {
    /* keep the selection in the editable when a toolbar button is pressed */
    if (e.target.closest('button')) e.preventDefault();
  });
  el.toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    runCommand(b.dataset.cmd, b.dataset.arg);
  });

  el.editable.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act="uncode"]');
    if (!act) return;
    e.preventDefault();
    uncodeBlock(act.closest('.blk-code'));
  });

  el.editable.addEventListener('input', onEdit);
  el.title.addEventListener('input', onEdit);

  el.btnDel.addEventListener('click', trashCurrent);
  el.binEmpty.addEventListener('click', () => askPurge('all'));
  el.purgeCancel.addEventListener('click', () => el.purge.close());
  el.purgeX.addEventListener('click', () => el.purge.close());
  el.purgeGo.addEventListener('click', () => doPurge());

  el.btnShare.addEventListener('click', openShare);
  el.shareClose.addEventListener('click', () => el.share.close());
  el.shareX.addEventListener('click', () => el.share.close());
  el.shareCancel.addEventListener('click', () => el.share.close());
  el.sharePublic.addEventListener('change', togglePublicLink);
  el.shareCopy.addEventListener('click', copyPublicLink);
  el.shareRenew.addEventListener('click', renewPublicLink);
  el.shareAdd.addEventListener('submit', (e) => { e.preventDefault(); addPerson(); });
  el.shareCopyMsg.addEventListener('click', copyShareMessage);

  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', route);

  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ── keyboard ─────────────────────────────────────────────────────── */

function onKey(e) {
  const inField = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
  const meta = e.metaKey || e.ctrlKey;

  if (e.key === 'Escape') {
    if (el.help.open) { el.help.close(); return; }
    if (S.current && e.target === el.editable) { el.editable.blur(); return; }
  }

  /* Help is Ctrl+/. A bare "?" was a trap: every question typed into the
   * assistant's chat opened this list instead of reaching the model. */
  if ((meta || e.ctrlKey) && e.key === '/') {
    e.preventDefault();
    el.help.showModal();
    return;
  }

  /* Ctrl+N never reaches the page: every browser turns it into "new window".
   * So the new note is Alt+N, which no browser claims. */
  if (e.altKey && !meta && !e.ctrlKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newNote();
    return;
  }

  if (meta && !e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case '1': if (S.current) { e.preventDefault(); setMode('write'); } return;
      case '2': if (S.current) { e.preventDefault(); setMode('view'); } return;
      case 'e':
        if (S.current) { e.preventDefault(); cycleMode(); }
        return;
      case '\\':
        e.preventDefault();
        el.list.classList.toggle('open');
        return;
      case 'k':
        /* Ctrl+K is the filter when you are not in the editor, a link when you are */
        if (e.target === el.editable) return;      // let the browser make a link
        e.preventDefault();
        el.q.focus();
        el.q.select();
        return;
      default: break;
    }
  }

  if (meta && e.key === 'Enter') {
    if (S.current && !S.current.deleted_at) { e.preventDefault(); newChildNote(); }
    return;
  }

  /* Alt+arrows: navigate and move in the tree */
  if (e.altKey && !meta) {
    if (e.key === 'ArrowUp') { e.preventDefault(); navNote(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); navNote(1); }
    else if (e.key === 'ArrowLeft' && S.current) { e.preventDefault(); outdent(); }
    else if (e.key === 'ArrowRight' && S.current) { e.preventDefault(); nestUnderPrevious(); }
  }

  /* Ctrl+B / Ctrl+I inside the rich editor are handled by the browser,
   * which already maps them to execCommand. Nothing to do. */
}

function cycleMode() {
  if (!S.current) return;
  const i = MODES.indexOf(S.mode);
  setMode(MODES[(i + 1) % MODES.length]);
}

/* ── routing ──────────────────────────────────────────────────────── */

function route(opts = {}) {
  const hash = location.hash || '#/';
  if (hash === S.route && S.current && !opts.force) return;
  S.route = hash;

  const shareMatch = hash.match(/^#\/s\/([A-Za-z0-9]{4,64})(?:\/([0-9a-f-]{36}))?$/i);
  if (shareMatch) {
    showShare(shareMatch[1], shareMatch[2] || null);
    return;
  }

  el.reader.hidden = true;

  if (!S.session) {
    el.app.hidden = true;
    el.gate.hidden = false;
    paintThemeButtons();
    return;
  }
  el.app.hidden = false;
  el.gate.hidden = true;

  const noteMatch = hash.match(/^#\/n\/([0-9a-f-]{36})$/i);

  if (noteMatch) {
    S.showingTrash = false;
    openNote(noteMatch[1]);
  } else {
    S.current = null;
    el.viewNote.hidden = true;
    el.viewNone.hidden = false;
    document.title = 'vpl';
    markListCurrent(null);
    paintList();
  }
}

/* ── the tree ─────────────────────────────────────────────────────── */

async function loadNotes() {
  try {
    const [all, shares] = await Promise.all([
      db.listNotes(),
      db.listShares().catch(() => []),   // a share failure must not hide the notes
    ]);

    S.shares = shares;
    indexShares();

    S.byId = new Map(all.map((n) => [n.id, n]));

    /* A public link is readable by everyone, but a public subtree is not
     * *yours*: it must not appear in the list of every signed-in account.
     * The list holds what you own plus what was shared with you by email.
     * Public subtrees stay reachable through their link alone (the reader),
     * which is why the reader fetches notes itself. */
    const visible = all.filter((n) => !!roleOf(n));

    S.notes = visible.filter((n) => !n.deleted_at);
    S.trash = visible.filter((n) => n.deleted_at)
      .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

    paintList();
  } catch (err) {
    el.listEmpty.hidden = false;
    el.listEmpty.textContent = friendly(err);
  }
}

/* Builds the tree: children grouped by parent_id, siblings by position. */
function treeOf(rows) {
  const byParent = new Map();
  const ids = new Set(rows.map((n) => n.id));

  for (const n of rows) {
    const p = (n.parent_id && ids.has(n.parent_id)) ? n.parent_id : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(n);
  }

  for (const list of byParent.values()) {
    /* Position first, then creation time as a stable tie-break. Sorting by
     * updated_at made a freshly edited note jump to the top of its siblings,
     * so the tree reshuffled under the cursor while typing. */
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || new Date(a.created_at) - new Date(b.created_at));
  }

  return byParent;
}

function paintList() {
  const rows = S.showingTrash ? S.trash : S.notes;

  const match = (n) => {
    if (!S.filter) return true;
    return (n.title || '').toLowerCase().includes(S.filter)
        || (n.body || '').toLowerCase().includes(S.filter);
  };

  el.listItems.innerHTML = '';

  let visible;
  if (S.filter) {
    /* a flat, filtered result — nesting would hide matches */
    visible = rows.filter(match);
    for (const n of visible) el.listItems.append(listRow(n, 0, false, true));
  } else {
    const byParent = treeOf(rows);
    const walk = (parentId, depth, ancestorCollapsed) => {
      const kids = byParent.get(parentId) || [];
      for (const n of kids) {
        const hasKids = (byParent.get(n.id) || []).length > 0;
        const collapsed = S.collapsed.has(n.id);
        el.listItems.append(
          /* `hidden` means "an ancestor is collapsed", not "this row is
           * collapsed" — collapsing a node must keep the node visible. */
          listRow(n, depth, hasKids && !S.showingTrash, collapsed, ancestorCollapsed));
        if (hasKids && !collapsed) walk(n.id, depth + 1, false);
      }
    };
    walk(null, 0, false);
    visible = rows;
  }

  el.listEmpty.hidden = el.listItems.children.length > 0;
  if (!el.listItems.children.length) {
    el.listEmpty.textContent = S.showingTrash
      ? 'the recycle bin is empty.'
      : (S.filter ? 'nothing matches.' : 'no notes yet.');
  }
  paintTrashCount();
  paintTone();
}

function listRow(n, depth, hasKids, collapsed, hidden) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  if (hidden) li.hidden = true;
  if (hasKids) li.setAttribute('aria-expanded', String(!collapsed));

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `calc(0.35rem + ${depth * 0.85}rem)`;

  const b = document.createElement('button');
  b.dataset.id = n.id;
  b.setAttribute('aria-current', String(S.current?.id === n.id));

  if (hasKids) {
    const tw = document.createElement('span');
    tw.className = 'twisty';
    tw.textContent = collapsed ? '▸' : '▾';
    tw.setAttribute('aria-hidden', 'true');
    tw.addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsed) S.collapsed.delete(n.id);
      else S.collapsed.add(n.id);
      try { localStorage.setItem('vpl.collapsed', JSON.stringify([...S.collapsed])); } catch {}
      paintList();
    });
    b.append(tw);
  } else {
    const dot = document.createElement('span');
    dot.className = 'twisty spacer';
    dot.setAttribute('aria-hidden', 'true');
    b.append(dot);
  }

  const text = document.createElement('span');
  text.className = 'li-text';

  const t = document.createElement('span');
  t.className = 'li-title';
  t.textContent = n.title?.trim() || 'untitled';

  const tone = noteTone(n);
  const badgeText = noteBadge(n);
  if (tone) row.dataset.tone = tone;

  if (badgeText) {
    const badge = document.createElement('span');
    badge.className = 'share-badge' + (n.user_id === myId() ? ' own' : '');
    badge.textContent = badgeText;
    badge.title = n.user_id === myId()
      ? (tone === 'public'
        ? 'anyone with the link can read this note and everything under it'
        : 'you shared this note and everything under it')
      : 'shared with you';
    t.append(badge);
  }

  const h = document.createElement('span');
  h.className = 'li-hint';
  h.textContent = hint(n.body || '', 40) || 'empty';

  text.append(t, h);
  b.append(text);
  b.addEventListener('click', () => { location.hash = '#/n/' + n.id; });

  row.append(b);

  if (S.showingTrash && n.user_id === myId()) {
    const x = document.createElement('button');
    x.className = 'row-purge';
    x.type = 'button';
    x.dataset.purge = n.id;
    x.title = 'delete forever';
    x.setAttribute('aria-label', 'delete ' + (n.title?.trim() || 'untitled') + ' forever');
    x.textContent = '✕';
    x.addEventListener('click', (e) => { e.stopPropagation(); askPurge(n.id); });
    row.classList.add('has-purge');
    row.append(x);
  }

  if (dragEnabled() && n.user_id === myId()) makeDraggable(li, row, n);
  li.append(row);
  return li;
}

/* PUBLIC / SHARED / PRIVATE in words, before anything else about the note.
 * The stripe and the tint are the fast signal; this is the one you can read
 * without having learned the colour language first. */
function visibilityOf(n) {
  if (!n) return null;
  const grants = noteShares(n.id);
  const pub = grants.some((g) => g.code);
  const people = grants.filter((g) => g.email && !g.pending);
  if (pub) return { key: 'public', word: 'public',
    title: 'a link is live: anyone who has it can read this note and everything under it' };
  if (people.length) return { key: 'shared', word: 'shared',
    title: people.length === 1 ? 'shared with one person' : 'shared with ' + people.length + ' people' };
  if (n.user_id !== myId()) return { key: 'shared', word: 'shared',
    title: 'somebody shared this with you' };
  return { key: 'private', word: 'private',
    title: 'nobody else can see this note — no link, no person' };
}

function paintVisibility(n) {
  const v = visibilityOf(n);
  if (!v) { el.noteVis.hidden = true; return; }
  el.noteVis.hidden = false;
  el.noteVis.textContent = v.word;
  el.noteVis.dataset.vis = v.key;
  el.noteVis.title = v.title;
}

function paintTrashCount() {
  const n = S.trash.length;
  el.trashCount.textContent = n ? String(n) : '';
  el.binEmpty.hidden = !S.showingTrash || !n;
  el.binEmpty.textContent = 'empty all';
  el.binEmpty.title = n === 1 ? 'delete the one note in the bin for good'
    : 'delete all ' + n + ' notes in the bin for good';
  el.binEmpty.setAttribute('aria-label', el.binEmpty.title);
  el.btnTrash.classList.toggle('active', S.showingTrash);
  el.btnTrash.title = n ? `recycle bin (${n})` : 'recycle bin (empty)';
}

function markListCurrent(id) {
  for (const b of el.listItems.querySelectorAll('button[data-id]')) {
    b.setAttribute('aria-current', String(b.dataset.id === id));
  }
}

function toggleTrash() {
  S.showingTrash = !S.showingTrash;
  el.list.classList.add('open');
  el.list.classList.toggle('trash-mode', S.showingTrash);
  el.trashBanner.hidden = !S.showingTrash;
  el.q.placeholder = S.showingTrash ? 'filter the bin…' : 'filter… (Ctrl+K)';
  el.q.value = '';
  S.filter = '';
  paintList();
  if (S.showingTrash) {
    el.viewNote.hidden = true;
    el.viewNone.hidden = false;
  }
}

/* depth of a note, following parent_id */
function depthOf(id, rows = S.notes) {
  const byId = new Map(rows.map((n) => [n.id, n]));
  let d = 0, cur = byId.get(id), guard = 0;
  while (cur?.parent_id && guard++ < 64) {
    cur = byId.get(cur.parent_id);
    if (cur) d++;
  }
  return d;
}

/* Is `maybeDescendant` inside the subtree of `id`? Used to refuse a move
 * that would create a cycle. */
function isDescendant(id, maybeDescendant, rows = S.notes) {
  const byId = new Map(rows.map((n) => [n.id, n]));
  let cur = byId.get(maybeDescendant), guard = 0;
  while (cur?.parent_id && guard++ < 256) {
    if (cur.parent_id === id) return true;
    cur = byId.get(cur.parent_id);
  }
  return false;
}

/* Sibling order helpers */
function siblingsOf(parentId) {
  return S.notes
    .filter((n) => (n.parent_id || null) === (parentId || null))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || new Date(a.created_at) - new Date(b.created_at));
}

/* Move `id` under `newParentId`, at `index` among its new siblings (append
 * when null). The children follow on their own: they still point at `id`, so
 * the whole subtree travels with it. */
async function reparent(id, newParentId, index = null) {
  if (id === newParentId) return toast('a note cannot sit under itself.');
  if (newParentId && isDescendant(id, newParentId)) {
    return toast('cannot move a note inside its own subtree.');
  }

  const note = S.notes.find((n) => n.id === id);
  if (!note) return;

  const sibs = siblingsOf(newParentId).filter((n) => n.id !== id);
  const at = index == null
    ? sibs.length
    : Math.max(0, Math.min(index, sibs.length));

  try {
    const saved = await db.updateNote(id, { parent_id: newParentId, position: at });
    note.parent_id = saved.parent_id;
    note.position = saved.position;

    /* Renumber the whole sibling list, so the order a drop produced in the
     * DOM is the order the next read returns; otherwise positions collide
     * and later drags land somewhere else than the drop line promised. */
    const order = [...sibs.slice(0, at), note, ...sibs.slice(at)];
    await Promise.all(order.map((n, i) =>
      (n.position === i ? null : db.updateNote(n.id, { position: i }).catch(() => {}))));

    if (newParentId) {
      /* show what was just dropped in, even if the target was collapsed */
      S.collapsed.delete(newParentId);
      try { localStorage.setItem('vpl.collapsed', JSON.stringify([...S.collapsed])); } catch {}
    }

    await loadNotes();
    toast(newParentId ? 'nested.' : 'moved out.');
  } catch (err) {
    toast(friendly(err));
  }
}

/* ── drag and drop in the tree ─────────────────────────────────────
 * Dragging only means something on the tree, so it is off in the recycle bin
 * and in a filtered (flat) list, where nesting is not drawn at all.
 * The vertical zone under the cursor decides the operation: the middle half
 * of a row nests, the top and bottom quarters reorder as siblings — the same
 * language as VS Code and Nautilus. */
function dragEnabled() {
  return !S.filter;    // a filtered list is flat: nesting has no meaning there
}

function makeDraggable(li, row, n) {
  row.draggable = true;
  row.dataset.noteId = n.id;          // a finger finds notes by element, not closure

  row.addEventListener('dragstart', (e) => {
    if (!dragEnabled()) return;
    S.dragId = n.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', n.id);   // Firefox needs payload
    li.classList.add('dragging');
  });

  row.addEventListener('dragend', () => {
    S.dragId = null;
    li.classList.remove('dragging');
    clearDropMarks();
  });

  row.addEventListener('dragover', (e) => {
    if (!S.dragId || S.showingTrash || !dragEnabled()) return;
    if (n.user_id !== myId()) return;      // never rearrange someone else's tree
    if (S.dragId === n.id) return;
    /* n sits inside the dragged subtree: nesting there would make a cycle */
    if (isDescendant(S.dragId, n.id)) return;

    e.preventDefault();
    e.stopPropagation();          // the list itself means "move to the top"
    e.dataTransfer.dropEffect = 'move';

    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / (r.height || 1);
    const zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    if (row.dataset.drop !== zone) {
      clearDropMarks();
      row.dataset.drop = zone;
    }
  });

  row.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    delete row.dataset.drop;
  });

  row.addEventListener('drop', (e) => {
    if (!S.dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const zone = row.dataset.drop;
    const from = S.dragId;
    S.dragId = null;
    clearDropMarks();
    if (zone) dropNote(from, n.id, zone);
  });

  row.addEventListener('pointerdown', (e) => startTouchHold(e, li, row, n));
}

/* ── the same drag, with a finger ───────────────────────────────────
 * HTML5 drag events never fire on a touch screen: that is not a missing
 * attribute, it is the browser refusing to invent a mouse. So a long press
 * lifts the row instead, and from then on the finger is followed with pointer
 * events. The zones, the guard against cycles and the marks drawn are exactly
 * the ones above — only the way a note is picked up is different. */
const HOLD_MS = 320;
const HOLD_SLOP = 10;               // px the finger may wander before it is a scroll

function startTouchHold(e, li, row, n) {
  if (e.pointerType === 'mouse') return;      // a mouse has real drag events
  if (!dragEnabled() || S.showingTrash) return;
  if (n.user_id !== myId()) return;

  const sx = e.clientX;
  const sy = e.clientY;
  let lifted = false;
  let ghost = null;
  let timer = 0;

  const blockScroll = (ev) => ev.preventDefault();
  const blockMenu = (ev) => ev.preventDefault();

  const mark = (x, y) => {
    const hit = document.elementFromPoint(x, y);

    if (el.btnTrash.contains(hit)) {
      clearDropMarks();
      setBinTarget(binDirection(S.dragId));
      return;
    }

    const under = hit && hit.closest ? hit.closest('.tree-row') : null;
    if (!under) {
      clearDropMarks();
      /* empty space under the tree means the top level */
      if (el.listItems.contains(hit)) el.listItems.classList.add('drop-root');
      return;
    }

    const targetId = under.dataset.noteId;
    if (!targetId || targetId === S.dragId || isDescendant(S.dragId, targetId)) {
      clearDropMarks();
      return;
    }

    const r = under.getBoundingClientRect();
    const f = (y - r.top) / (r.height || 1);
    const zone = f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'inside';
    clearDropMarks();
    under.dataset.drop = zone;
  };

  const finish = (commit) => {
    clearTimeout(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.removeEventListener('touchmove', blockScroll, true);
    document.removeEventListener('contextmenu', blockMenu, true);
    document.documentElement.classList.remove('touch-dragging');
    if (ghost) ghost.remove();

    if (!lifted) return;
    lifted = false;

    const from = S.dragId;
    const binDir = el.btnTrash.dataset.drop;
    const marked = el.listItems.querySelector('[data-drop]');
    /* read the zone before the marks are cleared: clearDropMarks deletes the
     * attribute, and reading it afterwards is how a drop silently became a
     * reorder instead of a nest */
    const zone = marked ? marked.dataset.drop : null;
    const targetId = marked ? marked.dataset.noteId : null;
    const toRoot = el.listItems.classList.contains('drop-root');
    S.dragId = null;
    li.classList.remove('dragging');
    clearDropMarks();
    if (!commit || !from) return;

    /* the release would also land as a click on the row, which would jump to
     * the note the person just moved */
    const swallow = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      el.listItems.removeEventListener('click', swallow, true);
    };
    el.listItems.addEventListener('click', swallow, true);
    setTimeout(() => el.listItems.removeEventListener('click', swallow, true), 500);

    if (binDir) {
      const note = S.notes.find((x) => x.id === from) || S.trash.find((x) => x.id === from);
      if (!note) return;
      if (binDir === 'trash') binNote(note);
      else restoreNote(note);
      return;
    }
    if (targetId && zone) return dropNote(from, targetId, zone);
    if (toRoot) reparent(from, null);
  };

  const onUp = () => finish(true);

  const onMove = (ev) => {
    if (!lifted) {
      /* before the hold fires, movement means the person is scrolling */
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > HOLD_SLOP) finish(false);
      return;
    }
    ev.preventDefault();
    /* the copy floats above the fingertip: a thumb is wide enough to hide the
     * very row the drop will land on */
    ghost.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY - 46) + 'px)';
    mark(ev.clientX, ev.clientY);
  };

  timer = setTimeout(() => {
    if (!dragEnabled() || S.showingTrash) return finish(false);
    lifted = true;
    S.dragId = n.id;
    li.classList.add('dragging');
    document.documentElement.classList.add('touch-dragging');
    document.addEventListener('touchmove', blockScroll, { passive: false, capture: true });
    document.addEventListener('contextmenu', blockMenu, true);

    const r = row.getBoundingClientRect();
    ghost = row.cloneNode(true);
    ghost.className = 'drag-ghost';
    ghost.style.width = r.width + 'px';
    ghost.style.transform = 'translate(' + (sx + 12) + 'px,' + (sy - 46) + 'px)';
    document.body.append(ghost);

    navigator.vibrate?.(12);
  }, HOLD_MS);

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function clearDropMarks() {
  for (const r of el.listItems.querySelectorAll('[data-drop]')) delete r.dataset.drop;
  el.listItems.classList.remove('drop-root');
  setBinTarget(null);
}

/* ── the recycle bin as a drop target ─────────────────────────────
 * The bin is one zone with two directions: a live note dropped on it goes in,
 * a binned note dropped on it comes back out. The label spells out which, so
 * the direction is never a guess. */
function binDirection(id) {
  const note = S.notes.find((n) => n.id === id) || S.trash.find((n) => n.id === id);
  if (!note) return null;
  return note.deleted_at ? 'restore' : 'trash';
}

function setBinTarget(dir) {
  if ((el.btnTrash.dataset.drop || null) === dir) return;

  if (dir) el.btnTrash.dataset.drop = dir;
  else delete el.btnTrash.dataset.drop;

  el.btnTrash.classList.toggle('drop-active', !!dir);
  el.trashLabel.textContent = dir === 'trash' ? 'move to bin'
    : dir === 'restore' ? 'restore from bin'
    : 'recycle bin';
}

function wireBinDrop() {
  for (const ev of ['dragenter', 'dragover']) {
    el.btnTrash.addEventListener(ev, (e) => {
      if (!S.dragId || !dragEnabled()) return;
      const dir = binDirection(S.dragId);
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      setBinTarget(dir);
    });
  }

  el.btnTrash.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && el.btnTrash.contains(e.relatedTarget)) return;
    setBinTarget(null);
  });

  el.btnTrash.addEventListener('drop', (e) => {
    if (!S.dragId) return;
    e.preventDefault();
    e.stopPropagation();

    const id = S.dragId;
    const dir = binDirection(id);
    const note = S.notes.find((n) => n.id === id) || S.trash.find((n) => n.id === id);
    S.dragId = null;
    setBinTarget(null);
    clearDropMarks();

    if (!dir || !note) return;
    if (dir === 'trash') binNote(note);
    else restoreNote(note);
  });
}

/* inside  → target becomes the new parent (the drawn drop line is a box)
 * before/after → target becomes the previous/next sibling at that slot. */
function dropNote(id, targetId, zone) {
  if (!dragEnabled()) return;
  if (zone === 'inside') return reparent(id, targetId);

  const target = S.notes.find((n) => n.id === targetId);
  if (!target) return;

  const parentId = target.parent_id || null;
  const sibs = siblingsOf(parentId).filter((x) => x.id !== id);
  const i = sibs.findIndex((x) => x.id === targetId);
  if (i === -1) return reparent(id, parentId);

  reparent(id, parentId, zone === 'before' ? i : i + 1);
}

/* Alt+Left: become a sibling of your parent (outdent) */
function outdent() {
  if (S.opening) return;          // a note is still loading
  const n = S.current;
  if (!n || !n.parent_id || n.deleted_at) return;
  const parent = S.notes.find((p) => p.id === n.parent_id);
  reparent(n.id, parent?.parent_id || null);
}

/* Alt+Right: nest under the previous sibling */
function nestUnderPrevious() {
  if (S.opening) return;          // a note is still loading
  const n = S.current;
  if (!n || n.deleted_at) return;
  const sibs = siblingsOf(n.parent_id);
  const i = sibs.findIndex((s) => s.id === n.id);
  if (i <= 0) return toast('no previous sibling to nest under.');
  reparent(n.id, sibs[i - 1].id);
}

/* Alt+Up / Alt+Down: previous or next note in visual order */
function navNote(dir) {
  const ids = [...el.listItems.querySelectorAll('button[data-id]')]
    .map((b) => b.dataset.id);
  if (!ids.length) return;
  const cur = S.current?.id;
  const i = ids.indexOf(cur);
  const next = i === -1
    ? (dir > 0 ? ids[0] : ids[ids.length - 1])
    : ids[Math.min(Math.max(i + dir, 0), ids.length - 1)];
  if (next && next !== cur) location.hash = '#/n/' + next;
}

/* ── create ───────────────────────────────────────────────────────── */

/* Opening a note the caller just created and already holds. Passing the row
 * in avoids a re-fetch that used to race the save of the note being left,
 * which wrote the previous note's title onto the new one. */
async function openCreated(note) {
  if (S.dirty && S.current?.id !== note.id) await flush();

  S.current = note;
  S.dirty = false;
  S.mode = 'write';
  S.lastSaved = new Date(note.updated_at);

  await loadNotes();

  /* put the new row back: loadNotes came from the server and must not
   * downgrade what we just wrote */
  S.current = S.notes.find((n) => n.id === note.id) || note;

  if (location.hash === '#/n/' + note.id) route({ force: true });
  else location.hash = '#/n/' + note.id;
}

async function newNote() {
  try {
    S.showingTrash = false;
    const note = await db.createNote({ position: siblingsOf(null).length });
    await openCreated(note);
  } catch (err) {
    toast(friendly(err));
  }
}

async function newChildNote() {
  if (!S.current) return newNote();
  if (S.current.deleted_at) return toast('restore this note first.');
  if (!canEdit(S.current)) return toast('this note is read-only.');
  const parentId = S.current.id;
  try {
    if (S.dirty) await flush();
    const note = await db.createNote({
      parent_id: parentId,
      position: siblingsOf(parentId).length,
    });
    S.collapsed.delete(parentId);
    await openCreated(note);
  } catch (err) {
    toast(friendly(err));
  }
}

/* ── open one note ────────────────────────────────────────────────── */

async function openNote(id) {
  if (S.dirty) await flush();

  const fresh = S.freshId === id;
  S.freshId = null;

  if (S.current?.id !== id) {
    /* Record the fetch so a keystroke that arrives mid-load cannot act on the
     * previously open note. Without this, Alt+Left right after clicking a
     * note in the list outdented whichever note was open before. */
    S.opening = id;
    let loaded;
    try {
      loaded = await db.getNote(id);
    } catch (err) {
      S.opening = null;
      toast(friendly(err));
      location.hash = '#/';
      return;
    }
    S.opening = null;
    S.current = loaded;
    /* S.mode is left alone on purpose: if you are reading, clicking the next
     * note in the tree keeps you reading. Only the tabs (or Ctrl+1) leave
     * view, and a note you cannot edit is always read. */
    S.lastSaved = new Date(S.current.updated_at);
  }

  const inBin = !!S.current.deleted_at;
  const owned = S.current.user_id === myId();
  const editable = canEdit(S.current);

  el.viewNone.hidden = true;
  el.viewNote.hidden = false;
  el.title.value = S.current.title || '';
  el.title.readOnly = !editable;
  el.editable.innerHTML = mdToHtml(S.current.body || '');

  el.btnDel.textContent = inBin ? 'restore' : 'delete';
  el.btnDel.classList.toggle('restore', inBin);
  el.btnDel.hidden = !owned;         // not yours to bin
  el.btnShare.hidden = !owned || inBin;
  el.btnChild.disabled = !editable;
  for (const tab of el.tabs) tab.disabled = !editable;

  paintTone();

  setMode(editable ? S.mode : 'view', { force: true });
  markListCurrent(id);
  el.list.classList.remove('open');

  /* the assistant writes into the note, so it only exists where writing does */
  showAgent(editable);
  paintAgent();

  if (fresh) {
    el.title.focus();
    el.title.select();
  }
  updateStatus();
}

/* ── modes ────────────────────────────────────────────────────────── */

function setMode(mode, opts = {}) {
  if (!S.current) return;
  if (!canEdit(S.current)) mode = 'view';
  if (!MODES.includes(mode)) mode = 'write';

  if (mode === S.mode && !opts.force) return;

  /* leaving write: make sure the markdown is current */
  if (S.mode === 'write' && S.dirty) scheduleSave();

  S.mode = mode;

  for (const t of el.tabs) {
    t.setAttribute('aria-selected', String(t.dataset.mode === mode));
  }

  el.paneWrite.hidden = mode !== 'write';
  el.paneView.hidden = mode !== 'view';

  if (mode === 'write') {
    el.editable.innerHTML = mdToHtml(S.current.body || '');
    el.editable.focus();
  } else {
    paintView(S.current);
  }

  updateStatus();
}

/* ── editing ──────────────────────────────────────────────────────── */

function runCommand(cmd, arg) {
  el.editable.focus();
  if (cmd === 'createLink') {
    const url = prompt('link url', 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
  } else if (cmd === 'formatBlock' && arg === 'h2') {
    toggleHeading();
    return;
  } else if (cmd === 'formatBlock' && arg === 'pre') {
    toggleCode();
    return;                     // toggleCode decides whether this makes or unmakes one
  } else if (cmd === 'formatBlock') {
    document.execCommand('formatBlock', false, arg);
  } else if (cmd === 'box') {
    wrapInBox(el.editable);
  } else {
    document.execCommand(cmd);
  }
  onEdit();
}

/* A code block is a box you can leave again: the toolbar button toggles, and a
 * "text" button sits inside the block itself for anyone who never found the
 * toolbar. Both end at the same place — the words survive, the box does not. */
function selectedBlock() {
  const sel = window.getSelection();
  let node = sel?.anchorNode || null;
  if (node && node.nodeType === 3) node = node.parentElement;
  return node?.closest?.('.blk-code, pre') || null;
}

function uncodeBlock(block) {
  if (!block) return;
  const text = (block.querySelector('pre') || block).textContent.replace(/\n$/, '');
  const lines = text.split('\n');
  const holders = lines.map((line) => {
    const p = document.createElement('p');
    if (line) p.textContent = line; else p.innerHTML = '<br>';
    return p;
  });
  block.replaceWith(...(holders.length ? holders : [document.createElement('p')]));
  el.editable.focus();
  onEdit();
}

/* Never entered: a heading you cannot leave is a trap, and the browser's
 * formatBlock has no "back to paragraph" gesture of its own. */
function blockTagAtCaret() {
  const sel = window.getSelection();
  let node = sel?.anchorNode || null;
  if (node && node.nodeType === 3) node = node.parentElement;
  const block = node?.closest?.('h1, h2, h3, h4, p, blockquote, li, div');
  return (block?.tagName || 'p').toLowerCase();
}

function toggleHeading() {
  /* a heading inside a code block would be a bug you cannot see */
  const sel = window.getSelection();
  let node = sel?.anchorNode || null;
  if (node && node.nodeType === 3) node = node.parentElement;
  if (node?.closest?.('.blk-code')) return;
  const tag = blockTagAtCaret();
  document.execCommand('formatBlock', false, /^h[1-4]$/.test(tag) ? 'p' : 'h2');
  onEdit();
}

function toggleCode() {
  const block = selectedBlock();
  if (block) { uncodeBlock(block); return; }
  document.execCommand('formatBlock', false, 'pre');
  onEdit();
}

function onEdit() {
  if (!canEdit(S.current)) return;

  S.current.title = el.title.value;
  if (S.mode === 'write') S.current.body = htmlToMd(el.editable);

  S.dirty = true;

  const row = S.notes.find((n) => n.id === S.current.id);
  if (row) {
    row.title = S.current.title;
    row.body = S.current.body;
    paintList();
  }

  scheduleSave();
  updateStatus();
}

/* Guards against a slow render overwriting a newer one when the user moves
 * between notes quickly. */
let paintToken = 0;

async function paintView(note) {
  const token = ++paintToken;
  try {
    await renderMd(note.body || '', el.rendered);
    if (token !== paintToken) return;
    updateStatus();
  } catch (err) {
    el.rendered.textContent = 'could not render: ' + friendly(err);
  }
}

/* ── autosave ─────────────────────────────────────────────────────── */

function scheduleSave() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flush, 800);       // R6: 800 ms, no button
}

async function flush() {
  clearTimeout(S.saveTimer);
  if (!S.current) return;

  /* If a save is already in flight, queue another and wait for the chain to
   * finish. Returning immediately here was a real bug: callers that await
   * flush() (creating a child note, signing out) then read the database
   * before the write landed and saw the previous title. */
  if (S.saving) {
    S.saveAgain = true;
    await S.inFlight;
    return;
  }

  if (!S.dirty) return;

  S.saving = true;
  S.saveAgain = false;

  const id = S.current.id;
  const title = S.current.title;
  const body = S.current.body;

  S.inFlight = (async () => {
    try {
      const saved = await db.updateNote(id, { title, body });

      if (S.current?.id === id) {
        S.lastSaved = new Date(saved.updated_at);
        if (S.current.title === title && S.current.body === body) S.dirty = false;
      }

      const row = S.notes.find((n) => n.id === id);
      if (row) {
        row.title = title;
        row.body = body;
        row.updated_at = saved.updated_at;
        paintList();
        markListCurrent(id);
      }
    } catch (err) {
      updateStatus(friendly(err));
    }
  })();

  await S.inFlight;

  S.saving = false;
  updateStatus();

  /* A keystroke arrived while writing: write again before resolving, so an
   * awaiting caller sees the final state. */
  if (S.saveAgain && S.dirty) await flush();
}

/* the colour of the header is the same answer the list gives */
function paintTone() {
  const tone = S.current ? noteTone(S.current) : null;
  if (tone) el.viewNote.dataset.tone = tone;
  else delete el.viewNote.dataset.tone;
  updateStatus();
}

function updateStatus(err) {
  document.title = (S.dirty ? '● ' : '') + 'vpl';

  if (err) { el.noteStatus.textContent = err; return; }
  if (!S.current) { el.noteStatus.textContent = ''; return; }

  const bits = [];
  paintVisibility(S.current);
  if (S.current.deleted_at) bits.push('in the recycle bin');
  else if (roleOf(S.current) === 'view') bits.push('read only');
  else if (roleOf(S.current) === 'edit') bits.push('shared · ' + S.mode);
  else bits.push(S.mode);
  if (S.lastSaved) bits.push(timeAgo(S.lastSaved));
  el.noteStatus.textContent = bits.join(' · ');
}

/* ── delete and restore ─────────────────────────────────────────────
 * One implementation each, shared by the button and by drag and drop, so the
 * two paths cannot drift apart. */

async function binNote(note) {
  if (S.dirty) await flush();

  try {
    await db.updateNote(note.id, { deleted_at: new Date().toISOString() });

    if (S.current?.id === note.id) {
      S.current = null;
      S.dirty = false;
      location.hash = '#/';
    }

    await loadNotes();
    toast('moved to the recycle bin.');
    return true;
  } catch (err) {
    toast(friendly(err));
    return false;
  }
}

async function restoreNote(note) {
  try {
    const saved = await db.updateNote(note.id, { deleted_at: null });
    const wasOpen = S.current?.id === note.id;
    if (wasOpen) S.current = saved;

    await loadNotes();

    if (wasOpen) {
      /* the editor was read-only while binned — give it back, title included */
      el.title.readOnly = false;
      el.btnDel.textContent = 'delete';
      el.btnDel.classList.remove('restore');
      el.btnChild.disabled = false;
      for (const tab of el.tabs) tab.disabled = false;
      setMode('write', { force: true });
    }

    toast('restored.');
    return true;
  } catch (err) {
    toast(friendly(err));
    return false;
  }
}

async function trashCurrent() {
  if (!S.current) return;
  if (S.current.user_id !== myId()) return toast('this note is not yours to delete.');
  if (S.current.deleted_at) await restoreNote(S.current);
  else await binNote(S.current);
  el.list.classList.remove('open');
}

/* ── out of the bin, for good ───────────────────────────────────────
 * Binning is undoable and stays a single click. Leaving the bin is not: it
 * asks, it names what it will take, and it says what happens to the notes
 * underneath (they stay, and move up to the top level — the database sets
 * their parent_id to null rather than deleting them with the parent). */
let purgeTarget = null;

function closeNote() {
  S.current = null;
  S.dirty = false;
  location.hash = '#/';
  el.viewNote.hidden = true;
  el.viewNone.hidden = false;
  document.title = 'vpl';
  markListCurrent(null);
}

function askPurge(what) {
  purgeTarget = what;

  if (what === 'all') {
    const n = S.trash.length;
    if (!n) return;
    el.purgeTitle.textContent = 'do you really want to empty all?';
    el.purgeText.textContent = n + (n === 1 ? ' note leaves' : ' notes leave')
      + ' the recycle bin for good, with everything you wrote in ' + (n === 1 ? 'it' : 'them')
      + '. there is no undo. notes that sit under something you delete '
      + (n === 1 ? 'stays' : 'stay') + ', and move to the top level.';
    el.purgeGo.textContent = 'yes, empty it';
  } else {
    const note = S.trash.find((x) => x.id === what);
    if (!note) return;
    const kids = S.trash.filter((x) => x.parent_id === what).length;
    el.purgeTitle.textContent = 'delete “' + (note.title?.trim() || 'untitled') + '” for good?';
    el.purgeText.textContent = 'it leaves the recycle bin and is gone — no undo.'
      + (kids
        ? ' the ' + kids + (kids === 1 ? ' note underneath stays' : ' notes underneath stay')
          + (kids === 1 ? ', and it moves' : ', and they move') + ' to the top level.'
        : '');
    el.purgeGo.textContent = 'delete for good';
  }

  el.purge.showModal();
}

async function doPurge() {
  const what = purgeTarget;
  purgeTarget = null;
  el.purge.close();

  try {
    if (what === 'all') {
      const gone = new Set(S.trash.map((n) => n.id));
      await db.purgeNotes([...gone]);
      for (const n of S.trash) {
        if (n.parent_id && gone.has(n.parent_id)) n.parent_id = null;
      }
      S.trash = S.trash.filter((n) => !gone.has(n.id));
      if (S.current && gone.has(S.current.id)) closeNote();
      else if (S.current && gone.has(S.current.parent_id)) { S.current.parent_id = null; S.current = S.byId.get(S.current.id) || S.current; }
      toast('the recycle bin is empty.');
    } else {
      const note = S.trash.find((n) => n.id === what);
      await db.purgeNote(what);
      for (const n of S.trash) if (n.parent_id === what) n.parent_id = null;
      S.trash = S.trash.filter((n) => n.id !== what);
      if (S.current?.id === what) closeNote();
      else if (S.current?.parent_id === what) S.current.parent_id = null;
      if (note) toast('“' + (note.title?.trim() || 'untitled') + '” is gone for good.');
    }
  } catch (err) {
    toast(friendly(err));
  }

  paintList();
  if (S.current) updateStatus();
}

/* ── share ──────────────────────────────────────────────────────────
 * One link covers a note and its subtree. Two kinds of grant, both in
 * note_shares: a public code (read-only, no account) or an email + role.
 * Only the owner of the note sees this dialog at all. */

function shareUrl(code) {
  return location.origin + location.pathname + '#/s/' + code;
}

function noteShares(noteId) {
  return S.shares.filter((g) => g.note_id === noteId && g.owner_id === myId());
}

function shareMsg(msg) { el.shareMsg.textContent = msg || ''; }

function openShare() {
  const note = S.current;
  if (!note || note.user_id !== myId()) return;

  el.shareFor.textContent = note.title?.trim() || 'untitled';
  shareMsg('');
  whoHint('');
  paintShare();
  el.share.showModal();
}

function replaceShare(row) {
  const i = S.shares.findIndex((x) => x.id === row.id);
  if (i === -1) S.shares.push(row);
  else S.shares[i] = row;
  indexShares();
}

function paintShare() {
  if (!S.current) return;
  const grants = noteShares(S.current.id);
  const pub = grants.find((g) => g.code);
  const people = grants.filter((g) => g.email);

  el.sharePublic.checked = !!pub;
  el.shareLinkRow.hidden = !pub;
  el.shareLink.value = pub ? shareUrl(pub.code) : '';

  el.shareList.innerHTML = '';
  if (!people.length) {
    const li = document.createElement('li');
    li.className = 'share-empty muted';
    li.textContent = 'nobody yet.';
    el.shareList.append(li);
  }

  for (const g of people) {
    const li = document.createElement('li');
    li.className = 'share-person';

    const who = document.createElement('span');
    who.className = 'share-who';
    who.textContent = g.email;
    who.title = g.email;

    if (g.pending) {
      const wait = document.createElement('span');
      wait.className = 'share-wait';
      wait.textContent = 'waiting';
      wait.title = 'no account with this address yet — it grants nothing until allowed';
      who.append(wait);
    }

    const role = document.createElement('select');
    role.className = 'share-role';
    role.setAttribute('aria-label', 'permission for ' + g.email);
    for (const [value, label] of [['view', 'can view'], ['edit', 'can edit']]) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      if (value === g.role) o.selected = true;
      role.append(o);
    }
    role.addEventListener('change', async () => {
      try {
        replaceShare(await db.setShareRole(g.id, role.value));
        shareMsg('permission changed.');
      } catch (err) {
        shareMsg(friendly(err));
        paintShare();
      }
    });

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ghost danger share-remove';
    rm.textContent = '×';
    rm.title = 'stop sharing with ' + g.email;
    rm.setAttribute('aria-label', 'stop sharing with ' + g.email);
    rm.addEventListener('click', async () => {
      try {
        await db.removeShare(g.id);
        S.shares = S.shares.filter((x) => x.id !== g.id);
        indexShares();
        paintShare();
        paintList();
        shareMsg('removed.');
      } catch (err) {
        shareMsg(friendly(err));
      }
    });

    /* a waiting invitation gets one extra control: let them in, by hand */
    if (g.pending) {
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'ghost share-allow';
      allow.textContent = 'allow';
      allow.title = 'they have signed up — let them in';
      allow.addEventListener('click', async () => {
        allow.disabled = true;
        try {
          if (!(await db.accountExists(g.email))) {
            shareMsg('nobody has signed up with ' + g.email + ' yet.');
            allow.disabled = false;
            return;
          }
          replaceShare(await db.allowShare(g.id));
          paintShare();
          paintList();
          shareMsg(g.email + ' can open it now.');
        } catch (err) {
          allow.disabled = false;
          shareMsg(friendly(err));
        }
      });
      li.append(who, role, allow, rm);
    } else {
      li.append(who, role, rm);
    }
    el.shareList.append(li);
  }
}

async function togglePublicLink() {
  const note = S.current;
  if (!note) return;
  const pub = noteShares(note.id).find((g) => g.code);

  try {
    if (el.sharePublic.checked) {
      if (!pub) replaceShare(await db.addPublicLink(note.id));
      shareMsg('the link is live. anyone who has it can read this chapter.');
    } else if (pub) {
      await db.removeShare(pub.id);
      S.shares = S.shares.filter((x) => x.id !== pub.id);
      indexShares();
      shareMsg('the link is dead.');
    }
    paintShare();
    paintList();
  } catch (err) {
    el.sharePublic.checked = !!pub;      // put the switch back where it was
    shareMsg(friendly(err));
  }
}

async function addPerson() {
  const note = S.current;
  if (!note) return;

  /* A bare name is accepted here exactly as it is at the gate: this app's own
   * accounts live at @vpl.local, so "ana" and "ana@vpl.local" are one person.
   * Any other address has to be the real thing. */
  const email = toAuthEmail(el.shareEmail.value);
  const role = el.shareRole.value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return shareMsg('that is not an email address.');

  try {
    /* A grant is an address, and whoever signs up with that address receives the
     * note. If the account exists, the grant is immediate; if not, it waits and
     * grants nothing, and the owner allows it by hand once they sign up. Either
     * way no address can be guessed into a working grant. */
    const known = await db.accountExists(email);
    const existing = noteShares(note.id).find((g) => g.email === email);

    if (existing?.pending && known) {
      replaceShare(await db.allowShare(existing.id));
      replaceShare(await db.setShareRole(existing.id, role));
      shareMsg('allowed — they can open it now.');
    } else if (existing?.pending) {
      return shareMsg('still waiting: nobody has signed up with that address yet.');
    } else if (existing) {
      replaceShare(await db.setShareRole(existing.id, role));
      shareMsg('already shared — the permission was changed.');
    } else {
      replaceShare(await db.addEmailShare(note.id, email, role, !known));
      shareMsg(known
        ? 'shared with ' + email + '.'
        : 'waiting: ' + email + ' has no account yet. it grants nothing until you allow it.');
    }
    el.shareEmail.value = '';
    paintShare();
    paintList();
  } catch (err) {
    shareMsg(friendly(err));
  }
}

/* A link that leaked is replaced, not just switched off and on: the old row is
 * deleted, so the old URL is dead the moment this returns. */
async function renewPublicLink() {
  const note = S.current;
  if (!note) return;
  const pub = noteShares(note.id).find((g) => g.code);
  if (!pub) return;

  try {
    await db.removeShare(pub.id);
    S.shares = S.shares.filter((x) => x.id !== pub.id);
    indexShares();
    replaceShare(await db.addPublicLink(note.id));
    paintShare();
    paintList();
    shareMsg('new link. the old one is dead.');
  } catch (err) {
    shareMsg(friendly(err));
  }
}

/* The clipboard API needs a secure origin; over a bare LAN address it is not
 * there at all. The old selection trick still works, so try the modern call and
 * fall back to it rather than telling the user to press Ctrl+C. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

async function copyPublicLink() {
  if (await copyText(el.shareLink.value)) shareMsg('link copied.');
  else { el.shareLink.select(); shareMsg('press Ctrl+C to copy.'); }
}

/* ── the public reader ──────────────────────────────────────────────
 * #/s/<code> opens one shared subtree with no account, no list and no
 * editor. The database decides what comes back; this only draws it. */

function isShareRoute(hash = location.hash) {
  return /^#\/s\//.test(hash);
}

let readerToken = 0;
/* what the reader is looking at, kept so the two transfer buttons work without
 * another round trip: the code, the subtree, and the chapter on screen */
const readerNow = { code: '', rows: [], rootId: null, noteId: null };

function readerSay(msg) {
  el.readerNav.innerHTML = '';
  el.readerTitle.textContent = '';
  el.readerMd.textContent = msg;
}

async function showShare(code, noteId) {
  const token = ++readerToken;

  el.gate.hidden = true;
  el.app.hidden = true;
  el.reader.hidden = false;
  paintThemeButtons();
  el.readerHome.hidden = !S.session;
  el.readerNav.innerHTML = '';
  el.readerTitle.textContent = '';
  el.readerMd.textContent = 'loading…';

  try {
    const share = await db.getShareByCode(code);
    if (token !== readerToken) return;
    if (!share) return readerSay('this link is not live.');

    /* the code is the capability: the database answers with this subtree and
     * nothing else, so a signed-in reader cannot list what is not theirs */
    const rows = await db.readShare(code);
    if (token !== readerToken) return;
    if (!rows.length) return readerSay('this link is not live.');

    const byId = new Map(rows.map((n) => [n.id, n]));
    const root = byId.get(share.note_id) || rows[0];

    readerNow.code = code;
    readerNow.rows = rows;
    readerNow.rootId = root.id;
    el.readerOwn.hidden = !S.session;

    paintReaderNav(code, rows);
    await drawReaderPage(byId.get(noteId) || root);
  } catch (err) {
    if (token === readerToken) readerSay(friendly(err));
  }
}

function paintReaderNav(code, frag) {
  const byParent = new Map();
  const ids = new Set(frag.map((n) => n.id));

  for (const n of frag) {
    const p = (n.parent_id && ids.has(n.parent_id)) ? n.parent_id : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(n);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || new Date(a.created_at) - new Date(b.created_at));
  }

  el.readerNav.innerHTML = '';
  const walk = (parentId, depth) => {
    for (const n of byParent.get(parentId) || []) {
      const a = document.createElement('a');
      a.className = 'reader-link';
      a.href = '#/s/' + code + '/' + n.id;
      a.style.paddingLeft = (0.5 + depth * 0.85) + 'rem';
      a.textContent = n.title?.trim() || 'untitled';
      el.readerNav.append(a);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
}

async function drawReaderPage(note) {
  if (!note) return;
  const token = readerToken;      // two fast chapter clicks must not cross
  const title = note.title?.trim() || 'untitled';
  document.title = title + ' · vpl';

  el.readerTitle.textContent = title;
  for (const a of el.readerNav.querySelectorAll('.reader-link')) {
    const here = (a.getAttribute('href') || '').endsWith('/' + note.id);
    a.setAttribute('aria-current', String(here));
  }

  readerNow.noteId = note.id;

  /* Rendered into a detached node: marked arrives from a CDN, so a slow older
   * render used to be able to land after a newer one and win. */
  const holder = document.createElement('div');
  try {
    await renderMd(note.body || '', holder);
    if (token !== readerToken) return;

    el.readerMd.innerHTML = holder.innerHTML;
    if (!el.readerMd.innerHTML.trim()) {
      el.readerMd.innerHTML = '<p class="muted">this note has no text yet.</p>';
    }
  } catch (err) {
    if (token !== readerToken) return;
    el.readerMd.textContent = 'could not render: ' + friendly(err);
  }
}

/* ── taking something with you ─────────────────────────────────────── */

/* A shared note is markdown already; what is missing is the shape. The root
 * becomes the title, each level one # more, and the chapters keep the order the
 * reader saw. Anything the reader builds from this is their own text. */
function subtreeMarkdown(rows, rootId) {
  const byParent = new Map();
  const ids = new Set(rows.map((n) => n.id));
  for (const n of rows) {
    const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(n);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || new Date(a.created_at) - new Date(b.created_at));
  }

  const byId = new Map(rows.map((n) => [n.id, n]));
  const out = [];
  const walk = (id, depth) => {
    const n = byId.get(id);
    if (!n) return;
    const hashes = '#'.repeat(Math.min(depth, 6));
    out.push(`${hashes} ${n.title?.trim() || 'untitled'}`, '');
    if (n.body?.trim()) out.push(n.body.trim(), '');
    for (const kid of byParent.get(id) || []) walk(kid.id, depth + 1);
  };
  walk(rootId, 1);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* The document, not the chapter you happen to stand on: the reader's nav is a
 * table of contents, and what you take away is the thing it is a contents of. */
async function copyReaderMarkdown() {
  const text = subtreeMarkdown(readerNow.rows, readerNow.rootId);
  if (await copyText(text)) toast('the whole note is on your clipboard, as markdown.');
  else toast('the clipboard said no; select the text instead.');
}

/* Copying into my notes is not importing: every row is inserted under my own
 * id with fresh note ids, so the copy is mine to rename, move and delete. */
async function copyReaderToMine() {
  if (!S.session) return toast('sign in first — a copy needs an owner.');
  const btn = el.readerOwn;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'copying…';
  try {
    const rows = readerNow.rows;
    const byParent = new Map();
    const ids = new Set(rows.map((n) => n.id));
    for (const n of rows) {
      const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(n);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
        || new Date(a.created_at) - new Date(b.created_at));
    }

    const rootId = readerNow.rootId;
    const clone = async (src, parentId, position) => {
      const made = await db.createNote({
        title: src.title || '',
        body: src.body || '',
        parent_id: parentId,
        position,
      });
      let i = 0;
      for (const kid of byParent.get(src.id) || []) await clone(kid, made.id, i++);
      return made;
    };
    const rootSrc = rows.find((r) => r.id === rootId) || rows[0];
    const made = await clone(rootSrc, null, S.notes.length);
    await loadNotes();
    btn.textContent = 'copied';
    toast('a copy is in your notes.');
    setTimeout(() => { location.hash = '#/n/' + made.id; }, 900);
  } catch (err) {
    toast(friendly(err));
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = was; }, 1600);
  }
}

/* ── helpers ──────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let toastTimer = null;
function toast(msg) {
  el.noteStatus.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => updateStatus(), 4000);
}

function timeAgo(date) {
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
  return date.toLocaleDateString();
}

function friendly(err) {
  const m = err?.message || String(err);
  if (/row-level security/i.test(m)) {
    return 'the database refused that — you are not signed in as the owner of this note.';
  }
  if (/JWT|token|session/i.test(m)) return 'your session expired. sign in again.';
  if (/already registered/i.test(m)) return 'that email already has an account. sign in instead.';
  if (/Invalid login/i.test(m)) return 'wrong email or password.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'cannot reach the server.';
  return m;
}

/* ── the assistant ──────────────────────────────────────────────────
 * One line, one job: it reformats or expands what is already written. It has no
 * rights of its own — no key can reach the database from here except the one
 * this app already uses for the signed-in person, and the model only ever sends
 * text back, which is held until a button is pressed. The API key lives in this
 * browser's storage, not on a server, because there is no server.
 */

const AI_STORE = 'vpl.ai';

function aiConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(AI_STORE) || '{}');
    return { url: raw.url || '', model: raw.model || '', key: raw.key || '' };
  } catch { return { url: '', model: '', key: '' }; }
}

function setAiConfig(next) {
  try { localStorage.setItem(AI_STORE, JSON.stringify(next)); } catch {}
  paintAgent();
}

/* The suite's rule for endpoints lives in vendor/ai.js, so vn and vi cannot
 * disagree about whether Gemini wants /v1 or not. */
const aiEndpoint = ai.aiEndpoint;

// one list of providers for the whole suite, staged from packages/shell/ai.js
let aiAccount = null;

if (el.setAiProvider) {
  ai.mountAi({
    provider: el.setAiProvider,
    url: el.setAiUrl,
    model: el.setAiModel,
    models: document.querySelector('#ai-models'),
  });
  aiAccount = ai.mountAccountAi({
    box: $('ai-account'),
    read: () => ({
      url: el.setAiUrl.value.trim(),
      model: el.setAiModel.value.trim(),
      key: el.setAiKey.value.trim() || aiConfig().key,
    }),
  });
}

/* Model APIs do not send CORS headers, so the browser throws their answer
 * away — the same key that works in curl fails on a page. Where the app is
 * served over http(s) it asks its own /api/chat (a Pages Function in
 * production, serve.py locally), which goes server to server where CORS does
 * not exist. If that door is not there, it tries the endpoint directly. */
/* Model endpoints do not send CORS headers, so a browser cannot call them
 * directly: the request has to leave from our own origin. There are two doors.
 *
 *   /api/chat              this app's own Pages Function (and serve.py locally)
 *   https://api.terg.hr/chat   the suite's shared proxy, for apps that ship no
 *                              function of their own
 *
 * Same origin first, because it is the nearest door; the shared one second, so
 * a published app still works if its own function is missing. `proxyMode`
 * remembers which one answered, so the test button can say so out loud and a
 * CORS wall is never mistaken for a bad key. */
const SHARED_PROXY = 'https://api.terg.hr/chat';
let proxyMode = null;   /* 'same' | 'shared' | 'direct' */

async function chatCall({ url, key, model, messages, max_tokens, temperature }) {
  const target = aiEndpoint(url);
  const body = JSON.stringify({ url: target, key, model, messages, max_tokens, temperature });
  const doors = proxyMode === 'shared' ? [SHARED_PROXY, '/api/chat'] : ['/api/chat', SHARED_PROXY];

  for (const door of doors) {
    let res;
    try {
      res = await fetch(door, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      continue;   /* no such door (or offline) — try the next one */
    }
    if (res.headers.get('X-Vpl-Proxy') === '1') {
      proxyMode = door === SHARED_PROXY ? 'shared' : 'same';
      return res;
    }
  }

  /* Nothing answered as a proxy. Last resort: the endpoint itself, which only
   * works for a host that does send CORS headers. */
  proxyMode = 'direct';
  return fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages, max_tokens, temperature }),
  });
}

const AGENT_RULES = [
  'You are a quiet assistant inside a small notes app.',
  'You receive the text of one note as markdown and one instruction.',
  'Answer with markdown only: no preamble, no explanation, no code fences around the whole answer.',
  'Keep the language of the note. Keep its structure unless the instruction asks to change it.',
  'Never invent facts that are not in the note; when asked to expand, expand on what is there.',
  'If the note is empty, write from the instruction alone and say nothing about it.',
].join(' ');

async function askAgent(instruction) {
  const cfg = aiConfig();
  if (!cfg.url) throw new Error('no endpoint yet — add one in settings.');
  if (!cfg.key) throw new Error('no api key yet — add one in settings.');

  const note = S.current;
  if (!note) throw new Error('open a note first.');

  const res = await chatCall({
    url: cfg.url,
    key: cfg.key,
    model: cfg.model || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: AGENT_RULES },
      {
        role: 'user',
        content: `title: ${note.title || ''}\n\n${note.body || ''}\n\n---\n${instruction}`,
      },
    ],
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`the model answered ${res.status}${detail ? ': ' + detail.slice(0, 140) : ''}`);
  }

  const json = await res.json().catch(() => null);
  const text = json?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('the model sent nothing back.');
  return String(text).trim();
}

/* A key you cannot test is a key you find out about later, mid-sentence.
 * This asks the endpoint one tiny question with the values as typed. */
async function testAiEndpoint() {
  const url = el.setAiUrl.value.trim();
  const model = el.setAiModel.value.trim() || 'gpt-4o-mini';
  const key = el.setAiKey.value.trim() || aiConfig().key;

  const say = (text) => {
    el.setAiMsg.textContent = text;
    el.setAiMsg.dataset.state = 'ok';
  };
  const fail = (text) => {
    el.setAiMsg.textContent = text;
    el.setAiMsg.dataset.state = 'bad';
  };

  if (!url) return fail('add an api url first.');
  if (!key) return fail('add an api key first.');

  el.setAiMsg.dataset.state = 'busy';
  el.setAiMsg.textContent = 'asking ' + model + '…';
  const started = Date.now();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 25000);

  try {
    const res = await chatCall({
      url,
      key,
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'reply with the single word: ok' }],
    });
    const ms = Date.now() - started;

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return fail(`${res.status} ${res.statusText || ''}`.trim() +
        (detail ? ` — ${detail.replace(/\s+/g, ' ').slice(0, 160)}` : ''));
    }

    const json = await res.json().catch(() => null);
    const said = json?.choices?.[0]?.message?.content;
    if (!said) return fail('it answered, but not in the chat format this app expects.');
    const via = proxyMode === 'direct' ? 'directly'
      : proxyMode === 'shared' ? 'through api.terg.hr'
      : 'through this app';
    say(`works — ${model} answered in ${ms} ms ${via}: “${String(said).trim().slice(0, 40)}”`);
  } catch (err) {
    if (err.name === 'AbortError') return fail('no answer in 25 s — wrong url, or the model is slow.');
    /* a wrong address is nearly always CORS or DNS, and the browser hides
     * which one, so say both instead of pretending to know */
    fail('could not reach it — check the url, the key, and whether it allows calls from a browser.');
  } finally {
    clearTimeout(timer);
  }
}

let agentAnswer = '';

function agentMsg(text) { el.agentMsg.textContent = text || ''; }

/* Does the bar still have room for a field you could read? If not, the pill
 * steps aside and a ✎ takes its place. This is measured, not guessed from a
 * media query: a narrow desktop window and a phone both hit it, and a wide
 * phone in landscape does not. */
function fitAgent() {
  if (!el.bar) return;
  const gap = parseFloat(getComputedStyle(el.bar).gap) || 0;
  const others = [...el.bar.children].filter((c) => c !== el.agent
    && !c.classList.contains('bar-gap-a') && !c.classList.contains('bar-gap-b')
    && c.offsetParent !== null && !c.hidden);
  const used = others.reduce((w, c) => w + c.getBoundingClientRect().width, 0) + gap * (others.length + 3);
  document.documentElement.classList.toggle('agent-tight', el.bar.clientWidth - used < 185);
}

function paintAgent() {
  const ready = !!(aiConfig().url && aiConfig().key);
  fitAgent();
  el.agentGo.disabled = !ready;
  el.agentInput.placeholder = ready
    ? 'ask the assistant…'
    : 'set an api key in ⚙';
}

/* On a phone the bar holds only a ✎; pressing it opens the assistant as a
 * strip under the bar, wide enough to read and type in. */
function setAgentOpen(open) {
  el.agent.classList.toggle('open', !!open);
  el.agentOpen.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) setTimeout(() => el.agentInput.focus(), 30);
  else { el.agentOut.hidden = true; agentMsg(''); }
}

function showAgent(on) {
  el.agent.hidden = !on;
  el.agentOpen.hidden = !on;      // no note to ask about, no ✎ to press
  if (on) requestAnimationFrame(fitAgent);
  if (!on) setAgentOpen(false);
  // an answer belongs to the note it was written for, never to the next one
  if (!on) {
    agentAnswer = '';
    el.agentOut.hidden = true;
    agentMsg('');
  }
}

async function runAgent(e) {
  e?.preventDefault();
  const instruction = el.agentInput.value.trim();
  if (!instruction) return;

  el.agentGo.disabled = true;
  agentMsg('thinking…');
  try {
    agentAnswer = await askAgent(instruction);
    el.agentText.textContent = agentAnswer;
    el.agentOut.hidden = false;
    agentMsg('');
    el.agentInput.value = '';
  } catch (err) {
    agentMsg(friendly(err) + ' (see settings ⚙)');
  } finally {
    paintAgent();
  }
}

function agentInto(where) {
  if (!agentAnswer) return;
  const html = mdToHtml(agentAnswer);
  if (where === 'end') el.editable.insertAdjacentHTML('beforeend', html);
  else el.editable.innerHTML = html;
  el.agentOut.hidden = true;
  agentMsg(where === 'end' ? 'added at the end.' : 'the note was replaced.');
  onEdit();
}

/* ── settings ──────────────────────────────────────────────────────── */
async function openSettings() {
  if (await ai.adoptAccountAi()) { /* the key field below picks it up */ }
  const user = await db.session().then((s) => s?.user).catch(() => null);
  const meta = user?.user_metadata || {};

  el.setWho.textContent = user
    ? displayName(user) + ' · ' + (user.email || '')
    : '';
  el.setName.value = meta.full_name || meta.name || '';
  el.setNameHint.hidden = !(user?.app_metadata?.provider === 'google');

  const cfg = aiConfig();
  el.setAiUrl.value = cfg.url;
  el.setAiModel.value = cfg.model;
  el.setAiKey.value = cfg.key;
  el.setAiMsg.textContent = '';
  el.setDelMsg.textContent = '';

  /* say what would actually go, in numbers, before the prompt appears */
  const notes = S.notes.length + S.trash.length;
  const links = S.shares.filter((g) => g.owner_id === myId()).length;
  el.setDelWhat.textContent = 'this deletes ' + notes + (notes === 1 ? ' note' : ' notes') +
    (links ? ' and ' + links + (links === 1 ? ' shared link' : ' shared links') : '') +
    ', and the account itself.';

  if (aiAccount) aiAccount.paint();
  el.settings.showModal();
}

async function saveName(e) {
  e.preventDefault();
  const name = el.setName.value.trim();
  try {
    await db.setName(name);
    toast(name ? 'hello, ' + name + '.' : 'the name was cleared.');
  } catch (err) {
    toast(friendly(err));
  }
}

function saveAi() {
  const url = el.setAiUrl.value.trim();
  const key = el.setAiKey.value.trim();
  setAiConfig({ url, model: el.setAiModel.value.trim(), key });
  el.setAiMsg.textContent = url && key ? 'saved in this browser.' : 'saved — but the assistant needs both a url and a key.';
}

function clearAi() {
  setAiConfig({ url: el.setAiUrl.value.trim(), model: el.setAiModel.value.trim(), key: '' });
  el.setAiKey.value = '';
  el.setAiMsg.textContent = 'the key was forgotten.';
}

async function deleteMyAccount() {
  const typed = 'delete';
  const yes = prompt(
    'This deletes the account, every note in it and every link you made.\n' +
    'There is no backup. Type ' + typed + ' to confirm.');
  if (yes === null) return;
  if (yes.trim().toLowerCase() !== typed) {
    el.setDelMsg.textContent = 'nothing was deleted.';
    return;
  }

  el.btnDeleteAccount.disabled = true;
  try {
    await db.deleteAccount();
    el.setDelMsg.textContent = 'the account is gone.';
    await db.signOut();
    location.hash = '#/';
    location.reload();
  } catch (err) {
    el.setDelMsg.textContent = friendly(err);
  } finally {
    el.btnDeleteAccount.disabled = false;
  }
}

el.btnSettings.addEventListener('click', openSettings);
el.setClose.addEventListener('click', () => el.settings.close());
el.setX.addEventListener('click', () => el.settings.close());
el.setCancel.addEventListener('click', () => el.settings.close());
el.setNameForm.addEventListener('submit', saveName);
el.setAiSave.addEventListener('click', saveAi);
el.setAiClear.addEventListener('click', clearAi);
el.setAiTest.addEventListener('click', testAiEndpoint);

el.setAiEye.addEventListener('click', () => {
  const shown = el.setAiKey.type === 'text';
  el.setAiKey.type = shown ? 'password' : 'text';
  el.setAiEye.setAttribute('aria-pressed', String(!shown));
  el.setAiEye.title = el.setAiEye.ariaLabel = shown ? 'show api key' : 'hide api key';
});

el.setPassEye.addEventListener('click', () => {
  const shown = el.setPass.type === 'text';
  el.setPass.type = shown ? 'password' : 'text';
  el.setPassEye.setAttribute('aria-pressed', String(!shown));
  el.setPassEye.title = el.setPassEye.ariaLabel = shown ? 'show password' : 'hide password';
});

el.btnSetPass.addEventListener('click', async () => {
  const pw = el.setPass.value;
  if (pw.length < 6) {
    el.setPassMsg.dataset.state = 'bad';
    el.setPassMsg.textContent = 'at least 6 characters.';
    return;
  }
  el.btnSetPass.disabled = true;
  el.setPassMsg.dataset.state = 'busy';
  el.setPassMsg.textContent = 'changing it…';
  try {
    await db.setPassword(pw);
    el.setPass.value = '';
    el.setPass.type = 'password';
    el.setPassEye.setAttribute('aria-pressed', 'false');
    el.setPassMsg.dataset.state = 'ok';
    el.setPassMsg.textContent = 'changed — use the new one next time you sign in.';
  } catch (err) {
    el.setPassMsg.dataset.state = 'bad';
    el.setPassMsg.textContent = friendly(err);
  } finally {
    el.btnSetPass.disabled = false;
  }
});
el.btnDeleteAccount.addEventListener('click', deleteMyAccount);

/* the answer hangs over the note; it must be easy to put away */
function closeAgentAnswer() {
  if (el.agentOut.hidden) return false;
  el.agentOut.hidden = true;
  agentMsg('');
  return true;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = el.agent.classList.contains('open');
  if (closeAgentAnswer() || open) {
    if (open) setAgentOpen(false);
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
document.addEventListener('pointerdown', (e) => {
  if (el.agent.contains(e.target) || e.target === el.agentOpen) return;
  if (el.agent.classList.contains('open')) setAgentOpen(false);
  if (!el.agentOut.hidden) closeAgentAnswer();
});

el.agentOpen.addEventListener('click', () => setAgentOpen(!el.agent.classList.contains('open')));
el.agentForm.addEventListener('submit', runAgent);
el.agentAdd.addEventListener('click', () => agentInto('end'));
el.agentReplace.addEventListener('click', () => agentInto('all'));
el.agentDrop.addEventListener('click', () => {
  agentAnswer = '';
  el.agentOut.hidden = true;
  agentMsg('');
});

/* A message someone can paste into a chat. The app sends no mail, so this is the
 * whole notification story: one line, one link, no account needed for a link. */
async function copyShareMessage() {
  const note = S.current;
  if (!note) return;

  const grants = noteShares(note.id);
  const pub = grants.find((g) => g.code);
  const people = grants.filter((g) => g.email && !g.pending);
  const title = note.title?.trim() || 'untitled';
  const where = location.origin + location.pathname;

  const lines = ['"' + title + '" — a note I shared with you.'];
  if (pub) lines.push('open it here, no account needed: ' + shareUrl(pub.code));
  if (people.length) {
    lines.push((pub ? 'or sign in at ' : 'sign in at ') + where +
      ' with the address this came to, and it is in your list.');
  }
  if (!pub && !people.length) lines.push('nothing is shared yet.');

  const text = lines.join('\n');
  if (await copyText(text)) shareMsg('the message is on your clipboard.');
  else shareMsg(text);
}

/* ── who is behind an address? ────────────────────────────────────────
 * Sharing by address is a promise that the address belongs to the person. With
 * no email confirmation the app cannot prove it, so it shows what it knows
 * before the grant is made: the name on that account and how old it is. A
 * minute-old account claiming a friend's address is then visible, and the
 * owner — not the app — decides.
 */
let hintTimer = 0;
let hintSeq = 0;

function whoHint(text, state = '') {
  el.shareWhoHint.textContent = text || '';
  el.shareWhoHint.hidden = !text;
  if (state) el.shareWhoHint.dataset.state = state;
  else delete el.shareWhoHint.dataset.state;
}

function accountAge(iso) {
  const made = new Date(iso);
  if (Number.isNaN(made.getTime())) return 'at an unknown time';

  const days = (Date.now() - made.getTime()) / 86400000;
  if (days < 1) return 'just now';
  if (days < 7) return Math.round(days) === 1 ? 'yesterday' : Math.round(days) + ' days ago';
  return 'on ' + made.toLocaleDateString();
}

async function showWhoHint(email) {
  const seq = ++hintSeq;
  let hint;
  try { hint = await db.accountHint(email); } catch { return; }
  if (seq !== hintSeq) return;          // a newer address was typed meanwhile

  if (!hint) {
    whoHint('no account with this address yet — the invitation will wait.', 'wait');
    return;
  }

  const age = accountAge(hint.made);
  const made = new Date(hint.made).getTime();
  const fresh = Number.isFinite(made) && Date.now() - made < 36 * 3600 * 1000;

  whoHint([hint.name, 'account made ' + age].filter(Boolean).join(' · '),
    fresh ? 'new' : 'known');
}

el.shareEmail.addEventListener('input', () => {
  clearTimeout(hintTimer);
  if (!el.shareEmail.value.trim()) { hintSeq++; whoHint(''); return; }
  hintTimer = setTimeout(() => showWhoHint(toAuthEmail(el.shareEmail.value)), 350);
});

/* ── a link to the chapter you are reading ─────────────────────────── */
el.readerMdCopy.addEventListener('click', copyReaderMarkdown);
el.readerOwn.addEventListener('click', copyReaderToMine);

el.readerCopy.addEventListener('click', async () => {
  const ok = await copyText(location.href);
  const was = el.readerCopy.textContent;
  el.readerCopy.textContent = ok ? 'copied' : 'select the address bar';
  el.readerCopy.disabled = true;
  setTimeout(() => { el.readerCopy.textContent = was; el.readerCopy.disabled = false; }, 1600);
});

/* ── the settings dialog, and the dock ─────────────────────────────
 * Same dialog as every other app, same dock. The dock reads what is on
 * screen and answers about it; nothing it writes lands anywhere until a
 * person says so. */
let SET = null;

function wireSettings() {
  SET = settings.mountSettings({
    dialog: document.getElementById('ai-dialog'),
    proxy: engine.PROXY,
    onSaved: () => { try { paintSpec(); } catch { } try { paintAiHint(); } catch { } },
  });
  const gear = document.getElementById('btn-ai');
  if (gear) gear.onclick = () => SET.open();
}

wireSettings();

const DOCK = mountDock({ app: 'vn', openSettings: () => SET && SET.open() });
