/* terg.hr — three lines of script, because a page that needs more is a page
 * that is doing something the apps should be doing.
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

/* Sign in does not sign anybody in here: the front door has no login and never
 * will. It opens the list of the eight, because the one thing a stranger needs
 * at that moment is the addresses, and picking one is faster than reading six
 * paragraphs about which to pick. */
(() => {
  const dlg = document.getElementById('signin');
  if (!dlg) return;
  const open = (e) => { e.preventDefault(); dlg.showModal(); };
  for (const id of ['btn-signin', 'btn-signin-2']) {
    document.getElementById(id)?.addEventListener('click', open);
  }
  dlg.querySelector('[data-close]')?.addEventListener('click', () => dlg.close());
  /* a click on the backdrop closes it, like every other dialog in the suite */
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
})();

/* ── news, five at a time ────────────────────────────────────────────
 * The entries live in the page (so they work with the script off, and with no
 * build), and this only decides which five are visible. A page that needs a
 * server to show five paragraphs would be the wrong page for this house.
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

/* ── the panel under "apps" ──────────────────────────────────────────
 * A <details> opens on click by itself. Three small things make it feel like a
 * menu instead of an accordion: it closes when you pick something, when you
 * click the paper, and on Escape. In that order, because the first is the one
 * that matters. */
(() => {
  const menu = document.querySelector('details.menu');
  if (!menu) return;
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) menu.open = false;
  });
  document.addEventListener('click', (e) => {
    if (menu.open && !e.target.closest('details.menu')) menu.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
})();
