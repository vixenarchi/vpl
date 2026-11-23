# Start here

For a person — or a model — who arrives with no context. Read this, then
`README.md`, then the one app you were asked to touch. Everything below was true
on 21 Nov 2026 and is checked by the tests named at the end.

## What this is

**vpl** (vixen productivity light) is a suite of very small, independent web
apps that share one login, one database and one look. The success metric is
*lightness*: one repo, one database, one deploy target, zero servers, zero euro
per month. A new app is a folder of plain files, one table with a prefix, one
Cloudflare Pages project.

- **vn** — notes, at <https://vn.terg.hr> (tree, bins, sharing, agent chat)
- **vi** — an idea funnel, at <https://vi.terg.hr>: context → ideate → explore →
  select one → simulate. See `docs/vi.md`.
- **vr** — requirements, at <https://vr.terg.hr>: one document is one sheet of
  rows, each a testable sentence, marked must / optional / wish, with proof and
  a glossary. See `docs/vr.md`.
- **vz** — zed, a dictionary, at <https://vz.terg.hr>: a project is a box of
  keys, a value is any text, and a project can be published as a read-only
  service at `/p/<code>`. See `docs/vz.md`.
- **vd** — documents, at <https://vd.terg.hr>: a job is a pile of inputs and one
  document you have to write from them, with the model behind one `generate`
  button. See `docs/vd.md`.
- **vc** — compliance, at <https://vc.terg.hr>: standards and evidence in, a
  verdict per control out, counted above the report. See `docs/vc.md`.
- **vp** — keys and codes, at <https://vp.terg.hr>: one model key saved on the
  account and adopted by every browser; a code is a slip with calls and an
  expiry, redeemed into a key that spends the issuer's model through
  `/vp`. See `docs/vp.md`.
- **api** — the shared proxy at <https://api.terg.hr>: `/chat` (model calls),
  `/search` (Tavily/Serper evidence) and `/vp` (the door that spends a code's
  issuer key). Model APIs send no CORS headers, so the call leaves from our own
  origin.

There is no bundler, no framework, no build step. `index.html`, `app.js`,
`style.css`, `lib/*.js`, two CDN libraries (supabase-js, DOMPurify), Google Fonts
in `vi`.

## Where things are written down

- `README.md` — the suite, the database, the commands, the rules
- `docs/vi.md` — why a funnel, the five stages, the look and why it is not a dashboard
- `docs/vr.md` — why a requirements sheet, the three axes, the stable names, the
  proof column, what is deliberately not there
- `docs/vz.md` — why a dictionary, the key that ignores case, hidden values as a
  curtain, and the one project switch that makes a service
- `docs/vd.md` — the generator's engine, the desk of inputs, and what is
  deliberately not modelled
- `docs/vc.md` — two piles, the verdict strip, and why the same engine is worth
  a second screen
- `docs/vc-next.md` — what comes next in vc, agreed and not built: the library of
  standards, a link/PDF door, and bulk checks as a queue
- `docs/vp.md` — the key of record, codes with calls and an expiry, the door,
  and the service-role key that comes with it
- `docs/unify.md` — the bar, settings, gate texts and share dialog, written down
  as one unification job for later
- `docs/build-notes.md` — why v2 exists, the gotchas, where Google's redirect URL lives
- `docs/specification.md` — the 0-architecture this is built against
- `~/.config/vpl/accounts.md` — **outside the repo, mode 600**: project ref, app
  keys, provider keys, accounts. Never print it, never copy it into a file that
  git can see.
- `~/.config/vpl/todo-user.md` — the dashboard steps only a human can do

## The rules that are not style choices

1. **One table per app, prefixed.** `vn_notes`, `vn_shares`, `vi_projects`,
   `vi_ideas`, `vi_shares`, `vr_projects`, `vr_reqs`, `vr_terms`, `vr_shares`,
   `vr_themes`, `vr_vocab`, `vr_log`, `vz_projects`, `vz_pairs`, `vz_shares`,
   `vd_projects`, `vd_artifacts`, `vd_runs`, `vd_outputs`, `vd_shares`,
   `vc_projects`, `vc_artifacts`, `vc_runs`, `vc_outputs`, `vc_shares`,
   `vp_codes`, `vp_keys`, `vp_charges`, and the one row that is deliberately not
   per app: **`vpl_ai`**, the key of record, a person's own model key that every
   app may read and nobody else can. An app never writes into another app's
   table. `vpl_prefix_check()` guards the convention.
2. **Migrations are numbered and re-runnable.** A schema change is a new file in
   `supabase/migrations/`, pushed with
   `cd /home/vergovic/vixen/supabase && npx supabase db push --remote`. Never edit
   an applied migration.
3. **Row level security is the lock**, not the anon key: every table is owner-only
   unless a share row says otherwise.
