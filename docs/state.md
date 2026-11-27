# Where the house stands — 27 November 2026

A snapshot written so that somebody who has only this repository can pick the
work up. Everything here is checked by a command, and the command is named.
Nothing here is a plan; the plan is `docs/next.md`.

Read with `docs/rules.md` (why the code is shaped like this) and
`docs/reminders.md` (the traps that cost time). This page is *what exists*.

## 1. What the thing is

**vpl** — vixen productivity light. Eight small web apps that share one look and
one signed-in person, one database, one static deploy each. No framework, no
bundler, no build step, no server of ours to keep warm, no bill.

```
apps/vn   notes            vn.terg.hr        :8102   notes, chapters, bin, shares, assistant
apps/vi   ideas            vi.terg.hr        :8100   context → ideate → explore → select → simulate
apps/vr   requirements     vr.terg.hr        :8101   one sheet, rows that are testable sentences
apps/vz   dictionary       vz.terg.hr        :8103   keys and values, publishable at /p/<code>
apps/vd   documents        vd.terg.hr        :8104   inputs in, the document you have to write out
apps/vc   compliance       vc.terg.hr        :8105   standards + proofs in, one verdict per control
apps/vp   keys & codes     vp.terg.hr        :8106   a model key on the account; codes with calls
apps/va   architecture     va.terg.hr        :8107   the pile in, a box list out (text or drawing)
apps/api  the door         api.terg.hr                /chat, /fetch, /vp — CORS, Origin-bound
agent/    the worker       (no domain)                takes a va job, writes the answer back
```

All nine hostnames answer **200** (checked 27 Nov, `curl -o /dev/null -w '%{http_code}'`).
`api.terg.hr/vp` answers **405** to a bare GET — that is the relay refusing a
method it does not serve, not a broken deployment.

## 2. The shell every app carries

`packages/shell/` is the shared look and behaviour. `tools/stage.sh <app>` copies
it into `apps/<app>/vendor/`, which is git-ignored; `tools/stage.sh --check` is
the first line of the gate, because a stale copy makes every later pass a lie.

- **tokens.css** — colour, type, spacing, the `.shared-mark` pill, `.proj-bins`,
  the gate's rules, `.job-bin` chips.
- **rail.js** — the draggable rail: 9 px grip, drag / arrows / Home / End /
  double-click, width kept as `--rail-w` in a media-scoped rule *and* a class,
  never an inline style.
- **settings.js** — one dialog, five tabs (model, search, key, theme, you).
- **dock.js** — "ask about what is on screen": the app supplies a `context()`,
  the answer lands only when the person presses *use it*.
- **ai.js** — the model call: base url, model, key; the key is adopted from the
  account on the way in (`adoptAccountAi`).
- **theme.js** — the four lines of theme boot that used to be inline in eight
  `index.html` files (CSP).
- **notices.js**, **who.js**, **words.js**, **engine.js** (markdown), **_helpers**.

## 3. The database

Supabase project **vixen**, ref `ebhrjstllsazywbxnbqt`. 72 migration files in
`supabase/migrations/`, numbered `YYYYMMDDHHMMSS_name.sql`, re-runnable, pushed
with `npx supabase db push --remote --yes` from `supabase/` (the CLI is linked;
`supabase/.temp/pooler-url` holds the address, not the password).

- **`supabase/bootstrap/vpl_schema.sql`** — a one-file dump for building a *new*
  project. It is **not** a migration and must never be pushed: it creates tables
  without `IF NOT EXISTS` and fails on a live database.
- Every table carries the app's prefix (`vn_`, `vi_`, `vz_`, …), shared ones
  `vpl_` (`vpl_ai`). `tools/map.sh` prints the whole map from the repo.
- **RLS is a row permission, not a column.** Column rules (a frozen report, an
  owner-only `note`) live in **triggers**, because a policy cannot see the row it
  is replacing.
- **Policies are OR'd.** Drop every policy on a table before writing the new set,
  or the old door stays open.
- **The service key is never held by a tool.** Two accounts are used for tests
  (`VPL_EMAIL`, `VPL_GUEST_EMAIL`), and a token is a person.

## 4. The gate

```
./tools/test-all.sh                    # 56 groups, 0 failed, 0 skipped, ~8 min
VPL_JOBS=1 ./tools/test-all.sh         # one at a time, the old order, ~25 min
VPL_KEEP=1 ./tools/test-all.sh         # keep every group's log and print the path
```

Last full run, 27 Nov: **56 passed, 0 failed, 0 skipped**. The fastest full run
was **6 m 23 s** (4 lanes); a typical one is 8 minutes.

**How it runs.** Groups are queued into **lanes**; one lane runs one group at a
time, lanes run beside each other with `VPL_JOBS` (default 4). Everything that
touches one app is one lane, because every suite signs in as the same person and
a bin test must not delete the note a markdown test is reading. The first two
checks — `stage --check` and the syntax pass — still run in front, in order.

**A group is only green if it ran.** Exit 78 means "not configured" and is
counted as skipped; the run is not green while anything is skipped. A failure is
retried once (a slow neighbour looks exactly like a break) and both runs are
printed.

**What is in it** (counts are assertions, not groups):

