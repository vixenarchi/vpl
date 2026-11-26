# The recycle bin

Pressing ✕ never destroys words. In every app that can lose a row — vn, vi, vr,
vz, vd, vc and va — the row goes to a place with a name, a number and a
different look. Deleting for good is a second, separate act.

One table column, one block of CSS, seven apps.

## What the bin is

- **`deleted_at timestamptz`** on the rows that can be lost: `vi_ideas`,
  `vr_reqs`, `vd_artifacts`/`vd_outputs`, `vc_artifacts`/`vc_outputs`,
  `va_artifacts`/`va_outputs`. Live means `deleted_at is null`; that is the
  whole model. vn had this from the start; the rest caught up
  (`20261210000000_bin_all.sql`, `…_bin_artifacts.sql`).
- **Every list knows the difference.** `listX(projectId, { bin })` is one query
  with `is null` or `not is null`. Nothing is copied to a second table, nothing
  is archived, no id changes — so a restore puts the row back exactly where it
  was, in the same order.
- **A shared document never shows the bin.** The share functions
  (`vr_read_share`, `vd_read_share`, `vc_read_share`, `va_read_share`)
  skip binned rows, so a guest reads the same document the owner sees and
  "removed" means one thing. (`20261210000200_bin_share_view.sql`,
  `…_bin_share_view_engine.sql`.)
- **Emptying is a verb, not a side effect.** `emptyBin` / `empty all` deletes
  rows by id, and only for the owner. vn's per-note purge asks first and names
  what it will take; the others are one press on a row that has already left
  the page.

## What it looks like

One block in `packages/shell/tokens.css`, so the seven cannot drift:

- **`.bin-banner`** — a bordered box above the list that is *not* the list:
  a mono uppercase `.bin-banner-title` ("recycle bin") and a
  `.bin-banner-note` that counts what is inside, in words —
  "3 keys in the bin — restore one, or empty it for good".
- **`.bin-btn`** — the button under the list. Resting it is a quiet ghost with a
  count; **open it is filled with `--mark`** and its label changes to the way
  back (`back to the wall`, `back to the sheet`, `back to the inputs`,
  `back to notes`). A button whose word says "back" must go back — that was a
  real bug: pressing it while the bin was open re-opened the bin.
- **`.bin-mode`** — the list itself changes: tinted paper, a `--mark` strip down
  the leading edge, and every row's tools visible (in the bin you are looking at
  rows to act on, not to read).
- **`.row-restore`** — `restore` is a word, not an icon, and it sits where the
  ✕ sits in the live list.

- **It has to be findable.** A button at the end of a long column is a button
  halfway down a page nobody scrolls. `.bin-foot` is `position: sticky; bottom:
  0`, so it sits on screen while the pile scrolls past it, and `.bin-banner` is
  sticky at the top for the same reason. Opening the bin also scrolls the place
  into view — a tinted list with its sign above the fold is not an explanation.
  In vi the button was inside the *ideation panel*, so it existed on one stage
  out of five; it is the column's footer now.
- **Sticky needs a real scroller.** `overflow-y: auto` on a box with no height
  is not a scroll container — it only stops `position: sticky` from working,
  because the box itself is as tall as its content. vi's `.funnel` dropped it.

**Colour is never the only signal.** The open bin is a filled button *and* a
banner with a count *and* a tinted pane with an edge — three of the four
survive a black-and-white screenshot.

vn keeps its own names (`.trash-banner`, `.bin-mode` on `.list`) because it got
there first; vz keeps a bin *view* (`#binview`) rather than a mode, because a
dictionary's sheet and its bin are two panes of one place. Both wear the same
words and the same filled button.

## The rules this cost us

- **The bin is a mode, not an address.** In vn any route change — a note, the
  list, a link somebody pasted — leaves the bin, and the bin's colours come off
  in one place. A route that quietly set `showingTrash = false` used to leave
  the tint and the edge on a list of live notes.
- **`replaceState` fires no `hashchange`** — so the router's own record has to
  be told too, or the next click on that same note is a route it believes it is
  already on and nothing happens.
- **Counts are relative in tests.** An account that has used an app has used its
  bin. `bin-check.mjs` measures *this* row: the bin before, the bin after.
- **A copy keeps each version's timestamp.** Copying a job inserted every row in
  one statement, all with the same `now()`; "the newest document" then stopped
  being a fact and the desk opened whichever came back first.
- **A guest reads the newest version.** The share functions aggregated oldest
  first while the desk listed newest first, so a reader opened the first draft.
  (`20261210000400_share_newest.sql`.)

## The test

`apps/vn/test/bin-check.mjs`, one suite, seven apps:

