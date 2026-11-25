# vc · what comes after the first week

Five things, written down so the design stays one design and not five opinions.
**All five are built** (§1–§3, with the labels in §3 and the cap in §3). What is
left is written at the end, in one paragraph, so the app stays finished while it
grows.

## 1. A library of standards, on the account — **built**

`supabase/migrations/20261211000000_vc_standards.sql`, `vc-lib.mjs` 29 checks,
`docs/vc.md` "The library". `chars` is a generated column; `deleted_at` gives the
drawer the same bin as everything else; `vc_artifacts.from_standard` is
provenance, not a foreign key you must keep.

What is still true of it: a rule is pasted into a check and lives there. The same law is pasted into
five checks and drifts. So: one table, `vc_standards`, owned by a person, reused
across their checks.

```
vc_standards
  id, user_id, title, kind, source_url, text, file_path, chars,
  created_at, updated_at
  kind: 'law' | 'standard' | 'policy' | 'terms' | 'job-ad'
```

- **Scope is the account, and only the account.** Not organisation, not state,
  not tenants, not a shared catalogue. A library that others can publish into is
  a product; a library of your own documents is a drawer. This is the drawer.
- **A check keeps the text, not a pointer.** Adding from the library copies the
  text into `vc_artifacts` and remembers `from_standard` for provenance. A
  report must be reproducible even if the law is replaced next year.
- **The library is read-only to everyone else.** Not shared, not published. When
  it is shared, it is shared by the person, in the same two-door dialog the rest
  of the suite uses — later.
- **What the library is not**: no control catalogue, no crosswalk between
  standards, no versions with diffs, no tags tree. `chars` is there so the
  person sees that the AI Act does not fit in one call before they press it.

## 2. Upload and link — **built**

`supabase/migrations/20261212000000_vc_standard_files.sql`,
`apps/api/functions/fetch.js`, `serve.py` (the same door locally),
`vc-lib.mjs` (link, pdf, off-list sentence). A standard's file is stored under
its own id — `<vc_standards.id>/<uuid>-<name>` — and the four `vc_files_*`
policies now ask either the project's question or the standard's, so the drawer
is still owner-only and nothing new is shared by accident.

The form says where the words came from: a link, a pdf, or a paste. The row in
the drawer says `linked` when `source_url` is set, and the original is named and
openable under the text.

- **PDF upload for a standard** — pdf.js in the browser, exactly as `vd` reads a
  tender. Text is stored in `vc_standards.text`; the original goes to the
  `vc-files` bucket so the person can look at page 47.
- **A link** — both sources we tried (`eur-lex.europa.eu`, `narodne-novine.nn.hr`)
  answer with HTML and **no CORS headers**, so the browser cannot read them. The
  field therefore does two different things and says which:
  - the URL is always stored as `source_url` (a citation is worth having even
    with no text);
  - "fetch the text" exists only through a new `api.<your-domain>/fetch` door with an
    allowlist of legal sources, a size cap and HTML→text stripping. Anything not
    on the list gets one sentence: *download the PDF and drop it here*.
- No OCR, no crawling, no background sync of a law. A standard changes when the
  person says it changed.

## 3. Bulk, independent — **built**

`supabase/migrations/20261213000000_vc_targets.sql`, `vc-batch.mjs` (40 checks),
`docs/vc.md` "A batch".

Fifty offers of 200 pages; a job ad and a pile of CVs. Same verdict grammar —
`PASS`, `FAIL`, `UNKNOWN` per criterion — but one report per candidate, and a
list you can sort by how many checks each one failed.

```
vc_targets
  id, project_id, user_id, name,
  status ('queued' | 'running' | 'done' | 'failed'), error,
  n_pass, n_fail, n_unknown,          -- stored so the list sorts without parsing
  created_at, updated_at

vc_artifacts.target_id  -> vc_targets (nullable; null = the single-check pile)
vc_runs.target_id       -> vc_targets (nullable)
vc_outputs.target_id    -> vc_targets (nullable)
```

- **A batch is a queue, not a loop of fifty clicks.** `run all` marks every
  target `queued`; the screen works them **strictly one at a time, in order**,
  and repaints the row as each finishes. Never in parallel: fifty calls at once
  is fifty chances to lose a half-written report and an account at the provider.
  That rule is not a performance decision, it is the whole point of a queue. Reloading mid-batch is safe: `running` becomes `queued` again.
  A stop button leaves the rest queued, not lost.
- **One target, one call when it fits.** The engine already caps a pile at
  160 000 characters and says what it left out. When a 200-page offer exceeds
  it, the template gets a *sections* mode later — the first version says
  "truncated" on the report instead of pretending.
- **Cost is said before it is spent.** "50 candidates × 1 call ≈ 50 calls" is a
  sentence on the button's row, and nothing runs on its own.
- **A hard cap of 50 targets per batch.** Not a technical limit — a promise that
  this stays a tool and not a document factory.
- **The nouns come from the template.** A batch of CVs is not checking
  "standards" against "evidence"; it checks *uvjeti natječaja* against
  *kandidati*. `templates.js` carries the labels, the screen reads them, and no
  fifth concept enters the database.

## What we will not build (the part that keeps it light)

Compliance is the app most likely to grow a control catalogue, a scoring model,
a crosswalk, a dashboard, a certification workflow and an evidence audit trail.
Every one of those has been considered and is refused for now:

- no control catalogue in the database (controls live in the standard's text);
- no crosswalk between standards, no mapping tables;
- no scores, no percentages, no red/amber/green dashboard;
- no approvals, no signatures, no audit trail of verdict edits (the run row and
  the report are the record);
- no organisation, tenant or national scope for the library;
- no scheduler, no cron, no background workers — a queue that only moves while a
  person is looking at it.

The test for anything new stays the suite's test: **does it have one sentence
the interface can hold?** Library: *"a law you keep, so you stop pasting it."*
Bulk: *"fifty offers, one list, each with its verdicts."* If a feature needs a
paragraph, it is a product, and this is not that.

## Order of work, when the week comes

1. `vc_standards` + "add from library" (no batch yet) — smallest real step.
2. PDF upload into the library (pdf.js already in the engine).
3. `source_url` + `api.<your-domain>/fetch` with the allowlist, and the sentence for
   everything else.
4. `vc_targets` + the queue + per-target verdict counts, with the 50 cap and the
   cost line.
5. Labels from the template pack, so a job ad does not read like an audit.

**All five are done.** The order was the whole design: a library first, because a
batch of fifty without a library is fifty pasted laws.

## What is left, in one paragraph

Sections mode for a document that does not fit one call (§3 above says the first
version marks the report `truncated` instead of pretending). Sharing the library
is still refused: a library that others can publish into is a product. Nothing
else on this list is waiting — and the next thing that asks to enter has to pass
the suite's test: *does it have one sentence the interface can hold?*
