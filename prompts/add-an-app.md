# Prompt — add a ninth app

The suite has eight apps. A ninth is a **copy of a neighbour**, not a new
architecture. Use this when you want `vx` (your app) next to `vn`, `vi`, `vr`,
`vz`, `vd`, `vc`, `vp`, `va`.

---

You are adding one app to the `vpl` suite. Read `AGENTS.md` and
`docs/cookbook.md` → *Add a ninth app from an existing one* first. The house rule
is **one engine, many skins, and the engine is a copy**.

1. **Pick the closest neighbour.** Requirements sheet (`vr`), document writer
   (`vd`), rule checker (`vc`), dictionary (`vz`), funnel (`vi`), notes (`vn`).
   Copy the one whose *shape* is closest, not the newest one.
2. **Copy and rename.**
   ```bash
   cp -r apps/<neighbour> apps/vx
   rm -rf apps/vx/vendor
   ```
   Then, inside the copy: `index.html` `<title>` and brand mark, `app.js` imports
   and any app name in copy, `style.css` accent, `lib/db.js` table prefix,
   `config.local.js` (from `config.example.js`).
3. **Tables.** Write `supabase/migrations/<timestamp>_vx_core.sql` from the
   neighbour's migration with `vx_` prefixes, row-level security, and the four
   policies that the neighbours share — owner all, share-view select,
   share-edit write. Give it `deleted_at` if a person can lose a row.
4. **The engine knows no app.** `packages/shell/engine.js` is copied in and gets
   inputs, a transformation and an output — nothing about `vx`. If you want to
   write `if (app === 'vx')`, stop: the shape is wrong.
5. **Chrome.** `./tools/stage.sh vx`, then
   `APP_NAME=vx APP_URL=http://127.0.0.1:<port> node apps/vn/test/chrome-check.mjs`
   — it must be as green as the eight, because it is the same bar, gear, dock,
   notice and sign-in card.
6. **The bin**, if rows can be lost: follow *Add a bin* in the cookbook, and add
   `vx` to `SPECS` in `apps/vn/test/bin-check.mjs`.
7. **A suite.** `apps/vn/test/vx-check.mjs`, modelled on the neighbour's, plus
   one line in `tools/test-all.sh` inside the account block.
8. **A document.** `docs/vx.md`: what it is, what it deliberately is not, the
   tables, the rules it adds. Add it to `README.md`'s list and to `AGENTS.md`'s
   anatomy if it introduces a new folder.
9. **Deploy.** A Pages project, then `./deploy vx`. Per-app sign-in addresses go
   in Supabase → Redirect URLs; Site URL keeps exactly one value.

Finish with `./tools/test-all.sh`, and report the summary line. If a step could
not be done (no dashboard access, no DNS), say which — do not pretend.
