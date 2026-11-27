# The API — what an agent uses instead of the buttons

An agent should not have to open a browser and click. It should log in as the
person it works for, and then read and write the same rows the apps read and
write. That is what this document describes.

There is **no vpl service**. There is no second database, no API key of our own,
no queue to join. The apps are static files that talk to Supabase directly, so
the API surface is already public, already documented by PostgREST, and already
guarded by row-level security. An agent uses exactly that.

Three consequences, and they are the whole design:

- **The token is a person.** Every call runs as that account. Row-level security
  decides what the row allows, so an agent can do what that person may do in the
  browser — no more, no less.
- **There is nothing to deploy.** The address is the database's, the limits are
  Supabase's free tier's, and the cost is zero.
- **The service key is never used.** It bypasses row-level security, which means
  it cannot be the thing an agent holds. If a job seems to need it, the job is
  wrong.

---

## 1. Sign in

A password grant, the same call the apps make. The address and the public anon
key are in every app's `config.local.js`.

```bash
curl -s -X POST "https://<ref>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon>" -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"…"}'
```

- **`access_token`** — a JWT, valid for one hour. Send it as `authorization: Bearer`.
- **`refresh_token`** — exchange it at `…/token?grant_type=refresh_token` for a new pair. Refreshing does not need the password.
- **`sub`** inside the JWT is the person's `user_id`. Rows carry it; the insert policies check it.

With the tool in this repo, the token is cached and refreshed for you:

```bash
node tools/vpl-api.mjs login you@example.com          # password from $VPL_PASS, or asked for
node tools/vpl-api.mjs me                             # who you are, and what each app holds
```

`me` prints the person, the minutes left on the token, and a live/binned count
per app, so an agent can check its own work without a browser:

```
who      vpl-agent@terg.hr  (1e3d4e8c-…)
token    60 min left
  vn  vn_notes        5 live, 0 binned
  vi  vi_projects   128 live, 0 binned
  vr  vr_projects    50 live, 1 binned
```

The cache is `~/.config/vpl/api-token.json`, mode 600. Nothing else is stored.

---

## 2. The verbs

Every call is a PostgREST call against `https://<ref>.supabase.co/rest/v1/`.
The query syntax is the syntax the apps already use, so there is one thing to
learn rather than two.

```bash
# read
node tools/vpl-api.mjs get vr_reqs 'select=id,title,status&order=pos.asc&limit=5'

# create — returns the new row
node tools/vpl-api.mjs post vn_notes '{"title":"from an agent","body":"a line\n"}'

# change — a filter is required
node tools/vpl-api.mjs patch vn_notes 'id=eq.<uuid>' '{"title":"renamed"}'

# destroy — a filter is required
node tools/vpl-api.mjs delete vn_notes 'id=eq.<uuid>'

# a database function
node tools/vpl-api.mjs rpc vp_spend '{"p_amount":1,"p_reason":"one call"}'
```

Raw HTTP, if you would rather not use the tool:

```bash
curl -s "https://<ref>.supabase.co/rest/v1/vr_reqs?select=id,title&limit=3" \
  -H "apikey: <anon>" -H "authorization: Bearer $TOKEN"
```

- **`Prefer: return=representation`** makes a write return the rows it wrote. The tool always sends it.
- **`select=` is not optional in practice** — without it you get every column, including the bin markers and the file paths.
- **`order=`** decides what "first" means. The apps order by `pos` inside a document and by `updated_at` in a rail.
- **`limit=`** — nothing here pages for you. `?limit=20` and an `offset` is a page; the apps do 20.

---

## 3. The tables

Two shapes, in every app: **one container** (a project, a note, a dictionary),
and **the rows inside it**, tied by `project_id` (or `parent_id` for a note's
chapters). A row is never an orphan: the container is what a person deletes.