```bash
cd apps/vn/test
for a in vn:8102 vi:8100 vr:8101 vz:8103 vd:8104 vc:8105 va:8107; do
  APP=${a%%:*} PORT=${a##*:} node bin-check.mjs
done
```

Per app it asserts: ✕ takes the row off the list; the button carries the count;
the bin holds it; the button says it is open (`aria-pressed`) **and** its word
changes **and** it is filled; a banner names the place and counts what is in it;
the list itself changes; restore takes it out and puts it back; delete-for-good
removes it and it does not return; no page errors.

`tools/test-all.sh` runs all seven as `vn · bin` … `va · bin`.

## v1.7 — the bin is a chip in the rail, in every app

A place belongs where you can see it from anywhere, and it needs a name. After
the first real walk through `vc`, the same complaint was found in five more
apps, so the shape became one shape everywhere:

- **The bin sits in the left column, in words.** `♲ inputs`, `♲ notes`,
  `♲ rows`, `♲ words`, `♲ checks N`, `♲ jobs N` — a mark, a word, and the number
  when there is something in it. `vn` keeps its bin at the foot of the tree
  because it is also a **drag target** (*drop a note on the bin*), and the tree
  is the thing you drag across.
- **No bar at the foot of the work column.** `vi`, `vr`, `vd`, `va` and `vz` each
  had a `.bin-foot` below the sheet, the list or the words — the thing you had to
  scroll past, and the thing that could sit on top of what was under it (in `vc`
  it covered the batch button, which is why *run all* did not take a click).
  `empty all` moved into the banner, so the banner now owns the whole place: the
  title, the sentence, the noting-for-good.
- **Two bins do not share a glyph.** `vd`, `va`, `vc` keep the rows bin and the
  job bin side by side in the rail's head; without a word two `♲` are a puzzle.
- **The chip is the shell's**, in `packages/shell/tokens.css` (`.job-bin`,
  `.bin-word`), so the seven apps agree on its height (`1.9rem`, above the 30 px
  tap floor), its fill when open, and its quietness when empty.
- **A drawer must stop above the dock.** On a phone the left column slides over
  the work, and in `vn` it ran to the bottom of the screen — the bin pinned to
  its foot was **under the chat line**, unreachable. The drawer now ends at
  `var(--dock-h)`. (`vz`'s bin moved out of the rail's foot for the same reason,
  and not only on a phone.)

`bin-check.mjs` grew five assertions that are asked of **every** app: the bin has
a button, it is in the left column, it carries a word, no `.bin-foot` remains
visible, and `elementFromPoint` over its middle lands on it. `vn`'s passes on the
left-column test rather than the rail test, because its bin lives in the tree.

Proved in all seven: `bin-check` **19/19** each (vn, vi, vr, vz, vd, vc, va);
`chrome-check` 48–50/0; `ux-sniff` 0 problems; `vi-check` 20, `vr-check` 59,
`vz-check` 53, `vd-check` 47, `vc-check` 41, `va-check` 47.

## A container bins too (v1.8)

The bin held rows. A funnel, a document, a dictionary and a project still went
away from the rail with one press and a sentence nobody could undo: `delete "the
dog house" and every row in it?`. The rows inside were the person's work, and the
warning was the only protection.

Now the container is a row like the others:

- **`deleted_at` on `vi_projects`, `vr_projects`, `vz_projects`**
  (`20261223000000_project_bin_vi_vr_vz.sql`; `vd`, `vc`, `va` already had it from
  `20261214000000`). One nullable column each, one index for "binned, newest
  first".
- **✕ in the rail bins.** No confirm. The rail's bin chip carries the count, and
  the list itself changes colour — the same promise the rows get.
- **The rail's bin is a second switch in the rail's head**, beside the rows'
  bin: `♲ docs` next to `♲ rows` in vr, `♲ docs` beside `♲ words` in vz, `♲
  funnels` in vi. Two bins do not share a glyph or a word.
- **Restoring opens what came back.** A document that returns into a list nobody
  is looking at returned silently; the restore puts it back *and* opens it.
- **Deleting for good asks with the name in the sentence**, in the bin only.
- **A binned dictionary stops answering at its public address**
  (`20261223000100_vz_public_respects_the_bin.sql`): `vz_read_public` now asks
  `deleted_at is null` as well as `published`. Measured: a binned published
  project returns `null`, a live one still returns its keys.

Proved in all three: `bin-check` 19/19, plus a probe that bins, restores and
purges a container in vi (122 → 121 → 122 → 0 in the bin), vr (50 → 49 → 50),
vz (57 → 56 → 57). `vr-check` 59, `vz-check` 53, `vi-check` 20, `e2e` 25,
`mode-check` 23 — all green after the change.
