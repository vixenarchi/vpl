/* words.js — the sentences the suite says about a person signing in.
 *
 * The gate is markup, and its four sentences are the same in all eight apps: one
 * account for the whole suite, a name is an account at @vpl.local, what is
 * stored, and what a failed sign-in means. The markup is copied because the apps
 * are copies; the sentences that a *code path* produces are here, once, so the
 * fifth app cannot invent a fourth way to say "wrong password".
 *
 * Rules this file keeps:
 *   - a sentence is plain, lower-case, and about the person's problem, not the
 *     provider's: "wrong address or password", never "Invalid login credentials";
 *   - nothing here says "error" — the app says what happened;
 *   - the same words mean the same thing in eight places, which is why they live
 *     in one file.
 */

/* Supabase answers a failed sign-in with its own English. This is the translation:
 * three human sentences and a fallback that keeps the provider's words only when
 * we have nothing better to say. */
export function plainAuthError(err) {
  const m = String(err?.message || err || '');
  if (/already registered/i.test(m)) return 'that address already has an account — sign in instead';
  if (/invalid format|validate email/i.test(m)) return 'that does not look like an address';
  if (/invalid login credentials/i.test(m)) return 'wrong address or password';
  return m || 'could not sign in';
}

/* The gate's one static line, in case an app draws its own gate. */
export const ONE_ACCOUNT = 'one account for the whole suite';

/* The banner a reader sees, in one shape everywhere: *what this is*, then *what
 * you can do*. Two clauses, an em dash, no exclamation mark, and the same words
 * in all seven apps that can share — because a reader should not have to learn a
 * new vocabulary to find out whether their edits are saved.
 *
 *   guestLine({ thing: 'funnel' })                       → anonymous link
 *   guestLine({ thing: 'sheet', signedIn: true })        → a grant, read only
 *   guestLine({ thing: 'sheet', role: 'edit', signedIn: true })
 *   guestLine({ thing: 'sheet', publicLink: true })      → published
 *
 * `thing` is the app's own noun: note, funnel, document, check, job, sheet. That
 * is the one word an app may choose.
 */
export function guestLine({ thing = 'document', publicLink = false, role = 'view', signedIn = false, canCopy = true } = {}) {
  let lead;
  if (publicLink) lead = `a published ${thing} — anyone with the link reads it`;
  else if (role === 'edit' && signedIn) lead = 'shared with you — you may write into it';
  else if (signedIn) lead = 'shared with you — read only';
  else lead = `you are reading a shared ${thing}`;

  let what;
  if (role === 'edit' && signedIn) what = 'the name, sharing and the bin stay with the owner';
  else if (canCopy && signedIn) what = 'a copy can become yours; it never writes back';
  else if (canCopy) what = 'nothing you do here is saved; copy takes it as text';
  else what = 'nothing you do here is saved';

  /* one dash is a sentence; two in a row is a stutter */
  return lead.includes('—') ? `${lead}. ${what}.` : `${lead} — ${what}.`;
}
