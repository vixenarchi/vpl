# www.terg.hr — the front door

> **Built (step 1–3 of the order below).** `apps/www`, Pages project `vpl-www`,
> hostname `www.terg.hr` attached. What exists, what it promises and what is
> still the owner's work is in `docs/www.md`.

The suite is four apps and an API, each reachable at its own address and each
knowing nothing about the others. **This is the one page that knows the whole
family.** It is not an app: no table, no login, no sharing, no dashboard. It is
a static site, pushed.

## Why it is separate

An app is a small tool that holds one sentence. The site is a business card, a
blog and a support desk. Mixing them would give the apps a marketing header and
the site a database, and both would get heavier. So: the site lives in its own
repo (or its own folder, its own Pages project `terg-www`), and links out to the
apps. **The apps never link back to siblings from their own screens** — only the
front door does that.

## What it must hold

**The three product lines**, one page each, one paragraph each, no inventory of
logos:

- **vpl** — vixen productivity light: the suite (vn notes, vi idea funnel,
  vr requirements, vz dictionary). Short, with the four addresses and one line
  each, plus *sign in* pointing at `vn.terg.hr` (the suite's Site URL).
- **eva** — evolutionary virtual agents. Whatever it is by then; the site should
  have the page and the paragraph ready, not invented filler.
- **consulting** — what Terg actually does for a client, in the same voice:
  one sentence per promise, no "revolutionary".

**Organization** — who Terg is, where, one paragraph and the legal facts
(company name, address, registration, VAT) on an imprint page. Nothing about
"our values" that a reader cannot check.

**Marketing** — the home page: what this is, who it is for, the three lines, the
one action (open the suite or write to us). Copy in the suite's voice: short
sentences, no adjectives doing the work of facts.

**Support** — an FAQ built from real questions (how do I share a note, can I use
it on a phone, what happens to my data), and a **contact form**. The form posts
to one small function that sends an e-mail; no ticket system, no account, no
status board. An answer to a person is a reply, not a case number.

**Blog** — dated posts, markdown files in `content/blog/`, no comments, no CMS,
no admin screen. One RSS file.

**News** — short dated entries (a new app, a release), the same shape as a blog
post but shorter; they can share the same index.

## How it is built (same spirit as the apps)

- **Static, push only.** `./deploy` stages and uploads to Cloudflare Pages; a
  post is a markdown file and a push. Nothing runs at request time except the
  one contact function.
- **No framework, no bundler.** A ~60-line script turns `content/*.md` into
  pages (or the posts are written as HTML directly — decide when the first three
  posts exist, not before).
- **The same shell.** `packages/shell/tokens.css` copied in, so the site and the
  apps are visibly one family: paper, ink, one accent, serif for headings,
  monospace for addresses and dates.
- **Zero euro**: Pages free tier, one project, one domain (`www.terg.hr`, apex
  redirects to it).

## Boundary (write it on the wall)

- no database, no login, no cookies beyond nothing
- no analytics that need a consent banner; if numbers are needed, a log line
- the contact form is the only thing that writes anywhere, and it writes an
  e-mail
- the site describes the apps; it does not embed them, proxy them or count them

## Order of work, when we get to it

1. one page: what Terg is, the three lines, four app addresses, contact
2. imprint + privacy (short, true)
3. the FAQ from real questions, then the contact function
4. the blog with three posts in hand, then RSS

Until then, the addresses are the front door.
