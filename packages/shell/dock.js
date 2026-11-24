/* vpl · the dock — a chat line at the bottom of every app.
 *
 * The suite has one shape: the bar on top says who you are and where the
 * settings are, the rail on the left is the project, the middle is the work,
 * and the dock on the bottom is the model. Every app gets the same dock, because
 * "ask about what is on screen" is not a feature of one of them.
 *
 * Three rules it keeps:
 *   - it is given the text the person is working on, not a scrape of the page,
 *     so it can answer about the note, not about the weather;
 *   - when it is asked for a change it answers with the changed text only,
 *     because that answer is going into a document;
 *   - nothing it writes lands in a document on its own. The answer sits in the
 *     dock until a person presses *replace* (there is a selection) or *use it*
 *     (there is not), and the app decides what that means.
 *
 * The transcript is a layer above the line, three rows tall and no taller: a
 * conversation that grows the page upward is a conversation that takes the work
 * area hostage.
 *
 * Copied into apps/<name>/vendor/ by tools/stage.sh.
 */

import { readAi, aiEndpoint } from './ai.js';

/* `proxy` in config.local.js is this deployment's shared door. With none, the
 * dock uses the app's own /api/chat and says so if that is missing too. */
const PROXY = ((typeof window !== 'undefined' && window.__VPL_CONFIG__) || {}).proxy || '';
const LIMIT = 12000;
const KEEP = 4;              // two exchanges of history, so "shorter still" works

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
  const history = [];

  const say = (text, state = '') => {
    msgEl.textContent = text || '';
    msgEl.dataset.state = state;
  };

  function show(open) {
    log.hidden = !open;
    hideBtn.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    el.classList.toggle('open', open);
    if (open) {
      thread.scrollTop = thread.scrollHeight;
      input.focus();
    }
  }

  /* What the app is willing to show: a string, or { text, selection }. The
   * selection is the words a *replace* would change, and it is read before the
   * question is sent — by the time the answer arrives the caret may be
   * somewhere else. */
  function scene() {
    let out = { text: '', selection: '' };
    try {
      const got = context ? context() : '';
      if (got && typeof got === 'object') out = { text: String(got.text || ''), selection: String(got.selection || '') };
      else out.text = String(got || '');
    } catch { /* an app that throws tells the model nothing, and says nothing */ }

    if (!out.text.trim()) {
      const area = document.querySelector('main, .work, .spec, .board, .pane')
        || document.getElementById('app');
      if (area) {
        const copy = area.cloneNode(true);
        copy.querySelectorAll('#dock, header, .bar, script, style').forEach((n) => n.remove());
        out.text = String(copy.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
    if (out.text.length > LIMIT) out.text = out.text.slice(0, LIMIT) + '\n…';
    return out;
  }

  function bubble(role, text, opts = {}) {
    const row = document.createElement('div');
    row.className = 'dock-row ' + role;
    row.innerHTML = `<div class="dock-text">${esc(text)}</div>`;

    if (opts.use) {
      const acts = document.createElement('div');
      acts.className = 'dock-acts';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'ghost';
      use.dataset.use = '';
      /* the label says what will happen, because the two are different verbs */
      use.textContent = opts.replace ? 'replace selection' : 'use it';
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'link';
      drop.dataset.drop = '';
      drop.textContent = 'drop';
      acts.append(use, drop);
      row.append(acts);

      use.onclick = async () => {
        /* an app may refuse — "open a note you can edit first" — and it says so
         * in the dock instead of looking like it did something */
        let refusal = '';
        try { refusal = (await (onUse ? onUse(text, opts) : '')) || ''; } catch (e) { refusal = e.message || String(e); }
        if (refusal) { say(refusal, 'bad'); return; }
        acts.innerHTML = '<span class="dock-used">used</span>';
        say('');
      };
      drop.onclick = () => { row.remove(); };
    }

    thread.append(row);
    thread.scrollTop = thread.scrollHeight;
    return row;
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

    /* read the scene before the request: the selection is where the person
     * asked from, and the answer is meant to land there */
    const here = scene();
    const hasSelection = !!here.selection.trim();

    busy = true;
    toggle.disabled = true;
    say('thinking…', 'busy');

    const rules = [
      `You are the assistant inside ${app}, one app of a small suite. The person is working on the text below.`,
      'When they ask for a change — rewrite, shorten, fix the grammar, translate, continue, make it clearer — answer with ONLY the new text, ready to be put into their document. No preamble, no quotation marks around it, no code fences, no "here is".',
      'When they ask a question, answer in as few words as will do, in their own language.',
      'If what is on screen does not contain the answer, say what is missing instead of inventing it.',
      'Plain text in answers that will be inserted: no headings, no bullet lists, no bold.',
    ].join(' ');

    const parts = [];
    if (here.text.trim()) parts.push('What is on screen:\n\n' + here.text);
    if (hasSelection) {
      parts.push('They selected exactly this, and "replace selection" will put your answer in its place:\n\n'
        + here.selection);
    }
    parts.push('Question: ' + question);

    const messages = [{ role: 'system', content: rules }, ...history,
      { role: 'user', content: parts.join('\n\n') }];

    try {
      const body = JSON.stringify({
        url: aiEndpoint(ai.url), key: ai.key, model: ai.model || 'gpt-4o-mini',
        messages, max_tokens: 900, temperature: 0.2,
      });
      let res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if ((res.status === 404 || res.status === 405) && PROXY) {
        res = await fetch(PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      }
      if (res.status === 404 || res.status === 405) {
        say('this page has no /api/chat and no shared proxy. Add one in tools, or deploy apps/api.', 'bad');
        return;
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

      /* a little memory, so "shorter still" is a sentence with a subject */
      history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
      while (history.length > KEEP) history.shift();

      bubble('it', answer, { use: !!onUse, replace: hasSelection, selection: here.selection });
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
