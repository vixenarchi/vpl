# vpl — vixen productivity light

Eight small applications that share one look and one signed-in person: notes,
ideas, requirements, a dictionary, documents, compliance, keys and codes, and
architecture. Each app is its own folder, its own static deployment, its own
tables. There is no framework, no bundler, no build step, no server of ours to
keep warm, and no bill to pay while you try it.

This repository is the whole thing: the eight apps, the shared shell they are
painted with, the proxy that talks to model providers, an agent that works on
architecture jobs, and the database migrations that create the tables.

- **vn** — notes with chapters, a bin, sharing by link or by person, an assistant
- **vi** — an idea funnel: context, ideate, explore, select one, simulate
- **vr** — requirements: a sheet of testable sentences, must / optional / wish
- **vz** — a dictionary of keys and values, publishable as a read-only service
- **vd** — documents: papers in, the thing you have to write out
- **vc** — compliance: rules and proofs in, one verdict per control out
- **vp** — a key drawer and credit codes; one credit is one call
- **va** — architecture: the pile in, a box list out, as text or as a drawing
- **api** — one CORS door to model providers, and a search door beside it
- **agent** — the worker that takes a `va` job and writes the answer back

Each app is documented in `docs/`: `vi.md`, `vr.md`, `vz.md`, `vd.md`, `vc.md`,
`vp.md`, `va.md`. The rules the code is written against are in
`docs/specification.md`; the tour is `docs/start-here.md`.

## Picking this up — by a person or by an agent

- **`AGENTS.md`** — the page an assistant should read first: three commands, ten
  rules that bite, where things live. `CLAUDE.md` points at it too.
- **`docs/rules.md`** — every rule that has cost somebody a bug, with the test
  that proves it. Rule, reason, proof.
- **`docs/cookbook.md`** — recipes: run one app, add a table, add a settings tab,
  add a bin, add a ninth app, deploy, back up.
- **`prompts/`** — three ready prompts (change one thing, add an app, review a
  diff) for whichever assistant you use.
- **`./tools/map.sh`** — the generated map: tables, ports, suites.
- **`./tools/stage.sh --check`** and **`./tools/test-all.sh`** — the two commands
  that keep the house honest. A skipped group is not a green group.

## What it deliberately does not do

No teams or roles beyond view and edit. No realtime collaboration. No search
index. No file store worth the name. No dashboards. No seats, invoices,
analytics, cookie banner or third-party script. No app writes into another app's
tables — moving a document between two apps is your clipboard, on purpose.

## What you need

- **A browser** and **Python 3** to run it locally. Nothing else: the apps are
  plain HTML, CSS and JavaScript, and two libraries come from a CDN.
- **A Supabase project** (free tier) for the tables, the policies and the logins.
- **Node 18+** only for the test suites and for deploying.
- **A Cloudflare account** (free tier) when you want it on the internet.

Ten minutes to a running app; an evening to all eight.

## From zero to running

```bash
git clone https://github.com/vixenarchi/vpl && cd vpl

# 1. the database
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --remote          # builds every table, policy and function

# 2. the one file each app needs
cd apps/vn
cp config.example.js config.local.js    # fill in the project url and the anon key
cd ../..

# 3. run it
./serve                                 # http://127.0.0.1:8099, no-store headers
./serve vi                              # another app on its own port
./serve stop
```

The two values for `config.local.js` are in your Supabase dashboard under
*Settings → API*: **Project URL** and the **anon / public** key. The anon key is
public by design — row level security is the lock, not the key. The
`service_role` key must never appear in a page; `./deploy` refuses to publish if
it finds one.

Then, in the dashboard, three settings that will otherwise bite you:

- **Confirm email: off** while you are trying things out.
- **Site URL**: the address of your `vn` app.
- **Redirect URLs**: `https://<app-host>/**` for every app, plus
  `http://127.0.0.1:8099/**` and the ports you use locally.

Google sign-in returns to the Site URL, so a missing redirect entry looks like
"signing in from `vi` lands on `vn`", which reads as a bug in the app.

`./serve` runs `serve.py`, which sends `Cache-Control: no-store`. Without it a
browser silently keeps yesterday's `app.js` and the app looks broken.

### The second app, and the eighth

Every app needs its own `config.local.js` with the same two values (the files are
git-ignored; they are the only thing you copy). Each one also has its own port
under `./serve`, its own Pages project and its own address:

```
vn 8102   vi 8100   vr 8101   vz 8103   vd 8104   vc 8105   vp 8106   va 8107
```

## Configure

Everything configurable is listed with its default, where it lives and what
happens if you leave it alone, in **`docs/configure.md`**. The short version:

- **`apps/<app>/config.local.js`** — the Supabase project, and optionally the
  address of your own proxy (`proxy`, `search`, `door`).
- **Environment for the tests** — `VPL_EMAIL`, `VPL_PASS` and the guest pair;
  a suite with no account says so and exits 0 instead of failing.
- **`apps/api/functions/_origins.js`** — the addresses allowed to call the proxy.
  This is the one file to edit for your own domain.
