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
