# vz — zed

The suite's last app, named for the last letter. **Zed is a dictionary**: a
project is a box of keys, a key is a name, and a value is whatever fits in
text — a password for a dev box, a setting, a glossary entry, a JSON blob, a
phone number, a joke. At https://vz.terg.hr.

The one promise: *find the value by its name.* Everything else in the app is
built around that sentence and nothing else is built at all.

## A row

- **key** — a name, monospace, shown as written. It ignores case: `DB_HOST`
  and `db_host` are the same lookup, so a second one replaces the first
  instead of standing beside it.
- **value** — plain text, any length, any shape. It is never rendered: no
  markdown, no links, no formatting. What you typed is what you see, in the
  same monospace, wrapped only because the screen ends.

A project holds up to a few hundred keys and shows them **twenty to a page**,
in alphabetical order, with one search box over both the key and the value.
There is no tree and no ordering by hand: a dictionary is looked up, not
arranged.

## Values stay folded

A project has one switch, **values hidden** (on by default): every value is a
row of dots until you click its key, and then one value opens in place,
wrapped, with the rest still folded. For a glossary or a list of jokes that
switch only gets in the way, so the toolbar has **show values** — the same
switch, from the sheet, written to the project so the next visit remembers.

This is a **curtain, not a lock**, and the screen says so. The value is plain
text in `vz_pairs`; anyone holding a link reads it, and a published project
serves it to the whole internet. The app never pretends otherwise.

## Adding

Typing: a key box and a value box at the bottom. `Enter` in the key jumps to
the value, `Enter` in the value saves and returns to the key. A name that
already exists is **replaced**, not duplicated.

Pasting, which is the way a dictionary actually gets filled:

- `key=value` lines (a `.env`, with or without `export`, quotes stripped)
- two columns with a tab between them (from a spreadsheet)
- a JSON object, whole or one object per line — nested values are written
  back out as indented JSON

## The recycle bin

Deleting a key marks it (`deleted_at`) so its name is free to be used again.
The bin is one click from the rail, shows the key and the day it left, and
offers **restore** or **delete for good**. Emptying the bin is the owner's, one
deliberate click with a count in the sentence.

## Sharing

The same two doors as `vr` and `vi`:

- **a link** — `?s=<code>`, read-only, no account needed, revocable.
- **one person** — by address, `view` or `edit`. An editor may add keys and
  values and move them to the bin; the project's name, its hiding, its
  publishing and emptying the bin stay with the owner, and the database
  refuses them (`vz_decisions_are_the_owners`, `23514`).

And the suite's two transfer buttons: **copy** (the whole dictionary as
markdown, `**key** — value`, long values in a fenced block) and **copy to
mine** (same keys and values under the reader's own account, fresh ids, private
and unpublished, the original untouched). Copying needs an account — a
dictionary is made of secrets often enough that an anonymous clone is not
offered.

## Published as a service

A project can be **published**, which is a second switch with a different
promise: it answers on the open internet, read-only, with no account.

- `GET /p/<code>` → the whole map as JSON, `{"db.host": "db2.dev.local", …}`
- `GET /p/<code>/<key>` → one value as `text/plain`, `404` when there is no
  such key, case ignored like everywhere else.

`Access-Control-Allow-Origin: *` on purpose: this is the one place in the suite
meant to be called from another page. No POST, no listing of projects, no way
to tell "no such code" from "not published" — both are `404`.

The service is a Supabase RPC (`vz_read_public`) reachable by `anon` plus two
tiny Cloudflare Pages Functions in `apps/vz/functions/p/`. Zero servers, and the
anon key in them is the same public key every browser already gets.

**Publishing includes every value, hidden or not.** The checkbox asks once,
with that sentence in the dialog, because the alternative — a project that
serves half a configuration — would be a worse lie than a public password.

## Where the data lives

- `vz_projects` — title, note, `hide_values`, `published`, `publish_code`
- `vz_pairs` — `project_id`, `key`, `value`, `deleted_at`; unique on
  `(project_id, lower(key))` where the row is alive
- `vz_shares` — code or address, `view` or `edit`

Migration: `20261128000000_vz_core.sql`. RLS everywhere; `vz_share_role` and
`vz_read_share` are the same shape as `vr`'s, and the prefix guard knows `vz_`.

## On a phone

Keys and values stack: the key on its line, the value under it, tools at the
right of the key's line. The rail is a drawer behind `☰`. The sheet does not
scroll sideways — the test asserts it.

## Tests

`vz-check.mjs` — **59 checks**, in `apps/vn/test` with the rest:

```bash
PORT=8103 ./serve vz &
cd apps/vn/test && node vz-check.mjs                  # local
VZ_URL=https://vz.terg.hr node vz-check.mjs           # production
```

It plays one person with a project (add, replace, edit, search, paginate, bin,
restore, paste, copy), a guest with a link (read, then copy to mine), a guest
with a grant (write), the published service (map, one key, case, 404, CORS) and
a phone. It deletes every project it made, including the copy.
