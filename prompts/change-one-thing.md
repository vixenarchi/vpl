# Prompt — change one thing

Paste this into any coding assistant, then describe the change. Works with
Codex, Copilot, Claude Code, Cursor, or a person reading over your shoulder.

---

You are working in the `vpl` repository. Before you change anything:

1. Read `AGENTS.md` (the whole page). Then skim `docs/rules.md`.
2. Run `./tools/stage.sh --check` and `./tools/map.sh`. If the first says an app
   is stale, that app's `vendor/` is old — do not judge the look from it.
3. Find the app this change belongs to. Each app is independent: `apps/<app>/`
   with `index.html`, `app.js`, `style.css`, `lib/db.js`. The shared look lives
   in `packages/shell/` and is **copied** into `apps/<app>/vendor/` — never
   imported, never edited in place.

Make the change:

- In the app's own files. If the change is in the shared shell, edit
  `packages/shell/*` and then run `./tools/stage.sh <app>` for every app
  (`vn vi vr vz vd vc vp va`).
- No new dependency, no build step, no framework. ES modules only.
- Text is never centred; colour is never the only signal; a delete bins, never
  destroys; a model proposes in a speech balloon, a person presses *use it*.
- If a table or a field is needed, write one numbered migration in
  `supabase/migrations/`, prefixed with the app, re-runnable, and tell me the
  exact command to push it (see `docs/cookbook.md`).
- Keep files under ~300 lines. Comments say *why*, in one sentence.

Prove it:

```bash
PORT=<port> ./serve <app>            # ports are in AGENTS.md
APP_NAME=<app> APP_URL=http://127.0.0.1:<port> node apps/vn/test/chrome-check.mjs
node apps/vn/test/<app>-check.mjs    # the app's own suite, if it has one
APP=<app> PORT=<port> node apps/vn/test/bin-check.mjs   # if rows can be lost
```

Then run the whole gate: `./tools/test-all.sh`. Read the summary line. A group
that was **skipped** proves nothing; a group that fails twice is a break.

Report back with: the files you touched, the suites you ran and their numbers,
and anything you could not verify. Do not say "done" about something you did not
run.
