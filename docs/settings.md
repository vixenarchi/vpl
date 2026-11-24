# settings — one dialog, always the same one

Every app in the suite opens the same settings dialog, built by one file:
`packages/shell/settings.js`, copied into each app's `vendor/` by
`tools/stage.sh`. Five apps carried five versions of this panel before, and the
differences were never intentional — one had a search section, one had the
account buttons in a different order, one had no test button at all. A person
who learns one app should not have to re-learn the gear icon.

## What is in it

- **Four tabs, top left:** `model`, `search`, `key`, `theme`.
- **One row of buttons at the bottom:** `test` on the left, `forget` and `save`
  on the right.
- **Type is small on purpose** — 0.76 rem fields, 0.68 rem labels, tight line
  height, no paragraph spacing. A settings panel is a form, not an essay.
  Nothing typed is ever centred.

### model

Provider, address, model, key. Choosing a provider writes its address and
offers its models; typing an address from somewhere else flips the select to
*somewhere else* rather than lying about where the key is going. The list of
doors is `PROVIDERS` in `vendor/ai.js`, so it is the same list in every app.

### search

Tavily or Serper, optional. Only apps that use evidence (vi, vr) actually call
it; the tab is here anyway, because a settings dialog that grows a section only
in some apps is the problem this file exists to end.

### key — “ours”

The account's key (`vpl_ai`), the thing that follows a person between browsers
and addresses. Three actions, phrased as sentences: *save to my account*,
*use the account's key here*, *remove from my account*. Signed out, the tab
says so instead of showing buttons that cannot work.

### theme

`paper` (the default, no attribute), `ink` (dark) and `comic` (vi's warm
poster paper, now available everywhere). A theme is a block of CSS variables in
`vendor/tokens.css` and one line in `THEMES` — nothing else changes, and every
app gets it. The choice is stored in `localStorage['vpl.theme']` and applied as
`data-theme` on `<html>`, which is what the apps already read at boot.

Adding a theme is two edits:

```css
/* packages/shell/tokens.css */
[data-theme='mint'] { --paper: #f4fbf6; --ink: #14201a; /* … */ }
```

```js
// packages/shell/settings.js
export const THEMES = [ /* … */ { id: 'mint', label: 'mint', note: 'cool paper' } ];
```

then `tools/stage.sh <app>` for each app and a deploy.

## test, forget, save

- **test** is a real call: one short request through the app's own door
  (`/api/chat`, falling back to `api.<your-domain>/chat`), with the address, model and
  key that are in the form right now. It reports what the model said, or the
  provider's own words when it refuses — the OpenAI message for a bad key
  arrives verbatim: *Incorrect API key provided*. Anything less than a real
  call is a form that says "looks fine".
- **forget** clears `vpl.ai` and `vpl.search` in this browser only. It says so,
  because the account's key is untouched and people reasonably expect otherwise.
- **save** writes this browser, and nothing else. Saving to the account is a
  separate sentence in the `key` tab, on purpose: one button that does both is a
  button nobody can predict.

## Who is signed in, and whether that is still true

Three real bugs lived here, all of them invisible until somebody signed in
twice, and all of them now covered by `apps/vn/test/auth-check.mjs`:

- **A token that is not a token.** `ai.js` sent whatever was in
  `sb-<ref>-auth-token`. A truncated chunk from an older supabase-js went out as
  `Bearer {"access…` and the database answered `Invalid JWT serialization:
  Missing dot delimiter(s)` — a 401 that looked like a permissions bug and was a
  parsing bug. Now a token has to look like a JWT (three base64url parts) and the
  live client session wins over storage.
- **Two tabs, two people, one storage.** supabase-js keeps its own session in
  memory, so a tab that was open while another tab signed in kept showing the
  first person's rows under the new token. The fix is to ask storage, which is
  the only thing every tab shares, and reload when the answer is not the person
  on screen — on `visibilitychange`, on `focus`, and on the `storage` event. A
  tab sitting on the gate reloads *in* when a session appears, instead of
  pretending nobody is signed in.
- **A logout that was a suggestion.** `signOut()` dropped the client's session
  and left `sb-<ref>-auth-token` (and its `.0`/`.1` chunks) in storage, so a
  reload signed the person straight back in. Now the sign-out is `scope: 'local'`
  and every chunk of the session key is removed.

