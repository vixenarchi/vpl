# Going public — the checklist

What has to be true before the door opens, in the order it has to happen. Anything
here that is already done says so; anything that needs a person is marked
**you**.

## 1. One command says the whole thing is green

```bash
./tools/test-all.sh              # local: nine servers, every suite, the ux floor
VPL_PROD=1 ./tools/test-all.sh   # the same suites against the deployments
```

It prints `N passed, M failed` and exits non-zero on any failure. It starts the
local servers it needs and stops them again; the sign-in a suite uses lives in
`~/.config/vpl/test.env`, never in the repo.

What must be green: syntax, chrome in all eight, settings, every app's own suite
(vn, vi, vr, vz, vd, vc, vp, va, and va's canvas and hand-off), the front door
(58 checks) and the ux floor in all nine.

The gate found three real things the day it was written, which is the argument
for having one: `vi` had a 28 px reason field and an unlabelled input, `mode-check`
was reading a port nothing served, and two suites were being run before their
server answered — which reports a `TimeoutError` and reads like a broken app.
`ux-sniff` also learned what a name is (`label[for]`, `aria-labelledby`, `title`)
and that a link inside a sentence is text, not a control.

## 2. Every address exists

- **DNS** — one CNAME per app: `vn`, `vi`, `vr`, `vz`, `vd`, `vc`, `vp`, `va`,
  `www` → `vpl-<app>.pages.dev`, **proxied**; `api` → the proxy's Pages project.
  **you**
- **Hostnames attached** in Cloudflare → Pages → each project. `va` and `www`
  were attached from this machine; the rest were done earlier.
- **Apex** `terg.hr` → `https://www.terg.hr/$1`, 301. **you**
- Check: `for h in vn vi vr vz vd vc vp va www api; do curl -sI https://$h.terg.hr/ | head -1; done`
  must print `HTTP/2 200` (or a redirect that ends at 200) ten times.

## 3. Sign-in works everywhere

Supabase → Authentication → URL Configuration:

- **Site URL** holds exactly one address: `https://vn.terg.hr`.
- **Redirect URLs**: `https://<app>.terg.hr/**` for all eight, plus
  `http://127.0.0.1:81xx/**` for the local ports you use.
- **Confirm email** stays **off**.

Leaving an app's address out of the list does not break the build: it makes
Google sign-in land on `vn` already signed in, which reads as a bug in the app.

## 4. The site can be read by a stranger

- **`www.terg.hr` resolves** and serves the page (see 2).
- **The imprint has no placeholders left.** `apps/www/imprint.html` marks six
  fields with `.fill` and a launch note with `#launch-note`; the site's own test
  fails on `www.terg.hr` while either remains. Replace them, delete the note,
  `./deploy www`. **you**
- **`https://www.terg.hr/og.png`** is a 1200×630 PNG — it is what a shared link
  shows.
- **`/.well-known/security.txt`** has a reachable contact.

## 5. Nothing leaks

- `git status` is clean and `git log -1` is the thing you meant to ship.
- `config.local.js`, `~/.config/vpl/*`, `agent.env` are **not** in git and not in
  a tarball (`./tools/backup.sh` excludes them on purpose, which also means a
  restore needs the keys put back by hand).
- No `service_role` key in any page: `./deploy` refuses one.
- The proxy forwards only to its allowlist (`apps/api/functions/chat.js`), and the
  vp door uses the issuer's model, never the caller's guess.

## 6. The last three steps

1. `./tools/backup.sh` — a bundle and a tarball, named with the time.
2. `git tag -a v1.<n>-public -m "…" && git push --tags`.
3. Open `https://www.terg.hr` in a private window, at 390 px wide, signed out,
   and read it as somebody who has never heard of any of this. That is the only
   test in this list that a machine cannot run.

## Things that are true and are not blockers

- **No contact form.** `info@terg.hr` is the honest version until there is a mail
  sender to call; a form that silently fails is worse than an address.
- **No blog.** Three posts that do not exist yet would be a page with an empty
  month.
- **No analytics.** Which means no numbers on how many people read anything. The
  site says so out loud, in both languages.
- **The apps never link to each other.** Only the site knows all eight; that is
  deliberate, and it is why one app can be replaced without the others noticing.
