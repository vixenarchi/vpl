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

## How to ask again

```
./tools/test-all.sh          # 40 groups, incl. the three below
```

- `md-check.mjs` — 27, including the three payloads from VN-1.
- `va-sec.mjs` — 4: an editor cannot queue a job, cannot write `task.md`, can
  still write under `out/`, and the owner can still hand work over.
- `owner-guard.mjs` — 5: an editor may rewrite the words, cannot take the row,
  cannot move it to another document, and the words that were allowed did land.

Still open, and known: `Origin` is not authentication (C7/VP-4 — a non-browser
client can claim any allow-listed origin), there is no CSP (C8), `/fetch` follows
a redirect before re-checking the host (VC-3), and the model key lives in
`localStorage`. Those are the next layer, not this one.
