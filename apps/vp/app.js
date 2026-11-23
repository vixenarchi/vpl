import * as settings from './vendor/settings.js';
import * as engine from './vendor/engine.js';
import * as who from './vendor/who.js';
import { mountDock } from './vendor/dock.js';
/* vpl · vp — slips, keys and the ledger, in one screen.
 *
 * Three verbs: make (a code), take (a code somebody gave you), revoke (either).
 * Everything else on the page is a list of what happened, because a key drawer
 * without a ledger is a mystery.
 */
import * as db from './lib/db.js';
import { writeAi, readAi, accountAi } from './vendor/ai.js';

const DOOR = 'https://api.terg.hr/vp';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = { session: null, codes: [], keys: [], charges: [], slips: [] };

/* ── small helpers ────────────────────────────────────────────────── */
function msg(el, text, kind = '') {
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2200);
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function day(iso) {
  if (!iso) return 'no expiry';
  return 'until ' + when(iso);
}

function lowerField(el) {
  el.addEventListener('input', () => {
    const low = el.value.toLowerCase();
    if (low === el.value) return;
    const at = el.selectionStart;
    el.value = low;
    try { el.setSelectionRange(at, at); } catch {}
  });
}

/* names and addresses ignore case; passwords never do */
function toAuthEmail(v) {
  const t = v.trim();
  return t.includes('@') ? t.toLowerCase() : t.toLowerCase().replace(/\s+/g, '') + '@vpl.local';
}

/* The name in the corner is the suite's, not this app's (vendor/who.js):
 * the name Google gave us, else the address tidied, else a letter. */
function displayName(session) {
  return who.whoLabel(session);
}

function plainAuthError(err) {
  const m = String(err?.message || err || '');
  if (/already registered/i.test(m)) return 'that address already has an account — sign in instead';
  if (/invalid login credentials/i.test(m)) return 'wrong address or password';
  if (/invalid format|validate email/i.test(m)) return 'that does not look like an address';
  return m || 'could not sign in';
}

/* ── theme ────────────────────────────────────────────────────────── */
function applyTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('vpl.theme', next); } catch {}
}

/* ── the gate ─────────────────────────────────────────────────────── */
function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  $('#email').focus();
}

async function enterApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = displayName(S.session);
  $('#who').title = S.session?.user?.email || '';
  /* a code spends the issuer's key, so say plainly when there is none */
  try {
    const mine = await accountAi();
    $('#key-warn').hidden = !!mine?.key;
  } catch { $('#key-warn').hidden = true; }
  await paintAll();
}

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg($('#gate-msg'), 'signing in…', 'busy');
  try {
    await db.signIn(toAuthEmail($('#email').value), $('#pass').value);
    $('#gate-msg').textContent = '';
    S.session = await db.session();
    await enterApp();
  } catch (err) {
    msg($('#gate-msg'), plainAuthError(err), 'bad');
  }
});

$('#btn-register').addEventListener('click', async () => {
  const email = toAuthEmail($('#email').value);
  const pass = $('#pass').value;
  if (!email || pass.length < 6) {
    return msg($('#gate-msg'), 'a name or an address, and a password of six characters or more', 'bad');
  }
  try {
    await db.signUp(email, pass);
    S.session = await db.session();
    if (!S.session) return msg($('#gate-msg'), 'check your mailbox to confirm', 'ok');
    await enterApp();
  } catch (err) {
    msg($('#gate-msg'), plainAuthError(err), 'bad');
  }
});

/* ── making slips ─────────────────────────────────────────────────── */
$('#mk-go').addEventListener('click', async () => {
  const count = Number($('#mk-count').value) || 1;
  const credits = Number($('#mk-credits').value) || 1;
  const until = $('#mk-until').value || null;
  const label = $('#mk-label').value.trim();
  msg($('#mk-msg'), 'making them…', 'busy');
  try {
    const slips = await db.makeCodes({ count, credits, until, label });
    S.slips = slips;
    renderSlips(slips);
    msg($('#mk-msg'), slips.length + (slips.length === 1 ? ' code made' : ' codes made'), 'ok');
    await paintCodes();
  } catch (err) {
    msg($('#mk-msg'), err.message || String(err), 'bad');
  }
});

function renderSlips(slips) {
  const box = $('#slips');
  box.hidden = !slips.length;
  $('#slip-list').innerHTML = slips.map((s) => `
    <li class="slip">
      <span class="slip-code">${esc(s.code)}</span>
      <span class="slip-meta">${s.credits} calls · ${day(s.valid_until)}${s.label ? ' · ' + esc(s.label) : ''}</span>
    </li>`).join('');
  $('#print-slips').textContent = slips.map((s) => (
    `${s.code}   ${s.credits} calls   ${day(s.valid_until)}${s.label ? '   ' + s.label : ''}`
  )).join('\n') + `\n\nuse it as a model key:\n  address  ${DOOR}\n  model    ${readAi().model || '(any the issuer allows)'}\n`;
}

$('#slips-copy').addEventListener('click', async () => {
  const text = S.slips.map((s) => s.code).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('copied');
  } catch {
    toast('the browser said no — select the codes by hand');
  }
});

$('#slips-print').addEventListener('click', () => window.print());

