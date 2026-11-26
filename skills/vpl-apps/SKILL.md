---
name: vpl-apps
description: Write and share a project in the vpl apps that are not notes — vi funnels, vr requirements, vz dictionaries, vd documents, vc compliance, va architecture — through the Supabase REST API as a real signed-in account. Use when asked to add requirements, ideas, dictionary keys, document inputs or compliance controls to vpl, or to share a project with somebody's email address.
metadata:
  version: "1"
---

# vpl apps (everything but notes)

One project is one row in `<app>_projects`; its content is rows that carry
`project_id`; a share is one row in `<app>_shares`. Every call is PostgREST on
the project the apps use, as one person's token — row-level security is the lock,
and a service key is never needed or allowed.

This skill covers **vi, vr, vz, vd, vc, va** (projects and rows) and **vp**
(keys and codes — *read only*: no projects, no shares, and a code spends the
issuer's money). Notes live in the `vpl-notes` skill.

```bash
S="<this skill dir>/scripts/vpl-app.mjs"
node "$S" who                                    # who am I; live/binned per app
node "$S" project vr 'the dog house'             # prints the project id
node "$S" post vr_reqs '{"project_id":"<id>","kind":"functional","strength":"must","status":"draft","statement":"The floor shall be raised 5 cm.","pos":1}'
node "$S" share vr <id> someone@example.com edit
node "$S" get vr_reqs 'project_id=eq.<id>&select=pos,statement,status&order=pos.asc'
node "$S" bin vr <id>                            # undoable
node "$S" vp                                    # keys / codes / charges — counts and labels only
```

Not signed in? `node <this skill dir>/../vpl-notes/scripts/vpl-notes.mjs signup <email> <password>`
(6+ characters; email confirmation is off on this project), then come back.

## The one trap

| table | insert body |
|---|---|
| `vn_shares` (notes) | `{ note_id, email, role, pending }` — **no** `owner_id` |
| every other `*_shares` | `{ project_id, owner_id, email, role, pending }` — **`owner_id` required** |

- Omitting `owner_id` on a project share → `403 42501 new row violates row-level security policy for table "vr_shares"`.
- Sending `owner_id` to `vn_shares` → `400 PGRST204 Could not find the 'user_id' column of 'vn_shares'…` (the app and `tools/vpl-api.mjs` add `user_id`; shares name `owner_id`).

`owner_id` is your own `user_id`; the script fills it from the token cache.

**Sharing is the owner's alone** (since the 2026-11-26 findings, `docs/security.md`).
`share` therefore works for the person who owns the project and answers `403
insufficient_privilege` for anybody the project was merely shared with — that
refusal is the fix, not a broken command. If a guest asks you to pass a document
on, tell them the owner has to do it.

## Rows per app, verified against the live project

| app | rows | a row that is known to insert |
|---|---|---|
| `vi` | `vi_ideas` | `{ text }` |
| `vr` | `vr_reqs`, `vr_themes` | `{ statement, kind, strength, status, pos }` |
| `vz` | `vz_pairs` | `{ key, value }` — the key ignores case |
| `vd` | `vd_artifacts`, `vd_outputs` | `{ title, kind: 'note' }` |
| `vc` | `vc_targets`, `vc_artifacts`, `vc_outputs` | `{ name, status: 'queued', pos }` |
| `va` | `va_jobs`, `va_artifacts`, `va_outputs` | `{ template, task, status: 'queued' }` |

Projects take `{ title }`, plus `template` for `vd`/`vc`/`va`. `user_id` and
`project_id` are added by the script when they are missing.

Closed lists (anything else is `23514 violates check constraint`) and every
column are in `docs/api.md` in this repository; `./tools/map.sh` lists the tables
per app. The short list: `vr_reqs.kind`
functional / nonfunctional / constraint / rule; `strength` must / optional / wish;
`status` draft / agreed / built / verified / dropped; `vi_ideas.stage` ideation /
parked / selected / simulated; `*_shares.role` view / edit.

## What "done" means

1. `get` the rows back with `order=pos.asc` and show what you wrote — the same rows
   the app reads, not a summary of your intent.
2. `share` printed the role and the address that was asked for.
3. Say what you did not check: you have no browser, so you did not see the page.
   Give the person the app's address and the account to open it with.

## What a guest may and may not do

Measured, and now enforced by the database (`20261224000000` in
`supabase/migrations/`):

- an **editor** writes words: rows, text, an answer. It may **bin** a row it
  wrote; it may not bin the owner's project or destroy anything for good.
- an **editor** may run a check in `vc` (the counts follow the run) and may not
  write a verdict by hand.
- the **owner** decides what is in the document, where it sits, whether it goes,
  who else sees it, and whether an agent runs a job — `va_jobs` is owner-only.
- nobody but the owner mints or raises a share, and `owner_id` cannot be named
  by the caller.

## Never, in these apps

- **Do not mint, redeem or spend in `vp`** (`vp_make_codes`, `vp_redeem`,
  `vp_spend`): a code spends the issuer's money. `vp` has no projects and no
  shares, and an agent only reads it.
- **Do not publish** (`published`, `publish_code`) or share further: those are the
  owner's decisions.
- **Do not write across apps** — a requirement is promoted to a document by a
  person with a clipboard, not by an update.
- **Do not delete**: `deleted_at` is the bin (undoable); destroying is a person's
  decision. Never patch without a filter: it writes every row you own.