The reload is deliberate. The alternative is guessing which row belongs to whom
after the identity changed under the page — and getting it wrong is how one
account's data ends up under another account's name.

## Tests

```bash
# the dialog: tabs, save, forget, theme, the test call (door mocked)
node settings-check.mjs                                  # http://127.0.0.1:8107
APP_URL=http://127.0.0.1:8100 APP_NAME=vi node settings-check.mjs

# who is signed in: two tabs, a logout, a fragment in storage
APP_URL=http://127.0.0.1:8107 APP_NAME=va node auth-check.mjs
```

`tools/test-settings.sh` runs both against every app that has the dialog, and
`tools/test-chrome.sh` walks the bar, the gear and the dock in all eight
(`VPL_PROD=1` for the deployments).

## The bug the tests found late: a theme that locked the dialog

`<html>` carries `data-theme` as soon as any theme is applied — including the
default `paper`, which some apps write at boot. The dialog's click handler asked
`e.target.closest('[data-theme]')` to find a theme button, and **every click in
the dialog found the page instead**: the branch fired with `theme: paper`, said
"theme: paper", and returned before save, forget or close were ever reached.
The only way out was to change the theme back and press ✕, which is exactly what
was reported. The handler now asks for `.set-theme`, so it can only ever match a
theme button, and `chrome-check.mjs` changes a theme and then closes the dialog
in every app.

## The rest of the chrome, because a settings gear alone is not a suite

There are now three shared pieces of every app, all copies from
`packages/shell/`, all mounted at boot:

- **`who.js`** — the name in the bar. Rules in order: the name Google gave us;
  else the local part of the address, tidied (`vladimir.ergovic` → *Vladimir
  Ergovic*); else a letter. No address ever appears in the bar, only in its
  tooltip.
- **the bar** — the same shape everywhere: mark and name on the left, the person
  on the right, then the settings gear and *out*. `vn` had the person only
  inside its own settings dialog and no gear at all; both are fixed, and its own
  settings panel keeps the gear while the model's key gets `✳`.
- **`dock.js`** — a chat line at the bottom of every app, inside `#app` so the
  work area shrinks instead of being covered. It reads what is on screen (the
  work area, with the bar and the dock itself taken out) and sends that with the
  question. The answer stays in the dock: no field is filled, no document is
  changed, and there is no *use it* button unless an app passes one.

The sign-in is one card in every app too, from one block of CSS, and one
sentence on all eight gates: **one account for the whole suite**.

## The ◐ in the bar is a shortcut, not a second opinion

Once the theme lives in the settings tab, a bar button that flips only
paper/ink is a smaller, dumber copy of the same idea. So the bar's ◐ walks the
same list as the tab — paper → ink → comic → paper — through `cycleTheme()` in
`vendor/settings.js`. vn keeps its own `toggleTheme` for the reader (paper or ink
*for the note in front of you*), which is a different question from what the
suite looks like.

## *use it* is a button and a promise

The dock never writes into a document by itself. Where an app can take the
answer it passes `onUse`, and then — and only then — the answer grows a **use it**
button next to **drop**:

- **vn** puts the words in the open note, at the caret, through the same autosave
  as typing; if there is no editable note it returns a sentence instead.
  *open a note you can edit first*.
- **vi** pins the answer as one more idea on the wall; with no project open it
  says *open a project first — an idea needs a wall*.

`onUse` may return a string, and the dock shows it as a refusal. An app that says
"used" when it did nothing is worse than a button that explains itself.

The other six apps pass no `onUse`, so their dock has no *use it* at all. That is
the honest default: reading an answer is not the same as accepting it.

## Two things the account line taught

- **A dialog that painted itself once at mount is a dialog that lies.** vn's bar
  opens settings after signing in, but the key tab's account line was written
  when the page loaded — signed out — and never again. `open()` now repaints it.
- **A suite that asks for ids that were renamed is a suite that stops checking
  things.** The key suite still walked `#ai-url` / `#ai-key` long after the
  dialog became `#set-url` / `#set-key`, so it reported nothing at all. A test
  that cannot find its own controls should fail loudly; that is what the
  `waitForSelector` timeouts finally did.
