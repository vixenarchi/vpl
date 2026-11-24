# The notice

A small announcement box with an edge, a word for its tone and a ✕, sitting in
the **bar** — in the middle, between ＋ and the person's name. It exists so that
*"Test system — data is dumped once an hour"* can be said to people without a
banner that pushes the work down or a modal that stops it.

It is a **file**, not a service: `packages/shell/notices.js`, copied into each
app by `tools/stage.sh`. Editing a sentence and deploying is the whole
workflow; there is no table, no admin screen, no push.

## One list of sentences

```js
{ id: 'test-dump-2026-11', on: true, apps: '*', tone: 'notice', text: '…' }
```

- **`id`** is the promise: once a person puts it away, that id never comes back
  in that browser (`localStorage['vpl.notice.<id>']`). A new announcement is a
  **new id** — never an edit to a dismissed one, or the same words return
  uninvited.
- **`on`** turns it on or off for everybody without deleting the words.
- **`apps`** is `'*'` or a list like `['vn', 'va']`, so an announcement can be
  aimed at the app it is about.
- **`tone`** is `notice`, `heads-up` or `offer`. The tone word is always shown —
  colour is never the only signal.
- **`until`** (optional) retires it by date; `alive()` reads it.

## Where it sits

**In the chrome, not in the work.** The bar leaves a free slot between ＋ and
`#who` (`.bar .grow`), and the notice is centred in it — so it costs the person
no sheet at all and the whole work area stays. It is never a fixed overlay
either: a fixed box covers the buttons at the bottom of the screen, which is the
mistake the dock already taught us.

A bar must not grow: on a wide screen a sentence that does not fit is cut with
an ellipsis, and the box is the same place in all eight apps.

**On a phone it moves back into the column.** Between ＋ and the name there is
room for about ten characters, and a sentence cut to *"test sy…"* is worse than
no sentence. Below 52rem the notice is mounted at the top of the app's own work
column (`#main`, `#funnel`, `#spec`, `.desk`) instead — where it wraps and reads
whole. A phone's column is a long scroll, so it costs nothing there. In vd, vc
and va the column splits into `#spec` and `#welcome`, which are siblings, so the
notice is mounted in both (only the visible one is on the screen) and putting it
away puts away every copy.

The mount waits for the bar to appear before choosing, because the whole app is
hidden until somebody is signed in and "which column is showing" cannot be
answered before that. The swap happens once, at the width, not continuously.

Several live notices take turns, cross-fading every nine seconds, and stop
turning while the pointer or the keyboard is on them. With
`prefers-reduced-motion` the fade is dropped, not the rotation.

## Rules it keeps

- **A box with an edge, not a bar.** It must not move anything when it appears.
- **It is chrome.** Any sentence of ours that can go in the bar must go in the
  bar; the work area belongs to the person.
- **A word with the colour.** `NOTICE`, `HEADS-UP`, `OFFER`.
- **Put away means put away**, in this browser, forever, for that id.
- **Nothing links out of an app to a sibling** — an announcement may mention the
  suite, but a link is a decision the person makes, not a redirect.
- **The ✕ is 30 px** and the tone word is at least 10.5 px, because `ux-sniff`
  measures both.

## Tests

`apps/vn/test/chrome-check.mjs`, once per app, on the same run as the bar and
the dock: the box is **inside the bar**, between ＋ (or the brand, in vp) and
`#who`, centred in the room the bar leaves, rounded, its ✕ is 30 px, the bar
keeps its height, pressing ✕ removes it and a reload proves it stays away. At
390 px the same suite asserts it is **not** in the bar, that the sentence is
whole there, and that its tone word is back.
