# What comes after the code

The suite is built and green (`docs/state.md`). The person's next phase is not
code: it is **marketing, design, a pitch, and a business model**, and this page
exists so that the work does not get lost in a context change.

Written 27 November 2026. Nothing here is decided; it is the map of questions,
with the parts that *are* decided marked as such.

## The order the person asked for

1. Polish `www.terg.hr` and publish it — plan in `docs/www.md`, waiting on six
   imprint fields.
2. Marketing: what this is called, who it is for, how it is described.
3. Design: one look, carried from the product to the front door.
4. Pitch: the story in one page, for a customer, a partner, or an investor.
5. Business model: free / paid, and where the line runs.

## Facts the marketing cannot contradict

These are properties of the thing as built, not aspirations:

- **No install, no sync, no plugin.** A browser and a login.
- **One account for eight tools.** Notes, ideas, requirements, a dictionary,
  documents, compliance, keys, architecture.
- **No tracking and no third-party script.** CSP refuses them; the edge beacon
  was switched off; no cookies beyond the session.
- **The model key is the person's own.** AI features run on a key they paste,
  not on a subscription we resell — the cost of the model is theirs and visible.
- **Data is theirs.** Export is a copy button, the bin is undo, deleting for good
  is a separate verb. One database, in the EU.
- **Small on purpose.** Each app is a folder of plain files; there is no server of
  ours to keep warm.

## Questions that need an answer before a page or a pitch is written

- **Who is the first user?** A person who writes documents for a living
  (offers, reports, requirements), or a small team that needs a shared place for
  the same? The suite is built for one person; the sharing is per document.
- **What is the name?** `vpl` is the repository's name. The product currently
  shows eight names and no umbrella name; the front door needs one.
- **What is the one sentence?** Candidates to test against the first screen:
  "eight small tools, one account, no install", "notes and the paperwork that
  follows them", "the documents you have to write, with the model doing the
  reading".
- **Free for whom, and what is paid?** Nothing is metered today except `vp` codes
  (one credit is one model call). The honest options: free while it is one
  database; paid per account when there is support; or paid only for the model
  calls, passed through at cost.
- **Croatian first or English first?** The interface is English, the person is
  Croatian. A `.hr` front door implies a Croatian page; `hr.html` already exists
  in the v2 history as a precedent.

## What is parked, and why it is not part of this phase

- **`w3`** — the generator that turns `vn` notes into a published page with a
  menu, a stored skeleton and CSS, and a modern markdown reader. The person's own
  description is in `docs/w3.md`; three questions there are still open. It is a
  *product*, not a marketing task, so it waits.
- **Key-value configuration** instead of a model key in `localStorage`.
- **The server-side key store** (a day of work, ends "zero servers").

## What to write when the phase starts

- `docs/marketing.md` — the one sentence, the three audiences, the objections and
  the honest answers, and the copy for the front door.
- `docs/pitch.md` — one page: the problem, what exists (with a link to a live
  app), what it costs to run, and what the ask is.
- `docs/pricing.md` — free / paid line, what is metered, what is never metered
  (privacy is not a tier).
- Keep **`docs/state.md`** updated when the product changes, so the pitch never
  describes a version that no longer exists.
