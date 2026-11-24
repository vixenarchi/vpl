# The notice

A small announcement box at the top of every app's work column: one line, an
edge, a word for its tone, and a ✕. It exists so that *"Test system — data is
dumped once an hour"* can be said to people without a banner that pushes the
work down or a modal that stops it.

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

Inside the app's own work column (`#main`, `#funnel`, `#spec`, `.desk`), never
as a fixed overlay: a fixed box covers the buttons at the bottom of the screen,
which is the mistake the dock already taught us. In vd, vc and va the column
splits into `#spec` and `#welcome`, which are siblings, so the notice is mounted
in both and putting it away puts away every copy.

Several live notices take turns, cross-fading every nine seconds, and stop
turning while the pointer or the keyboard is on them. With
`prefers-reduced-motion` the fade is dropped, not the rotation.

## Rules it keeps

- **A box with an edge, not a bar.** It must not move anything when it appears.
- **A word with the colour.** `NOTICE`, `HEADS-UP`, `OFFER`.
- **Put away means put away**, in this browser, forever, for that id.
- **Nothing links out of an app to a sibling** — an announcement may mention the
  suite, but a link is a decision the person makes, not a redirect.
- **The ✕ is 30 px** and the tone word is at least 10.5 px, because `ux-sniff`
  measures both.

## Tests

`apps/vn/test/chrome-check.mjs`, once per app, on the same run as the bar and
the dock: the box exists in the work area, carries its word, is centred and
rounded, its ✕ is hittable, pressing it removes it, and a reload proves it
stays away.
