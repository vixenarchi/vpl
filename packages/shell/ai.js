/* vpl · the suite's model settings, in one place.
 *
 * Copied into each app's vendor/ by tools/stage.sh, never imported across apps:
 * an app published alone still owns its copy, which is what "shared service,
 * independent apps" means here. Change this file, run tools/stage.sh <app>, and
 * that app carries the new list.
 *
 * What lives here is only the list of doors and the shape of the settings.
 * Where a key is stored is the browser's business, and it is per address — the
 * same person on vn and vi pastes a key twice, because localStorage does not
 * cross subdomains. There is no server to share it through, and that is the
 * point of the suite.
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
