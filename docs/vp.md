# vp · keys, codes and the door

Not built. This is the design, written before the code, so the week it is built
does not invent a second design.

## The sentence

*"One key in your profile; every app spends it; a code you hand out has credits
and an expiry."*

Two halves, and they are different sizes:

1. **A key of record, per person.** Today a model key is pasted into every
   browser, on every address: five apps, two browsers, three accounts. It should
   be pasted **once**, and follow the account.
2. **Codes with validity and credits** — the telecom top-up slip: a short code,
   N credits, valid until a date. Redeem it once and your calls spend it. This
   is for handing access to somebody else (a client, a colleague, a demo)
   without handing over a provider key.

## Stage 1 — a key of record (no new secret, no new server)

```
vpl_ai
  user_id uuid primary key references auth.users,
  url text, model text, key text,        -- the person's own key
  updated_at timestamptz
```

- RLS: `user_id = auth.uid()`, select/insert/update own. No shares, no
  service-role reader.
- Every app's settings dialog gains one sentence: **"use my vpl key"** when
  signed in (it fetches the row and copies it into this browser's
  `localStorage['vpl.ai']`), and the old **"paste a key for this browser"**
  stays as the fallback. The apps do not change otherwise: the call still
  leaves from the browser, the key still goes only to the provider.
- What this buys: one paste per account instead of one per address per browser.
  What it costs: the key now sits in the database, protected by RLS and a
  password — the same trust as the notes themselves. Nothing else changes.
- What it does **not** buy: no proxy, no credits, no logging, no codes. It is a
  drawer, not a service.

## Stage 2 — codes, credits and the proxy (the actual vp)

This is the part that needs a secret and a ledger.

```
vp_codes
  id, owner_id, code_hash, label, credits int, valid_until date,
  max_calls int, models text[], revoked bool, redeemed_by uuid, redeemed_at,
  created_at

vp_keys                      -- what a redeemed code becomes: a key to use
  id, owner_id, code_id, label, key_hash, credits_left, valid_until,
  models text[], calls int, created_at, last_used_at

vp_charges                   -- one row per proxied call: the ledger
  id, key_id, app text, model text, in_tokens int, out_tokens int,
  ms int, status int, created_at
```

- **The code is shown once, stored hashed.** Same rule as share links: the
  person prints the slip; the database cannot reprint it.
- **The ledger is a Postgres function, not app logic.** `vp_charge(key, ...)`
  checks `credits_left > 0` and `valid_until >= today` under `for update`, then
  decrements and inserts the charge. Two calls at once cannot both pass when
  one credit is left.
- **The proxy reads the key by hash and injects the provider key.** The caller
  sends `vp_...`, the function looks up the row, finds the owner's `vpl_ai` row,
  and calls the provider. The provider key never reaches the browser of the
  person who redeemed a code.
- **Filter, before spending:** model allowlist on the key, a per-call output cap,
  no streaming, no images, and a per-key daily call cap. A shared key that can
  do everything is an open relay with a bill.
- **Logging is metadata only.** App, model, tokens, milliseconds, status. No
  prompt text, no answer text, no IP. A user's screen answers "where did my
  credits go", not "what did they ask".
- **Price per model is a table, not a guess.** Tokens × price per model, rounded
  up to the credit. A model that is not in the table cannot be spent.

## What changes in trust (say it out loud)

- Stage 2 needs the **service-role key** in the Pages environment of `api`: the
  proxy must read `vpl_ai` to spend somebody's key. That is the largest secret
  the suite has ever held. The function that holds it must stay small enough to
  read in one sitting, and everything else keeps using the anon key.
- The person's provider key becomes a **server-side secret**. RLS protects it
  from other users; it does not protect it from us. That is a real change from
  "the key never leaves your browser", and the settings dialog must say so in
  the same sentence that offers the convenience.
- Codes make us a **billing surface** the day credits have a price. They do not
  have one here: credits are units of a key's allowance, not money. If money
  ever enters, vp stops being this app.

## Refusals

- No teams, no organisation seats, no invoicing, no tax, no refunds.
- No per-request billing reconciliation, no provider webhooks, no cost
  dashboards. The ledger is a list; the number at the top is the remainder.
- No key rotation, no scopes beyond "which models", no IP allowlists.
- No UI for the codes beyond: generate N, show them once, print the slip,
  revoke. A redeemed code is visible as a line in the owner's list.

## The screen (one page, three rows)

- **your key** — url, model, key, saved once; "saved" is a sentence, not a
  toast.
- **codes** — `make 5 codes · 100 calls · until 31.12.`, a list with the label,
  the remainder and the expiry; `print` prints the slips.
- **activity** — the last 50 charges: when, which app, which model, how many
  credits, ok or not.

## Order

Stage 1 is an afternoon and can ship before `va`. Stage 2 is a week and should
not ship before stage 1 has been used for a while — the first week of use tells
you whether codes are for other people or only for you, and if it is only for
you, stage 2 is a very expensive way to avoid one paste.

## When it is built

`vp.terg.hr` (static, one screen, one table set), plus `api.terg.hr/vp` as the
door. Tables `vpl_ai`, `vp_codes`, `vp_keys`, `vp_charges` — the shared `vpl_`
prefix is deliberate: this is the one thing every app may read.
