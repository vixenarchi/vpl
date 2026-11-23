/* vpl · the suite's model settings, in one place.
 *
 * Copied into each app's vendor/ by tools/stage.sh, never imported across apps:
 * an app published alone still owns its copy, which is what "shared service,
 * independent apps" means here. Change this file, run tools/stage.sh <app>, and
 * that app carries the new list.
 *
 * What lives here is the list of doors, the shape of the settings, and the one
 * thing every app may read from the database: the key of record (`vpl_ai`).
 *
 * A key is still per browser, because localStorage does not cross subdomains.
 * But it can be saved on the account once, and then every app, on every
 * address, in every browser, adopts it quietly when it finds itself without
 * one. The call still leaves from the browser and the key still goes only to
 * the provider — this is a drawer, not a proxy. (The proxy is stage 2 of vp.)
 */

export const AI_KEY = 'vpl.ai';
export const SEARCH_KEY = 'vpl.search';

/* One line per provider: the base url the app appends /chat/completions to, and
 * a few models worth trying. `note` is what a person would say about it. */
export const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', models: [
    { id: 'gpt-4o-mini', note: 'cheap and quick' },
    { id: 'gpt-4o', note: 'the good one' },
  ] },
  { id: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [
    { id: 'gemini-3.1-flash-lite', note: 'quick, obeys this suite' },
    { id: 'gemini-3-flash-preview', note: 'newer, chatty' },
    { id: 'gemini-3.1-pro-preview', note: 'slow, careful' },
  ] },
  { id: 'nvidia', label: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', models: [
    { id: 'nvidia/nemotron-3.5-bolt-e4b', note: 'the fastest' },
    { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', note: 'better prose, slow' },
    { id: 'mistralai/mistral-large-4-1t-a52b', note: 'a writer, over a minute' },
  ] },
  { id: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', models: [
    { id: 'llama-3.3-70b-versatile', note: 'fast llama' },
  ] },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', models: [
    { id: 'meta-llama/llama-3.3-70b-instruct', note: 'one key, many models' },
  ] },
  { id: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1', models: [
    { id: 'mistral-large-latest', note: 'large' },
  ] },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1', models: [
    { id: 'deepseek-chat', note: 'cheap' },
  ] },
  { id: 'together', label: 'Together', url: 'https://api.together.xyz/v1', models: [] },
  { id: 'xai', label: 'xAI', url: 'https://api.x.ai/v1', models: [
    { id: 'grok-2-latest', note: 'grok 2' },
  ] },
  { id: 'fireworks', label: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1', models: [] },
  { id: 'cerebras', label: 'Cerebras', url: 'https://api.cerebras.ai/v1', models: [] },
  { id: 'novita', label: 'Novita', url: 'https://api.novita.ai/v3/openai', models: [] },
  { id: 'hyperbolic', label: 'Hyperbolic', url: 'https://api.hyperbolic.xyz/v1', models: [] },
  { id: 'custom', label: 'somewhere else', url: '', models: [] },
];

export const SEARCH_PROVIDERS = [
  { id: '', label: 'none' },
  { id: 'tavily', label: 'Tavily', hint: '1 000 free a month, no card' },
  { id: 'serper', label: 'Serper', hint: '2 500 free credits' },
];

export function providerFor(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return null;
  return PROVIDERS.find((p) => p.url && (u === p.url || u.startsWith(p.url))) || null;
}

/* A base url or the full one; people paste both. `…/openai` is Gemini's shape —
 * appending /v1 there would land on a 404 with a helpful but useless message. */
