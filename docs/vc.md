# vc · compliance

`vc` is the second generator: **rules and proofs in, a verdict for every control
out**.

Two piles on the left. *Standardi* are the rules you are held to — a policy, a
checklist, a paragraph of a law. *Dokazi* are what proves it — minutes, a
configuration, a screenshot, a PDF. The model checks one against the other and
writes a report whose every finding begins with `PASS`, `FAIL` or `UNKNOWN`.

At <https://vc.<your-domain>>. Tables: `vc_projects`, `vc_artifacts`, `vc_runs`,
`vc_outputs`, `vc_shares`. Files: bucket `vc-files`, 10 MB per file.

## Why a second app and not a template of vd

The engine is the same (`vendor/engine.js`), but the screen is not: a lawyer or
an auditor never wants a canvas or a code pane, and the thing they read is not a
document with prose — it is a list of verdicts with evidence attached. The two
piles are the interface: which artifact is a rule and which is proof is the only
extra decision this app asks for (`vc_artifacts.kind`, `standard` vs the rest).

The report is still one text column. Nothing about a finding is a table.

## The verdict strip

Above the report, three counts:

```
3 PASS · 1 FAIL · 2 UNKNOWN      6 controls on the report
```

Number and word together, because colour is never the only signal. The strip is
the one piece of structure this app reads out of its own text: every line that
starts with `- PASS`, `- FAIL` or `- UNKNOWN` is a finding. Edit a line and the
count moves while you type. Write prose instead of verdicts and the strip stays
empty — which is the honest answer, and a useful one.

The templates say this in the model's own instructions:

- `audit` — a full report, one line per control with the evidence quoted, then
  what to fix first and what is missing. `UNKNOWN means the evidence was not in
  the inputs — never a guess.`
- `gaps` — only what is not proven, plus the question that would settle it.

## The screen, the roles, the copy

The same desk as `vd`: title and brief save themselves, the output is editable
text, versions are kept per run, print prints the whole report.

- The owner changes the name and the template. Editors add standards, proofs and
  reports. Readers see all three and no `generate`.
- A shared check opens through `?s=<code>` (`vc_read_share`, newest report
  first). A shared check appears in the guest's rail without a delete.
- `copy to mine` copies the check, both piles and the reports, with new ids and
  no shares. The copy starts private.
- A phone stacks the two piles above the report and the strip wraps to two lines;
  nothing scrolls sideways.

## The library

*vc has one drawer: a law you keep, so you stop pasting it.*

A standard today is pasted into a check and lives there, so the same law is
pasted into five checks and drifts. `vc_standards` is the fix — one table, owned
by a person, reused across their checks, and nothing else:

- **kind is a closed list** — `law`, `standard`, `policy`, `terms`, `job-ad`;
- **`chars` is generated** (`char_length(text)`), so "the AI Act does not fit in
  one call" is visible before the press rather than after;
- **the drawer is private** — owner-only RLS, no share function reads it, and a
  guest has no door to it. When it is shared, it will be shared by the person,
  in the same two-door dialog the rest of the suite uses;
- **a check holds a copy, not a pointer.** *add* copies the text into
  `vc_artifacts` and remembers `from_standard`; the input then says *copied from
  the library — Zakon o radu, čl. 45*. Editing the standard does not rewrite a
  report already written, and deleting the standard for good leaves the check's
  words where they are (the line then says *that standard is no longer there*).
  That is the whole point: a report has to be reproducible next year;
- **✕ bins.** A 200-page law is the last thing that should vanish because a
  finger slipped. The first ✕ takes it out of the library into the bin (with a
  *back* and a *delete for good*), and only the second press destroys it.

The screen is one dialog: the list (kind, title, how many characters it carries),
one row of verbs each, and *＋ a new standard*, which steps the list aside — one
thing at a time, so the row above and the field below cannot both claim to be
the same document.

**Where the words come from — three doors, one row.** A field for a link and
*read it*, a *＋ pdf*, and the plain paste lobby below them.

- **A link is read through our own door**, `api.terg.hr/fetch`, because
  `eur-lex.europa.eu` and `narodne-novine.nn.hr` answer with HTML and no CORS
  headers: a page cannot read them. The door keeps an allowlist of legal sources,
  follows a redirect but re-checks the host it lands on, refuses anything over
  3 MB, and strips the HTML to text with no cleverness. Anything off the list
  gets one sentence — *that source is not on the list — download the pdf and drop
  it here* — and nothing is pasted in its place. A door that starts crawling is a
  product; this one reads one page, on demand, and remembers nothing.
- **A pdf becomes text in the browser** (pdf.js, the same code `vd` uses), and the
  original goes to `vc-files` under the standard's own id, so page 47 is still
  page 47. A standard has to exist before its file has somewhere to live, so a
  file chosen in a fresh draft keeps the standard first and then fills it.
- **The row says where it came from**: `linked` when a URL is stored, and the
  original's name and size under the text, openable.
- No OCR, no crawling, no scheduled re-reading of a law: a standard changes when
  the person says it changed.

## A batch

*Fifty offers, one list, each with its verdicts.*

