# vp · keys, codes and the door

At https://vp.terg.hr (production: Pages project `vpl-vp`).

Two halves that share one table:

1. **a key of record** — one model key saved on the account (`vpl_ai`), adopted
   by every app, on every address, in every browser.
2. **codes and the door** — a code is a slip: *N calls, valid until a date*.
   Redeeming it gives a person a key of their own (`vp_…`). Their apps use that
   key against `https://api.terg.hr/vp`, which spends **the issuer's** provider
   key, one credit per call.

The sentence: *one key in your profile; every app spends it; a code you hand out
has calls and an expiry.*

## The tables

```
vpl_ai      user_id, url, model, api_key, updated_at        one row per person
vp_codes    owner_id, code_hash, label, credits, valid_until,
            revoked, redeemed_by, redeemed_at                the slip
vp_keys     code_id, owner_id, holder_id, key_hash, label,
            credits_left, valid_until, calls, revoked,
            last_used_at                                     what a slip becomes
vp_charges  key_id, app, model, in_tokens, out_tokens, ms,
            status, created_at                               the ledger
```

`vpl_ai` is the only table without an app prefix: it is the one thing every app
may read, and nobody else can read any of it.

**Nothing in the database can reprint a code or a key.** Both are stored as
`sha256` hex; the plaintext exists once, in the answer to `vp_make_codes` /
`vp_redeem`, on the screen. Same rule as share links.

## The door

```
POST https://api.terg.hr/vp
Authorization: Bearer vp_…
{ model, messages, max_tokens?, temperature? }
```

- Apps build their endpoint by appending `/v1/chat/completions` to the base
  address they are given, so `/vp/v1/chat/completions` is the same door
  (`apps/api/functions/vp/[[path]].js`).
- The provider's answer is passed back as it arrived, with
  `X-Vpl-Credits` and `X-Vpl-Calls` on the response.
- The model actually used is **the issuer's**, not the caller's guess; the
  `model` in the request is only a name the app shows.
- Only hosts on `ALLOWED` in `apps/api/functions/vp.js` are forwarded to, and
  only origins on `ORIGINS` may call it — both lists live in the one file, and
  the file is short enough to read in a sitting.

Refusals, in sentences a person can act on:

- `401 use a vp key here, not a provider key`
- `403 that key is not one of ours` / `that key was revoked` / `that key is out
  of calls` / `that key expired on 31 Mar 2027`
- `403 the person who made this code has no model key saved`
- `403 the issuer's address … is not one this door forwards to`

## The rules that keep it a drawer and not a billing system

- **One credit = one call**, whatever its size. Tokens are logged for
  information, never priced. A price table would make this an invoice.
- **Spend before the call, settle after.** `vp_spend` locks the key row
  (`for update`), refuses when out of calls, decrements and hands back the
  issuer's key. Two parallel calls cannot both pass when one credit is left.
- **A failed call gives the credit back.** `vp_settle` writes the charge with
  the upstream status; status ≥ 400 refunds one credit. The provider's outage is
  not the holder's fault.
- **The ledger holds metadata only** — app, model, tokens, milliseconds, status.
  No prompt, no answer, no address.
- **Codes are one-time.** A redeemed code says when it was taken and by whom;
  the slip is spent even if the key is later revoked.
- **A person needs an account to redeem**, so the calls are theirs and the
  ledger can show them.

## What this costs in trust, said plainly

`vp_spend` and `vp_settle` are `service_role` only, and the proxy holds the
**service-role key** in `vpl-api`'s environment
(`wrangler pages secret put SUPABASE_SERVICE_KEY --project-name vpl-api`). That
is the largest secret in the suite: it can read every table. The function that
holds it is one file, it does one job, and it never echoes the provider key.

The provider key itself becomes a server-side secret for the duration of the
call. That is the price of the convenience, and it is why stage 1 (a key of
record, no proxy) was built and used first.

## The screen

One page, five cards, no navigation:

- **make codes** — how many, calls each, until when, a label. The slips appear
  once; `copy all` and `print the slips` are there because a slip is a thing you
  hand over. If there is no model key on the account, a warning says so before
  you make codes that would be refused.
- **codes you made** — label, calls, expiry, and whether it is `waiting`,
  `taken 3 Nov 2026` or `revoked`; `revoke` stops a slip before it is used.
- **use a code** — paste it, and the page answers with the address, the model
  and the key, plus **use it in this browser** (writes `vpl.ai` with the door as
  the address, so every app on this origin uses it at once).
- **keys** — everything held or given out: calls left, expiry, calls used,
  `yours` / `given out` / `spent` / `revoked`.
- **what was spent** — the last fifty charges: model, tokens, milliseconds,
  `answered` or `refused 402`.

## Limits

- **50 codes at a time**, at least one call each, expiry can be empty
  ("no expiry") and cannot be in the past.
- **Calls are not parallel-managed**: each key's allowance is enforced per call,
  so two apps using the same key at the same moment simply spend two credits.
- **No streaming, no images**, `max_tokens` capped at 4096 in the door.
- **Codes are for people, not machines**: no API for making codes, no webhooks.

## Tests

```
PORT=8106 OAUTH_PORT=0 ./serve vp
cd apps/vn/test && VP_URL=http://127.0.0.1:8106 node vp-check.mjs   # 33
node vp-proxy.mjs                                                   # 18
```

`vp-check` proves the drawer end to end with two accounts: slips are shown once,
the database holds only hashes, a guest takes a code and gets the door, the door
refuses a provider key (401), a foreign key (403), and answers CORS; revoking is
visible to both sides; a used code and a made-up code each get a sentence.
`vp-proxy` runs the real function with both ends faked, so the success path —
the issuer's model, the credit cap, the ledger row, the refund on 503, the
refusal to forward off-list — is proven without spending anything.

## Not built, and refused on purpose

- credit prices, money, invoices, refunds, reconciliation against provider bills;
- teams, seats, organisations, national scope;
- per-request rate limits beyond the allowance itself;
- key rotation, IP allowlists, usage charts, dashboards;
- a code that can be read again (the slip is the record).

The reason is the same as everywhere in this suite: the moment credits have a
price, vp stops being this app.
