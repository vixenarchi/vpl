# vpl — vixen productivity light

Notes with chapters, a bin, sharing without accounts, and an assistant.
One table in one database, one deploy target, no servers, no monthly bill.

Live at **https://vn.terg.hr**

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

## Running it

```bash
cp config.example.js config.local.js   # fill in your Supabase url + anon key
./serve                                # http://localhost:8099, also prints the LAN address
./serve stop
```

`serve` runs `serve.py`, which sends `Cache-Control: no-store`. Without it a
browser silently keeps yesterday's `app.js` and the app looks broken.

The app is plain files: `index.html`, `app.js`, `style.css`, `lib/*.js`. Nothing
is compiled, so what is in the folder is what the browser runs. Two libraries
come from a CDN (supabase-js, DOMPurify).

## The database

Two tables, in `supabase/migrations/`, built from one baseline file with
numbered changes after it.

**notes** — `id, user_id, title, body, tags, parent_id, position, is_public,
deleted_at, created_at, updated_at`. The tree is `parent_id` + `position`.

**note_shares** — `id, note_id, owner_id, code, email, role, pending,
created_at`. One row is either a public link (a code, no email) or a grant to
one address (an email, role `view` or `edit`). This is the second table, and the
only one justified: a permission is not a property of a note, it is a relation
between a note and a person.

What the database enforces, so a client bug cannot:

- **row level security** decides what any query may return;
- **`share_role(note, email)`** walks up to 64 ancestors and answers `view`,
  `edit` or nothing — a personal grant beats a public link, edit beats view;
- **a code is a capability, not a grant**: reading a link goes through
  `read_share(code)`, so a shared note never appears in anyone else's list;
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
./deploy --dry-run     # what would go out
./deploy               # stage + upload to Cloudflare Pages
```

`deploy` stages only the files a browser needs, checks that `wrangler` is
really signed in (it exits 0 when it is not, so the script reads its output),
and refuses to publish a `service_role` key. A code change ships with
`./deploy`; a database change ships as a new migration. Nothing else ships.

The custom domain is a CNAME to `<project>.pages.dev`. In Supabase, Site URL and
the redirect urls must name the same host, or Google sign-in lands on localhost.

## The one function

`functions/api/chat.js` exists because almost every model API answers the
browser without `Access-Control-Allow-Origin`, and the browser then throws the
answer away — the same key that works in `curl` fails on a page. Requests go to
`/api/chat`, which calls the endpoint server to server and returns the answer
from our own origin. Only `https`, and only hosts on its allowlist. The key is
never stored or logged there.

`serve.py` speaks the same route locally, so development and production behave
alike.

## Keys

- the anon key in `config.local.js` is **public by design** — RLS is the lock
- your login is your password; settings can change it, and other devices sign out
- a model api key never leaves your browser

## Layout

```
index.html  app.js  style.css     the app
lib/                              markdown ⇄ html, the editor, the database
functions/api/chat.js             the CORS door to a model endpoint
supabase/migrations/              the schema, and every change since
serve  serve.py                   local server that refuses to cache
deploy  _headers                  publish, and production's cache rules
test/                             playwright suites: dnd, sharing, tree, e2e,
                                  plain, touch, mode
docs/specification.md             the 0-architecture this is built against
docs/build-notes.md               why v2 exists, and what it fixed
```

## Tests

```bash
cd test && npm install
node tree-check.mjs     # 12 checks
node dnd-check.mjs      # 24 checks
node share-check.mjs    # 22 checks
node e2e.mjs            # 25 checks
node plain.mjs          # 8  checks
node touch-check.mjs    # 9  checks  (needs touch emulation)
VPL_EMAIL=… VPL_PASS=… node mode-check.mjs   # 23 checks
```

The suites make their own throwaway accounts and delete them at the end. No
credentials live in this repository — `mode-check.mjs` reads them from the
environment.

## License

Apache-2.0, see `LICENSE`.