- **vn** — `vn_notes` (a note *is* the container; `parent_id` nests chapters)
- **vi** — `vi_projects` → `vi_ideas`
- **vr** — `vr_projects` → `vr_reqs`, `vr_themes`, `vr_vocab`, `vr_log`
- **vz** — `vz_projects` → `vz_pairs`
- **vd** — `vd_projects` → `vd_artifacts` (inputs), `vd_outputs` (the draft)
- **vc** — `vc_projects` → `vc_artifacts` (proofs), `vc_standards` (rules, kept in a library of their own), `vc_targets` (one control per row), `vc_outputs`
- **vp** — `vp_keys`, `vp_codes`, `vp_charges` (a ledger, metadata only)
- **va** — `va_projects` → `va_artifacts`, `va_outputs`, `va_jobs`
- **shared** — `vpl_ai` (the model settings: url, model, api_key), `*_shares`

Columns that matter to an agent, per app:

- **`vn_notes`** — `id, user_id, title, body, tags, parent_id, position, is_public, deleted_at, created_at, updated_at`. `body` is markdown.
- **`vr_reqs`** — `id, project_id, user_id, ref, kind, strength, theme, theme_id, title, statement, detail, asis, tobe, horizon, source, verification, metric, target, conditions, clause, status, pos, file_*, deleted_at, updated_*`. One requirement is one testable sentence.
- **`vr_themes`** — `id, project_id, parent_id, name, pos`. Two levels, enforced by a trigger: a theme, and a subtheme under it.
- **`vz_pairs`** — `id, project_id, key, value, deleted_at`. **The key is the identity and ignores case.**
- **`vc_standards`** — `id, user_id, title, kind, source_url, text, file_*, chars, deleted_at`. **`chars` is generated** — writing it fails with `428C9`.
- **`vc_targets`** — `id, project_id, name, status, n_pass, n_fail, n_unknown, error, pos, deleted_at`. The counts live on the row.
- **`va_jobs`** — `id, project_id, template, task, note, path, status, report, files, error, created_at, started_at, done_at`. A job is a directory; the agent over there claims it by writing `running`. **An editor writes text; a job runs code.**
- **`vpl_ai`** — one row per person: `user_id, url, model, api_key, updated_at`. The key is the person's own.

The exact current list is generated, not remembered: `./tools/map.sh`.

---

## 4. Closed lists

These are `check` constraints. A value outside the list is refused with `23514`
(`violates check constraint`), so an agent that invents a status is told at once.

- **`vi_ideas.stage`** — `ideation`, `parked`, `selected`, `simulated`
- **`vr_reqs.kind`** — `functional`, `nonfunctional`, `constraint`, `rule`
- **`vr_reqs.strength`** — `must`, `optional`, `wish`
- **`vr_reqs.status`** — `draft`, `agreed`, `built`, `verified`, `dropped`
- **`vc_standards.kind`** — `law`, `standard`, `policy`, `terms`, `job-ad`
- **`vc_artifacts.kind`** — `text`, `file`, `image`, `note`, `standard`, `evidence`
- **`vc_targets.status`** / **`va_jobs.status`** — `queued`, `running`, `done`, `failed`
- **`vd_outputs.kind`**, **`va_outputs.kind`** — `doc`, `report`, `code`
- **`*_runs.status`** — `running`, `done`, `failed`
- **`*_shares.role`** — `view`, `edit`

A `*_vocab` table (e.g. `vr_vocab`) holds the *words a document uses* — its own
axis, value, colour and position — so a document may rename "must" without
breaking the constraint.

---

## 5. Writing a row

Two things the browser never tells you, and a first insert gets wrong:

- **`user_id` is not a default.** The apps put it in the body (`user_id:
  s.user.id`), and the insert policy asks whether it is you. An insert without it
  is refused: `403 new row violates row-level security policy` / `42501`. The
  tool fills it from your token; raw HTTP must send it.
- **`id`, `created_at`, `updated_at` are defaults.** Do not send them.
- **`position` (`pos`)** is the order inside the container. Send it, or the new
  row lands wherever the default puts it. The apps send `pos = count + 1`.

