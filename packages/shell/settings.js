/* vpl · the settings dialog, one component for every app.
 *
 * Copied into apps/<name>/vendor/ by tools/stage.sh, like ai.js and engine.js —
 * an app published alone still owns its copy. What it is, is one dialog: four
 * tabs (model, search, key, theme), one row of buttons (test, forget, save), and
 * no per-app variants. An app that invents its own settings is an app whose
 * settings nobody can find twice.
 *
 * It talks to ai.js for the keys and to nothing else. The theme is a
 * `data-theme` attribute on <html>, so a theme is a palette in tokens.css and
 * not code in an app.
 */

import {
  PROVIDERS, SEARCH_PROVIDERS, aiEndpoint, providerFor,
  readAi, writeAi, readSearch, writeSearch, forgetKeys,
  accountAi, saveAccountAi, forgetAccountAi,
} from './ai.js';

export const THEMES = [
  { id: 'light', label: 'paper', note: 'the default' },
  { id: 'dark', label: 'ink', note: 'for a dark room' },
  { id: 'vi', label: 'comic', note: 'vi\'s poster paper, everywhere' },
];

export const THEME_KEY = 'vpl.theme';

export function currentTheme() {
  const t = readTheme();
  return THEMES.some((x) => x.id === t) ? t : 'light';
}

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
}

export function applyTheme(id) {
  const t = THEMES.some((x) => x.id === id) ? id : 'light';
  const root = document.documentElement;
  if (t === 'light') delete root.dataset.theme;
  else root.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  return t;
}

