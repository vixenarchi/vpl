/* vpl · the dock — a chat line at the bottom of every app.
 *
 * The suite has one shape: the bar on top says who you are and where the
 * settings are, the rail on the left is the project, the middle is the work,
 * and the dock on the bottom is the model. Every app gets the same dock, because
 * "ask about what is on screen" is not a feature of one of them.
 *
 * Two rules it keeps:
 *   - it answers about what is on screen, and it says so when there is nothing;
 *   - nothing it writes lands in a document on its own. The answer sits in the
 *     dock until a person presses *use it*, and the app decides what that means.
 *
 * Copied into apps/<name>/vendor/ by tools/stage.sh.
 */

import { readAi, aiEndpoint } from './ai.js';

const PROXY = 'https://api.terg.hr/chat';
const LIMIT = 12000;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountDock({ app = 'this app', context, onUse, placeholder, openSettings } = {}) {
  const el = document.createElement('section');
  el.id = 'dock';
  el.className = 'dock';
  el.innerHTML = `
    <div class="dock-line">
      <button type="button" class="dock-badge" data-a="toggle" aria-expanded="false"
              title="ask about what is on screen">✎</button>
      <form class="dock-form" autocomplete="off">
        <input class="dock-input" type="text" spellcheck="false"
               placeholder="${esc(placeholder || 'ask about what is on screen…')}" aria-label="ask the model">
        <button class="dock-go" type="submit">ask</button>
      </form>
      <button type="button" class="dock-x" data-a="hide" title="put the transcript away" hidden>▾</button>
    </div>
    <div class="dock-log" hidden>
      <div class="dock-thread" aria-live="polite"></div>
      <p class="dock-msg"></p>
    </div>`;
  /* The dock lives inside the app, under the work area, so the page gives it
   * room instead of hiding behind it: every app is a column — bar, work, dock.
   * If an app has no #app to hang it on, it falls back to a fixed strip. */
  const host = document.getElementById('app') || document.body;
  el.classList.toggle('in-flow', host.id === 'app');
  host.append(el);

  const input = el.querySelector('.dock-input');
  const form = el.querySelector('.dock-form');
  const log = el.querySelector('.dock-log');
  const thread = el.querySelector('.dock-thread');
  const msgEl = el.querySelector('.dock-msg');
  const hideBtn = el.querySelector('[data-a=hide]');
  const toggle = el.querySelector('[data-a=toggle]');
  let busy = false;

  const say = (text, state = '') => {
    msgEl.textContent = text || '';
    msgEl.dataset.state = state;
  };

  const say2 = (state) => { if (document.body) document.body.dataset.dock = state; };

  function show(open) {
    log.hidden = !open;
    hideBtn.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    el.classList.toggle('open', open);
    if (open) input.focus();
  }

  function bubble(role, text, canUse) {
    const row = document.createElement('div');
    row.className = 'dock-row ' + role;
    row.innerHTML = `<div class="dock-text">${esc(text)}</div>`
      + (canUse ? '<div class="dock-acts"><button type="button" class="ghost" data-use>use it</button>'
        + '<button type="button" class="link" data-drop>drop</button></div>' : '');
    thread.append(row);
    row.scrollIntoView({ block: 'nearest' });
    if (canUse) {
      row.querySelector('[data-use]').onclick = async () => {
        /* an app may refuse — "open a note you can edit first" — and it says so
         * in the dock instead of looking like it did something */
        let refusal = '';
        try { refusal = (await (onUse ? onUse(text) : '')) || ''; } catch (e) { refusal = e.message || String(e); }
        const acts = row.querySelector('.dock-acts');
        if (refusal) { say(refusal, 'bad'); return; }
        acts.innerHTML = '<span class="dock-used">used</span>';
        say('');
      };
      row.querySelector('[data-drop]').onclick = () => { row.remove(); };
    }
    return row;
  }

  /* What the model is allowed to know: what the app hands over, else what is
   * actually on the screen — read off the work area, with the bar and the dock
   * itself taken out so the conversation does not feed on itself. */
  function scene() {
    let text = '';
    try { text = String(context ? context() : '').trim(); } catch { text = ''; }
    if (!text) {
      const area = document.querySelector('main, .work, .spec, .board, .pane')
        || document.getElementById('app');
      if (area) {
        const copy = area.cloneNode(true);
        copy.querySelectorAll('#dock, header, .bar, script, style').forEach((n) => n.remove());
        text = String(copy.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
    return text.length > LIMIT ? text.slice(0, LIMIT) + '\n…' : text;
  }

  async function ask(question) {
    if (busy) return;
    const ai = readAi();
    show(true);
    bubble('me', question);
    if (!ai.key || !ai.url) {
      say('no model key yet — open settings and paste one', 'bad');
      if (openSettings) openSettings();
      return;
    }
    busy = true;
    toggle.disabled = true;
    say('thinking…', 'busy');
    const here = scene();
    const messages = [
      { role: 'system', content:
        `You are the assistant inside ${app}, one app of a small suite. Answer about what the `
        + 'person has on screen, in their own language, in as few words as will do. '
        + 'If the screen does not contain the answer, say what is missing rather than inventing it. '
        + 'Plain text: no markdown headings, no bullet lists, no bold.' },
      { role: 'user', content: (here ? 'What is on screen:\n\n' + here + '\n\n' : '')
        + 'Question: ' + question },
    ];
    try {
      const body = JSON.stringify({
        url: aiEndpoint(ai.url), key: ai.key, model: ai.model || 'gpt-4o-mini',
        messages, max_tokens: 700, temperature: 0.2,
      });
      let res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (res.status === 404 || res.status === 405) {
        res = await fetch(PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      }
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not json */ }
      if (!res.ok) {
        const why = data?.error?.message || data?.error || data?.raw || text || ('http ' + res.status);
        say(String(why).slice(0, 200), 'bad');
        return;
      }
      const answer = String(data?.choices?.[0]?.message?.content ?? data?.content ?? '').trim();
      if (!answer) return say('the model answered with nothing', 'bad');
      say('');
      bubble('it', answer, !!onUse);
    } catch (e) {
      say('could not reach the model: ' + (e.message || e), 'bad');
    } finally {
      busy = false;
      toggle.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return input.focus();
    input.value = '';
    ask(q);
  });

  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'toggle') show(log.hidden);
    if (a.dataset.a === 'hide') show(false);
  });

  /* Escape puts the transcript away without touching the document. */
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show(false);
  });

  return {
    open: () => show(true),
    close: () => show(false),
    ask,
    get open() { return !log.hidden; },
  };
}
