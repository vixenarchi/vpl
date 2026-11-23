# www.terg.hr — the front door

The one page that knows the whole family. It is not an app: no table, no login,
no sharing, no dashboard. Four files of HTML, one stylesheet, one 40-line script,
and the suite's own palette copied in by `tools/stage.sh www`.

- **Deployed:** Pages project **`vpl-www`**, live at
  `https://vpl-www.pages.dev`; custom domain **`www.terg.hr`** attached (status
  *initializing* — it needs the CNAME, see *What is left*).
- **Built:** `/` (what this is, the eight applications with their addresses, the
  six rules, who it is for, what it costs, one address to write to),
  `/faq.html` (ten real questions), `/privacy.html`, `/imprint.html`,
  `/404.html`, `robots.txt`, `sitemap.xml`, `mark.svg`, `_headers`.
- **Not built, on purpose:** the contact form, the blog, RSS. Each one needs
  something that does not exist yet (a mail sender; three posts). The address
  `info@terg.hr` is the honest version of a contact form until then.

## The rules it keeps

- **No third-party anything.** No Google Fonts, no analytics, no tag manager, no
  cookie. The palette uses system fonts; a `Content-Security-Policy` of
  `default-src 'self'` is in `_headers` and the page loads under it, which is a
  test rather than a hope (`www-check.mjs` asserts zero foreign requests).
- **No cookies, one piece of storage.** `localStorage['vpl.theme']`, the same key
  and the same three themes as the suite, so a person who chose *comic* in vi
  gets comic paper here.
- **Claims that are true of the product.** One account, markdown out, one
  credit is one call, nothing a model writes lands in a field on its own. The
  test refuses marketing adjectives that do the work of facts.
- **A floor under every control on a phone** — the same rule as the apps: nav
  links, the footer's eight letters and the theme button are all ≥ 30 px.
- **The imprint marks its own gaps.** Six fields only the owner can fill are
  wrapped in `.fill` and a launch note sits at the top of the page; the suite's
  test fails if either survives into `www.terg.hr`.

## What is left (owner's hands)

1. **DNS** — a CNAME `www` → `vpl-www.pages.dev`, proxied, in the `terg.hr`
   zone; then the hostname stops saying *initializing*. The apex (`terg.hr`)
   should redirect to `www` (a Page Rule or a Redirect Rule).
2. **The imprint's six fields** — company name, address, registration, OIB, VAT,
   and the person responsible. Then delete `#launch-note` and the `.fill` spans.
3. **The contact function**, when there is a mail sender to call: one Pages
   Function, `POST /contact`, no account and no ticket system.
4. **The blog**, when three posts exist. Until then the site says what it is and
   links to what works.

## Tests

```bash
PORT=8108 OAUTH_PORT=0 ./serve www        # then:
node www-check.mjs                        # 37 checks, staged
WWW_URL=https://vpl-www.pages.dev node www-check.mjs   # 37, published
WWW_URL=https://www.terg.hr node www-check.mjs         # flips the imprint check
```

It checks: one `h1` per page, a description and a language, eight app addresses
that are all `https://v*.terg.hr`, the words the product actually keeps, no
cookies, only the theme in storage, the theme surviving a reload, every internal
link resolving (fetched, not assumed), no placeholders on the published imprint,
no sideways scroll on a phone, every link and button hittable at 390×844, no
third-party request, and a quiet console.

## Why it is a folder and not a repo

`apps/www` sits in the same repository as the suite because the palette it uses
is `packages/shell/tokens.css` — copying it by hand in a second repo would drift
within a month. It deploys to its own Pages project with its own domain, so the
freedom the apps have is kept: the site can be replaced, moved or thrown away
without touching a database.
