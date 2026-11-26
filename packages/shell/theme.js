/* vpl · the theme, read before the first paint
 *
 * This is four lines and it has to be a file rather than a `<style>` or an
 * inline script in the page: the deployed apps now carry a Content-Security-
 * Policy with no 'unsafe-inline' for scripts (C8 in docs/security.md), and an
 * inline boot script is exactly what such a policy refuses. Loading it from
 * `vendor/` — a copy of this folder, like the rest of the shell — keeps the
 * policy strict and keeps the flash of the wrong theme away.
 *
 * It runs blocking, before the stylesheet is applied, which is why it is in
 * `<head>` without `defer`.
 */
try {
  var t = localStorage.getItem('vpl.theme');
  if (t) document.documentElement.dataset.theme = t;
} catch (e) {}
