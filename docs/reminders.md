# Reminders — what a future me needs, that nothing else records

Not rules (those are `docs/rules.md`, each with a test). Not the layout (that is
`docs/state.md`). This is the practical memory: where the hidden things live, what
bites on this machine, and what to run when there are only ten minutes.

## Where things live

| what | where |
| --- | --- |
| test accounts | `~/.config/vpl/test.env` — `VPL_EMAIL`, `VPL_PASS`, `VPL_GUEST_EMAIL`, `VPL_GUEST_PASS` |
| agent's own account, model key, mail | `~/.config/vpl/agent.env` |
| tokens and model keys collected over time | `~/.config/vpl/accounts.md` |
| API token cache (0600) | `~/.config/vpl/api-token.json` |
| the mail app password | `~/.config/vpl/agent.env` (`MAIL_ACCOUNT`, `MAIL_APP_PASS`) |
| Supabase url + anon | `apps/vn/config.local.js` (and every app's), `/tmp/sb.txt` |
| Supabase link for pushes | `supabase/.temp/` (`project-ref`, `pooler-url`) |
| MCP registration | `~/.free-pi/agent/mcp.json` |
| skills an agent runs | `skills/vpl-notes`, `skills/vpl-apps` → `~/.agents/skills/` |

**Never commit** those; `credentials/`, `*.env`, `config.local.js`, `vendor/`
are ignored.

## If you have ten minutes

```bash
./tools/stage.sh --check          # the vendor copies are current
./tools/map.sh | head -40          # tables, ports, suites
node tools/vpl-api.mjs me          # who you are, counts per app
./tools/test-all.sh                # the gate (8 min at 4 lanes)
```

If `me` says "not signed in": `node tools/vpl-api.mjs login "$VPL_EMAIL"`
(password from `$VPL_PASS`).

## Traps that cost time here

- **`UID` is read-only in bash** — use `MYID`.
- **`local a="$1" b="…$a…"` fails under `set -u`** — assign in two statements.
- **An inline `style` or `--var` beats a media query.** Rail width, themes:
  use a class or a `<style>` rule, never an inline style.
- **A repaint eats a `.click()` fired from `pg.evaluate`** — aim at the list again
  after the repaint, or click through a locator.
- **`Number('')` is 0.** Missing env reads as a real value; guard with `||`.
- **Playwright `fill` on a hidden panel times out** — ask `isVisible()` first.
- **A worker script in `/tmp` cannot `import 'playwright'`** — put test scripts in
  `apps/vn/test/`.
- **A `<dialog>` asked about through a locator lies** — read it with
  `pg.evaluate`.
- **`curl` does not see the edge-injected script** the browser receives; to prove
  "no beacon" use a real browser (`request` event + `documentElement.outerHTML`).
- **`npx supabase db push` refuses if the remote history has a version that has
  no local file.** Two real cases: 38 files lived in `vixen/supabase/migrations`
  (restored), and `20261120000000` was a full schema dump (moved to
  `supabase/bootstrap/`, history repaired with
  `migration repair --status reverted 20261120000000 --remote --yes`). Never push
  the dump as a migration.
- **Cloudflare's beacon cannot be switched off through wrangler** — its token has
  no RUM scope (`403` on `/accounts/…/rum/site_info`). The dashboard path is
  account → *Analytics & Logs → Web Analytics → Manage site → Advanced options →
  JS snippet injection → Disable*, then *Caching → Purge Everything*.
- **The Google account needs an app password** for IMAP/SMTP; the account
  password gets `[ALERT] Application-specific password required`. The working one
  is in `agent.env`.
- **A finished `va` job is frozen for colleagues** (VA-2). If a test wants to
  change one, it has to be the owner or it has to reopen it (`status=queued`).
- **`key-check` wipes `vpl_ai`** while it runs. After the gate, the agent's model
  key has to be put back (it is read from the vz dictionary "Test account").

## Habits that keep the suite honest

- **Change the shell → `tools/stage.sh <app>`** for every app you will deploy, or
  the gate stops at the first line.
- **A new suite is not in the gate until you add its `run` line**, and a suite
  that never runs is green by absence.
- **A new app is one folder, one table prefix, one Pages project, one lane.** The
  recipe is `prompts/add-an-app.md`.
- **A migration is re-runnable** (`if not exists`, `create or replace`, drop the
  trigger before creating it).
- **Push with a commit** — the release notes are the commit messages; they say
  what the person saw and what the fix was.
- **Check the deployment, not the build**: `./deploy <app>`, then
  `curl -s -o /dev/null -w '%{http_code}' https://<app>.terg.hr/`.

## What the person prefers

- Croatian in conversation, English in code and docs.
- Bullet lists with a **bold label**; no markdown tables in chat.
- Colour is never the only signal: a word or a mark beside it.
- Typed text is never centred.
- "A skip is not a pass", "never delete by content", "a token is a person",
  "the service key is never held by a tool".
- Before saying something is done: run it, open it, or check the specific test —
  and say what was checked and what was not.
