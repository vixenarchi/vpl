/* vpl · the notice — one boxed line, in the middle of the work, that the people
 * running the suite can turn on. It is for announcements ("test system, data is
 * dumped hourly"), and it is deliberately the only place where a sentence from
 * us appears inside one of our apps.
 *
 * Rules it keeps:
 *   - it is a box with an edge, centred over the work, never a bar that shifts
 *     the layout;
 *   - colour is never the only signal: every tone carries its word;
 *   - a person can put it away, and nothing comes back that they put away —
 *     the same id stays dismissed in that browser;
 *   - more than one live notice rotates, slowly, and stops while you hover or
 *     focus it;
 *   - it is a file, not a service: turning one on is an edit and a deploy.
 *
 * Copied into apps/<name>/vendor/ by tools/stage.sh.
 */

/* The list. `on: false` keeps a sentence written and silent — which is what
 * "it may or may not be visible" means when the switch has to be honest.
 *
 *   id      stable: a dismissed id never returns, so a new announcement needs
 *           a new id
 *   apps    '*' or a list of app codes ('vn', 'vr', …)
 *   tone    'notice' | 'heads-up' | 'offer' — the word shown, and the colour
 *   text    one sentence, plain text
 *   href    optional address; the text becomes a link
 *   until   optional ISO date, after which the notice is not shown
 */
export const NOTICES = [
  {
    id: 'test-dump-2026-11',
    on: true,
    apps: '*',
    tone: 'notice',
    text: 'Test system — data is dumped once an hour, and nothing here is production yet.',
  },
  {
    id: 'prod-announce-2026-12',
    on: false,
    apps: '*',
    tone: 'heads-up',
    text: 'Production is coming: anonymous sign-in ends and every account will confirm its e-mail.',
  },
];

const TONE_WORD = { notice: 'notice', 'heads-up': 'heads-up', offer: 'offer' };

function dismissed(id) {
  try { return localStorage.getItem('vpl.notice.' + id) === 'off'; } catch { return false; }
}

function putAway(id) {
  try { localStorage.setItem('vpl.notice.' + id, 'off'); } catch { /* private mode */ }
}

function alive(n, app, now = Date.now()) {
  if (!n || n.on === false || dismissed(n.id)) return false;
  if (n.apps !== '*' && !(Array.isArray(n.apps) && n.apps.includes(app))) return false;
  if (n.until && Date.parse(n.until) < now) return false;
  return true;
}

export function liveNotices(app, now = Date.now()) {
  return NOTICES.filter((n) => alive(n, app, now));
}

/* mountNotice({ app, host, every = 9000 })
 * `host` is the element the notice sits in — the app's work column, so the box
 * is centred over the work and not over the bar. */
export function mountNotice({ app, host, every = 9000 } = {}) {
  const box = typeof host === 'string' ? document.querySelector(host) : host;
  const list = liveNotices(app);
  if (!box || !list.length) return null;

  const el = document.createElement('section');
  el.className = 'notice';
  el.setAttribute('role', 'status');
  el.dataset.tone = list[0].tone || 'notice';

  const word = document.createElement('span');
  word.className = 'notice-tone';
  const text = document.createElement('p');
  text.className = 'notice-text';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'notice-x';
  x.setAttribute('aria-label', 'put this notice away');
  x.textContent = '✕';
  el.append(word, text, x);
  el.dataset.id = list[0].id;
  box.prepend(el);

  let i = 0;
  let timer = null;
  let paused = false;

  const paint = (n) => {
    el.dataset.tone = n.tone || 'notice';
    word.textContent = TONE_WORD[n.tone] || TONE_WORD.notice;
    text.replaceChildren();
    if (n.href) {
      const a = document.createElement('a');
      a.href = n.href;
      a.textContent = n.text;
      text.append(a);
    } else {
      text.textContent = n.text;
    }
  };

  const show = (k, fade) => {
    i = ((k % list.length) + list.length) % list.length;
    if (!fade) { paint(list[i]); return; }
    /* a short cross-fade, and none of it if the person asked for less motion */
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) { paint(list[i]); return; }
    el.classList.add('swap');
    setTimeout(() => { paint(list[i]); el.classList.remove('swap'); }, 180);
  };

  const tick = () => {
    if (paused || list.length < 2) return;
    show(i + 1, true);
  };

  const start = () => { if (list.length > 1) timer = setInterval(tick, every); };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  el.addEventListener('mouseenter', () => { paused = true; });
  el.addEventListener('mouseleave', () => { paused = false; });
  el.addEventListener('focusin', () => { paused = true; });
  el.addEventListener('focusout', () => { paused = false; });

  const close = () => {
    putAway(list[i].id);
    stop();
    /* the same notice may be mounted in more than one column (a job's work
     * area and the welcome screen are siblings) — putting it away puts it away */
    for (const other of document.querySelectorAll('.notice[data-id="' + list[i].id + '"]')) other.remove();
    if (liveNotices(app).length) mountNotice({ app, host: box, every });
  };
  x.addEventListener('click', close);

  show(0, false);
  start();

  return {
    close,
    next: () => show(i + 1, true),
    get count() { return list.length; },
    get current() { return list[i]; },
    el,
  };
}
