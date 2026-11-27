# Cookbook — how to do the thing

Recipes, not essays. Each one is the whole job: the files, the commands, and the
proof. `AGENTS.md` has the rules; `docs/rules.md` has the reasons.

Everything assumes you are in the repository root:

```bash
cd /home/vergovic/vpl
```

---

## Run one app locally

```bash
PORT=8104 ./serve vd              # no-store headers; stage.sh runs for you
```

Ports are `vn 8102`, `vi 8100`, `vr 8101`, `vz 8103`, `vd 8104`, `vc 8105`,
`vp 8106`, `va 8107`. The app needs `apps/vd/config.local.js` (copy
`config.example.js`) with the Supabase URL and anon key. Without it the page
loads and the gate says so.

## Change the shared look and get it into all eight apps

```bash
$EDITOR packages/shell/tokens.css
for a in vn vi vr vz vd vc vp va; do ./tools/stage.sh "$a"; done
./tools/stage.sh --check                       # must print "carries the current shell"
```

`stage.sh --check` is the whole point: without it, eight apps keep a copy of the
old look and every suite judges the old look and passes.

## Add a table to an app

```bash
# 1. the migration — numbered, re-runnable, prefixed with the app
$EDITOR supabase/migrations/20261223000000_vd_sections.sql

# 2. the CLI root is a separate tree; it wants the file symlinked in
cd /home/vergovic/vixen/supabase
ln -sf /home/vergovic/vpl/supabase/migrations/20261223000000_vd_sections.sql \
       migrations/20261223000000_vd_sections.sql
npx supabase db push --remote --yes

# 3. the app reads it through its own lib/db.js — never through another app's
```

The symlink name must be exactly `<timestamp>_<name>.sql`. A policy written
`create policy … for insert … as restrictive` is a syntax error (`as restrictive`
comes *before* `for`) and only the push will tell you.

A migration for an existing app always:

- `create table if not exists public.vd_sections ( … )`
- `alter table public.vd_sections enable row level security;`
- four policies: owner all, share-view select, share-edit write — the same shape
  as the app's neighbours in `supabase/migrations/`
- `deleted_at timestamptz` if a person can lose a row (see *Add a bin*)

## Add a field to a table that already has rows

One migration, four statements, in this order: `add column … default … not null`
(a default rewrites nothing), backfill if needed, add the index, then let the app
read it. Never make a column `not null` without a default while rows exist.

## Add a tab to the settings dialog

`packages/shell/settings.js` renders the tabs. A tab is one entry in the
`set-tabs` row and one `case` in the panel painter — and the dialog must not
change height when the tab changes (`settings-check` measures this).

```js
// packages/shell/settings.js, in the tab row:
<button type="button" role="tab" data-tab="you">you</button>
// and in the painter: the `you` case writes the account line, then calls
// void paintAccount() on open — not on mount
```

Then `./tools/stage.sh <app>` × 8 and `./tools/test-settings.sh`.

## Add a bin to a new app

The bin is a shape, not a feature. Copy the shape from `apps/vc`:

1. A migration: `deleted_at timestamptz` on the rows that can be lost.
2. `apps/<app>/lib/db.js`: `binRow(id)`, `restoreRow(id)`, `purgeRow(id)`,
   `listBin(' <app>_artifacts?deleted_at=not.is.null')`.
3. `index.html`: a chip in the rail's head —
   `<button id="btn-bin" class="job-bin" hidden>♲ <span class="bin-word">inputs</span><span id="bin-count"></span></button>`
   and `<div id="bin-banner" class="bin-banner" hidden>` with a title, a
   `#bin-banner-note`, and `#btn-bin-empty` inside it.
4. `app.js`: `paintBin()` sets `hidden`/`.on`/`aria-pressed`/title, the count,
   the banner sentence with the app's noun, and hides *empty all* unless open.
5. The row's ✕ calls `binRow`, never `delete`.
6. `apps/vn/test/bin-check.mjs`: add the app to `SPECS` — the five shape
   assertions are already generic.

Proof: `APP=<app> PORT=<port> node apps/vn/test/bin-check.mjs` → 19/19.

## Do something as a person, without the browser

The API is the apps' own API: Supabase REST with the person's token, so
row-level security decides exactly as it does in the page. `docs/api.md` is the
reference; this is the shortest path through it.

