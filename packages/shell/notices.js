/* vpl · the notice — one boxed line, in the middle of the work, that the people
 * running the suite can turn on. It is for announcements ("test system, data is
 * dumped hourly"), and it is deliberately the only place where a sentence from
 * us appears inside one of our apps.
 *
 * Rules it keeps:
 *   - it is a box with an edge in the middle of the bar, between ＋ and who —
 *     chrome, not work, so it costs the person no sheet and shifts nothing;
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

/* A phone's bar is the tightest row in the app: between ＋ and the name there
 * is room for about ten characters, and a sentence cut to "test sy…" is worse
 * than none. So below this width the notice goes to the top of the work column,
 * where the sentence fits whole. */
const NARROW = '(max-width: 52rem)';

function barSlot() {
  return document.querySelector('.bar .grow');
}

/* Where the boxes go. A bar is one slot; a phone may need more, because vd, vc
 * and va keep the work area and the welcome screen as siblings and swap between
 * them — mounting into both means the announcement is on the screen whichever
 * one is showing, and putting it away puts away every copy. */
function hostsFor({ host, column } = {}) {
  const el = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  if (host) { const one = el(host); return one ? [one] : []; }
  const narrow = window.matchMedia?.(NARROW).matches;
  if (!narrow) { const bar = barSlot(); return bar ? [bar] : []; }
  const cols = (Array.isArray(column) ? column : [column]).map(el).filter(Boolean);
  return cols.length ? cols : [barSlot()].filter(Boolean);
}

/* The whole app is hidden until somebody is signed in, so the mount waits for
 * the bar to appear once before choosing — the only reason a notice is ever
 * late. */
function whenVisible(box, fn) {
  if (box.getClientRects().length) { fn(); return; }
  const obs = new MutationObserver(() => {
    if (!box.getClientRects().length) return;
    obs.disconnect();
    fn();
  });
  obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] });
  setTimeout(() => obs.disconnect(), 60000);
}

/* mountNotice({ app, column, host, every = 9000 })
 * On a wide screen the notice lives in the bar, in the slot the bar leaves free
 * between ＋ and the person's name — chrome, not work, so the sheet keeps every
 * row. On a phone it sits at the top of `column` (or each of `columns`), where
 * the sentence is not cut. `host` pins it somewhere, for a test. */
export function mountNotice(opts = {}) {
  const { app, column, host, every = 9000 } = opts;
  if (!host && !barSlot()?.getClientRects().length) {
    const bar = barSlot();
    if (bar) { whenVisible(bar, () => mountNotice(opts)); return null; }
  }
  const hosts = hostsFor({ host, column });
  const list = liveNotices(app);
  if (!hosts.length || !list.length) return null;

  let i = 0;
  let timer = null;
  let paused = false;

  /* one box per host, all showing the same sentence at the same time */
  const boxes = hosts.map((into) => {
    const el = document.createElement('section');
    el.className = 'notice';
    el.setAttribute('role', 'status');
    el.dataset.tone = list[0].tone || 'notice';
    el.dataset.id = list[0].id;

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

    /* outside the bar it needs its own margins and it may wrap: a column is wide
     * and tall, and a sentence there does not have to be cut */
    if (!into.closest('.bar')) el.classList.add('col');
    into.prepend(el);

    el.addEventListener('mouseenter', () => { paused = true; });
    el.addEventListener('mouseleave', () => { paused = false; });
    el.addEventListener('focusin', () => { paused = true; });
    el.addEventListener('focusout', () => { paused = false; });
    x.addEventListener('click', () => close());

    return { el, word, text };
  });
  const els = boxes.map((b) => b.el);

  const paint = (n) => {
    for (const b of boxes) {
      b.el.dataset.tone = n.tone || 'notice';
      b.word.textContent = TONE_WORD[n.tone] || TONE_WORD.notice;
      b.text.replaceChildren();
      if (n.href) {
        const a = document.createElement('a');
        a.href = n.href;
        a.textContent = n.text;
        b.text.append(a);
      } else {
        b.text.textContent = n.text;
      }
    }
  };

  const show = (k, fade) => {
    i = ((k % list.length) + list.length) % list.length;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!fade || still) { paint(list[i]); return; }
    /* a short cross-fade, and none of it if the person asked for less motion */
    for (const el of els) el.classList.add('swap');
    setTimeout(() => { paint(list[i]); for (const el of els) el.classList.remove('swap'); }, 180);
  };

  const tick = () => {
    if (paused || list.length < 2) return;
    show(i + 1, true);
  };
  const start = () => { if (list.length > 1 && !timer) timer = setInterval(tick, every); };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  function close() {
    const id = list[i].id;
    stop();
    putAway(id);
    for (const other of document.querySelectorAll('.notice[data-id="' + id + '"]')) other.remove();
    if (liveNotices(app).length) mountNotice(opts);
  }

  /* the bar and the column swap places once, at a width, not continuously */
  const mq = window.matchMedia?.(NARROW);
  const replace = () => {
    if (hostsFor({ host, column }).some((h) => h.contains(els[0]))) return;
    stop();
    for (const el of els) el.remove();
    mountNotice(opts);
  };
  mq?.addEventListener?.('change', replace);

  show(0, false);
  start();

  return {
    close,
    next: () => show(i + 1, true),
    get count() { return list.length; },
    get current() { return list[i]; },
    el: els[0],
    els,
  };
}