/* ── the codes already made ───────────────────────────────────────── */
async function paintCodes() {
  let rows = [];
  try { rows = await db.listCodes(); } catch (err) { msg($('#mk-msg'), err.message, 'bad'); }
  S.codes = rows;
  $('#codes-none').hidden = rows.length > 0;
  $('#codes').innerHTML = rows.map((c) => {
    const state = c.revoked ? 'revoked'
      : c.redeemed_by ? 'taken ' + when(c.redeemed_at)
      : 'waiting';
    return `<li data-id="${esc(c.id)}">
      <span class="r-label">${esc(c.label)}</span>
      <span class="r-meta">${c.credits} calls · ${day(c.valid_until)}</span>
      <span class="r-state ${c.redeemed_by ? 'used' : 'waiting'}">${esc(state)}</span>
      ${c.revoked ? '' : '<button class="ghost danger" data-kill="code" type="button">revoke</button>'}
    </li>`;
  }).join('');
  $('#codes').querySelectorAll('[data-kill="code"]').forEach((b) => {
    b.onclick = async () => {
      const li = b.closest('li');
      if (!confirm('revoke this code? anyone holding the slip will be refused.')) return;
      await db.revokeCode(li.dataset.id);
      await paintCodes();
      toast('revoked');
    };
  });
}

/* ── taking a code ────────────────────────────────────────────────── */
$('#rd-go').addEventListener('click', async () => {
  const code = $('#rd-code').value.trim();
  if (!code) return msg($('#rd-msg'), 'paste the code first', 'bad');
  msg($('#rd-msg'), 'checking…', 'busy');
  try {
    const got = await db.redeem(code);
    if (!got) throw new Error('that code did not answer');
    $('#rd-out').hidden = false;
    $('#rd-url').textContent = DOOR;
    $('#rd-model').textContent = got.model || '';
    $('#rd-key').textContent = got.api_key;
    $('#rd-key').dataset.key = got.api_key;
    $('#rd-key').dataset.model = got.model || '';
    msg($('#rd-msg'), `${got.credits} calls, ${day(got.valid_until)}`, 'ok');
    $('#rd-code').value = '';
    await paintKeys();
  } catch (err) {
    msg($('#rd-msg'), err.message || String(err), 'bad');
  }
});

$('#rd-use').addEventListener('click', () => {
  const key = $('#rd-key').dataset.key;
  const model = $('#rd-key').dataset.model;
  if (!key) return;
  writeAi({ url: DOOR, model, key });
  msg($('#rd-use-msg'), 'in this browser now — every app here uses it until you change it', 'ok');
});

$('#rd-copy').addEventListener('click', async () => {
  const key = $('#rd-key').dataset.key;
  if (!key) return;
  try { await navigator.clipboard.writeText(key); toast('key copied'); }
  catch { toast('the browser said no — select it by hand'); }
});

/* ── keys ─────────────────────────────────────────────────────────── */
async function paintKeys() {
  let rows = [];
  try { rows = await db.listKeys(); } catch (err) { toast(err.message); }
  S.keys = rows;
  $('#keys-none').hidden = rows.length > 0;
  const me = S.session?.user?.id;
  $('#keys').innerHTML = rows.map((k) => {
    const mine = k.holder_id === me;
    const state = k.revoked ? 'revoked'
      : k.credits_left < 1 ? 'spent'
      : mine ? 'yours' : 'given out';
    return `<li data-id="${esc(k.id)}" class="${k.credits_left < 1 || k.revoked ? 'spent' : ''}">
      <span class="r-label">${esc(k.label)}</span>
      <span class="r-meta">${k.credits_left} calls left · ${day(k.valid_until)} · ${k.calls} used</span>
      <span class="r-state ${k.credits_left < 1 ? 'low' : mine ? 'used' : 'waiting'}">${state}</span>
      ${k.revoked ? '' : '<button class="ghost danger" data-kill="key" type="button">revoke</button>'}
    </li>`;
  }).join('');
  $('#keys').querySelectorAll('[data-kill="key"]').forEach((b) => {
    b.onclick = async () => {
      const li = b.closest('li');
      if (!confirm('revoke this key? calls through it stop now.')) return;
      await db.revokeKey(li.dataset.id);
      await paintKeys();
      toast('revoked');
    };
  });
}

/* ── the ledger ───────────────────────────────────────────────────── */
async function paintCharges() {
  let rows = [];
  try { rows = await db.charges(); } catch { rows = []; }
  S.charges = rows;
  $('#spent-none').hidden = rows.length > 0;
  $('#charges').innerHTML = rows.map((c) => {
    const okCall = c.status >= 200 && c.status < 400;
    const tokens = (c.in_tokens + c.out_tokens)
      ? `${c.in_tokens} in · ${c.out_tokens} out` : 'no tokens';
    return `<li>
      <span class="r-label mono">${esc(c.model || 'unknown model')}</span>
      <span class="r-meta">${when(c.created_at)} · ${tokens} · ${c.ms} ms</span>
      <span class="r-state ${okCall ? 'used' : 'low'}">${okCall ? 'answered' : 'refused ' + c.status}</span>
    </li>`;
  }).join('');
}

async function paintAll() {
  await Promise.all([paintCodes(), paintKeys(), paintCharges()]);
}

/* ── boot ─────────────────────────────────────────────────────────── */
async function boot() {
  $('#btn-theme').onclick = applyTheme;
  const gateTheme = document.getElementById('gate-theme');
  if (gateTheme) gateTheme.onclick = applyTheme;
  $('#btn-out').onclick = async () => { await db.signOut(); location.reload(); };
  lowerField($('#email'));

  /* a default expiry date is a kindness: today plus a year */
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  $('#mk-until').value = d.toISOString().slice(0, 10);

  db.onAuthChange((s) => { if (!s) showGate(); });

  S.session = await db.session().catch(() => null);
  if (!S.session) return showGate();
  await enterApp();
}

boot();

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
  const gear = document.getElementById('btn-ai');
  if (gear) gear.onclick = () => SET.open();
}

wireSettings();

const DOCK = mountDock({ app: 'vp', openSettings: () => SET && SET.open() });