/** The bar's ◐ is a shortcut, not a second opinion: it walks the same list. */
export function cycleTheme() {
  const now = currentTheme();
  const i = THEMES.findIndex((t) => t.id === now);
  return applyTheme(THEMES[(i + 1) % THEMES.length].id);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── the component ───────────────────────────────────────────────────
 * mountSettings({ dialog, proxy, appName }) → { open, close, refresh }
 * The dialog is an empty <dialog id="ai-dialog"> in the page; this fills it. */
export function mountSettings({ dialog, proxy, onSaved } = {}) {
  /* the address a test call goes through: this deployment's `proxy`, if it has
   * one. A test with nowhere to go says exactly that instead of hanging. */
  proxy = proxy ?? ((window.__VPL_CONFIG__ || {}).proxy || '');
  if (!dialog) throw new Error('mountSettings needs the dialog element');
  let tab = 'model';
  let note = '';
  let busy = false;

  dialog.classList.add('settings');
  dialog.innerHTML = `
    <div class="set-head">
      <h2>settings</h2>
      <button class="set-mode" type="button" data-a="mode" aria-label="dark or normal"
              title="dark or normal — one press (the theme tab has all three)">◐</button>
      <button class="dialog-x" type="button" data-a="close" aria-label="close">✕</button>
    </div>

    <div class="set-tabs" role="tablist" aria-label="settings sections">
      <button type="button" role="tab" data-tab="model">model</button>
      <button type="button" role="tab" data-tab="search">search</button>
      <button type="button" role="tab" data-tab="key">key</button>
      <button type="button" role="tab" data-tab="theme">theme</button>
    </div>

    <div class="set-panels">
    <section class="set-panel" data-panel="model">
      <div class="set-row">
        <label for="set-provider">provider</label>
        <select id="set-provider"></select>
      </div>
      <div class="set-row">
        <label for="set-url">address</label>
        <input id="set-url" type="text" spellcheck="false" autocapitalize="none"
               autocomplete="off" placeholder="https://api.openai.com/v1">
      </div>
      <div class="set-row">
        <label for="set-model">model</label>
        <input id="set-model" type="text" spellcheck="false" autocapitalize="none"
               autocomplete="off" list="set-models" placeholder="gpt-4o-mini">
        <datalist id="set-models"></datalist>
      </div>
      <div class="set-row">
        <label for="set-key">key</label>
        <input id="set-key" type="password" spellcheck="false" autocapitalize="none"
               autocomplete="off" placeholder="sk-…">
      </div>
      <p class="set-note">the key goes from this browser to the address above, and nowhere else.</p>
    </section>

    <section class="set-panel" data-panel="search">
      <div class="set-row">
        <label for="set-search">search</label>
        <select id="set-search">
          ${SEARCH_PROVIDERS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
        </select>
      </div>
      <div class="set-row">
        <label for="set-search-key">key</label>
        <input id="set-search-key" type="password" spellcheck="false" autocapitalize="none"
               autocomplete="off" placeholder="tvly-… or a Serper key">
      </div>
      <p class="set-note">evidence for “find facts”. optional, and works without it.</p>
    </section>

    <section class="set-panel" data-panel="key">
      <p class="set-note" id="set-acc-line">sign in and one key follows you into every browser, on every address.</p>
      <div class="set-acc" id="set-acc"></div>
    </section>

    <section class="set-panel" data-panel="theme">
      <div class="set-themes" id="set-themes">
        ${THEMES.map((t) => `<button type="button" class="set-theme" data-theme="${esc(t.id)}">
            <span class="set-theme-name">${esc(t.label)}</span>
            <span class="set-theme-note">${esc(t.note)}</span>
          </button>`).join('')}
      </div>
      <p class="set-note">a theme is a palette; it changes colour, never a button's meaning.</p>
    </section>
    </div>

    <p class="set-msg" aria-live="polite"></p>
    <div class="set-foot">
      <button type="button" class="ghost" data-a="test">test</button>
      <button type="button" class="ghost danger" data-a="forget">forget</button>
      <button type="button" class="primary" data-a="save">save</button>
    </div>`;

  const $ = (sel) => dialog.querySelector(sel);
  const provider = $('#set-provider');
  const url = $('#set-url');
  const model = $('#set-model');
  const key = $('#set-key');
  const models = $('#set-models');
  const search = $('#set-search');
  const searchKey = $('#set-search-key');

  provider.innerHTML = PROVIDERS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');

  function setTab(next) {
    tab = next;
    dialog.querySelectorAll('[data-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    /* Every panel keeps its place and its height, and the one that is not
     * showing is made invisible instead of removed: a dialog that resized
     * itself on every tab weighed the settings, not the setting. */
    dialog.querySelectorAll('[data-panel]').forEach((p) => {
      const active = p.dataset.panel === tab;
      /* not the `hidden` attribute: that one is `display: none !important` in
       * the tokens, and a tab that leaves the layout is a dialog that resizes */
      p.classList.toggle('off', !active);
      p.setAttribute('aria-hidden', String(!active));
      if ('inert' in p) p.inert = !active;
    });
    if (tab === 'key') paintAccount();
    if (tab === 'theme') paintThemes();
    paintMode();
  }

  function paintModels() {
    const p = PROVIDERS.find((x) => x.id === provider.value);
    models.innerHTML = (p?.models || []).map((m) => `<option value="${esc(m.id)}">`).join('');
  }

  /* one press: dark or normal. It writes the same palette the tab writes, so
   * the two can never disagree — the button is a shortcut, not a second state. */
  function toggleMode() {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    paintThemes();
    paintMode();
    say(currentTheme() === 'dark' ? 'ink, for a dark room.' : 'paper, the default.');
  }

  /* The icon is the same ◐ the bar used to carry: half-filled is "there is a
   * dark side", and pressing it walks between them. The palette tab underneath
   * is where the three named themes live. */
  function paintMode() {
    const b = $('[data-a=mode]');
    if (!b) return;
    const dark = currentTheme() !== 'light';
    b.textContent = dark ? '☀' : '◐';
    b.setAttribute('aria-pressed', String(dark));
    b.title = dark ? 'back to paper' : 'ink, for a dark room';
  }

  function paintThemes() {
    const cur = currentTheme();
    dialog.querySelectorAll('.set-theme').forEach((b) => {
      const on = b.dataset.theme === cur;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    });
  }

  function say(text, state = '') {
    note = text;
    const el = $('.set-msg');
    el.textContent = text;
    el.dataset.state = state;
  }

  function fillForm() {
    const ai = readAi();
    const s = readSearch();
    provider.value = (providerFor(ai.url) || {}).id || (ai.url ? 'custom' : 'gemini');
    if (!provider.value) provider.value = 'gemini';
    url.value = ai.url || (PROVIDERS.find((p) => p.id === provider.value)?.url || '');
    model.value = ai.model || (PROVIDERS.find((p) => p.id === provider.value)?.models[0]?.id || '');
    key.value = ai.key || '';
    paintModels();
    search.value = s.provider || '';
    searchKey.value = s.key || '';
  }

  async function paintAccount() {
    const line = $('#set-acc-line');
    const box = $('#set-acc');
    const row = await accountAi().catch(() => null);
    const signedIn = signedInNow();
    if (!signedIn) {
      line.textContent = 'sign in and one key follows you into every browser, on every address.';
      box.innerHTML = '';
      return;
    }
    if (!row?.key) {
      line.textContent = 'no key on your account yet. save the one from the model tab and it follows you.';
      box.innerHTML = '<button type="button" class="ghost" data-acc="save">save to my account</button>';
    } else {
      line.textContent = 'on your account — every app, every browser, on this account.';
      box.innerHTML = `
        <button type="button" class="ghost" data-acc="save">replace it on my account</button>
        <button type="button" class="ghost" data-acc="use">use the account's key here</button>
        <button type="button" class="ghost danger" data-acc="remove">remove from my account</button>`;
    }
    box.querySelectorAll('[data-acc]').forEach((b) => { b.onclick = () => accountAct(b.dataset.acc); });
  }

  function signedInNow() {
    try {
      const c = window.__VPL_CONFIG__ || {};
      const ref = (String(c.url || '').match(/^https?:\/\/([^.]+)/) || [])[1];
      if (!ref) return false;
      return Object.keys(localStorage).some((k) => k.startsWith(`sb-${ref}-auth-token`) && localStorage.getItem(k));
    } catch { return false; }
  }

  function formValues() {
    return {
      url: url.value.trim(),
      model: model.value.trim(),
      key: key.value.trim() || readAi().key,
    };
  }

  async function accountAct(what) {
    try {
      if (what === 'save') {
        const v = formValues();
        if (!v.url || !v.key) return say('an address and a key first, please', 'bad');
        await saveAccountAi(v);
        writeAi(v);
        say('saved to your account, and in this browser', 'ok');
      }
      if (what === 'use') {
        const row = await accountAi();
        if (!row?.key) return say('nothing on the account', 'bad');
        writeAi({ url: row.url, model: row.model, key: row.key });
        fillForm();
        say('the account\'s key is in this browser now', 'ok');
      }
      if (what === 'remove') {
        await forgetAccountAi();
        say('gone from your account; this browser keeps its key until you forget it', 'ok');
      }
      if (onSaved) onSaved();
    } catch (e) {
      say(e.message || 'that did not work', 'bad');
    }
    await paintAccount();
  }

  async function save() {
    const v = formValues();
    if (!v.url || !v.key) return say('a key and an address, then save', 'bad');
    writeAi(v);
    writeSearch({ provider: search.value, key: searchKey.value.trim() });
    applyTheme(currentTheme());
    say('saved in this browser', 'ok');
    if (onSaved) onSaved();
  }

  /* Test is a real call, one short one, through this app's own door: it proves
   * the key, the address, the model and the proxy in one go. Anything less is a
   * form that says "looks fine". */
  async function test() {
    const v = formValues();
    if (!v.url || !v.key) return say('nothing to test yet', 'bad');
    if (busy) return;
    busy = true;
    say('asking the model…', 'busy');
    const body = JSON.stringify({
      url: aiEndpoint(v.url), key: v.key, model: v.model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reply with the single word: ok' }],
      max_tokens: 16, temperature: 0,
    });
    try {
      let res = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      });
      if ((res.status === 404 || res.status === 405) && proxy) {
        res = await fetch(proxy, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        });
      }
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not json */ }
      if (!res.ok) {
        const why = data?.error?.message || data?.error || data?.raw || text || ('http ' + res.status);
        return say('the model said no: ' + String(why).slice(0, 160), 'bad');
      }
      const answer = String(data?.choices?.[0]?.message?.content ?? data?.content ?? '').trim();
      say(answer ? 'it answered: “' + answer.slice(0, 40) + '”' : 'it answered, with nothing to say', 'ok');
    } catch (e) {
      say('could not reach the door: ' + (e.message || e), 'bad');
    } finally {
      busy = false;
    }
  }

  function forget() {
    forgetKeys();
    key.value = '';
    searchKey.value = '';
    say('forgotten in this browser; the account\'s key is untouched', 'ok');
    if (onSaved) onSaved();
  }

  provider.addEventListener('change', () => {
    const p = PROVIDERS.find((x) => x.id === provider.value);
    if (!p || !p.url) { url.focus(); return; }
    url.value = p.url;
    if (!model.value || !p.models.some((m) => m.id === model.value)) model.value = p.models[0]?.id || '';
    paintModels();
  });

  url.addEventListener('blur', () => {
    const p = providerFor(url.value);
    if (p) { provider.value = p.id; paintModels(); }
  });

  /* Clicks land on whatever is under the finger — the label inside a button,
   * the mark inside a tab — so every branch asks for the nearest element that
   * carries the attribute. And the theme branch asks for `.set-theme`, not for
   * `[data-theme]`: <html> itself carries data-theme once a theme is applied,
   * so `closest('[data-theme]')` matched the page for every click in the dialog
   * and swallowed save, forget and close. */
  dialog.addEventListener('click', (e) => {
    const tabHit = e.target.closest('[data-tab]');
    if (tabHit) return setTab(tabHit.dataset.tab);
    const themeHit = e.target.closest('.set-theme');
    if (themeHit) {
      applyTheme(themeHit.dataset.theme);
      paintThemes();
      say('theme: ' + themeHit.dataset.theme, 'ok');
      return;
    }
    const aHit = e.target.closest('[data-a]');
    const a = aHit ? aHit.dataset.a : '';
    if (!a) return;
    if (a === 'close') return dialog.close();
    if (a === 'mode') return toggleMode();
    if (a === 'save') return save();
    if (a === 'test') return test();
    if (a === 'forget') return forget();
  });

  return {
    open() {
      fillForm();
      setTab('model');
      say('');
      dialog.showModal();
      /* who is signed in can have changed since this dialog was built: a page
       * that was signed out at load and signed in a second later would show a
       * stale "sign in and one key follows you" for the rest of the session. */
      void paintAccount();
    },
    close: () => dialog.close(),
    /* an app may have something to say in this dialog ("no key yet — paste one
     * here"), and it should say it in the same place as everything else */
    say: (text, state = '') => say(text, state),
    refresh: () => fillForm(),
    get tab() { return tab; },
  };
}
