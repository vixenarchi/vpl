# AGENTS.md — read this before you touch anything

`vpl` is "vixen productivity light": **eight small web apps** that share one look
and one signed-in person. Notes, ideas, requirements, a dictionary, documents,
compliance, keys and codes, architecture. One repository, one database, one
static deploy per app, **no framework, no bundler, no build step, no server of
ours**. Plain ES modules loaded by the browser; libraries come from a CDN.

Your job here is usually: change one app, keep the shared look intact, and prove
it. The house has one way of doing that, and this page is it.

## The three commands

```bash
./serve vn                  # local, no-store headers (ports below)
./tools/test-all.sh         # the gate: 56 groups, ~8 minutes in 4 lanes, starts its own servers
./deploy vn                 # Cloudflare Pages, one project per app
```

The gate runs its groups in **lanes**: one lane per app, so a bin test cannot
delete the note a markdown test is reading. `VPL_JOBS=1` gives the old order one
at a time (~25 min), `VPL_JOBS=8` is as fast as it gets, and `VPL_KEEP=1` leaves
every group's log and prints the path — that is how a failure is read.

Ports: `vn 8102`, `vi 8100`, `vr 8101`, `vz 8103`, `vd 8104`, `vc 8105`,
`vp 8106`, `va 8107`. `./tools/test-all.sh` starts any that are not up and kills
them on the way out.

The gate needs two test accounts of your own project, in `~/.config/vpl/test.env`
(`VPL_EMAIL`, `VPL_PASS`, `VPL_GUEST_EMAIL`, `VPL_GUEST_PASS`). With none it
**exits 78 and reports the group as skipped** — that is not green. There is no
"probably fine" here: either the group ran, or it did not.

## Before you start

1. `./tools/stage.sh --check` — eight apps hold a **copy** of `packages/shell`.
   If it prints stale, the app you are about to fix is not the app you are
   reading. The gate runs this first, for the same reason.
2. `./tools/map.sh` — which tables, which port, which suite. Generated from the
   repo, so it is never out of date.
3. `docs/rules.md` — every rule that has cost somebody a bug, with the test that
   proves it. Skim it; it is one page.

## After every change

`./tools/test-all.sh`, and **read the summary line**: `N passed, M failed,
K skipped`. A suite that was skipped proves nothing. If a group fails twice, it
is a break, not a slow neighbour — the runner retries once and prints both runs.

## What goes where

```
apps/<app>/        one product: index.html, app.js, style.css, lib/, test-free
apps/<app>/lib/    db.js (its own tables, through Supabase REST), app-specific
apps/<app>/vendor/ a COPY of packages/shell — git-ignored, made by tools/stage.sh
packages/shell/    the shared shell: tokens.css ai.js settings.js who.js
                   dock.js notices.js words.js engine.js
apps/api/          the one origin the browser talks to: chat, search, fetch, vp
                   (_door.js: the four refusals; _limit.js: the bound)
tools/vpl-api.mjs  the API an agent uses: a token, then get/post/patch/delete
tools/vpl-mcp.mjs  the same API as five MCP tools over stdio (login, whoami,
                   query, write, rpc) — registered in ~/.free-pi/agent/mcp.json
tools/mail.mjs     list / find / body / send the project's mailbox (app password)
skills/            two skills an agent can run as it stands: notes, and the
                   seven project apps (each SKILL.md + one script)
agent/             the worker that takes a `va` job and writes the answer back
supabase/migrations/  numbered SQL, one prefix per app
apps/vn/test/      every app's suite (one folder, so `test-all.sh` is one list)
docs/              one document per app, plus the rules, the cookbook, the history
tools/             stage.sh, test-all.sh, map.sh
```

An app is **independent**: its own folder, its own tables (`vn_`, `vi_`, `vr_`,
`vz_`, `vd_`, `vc_`, `vp_`, `va_`), its own deploy, and it must keep working when
the rest of the repo is gone. Apps do not import each other, do not write each
other's tables, and **never link to a sibling**. Advertising stays a copy you
paste, never a pointer.

## Thirteen rules that bite

Each of these has been broken in this repository, and each is enforced by a test.
The full list with reasons is `docs/rules.md`.

1. **The shell is copied, never imported.** Edit `packages/shell/*`, then
   `./tools/stage.sh <app>` for every app. `stage.sh --check` fails otherwise.
2. **One id, one element.** `getElementById` returns the first match, so a second
   `#art-msg` means every message is painted behind the modal. `chrome-check`.
3. **Colour is never the only signal.** Every state needs a word and a mark next
   to it. Number + word, not a coloured dot. `chrome-check`, `bin-check`.
4. **Typed text is never centred.** Not in a dialog, not in a grid cell, not in a
   stretched button. `ux-sniff` measures the geometry.
5. **A delete is undoable: ✕ bins, never destroys.** Emptying is a separate verb
   that names what it will destroy. `bin-check` ×7.
6. **Chrome does not print; the work does.** Under print media, bar, rail, dock,
   toolbar, notice and road step aside; the document prints whole — and `Ctrl+P`
   must print what the button prints (`beforeprint` fills `.print-doc`).
   `chrome-check`.
7. **A model never writes into a field on its own.** It proposes in a balloon;
   a person presses *use it* or *drop*. `dock-check`, `vr-ai`, `vi-ai`.
