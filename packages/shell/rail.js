/* vpl · the rail is resizable — a grip on its edge, a width the browser keeps.
 *
 * Copied into each app's vendor/ by tools/stage.sh, never imported across apps.
 *
 * The rail is where the work is chosen, and how much of it a person needs to see
 * depends on the words in it: "untitled spec" needs 14 rem, "Kontrola pristupa
 * — poglavlje 4.2" needs more. The app cannot know which one is on screen, so the
 * edge is a handle.
 *
 * One element, one variable: the module writes `--rail-w` on <html>, and every
 * app's layout already asks for that width in one place. Nothing else changes.
 * A stylesheet rule, not an inline property: an inline `--list-w` beats the
 * phone's own `:root { --list-w: 12rem }`, and a rail dragged wide on a desktop
 * would then squeeze the notice on a phone. The rule lives inside a
 * `min-width` query, so a narrow screen keeps its own numbers.
 *
 * Rules it obeys, because a drag handle is easy to make annoying:
 *   - it is a real separator (role, aria-orientation, arrow keys, Home/End)
 *   - it is hidden on a narrow screen, where the rail is a drawer, not a column
 *   - it is 7 px wide and sits over the edge, so it steals no layout width
 *   - the width is remembered per app (one key), and clamped to the window
 */
const KEY = (app) => `vpl.rail.${app || 'app'}`;
/* the width is written as a rule, not as an inline property, so it cannot beat
 * the media query a narrow screen relies on */
const STYLE_ID = 'vpl-rail-width';
const MIN = 170;
const MAX = 460;

export function mountRail(rail, { app = '', setVar = '--rail-w', min = MIN, max = MAX } = {}) {
  if (!rail) return null;
  const root = document.documentElement;
  const key = KEY(app);

  /* the handle sits on the rail's edge, so the rail must own that edge — a
   * class, never an inline style: `style="position: relative"` beats the phone's
   * `@media { .list { position: absolute } }` and turns vn's drawer into a
   * column, which squeezes the work area to nothing. A class of equal
   * specificity loses to the app's own media query, which is what we want. */
  rail.classList.add('vpl-rail');

  const grip = document.createElement('div');
  grip.className = 'rail-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'drag to resize the list');
  grip.setAttribute('title', 'drag to resize · double-click to reset');
  grip.tabIndex = 0;
  rail.append(grip);

  const ceiling = () => Math.min(max, Math.max(min, Math.round(window.innerWidth * 0.46)));
  const widthOf = () => Math.round(rail.getBoundingClientRect().width);
  const write = (px, save = false) => {
    const w = Math.max(min, Math.min(ceiling(), Math.round(px)));
    let sheet = document.getElementById(STYLE_ID);
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = STYLE_ID;
      document.head.append(sheet);
    }
    sheet.textContent = `@media (min-width: 721px) { :root { ${setVar}: ${w}px } }`;
    if (save) { try { localStorage.setItem(key, String(w)); } catch {} }
    return w;
  };
  const current = () => widthOf();

  /* a remembered width is applied before the first paint of the rail's contents,
   * so the list does not jump under the pointer on load */
  let saved = 0;
  try { saved = Number(localStorage.getItem(key)) || 0; } catch {}
  if (saved >= min) write(saved);

  let startX = 0;
  let startW = 0;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    write(startW + (e.clientX - startX));
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('rail-dragging');
    grip.releasePointerCapture?.(e.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    write(current(), true);
  };

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startW = current();
    document.body.classList.add('rail-dragging');
    grip.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  });

  /* the keyboard is not a second-class way to resize a thing */
  grip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16;
    let w = null;
    if (e.key === 'ArrowLeft') w = current() - step;
    else if (e.key === 'ArrowRight') w = current() + step;
    else if (e.key === 'Home') w = min;
    else if (e.key === 'End') w = ceiling();
    if (w === null) return;
    e.preventDefault();
    write(w, true);
  });

  grip.addEventListener('dblclick', () => {
    try { localStorage.removeItem(key); } catch {}
    document.getElementById(STYLE_ID)?.remove();
    root.style.removeProperty(setVar);
    write(current(), true);
  });

  /* a window that shrinks must not leave a rail wider than the room for it */
  window.addEventListener('resize', () => {
    if (current() > ceiling()) write(ceiling());
  });

  return {
    width: current,
    reset: () => { document.getElementById(STYLE_ID)?.remove(); root.style.removeProperty(setVar); },
  };
}