A note, over raw HTTP:

```bash
curl -s -X POST "https://<ref>.supabase.co/rest/v1/vn_notes" \
  -H "apikey: <anon>" -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -H "prefer: return=representation" \
  -d '{"user_id":"<your id>","title":"a note","body":"text, in markdown\n"}'
```

---

## 6. Changing a row

**A patch without a filter writes every row you own.** The tool refuses to send
one; so should you.

Four fields are not fields. `vpl_owner_is_not_a_field` fires on any signed-in
update that touches `user_id`, `owner_id`, `project_id`, `note_id` or a share's
target: a row belongs to whoever made it, and moving a row between people or
between documents is a copy, not an edit. The refusal looks like a grant error
and is not one:

```
403 permission denied for table vn_notes [42501]
(hint: Grant the required privileges to the current role with: GRANT UPDATE …)
```

Do not run that grant. The answer is: copy the row with a new `user_id` /
`project_id` instead.

Deleting a container is the app's decision, not an agent's convenience: see the
next section.

---

## 7. Losing something — the bin

**Every app bins before it destroys**, and the bin is one nullable column:
`deleted_at`. So "deleted" has exactly one meaning across eight apps, and an
agent can undo its own mistake.

```bash
# put it in the bin (this is what ✕ does)
node tools/vpl-api.mjs patch vn_notes 'id=eq.<uuid>' "{\"deleted_at\":\"$(date -u +%FT%TZ)\"}"

# take it back out
node tools/vpl-api.mjs patch vn_notes 'id=eq.<uuid>' '{"deleted_at":null}'

# destroy it for good (this is what the bin's own ✕ does)
node tools/vpl-api.mjs delete vn_notes 'id=eq.<uuid>'
```

- **A live list is `deleted_at is null`.** Every app asks that; an agent that forgets will count binned rows as work.
- **A binned container keeps its rows.** Restoring brings them back because nothing was ever deleted.
- **A binned `vz` project stops answering at its public address** — `vz_read_public` asks for `deleted_at is null` as well as `published`.
- **A shared document never shows the bin**, and a guest cannot bin anything.

Deleting for good is a separate verb in every app, and it names what it takes
(`delete "the roof" and everything in it, for good?`). An agent doing it without
that sentence in its log is doing something a person would have been asked about.

---

## 8. Files

Upload with the person's token, then put the path on the row. **The first
segment of the path is the project's id**, not yours — the storage policy reads
it, asks `*_can_edit(<that project>)`, and refuses anything else with `403 new
row violates row-level security policy`:

```bash
curl -s -X POST "https://<ref>.supabase.co/storage/v1/object/vc-files/<project_id>/<uuid>.pdf" \
  -H "apikey: <anon>" -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/pdf" --data-binary @paper.pdf
```

- **Buckets** — `vr-files` (2 MB), `vd-files`, `vc-files`, `va-files` (10 MB each).
- **The path is `<project_id>/<file>`.** A path that starts with your user id is refused; that was measured, not assumed.
- **The row keeps** `file_path`, `file_name`, `file_size`, `file_mime`. A path without a row is an orphan file; a row without a path is an empty slot.
- **Reads go through the row**, not the bucket: the storage policies ask whether the person can read the artifact or output the file belongs to.
- **`vc_standards` files have no project** — they are the library's, and their rows are read through `vc_can_read_std`.

## 9. The doors

Some calls cannot come from the browser, because the provider sends no CORS
headers. Those go through our own origin, and an agent may use them too:

- **`POST https://api.terg.hr/chat`** — `{ url, key, body }`; the host must be on the allowlist in `apps/api/functions/chat.js`. The key is the caller's own and is never logged.
- **`POST https://api.terg.hr/search`** — `{ q }`.
- **`POST https://api.terg.hr/fetch`** — `{ url }`; https only, allowlist, redirect re-checked, 3 MB, 15 s, HTML reduced to text, PDF answered with a sentence.
- **`POST https://api.terg.hr/vp`** — the credit door: spend, call, settle.

