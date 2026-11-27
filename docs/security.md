# security — what crossed a line, and what now holds it

A review of the suite at `7677b63` produced 4 high, 9 medium, 9 low and 6
informational findings (`~/vixen/sec-report-*.md`). This file records what was
changed, why in that shape, and how to ask the same questions again after a
change. It is not the review; it is the answers.

## The four that crossed a line

**VP-1 · a holder could mint credits.** RLS is a permission on a *row*, not on a
column: `vp_keys_revoke` let the holder `UPDATE` their own row, and the only
constraint on `credits_left` was `>= 0`. One request set it to 100 000 and spent
somebody else's provider key without limit; the same request could rewrite
`owner_id` and put the bill on a third person.

- `revoke update on vp_keys, vp_codes from authenticated`.
- The one write left is a function: `vp_revoke_key(id)`, `vp_revoke_code(id)` —
  checks the row, throws one switch, returns nothing.
- `vp_keys_guard` / `vp_codes_guard` triggers refuse any change to credits,
  owner, expiry, hash or the call count. A trigger, because a policy cannot say
  "this column", and because the rule must survive a future grant.
- Reading is trimmed to the columns a holder needs: `owner_id` and `key_hash` are
  gone (VP-2). A redemption is the one forward step and the guard allows exactly
  that (from nobody to somebody, once).

**VA-1 · a shared editor could start a machine.** `va_jobs_add` let anyone with
the project's `edit` grant queue a job. A job is not a paragraph: the worker
hands its `task.md` to `pi`, which has tools and used to inherit the worker's
whole environment — including the agent account's email and password.

- Only the desk's owner hands work to an agent (`va_jobs_add` → `va_is_owner`).
  An editor writes text; a job runs code. If that should ever change, it is a
  separate, named switch.
- Inside a job folder, only `out/` is writable by whoever works the job; the
  `task.md` and `inputs/` are the owner's words (restrictive storage policies).
- The prompt puts the desk's words in `<<< JOB DATA … JOB DATA >>>` and says
  plainly that it is data: no line in it can ask for a command, a file outside
  the job, or an environment variable.
- The child process gets an allow-list of environment variables, never a spread.

**VN-2 · codes were a table.** `vn_shares` answered `anon` with every row that
carried a code. A capability that can be listed is not a capability.

- The policy is gone; `anon` reads nothing from `vn_shares`.
- `vn_link_info(code)` (security definer) answers which root one code opens, the
  way the other seven apps already did it.

**VN-1 · the writing surface could run code.** `lib/editor.js` pasted a markdown
address straight into `href` and did not escape quotes, so
`[x](" autofocus onfocus="alert(1)" x=")` became attributes that fired on open —
in the origin that holds the model key and the session.

- Quotes are escaped; only `https:`, `http:` and `mailto:` survive as links.
- The editable surface is cleaned through DOMPurify (`safeEditorHtml`), primed at
  boot so no call site can forget to await it.

## The relay, and the header

Two findings were "low" and both were about the same thing: the suite trusted a
thing a caller can write.

**C7/VP-4 · `Origin` is not authentication.** The doors answered the origin list
and nothing else, so any program could send `Origin: https://vn.terg.hr` and use
`api.terg.hr` as its own proxy. The tempting fix — a timestamp plus an HMAC
minted by the page — is theatre: the secret would be in the page, and the page is
public. What a relay with no server can honestly do is **bound** what it gives
away, so that is what the doors do now:

- `_door.js` — every door refuses before it reads a body: not a POST (405), no
  `Origin` at all (403: a door is for pages, and a page always has one), not
  `application/json` (415), over the route's cap (413). One file, so the four
  doors cannot drift; `vp` used to accept a megabyte of JSON and a form post.
- `_limit.js` — sixty calls a minute per address and route (`/search` 20,
  `/chat` and `/vp` 60, `/fetch` 30), counted in the edge cache. Per-colo and
  eventually consistent: a speed bump on abuse, not a quota anybody is billed
  for. It is written down as a speed bump, not as a lock.
- `_middleware.js` — the count happens once, at the edge, for all four doors, and
  **every door answer carries it**: `X-Vpl-Limit: 1/60`, or `unbounded` when the
  edge has no cache or no address to count. A limit nobody can see is not
  evidence; this one can be read from a terminal. Measured on the live project:
  33 calls to `/fetch` from one address → 30 answers, then `429` with
  `retry-after: 60`, and a `/chat` call reporting `1/60`.
- Nothing secret lives behind a door: the key is the caller's own, and a `vp`
  credit is spent before the provider is called. The worst a relay can do is
  spend the caller's own quota.

Found while testing that: the origin list's dotted entries (`'.vpl-vi.pages.dev'`)
matched `abc.vpl-vi.pages.dev` but **not** the stable `vpl-vi.pages.dev`, so the
suite's own Pages addresses were refused by the doors. `vpl.pages.dev` (vn's
oldest address) worked only because it is listed with the full name. One line in
`corsFor`, one assertion in `door-check`.

