# vpl — vixen productivity light

A suite of small, independent apps that share one look and one signed-in person.

- **vn** — notes with chapters, a bin, sharing by link or by person, an
  assistant. At https://vn.terg.hr
- **vi** — an idea funnel: context, ideate, explore, select one, simulate.
  At https://vi.terg.hr — see `docs/vi.md`
- **vr** — requirements: a sheet of rows, one testable sentence each, marked
  must / optional / wish, with proof, a brief and a glossary.
  At https://vr.terg.hr — see `docs/vr.md`
- **api** — the suite's one CORS door to a model endpoint, at
  https://api.terg.hr

Each app is its own folder, its own Cloudflare Pages project, its own domain,
and its own tables (`vn_notes`, `vi_ideas`, …). What they share is a palette
(`packages/shell`), one database, one login. Nothing else.

No servers, no bundler, no build step, no monthly bill.

## What it is

- **A tree, not a list.** A note can hold notes; drag one onto another to nest
  it, drag to an edge to reorder, drop on empty space for the top level.
- **Write and read in the same place.** Markdown is stored, a contenteditable
  surface is the editor, and the view pane renders that same markdown through
  DOMPurify. `Ctrl+1` writes, `Ctrl+2` reads, and reading is a place you stay in.
- **Sharing is a chapter, not a note.** Share a note and the whole subtree
  travels with it: read-only by link (no account), or editable by one named
  person, per email. Revoke and the subtree closes.
- **A bin you can empty.** Deleting is one click and undoable; emptying it is
  a second, deliberate click with a sentence about what happens underneath.
- **An assistant in the top bar.** It answers into the note. The key is yours,
  kept in your browser, and settings can test it before you save it.

## What it deliberately does not do

No teams, no roles beyond view and edit, no realtime collaboration, no
attachments, no search index, no framework, no bundler, no build step, no
service worker, no monthly bill.

## Moving things between apps

No app writes into another app's tables. The transfer path is the person's
clipboard, and every app has the same two buttons:

- **copy** — writes what is on screen as markdown (the note and its chapters, a
  funnel with its stages and reasons, a requirements sheet with its rows), ready
  to paste into any of the others or into an e-mail.
- **copy to mine** — the same content, inserted under the reader's own id with
  fresh row ids, so a document somebody shared becomes a document they own and
  may disagree with. The original is not touched, and the copy is not a grant:
  names, priorities and order belong to whoever holds the copy.

`copy to mine` only appears for someone who is signed in and is not the owner;
`copy` appears for everyone who can read. `vr` writes its own document;
`vn` copies a note and every chapter under it; `vi` copies a funnel with the
chosen idea first.

## From nothing to running

You need: this repo, **Python 3** (the local server), and a browser. Node 18+
only for the test suites and for publishing; the apps themselves need nothing.

```bash
git clone https://github.com/vixenarchi/vpl && cd vpl
cd apps/vn
cp config.example.js config.local.js    # two values: the project url and its anon key
cd ../..
./serve                                 # http://localhost:8099 (also prints the LAN address)
./serve vi                              # another app, same project
./serve stop
```

Getting the two values: create a free project at supabase.com → *Settings →
API* → **Project URL** and the **anon / public** key. The anon key is public by
design; RLS is the lock, not the key. Never put the `service_role` key in
`config.local.js` — `./deploy` refuses to publish if it finds one.

### Building the database

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push --remote
```

`supabase/migrations/` builds everything from empty: the tables, the policies,
the grants, the prefix guard. `20261120000000_vpl_schema.sql` is the whole
schema as one file; every file after it is one change, applied in order.

In the dashboard, leave **Confirm email off** while you are trying things out:
an account made with a bare name (`miki` → `miki@vpl.local`) has no mailbox to
confirm from. Set **Site URL** to your `vn` host and add `https://<app-host>/**`
to **Redirect URLs**, or Google sign-in lands on localhost.

`serve` runs `serve.py`, which sends `Cache-Control: no-store`. Without it a
browser silently keeps yesterday's `app.js` and the app looks broken.

An app is plain files: `index.html`, `app.js`, `style.css`, `lib/*.js`. Nothing
is compiled, so what is in the folder is what the browser runs. Two libraries
come from a CDN (supabase-js, DOMPurify). `./serve` and `./deploy` both run
`tools/stage.sh`, which copies `packages/shell` into `apps/<name>/vendor/` — an
app ships with its own copy of the shared look, never with a link back into the
repo.

`packages/shell/ai.js` is the second shared file, and the answer to "why do vn
and vi offer different models?". It holds the provider list (url, a few models,
one line about each), the endpoint rule (`…/openai` gets `/chat/completions`,
everything else `/v1/…`), and nothing else. Both apps import their own staged
copy, so they cannot drift, and either still works alone.