4. **No cross-app writes.** A parked idea becomes a note only by copy-paste.
5. **Never delete by content — only by id.** Same for notes and ideas.
6. **Plain text out of models.** Prompts ask for it, `plain()` strips markdown
   anyway, and nothing a model says lands in a field until a person presses *use
   it* — the balloon rule.
7. **Colour is never the only signal** (every stop has number + word + icon) and
   **typed text is never centred**.
8. **Independence beats sharing.** Each app ships its own copy of the shared shell
   (`packages/shell` → `apps/<app>/vendor/`), never a link back into the repo.

## Commands

```bash
./serve vn                 # http://127.0.0.1:8099
PORT=8100 ./serve vi       # vi needs its own port; 8099 is vn
./deploy vn | vi | vr | vz | api   # stage → upload to Cloudflare Pages
./tools/stage.sh vi        # copy packages/shell into apps/vi/vendor
```

`deploy` ships only what a browser asks for: `index.html`, `app.js`, `style.css`,
`prompts.js`, `config.local.js`, `_headers`, and the `lib/ icons/ vendor/
functions/` folders. **Anything else at the app root does not ship** and prints
`note: not shipped from the app root: …`. A missing module then looks like a bug
in the app, not like a deploy mistake.

### The bucket

`vr` keeps one attachment per row in a private Supabase Storage bucket called
**`vr-files`**. It is created by the migration, not by the dashboard
(`insert into storage.buckets … file_size_limit = 2097152`), because a bucket
nobody can recreate is a bucket that exists on one machine.

The rules that make it safe are in `20261127000000_vr_files.sql`:
`vr_can_read(project)` / `vr_can_edit(project)` are the same questions the
tables ask, and `vr_path_project(name)` reads the document id out of
`<project>/<row>/<stamp>-<name>` without ever raising on a stray object. A file
is reached through a signed url asked for at the moment somebody opens it.

If you delete an account, its rows go but its files stay in the bucket: the
storage API is the only way to remove the bytes, and `vpl_delete_my_account()`
is SQL. A bucket sweep is a dashboard job; it is the one promise the suite does
not keep on its own.

### The published service

`vz` is the only app with a second promise beside sharing: a published project
answers anyone at `GET /p/<code>` (JSON map) and `GET /p/<code>/<key>`
(`text/plain`, `404` for a key that is not there). Two Pages Functions in
`apps/vz/functions/p/` call the RPC `vz_read_public` with the anon key — no
server, and `*` on CORS on purpose. Publishing sends every value, hidden ones
included; the checkbox says that once, in the dialog, because the alternative
would be a service that quietly serves half a configuration.

## Tests

Playwright lives in `apps/vn/test/node_modules`; run everything from
`apps/vn/test`. The account is `vpl-agent@terg.hr` (password in
`~/.config/vpl/accounts.md`).

```bash
VI_URL=http://127.0.0.1:8100 node vi-check.mjs       # funnel, 20 checks
VPL_SEARCH_KEY=… VI_URL=http://127.0.0.1:8100 node vi-ai.mjs   # balloons, 14 checks
VI_URL=http://127.0.0.1:8100 node vi-share.mjs       # sharing, 12 checks
node take-check.mjs                                 # copy markdown into my notes, 12
node vi-take.mjs                                    # copy a funnel home, 16
VR_URL=http://127.0.0.1:8101 node vr-check.mjs      # sheet, 59 checks
VR_URL=http://127.0.0.1:8101 node vr-paste.mjs      # spreadsheet, 11 checks
VR_URL=http://127.0.0.1:8101 node vr-ai.mjs         # model proposals, 21 checks
VR_URL=http://127.0.0.1:8101 node vr-share.mjs      # sharing, the refusal, the copy + its file, 29 checks
VZ_URL=http://127.0.0.1:8103 node vz-check.mjs      # dictionary, bin, guest, the service, phone, 59 checks
VPL_MODEL_URL=… VPL_MODEL_KEY=… VPL_MODEL=… node vi-real.mjs "project title"
```

`vi-check` and `vi-ai` clean up after themselves (the project they create is
deleted at the end). `vi-real.mjs` is a real model pass through an existing
project and keeps every answer in `/tmp/model-*.txt`. `vz-check` does the same:
it deletes the project it made and the copy a guest took of it.

## What is not built yet

Two things, both on the same pattern and neither a new architecture:

- **more apps.** Each one is a folder, one prefixed table set, one Pages
  project, one subdomain, one `docs/<app>.md`, one `<app>-check.mjs`. The rule
  for accepting a new app is not "is it useful" but **"does it have one
  sentence the interface can hold"** — vn holds a tree, vi holds a funnel, vr
  holds a sheet, vz holds a dictionary, vd holds a desk, vc holds a verdict
  strip, vp holds a drawer of slips. An app whose sentence is a paragraph will
  be a paragraph of interface.