**C8 · there was no CSP, and the key is in `localStorage`.** Every app carried
`Cache-Control` and `nosniff` and nothing else, so any XSS in any app was not a
stolen paragraph — it was the model key and the session. All eight now send the
same policy (`apps/<app>/_headers`), and `serve.py` sends it too, so the local
suite tests the page that is deployed:

- `script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net` — the four
  libraries and nothing else; no `'unsafe-inline'`, no `'unsafe-eval'`.
- `style-src` allows `'unsafe-inline'` for five `style="--x:9%"` attributes in
  vi's funnel drawing. Style injection is not script execution, and that is the
  only reason it is there.
- `connect-src` names Supabase, the door and the CDN; `worker-src` the pdf worker;
  `object-src`, `base-uri`, `frame-ancestors`, `form-action` are closed.

The first thing the policy refused was the app's own theme boot: a four-line
inline `<script>` in each of the eight `index.html`. It is now
`packages/shell/theme.js` (a copy in every `vendor/`), loaded blocking before the
stylesheet — one file instead of eight copies and eight hashes, and the flash of
the wrong theme is still gone.

One thing it found that is not in this repository: the edge was injecting
Cloudflare's Web Analytics beacon (`static.cloudflareinsights.com`, token
`7adefc77…`) into every `*.terg.hr` page. It was not installed by anybody here —
Cloudflare began adding it by default to proxied zones on its free plan, which is
why nothing in the zone's own settings mentioned it.

**Closed on 27 Nov 2026.** The beacon is off at the account, not in the zone:
*Analytics → Web Analytics → `terg.hr` → Manage site → Advanced options → JS
snippet injection → Disable*, then *Caching → Purge Everything* for the pages
already cached with the tag. Verified on all eight hostnames: no request to
`cloudflareinsights`, nothing in the served HTML.

The policy stays as it was. A switch somebody can flip back is not a guarantee,
so the next automatic re-enable is still refused — and `csp-check` now prints
`EDGE INJECTS … AGAIN` in its output rather than a quiet note, so it cannot come
back unnoticed.

`csp-check.mjs` proves the policy is *usable*, not merely present: it walks all
eight — sign in, open, settings, theme, then imports pdf.js and starts its worker
— and counts the browser's own "Refused to…" lines. **Zero**, in all eight, 128
assertions. `door-check.mjs` proves the four refusals and the bound with 26, no
network at all.

## The systematic one

**C2 · a row could change hands.** Six apps had `with check (share_role(id) =
'edit')` — a rule about an *id*, not about a person. A shared editor sent
`user_id` along with an ordinary edit; the check re-read the grant from the row's
unchanged `project_id` and passed, and the row now belonged to them.

- One trigger for the whole suite, `vpl_owner_is_not_a_field`, attached by schema
  walk so a table added later is covered without being remembered. `user_id`,
  `owner_id`, `project_id`, `note_id`, `sheet_id`, `standard_id` are not editable
  fields.

## Two smaller ones, same shape

- **VN-3** — a name and a joining date are shown only for an address already on a
  share of mine; anybody else gets "this address has an account".
- **VR-1** — themes and vocabulary follow a grant on the document, not the
  existence of somebody else's code.

## Two lessons worth keeping

**A policy that reads a column the caller may not read fails closed — as 403.**
Trimming `owner_id` from the holder's grant silently broke `vp_charges_read`,
whose `using` expression selected that column. The ledger stopped answering for
everyone. The rule was right; the way it was written depended on a column nobody
should be able to read. It is now one function, `vp_can_see_key(key)`.

**A guard must name the write it permits.** `vp_codes_guard` refused every update
by a person, which is correct for credits and wrong for redeeming: `vp_redeem`
stamps `redeemed_by` as the caller, so the button stopped working and the failure
looked like a broken app. The guard now allows exactly the one forward step.


## 2026-11-26 · the other laptop's seven, and what they were all about

A second agent, a second machine (Windows), a different model, and no access to
this repository — only the deployed apps and the public REST API. It was given
one ordinary job: make a project, add a row, share it with an address, and see
what a guest can do. It found seven things, and five of them are the same
mistake in different tables.

**The mistake.** A policy asked the wrong question. `*_shares` asked "is this
row's `owner_id` you?" — a column the client sends — so a guest could name
itself the owner of a grant on somebody else's project and hand out `edit`.
`vr_themes`, `vd_artifacts`, `vc_artifacts` and `va_artifacts` asked "may you
edit this project?" on a `delete`, so an editor could destroy the owner's rows
for good. `vi_ideas` asked for *read* on an insert. Row read policies asked only
"is this row yours?", so a row a guest wrote was invisible to the project's
owner — the data was in their document and they could never see it.

That last one is the sharpest lesson of the batch: **a share is a permission on a
document, not on the rows you happen to have written.** The read rule has to name
the project's owner or the guest's work disappears into the owner's own file.

**The seven, and what closed them** (`20261224000000_the_other_laptops_findings`):

- **BUG-1** a guest minted a share, with `edit`, for a third party → the insert
  now requires `owner_id = auth.uid()` *and* the project being yours (vn's clause
  since the first migration, copied to the six).
