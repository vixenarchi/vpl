# www.terg.hr — the front door

**Status, 27 Nov 2026: the page exists and is published** at
<https://vpl-www.pages.dev> — built in another session, and its source now lives
in this repository as `apps/www` (taken over from the deployment, so the page can
be edited and republished from one place: `./deploy www`).

What is still missing is the domain: `terg.hr` and `www.terg.hr` do not resolve,
so every canonical URL on the page points at an address nobody can reach yet.
Attaching the two custom domains to the `vpl-www` project and adding the apex
redirect is the whole remaining step — plus the six imprint fields below.

This is the plan for that page, written so it can be built and published in one
sitting. It is deliberately small: **one page, one stylesheet, no JavaScript, no
third-party anything.**

## What the page is for

One person arriving from a link needs three things in the first screen:

1. **What this is** — a suite of small tools that share one account.
2. **Where to start** — notes is the app a newcomer opens first.
3. **What it costs and what it does not do** — free, no ads, no tracking, no
   cookie banner, data is theirs and exportable.

Everything else is a list of the eight, one line each, with the real addresses.

## Shape

```
header      vpl · vixen productivity light        [ sign in ]  (→ vn.terg.hr)
hero        one sentence + one paragraph, no animation
apps        eight rows: name · what it does in one line · address
how         three short paragraphs: one account / one database / nothing to install
honest      what it does not do (no teams, no realtime, no analytics, no AI
            without your own key)
footer      imprint · privacy · a plain mail address
```

Rules carried over from the apps: **lowercase headings**, a serif for the
display line and a sans for text, colour only as a second signal, nothing
centred that is typed, no image that is not a word.

## Files

```
apps/www/
  index.html      the page
  style.css       its own stylesheet, using the same tokens as the shell
  vendor/tokens.css   copied by tools/stage.sh www (add "www" to its app list)
  imprint.html    the legal page (needs the six fields below)
  privacy.html    what is stored and where — Supabase in the EU, no cookies,
                  no analytics, mail only for confirmations
  _headers        CSP, same policy as the apps, and no beacon
```

**No JavaScript at all** on this page: a marketing page that needs a script to
render is a page that is slower than the product.

## The six fields only the owner can give

A Croatian `.hr` site must show an imprint. Placeholders must not be published.

- full legal name (or "obrt" name) and address
- contact e-mail (and phone if they want one)
- VAT / OIB, or "nije u sustavu PDV-a"
- the person responsible for content
- hosting provider and country (Cloudflare Pages + Supabase, EU region)
- the date the page was last changed

## Publishing

1. `./deploy www` → Pages project **vpl-www** (the deploy script takes any folder
   under `apps/`).
2. Custom domains in the Pages project: `www.terg.hr` **and** `terg.hr`
   (Cloudflare writes the CNAME records itself; the apex is flattened).
3. One redirect rule so there is exactly one canonical address:
   `terg.hr/* → https://www.terg.hr/$1`, **301**.
4. Purge the cache once, then check with a real browser: the page renders with no
   console output, and `documentElement.outerHTML` contains no
   `cloudflareinsights` (the beacon that was switched off on 27 Nov).
5. Add the two new addresses to Supabase *Redirect URLs* only if a confirmation
   mail ever needs to land on the front door — today it lands on `vn.terg.hr`.

## What stays off the page

- No analytics, no cookie banner, no chat widget, no newsletter form.
- No price table: there is no paid tier yet. When there is one, it goes here and
  in `docs/next.md`, not in the footer.
- No screenshots of the apps that will be stale in a week. Words and links.

## Done when

- `curl -s -o /dev/null -w '%{http_code}' https://www.terg.hr/` → **200**
- `curl -sI https://terg.hr/` → **301** to `https://www.terg.hr/`
- a browser on the page logs **nothing** (no CSP refusal, no failed request)
- the eight links go to the eight apps and each answers 200
- the imprint shows real fields, not placeholders