8. **The browser talks to one origin of ours.** Providers send no CORS headers,
   so everything goes through `apps/api/functions/*`. A key lives in the person's
   `localStorage`, per origin.
9. **A permission on a row is not a permission on its fields.** The client never
   writes an owner column; the database refuses it (`vpl_owner_is_not_a_field`)
   and revokes are functions (`vp_revoke_key`). `owner-guard`, `va-sec`,
   `vp-check`.
10. **Never delete by content, always by id,** and never change a row's parent by
    a client update — the database refuses that too, by design.
11. **An agent is a person with a token, not a service with a key.** The API is
    the one the apps already use (Supabase REST + RLS). The service key is never
    held by a tool. `api-check`.
12. **A share is the owner's decision, and a bin is the owner's too.** Policies
    are OR'd, so a narrower rule added beside a wide one changes nothing — drop
    the old ones first. `authz-matrix`, `authz-confirm`.
13. **A rail lists what you own and what somebody shared with you in one column,
    so the two must not look alike.** A shared project carries the word `shared`
    (a pill, never only a colour) and **no ✕** — the bin is the owner's decision,
    and a row asking for a ✕ it does not have once emptied the whole list.
    The chips have to fit the rail: they get their own line and wrap.
    `shared-rail-check`, `bin-check`.
14. **A finished job is a record.** Once a job is `done` or `failed`, only its
    owner may change the report, the files, the status or the start time; a
    colleague gets `42501` with a hint. RLS cannot see the row it replaces, so
    the rule is a trigger. `va-sec`.
15. **A link that has been used names the way forward.** A confirmation ticket
    works once; the second click must say "already used or has expired — sign in,
    or sign up again", never a raw error. `auth-check`.
16. **No inline scripts, and every page carries the same CSP.** An inline boot
    script is what a strict policy refuses; the shell's `theme.js` exists for
    that reason. `csp-check` walks the page under the policy.

## The style of the code

- **No build. No framework.** One `app.js` per app, one `lib/db.js`, one
  `style.css`, ES modules, `import` from a CDN only for real libraries
  (DOMPurify, pdf.js, Playwright in tests).
- **~300 lines per file is the ceiling.** Write long things in parts.
- **`node --check` proves a file parses, not that it is what you meant.** Only a
  suite that presses the button proves the button.
- **Silent autosave ~700–800 ms**, one save path per app, `S` for state.
- **Markdown is the storage format**; every render goes through DOMPurify.
- **Comments explain why, in one sentence.** The house writes sentences, not
  labels: `/* the bin is a chip in the rail, not a bar under the work */`.

## Migrations

```bash
# 1. write supabase/migrations/<timestamp>_<name>.sql   (re-runnable, numbered)
# 2. push from this repo; the CLI is linked to the project
cd supabase && npx supabase db push --remote --yes
```

The file name must be exactly `<timestamp>_<name>.sql`. Syntax errors and policy
mistakes surface **only at push** — a `create policy` written
`for insert … as restrictive` is a syntax error, because `as restrictive` comes
*before* `for`.

Two things that bit on 27 Nov: the remote history had 38 versions whose files
lived in the v2 repository (restored into `supabase/migrations/`), and
`20261120000000` was a **full schema dump**, not a step — it now lives in
`supabase/bootstrap/` and its history row was repaired
(`npx supabase migration repair --status reverted 20261120000000 --remote --yes`).
Never push the dump: it creates tables without `if not exists`.

## What not to do

- Do not add a build step, a bundler, or a framework "just for this app".
- Do not add a shared runtime module between apps — copy it into `vendor/`.
- Do not add cross-app links, cross-app writes, or a shared "metamodel".
- Do not put a secret in the repo, and do not commit `config.local.js`,
  `agent.env`, `test.env`, or anything with a key in it.
- Do not point a default address at somebody's deployment.
- Do not delete a row on a user's behalf: bin it.

## Where the knowledge is

- **`docs/state.md`** — where the house stands: what exists, the numbers the gate
  proves, what is closed, what is open. Read this one first after a break.
- **`docs/reminders.md`** — the practical memory: where the hidden things live,
  the traps that cost time, and what to run in ten minutes.
- **`docs/www.md`** — the front door (`www.terg.hr`): the page, the six imprint
  fields only the owner can give, and the publish steps.
- **`docs/next.md`** — the phase after the code: marketing, design, pitch, the
  business model. Marked as questions, not decisions.
- **`docs/api.md`** — how an agent does the work without a browser: sign in, the
  tables, the closed lists, the bin, files, what is refused.
- **`skills/`** — the same thing as two runnable skills (`vpl-notes`,
  `vpl-apps`), with `skills/README.md` saying how to install them.
- `docs/rules.md` — the index: rule, why, which test proves it.
- `docs/cookbook.md` — recipes: add a table, add a tab, add an app, add a bin.
- `docs/<app>.md` — what each app is, and what it deliberately is not.
- `docs/build-notes.md` — the chronology and the arguments behind decisions.
  Good for *why*, too long for *what*.
- `docs/security.md` — the four high findings, what fixed them, what is open.
- `prompts/` — three ready prompts for an assistant picking this up cold.
