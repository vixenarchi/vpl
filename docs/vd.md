# vd · documents

`vd` is the first of the generator apps: **inputs in, one document out**.

A job is a pile of papers and the thing you have to write from them. Tender
documents become an offer; a contract becomes a summary; minutes become a plan
with owners and dates. The model reads the pile and proposes; the person keeps
what is true, because the output sits in a textarea and nobody is asked to
"accept" anything.

At <https://vd.terg.hr>. Tables: `vd_projects`, `vd_artifacts`, `vd_runs`,
`vd_outputs`, `vd_shares`. Files: bucket `vd-files`, 10 MB per file.

## The shape the three generators share

The engine is `packages/shell/engine.js`, copied into `apps/vd/vendor/engine.js`
by `tools/stage.sh` like `tokens.css`. It knows nothing about tables or the
screen:

- `buildMessages({ template, project, artifacts, notes })` — one system line, the
  job's brief, every input as a titled block, the template's task and shape, and
  the notes from the last answer.
- `callModel(messages)` — through `/api/chat`, falling back to
  `https://api.terg.hr/chat` when the app is served statically. The key is the
  person's, in `localStorage`, per address.
- `extract(file)` — pdf.js in the browser for PDFs, plain text for text files,
  nothing for images (the file still travels with the job).
- `artifactBlock`, `LIMITS` — one input is cut at 24 000 characters, the whole
  pile at 160 000; a cut says how much it left out.

Each app supplies a **template pack** (`templates.js`) and a **screen**. Nothing
else. `vc` is the same engine with two piles of inputs and a verdict strip; `va`
will be the same engine with a small canvas.

## No metamodel

This is the lesson from the ten-month Java version, written down so it is not
repeated: an artifact is `kind`, `title`, `text`, and optionally a file. There is
no artifact graph, no typed relationship, no workflow engine, no universal
"transformation" object. If a template needs structure, that structure is
markdown inside one text column. `vd_runs` records what was asked (template,
model, notes, a short prompt note) so an answer can be explained; it is not a
process engine.

## The screen

Two panes, one desk. Left: the pile (`＋ text`, `＋ file`, each row opens into a
dialog). Right: the document (`textarea.doc`, serif, on paper), the notes field
and `generate`. Above the document, a pick of earlier versions — one output row
per run, so a second answer never destroys the first.

- The title and the brief save themselves 750 ms after typing; the output does
  the same. No save button anywhere.
- `generate` is the only verb that spends anything: it writes a `vd_runs` row
  (`running`), calls the model, then `done` or `failed` with the model's own
  words in `error`. The elapsed seconds are shown while it thinks.
- A PDF is read page by page and the progress says so; the original stays in the
  bucket and the row links to it with a one-hour signed URL.
- The template is a decision of the owner (`vd_decisions_are_the_owners` changes
  the name or the template → `23514`). Editors may add inputs, write outputs and
  generate; readers may not.
- A phone stacks the panes and keeps `generate` within a thumb's reach (sticky,
  with the notes beside it). Nothing scrolls sideways.

## Sharing

Two doors, the same as everywhere in the suite: a link (`?s=<code>`, read-only,
through `vd_read_share`) and one person by address (`view` or `edit`). A shared
job appears in the guest's rail, without a delete button; a reader sees the
standards, the inputs and the report and no `generate`.

`copy to mine` copies the job, its inputs' text and its outputs, with new ids.
Files stay where they were uploaded, and shares stay home: a copy starts
private. A guest who is not signed in clicks it, lands on the gate, and the copy
is made on the way in (`localStorage['vd.copy']` holds the code for one page
load).

## What is not here

- No folders, no tags, no versions of an input, no comments.
- No rendering of the markdown — the document is text you own. Print prints it
  as a document (serif, whole document, no pager).
- No OCR: an image travels with the job and its text does not.
- No approvals, no statuses, no signatures. A document is done when you send it.

## Tests

`apps/vn/test/vd-check.mjs` — 40 checks: a job, a pasted input, a text file read
into text, template persistence, a mocked model at the shared door (inputs and
notes must reach it), versions, the person's edit surviving a reload, copy, a
guest link, the copy-on-the-way-in, a phone at 390 px with no sideways scroll,
and its own cleanup.

```
PORT=8104 OAUTH_PORT=0 ./serve vd
VD_URL=http://127.0.0.1:8104 node vd-check.mjs
VD_URL=https://vd.terg.hr node vd-check.mjs       # production
```
