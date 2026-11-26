# skills/ — the two skills an agent uses to do the work

Each folder is a **skill**: a `SKILL.md` whose front matter names it and says
when to use it, and a `scripts/` folder with one small command-line tool. They
are written for the agent, not for the browser: a person asks for a note or a
requirement, the agent signs in as them and writes the row.

- **`vpl-notes/`** — `vn`: a note, its body, a share by an email address.
- **`vpl-apps/`** — `vi`, `vr`, `vz`, `vd`, `vc`, `va`: a project, its rows, a
  share. `vp` read-only (keys and codes are a person's money).

They are not a new interface. Every call is PostgREST on the project the apps
use, as one person's token, so row-level security decides exactly as it does in
the page — and the service key is never needed, never held, and never allowed.

## Installing them in an agent

Symlink, do not copy: a fix in this repository should be a fix in the agent.

```bash
ln -s "$PWD/skills/vpl-notes" ~/.agents/skills/vpl-notes
ln -s "$PWD/skills/vpl-apps"  ~/.agents/skills/vpl-apps
```

An agent that reads skills from a project folder needs nothing: point it at
`skills/*/SKILL.md`.

## The two-minute check that they still work

```bash
set -a; . ~/.config/vpl/test.env; set +a        # a test account
node skills/vpl-notes/scripts/vpl-notes.mjs who
node skills/vpl-apps/scripts/vpl-app.mjs who

# a note, with a table in it, shared with an address
printf '# probe\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' > /tmp/body.md
node skills/vpl-notes/scripts/vpl-notes.mjs note 'skill probe' /tmp/body.md
node skills/vpl-notes/scripts/vpl-notes.mjs share <note_id> someone@example.com view
```

Both print what they did. A `403 insufficient_privilege` from `share` on a
project that is not yours is the authorization fix working, not a bug — the
owner mints the grant.

## Where the knowledge behind them lives

- **`docs/api.md`** — the API as an agent uses it: tokens, tables, closed lists,
  the bin, files, the doors, and every refusal with its error code.
- **`docs/security.md`** — the findings these two tools were hardened against.
- **`./tools/map.sh`** — the generated map of tables, ports, functions, suites
  and these skills.
