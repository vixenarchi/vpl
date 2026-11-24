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

## Next: library, links, batches

Agreed and deliberately not built yet — see `docs/vc-next.md`. In short: a
library of standards on the account (`vc_standards`, copied into a check so a
report stays reproducible), PDF upload and a link field (both sources we tried
send no CORS headers, so a link needs a fetch door with an allowlist; otherwise
the sentence is "download the PDF and drop it here"), and bulk as a queue of
independent targets (`vc_targets`) with one report each and verdict counts on
the row, capped at 50.

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

```
PORT=8105 OAUTH_PORT=0 ./serve vc
VC_URL=http://127.0.0.1:8105 node vc-check.mjs
VC_URL=https://vc.<your-domain> node vc-check.mjs       # production
```