- **Pages secrets** — `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` for the `vp` door;
  `VPL_SUPABASE_URL` and `VPL_SUPABASE_ANON` for `vz`'s published service.
- **Model keys** — per origin, pasted in each app's settings dialog and kept in
  that browser; or saved once to your account in `vp` and issued as credit codes.

Nothing else asks to be configured, and no value has a default that points at
somebody else's server.

## Put it on the internet

```bash
npx wrangler pages project create vpl-vn        # once per app
./deploy vn                                     # stage + upload
./deploy api                                    # the proxy (its own project)
```

`./deploy <app>` copies `apps/<app>` plus the shared shell into a temporary
folder, refuses a `service_role` key, and uploads only what a browser needs.
One app per Pages project — the free plan's builds are shared, so shipping `vi`
never rebuilds `vn`. `PROJECT=my-name ./deploy vn` overrides the project name,
and `./deploy vn --dry-run` prints exactly what would go out.

A custom domain is a CNAME to `<project>.pages.dev` in your DNS, added once in
the Cloudflare dashboard. When you have the address, add it to
`apps/api/functions/_origins.js` and to Supabase's redirect URLs.

## Why the proxy exists

Almost every model API answers the browser without `Access-Control-Allow-Origin`,
and the browser then throws the answer away: the same key works in `curl` and
fails on a page. So the call leaves from an origin you control —
`apps/api/functions/chat.js`, deployed as its own tiny project. It forwards to a
fixed allowlist of provider hosts, carries your key from the request body, uses
it once, and never stores or logs it. `../search.js` is the same idea for
evidence; `../vp.js` is the door that spends a `vp` credit instead of a key.

Each app also ships `functions/api/chat.js`, the same door on its own origin, and
`app.js` tries that first, then the shared proxy. `serve.py` speaks both routes
locally, so development and production behave alike.

## The database

One Supabase project for the whole suite, one `auth.users`, and a **prefix per
app**: `vn_`, `vi_`, `vr_`, `vz_`, `vd_`, `vc_`, `vp_`, `va_`, and `vpl_` for what
is shared. `vpl_prefix_check()` lists anything unnamed; run it after adding a
table.

`supabase/migrations/` builds everything from empty, in order. The first file is
the schema as it was folded together; every file after it is one change. Names
must start with the timestamp or `supabase db push` skips them silently.

What the database enforces, so a client bug cannot:

- row level security decides what any query may return;
- sharing goes through functions (`vn_share_role`, `vn_read_share`), so a code is
  a capability rather than a grant, and a shared document never appears in
  anybody else's list;
- triggers cover what RLS cannot see, such as who may bin or restore;
- deleting a live row is refused — it has to be binned first.

## Tests

The suites are Playwright scripts in `apps/vn/test/`, one file per behaviour,
each printing `N passed, M failed` and exiting non-zero on a failure.

```bash
cd apps/vn/test && npm install
export VPL_EMAIL=you@example.com VPL_PASS=…            # your own test accounts
export VPL_GUEST_EMAIL=other@example.com VPL_GUEST_PASS=…

../../tools/test-all.sh          # everything: syntax, chrome, settings, all suites, ux floor
VPL_PROD=1 ../../tools/test-all.sh   # the same against your deployments
```

`tools/test-all.sh` starts the local servers it needs, waits for each port to
actually answer, and retries a suite once (nine servers on a small machine: a
slow neighbour looks exactly like a break). Single suites and what each one
covers are listed in `docs/start-here.md`.

The suites make their own throwaway accounts and delete them at the end. No
credentials are in this repository.

## The rules that are not style choices

- **One account for the whole suite**, one subdomain per app, one deploy each.
  Shared: the signed-in person and the look. Not shared: the tables.
- **Text is the truth.** Notes, requirements and controls are markdown. A
  diagram is a list of boxes in the document, and the canvas edits the text.
- **The model proposes; a person decides.** Nothing a model writes lands in a
  field on its own: it arrives in a speech balloon and waits for a button.
- **A repaint must never write into a field somebody is typing in.**
- **Colour is never the only signal**, and typed text is never centred.
- **Keys are per origin**, deliberately: two apps are two origins, and no cookie
  carries a key to a server that has no business seeing it.
- **No cross-app writes.** The transfer path is your clipboard.

## Layout

```
apps/{vn,vi,vr,vz,vd,vc,vp,va}/   one app each: index.html, app.js, style.css, lib/
apps/api/                         the shared proxy (one page, three functions)
packages/shell/                   the shared look and the shared habits:
                                  tokens.css, ai.js, settings.js, who.js, dock.js,
                                  engine.js — copied into apps/<app>/vendor/ by
                                  tools/stage.sh, never imported across folders
agent/                            va's worker: a job directory in, files out
supabase/migrations/              the schema and every change since
tools/                            stage.sh, test-all.sh, backup.sh, per-app suites
docs/                             specification.md, start-here.md, configure.md, per-app
deploy  serve  serve.py           publish one app; run one app locally
```

`packages/shell` is copied, not linked, on purpose: each app must still work if
it is lifted out of this repository alone.

## License

Apache-2.0, see `LICENSE`.