Keys are **per address**, deliberately: `vn.terg.hr` and `vi.terg.hr` are two
origins, so one paste does not cover both and no cookie carries a key to a server
that has no business seeing it. A shared settings app would need an iframe or an
account table to get around that, and both cost more than pasting twice.

## The database

One Supabase project for the suite, one `auth.users`, and a **prefix per app**:
everything an app owns starts with its name. `vn_` for notes, `vi_` for ideas,
`va_`/`vg_` when they exist. Renaming a table is cheap now and expensive later,
so the rule is stated once and checked.

**vn_notes** — `id, user_id, title, body, tags, parent_id, position, is_public,
deleted_at, created_at, updated_at`. The tree is `parent_id` + `position`.

**vn_shares** — `id, note_id, owner_id, code, email, role, pending,
created_at`. One row is either a public link (a code, no email) or a grant to
one address (an email, role `view` or `edit`). This is the second table, and the
only one justified: a permission is not a property of a note, it is a relation
between a note and a person.

**vi_projects** and **vi_ideas** — a funnel and its sticky notes.
**vi_shares** — a link or a person, `view` or `edit`; the database refuses a
decision by anyone but the owner (`vi_decisions_are_the_owners`). The project
carries the stage documents (`context`, `exploration`, `simulation`); an idea
carries `text`, `stage` (ideation, parked, selected), `reason` and its own
exploration. One chosen idea per project is a partial unique index, so the rule
"exactly one" is kept by the database and not by the screen. No join to notes:
the design is in `docs/vi.md`.

### The prefix rule, and its guard

`vpl_prefix_check()` lists any table, function or trigger in `public` that does
not start with `vn_`, `vi_`, `va_`, `vg_` or `vpl_`. Names only, signed-in
callers only. Since each app shares one project, this is what keeps app A from
quietly writing into app B's namespace.

What the database enforces, so a client bug cannot:

- **row level security** decides what any query may return;
- **`vn_share_role(note, email)`** walks up to 64 ancestors and answers `view`,
  `edit` or nothing — a personal grant beats a public link, edit beats view;
- **a code is a capability, not a grant**: reading a link goes through
  `vn_read_share(code)`, so a shared note never appears in anyone else's list;
- **triggers** cover what RLS cannot see (only the owner may bin or restore);
- **delete** is granted only where `deleted_at` is not null — a live note
  cannot be dropped in one step, and children move up rather than cascade.

Pushing migrations:

```bash
npx supabase link --project-ref <ref>
npx supabase db push --remote
```

`supabase/migrations/20261120000000_vpl_schema.sql` is the whole schema in one
file — the migrations the live project applied, with their history folded in.
New changes go beside it as new files; that one is never edited again.

## Publishing a change

```bash
./deploy vn --dry-run   # what would go out
./deploy vn             # stage apps/vn + the shell, upload to Cloudflare Pages
./deploy vi             # the same for the other app
./deploy vr             # requirements
./deploy api            # the proxy
```

One Pages project per app (`vpl`, `vpl-vi`, `vpl-vr`, `vpl-api`), one custom domain per
project. Deploying one app never touches another; the free plan's 500 builds a
month is shared, so `./deploy vn` only ships `vn`.

`deploy` stages only the files a browser needs, checks that `wrangler` is
really signed in (it exits 0 when it is not, so the script reads its output),
and refuses to publish a `service_role` key. A code change ships with
`./deploy`; a database change ships as a new migration. Nothing else ships.

One Pages project per app, named in `deploy` (`vpl` for vn, `vpl-vi`, `vpl-vr`, `vpl-api`);
override with `PROJECT=… ./deploy vn`. The custom domain is a CNAME to
`<project>.pages.dev`, added once in the Cloudflare dashboard and once as the
project's custom domain. In Supabase, Site URL and the redirect urls must name
the same hosts, or Google sign-in lands on localhost.

## Talking to a model without CORS

Almost every model API answers the browser without `Access-Control-Allow-Origin`,
and the browser then throws the answer away — the same key that works in `curl`
fails on a page. So the call leaves from an origin of ours:

- **`apps/api/functions/chat.js`** — the suite's shared proxy at
  `https://api.terg.hr/chat`. One allowlist of hosts, one allowlist of origins
  (`vn.terg.hr`, `vi.terg.hr`, `vr.terg.hr`, … and local development). The key travels in the
  body, is used once, and is never stored or logged.
- **`apps/api/functions/search.js`** — `https://api.terg.hr/search`, the same
  idea for evidence. The caller names a provider (`tavily` or `serper`), not a
  URL, so the destination is fixed and there is no host list to drift.