export function aiEndpoint(url) {
  const u = (url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/openai$/.test(u)) return u + '/chat/completions';
  if (/\/v\d+$/.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}

function write(key, value) {
  try {
    if (value && Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {}
}

export const readAi = () => ({
  url: read(AI_KEY).url || '',
  key: read(AI_KEY).key || '',
  model: read(AI_KEY).model || '',
});

export function writeAi(next) {
  const cur = readAi();
  write(AI_KEY, { ...cur, ...next });
}

export const readSearch = () => ({
  provider: read(SEARCH_KEY).provider || '',
  key: read(SEARCH_KEY).key || '',
});

export function writeSearch(next) {
  write(SEARCH_KEY, { provider: next.provider || '', key: next.key || '' });
}

export function forgetKeys() {
  localStorage.removeItem(AI_KEY);
  localStorage.removeItem(SEARCH_KEY);
}

/* Fill a settings form and keep it honest: choosing a provider writes its url
 * and offers its models; typing a url from elsewhere flips the select to
 * "somewhere else" instead of lying about where the key is going. */
export function mountAi({ provider, url, model, models }) {
  const ai = readAi();
  provider.innerHTML = PROVIDERS
    .map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

  const paintModels = () => {
    if (!models) return;
    const p = PROVIDERS.find((x) => x.id === provider.value);
    models.innerHTML = (p?.models || [])
      .map((m) => `<option value="${m.id}">${m.note ? m.id + ' · ' + m.note : m.id}</option>`).join('');
  };

  provider.value = (providerFor(ai.url) || {}).id || 'custom';
  url.value = ai.url;
  model.value = ai.model;
  paintModels();

  provider.addEventListener('change', () => {
    const p = PROVIDERS.find((x) => x.id === provider.value);
    if (!p || !p.url) { url.focus(); return; }
    url.value = p.url;
    if (!model.value || !p.models.some((m) => m.id === model.value)) {
      model.value = p.models[0]?.id || '';
    }
    paintModels();
  });

  url.addEventListener('blur', () => {
    const p = providerFor(url.value);
    if (p) { provider.value = p.id; paintModels(); }
  });

  return {
    read: () => ({ url: url.value.trim(), key: '', model: model.value.trim() }),
    paintModels,
  };
}

/* ── the key of record (stage 1 of vp) ──────────────────────────────
 *
 * One row per person in `vpl_ai`, readable by nobody else. The apps read it,
 * copy it into localStorage and otherwise behave exactly as before. If this
 * whole section fails — no config, no token, no table — the suite still works
 * with a pasted key, which is why it is a fallback and not in the path of
 * every call.
 *
 * The token is the app's own session, read from the same localStorage key
 * supabase-js writes; this file deliberately creates no second auth client.
 * The database is reached with plain fetch, so the suite keeps its shape:
 * no bundler, no library beyond the page's own.
 */

const AI_TABLE = 'vpl_ai';

function authBase() {
  const c = window.__VPL_CONFIG__;
  const m = c && c.url ? c.url.match(/^https?:\/\/([^.]+)/) : null;
  return m ? 'sb-' + m[1] + '-auth-token' : null;
}

/* supabase-js stores one JSON blob, or several chunks when the session is
 * large: sb-<ref>-auth-token, .0, .1 ... */
function storedSession() {
  const base = authBase();
  if (!base) return null;
  let raw = localStorage.getItem(base);
  if (!raw) {
    const parts = Object.keys(localStorage).filter((k) => k.startsWith(base + '.')).sort();
    if (!parts.length) return null;
    raw = parts.map((k) => localStorage.getItem(k)).join('');
  }
  try { return JSON.parse(raw); } catch { return null; }
}

/* A token has to look like one before it is sent: three base64url parts. The
 * old code sent whatever was in storage, so a truncated chunk left by an older
 * supabase-js came out as `Bearer {"access…` and the database answered "Invalid
 * JWT serialization: Missing dot delimiter(s)" — a 401 that looked like a
 * permissions bug and was a parsing bug. */
function isJwt(t) {
  if (typeof t !== 'string') return false;
  const parts = t.split('.');
  return parts.length === 3 && parts.every((x) => x && /^[A-Za-z0-9_-]+$/.test(x));
}

/* The app's own supabase-js client knows the session and refreshes it; storage
 * can lag behind, or hold chunks. So the live session wins, and storage is only
 * a fallback for a page that has not registered one. */
let tokenSource = null;
export function setTokenSource(fn) { tokenSource = fn; }

async function tokenNow() {
  if (tokenSource) {
    try {
      const t = await tokenSource();
      if (isJwt(t)) return t;
    } catch { /* the source is the app's business, not ours */ }
  }
  return storedToken();
}

function storedToken() {
  const s = storedSession();
  const t = s?.access_token || s?.currentSession?.access_token || null;
  return isJwt(t) ? t : null;
}

/** Who this browser is signed in as, read from storage. Shared by every tab on
 *  this origin, so it is the only way to notice that another tab signed in as
 *  somebody else: supabase-js keeps its own session in memory and will happily
 *  report the person it started with. */
export function storedId() {
  const t = storedToken();
  return t ? tokenUser(t) : null;
}

/** The signed-in person's id, or null — the one honest answer to "is anybody
 *  here", asked through the same token the requests will use. */
export async function sessionId() {
  const t = await tokenNow();
  return t ? tokenUser(t) : null;
}

function tokenUser(token) {
  try {
    const body = token.split('.')[1];
    return JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
  } catch { return null; }
}

async function rest(path, init = {}) {
  const c = window.__VPL_CONFIG__;
  const token = await tokenNow();
  if (!c?.url || !token) return { token: null, data: [], status: 0 };
  const r = await fetch(c.url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: c.anon,
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { token, status: r.status, data };
}

/* The row, or null when signed out / nothing saved. A missing key is not an
 * error, so this never throws for the ordinary reasons. */
export async function accountAi() {
  const { data } = await rest(AI_TABLE + '?select=url,model,api_key,updated_at&limit=1');
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  return { url: row.url || '', model: row.model || '', key: row.api_key || '', updated: row.updated_at };
}

export async function saveAccountAi({ url, model, key }) {
  const token = await tokenNow();
  if (!token) throw new Error('sign in first');
  const id = tokenUser(token);
  if (!id) throw new Error('this session has no name');
  const res = await rest(AI_TABLE + '?on_conflict=user_id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: id, url: url || '', model: model || '', api_key: key || '',
      updated_at: new Date().toISOString() }),
  });
  if (res.status >= 300) throw new Error('the account refused it (' + res.status + ')');
}

export async function forgetAccountAi() {
  const token = await tokenNow();
  const id = token && tokenUser(token);
  if (!id) return;
  await rest(AI_TABLE + '?user_id=eq.' + id, { method: 'DELETE' });
}

/* A new browser with no key takes the account's, quietly, once. Returns true
 * when it did — the app uses that to repaint whatever says "no key yet". */
export async function adoptAccountAi() {
  if (readAi().key) return false;
  let row = null;
  try { row = await accountAi(); } catch { return false; }
  if (!row || !row.key) return false;
  writeAi({ url: row.url, model: row.model, key: row.key });
  return true;
}

/* The three buttons under the key field. `read` returns what is currently in
 * the form, so saving to the account saves the same thing as saving here. */
export function mountAccountAi({ box, read }) {
  let signedIn = false;
  let note = '';

  async function repaint() {
    const row = signedIn ? await accountAi().catch(() => null) : null;
    const buttons = !signedIn ? ''
      : !row?.key
        ? `<button type="button" class="ghost" data-a="save">save to my account</button>`
        : `<button type="button" class="ghost" data-a="save">replace it on my account</button>
           <button type="button" class="ghost" data-a="use">use the account's key here</button>
           <button type="button" class="ghost danger" data-a="forget">remove from my account</button>`;
    const line = !signedIn
      ? 'sign in and one key follows you into every browser, on every address.'
      : !row?.key
        ? 'no key on your account yet.'
        : `on your account since ${when(row.updated)}.`;
    box.innerHTML = `<p class="ai-acc-note">${line}</p>${buttons}
      <p class="ai-acc-msg" aria-live="polite">${note}</p>`;
    box.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => act(b.dataset.a); });
  }

  async function act(what) {
    try {
      if (what === 'save') {
        const next = read();
        if (!next.key || !next.url) { note = 'both an address and a key, please'; return repaint(); }
        await saveAccountAi(next);
        writeAi(next);
        note = 'on your account, and in this browser';
      }
      if (what === 'use') {
        const fresh = await accountAi();
        if (!fresh?.key) { note = 'nothing on the account'; return repaint(); }
        writeAi({ url: fresh.url, model: fresh.model, key: fresh.key });
        note = 'the account\'s key is now in this browser';
      }
      if (what === 'forget') {
        await forgetAccountAi();
        note = 'gone from your account. this browser keeps its key until you forget it.';
      }
    } catch (e) {
      note = e.message || 'that did not work';
    }
    await repaint();
  }

  async function init() {
    signedIn = !!(await sessionId());
    await repaint();
  }
  init();
  return { paint: repaint, refresh: init };
}

/* "20 Nov 2026" without a date library and without a timezone argument. */
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'earlier';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
