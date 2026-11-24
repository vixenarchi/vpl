# Configure

Every value you can set, where it lives, what it defaults to, and what happens if
you leave it alone. If a setting is not here, it is not a setting — it is code.

## 1. The project each app talks to

`apps/<app>/config.local.js` — copied from `config.example.js`, git-ignored. Two
values are required:

- **`url`** — your Supabase project URL, `https://<ref>.supabase.co`.
- **`anon`** — the **anon / public** key from *Settings → API*. It is public by
  design: row level security is the lock, not the key. A `service_role` key here
  would hand every visitor the database, and `./deploy` refuses to publish one.

Optional values, all with the same meaning in every app:

- **`lib`** — where `supabase-js` comes from. Defaults to jsDelivr. If you would
  rather not use a CDN, point it at a copy you host.
- **`proxy`** — your own `/chat` proxy, e.g. `https://api.example.com/chat`. With
  no value the app uses its own `/api/chat` and gives up if the host has none.
  Nothing points at anybody else's server by default.
- **`search`** — your `/search` proxy, used by `vi`. Same rule.
- **`door`** — your `/vp` door, used by `vp`.

The same two required values must be in every app you intend to run: they share
one project, not one file. That is deliberate — an app is a folder you can lift
out and deploy alone.

## 2. Supabase authentication

Dashboard → *Authentication*:

- **Confirm email: off** to start. Without a mailbox a new account cannot get in,
  and the suite's accounts are made with a bare name (`miki@vpl.local`).
- **Site URL** — exactly one address: the `vn` host. Supabase holds one, and
  Google returns there.
- **Redirect URLs** — one line per app: `https://<app-host>/**`, plus
  `http://127.0.0.1:<port>/**` for the ports you use locally.

Names and addresses ignore case; passwords never do. That is enforced in the
database, not in the form.

## 3. The proxy's allowlist

`apps/api/functions/_origins.js` — the **one** file to edit for your domain. A
full entry matches one origin exactly; an entry starting with a dot matches any
subdomain (`.example.pages.dev`). Local development (`127.0.0.1`, `localhost`,
`0.0.0.0`) is always allowed.

The provider hosts a request may be forwarded to are the `ALLOWED` list in
`apps/api/functions/chat.js` and `vp.js`. Adding a provider is one line there,
then `./deploy api`. The destination is never taken from the request.

## 4. Secrets the server side needs

Pages → project → *Settings → Variables and Secrets*. These never go in the repo:

- **`vpl-api`** — `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. The `vp` door needs the
  service key because `vp_spend` hands back the provider key of whoever issued
  the code. That function does nothing else, and logs nothing.
- **`vpl-vz`** — `VPL_SUPABASE_URL`, `VPL_SUPABASE_ANON`, for the published
  dictionary service at `/p/<code>`. The anon key is the same public key as in
  `config.local.js`; it lives in a secret so a fork does not answer for your
  project.

Both are read at request time. A deployment without them answers `500` with a
sentence saying which two values are missing, rather than pretending.

## 5. Accounts for the tests

The suites sign in as two people of your own project — an owner and a guest:

```bash
export VPL_EMAIL=you@example.com  VPL_PASS=…
export VPL_GUEST_EMAIL=other@example.com  VPL_GUEST_PASS=…
```

Keep them in a 600 file outside the repository (we use
`~/.config/vpl/test.env` and `tools/test-all.sh` sources it if it exists). No
credential is in this repository, and a suite with no account prints which two
variables it wanted and exits 0.

Some suites take more, each documented in its header: `VPL_SEARCH_KEY` for the
one live search, `VPL_MODEL_URL` / `VPL_MODEL_KEY` / `VPL_MODEL` for a real pass
through the funnel, and `VR_URL`, `VI_URL`, `VD_URL`, `VC_URL`, `VP_URL` to point
a suite at another address.

## 6. Deploying

`./deploy <app>` uses a Pages project named `vpl` for `vn` and `vpl-<app>` for
the rest; `PROJECT=…` overrides it. `./deploy <app> --dry-run` prints the file
list and uploads nothing.

A custom domain is a **CNAME to `<project>.pages.dev`** (proxied) plus the domain
added to that Pages project. A CNAME alone gives you `522` until the hostname is
attached — that is Cloudflare's way of saying the project does not know the name.

Two things are easy to forget and both look like a bug:

- a new address must be added to `_origins.js` (or the proxy refuses the call);
- a new address must be added to Supabase's Redirect URLs (or Google sign-in
  returns to the Site URL).

## 7. The agent (`va`)

`agent/agent.env.example` lists every value, with comments. In short: where jobs
land (`VPL_JOBS`), which model to use, and — for the queue mode that reads
`va_jobs` — the agent's own account (`VPL_SUPABASE_URL`, `VPL_SUPABASE_ANON`,
`VPL_AGENT_EMAIL`, `VPL_AGENT_PASS`).

The agent is a worker with a shell in a job directory. It is deliberately not
reachable from a browser: a page that could command it would be remote code
execution with a login screen. It *pulls*: the desk writes a row and a folder,
the agent claims the job by writing to it, and the desk polls only while a job is
in flight.

## 8. What has no setting

There is no theme to configure beyond the three in the bar (paper, ink, comic),
no layout switch, no feature flags, no analytics id, no consent banner. The
palette is `packages/shell/tokens.css`: change it there, run
`./tools/stage.sh <app>`, and every app follows — which is also the answer to
"can I rebrand it".