A door is not an authentication boundary — it is a relay with a narrow mouth. Do
not send it a service key.

---

## 10. What is refused, and what the answer means

- **`401`** — no token, or an expired one. Refresh; the tool does that for you.
- **`42501 new row violates row-level security policy`** — the row is not yours to make. Usually a missing `user_id`, sometimes a project that is not yours.
- **`42501 permission denied for table …`** — the owner-field guard (see §6). Do not grant anything.
- **`23514 violates check constraint`** — a value outside a closed list (§4).
- **`428C9 cannot insert a non-DEFAULT value into column "chars"`** — a generated column. Compute it in the database's head, not yours.
- **an empty array where a row was expected** — the row exists but is not yours, or it is binned, or your filter is wrong. Try the same filter without `deleted_at is null`.

---

## 11. A whole job, start to finish

A requirement document, written without a browser:

```bash
node tools/vpl-api.mjs login you@example.com

P=$(node tools/vpl-api.mjs post vr_projects \
     '{"title":"the dog house","brief":"a roof that sheds rain, a door 30 cm wide"}')
PID=$(echo "$P" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')

# three requirements, in order
i=1
for s in "The floor shall be raised 5 cm above the ground." \
         "The roof shall shed rain without a gutter." \
         "The door opening shall be at least 30 cm wide."; do
  node tools/vpl-api.mjs post vr_reqs \
    "{\"project_id\":\"$PID\",\"kind\":\"functional\",\"strength\":\"must\",\"status\":\"draft\",\"statement\":\"$s\",\"pos\":$i}" >/dev/null
  i=$((i+1))
done

# check the work, in the same way the app would
node tools/vpl-api.mjs get vr_reqs "select=pos,statement,status&project_id=eq.$PID&order=pos.asc"
```

The app will show that document with three rows, in that order, because it reads
the same table — not a cache of it. Nothing has to be told that the API wrote.

---

## 12. What an agent must not do

- **Hold the service key.** It ignores every rule in this document.
- **Write across apps.** A requirement does not become a document by an update; promotion is markdown on a clipboard, by a person.
- **Publish or share on its own initiative.** `published`, `publish_code` and `*_shares` are a person's decisions about who may read their words.
- **Bin or destroy without saying what it took.** The app asks with the label in the sentence; so should a log.
- **Treat "count zero" as "nothing there".** A filter that is slightly wrong returns zero rows and no error.
- **Assume a browser is running.** Nothing here needs one — that is the point of this page.

---

## Where the evidence is

- `./tools/map.sh` — every table, port, function, door and suite, read from the repository.
- `supabase/migrations/` — the schema, the policies, the guards and the closed lists, in order.
- `docs/security.md` — the findings and what each one closed.
- `docs/rules.md` — the rules this document obeys, each with the test that catches it.

---

## 7. The same API as MCP tools

`tools/vpl-mcp.mjs` speaks Model Context Protocol on stdio, so an agent that has
no shell can still work: five tools, no new service, no service key.

| tool | what it does |
| --- | --- |
| `vpl_login` | sign in as the person, caching the token beside the shell tool's |
| `vpl_whoami` | who the token is, minutes left, live and binned rows per app |
| `vpl_query` | read rows with PostgREST filters, as that person |
| `vpl_write` | insert, update or delete — **a filter is required** for the last two |
| `vpl_rpc` | call a database function, e.g. `vn_delete_my_account` |

Register it once:

```json
{ "mcpServers": { "vpl": { "command": "node",
    "args": ["/home/<you>/vpl/tools/vpl-mcp.mjs"] } } }
```

Then `npx free-pi-cli mcp login vpl` in a fresh session picks it up (or restart).
The token is the one `tools/vpl-api.mjs login` already cached, so signing in once
in a shell is enough for both — and signing out is deleting that file.

`node tools/vpl-mcp.mjs --tools` prints the list without speaking the protocol,
which is the quickest way to see what an agent will be offered.
