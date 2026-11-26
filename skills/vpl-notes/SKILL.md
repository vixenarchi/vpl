---
name: vpl-notes
description: Create, read and share a note in the vpl apps (vn.terg.hr) through the Supabase REST API as a real signed-in account, with no browser. Use when asked to write a note or put content in one, to read what a note currently says (last letter, latest edit), or to share a note with somebody's email address in vpl / vn.
metadata:
  version: "1"
---

# vpl notes

A note in vpl is one row in `vn_notes`; a share is one row in `vn_shares`. There
is no vpl service, no API key of ours and no queue: every call is a PostgREST
call to Supabase, run as one person's token, so row-level security decides what
you may do — exactly as it would in the browser.

The whole job is six commands. They are tested on Windows (Git Bash) and Linux.

```bash
S="<this skill dir>/scripts/vpl-notes.mjs"
node "$S" who                                   # who am I, how many notes
node "$S" list                                  # your notes, and the ones shared with you
node "$S" login  you@example.com 'password'      # or: signup <email> <password>
node "$S" note   'Particle-1' body.md            # prints the new note id
node "$S" share  <note_id> someone@example.com edit
node "$S" show   <note_id>                       # the body and its last letter
```

`body.md` is markdown — `|` tables, `***` rules, `Done` at the bottom are all
just lines in that file. Write the file first, then pass its path.

## When a person hands you a note

The other direction needs no new verb. The person shares their note **with your
account's address** in the app (⇗ share, address, `view` or `edit`), and then:

```bash
node "$S" list          # a row marked SHARED is not yours; that is a handover
node "$S" show <id>
```

A note shared with you is read through the same table — the select policy lets a
guest read the row, so `user_id` in the row is how `list` tells `mine` from
`SHARED`. Measured: the row appears in `list` and reads in full, and a guest's
note never appears as `mine`.

## Two ways in

- **Sign up.** `signup <email> <password>` with a password of 6 or more
  characters. Email confirmation is off on this project, so the reply already
  carries a session — that is the fast path when no account exists.
- **Sign in.** `login <email> <password>` — the same password grant the app
  makes. The token lives one hour and is refreshed from the cache.

The cache is `~/.config/vpl/api-token.json` (mode 600), the same file
`tools/vpl-api.mjs` uses, so the two tools share one session.

## Where the database is

`$VPL_SUPABASE_URL` + `$VPL_SUPABASE_ANON` if set; otherwise
`apps/vn/config.local.js` in a full clone; otherwise the deployed copy at
`https://vn.terg.hr/config.local.js`. The anon key is public by design — RLS is
the lock, not the key. **Never ask for a service key**: it skips every rule here.

## The five traps, with the error each one gives

| trap | what happens | what to do |
|---|---|---|
| insert into `vn_notes` without `user_id` | `403 42501 new row violates row-level security policy for table "vn_notes"` | send `user_id`; the script fills it from the cache |
| insert into `vn_shares` with `user_id` | `400 PGRST204 Could not find the 'user_id' column of 'vn_shares' in the schema cache` — the column is `owner_id`, written by the database | insert without it (the script does) |
| `tools/vpl-api.mjs post vn_shares …` | the same `PGRST204`: that tool adds `user_id` to every row | use this skill's `share` verb |
| sharing with an address that has no account | the grant is stored `pending` and grants **nothing** | check `rpc vn_account_exists {"who":"email"}`; the script reports which case happened |
| sharing with `role` outside the closed list | `23514 violates check constraint` | `role` is `view` or `edit` only |
| patching rows with no filter | writes **every** row you own | always `id=eq.<uuid>` |

## What "done" means

Say what you actually checked, and how:

1. `show <note_id>` printed the body you wrote — so the row exists and reads back.
2. `share` printed `role edit` (or `view`) with no `pending`, and the address is
   the one that was asked for.
3. If someone edited the note, `show` reports a newer `updated_at` — you read the
   same row the app reads, not a copy.

Do not claim the note looks right in the browser: you did not open one. Say that
plainly, and give the person the account and address they can use to look.

## What not to do

- Do not delete a note. Binning is `deleted_at` (`patch vn_notes id=eq.<id>`
  with a timestamp); destroying is a person's decision, not an agent's.
- Do not publish (`is_public`, a public link code) or share further on your own
  initiative: a share is the owner's decision about who may read their words.
- Do not use the `service_role` key, and do not send anyone else's token.
- Do not assume an empty list means "nothing exists": a slightly wrong filter
  also returns zero rows and no error.

## Where the longer reference is

- **`docs/api.md`** — every table, column, closed list, the bin, uploads, the
  doors and the refusals.
- **`./tools/map.sh`** — the generated map: tables per app, ports, functions, the
  suites, and the skills.
- **`tools/vpl-api.mjs`** — the general-purpose version of this script (`get`,
  `post`, `patch`, `delete`, `rpc`), sharing the same token cache.

## Installing it in an agent

The two skills live in `skills/` in this repository and are plain folders: an
agent that reads `skills/*/SKILL.md` can use them as they are. For an agent that
looks in a skills directory, symlink rather than copy, so a fix here is a fix
there:

```bash
ln -s "$PWD/skills/vpl-notes" ~/.agents/skills/vpl-notes
ln -s "$PWD/skills/vpl-apps"  ~/.agents/skills/vpl-apps
```