A job ad and a pile of CVs is not fifty clicks. `vc_targets` is one row per
candidate or offer: its own proofs, its own report, its own tally.

- **A batch is a queue, not a loop.** `run all` works the rows **strictly one at
  a time, in order**, repainting each as it lands. Never in parallel — that is
  not a performance decision, it is the point of a queue. `stop` finishes the one
  in flight and says so.
- **`running` is only true while somebody is looking.** Open the check again and
  a row that says `running` goes back to `not run yet`, in its own place. There
  is no scheduler, no cron, no worker: the queue moves because a person pressed a
  button and stops when they leave.
- **Counts live on the row** (`n_pass`, `n_fail`, `n_unknown`) so the list sorts
  without parsing a document; the number is next to the word, never alone.
- **Cost is said before it is spent**: `3 × 1 call` beside the button.
- **A hard cap of 50 rows.** Not a technical limit — a promise that this stays a
  tool and not a document factory.
- **The nouns come from the template pack.** A batch of CVs checks *uvjeti
  natječaja* against *kandidati*; an audit checks *standardi* against *dokazi*.
  `templates.js` carries the words, the screen reads them, and no fifth concept
  enters the database. The third template is `tender` — a job ad through its
  candidates, which is the batch's native shape.
- **Rules stay shared, proofs do not.** A standard added while a row is on the
  desk belongs to the check, because a rule is the same rule for every row; a
  proof belongs to that row only.
- **✕ on a row is a bin.** The row waits with its proofs, can be restored, and
  only the second press destroys it — and a shared check never shows the bin.

## What is not here

- No control catalogue in the database, no framework IDs, no scoring, no
  dashboards. Controls live in the standards text; the report counts them.
- No evidence hashing, no audit trail of who changed which verdict. The run row
  keeps the template, the notes and the model; the report is the record.
- No OCR and no rendering.

## Tests

`apps/vn/test/vc-check.mjs` — 34 checks: two piles, a standard and a proof and a
text file, the dialog knowing which pile it is adding to, a mocked model at the
shared door, the strip counting 3 / 1 / 2, the strip following an edited verdict,
the report surviving a reload, notes and versions, copy, a guest link (strip and
piles visible, no generate), a phone at 390 px, and cleanup.

`apps/vn/test/vc-lib.mjs` — 44 checks: the drawer opens beside ＋ standard, a
standard is kept with its character count, keeping it does not put it in the
check, *add* copies the whole text and says where it came from, ✕ bins rather
than destroys, the bin counts it and can give it back, editing or deleting the
standard never touches the copy, a link becomes the text through the door (and a
source off the list gets a sentence, not a silence), a pdf becomes text while the
original is kept and named, and a guest has no door to the drawer.

`apps/vn/test/vc-batch.mjs` — 40 checks: a tender check names its own piles, rows
are numbered and renamed in place, each row keeps its own proofs while the rules
stay shared, `run all` makes one call per row one after another (each call
carrying only its own candidate), the tallies land on the row, one report per row
with its own versions, `stop` finishes the one in flight and says so, ✕ on a row
bins it and restores it, and a phone at 354 px does not scroll sideways.

```
PORT=8105 OAUTH_PORT=0 ./serve vc
VC_URL=http://127.0.0.1:8105 node vc-check.mjs
VC_URL=http://127.0.0.1:8105 node vc-lib.mjs
VC_URL=http://127.0.0.1:8105 node vc-batch.mjs
VC_URL=https://vc.<your-domain> node vc-check.mjs       # production
./tools/test-vc.sh                                     # all three
```

## v1.6 — the tick says what the run covers

A batch answers the same rules against several candidates, and a person rarely
wants all of it: sometimes one row, sometimes two of three, sometimes one rule
against everything. That choice is now a tick, and an **empty tick means all of
it** — a list nobody narrowed is a list that runs whole.

- **Two bins, both in the rail, both with a word.** `♲ inputs` (the rules and
  proofs of the open check) and `♲ checks` (the checks themselves). The row bin
  used to sit at the bottom of the work column, under the candidates, where it
  read as one more piece of the check; a place with a name belongs on the left.
  Two ♲ glyphs alone would be a puzzle, so each carries its word and its number.
- **A tick on every row, every rule, every proof.** It is the same control in all
  three lists: press to include, press again to leave out. The count beside the
  heading says how much a run will use (`2 of 3`), the button says what it will
  do (`run 2 chosen`), and the line under it says how much of the list that is.
- **▶ runs one row on its own**, without touching the ticks.
- **The rules and the proofs travel only when ticked.** A run narrowed to one
  rule sends that rule's text and no other; the proofs are filtered per row, so
  each candidate still gets only its own.
- **`all` and `none` are one press each**, and `none` returns to "everything",
  which is what `run all` means by default.
- **The run button is never covered.** The bar that held the row bin was the
  thing sitting over the foot of the candidate list on a short column; it is gone
  with the bin.

`vc-batch.mjs` grew eleven assertions for this: both bins inside the rail, both
carrying a word, no bin left in the work column, the count lines, ▶ running one,
only the ticked rule in the request body, two of three chosen, `all`/`none`.

