# The rules, and what proves them

Every line here cost somebody a bug. The format is **rule — why it exists —
the thing that fails when you break it**. If you are about to change an app and
you only read one page, this is the page; `docs/build-notes.md` has the argument
behind each one, in the order it was had.

Run the proof with `./tools/test-all.sh`, or one at a time from `apps/vn/test`
(most take `APP_NAME=`/`APP=`/`PORT=` and a URL of a local server).

## The house

- **Independent apps, one look.** Eight products, one subdomain each, own tables
  (`vn_`, `vi_`…), own deploy. An app must keep working when the rest of the repo
  is gone. → `chrome-check` ×8, every suite's imports
- **The shell is copied into `apps/<app>/vendor/`, never imported.** → `./tools/stage.sh --check`
- **Apps never link to a sibling and never write another app's tables.** Moving a
  thing between apps is *clipboard markdown*, a copy the person pastes. → review;
  `bin-check`, `vi-take`
- **No build step, no bundler, no framework.** ES modules, CDN for real
  libraries. → `node --check` on every file, in the gate
- **Migrations are numbered and re-runnable.** → `supabase/migrations`, pushed by
  hand
- **Tables carry the app's prefix; shared means `vpl_`.** → `tools/map.sh`

## The chrome

- **One bar: mark and name left; who right, then the gear, then *out*.** → `chrome-check`
- **One settings dialog, one height.** A dialog that resizes on every tab weighs
  the settings, not the setting. Opening it repaints the account line. → `settings-check`
- **The theme is one press, inside settings.** The bar has no theme button. → `chrome-check`
- **The sign-in card is one card, and its four sentences are the same words.**
  → `auth-check`, `packages/shell/words.js`
- **A guest gets one banner: what this is — what you can do.** `guestLine()`,
  em dash, no exclamation mark, app supplies only its noun. → `chrome-check`
- **The notice is chrome: a boxed line in the middle of the bar, tone word
  always shown, a dismissed id never returns, a bar must not grow, below 52 rem
  it retreats to the work column.** → `chrome-check`, `docs/notice.md`
- **The dock is a chat line at the bottom, inside `#app`.** It is *given* the
  work, never scrapes the page; two verbs, and the label says which. → `dock-check`, `dock-apps`
- **Chrome does not print; the work does.** Bar, rail, dock, toolbar, notice and
  road step aside under print media; the note/funnel/document prints whole.
  → `chrome-check`
- **A keyboard `Ctrl+P` must print what the button prints.** `beforeprint` fills
  `.print-doc` in vd/vc/va. → `chrome-check`
- **One id, one element.** `getElementById` returns the first match, so a second
  id paints messages behind the modal. → `chrome-check`
- **A helper that takes an id will happily take the wrong one.** `msg('#art-save')`
  wrote into a button's own label. → `chrome-check`
- **Every button and standing link is ≥ 30 px; a link inside a sentence is text,
  not a control.** → `ux-sniff`
- **Typed text is never centred; a stretched button in a one-column grid reads as
  centred text.** → `ux-sniff` (geometry), review
- **Only one thing scrolls at a time.** The page does not scroll; the work column
  does. → `ux-sniff`

## Writing something down

- **Markdown is the storage format; every render goes through DOMPurify.**
  → `md-check`
- **A link is a decision, not a coincidence.** GFM autolinking is off; only
  `https?`/`mailto` become links. → `md-check` (payloads)
- **A paste is cleaned at the door.** → `md-check`
- **A blank line is a separator**, and it survives the round trip. → `md-check`
- **Silent autosave, ~700–800 ms, one save path per app.** → each app's suite
- **A repaint must never write into a field somebody is typing in** — and must
  give the caret back. → `mode-check`
- **Names and addresses ignore case; passwords never do.** → `auth-check`
- **The browser talks to one origin of ours**; providers send no CORS headers.
  → `vp-proxy`, `docs/configure.md`
- **Never delete a note by content — only by id.** → review; `mode-check`
- **The balloon rule: nothing a model writes lands in a field on its own.** It
  proposes; a person presses *use it* or *drop*. → `vr-ai`, `vi-ai`, `dock-check`
- **Evidence comes before prose; a figure needs a host or `[assumption]`.** → `vi-check`

## Losing something

- **A ✕ bins; it never destroys.** Emptying is a separate verb that names what it
  will destroy. → `bin-check` ×7
- **The bin is a chip in the rail's head, with a word and a number** — in *every*
  app. `vn`'s is in the tree's head because it is also a drop target. → `bin-check` (19 checks ×7)
- **No bar at the foot of the work column.** It is the thing you scroll past and
  the thing that covers what is under it. → `bin-check`
- **An open bin is visible from anywhere in the list** (sticky banner, sticky
  foot) — and sticky needs a real scroller. → `bin-check`, `docs/bin.md`
- **A shared document never shows the bin.** → `share-check`
- **A copy keeps each version's own timestamp; a shared document opens the
  newest.** → `vd-check`