```bash
node tools/vpl-api.mjs login you@example.com        # token cached for an hour
node tools/vpl-api.mjs me                           # who, and what each app holds

node tools/vpl-api.mjs get vr_reqs 'select=id,title&limit=5'
node tools/vpl-api.mjs post vn_notes '{"title":"a note","body":"text\n"}'
node tools/vpl-api.mjs patch vn_notes 'id=eq.<uuid>' '{"deleted_at":null}'   # out of the bin
node tools/vpl-api.mjs delete vn_notes 'id=eq.<uuid>'                        # for good
```

Three things that catch a first attempt:

- **`user_id` is in the body**, not a default — the tool fills it, raw HTTP must send it.
- **A patch or a delete without a filter is refused by the tool**, because it
  would write or take every row the person owns.
- **`403 permission denied … GRANT UPDATE`** on a `user_id` patch is the
  owner-field guard, not a missing grant. Copy the row instead.

Proof: `node apps/vn/test/api-check.mjs` → 18/18, no browser.

## Add a door to the proxy

```bash
$EDITOR apps/api/functions/<door>.js     # export default { async fetch(req) { … } }
$EDITOR apps/api/functions/_origins.js   # nothing else changes: one origin list
./deploy api
```

Every door has a local twin in `serve.py` (that is how a suite runs offline). A
door that fetches somebody else's page is allowed only inside the allow-list in
`fetch.js`, https only, host re-checked after redirects, 3 MB, 15 s.

## Add a ninth app from an existing one

The house way: **one engine, many skins**, and the engine is a *copy*.

```bash
cp -r apps/vd apps/vx                     # the closest neighbour, not the newest
rm -rf apps/vx/vendor                     # a copy of the shell, not a link
# rename in the copy: index.html <title>, app.js imports, style.css accents,
# lib/db.js table prefix vd_ → vx_, config.local.js
./tools/stage.sh vx
```

Then: a migration set for `vx_*` (start from the neighbour's and change the
prefix — never write it by hand twice), a Pages project, DNS, a `SPECS` entry in
`bin-check` if it can lose rows, and a document `docs/vx.md` that says what it is
and what it deliberately is not. The engine must not learn the app's name: if you
find yourself adding `if (app === 'vx')`, the shape is wrong.

## Add a suite to the gate

```bash
$EDITOR apps/vn/test/vx-check.mjs         # suite lives with the others, on purpose
$EDITOR tools/test-all.sh                 # one line, inside the account block
```

The suite takes `VX_URL` (or `PORT`), prints `N passed, M failed`, and exits
non-zero on failure. **A group that is not in the list is green by absence** — the
gate is only as honest as its list.

## Deploy

```bash
./deploy vd                    # one app: Cloudflare Pages, nothing to build
./deploy api                   # the proxy and its doors
curl -s -o /dev/null -w '%{http_code}\n' https://vd.terg.hr/
```

A CNAME alone gives 522 until the hostname is attached in the dashboard; per-app
sign-in addresses go in Supabase → Authentication → Redirect URLs, while Site URL
holds exactly one value.

## Back up

```bash
./tools/backup.sh              # ~/backups/vpl-YYYY-MM-DD-HHMM.{bundle,tar.gz}
```

Backups contain the repository, never `config.local.js`, `agent.env`,
`test.env`, or a model key.

## When you are stuck

1. `./tools/map.sh` — the generated map of tables, ports and suites.
2. `./tools/stage.sh --check` — the most common silent break.
3. `docs/rules.md` — find the rule you are breaking, then run its proof.
4. `docs/build-notes.md` — grep for the symptom; the argument is in there.

## "Did the e-mail arrive?"

```
node tools/mail.mjs list 5            # the newest five, subject + sender
node tools/mail.mjs find confirm      # anything whose subject or sender mentions it
node tools/mail.mjs body 383          # one message, plain text (a link is in there)
node tools/mail.mjs send a@b.hr "subject" "body…"
```

It needs `MAIL_ACCOUNT` and `MAIL_APP_PASS` (an **app password**, not the account
password — Google refuses the account password for IMAP once 2FA is on, and says
`Application-specific password required`). Without them it looks for the pairs
`mail.account` / `mail.app` in the vz dictionary.
