/* terg.hr — the whole script, and it stays small on purpose. A front door that
 * needs a framework to show four paragraphs is slower than the product it is
 * selling, so there is no framework: a theme, a pager, and the menus in the bar.
 *
 * The theme is the suite's theme: the same three names, the same key, the same
 * data-theme attribute, so a person who chose "comic" in vi gets comic paper
 * here too. Nothing is stored on a server and nothing is read back.
 */

const KEY = 'vpl.theme';
const THEMES = ['light', 'dark', 'vi'];

function current() {
  try {
    const t = localStorage.getItem(KEY) || 'light';
    return THEMES.includes(t) ? t : 'light';
  } catch { return 'light'; }
}

function apply(id) {
  const root = document.documentElement;
  if (id === 'light') delete root.dataset.theme;
  else root.dataset.theme = id;
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  const b = document.getElementById('theme');
  if (b) b.title = `paper, ink or comic — now ${id === 'vi' ? 'comic' : id === 'dark' ? 'ink' : 'paper'}`;
}

apply(current());

document.getElementById('theme')?.addEventListener('click', () => {
  const now = current();
  apply(THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]);
});

/* ── the news pager: five at a time ──────────────────────────────────
 * The entries live in the page, so they work with this file blocked and with no
 * build. The script only decides which five are visible.
 */
(() => {
  const list = document.getElementById('news-list');
  const pager = document.getElementById('news-pager');
  if (!list || !pager) return;
  const items = [...list.children];
  const PER = 5;
  const pages = Math.max(1, Math.ceil(items.length / PER));
  if (pages < 2) { pager.hidden = true; return; }
  pager.hidden = false;

  let page = 0;
  const button = (label, onClick, disabled) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quiet';
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  };

  function draw() {
    items.forEach((li, i) => { li.hidden = i < page * PER || i >= (page + 1) * PER; });
    pager.replaceChildren(
      button('← newer', () => { page = Math.max(0, page - 1); draw(); }, page === 0),
      button('older →', () => { page = Math.min(pages - 1, page + 1); draw(); }, page === pages - 1),
    );
    const of = document.createElement('span');
    of.className = 'page-of';
    of.textContent = `page ${page + 1} of ${pages}`;
    pager.append(of);
  }
  draw();
})();

/* ── the menus in the bar ────────────────────────────────────────────
 * Every item with a panel is a <details>; the browser opens it on click. Three
 * rules make them feel like menus rather than five accordions: only one is open
 * at a time (two fixed panels in the same place read as a broken card), it
 * closes when you pick something, when you click the paper, and on Escape.
 *
 * Opening a panel never scrolls the page. The band it shows is an overlay, not a
 * destination, so the words underneath stay exactly where they were — a menu
 * that moves the page is a menu you have to find again.
 */
(() => {
  const menus = [...document.querySelectorAll('details.menu')];
  if (!menus.length) return;

  const closeAll = (except) => {
    for (const m of menus) if (m !== except && m.open) m.open = false;
  };

  for (const menu of menus) {
    menu.addEventListener('toggle', () => { if (menu.open) closeAll(menu); });
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) menu.open = false; });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('details.menu')) closeAll(null);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = menus.find((m) => m.open);
    if (!open) return;
    open.open = false;
    open.querySelector('summary')?.focus();
  });

  /* /#philosophy from another page opens that panel instead of looking for a
   * band that is no longer in the flow. */
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (hash) {
    const target = document.getElementById('nav-' + hash);
    if (target && target.tagName === 'DETAILS') { target.open = true; history.replaceState(null, '', location.pathname); }
  }
})();
