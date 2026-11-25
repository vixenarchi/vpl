# The unification list

**The bar and the gate are done (24 Nov 2026).** What follows in *The bar* below
is the old description of the drift; the rules that are now shipped are in
"One bar, one order" underneath it. The rest of the list is still waiting.

The apps grew one at a time and the differences that remain are accidents, not
opinions. Nothing here is a redesign; it is the same thing said the same way.

Written down now so it is one job later instead of five small surprises.

## The bar

- Same order: mark, word, sub-word, rail toggle (narrow), then `who`, settings,
  theme, out. `vd` puts settings (`⚙`) before the theme; `vz`/`vr` differ in
  which of these exist at all.
- Same words: `out`, `⚙` title "the model and its key", `◐` title "light or
  dark".
- Only the app with a rail gets `☰`; no app invents a second way to open it.


## One bar, one order (shipped)

The bar is now markup the apps share and CSS that lives once, in
`packages/shell/tokens.css` (`tools/stage.sh` copies it). Left to right, always:

1. `☰` — the list, in the apps that have one (`#btn-projects`).
2. the boxed **two letters of the app** — `[vn]`, `[vi]`, `[vr]`… — and then the
   app's own word: `notes`, `ideas`, `requirements`, `dictionary`, `documents`,
   `compliance`, `keys & codes`, `architecture`.
3. `＋` — the one thing you add (`#btn-new`), in the bar and nowhere else.
4. air (`span.grow`).
5. `#who` — the initials chip and the name.
6. `⚙` (`#btn-ai`) — settings.
7. `out` (`#btn-out`) — sign out.

`vp` has no list and nothing to add, so its bar is the same order with those two
absent. The box and the word are one link to the app's own start.

**The theme left the bar.** `◐` was a fourth button that no two apps placed in
the same spot. It is now one press *inside* settings, next to the word: a small
`dark` / `normal` button (`[data-a=mode]`) that says what pressing it gives you,
with the palette tab underneath for all three. The bar is not a place for
preferences.

**On a phone the word goes** (`max-width: 26rem`), it does not shrink to its
initial: `[vn] n` reads as a cut-off word, while `[vn]` alone still says which
app this is. `chrome-check` measures the order in all eight and fails if any app
grows a fourth button or moves one.

**The gate is one form too:** mark, the app's letters, `vixen <name>`, e-mail or
username, password, create / sign in, *continue with Google*, and the same
sentence underneath — "one account for the whole suite". `vp` had a version of
its own; it now has this one, Google button included (`vp/lib/db.js` grew
`signInWithGoogle`).

**`vn`'s bar lost four buttons**: the inline assistant's `✎`, the shortcut list
`⌨`, the `✳` key icon and the second gear. The dock is the assistant now, and the
`⌨` button is commented out in `app.js`'s neighbours (`index.html`) on purpose:
*Ctrl+/* still opens the same list, and the button goes back when the suite is
finished. The wiring it left behind is kept quiet by one `Proxy` stand-in rather
than twelve null checks.

**`＋` moved out of the panes.** `vi`, `vz`, `vr`, `vd`, `vc` and `va` had it in
the rail head (two of them only while the rail was open); there is one place to
add a thing now, and it is the bar.

**What made the bar fall apart was not the markup.** Six apps still carried their
own `.bar`, `.brand`, `.brand-word` and `.who` rules — including one that made
the brand an `inline-grid` through the tap-target floor, which stacked the box
above the word and shrank the whole link to the width of "ideas". Those rules
were deleted; the tap floor no longer touches `.bar .brand`.

## Settings (the model dialog)

- One dialog, the same sentences everywhere: what is stored, where, that the key
  never leaves the browser except to the provider, and one line about the
  default model.
- Same order: provider → base address → model → key → save → forget.
- `vz` has no dialog (it has no model): when `vp` lands, that stops being a
  difference and becomes "no model, no key".
- The error when there is no key is the same sentence in every app, and it opens
  the dialog rather than pointing at it.

## Logging-in texts

- The gate's four sentences: what an account is, that it works across the suite,
  that a name is an account at `@vpl.local`, and what a failed sign-in means.
  The *markup* is copied (the apps are copies) and the sentences are identical in
  all eight; the one sentence a code path produces now lives once.
- **Done: `packages/shell/words.js`.** `plainAuthError()` was copy-pasted in five
  apps and is now imported from the shell, so a sixth cannot invent a fourth way
  to say *wrong address or password*. The provider's English is only passed
  through when we have nothing better.
- **Done, by accident of the same work: a second tab.** `vp` and `vz` never
  noticed that another tab had signed in as somebody else — one showed the
  previous person's ledger, the other the previous person's dictionary, until
  reload. Both now carry the suite's three listeners (coming back into view,
  focus, the storage event), asking *storage* rather than the client, and they are
  registered **before** `boot()` so a person who arrived at the gate and only then
  typed a password is noticed too. `auth-check` is 11/11 in all eight.
- **`tools/test-settings.sh` now walks all eight.** It used to check six, which is
  exactly why two apps kept a bug for weeks: a group that is not in the list is a
  group that is green by absence.
- Still waiting: the guest banner — one sentence plus what the reader can do.

## Sharing

- One dialog, two doors and (in `vz`) a third switch; same headings, same
  `copy the link`, same list of people with `can read` / `can write`.
- `copy to mine` sits in the same place in every header, with the same words.

## Small things

- `print` prints the whole document everywhere (never paged).
- A phone stacks by the same rules: no sideways scroll, actions within a thumb.
- Every "empty" state is one sentence and one button — no illustrations.
- Every destructive action asks with the object's name in the question.

## Not part of this

Colours, type, the app's own metaphor (tree, funnel, sheet, dictionary, desk,
verdict strip). Those differences are the product; the list above is only what
should not differ.