- **`www.terg.hr`, the front door.** Not an app: a static site with no table,
  no login and no dashboard, pushed like everything else. Three product lines
  (vpl, eva, consulting), the organization and its imprint, marketing copy, an
  FAQ with a contact form that sends an e-mail, a blog of markdown posts and a
  short news list. It is the only place that knows the whole family — every app
  stays independent and never links to a sibling from its own screen. The scope,
  the boundaries and the order of work are in `docs/site.md`.

Until then the addresses are the front door.

`vn` has its own checks: `e2e.mjs`, `dnd-check.mjs`, `tree-check.mjs`,
`share-check.mjs`, `touch-check.mjs`, `mode-check.mjs`.

## What is verified, and how

- Production: `vn.terg.hr`, `vi.terg.hr`, `api.terg.hr` all answer 200; the
  deployed `app.js` is checked for the code that was just written.
- Google sign-in: the button reaches Google with
  `redirect_uri=…supabase.co/auth/v1/callback` and the authorize call carries
  `redirect_to` = the app's own origin (see `docs/build-notes.md`).
- Models: `gemini-3.1-flash-lite` (default), NVIDIA `nemotron-3.5-bolt-e4b` (fast,
  thin), `nemotron-3.5-lightning` (good prose, careless arithmetic),
  `mistral-large-4-1t` (over a minute — unusable). Findings are in the `vn` note
  “vi · model field notes”, shared with the owner.
- Search: Tavily and Serper both answer through `api.terg.hr/search`; a foreign
  origin gets 403 and a missing key gets `{"error":"no key"}`.

## Gotchas that cost time before

- The proxy body key is **`url`**, not `endpoint`, and it must be the **full**
  endpoint (`…/v1/chat/completions`). `aiEndpoint()` adds the path; `/openai`
  bases (Gemini) need `/chat/completions`, not `/v1/…`.
- A new provider host must be added to `ALLOWED` in **both**
  `apps/api/functions/chat.js` and `serve.py`, or local and production disagree.
- A new app's address must be added to `ORIGINS` in `chat.js` and `search.js`.
- `localStorage` is per origin: model and search keys are pasted once per
  subdomain, on purpose. No cookie carries a key.
- `vi`: `#sim-who` is a `<p>` — `inputValue()` throws, use `textContent`. The
  parked drawer auto-opens after a choice; clicking its summary closes it.
  Playwright `fill` on a hidden panel times out — click the stage stop first.
- Google's model names move: `gemini-2.5-flash` is retired for new keys,
  `gemini-3.8-flash` answers 503 while not being in the model list. Check
  `/v1beta/models` before blaming the app.
- Flaky by nature: tests that wait for a repaint (parked drawer) need polling,
  not a fixed timeout. `until()` in the test files exists for that.
- `vr`: the decision trigger branches on `tg_table_name` **before** it reads a
  column; `vr_projects` has no `project_id` and the first version broke every
  update with `42703`. A guard has to know which table it is on.
- `vr`: rows are ordered by `pos` in `visible()`. The database may be right and
  the sheet still look unchanged, if the paint reads the array order.

## Adding the next micro app

1. `apps/<name>/` with `index.html`, `app.js`, `style.css`, `lib/db.js`,
   `config.example.js`, `_headers`; copy `config.local.js` from a sibling (it is
   git-ignored) and `./tools/stage.sh <name>`.
2. One migration, `<prefix>_…`, with RLS owner-only, touch trigger, and the
   prefix added to `vpl_prefix_check()`.
3. `apps/<name>/vendor/tokens.css` gives the look — do not invent new colours;
   add app-local tokens only where the app has a language of its own (as `vi` does
   with its comic page).
4. `npx wrangler pages project create vpl-<name> --production-branch main`
   (wrangler does **not** create the project on deploy; it only deploys into an
   existing one — `vr` hit this), then `./deploy <name>`. The custom domain is one
   API call, then the CNAME is a dashboard step, because the login token may write
   Pages but not DNS.
5. Add the origin to `ORIGINS` in `apps/api/functions/chat.js` and `search.js`.
6. Update `README.md`: the app list, its tables, its tests. If it has a language
   of its own, give it `docs/<name>.md` like `docs/vi.md`.

## What is deliberately missing

- No scores, no kanban, no deadlines, no charts, no drag-and-drop between stages.
- No per-stage sharing in `vi`: a funnel is shared whole, `view` or `edit`, and
  only the owner decides.
- No actors table in `vr`: a non-functional row carries its metric, target and
  conditions, and the actor is a word in the text.
- No links from a `vr` row to a test case yet (`verification` is a sentence).
- No central settings app: the shared file is `packages/shell/ai.js`, the keys are
  per browser per address.