| suite | covers |
| --- | --- |
| `chrome-check` | bar, gear, five tabs, dock, notice, print — per app (47–50) |
| `settings-check` / `auth-check` | the shared dialog, sign-in, sign-out, a spent link (30 / 11–14) |
| `bin-check` | the bin, restore, purge, the two chips fit the rail (23 × 7 apps) |
| `rail-check` | the grip: drag, arrows, Home/End, dh-click, keystroke (19 × 7) |
| `mode-check`, `md-check`, `dock-check`, `dnd-check`, `touch-check` | vn (23 / 27 / …) |
| `vr-check`, `vz-check`, `vd-check`, `vc-check`, `vc-lib`, `vc-batch`, `vp-check` | each app (59 / 53 / 47 / 41 / 45 / 53 / 33) |
| `va-check`, `va-canvas`, `va-handoff`, `va-sec` | architecture, drawing, hand-off, and who may queue (47 / 21 / 4 → 9) |
| `api-check`, `mcp-check` | the agent's surface over REST (18) and over MCP (10) |
| `owner-guard`, `share-check`, `account-key-check`, `key-check` | column guards, sharing, the key on the account (5 / 23 / 40 / 23) |
| `door-check`, `csp-check`, `fetch-check` | 26 / 128 / 15 — the door, the policy, the redirect walk |
| `authz-matrix`, `authz-confirm` | the whole grid, one proof per finding |
| `shared-rail-check` | a project that is not mine says `shared` and has no ✕ (42) |
| `ux-sniff` | hits under 30 px, type under 10.5 px, unnamed controls, sideways scroll |

## 5. The agent's surface

- **`tools/vpl-api.mjs`** — `login`, `me`, `get`, `post`, `patch`, `delete`,
  `rpc`. Caches a token in `~/.config/vpl/api-token.json` (0600) and refreshes it.
  A patch or a delete without a filter is refused before it leaves.
- **`tools/vpl-mcp.mjs`** — the same API as five MCP tools over stdio:
  `vpl_login`, `vpl_whoami`, `vpl_query`, `vpl_write`, `vpl_rpc`. Registered in
  `~/.free-pi/agent/mcp.json`. Carries the person's token, never the service key.
- **`tools/mail.mjs`** — `list`, `find`, `body`, `send` on the project's Gmail
  with an **app password** (the account password is refused once 2FA is on).
- **`skills/vpl-notes`, `skills/vpl-apps`** — symlinked into `~/.agents/skills/`;
  six commands to write a note or a project's rows as a real account.
- **`docs/api.md`** — the reasoning (no vpl service; RLS is the permission model).

## 6. Security: what was found, and what is closed

Two independent audits (from another laptop, and mine) produced findings that
were all closed; each has a test that would fail if it came back.

- **C7 / VP-4** — the door: 405 on a wrong method, 403 with no `Origin`, 415 on a
  bad content type, 413 over the cap; one counter for four doors; every answer
  carries `X-Vpl-Limit: n/60`. → `door-check`
- **C8** — a CSP in all eight apps and in `serve.py`; the inline theme boot became
  `packages/shell/theme.js`; the edge beacon is refused and announced.
  → `csp-check` 128/0
- **VC-3** — `/fetch` follows a redirect only after asking where it goes
  (`redirect: 'manual'`, per-hop host/protocol check, 3 hops). → `fetch-check`
- **The other laptop's seven** — closed by `20261224000000_…` (drop every policy
  on 18 tables, write four per table) plus `vpl_bin_is_the_owners`,
  `vn_structure_is_the_owners`, `vc_a_verdict_comes_from_a_run`. Every one has a
  proof in `authz-confirm`.
- **VA-1** — a person who may write text may not start a machine: `va_jobs` insert
  is owner-only, the job folder refuses anything but `out/`. → `va-sec`
- **VA-2** — a finished job is a record: once `done`/`failed`, only its owner may
  change `report`, `files`, `status` or `started_at`; a colleague gets `42501`
  with a hint. Trigger `va_a_finished_job_is_a_record` (`…000500`, fixed by
  `…000600` — the first draft named a `finished_at` column that does not exist,
  which fails *open*). → `va-sec` 9/0
- **The account key** — `vn`, `vz` and `vp` never told the shell who the token
  was, so `accountAi()` answered nothing; fixed in all eight. → `account-key-check`
- **The edge beacon** — Cloudflare's Web Analytics was being injected into every
  `*.terg.hr` page (free proxied zones, since late 2025). Switched off at the
  account and verified clean on all eight. The CSP still refuses it, and
  `csp-check` now prints `EDGE INJECTS … AGAIN` if it returns.

**Accepted risk:** the model key lives in `localStorage`, guarded by CSP. Moving
it server-side is about a day of work and ends "zero servers" — the decision to
leave it is recorded and deliberate.

## 7. What is still open

**Only the person can do these**

- `terg.hr` and `www.terg.hr` do not resolve. The marketing site is not built
  yet; when it is, it needs a Pages project, two custom domains and one 301 from
  the apex. Plan: `docs/www.md`.
- Six imprint fields (name, address, contact, VAT/OIB, responsible person,
  hosting) — required before a `.hr` site can be published.
- One model key saved on their own account (so every browser inherits it).

**Deliberately not built**

- Sections mode.
- Sharing the `vc` library.
- A server-side key store.

**Parked with a date**

- **`w3`** — the ninth app: an AI-built page generator that takes notes from `vn`
  and publishes them with a menu, a skeleton and CSS stored in the database, and
  markdown rendered into a nicer, more modern reader. Three questions are still
  unanswered in `docs/w3.md`. Parked by the person on 27 Nov.
- **Key-value configuration** for the model key, instead of `localStorage`.

## 8. Numbers to trust, on 27 Nov 2026

- gate **56 / 0 / 0**, eight minutes at four lanes.
- `csp-check` **128 / 0**; `door-check` **26 / 0**; `fetch-check` **15 / 0**;
  `authz-confirm` **18 / 0**; `shared-rail-check` **42 / 0** (local and prod);
  `mcp-check` **10 / 0**; `va-sec` **9 / 0**; `account-key-check` **40 / 0**.
- 72 migrations; the last two are `20261224000500` and `20261224000600`.
- Git: `main`, pushed, working tree clean.