- **`apps/vn/functions/api/chat.js`** — the same door on the app's own origin,
  which is what a local `./serve` and a single-app deployment use.

`app.js` tries its own origin first and falls back to the shared proxy, so an
app with no function of its own still works. `serve.py` speaks the same route
locally, so development and production behave alike.

To support another provider, add its host to `ALLOWED` in
`apps/api/functions/chat.js` (and to `serve.py` for local work), then
`./deploy api`.

## Keys

- the anon key in `config.local.js` is **public by design** — RLS is the lock
- your login is your password; settings can change it, and other devices sign out
- a model api key never leaves your browser

## Layout

```
apps/vn/                  notes: index.html, app.js, style.css, lib/, test/
apps/vi/                  ideas: the same shape, much smaller
apps/vr/                  requirements: a sheet, its brief, its glossary
apps/api/                 the shared proxy (one function, one page)
packages/shell/tokens.css palette, type scale, page foundation — copied into
                          each app's vendor/ by tools/stage.sh
packages/shell/ai.js      providers, models and the endpoint rule, shared by every
                          app that talks to a model — same copying, same idea
tools/stage.sh            "copy the shared look into this app"
deploy                    publish one app: ./deploy vn | vi | vr | api
serve  serve.py           local server that refuses to cache
supabase/migrations/      the schema, and every change since
docs/start-here.md        a cold start: what this is, where it is written down,
                          what to run, and what not to break
docs/specification.md     the 0-architecture this is built against
docs/build-notes.md       why v2 exists, and what it fixed
```

### Adding an app

1. `mkdir apps/xx`, copy `apps/vi` as the smallest starting point.
2. Give it its own `config.local.js` (same project url + anon key).
3. Every table, function and trigger it owns starts with `xx_`.
4. `./serve xx`, then `npx wrangler pages project create vpl-xx`, then
   `./deploy xx`, then add the custom domain.
5. Add `https://xx.terg.hr` to the origin list in `apps/api/functions/chat.js`
   and to Supabase's redirect urls; add its table to `vpl_delete_my_account()`.
6. `VPL_EMAIL=… VPL_PASS=… node tools/prefix-check.mjs` — it should print
   `clean`. It asks the database, through `vpl_prefix_check()`, for any table,
   function or trigger that has no app prefix.

## Tests

```bash
cd apps/vn/test && npm install
node tree-check.mjs     # 12 checks
node dnd-check.mjs      # 24 checks
node share-check.mjs    # 22 checks
node e2e.mjs            # 25 checks
node plain.mjs          # 8  checks
node touch-check.mjs    # 9  checks  (needs touch emulation)
VPL_EMAIL=… VPL_PASS=… node mode-check.mjs   # 23 checks
node take-check.mjs     # 12 checks  (copy markdown, copy to my notes)

PORT=8100 ./serve vi in another shell, then:
VI_URL=http://127.0.0.1:8100 node vi-check.mjs   # 20 checks
VPL_SEARCH_KEY=… node vi-ai.mjs                  # 14 checks (model mocked, search live)
VI_URL=http://127.0.0.1:8100 node vi-share.mjs    # 12 checks (link, guest, revoke)
VI_URL=http://127.0.0.1:8100 node vi-take.mjs     # 16 checks (copy, copy to mine)
VPL_MODEL_URL=… VPL_MODEL_KEY=… VPL_MODEL=… node vi-real.mjs "a project"
                                                 # one real pass through the funnel

PORT=8101 ./serve vr in another shell, then:
VR_URL=http://127.0.0.1:8101 node vr-check.mjs     # 49 checks (tree, sort, gaps, print, phone)
VR_URL=http://127.0.0.1:8101 node vr-paste.mjs     # 11 checks (a spreadsheet, commas, names)
VR_URL=http://127.0.0.1:8101 node vr-ai.mjs        # 21 checks (model faked at the proxy)
VR_URL=http://127.0.0.1:8101 node vr-share.mjs     # 25 checks (link, editor, the database's refusal)
```

or all four at once, server and all: `tools/test-vr.sh`
(`VR_URL=https://vpl-vr.pages.dev tools/test-vr.sh` against production).

`vr-share.mjs` needs a second account (`vpl-guest@terg.hr`); it creates it if it
is missing. The database's refusal is asserted by the error code (`23514`), not
by the screen, because a rule that only lives in the screen is a wish.

`vi-real.mjs` is how the model notes in `vn` were written: it opens a project,
walks ideate → explore ×2 → select → simulate, and keeps every answer it got in
`/tmp/model-*.txt`.

The suites make their own throwaway accounts and delete them at the end. No
credentials live in this repository — `mode-check.mjs` reads them from the
environment.

## License

Apache-2.0, see `LICENSE`.