- **The bin is a mode, not an address.** → `mode-check`
- **Destructive questions name the thing** — `confirm()` says the label in quotes.
  → review; `bin-check`
- **Wait for the write, not for a timer.** → `bin-check` (`until()` polling)

## People, and what they may see

- **The person belongs to the suite, not to an app.** Name, password, delete:
  the `you` tab is in all eight; only `vn` offers delete-account. → `settings-check`
- **A tab that cannot do what it says is worse than a tab that is not there.**
  → `settings-check`
- **A capability that can be listed is not a capability.** A share code is handed
  to `vn_link_info(code)` / `vn_read_share(code)`; anon reads nothing from
  `vn_shares`. → `share-check`
- **A hint is about a relation, not a directory.** `vn_account_hint` returns a
  name only for an address on your own share. → `share-check`
- **Publishing is a separate switch from sharing.** → `vz-check`
- **Keys are per origin; what is shared is the list of models.** → `key-check`
- **Backups never contain keys.** → `tools/backup.sh`, review

## The database is the last word

- **RLS is a permission on a *row*, not on a column.** A `with check` cannot see
  the column it just wrote; a column rule belongs in a **trigger**.
- **A policy whose `using` reads a column the caller may not read fails closed as
  403.** Ask in one `security definer` function (`vp_can_see_key`). → `vp-check`
- **A guard must name the write it permits** (`vp_codes_guard` allows exactly the
  redemption). → `vp-check`
- **An owner is decided when the row is made**, never by a client update
  (`vpl_owner_is_not_a_field`). → `owner-guard`
- **`as restrictive` comes before `for`** — the other order is a syntax error,
  visible only at push.
- **Trim a column from a grant only after every policy that reads it is
  rewritten.** → `vp-check` (a ledger that 403'd for everybody)

## The apps that think in batches and jobs

- **`vc`: a copy, not a pointer.** A check holds the standard's text; the report
  stays reproducible when the law is replaced. → `vc-lib`
- **`vc`: `chars` is generated, not typed.** → `vc-lib`
- **`vc`: a batch is a queue, strictly one at a time, in order; the cap is 50 and
  it says so.** → `vc-batch`
- **`vc`: `running` is only true while somebody is looking** (`openJob` requeues).
  → `vc-batch`
- **`vc`: the tick says what a run covers** — rows, rules, proofs; an empty tick
  means *all of it*. → `vc-batch`
- **`vc`: rules stay shared, proofs do not** — one nullable `target_id`.
  → `vc-check`
- **Counts live on the row** (`n_pass`/`n_fail`/`n_unknown`), and a number is
  never alone — a word sits next to it. → `vc-batch`
- **Croatian genitive plural after any number but one** (`nouns` carries
  `ruleCount`/`proofCount`/`targetCount`). → `vc-batch`
- **`va`: text is the truth, the canvas edits the text.** → `va-canvas`
- **`va`: three views, one list; `kind` comes from a closed list; validation is a
  strip, not a gate; no graph database, no metamodel, no live sync, no
  auto-layout, no code execution.** → `va-check`, `va-canvas`
- **`va`: pull never push; the claim is the write; a job is a directory; only the
  owner queues a job; inside a job folder only `out/` is writable.**
  → `va-handoff`, `va-sec`
- **`va`: the agent's child process gets an allow-list of env vars, never a
  spread, and the desk's words arrive in a fenced `JOB DATA` block.** → `va-sec`
- **`va`: layout is arithmetic; a drag writes two lines back.** → `va-canvas`

## `vp`, the drawer with a price list

- **One credit is one call, whatever its size.** Refuse too-big/too-many
  messages *before* the spend. → `vp-proxy`
- **Spend before the call, settle after** (`vp_spend` under `for update`).
  → `vp-check`
- **Codes and keys are shown once; sha256 at rest; the ledger is metadata only.**
  → `vp-check`
- **The door uses the issuer's model.** → `vp-proxy`
- **A slip is a promise: it is not rewritten after it is given** (`vp_codes_guard`).
  → `vp-check`
- **Gemini behind the `vp` door cannot carry tools** (`thought_signature`).
  → `vp-proxy`

## The suite is the argument

- **A group that is not in the test list is green by absence.** Add the suite
  *and* the line in `tools/test-all.sh`. → the summary count
- **A skip is not a pass.** No account means exit 78 and a "skipped" line.
  → `./tools/test-all.sh` summary
- **In tests, look for the row, not the count** — a list can hold rows from an
  earlier run. → `bin-check`
- **Counts in tests are relative**, never absolute. → all suites
- **A modal `<dialog>` asked about through a locator lies** — ask the page
  (`pg.evaluate`). → `settings-check`
- **A worker script in `/tmp` cannot `import 'playwright'`** — tests live in
  `apps/vn/test/`. → any suite
- **A production click can land before the dock is listening** — poll, do not
  sleep once. → `dock-apps`, `bin-check`
