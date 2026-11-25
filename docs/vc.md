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

## Next: links, batches

Still deliberately not built — see `docs/vc-next.md`. PDF upload into the
library, then a `source_url` with a fetch door and an allowlist (both sources we
tried send no CORS headers, so a link cannot be read from the browser), then
bulk as a queue of independent targets (`vc_targets`) with one report each and
verdict counts on the row, capped at 50.

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

`apps/vn/test/vc-lib.mjs` — 29 checks: the drawer opens beside ＋ standard, a
standard is kept with its character count, keeping it does not put it in the
check, *add* copies the whole text and says where it came from, ✕ bins rather
than destroys, the bin counts it and can give it back, editing or deleting the
standard never touches the copy, and a guest has no door to the drawer.

```
PORT=8105 OAUTH_PORT=0 ./serve vc
VC_URL=http://127.0.0.1:8105 node vc-check.mjs
VC_URL=http://127.0.0.1:8105 node vc-lib.mjs
VC_URL=https://vc.<your-domain> node vc-check.mjs       # production
```
