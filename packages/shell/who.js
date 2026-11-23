/* vpl · who is here, in words.
 *
 * One account for the whole suite, so the name in the corner must be the same
 * in eight apps. The rules, in order:
 *
 *   1. the name Google gave us, if there is one,
 *   2. the local part of the address, tidied (vladimir.ergovic → Vladimir Ergovic),
 *   3. one letter, if the address is all we have and it is unreadable.
 *
 * Copied into apps/<name>/vendor/ by tools/stage.sh.
 */

export function whoLabel(session) {
  const user = session?.user || session || null;
  const meta = user?.user_metadata || {};
  const full = String(meta.full_name || meta.name || meta.display_name || '').trim();
  if (full) return full;

  const email = String(user?.email || '').trim();
  if (!email) return '';
  const local = email.split('@')[0];
  const words = local.split(/[._\-+]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const tidy = words.join(' ').trim();
  if (tidy.length >= 2) return tidy;
  return (tidy || local).slice(0, 2).toUpperCase();
}

/** Two letters at most, for a chip: VE, or V if that is all there is. */
export function whoInitials(session) {
  const label = whoLabel(session);
  if (!label) return '?';
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Put the label in an element, and the address in its title. */
export function paintWho(el, session) {
  if (!el) return;
  el.textContent = whoLabel(session);
  el.title = session?.user?.email || '';
}