- **BUG-2** an editor binned the owner's project and rows → `vpl_bin_is_the_owners()`,
  a trigger on every table with `deleted_at`, because a policy cannot say "this
  column only".
- **BUG-3** an editor destroyed rows for good in five tables → one delete rule:
  your own row, or the owner of the project.
- **BUG-4** a `view` guest inserted an idea → insert asks for `edit`, everywhere.
- **BUG-5** a guest's row was invisible to the owner → read asks for the project's
  owner as well as the caller.
- **BUG-6** a guest re-parented and re-ordered somebody else's note → `parent_id`
  and `position` are the owner's (`vn_structure_is_the_owners`).
- **BUG-7** an editor wrote a compliance verdict with no run behind it → the three
  counts follow a run: `vc_a_verdict_comes_from_a_run`.

Two more, found the same way and closed in the same file because the clause was
the same shape: `vr_themes` and `vr_vocab` let **anybody with an account** read
the table if *somebody else* held a link code for that document (`s.code is not
null`, with no reference to the caller). A code is a read for the person holding
it, not for the internet.

**What the rewrite taught, in order.**

1. **Policies are OR'd, so a fix that only adds a policy adds nothing.** The
   migration drops every policy on the eighteen tables first, then puts back four
   per table. A narrower rule underneath a wide one is invisible until somebody
   uses the wide one.
2. **A trigger is where a column rule lives.** `deleted_at` and the verdict counts
   are not rows' shapes, they are decisions, and RLS cannot see a column.
3. **A change that closes a hole can lock out a colleague.** Putting `va_jobs`
   update back to "your own row or the owner's" locked the worker out of claiming
   a job — `va-handoff.mjs` caught it in one run, and the fix was to go back to
   `va_can_edit` (which is what a share means there) and let `va_jobs_guard` be
   the limit. **The gate is what tells you which of your two rules is wrong.**
4. **A fix in the database has to land on the screen too.** `va_jobs` insert is
   owner-only, so `apps/va` no longer shows a guest a generate button the database
   would refuse, and says *the owner starts a job here* instead.
5. **An independent agent with no access to the source is the best audit there
   is.** It cannot be talked into believing a comment.

The two scripts now live in the gate: `authz-matrix.mjs` (the grid: six apps,
`view` then `edit`, plus a third account that must see nothing) and
`authz-confirm.mjs` (one proof per finding, so a regression names itself). Both
exit 78 without their three accounts — a skip is not a pass. After the
migration: **none in this matrix**, and all seven shut, while `share-check` 23,
`vc-check` 41, `vc-batch` 53, `vr-check` 59, `vi-check` 20, `vz-check` 53,
`vd-check` 47, `va-check` 47, `va-handoff` 21 and `va-sec` 4 all still pass.

## How to ask again

```
./tools/test-all.sh          # 53 groups, incl. the eight below
```

The authorization grid needs **three accounts** on the project — an owner, a
guest it shares with, and a third party nobody invited — because two cannot tell
"the owner's editor" from "a stranger". Defaults are the throwaway accounts the
other laptop made: `xxx123@vpl.local`, `yyy123@vpl.local`, `zzz123@vpl.local`,
password = the name. Override with `AUTHZ_OWNER` / `AUTHZ_GUEST` / `AUTHZ_THIRD`
(and `_PASS`). Without them the groups exit 78 and the run is **not** green.

- `md-check.mjs` — 27, including the three payloads from VN-1.
- `va-sec.mjs` — 4: an editor cannot queue a job, cannot write `task.md`, can
  still write under `out/`, and the owner can still hand work over.
- `owner-guard.mjs` — 5: an editor may rewrite the words, cannot take the row,
  cannot move it to another document, and the words that were allowed did land.
- `authz-matrix.mjs` — the whole grid, six apps × two roles × a stranger.
- `authz-confirm.mjs` — 18 proofs, one per finding in §2026-11-26.
- `door-check.mjs` — 26: the four refusals, the bound, the origin list. The
  count's arithmetic is proved here with a fake cache; the live behaviour is
  proved by the `X-Vpl-Limit` header.
- `csp-check.mjs` — 128: the header in all eight, and a browser walk under it.
- `fetch-check.mjs` — 15: the redirect walk, with a recorded `fetch` and no network.

**VC-3 · `/fetch` fetched the redirect target before checking it.** One allowed
source could name any host — an address inside a network is the interesting one —
and the request had already been made; the body was never returned, but "did that
address answer" is a fact worth having. The door now walks redirects itself
(`redirect: 'manual'`), checking the protocol and the host of each hop *before*
fetching it, with three hops as the limit. Proved by `fetch-check.mjs`, which
replaces `fetch` with a recorder: an off-list redirect is refused **and never
fetched**, an http: redirect is refused, a chain of on-list hops is followed in
order, a loop stops, and 3 MB is still a sentence. VC-4 (no request cap, no rate
limit on `/fetch`) was closed by `_door.js` and `_limit.js` earlier in this
section.

Still open, and known: the model key lives in `localStorage` — CSP is the second
line there, not the first. The relay is bounded rather than authenticated (C7/VP-4), which is
the honest shape for a proxy with no server behind it.
