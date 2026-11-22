# vr — requirements

`vr` is at **https://vr.terg.hr**. One document is one sheet of rows. A row is
one testable sentence with a name that does not change, a mark of how hard it
is, and — when somebody asks — the proof that it is met.

The app comes from a spreadsheet that was law: a 2012 CRM sheet for T-HT with
271 numbered requirements, grouped two levels deep, with "current/desired
state", a free-text time horizon and a source. That sheet was excellent at
capture and had no answer to *is this met?* — the ID was the row number, so
nothing could be quoted. `vr` keeps its shape and adds the two things it
lacked: a name that survives sorting, and a column for proof.

## Three axes, not one

The Excel had "Vrsta zahtjeva" doing two jobs at once. They are separate here,
because each answers a different question:

- **theme** — where the row belongs in the document ("the visit", "the
  price"). Free text; the sheet groups by it. Two levels exist: `theme` and an
  optional `category`, so "the price / the four numbers" is possible.
- **kind** — what kind of obligation it is: `functional`, `nonfunctional`,
  `constraint` (a law, a standard, an existing system), `rule` (a business rule).
- **strength** — how hard: `must`, `optional`, `wish`.

Strength is the first filter and it owns the only colour in the app: **■ must**
(red), **◆ optional** (ochre), **◇ wish** (slate). Colour is never alone — the
mark and the word travel with it, and the row says it in words.

Wishes stay in the same sheet, one filter away. A separate shelf would split the
single list of truth; in `vi` parking is a *decision*, here a wish is the same
row with a smaller stake.

## A row

Default columns (what a person with twenty rows sees): **requirement · how hard ·
status**, and **theme** only when you are standing in *everything* (inside a
theme the column would only repeat the drawer you came from). The requirement
cell carries its stable name in small monospace, then the title, then the one
testable sentence — one line each.

*all columns* adds **id · kind · source · how we know**, remembered in the
browser, not in the document.

Twenty rows to a page, `page 1 / 13 · 247 rows`, arrows beside the counter; every
column heading sorts (how-hard and status sort by the document's own order, not
the alphabet). Print is not paged — paper gets the whole document.

## The tree, and where a new row goes

Themes are a tree two levels deep: the document, a theme, a subtheme. It lives in
the left rail under the documents, opens a theme's children only while you are
standing in it, and has an **unfiled** row for rows that belong to no theme yet.
The header shows the path (`T-Com CRM · zahtjevi v15 / One/same interface`) and,
on a phone, is the door to the drawer. A row typed into the box at the bottom
lands in the theme you are standing in, marked by the line above the box — no
extra click, and no theme picker in the row.

Everything else a row may know lives in the row, opened in place by clicking it:

- `statement` — one testable sentence ("The visit form shall accept entries with
  no network connection."). The add box writes this one field.
- `title` — a few words for the sheet.
- `detail` — the long version.
- `asis` / `tobe` — what it is today, what it should be. The Excel's
  "Trenutno/željeno stanje" was the most useful column it had.
- `horizon` — free text. "short", "2014/15", "Q3 2027" all appear in real
  sheets; the model may suggest a tidier form, never rewrite it.
- `source` — who asked, or what forces it.
- `verification` — how we will know: a test, a review, a demo.
- `metric`, `target`, `conditions` — for a non-functional row, the number: *what*
  is measured, the figure it must reach, and under which conditions. "The system
  shall be fast" is not a requirement; `p95 < 300 ms` under `500 concurrent
  users` is.
- `clause` — a law or a standard, down to the clause (GDPR art. 32(1)(a), EN
  1090-2 §7.3). "GDPR" alone means nothing.
- `status` — `draft`, `agreed`, `built`, `verified`, `dropped`. Four states and
  a drop; no workflow, no approvals chain.

Rows move with the arrows in the row, or `Alt+↑` / `Alt+↓` from inside one.

## The name is a promise

`VR-001` never becomes `VR-002` and is never reused after a delete. The database
assigns it on insert (`vr_ref_for`), and a unique index on
`(project_id, ref)` makes duplicate names impossible. A pasted batch computes its
own names in one statement so 271 rows do not fight over the counter.

This is the difference between a sheet you can quote in a meeting and one you
cannot.

## The brief and the glossary

Above the rows, collapsed: **the brief** — what this is about, what it assumes,
what is out of scope. Assumptions and out-of-scope are first-class because they
are what everybody forgets and later argues about.

The glossary belongs to the document, not to the suite: the same acronym means
something else in another trade, and a shared service would be an empty list with
an administrator. A term is a word and one sentence; add with `Enter`; the
**suggest terms** button has the model read the rows and propose 5–10 words a
reader from another trade would get wrong, in the same proposal list as
everything else.

The glossary pays off on the way out: the markdown copy carries it, so the first
use of an acronym in the document can be spelled out.

## Paste is the bridge

The real entry point is not a blank box — it is an `.xls`. **paste rows** takes
anything tab- or comma-separated (Excel, Numbers, a table copied from a page):

- a cell holding `must` / `optional` / `wish` (or order/optional/could) becomes
  the strength; `functional` / `non-functional` / `constraint` / `rule` becomes
  the kind;
- the sentence is the **longest** remaining cell, whatever order the columns had;
- a short remaining cell is the theme, the rest becomes the long version;
- a header row (`Vrsta zahtjeva`, `Kategorija`, `Opis zahtjeva`, `requirement`)
  is skipped;
- names continue from where the document stopped, instead of restarting at 001.

Quoted commas stay in one cell. A line with no sentence ("wish | the visit") is
not a requirement and is dropped, rather than becoming a row called "the visit".

## The words of a document

Importance, status and kind are not fixed lists in the database any more. Every
document carries its own vocabulary (`vr_vocab`), seeded with the words most
documents use — `must / optional / wish`, `draft / agreed / built / verified /
dropped`, `functional / nonfunctional / constraint / rule` — and any list can
grow from the screen: pick **＋ another word…** in a select and type it. It is
remembered for the document, gets a colour and a place in the order, and the
mark beside it follows that place.

That is how a Croatian tender says `P1…P4`, a school project says
`must / nice to have`, and a house build says `before the roof / after the roof`
without anyone opening a settings screen. The colours belong to the values, not
to the words: `must` is red because it is first, and whatever you put first is
red.

The log (below) is the other half of this: a change of importance or status is a
decision, and a decision leaves a line behind.

## What is missing, said out loud

A strip under the tools counts what a requirements sheet usually hides in a
report:

- **must without proof** — the row has no verification, so nobody can say it is
  met;
- **non-functional without a number** — an NFR with no metric is a wish wearing a
  suit;
- **without a source** — only when *all columns* is on.

Clicking a gap filters to those rows. When there is nothing to say, the strip
says so in one green line; an empty report is also information.

## The model

Three jobs, all through the suite's proxy (`/api/chat`, then
`https://api.terg.hr/chat`), all with the key that lives in this browser:

- **review with AI** — up to 40 rows (musts first), and the answer is read as
  `ref | field | value | why`. Fields it may touch: theme, kind, strength,
  verification, metric. Each proposal appears with the value and the why, and
  **use it** applies that one; **use all** applies the rest. Nothing lands in the
  sheet on its own, and the `why` is never written anywhere.
- **draft rows from this** — the brief as a paragraph in, rows out. Same list,
  same two buttons.
- **suggest terms** — the glossary, above.

A model that disobeys the line format is read leniently: refs are matched by name
or by number, values are unquoted, kinds and strengths are mapped from words. The
prompt is the braces, the parser is the belt.

No key, no balloon: a dashed line above the sheet says the AI buttons need a key,
with a link to the settings, and it disappears the moment a key exists.

## Sharing

The whole document, from the share button beside the title:

- **a public link** — `vr.terg.hr/?s=<code>`, read-only, no account. The rows
  come from `vr_read_share(code)`, which returns the document, its rows and its
  glossary to that code and nothing else.
- **one person** — an address and a role. `view` reads; `edit` writes text
  (statements, detail, asis/tobe, theme, source, verification, a new row, a term).

**The shape of the document is the owner's.** The name, the strength, the kind,
the status, the order and deleting do not move for a guest, and that is a
trigger, not a UI promise: `vr_decisions_are_the_owners` raises `23514` with
*only the owner changes the name, the strength, the kind or the order*. Renaming
the document is refused the same way. Verified against the database with a real
second account: text saved, a strength change refused.

Guests see the same page with the verbs taken out: one `data-role` on `<body>`,
two CSS classes, and a banner that says what this person may do.

A shared document can become your own: **copy to mine** reads the sheet (a share
allows reading) and inserts a fresh document under your id, with every row, its
name, its strength and its order. The original stays where it was; the copy is
yours to decide on. That is also the honest answer to "I was given a spec and I
disagree with its priorities" — take it, change it, argue later.

## In and out

**Copy** puts the document on the clipboard as markdown, grouped by theme, with
names, strengths, proofs, numbers, clauses and the glossary. **Print** prints the
document: the bar, tools and gaps disappear, the brief opens itself for the
paper, the title stops looking like an input, and a line under the title carries
the date, the counts and `vr.terg.hr`.

## What this is not

- no actors-and-volumes table (the AWS report's per-actor numbers were a
  spreadsheet of their own; here a non-functional row carries its metric,
  target and conditions, and the actor is a word in the text)
- no MoSCoW, no RACI, no attribute engine, no baselines, no ReqIF, no
  traceability graph
- no workflow: four statuses and one drop
- no links to test cases yet — `verification` is a sentence, and `vr_links` is
  the next thing to build if people start asking "show me the evidence"
- no per-stage sharing, because a document is not a stage
- no cross-app writes: a requirement becomes a `vn` note by copy-paste, like
  everything else in the suite

## The log, with no screen yet

`vr_log` records who changed what, with a snapshot of the row as it stood:
`changed | strength,status | {before} | {after} | to_jsonb(row)`. It is written
by a trigger, not by the screen, so it is true whatever the screen does, and it
is readable by the owner and by anybody the document is shared with. There is no
history panel yet — the table is the promise that there can be one.

Status is progress, not a decision: an editor may move it, and the log says who.
Importance, kind, name and order stay with the owner.

## Tests

Five scripts (one is screenshots), 106 checks, all in `apps/vn/test` (Playwright lives there):

- `vr-check.mjs` — 49: naming, strength cycling, sorting, find, gaps, detail
  autosave, all columns, moving, `Alt+↑`, the tree (a theme, the quick add going
  into it, the theme column stepping aside), print media, a phone at 390 px,
  copy, reload, delete.
- `vr-paste.mjs` — 11: a T-com shaped header, tabs, commas, quoted commas, names
  continuing, header not becoming a row.
- `vr-ai.mjs` — 21: the no-key hint, the proxy call, proposals before writing,
  `use it` / `use all`, drafting from the brief, glossary suggestions.
- `vr-share.mjs` — 25: the link read-only, the guest's rail, an editor writing a
  row, the screen refusing a decision, the database refusing it with 23514, and
  an editor taking a copy where the strength does move.

All four run against `https://vpl-vr.pages.dev` as well as locally.

## Notes for the next person

- `pos` orders rows; `visible()` sorts by it, so a swap in the database shows up
  in the sheet. Without that sort the two updates looked like no change at all.
- The `vr_decisions_are_the_owners` trigger branches on `tg_table_name` **first**.
  Its first version read `new.project_id` before asking which table it was on,
  and every document update died with `42703`.
- The shell has no dark input background of its own; vr sets fields to the paper
  colour, otherwise a white box glares out of a dark sheet.
- The name field follows the document, not every repaint of it (`headFor` in
  `paintHead`). The rows arrive after the document does; painting the stored name
  on that second pass silently undid a name typed on a slow connection.
- `wrangler pages project create vpl-vr` had to run before the first deploy; the
  custom domain was attached with one API call, and the CNAME is a dashboard
  step because the login token may write Pages but not DNS.
