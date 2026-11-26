# vpl v2

A clean rebuild of **vixen productivity light** against `vpl-specification.md`
(the untruncated one, R1–R17).

The `doc/` originals were left untouched. v2 is a reset, not a patch.

## Why this exists

v1 drifted off its own constitution. The specification says *one table, seven
meaningful columns, `stage` is an enum*, and warns in §8 that the funnel would
become "a kanban board with no decisions" — a gate moved without a reason.

v1 did exactly that:

| specification §4.1 | what v1 shipped |
|---|---|
| one `stage text check (in ('none','inbox','explore','build'))` | `stage` check **dropped** (`20261113000400_vpl_stage_free.sql`) |
| seven columns | plus `kind`, `position`, `stages jsonb` (a tree, data-driven funnels) |
| `gate_note` is mandatory in spirit (§7) | nothing enforced it; production had funnel rows with a null reason |

v2 puts the table back and makes the gate a database constraint, so the method
cannot be skipped by a client bug.

## What is different from v1

1. **The gate was a CHECK constraint**, not a UI nicety: `stage <> 'none'`
   required a non-empty `gate_note` and Postgres refused the update. That
   proved the method worked at the database level — and then the funnel was
   removed anyway, because it was not needed yet. See item 7.
2. **No tree.** No `parent_id` drag-and-drop, no `position`. `parent_id` stays
   because §4.1 lists it, unused, for a future "attach discussion".
3. **No `stages jsonb`.** A funnel could not grow a fourth stage without a
   second table — which §3.3 forbids. Moot now that the funnel is gone.
4. **Routing intent travels in state.** v1's bug (and v2's first bug): setting
   `location.hash` fires `hashchange` later, so calling `setMode(EDIT)` before
   it is undone by `openNote()`. `S.freshId` carries the intent instead.
5. **Saves are queued, not dropped.** v1's `flush()` returned early while a
   save was in flight, silently losing the last keystrokes. Now `saveAgain`
   schedules a follow-up round.
6. **Not a PWA.** The service worker and manifest are gone. See below.
7. **No funnel.** `stage`, `gate_note` and the gate CHECK are dropped
   (`migrations/0002_*`). Notes are notes. R13–R17 are withdrawn for now.
8. **Delete is a status, not a removal.** `deleted_at` null = live. The
   recycle bin sits at the bottom-left of the list, deleting is one click
   with no "are you sure?" dialog, and a binned note is read-only until
   restored. Rows are never actually destroyed by the app. Dragging a note
   onto the bin puts it there; dragging one out (while the bin is open)
   brings it back, under the parent it remembers.

## Sharing

Two kinds of grant, one table (`vn_shares`, then named `note_shares`), enforced by Postgres:

| grant | who can open it | can they write |
|---|---|---|
| **public link** | anyone on the internet, no account | no |
| **person · can view** | that account, by email | no |
| **person · can edit** | that account, by email | yes, content only |
| **person · waiting** | nobody, until the owner allows it | nothing at all |

A grant names a note and covers **everything under it**, so one link shares a
whole chapter of a knowledge tree (Project management → Waterfall, Agile →
Kanban, Scrum). The public URL is `#/s/<code>`; a chapter inside it gets its own
address, `#/s/<code>/<note id>`, so a single section can be sent to someone.

- The code is minted by the database, never by the client, and switching the
  link off deletes the grant — the URL stops working immediately.
- `#/s/...` opens without an account: a small read-only reader, no list, no
  editor. The database decides which rows it may see; the page only draws them.
- A public subtree is readable by everyone, including signed-in accounts, but it
  does not appear in their list. The list holds what you own plus what was
  shared with *you* by email. Public chapters stay reachable by their link.
- Your own notes carry a badge in the list (`public`, or `shared` when only
  people have it), so a link you forgot about is visible without opening the
  dialog. `new link` replaces a link that leaked: the old URL dies at once.
- A grant for an address **with no account waits** (`0012`): it is stored, the
  owner sees it, and it grants absolutely nothing until allowed by hand — and
  allowing it is refused while the address still has no account. That is what
  makes inviting a friend who has not signed up yet both possible and safe
  (`0008` closed the plain "type an address and wait" hole; this is the version
  without the friction).
- `copy a message` puts a short note on the clipboard: the title, the link if
  there is one, and how to sign in if a person was named. The app sends no mail,
  so this is the whole notification story.
- A link and a person are two answers to the same question, side by side in the
  dialog: a link needs no address and dies with one click, a person is the one
  you can take back per note.
- The colour of the stripe in the list is the same answer as the header of the
  note: red = a public link, green = someone may edit, blue = someone may only
  read. One colour language, so the two can never disagree.
- An edit grant may change content. It may **not** delete or restore a note
  (`notes_only_owner_bins`, a BEFORE trigger, because RLS cannot see OLD), and
  it may not change ownership (column privileges exclude `user_id`).

This is the first feature that earns a second table. §4.1 says "no second table"
and that still holds for notes: what is shared is a subtree, and a per-row grant
addressed to an email cannot live in a column. §3.3 lists "sharing, permissions"
as deliberately absent; this is the exception it was waiting for — no teams, no
roles, no orgs, no admin. One link or one address at a time.

## Why email confirmation stays off

Supabase can require a click on a link in the mail before an account works, and
this project does not. Deliberate: it is a private notebook, and a person should
be able to sign up as `marko_peric_projekt` / `sifra123` in ten seconds. The
cost is that the app can never prove an address belongs to whoever registered
it — so sharing *by address* means trusting whoever got there first.

Three cheap things keep that honest instead:

- **a waiting invitation** (`0012`): an address with no account grants nothing
  until the owner allows it, and the database refuses the allowance while the
  address still has no account;
- **a hint** (`0013`): before a grant is made, the dialog shows the name on that
  account and how old it is — a minute-old account claiming a friend's address
  is visible at a glance, and the owner decides;
- **a link**, in the same dialog, needs no address at all: it is the flexible
  path, and it is revocable in one click. The reader can copy a link to the
  chapter it is showing.

If confirmation is ever turned on, `signUp` returns a user and no session and
the app already says *"almost — a link is on its way to … click it, then sign in
here."* The test suites sign up programmatically, so a project with it on makes
them unable to sign in.

## Signing in

The field takes an email **or a name**. Supabase authenticates with an address,
so a bare name is stored as `<name>@vpl.local` — a domain that cannot receive
mail, on purpose: it makes it obvious that such an account has no way back. The
hint under the field says so plainly: *any name will do — an email is only needed
to get a forgotten password back.* The eye button shows the password while
typing, and the boxes share the corner radius of the buttons beneath them.

The whole sign-in sits in one card: a border, a radius and a soft shadow, so a
blank page has an edge instead of floating fields. Two labels, two fields, two
buttons and the Google line fit in about 430 px, which leaves the form visible
and centred even on a 667 px tall phone screen.

### Google sign-in needs one dashboard setting

The **continue with Google** button is wired, but Google has to be told where to
send the person back, and that is the project's *Site URL*. On this project it is
still the scaffold value `http://127.0.0.1:8788`, so the round trip ends on a
refused connection to `127.0.0.1` — the app never sees it and cannot apologise.

To make it work, in the dashboard:
`Authentication → URL Configuration` → **Site URL** = the address the app is
served from (`http://192.168.178.29:8099`), and add the same address under
**Redirect URLs** as `http://192.168.178.29:8099/**`. Until then, signing in with
a gmail address and a password works immediately: email confirmation is off.

A failed sign-in that *does* come back now arrives with `?error=…`, and the gate
reads it out in plain words instead of leaving a blank form.

Until the dashboard is changed, `./serve` also answers on **127.0.0.1:8788**, the
address the project still returns to, so the Google round trip lands on the app
instead of a refused connection. Open the app at `http://127.0.0.1:8788` when you
want to sign in with Google; on any other address it keeps falling back to the
Site URL. That second listener goes away with `OAUTH_PORT=0` once the real Site
URL is set.

## The box, instead of only code

The toolbar used to offer a code block and nothing else, so a paragraph pasted
from a screen became code. There is now `▭`: a generic container that holds
anything — prose, a list, a quote. It is stored as a fenced `::: box` … `:::`
block, so it stays plain markdown (and reads as text in any other editor); nest
counting means an inner box cannot close the outer one. `‹›` is still there for
real code.

## The assistant line

One pill **in the top bar**, centred in the empty stretch between the name and
the `+`. It used to own a row of its own above the note, which cost a band of
whitespace on every screen and pulled the eye away from the text. The pill shows
only when the note is writable, so a read-only note has no assistant at all.

On a phone the bar has no room for a readable field — an iPhone 8 leaves it
eighty pixels wide — so below 416 px the bar keeps a single ✎ and the assistant
opens as a **strip under the bar**, the full width, with the same input and the
same answer card below it. Escape, a tap outside, or the ✎ again closes it, and
the note switching to read-only takes it away.

It sends the open note and one instruction to an OpenAI-compatible endpoint and
shows the answer as text, hanging out of the bar over the note; nothing touches
the note until **add at the end** or **replace the note** is pressed. Escape or a
click anywhere else puts the answer away. It has no rights of its own: the model
only ever returns text, and the app — not the model — decides what happens to it.

The endpoint, model and key live in this browser (`localStorage`, key
`vpl.ai`), never on a server, because there is no server. A key typed there is
only sent to the address you name. A pasted base URL is accepted as well as the
full `/chat/completions` one.

## Deleting an account

The dialog has three ways out — a ✕ in its corner, **cancel** and **done** — all
of which just close it; saving is the separate `save` next to each field. It
scrolls inside itself instead of growing past the screen, and the two bottom
buttons stay pinned while it does.

Settings → **delete my account**. It says how many notes and links would go,
and then asks for the word `delete` to be typed. It calls
`delete_my_account()` in the database, which reads the caller from the JWT: it
deletes the caller's notes, the grants they handed out, the grants addressed to
them and finally the account itself. There is no backup, so it says so.

## Not a PWA, on purpose

The specification lists `sw.js` and `manifest.webmanifest` under §4.4, and v2
shipped both. They were removed after causing real failures:

- a **cache-first** worker from v1 kept serving v1 over the new app, so the
  console showed `column notes.position does not exist` — from code that no
  longer existed on the server;
- workers are **sticky**: registered once, they survive deploys and keep
  controlling the page no matter which port you open;
- §4.4 is a file layout, not a requirement. §0 says anything that costs
  lightness is a proposal, and §3.3 already refuses offline editing and
  mobile apps. Caching bought nothing here and cost a day of confusion.

vpl is now a plain web application: HTML, CSS, ES modules, one CDN for
supabase-js / marked / DOMPurify, and no local cache of any kind.
Every load goes to the network. Only the Supabase session persists, in
localStorage, because that is what keeps you signed in (R1).

`sw.js` was a **kill switch**: a browser still holding the old worker fetched
it, which deleted every cache and unregistered itself. It has now been
deleted, since no browser holds the old worker any more.

## Files

```
v2/
├── index.html              one page, hash routing, no router library
├── app.js                  all behaviour, no framework
├── style.css               one stylesheet, CSS variables
├── lib/
│   ├── supabase.js         one client, thin wrapper: list/get/create/update/remove
│   └── markdown.js         marked + DOMPurify, mermaid via dynamic import()
├── icons/v.svg
├── sw.js                   kill switch only, see "Not a PWA" below
├── serve.py                static server that says no-store, see "Running it"
├── deploy                  publishes the seven files a browser needs
├── _headers                the same no-store for the host that serves it
├── migrations/
│   ├── 0001_v2_reset.sql   returns the table to §4.1 and enforces §7
│   ├── 0002_v2_no_funnel_trash.sql  no funnel; delete becomes a status
│   ├── 0003_v2_tree.sql    parent_id + position, cycle-safe FK
│   ├── 0004_v2_sharing.sql note_shares, grants, RLS, column privileges
│   ├── 0005_v2_share_code.sql  the code is minted by a trigger
│   ├── 0006_v2_share_role_order.sql  your grant beats the public link
│   ├── 0007_v2_owner_bins.sql  an editor cannot delete your note
│   ├── 0008_v2_known_people.sql  share only with an account that exists;
│   │                             delete_my_account()
│   ├── 0009_v2_cleanup_test_accounts.sql  removes my own test accounts
│   ├── 0010_v2_drop_my_screenshot_note.sql one leftover row, by id
│   ├── 0011_v2_purge_test_accounts.sql  purge_test_accounts(), repeatable
│   ├── 0012_v2_waiting_invitations.sql  a grant may wait for its person
│   ├── 0013_v2_account_hint.sql  name and age of the account behind an address
│   └── 0014_v2_purge_notes.sql  the bin can be emptied, and only the bin
├── test/
│   ├── e2e.mjs             24 checks against a real Supabase project
│   ├── r2-check.mjs        proves the Google provider answers
│   ├── schema-check.mjs    proves RLS, the soft delete, and no funnel columns
│   ├── plain.mjs           proves no worker and no cache survives a load
│   ├── tree-check.mjs      tree, rich editor and keys, in a real browser
│   ├── dnd-check.mjs       drag and drop: nesting, order, and the bin
│   ├── share-check.mjs     a link, a viewer, an editor, a stranger
│   └── shots.mjs           screenshots of the three surfaces
├── config.example.js       copy to config.local.js
└── vpl-specification.md    the full spec, restored
```

No build step. Files are served as written.

## Running it

```bash
cp config.example.js config.local.js   # fill url + anon key
# then serve the directory with any static server, e.g.
python3 -m http.server 8080
```

`config.local.js` is git-ignored. The anon key is public by design; RLS is the
lock (§6.3).

## Tests

```bash
cd test && npm install
node e2e.mjs            # 25 checks: R1-R11 against a real project
node tree-check.mjs     # 12 checks: the tree, the editor, the keys
node dnd-check.mjs      # 24 checks: drag and drop with a mouse, including the bin
node touch-check.mjs    # 9 checks: the same moving with a finger on a phone
node share-check.mjs    # 20 checks: public link, people, permissions
node schema-check.mjs   # 6 checks: RLS and the soft delete
```

Every suite signs up a throwaway account and deletes it at the end, so a run
leaves the project as it found it. `purge_test_accounts()` (migration 0011) is
the broom for accounts a crash left behind: `select public.purge_test_accounts();`
in a one-line migration.

## Applying the migration

v2's migrations are kept here so they never collide with the tracked
`supabase/migrations/` history. They are copied in under the versions they were
already applied as, pushed, and removed again:

They are **symlinked**, not copied, so exactly one copy of each exists and the
link keeps working for every later push:

```bash
cd supabase/migrations
ln -sfn ../../v2/migrations/0004_v2_sharing.sql          20261116001000_vpl_sharing.sql
ln -sfn ../../v2/migrations/0005_v2_share_code.sql       20261116002000_vpl_share_code.sql
ln -sfn ../../v2/migrations/0006_v2_share_role_order.sql 20261116003000_vpl_share_role_order.sql
ln -sfn ../../v2/migrations/0007_v2_owner_bins.sql       20261116004000_vpl_owner_bins.sql
ln -sfn ../../v2/migrations/0008_v2_known_people.sql     20261116010000_vpl_known_people.sql
ln -sfn ../../v2/migrations/0009_v2_cleanup_test_accounts.sql 20261116011000_vpl_cleanup_test_accounts.sql
ln -sfn ../../v2/migrations/0010_v2_drop_my_screenshot_note.sql 20261116012000_vpl_drop_screenshot_note.sql
ln -sfn ../../v2/migrations/0011_v2_purge_test_accounts.sql 20261116013000_vpl_purge_test_accounts.sql
ln -sfn ../../v2/migrations/0012_v2_waiting_invitations.sql 20261116014000_vpl_waiting_invitations.sql
ln -sfn ../../v2/migrations/0013_v2_account_hint.sql 20261116015000_vpl_account_hint.sql
cd ../..
npx supabase db push --remote --yes
```

Copying and deleting instead is what broke here twice: the remote history then
holds a version with no local file, and `db push` refuses to run until it is
`supabase migration repair --status reverted`-ed. The symlinks stay.

All of them are applied to project `vixen` (`ebhrjstllsazywbxnbqt`). One
`20261114140000` history entry from an earlier out-of-band push, and the one-off
`20261116005000` cleanup, were marked `reverted` for that reason.

## Still to do

- R12 deploy to a `<your-domain>` subdomain (`wrangler login` — needs Vixen). A
  public link only works from wherever the app is served; that is the next step
  before it is useful to anyone outside the LAN.
- Sharing has no notification: the invited person finds the note in their list
  the next time they sign in. Deliberate — no email sending, no server.
- R2 Google OIDC — the button exists and calls `signInWithOAuth`, and the
  provider answers. What is missing is the project's **Site URL** + redirect
  allow-list in the dashboard (see *Google sign-in needs one dashboard
  setting*); today it sends people back to `http://127.0.0.1:8788`.
- Emptying the recycle bin permanently (today restoring is one click; a
  "destroy" action is deliberately absent until it is asked for)
- Email confirmation is **off** in this project, so an account can be made with
  an address its owner does not control. Turning it on in the Supabase
  dashboard closes the last hole in sharing by email (see `0008`).

## Tree, rich editor, keyboard

Notes nest. `parent_id` plus `position` gives a real tree; the list indents
each level and remembers which branches are collapsed.

The editor has three modes, switched with the tabs or `Ctrl+1/2/3`:

- **write** — rich text (bold, italic, headings, lists, quote, code, link). `H`
  makes a heading and presses again to turn it back into text.
- **assistant** — settings holds the api url, model and key (the key has its
  own eye), plus a **test it** button that sends one small question through
  `/api/chat`, so a wrong key, url or model fails in the dialog.
- **password** — settings can change your password; it takes effect at the
  next sign-in and signs out other devices.
  A `contenteditable` surface, not ProseMirror/Quill/TipTap: those cost
  hundreds of kilobytes and a bundler, and §3.3 refuses them. Storage is
  still plain markdown, so nothing is locked in.
- **mermaid** — a dedicated pane for diagram source with live preview.
  A diagram is source code; editing it as rich text is nonsense.
- **view** — rendered markdown.

Keys: `Alt+N` new · `Ctrl+/` help · `Ctrl+Enter` child · `Ctrl+1/2/3` mode · `Ctrl+E` cycle ·
`Alt+↑/↓` navigate · `Alt+←/→` outdent / nest · `Ctrl+\` toggle list ·
`?` shortcuts.

## Drag and drop

A note can be dragged with the mouse; the whole subtree goes with it.
Where it is dropped decides what happens:

| drop on | result |
|---|---|
| the middle of a row | it becomes a child of that note |
| the top or bottom edge of a row | it becomes that note's sibling, before or after it |
| empty space below the tree | it returns to the top level |
| the recycle bin | it is binned |
| the recycle bin, while the bin is open | it is restored where it was |

The bin's label changes to `move to bin` or `restore from bin` while a note
hovers it, so the direction is never a guess. A drop that would put a note
inside its own subtree is refused. Dragging is switched off in the filtered
(flat) list, where nesting is not drawn at all.

### With a finger

A touch screen never fires the HTML5 drag events the mouse uses — no attribute
brings them back, that is the browser refusing to invent a mouse. So a **long
press (320 ms) lifts the row**, and from then on pointer events carry it: the
copy floats above the fingertip, the same drop zones light up, the phone gives a
short vibration, and releasing commits exactly what the mouse would have.
Moving the finger more than 10 px before the hold fires means the person is
scrolling, and nothing is lifted. A tap still only opens the note.

Nothing new was added to the screen for this — the tree a phone shows is the
same tree, and the alternative (a "move to…" dialog) was avoided on purpose.

## Running it

    ./serve          # http://127.0.0.1:8099/
    ./serve stop
    ./serve log

`serve` uses `setsid` so the server survives the shell that started it, and it
runs `serve.py` rather than `python3 -m http.server` for one reason:

    Cache-Control: no-store

Without it a browser keeps `app.js` from an hour ago and shows half of the old
screen after a change — which reads as a bug in the app, not as a cache. Every
answer here says do not cache, so a reload is always the current code. The cost
is a few kilobytes per reload on a machine that is serving itself; production
is a static host with its own headers.

## Talking to a model without CORS

Almost every model API answers the browser without an
`Access-Control-Allow-Origin` header, so the answer arrives with status 200
and the browser throws it away. The same request from `curl` or Node works,
which makes it look like a broken key. It is not.

So the app has one small piece of server: `functions/api/chat.js`, a Cloudflare
Pages Function at `/api/chat`. It takes `{url, key, model, messages}` from the
page and makes the call server to server, where CORS does not exist, then hands
the answer back from the same origin it was requested on. `serve.py` does the
same thing locally, so development and production behave alike. If neither is
there — a static host with no functions — the app falls back to calling the
endpoint directly and you get the browser's CORS refusal.

Two rules keep that door from becoming an open relay:

- **https only**, and the host must be on the allowlist at the top of
  `functions/api/chat.js` (kept in step with `ALLOWED` in `serve.py`). Another
  provider means adding its host there.
- **the key is never stored or logged** by the function. It arrives in the
  body, is used once, and is gone with the request.

`test it` in settings sends one tiny question through exactly this path, so a
wrong url, a wrong key, a model that does not exist and a CORS wall each come
back as a different sentence instead of a silent failure.

## The bin can be emptied

Binning stays a single click and stays undoable. Leaving the bin does not:
each binned row has a quiet ✕, and the bin's foot has **empty all**, and both
open a dialog that names what will go and says what happens underneath —
children stay and move to the top level, because `parent_id` is
`on delete set null`, not `cascade`.

The database is the part that matters. Migration 0014 adds a `for delete`
policy with `using (user_id = auth.uid() and deleted_at is not null)`, so:

- a live note cannot be dropped in one step, even by its owner;
- a binned note can be dropped only by its owner, never by someone it was
  shared with;
- the app's confirmation is a courtesy, not the safeguard.

## Publishing it

    ./deploy --dry-run    # what would go up: 172 KB, nine files
    ./deploy              # Cloudflare Pages project `vpl`

There is no build step, so `deploy` does not pretend there is one. It copies
the nine files a browser asks for — `index.html`, `app.js`, `style.css`,
`config.local.js`, `_headers`, `lib/` (three), `icons/v.svg` — into a clean
folder and hands that folder over, so tests, migrations, the dev server and
this README never reach the public. It refuses to upload if a `service_role` key is anywhere in
the client: the anon key is public on purpose, that one would be the whole
database.

`_headers` is the production twin of `serve.py`: `no-store`, the same promise
that a reload is the current code.

Before the first deploy, sign in once:

    npx wrangler login

That opens a browser and needs nothing else — no token to paste, and Pages is
free at this size.

The site lives at **https://vn.<your-domain>** (`vn` for vpl notes), served by the
Pages project `vpl` and its DNS record `vn → vpl-ae9.pages.dev`, proxied. The
preview of any deployment is `https://<hash>.vpl-ae9.pages.dev`. Adding the
custom domain was one API call; adding the CNAME needs the dashboard, because
the wrangler login token may write Pages but not DNS:

    <your-domain> → DNS → Add record → CNAME, name `vn`, target `vpl-ae9.pages.dev`,
    proxy on

Then these two, in this order:

1. **Supabase -> Authentication -> URL Configuration**: set **Site URL** to
   `https://vn.<your-domain>` and **Redirect URLs** to `https://vn.<your-domain>/**`. Until this
   is done, Google sign-in keeps sending people to `127.0.0.1:8788`, which on a
   phone is the phone itself.
2. Then locally: `OAUTH_PORT=0 ./serve` — the temporary 8788 listener has done
   its job and should stop answering.

## Diagrams are a separate component

`v2/mermaid/` is its own component with its own page, table and login. It is
not reachable from the notes app and the notes app has no mermaid code at all.
That is why notes load in 120 KB instead of 362 KB.

    cd v2/mermaid && ./serve     # http://127.0.0.1:8098/

The rule for anything added later: a component earns its own directory when
it has its own table and a reason to exist alone. Notes and diagrams both do.

## Where the redirect URL goes: Supabase, never Cloudflare

When Google sign-in "lands on the wrong app", nothing is wrong with Cloudflare
and nothing is wrong with the button. The OAuth allow-list lives in **Supabase →
Authentication → URL Configuration**, because Supabase Auth is what finishes the
round trip. Cloudflare Pages only serves the files; it has no opinion about
where a login may return to.

For this suite the intended configuration is:

- **Site URL** — `https://vn.<your-domain>`. The dashboard offers exactly one value and
  that is the point: the app sends its own address with every sign-in, so the
  per-app addresses belong in the list below, not here
- **Redirect URLs** — one entry per app, with the wildcard so query strings work:
  `https://vn.<your-domain>/**`, `https://vi.<your-domain>/**`, and for local work
  `http://127.0.0.1:8099/**` and `http://127.0.0.1:8100/**`
- **Confirm email** — off, deliberately: the suite has no recovery address habit
  and a confirmation link is a second place to get stuck

The failure mode is quiet, which is why it reads like a bug in the app: Supabase
can only redirect to an address on the list, so a round trip from `vi` with only
`vn` allowed returns to `vn`, already signed in. Add the entry, sign out, sign in
again from `vi`, and it stays in `vi`.

Checked on 21 Nov 2026 after the entries were added: clicking **continue with
Google** on `vi.<your-domain>` reaches Google's consent page with
`redirect_uri=https://ebhrjstllsazywbxnbqt.supabase.co/auth/v1/callback` and no
`redirect_uri_mismatch`, and the authorize call carries
`redirect_to=https://vi.<your-domain>/` — the same for `vn`. What remains is a person
with a Google account finishing the round trip and watching the address bar.

None of this is a repository change. It is a dashboard step, done once, and it is
the one step in the whole suite that cannot be code.

## vr: a name is a promise, and a guard has to know its table

`vr` came out of a spreadsheet that was law — the 2012 T-HT CRM requirements
sheet, 271 numbered rows, grouped two levels deep, with "current/desired state"
and a free-text horizon. The sheet was good at capture and had no answer to *is
this met?*, and its ID was the row number, so nothing could be quoted once the
rows were sorted. Two decisions follow from that, and both are in the database
rather than in the screen:

- **`VR-001` is assigned once.** `vr_ref_for` fills a blank name on insert and a
  unique index on `(project_id, ref)` makes a duplicate impossible. A pasted
  batch passes its own names in one statement, because a per-row trigger cannot
  see the rows inserted beside it.
- **the owner alone changes the shape.** RLS can say who may update a row but not
  which columns, so `vr_decisions_are_the_owners` refuses a change to `ref`,
  `kind`, `strength`, `status` or `pos` by anybody but the owner, with `23514`.
  Proved with a second account: text saved, strength refused.

That trigger had a bug worth remembering. Its first version read
`new.project_id` **before** asking which table it was on. `vr_projects` has no
such column, so every document update — including the title and the brief — died
with `record "new" has no field "project_id"` (42703). The screen looked broken
in a way that had nothing to do with the screen: the title input accepted typing
and nothing was saved. A guard's first line is `tg_table_name`.

The third bug was quieter. `moveRow` swapped two `pos` values and repainted, and
the sheet did not move: `paintSheet` read the array in memory, not the order in
the database. Sorting in `visible()` fixed it. A list that is stored sorted is
still a list that has to be painted sorted.

Deploying found the fourth: `wrangler pages deploy` only deploys into an existing
project, and `vpl-vr` did not exist. `npx wrangler pages project create` is a real
step, now in `docs/start-here.md`. The custom domain was one API call with the
login token; the CNAME is not, because that token may write Pages but not DNS.

And one design note, because it decides what the app is: a wish stays in the same
sheet. In `vi` parking is a decision and the drawer keeps those rows out of the
way; a wish is not a decision, it is the same row with a smaller stake, so it is
a colour, a word and a filter — not a second list.

One more, found the morning after on the real address and not before: the name
of a document. `openProject` paints the sheet twice — once with the document,
once again when its rows arrive — and `paintHead` wrote the stored name into the
field every time. On localhost the rows land in 10 ms, before anybody can type;
on `vr.<your-domain>` they land late, and naming a fresh document looked like it worked
while the debounced save then read the restored old value, found it equal to the
stored one and did nothing. Nothing errored, nothing was lost visibly, and the
document stayed "untitled spec". The field now follows the document only when the
document changes (`headFor`), so a repaint of the same sheet cannot overwrite a
name being typed.

The test had the same shape of flaw: it clicked *new document* and typed
immediately, which on a slow link types into the previous document. It waits for
the rail to grow now. A test that passes only because the network is quick is not
a test — which is why all four vr scripts are run against production as well as
against `127.0.0.1`.

## vr, second pass: the sheet becomes a place to work

The first version was a table and a set of filters, and it was built against a
247-row import — which is a stress test, not a Tuesday. A person does not read a
list of two hundred and forty-seven rows; a person opens a drawer that says
*One/same interface* and looks at the twenty inside it. So the second pass is
about navigation, not features:

- the document carries a **tree** (`vr_themes`, two levels, enforced by a
  trigger) and its own **words** (`vr_vocab` for importance, status and kind). A
  vocabulary is per document because a Croatian tender says `P1..P4`, a school
  project says `must / nice to have`, and a house build says `before the roof`.
  The `check in (...)` constraints had to go — a list that cannot grow is an
  opinion, not a requirement sheet.
- the sheet shows **three things**: the requirement (name + title + one
  sentence), how hard, and status. Theme appears only in *everything*, because
  inside a theme it would just repeat the drawer. Id, kind, source and proof are
  one toggle away.
- **twenty rows a page**, sortable headings, one search box. Print still prints
  the whole document (`beforeprint` raises the page size and repaints).
- **`vr_log`**, written by a trigger: who, what, before, after, and a snapshot of
  the row. No screen yet — the point was that the data would exist when the
  screen arrives, and that the screen could never be the only source of truth
  about who changed a decision.

Two small bugs of the classic kind. The theme column was hidden by
`.sheet:not([data-theme])` while the painter wrote `data-theme=""` — an empty
attribute still matches `[data-theme]`, so it showed when it should have hidden.
And the empty-state line keyed off `S.reqs.length` instead of the number of rows
on screen, so a theme with nothing in it was a blank page with no sentence
explaining itself. A place with nothing in it still has to say so.

## The clipboard is the API

Three apps, one person, and no cross-app writes: the way a thought gets from
`vi` to `vr`, or a shared document into your own hands, is the clipboard. That
is not a limitation to apologise for — it is the only transfer path that needs
no schema, no token, no permission and no server, and it leaves the person in
the middle, deciding what travels.

So the pattern is two buttons, the same words everywhere:

- **copy** — the thing on screen, as markdown. `vn` writes the note and its
  chapters as `#` levels, because that is what a note is; `vi` writes the
  question, then each band, with the chosen idea first and the reasons beside
  it; `vr` writes rows grouped by theme, with the proof under each.
- **copy to mine** — the same content inserted under the reader's id, with fresh
  ids throughout. It is a copy, not an import and not a grant: the owner's
  version is untouched, and the reader may rename, move, re-prioritise or delete
  what they now hold. This is the honest answer to "I was given a spec and I
  disagree with its priorities", which is the normal condition of being given a
  spec.

Two lessons from doing it three times. **The copy must change the mode**: in
`vi` a reader who copies a funnel home is no longer a guest, so the guest flag,
the `?s=` code and the hidden rail all have to be dropped in the same breath —
otherwise the copy lands in a rail nobody can see. And **a subtree copy needs an
id map**, not a recursive read of the same table: build `parent_id → children`
once, walk from the root, insert parent first. The first version of `vn`'s
writer looked up the node by its parent key and produced the chapter twice.

## The one attachment, and where the limit lives

A requirement sometimes needs its proof beside it: a photo of the old roof, a
scan of the clause, a pdf of the measurement. One file per row, and the whole
design is in three decisions.

**Two megabytes, enforced twice.** The bucket has `file_size_limit = 2097152`,
and the screen refuses a bigger file before uploading it. The screen-side check
exists so the refusal is immediate and in words a person can act on; the bucket
side exists because a limit that only lives in the screen is a suggestion. Both
say the same sentence, which is the only way a limit stays honest.

**The bucket is private and the path names the document.** `<project>/<row>/<stamp>-<name>`
means a storage policy can ask `vr_can_read(project)` and `vr_can_edit(project)`
— the same functions the table policies use, written once in the migration. An
outsider asking for a file is told `Object not found`, which is true and says
nothing. Signed urls are minted per view and last an hour, because a private
bucket cannot be linked to and an hour is longer than anyone stares at a scan.

**The copy takes its proof with it.** `copy to mine` signs the source file,
downloads it, and uploads it into the copy's own folder, then patches the new
row. Best-effort on purpose: if the download fails the copy still lands. A copy
without its proof is still a copy; a copy that refuses to exist because a file
was slow is a worse document.

Three things learned: `storage.objects` policies are RLS like any other and can
call `public` functions, so the access rules do not have to be duplicated in
JavaScript; a signed url needs SELECT permission on the object (so the reader's
role has to be right at *sign* time, not at download time); and the first path
segment must be parsed with a function that returns null instead of raising,
because a policy that throws turns a stray object into a 500 on a page that has
nothing to do with it.

The one promise not kept: deleting an account deletes its rows but leaves its
bytes, because only the storage API can remove objects and account deletion is
SQL. It is written down in `docs/start-here.md` so it is a known gap and not a
surprise.

## vr, third pass: deleting the interface

The second pass made the sheet navigable but left it honest to its data: a name
in monospace, a title, a sentence, three extra columns behind a switch, a row of
gaps ("78 must without proof"), and a detail panel with eleven fields. All of it
was defensible and none of it was light. The person writing requirements is one
person with twenty rows and no interest in a reference scheme: *"we are in the AI
age, not in the age of paper and an index of requirements."*

So the third pass is a subtraction, and it is the most useful one:

- **the name left the screen.** `VR-001` still exists, is still unique, is still
  what the log and the model use — but a document of twenty sentences does not
  need to refer to itself by number. Reference schemes are for documents nobody
  reads end to end.
- **the title left the screen.** A model can write a title whenever one is
  needed; a person typing a requirement should not be asked for a headline and a
  body.
- **the long version, source, proof, today/wanted, horizon, clause, metric left
  the screen.** They are still columns; they are not the interface. The one
  non-word a row keeps is the attachment, because a photo of the old roof is
  evidence and evidence is the hard part.
- **"all columns", the gaps bar and the per-word counts left with them.** A
  switch that reveals seven more columns is a promise that somebody will be
  looked at; nobody was.

What is left is a sentence, how hard, where it stands, and the theme you are
standing in — and a detail panel of five things. The model's review job was
narrowed to match (`statement`, `theme`, `kind`, `strength`): a proposal into a
field nobody can see is a change that happens behind the person's back, and the
balloon rule means nothing if the balloon points off screen.

The lesson worth keeping: **the data model can be richer than the interface, and
should be, but only if the interface never apologises for it.** A hidden field is
fine; a hidden field with a switch, a count, and a gap is a second interface
pretending to be a setting.

## vr: a detail the height of a row

The detail panel was a small form: a grid of labelled boxes, thirteen rem
minimum per column, a three-row textarea, a footer. It was not wrong and it was
not compact — opening a row moved everything below it off the screen, and on a
phone the same grid became a single column of stacked controls with the sentence
repeated above and the right edge clipped.

Two changes, both about height:

- **the detail is a strip.** One line for the sentence (full width), one line for
  theme, kind, how hard, status, the attachment and a ✕. Labels are inline and
  small instead of stacked above the control. The whole panel is about a hundred
  pixels — one row of the table.
- **a phone gets cards, not a table.** Below 640 px the table, its body and its
  rows become blocks: the sentence spans the card, then `auto auto 1fr` holds the
  two chips and the row tools on one line under it. The theme column is gone (you
  are standing in it), and nothing is measured wider than the screen — the test
  asserts `scrollWidth - clientWidth <= 0` before and after opening a row.

The lesson is the same one as the last pass, one level down: **space is a
budget, and the interface spends it on the one thing the person is looking at.**
A form that repeats the sentence you just clicked, with a label above every
control, spends the budget twice.

## vz: the last letter, and the dictionary

Zed is the app the suite was missing without knowing it: every other app is a
document, and a document is the wrong shape for `db2admin`/`db2admin`. What is
needed there is a name and a value and no ceremony — a poor man's Redis with a
page in front of it.

Three decisions carried it:

- **the key is the identity, and it ignores case.** `DB_HOST` and `db_host` are
  one row, so the second write replaces instead of standing beside it. This is
  the same rule as names and addresses in the rest of the suite, and it is the
  reason a pasted `.env` twice does not double the dictionary.
- **a value is text and stays text.** No markdown, no links, no formatting: a
  dictionary is not an editor. The value is monospace, folded to dots until
  asked for, and opened in place.
- **publishing is a different promise from sharing, so it is a different
  switch.** A share link is read by a person; a published project is read by a
  program, over `*` CORS, with no account. Mixing the two would have produced a
  share dialog that sometimes opened a machine door — so `/p/` exists on its
  own, with its own checkbox and its own sentence in the dialog.

Two things had to be said out loud rather than engineered away. **Hidden is a
curtain, not a lock** — the value is plain text in the table and anybody with a
link reads it. And **publishing includes hidden values** — a service that hides
half a configuration would be a worse lie than a public password, so the
checkbox warns once and then does exactly what it says.

The build found one real bug of the "two writes in the air" kind: typing a key,
pressing Enter, typing the next one made two `refresh()` calls, and the older
answer could paint over the newer one, losing a row on screen. A sequence
number fixes it — **only the last answer counts** — and it is the kind of thing
that never shows up in a single-save test, only in a paste or a fast typist.

## vd and vc: one engine, two screens

The generator started as ten months of Java and ended as a metamodel. Party,
Artifact, Project was a good beginning; universal "transformation" objects, a
workflow engine and a hundred tables were the end of it. The demo that still
worked was the first one: **input → transformation → output**, with a picture of
the inputs on one side and the result on the other.

So the suite now has an engine rather than a platform:

    artifacts ──template + prompt──▶ one call ──▶ one answer you can edit

`packages/shell/engine.js` is that sentence in code: it builds the messages,
calls the model through our own CORS door, turns a file into text, and caps how
much of a 200-page tender is sent. It knows nothing about tables. Each app
injects a prefix and a template pack, which is why `vd` and `vc` are copies of
the same machine with different desks.

**The anti-design is written down.** An artifact is `kind`, `title`, `text` and
optionally a file. No artifact graph, no typed relationships, no workflow, no
universal object. A template that needs structure asks for markdown; the
database stores one text column. The ten-month version is what happens when a
data model is allowed to be more interesting than the job.

**The output is a draft, not a record.** It lands in a textarea, it saves itself
750 ms later, and the previous answer stays as a version row. The model proposes;
the person keeps. That is the same balloon rule as `vi` and `vr`, with a
different shape: here the balloon is simply the document.

**`vc` earns its own app because of what a person reads.** A report is not prose;
it is verdicts. Every finding line starts with `PASS`, `FAIL` or `UNKNOWN`, and
the strip above the report counts them while you type. Number and word together;
colour never alone. `UNKNOWN means the evidence was not in the inputs — never a
guess` is in the template, because an auditor's only real failure is a confident
pass with nothing behind it.

Two bugs the build found, both worth remembering:

- **a copied migration must be read, not trusted.** `vc` was made by replacing
  `vd_` with `vc_`, and its storage policies were correctly named `vc_files_*`
  while still guarding `vd-files`. Uploads went to a bucket that did not exist
  and the browser only said `400`. The fix is a new timestamped migration that
  creates `vc-files` and moves its policies; the lesson is that a copied file is
  a fine starting point and a bad place to stop reading.
- **a shared job legitimately appears in the guest's rail.** RLS lets a person
  read a project shared with them, so `listProjects()` returns it. The test that
  deleted "the copy" and then asserted the rail was empty was wrong about the
  product, not the other way round. What was missing in the UI was subtler: the
  rail offered a delete button on a job that was not yours. Now it does not.

The local `./serve` already answers `/api/chat`, so a mock in a test has to
intercept both `/api/chat` and `https://api.<your-domain>/chat` — otherwise the test
spends its key or fails with the proxy's own words. `**/chat` is the shorter
route pattern.

---

## vp, stage 1: the key that follows you

The complaint was specific: five apps, two browsers, three accounts, and a model
key pasted into every combination. The fix is one row.

`vpl_ai` is the only table in the suite without an app prefix, because it is the
only thing every app may read. Four policies, all "your own row". The apps do
not change how they call a model: they copy the row into their own
`localStorage` and the call still leaves from the browser. What changed is that a
browser without a key asks the account for one — the settings dialog adopts it
before it opens, and `vd`/`vc` adopt at sign-in so *generate* is not blocked by a
key that was already on file.

Three things were learned in the doing.

**A second auth client is not free.** The first version created its own
supabase-js client to read the row, which produced a real warning: two
GoTrueClients on the same storage key, and with them a chance of racing session
refreshes. The suite's shell now reads the session token out of the same
storage key supabase-js writes (chunks included) and speaks REST with plain
`fetch`. No library, no second client, no warning.

**Never write into a field somebody is typing in.** `paintSpec()` filled the
title from the database whenever the two differed — correct until a repaint
lands one keystroke after the person started typing, and then it eats the
sentence. Both `vd` and `vc` now skip the write when the element has focus. The
vc test caught it as a shared check whose title had quietly gone back to
"untitled job"; the report was right and the name was wrong, which is the kind of
bug that looks like a test flake for an hour.

**The guard sees the prefix, not the intention.** `vpl_ai` would have been a
`vd_`-shaped mistake if it had been named after the app it was written in; it is
named `vpl_` because stage 2 (`vp_keys`, `vp_charges`) will read it too, from a
proxy that knows nothing about vd or vc.

Stage 2 is still not built, and the reason is in `docs/vp.md`: it needs the
service-role key in the proxy's environment, which is the largest secret this
suite would hold. The answer to "save me one paste" did not need it. The answer
to "give my colleague fifty tries until March" will.

---

## vp, stage 2: a slip with calls on it

A code is the oldest idea in telecommunications: a thing you hand over, which
has an amount and an expiry and can be used once. Nothing about it needs a
subscription, a plan, a seat or a price — only a ledger.

So: `vp_codes` (the slip), `vp_keys` (what it becomes), `vp_charges` (what was
spent), and the door. Three tables, one page, no invoices.

**The order is the design.** Spend a credit before calling the provider, settle
after. Spending first means two parallel calls cannot both pass when one credit
is left; settling after means a provider outage gives the credit back. Both live
in Postgres under `for update`, not in the Function, so the rule survives a
retry, a double tap or two apps at once.

**One credit is one call**, whatever its size. The obvious alternative — price
per token — needs a price table per model, and a price table is the first page
of a billing system. Tokens are still logged, because a person wants to know how
much of a code went on one long report, but they are numbers, not money.

**A code is shown once and stored hashed.** The same promise as a share link: the
database cannot reprint it, so a stolen database is not a stolen set of codes.
Same for the key the code becomes.

**The door is one file because of what it holds.** `vp_spend` is the only
function in the suite that can read somebody else's provider key, so it is
`service_role` only, `vp_settle` too, and the Function that calls them sits in
`apps/api/functions/vp.js` where it can be read in one sitting. It refuses any
provider host that is not on the same allowlist `chat.js` uses.

**A path nobody asked for.** Apps build an endpoint by appending
`/v1/chat/completions` to the base address a person pasted, so a vp key's base
address — `https://api.<your-domain>/vp` — arrives as `/vp/v1/chat/completions`.
`functions/vp/[[path]].js` exists for that one sentence, and for nothing else.

**Two warnings that were worth adding.** The page says, before you make codes,
that an account without a model key will have its codes refused at the door; and
the door says, in the refusal, whether a key is out of calls, expired, revoked,
or its issuer has no key — four different sentences, because "403" is not an
answer a person can act on.

**What is not tested, and why.** The success path is proven with the function's
real code and both ends faked (`vp-proxy.mjs`, 18 checks): the issuer's model,
the cap on `max_tokens`, the ledger row, the refund on 503, the refusal to
forward off-list, and that the provider key never appears in the caller's
answer. One thing remains unproven by us: a real paid call through the door,
because that needs a real provider key on an account. The moment somebody saves
one at `⚙`, the whole chain is live.

## va-agent: an agent you can hand a folder to

The last app is `va`, and `va`'s other half is an agent with a shell. Before
writing the desk, we built the agent, because an agent with no desk is still
useful and a desk with no agent is a drawing tool.

It lives in `agent/` and it runs in the `eva` workshop — the Ubuntu container
that already had `pi` installed. Two upgrades first, since libraries had started
complaining: node **22.19 → 26.13.1** (current LTS, installed at `/opt/node26`,
put first on `PATH` for login shells and repointed for `node`, `npm`, `npx` and
`pi`) and therefore `pi` **1.6.0**; plus `terraform` 1.17.2 so the agent can
validate what it writes.

The design is one sentence: **a job is a directory**. `task.md` with
`template:` in its front matter and optional `inputs/`; out comes
`out/report.md`, `out/files/`, `out/state.json` and `out/checks.json`. No port,
no socket, no webhook — that is not laziness, it is the refusal to give a web
page the ability to command a shell.

Things the three real runs taught us, in the order they hurt:

- **free-pi cannot run unattended.** The first terraform job wrote five correct
  files, ran `terraform init`, and died with `403 ads_required`: the free backend
  is paid for by ads and a headless container shows none. So the workshop now
  runs **plain `pi`** — Gemini as pi's own provider and NVIDIA as `nim`
  (`integrate.api.nvidia.com/v1`) — and free-pi was uninstalled from the box. It
  stays for the models outside those two. A docker agent gets a plain provider
  key or a **vp key**, which is what vp stage 2 was for.
- **a job is not a request.** Gemini's free tier allows five calls a minute; an
  agent makes twenty. The worker now waits and takes the job again, twice, and
  says so in its output.
- **the model writes into `out/files/` whatever it ran**, including a 100 MB
  `.terraform/`. The worker prunes provider directories, `.git`, `node_modules`
  and anything over 5 MB before it lists the deliverable.
- **asking for a shape is not checking it.** The prompts ask for a box list
  (`id`, `label`, `kind` from a closed list, `host`, `note`, `attrs`); the first
  inventory run answered with `name:` and `kind: deployment`, and the second drew
  five boxes and no arrows. So `lib/boxes.mjs` reads the file and the report ends
  with **Mechanical checks** in plain sentences. A drawing that drifts from its
  list is now visible at the moment it is made.
- **the agent tells the truth about itself.** Given an empty `inputs/`, the
  context run wrote "nothing here is confirmed against code or config" and listed
  six things it did not check, unprompted. That is the whole reason the prompts
  start with evidence before prose.

The model is an endpoint, not a dependency: `models.json` is generated at start,
the key is written as `$VPL_MODEL_KEY`, and with `VPL_MODEL_BASE` empty the
agent uses `pi`'s own provider — which is how these runs were done, with the
workshop's Gemini key. Twelve checks run with no model and no network
(`tools/test-agent.sh`); the docker image is for giving the same thing to other
people, and it needs outbound HTTPS only.

## vp: the first real call found what the fakes could not

The door was tested with nineteen checks and a fake database, and it had never
worked. The first real slip on a real row answered `column reference
"credits_left" is ambiguous` — `vp_spend` returns a table with that column, so
its own `UPDATE` could not name it. Two more came out of the same hour: the door
forwarded the caller's model name instead of the issuer's (an agent calling its
model `nemotron` got a 404 from NVIDIA), and it dropped `tools`, which turns an
agent into a chatbot.

All three are fixed, and the fix for the class of bug is `tools/test-vp-live.sh`:
one real call with a real key, two seconds, one credit — because a fake database
cannot tell you that your SQL does not run.

The agent now spends a slip: terraform job, 157 s, six files, `terraform
validate` green, 44 credits. Gemini stays as pi's own provider; behind the door
an agent needs an OpenAI-shaped upstream (NVIDIA `nim` here), because Gemini's
compatible surface wants a `thought_signature` back on every function call and a
generic client does not keep one.

## va, slice 1: the desk, on the fourth skin

`apps/va` is the engine's fourth copy and the suite's eighth app. The migration
was generated from `vd`'s core with the prefix changed, which is the honest way
to do it — `va_` tables, `va-files`, the same five functions under new names — and
the account purge was written out whole instead of patched, because `vc` and `vp`
both shipped a purge that had quietly lost a prefix.

What is `va`'s own is the template pack: **context**, **overview**, **terraform**,
**report**. Each one ends in the box list, because that is the only structure
this app has and the whole plan depends on it staying text: `boxes:` and
`arrows:`, a closed `kind`, an `attrs` map for everything cloud-specific.

Forty checks pass locally and against `vpl-va.pages.dev` on the first run. Then a
screenshot found what the checks could not: the line under the template picker
read "expects: undefined", because the pack had no `needs` field. Four sentences
fixed it. Looking at the thing is still a test.

## va: one real job through the queue, in 61 seconds

The hand-off shipped the only way it could be safe: the desk writes a row and a
folder, and an agent that already has a shell polls the row. Nothing in the
browser can make anything run.

The fake run came first, because wiring is wiring: `--fake` writes a canned
report so the loop can be walked 14 times a minute. It found three bugs before a
single model call — a `user_id` with no default, a storage path encoded so hard
that `task.md` stopped being in a bucket, and an answer kept as
`kind: 'answer'` when the table says `doc|report|code`.

Then one real job through the vp door: 61 seconds, one file, `context.yaml` with
two boxes and one arrow, kept on the desk. The worker's log says it in four
lines, and 50 of those 61 seconds were the model.

Two things stayed out on purpose. There is **no lease**: a job claimed by a dead
worker is a row a person can re-queue, and a lock table would be a second state
machine pretending to be a first. And there is **no queue depth**, no worker
list, no dashboard — the strip only shows this job's jobs.

## settings: five dialogs became one, and three auth bugs fell out of it

The request was "one settings panel, the same everywhere". That part is
mechanical now: `packages/shell/settings.js` builds the whole dialog — four
tabs, one button row — and an app's HTML holds an empty `<dialog>` and nothing
else. 165 checks (`tools/test-settings.sh`) walk it in five apps.

The bugs underneath were not mechanical. All three came from the same habit: a
page trusting a copy of the truth instead of asking for it.

- **The 401.** `Bearer {"access…` reached PostgREST because storage held a
  truncated fragment of a session and nothing checked the shape before sending
  it. `Invalid JWT serialization: Missing dot delimiter(s)` reads like a
  permissions failure and was a string problem. A token now has to look like a
  JWT, and the live client session wins over storage.
- **Two tabs, two people.** supabase-js keeps the session in memory, so a tab
  left open while another tab signed in kept painting the first person's rows
  under the second person's token. Storage is the only thing every tab shares,
  so the check is `storedId()` — on `visibilitychange`, on `focus`, on the
  `storage` event — followed by a reload when the answer is not who is on
  screen. A tab on the gate reloads *in* when a session appears.
- **The logout that was a suggestion.** `signOut()` dropped the in-memory
  session and left `sb-<ref>-auth-token` (plus `.0`/`.1` chunks) in storage, so
  the next reload signed the person back in. It is `scope: 'local'` now, and
  every chunk of the key goes with it.

One test bug is worth remembering: the theme did nothing in vi and worked
everywhere else, because the click landed on the `<span>` inside the button and
vi's CSS gives buttons no padding. `e.target.dataset` is not the element a
person pressed; `closest('[data-theme]')` is.

## the chrome: one bar, one gear, one dock, in eight apps (v1.2)

The suite had eight bars, five settings dialogs and one app (vn) where the person
signed in appeared only inside a panel. Now the shared shape is a rule, not a
habit:

- **`packages/shell/who.js`** — one label: Google's name, else the address tidied
  (`vpl-agent` → *Vpl Agent*), else a letter. Every app's `displayName` is a
  two-line delegate to it, so the corner reads the same everywhere.
- **`packages/shell/dock.js`** — a chat line at the bottom of every app. It is a
  child of `#app`, not a fixed overlay: the work area gives up the strip instead
  of hiding under it, which is also why vr's bottom buttons stayed clickable.
  It reads the work area (bar and dock removed so it does not feed on itself) and
  sends it with the question. The answer stays in the dock.
- **The gate** — one card from one block of CSS in `tokens.css`, and one sentence
  on all eight: *one account for the whole suite*. vp had a frame of its own but
  no theme switch; it has both now.

The bug worth remembering is the settings one. `data-theme` lives on `<html>`, so
`closest('[data-theme]')` inside the dialog matched **the page**, every click
took the theme branch, and save / forget / ✕ were unreachable until the theme was
put back. A selector that can match an ancestor of the dialog is a selector that
swallows the dialog. `chrome-check.mjs` (24 in each app, 192 total) now changes a
theme and then closes, so it cannot come back quietly.

## polish, before the next build

The ◐ in the bar now walks the same three themes as the settings tab instead of
flipping two of them: one list, one place to learn it. And *use it* became a real
contract — an app that accepts the answer passes `onUse`, may refuse with a
sentence, and the dock shows the refusal instead of a cheerful "used". vn inserts
at the caret through its autosave; vi pins a card; the other six have no button
at all, which is the honest default.

## va, slice 2: the drawing, and one bug that looked like an empty canvas

The canvas is arithmetic, not physics: a box with `x, y` sits where it says, a box
without one gets a column by kind, and the same text always draws the same
picture. The only thing it writes back is a position — `setXY()` adds or replaces
two lines inside the fenced block and leaves every other character alone, which is
what "the canvas edits the text" has to mean if it is going to be true.

The first run drew an empty pale rectangle with one stray `hr:5432` at the corner.
Every box was there: they were all stacked at 0,0, because `Number('')` is `0` and
`x:` with an empty value read as "placed at the origin". A screenshot found it;
the 21 checks would not have. Same lesson as each slice before this one.

## the floor under the interface

`ux-sniff.mjs` measured what taste usually argues about: 232 problems across eight
apps, most of them the same three shapes — a 28px bar icon, a 20×24 dialog ✕, and
labels at 9.6px. The fix is one block in `tokens.css` (a floor under every
tappable thing, a floor under five-grade type) plus wrapping tool rows on a phone,
because the bigger controls then pushed the last button off the edge. It ends at
zero, and the floor is now a test rather than a habit.

## 2026-11-23 (later) — the front door, and a gate that measures it

`apps/www` exists and is deployed: what Terg is, the eight applications with
their addresses, six rules, an faq of the ten questions people actually ask,
privacy, an imprint that marks its own gaps, and the same page in Croatian.
Static, no cookies, no third-party request, `default-src 'self'`, and the same
palette as the apps (copied by `tools/stage.sh www`).

`./tools/test-all.sh` now runs the whole thing in one command, locally or against
the deployments, and it is what found the last round of real problems:

- `vi`'s parked reason field was **28 px** — nobody would see that on a desk.
- `ux-sniff` reported a correctly labelled field as unlabelled; it now knows
  `label[for]`, `aria-labelledby` and `title`, and it draws WCAG's line: a link
  inside a sentence is text, a button or a standing link is a control.
- `deploy` shipped from a fixed file list, so the site's `site.js` and subpages
  became HTML 404s — which the browser reports as *"module script with MIME type
  text/html"*, naming the symptom and not the cause. An app is now **its files**.
- A dot-directory was never copied, so `security.txt` was a 404 only the published
  test could see.

Both runs are green: **23 groups, 0 failed**, local and `VPL_PROD=1`.

## 2026-11-24 — the site left the repo

`apps/www` was built here, deployed, and then moved out: it is not part of the
suite a stranger clones. It lives with the rest of our own infrastructure (the
site, the release checklist, the project settings) and it will be replaced by
`w3` — the application that generates such a site with the same engine — rather
than by hand-written HTML. `www-check.mjs` and `og-card.mjs` went with it.

The public repository is the eight apps, the shared shell, the agent, the
migrations and the tools. Everything in it must work for somebody who brings
their own Supabase project and their own Cloudflare account, and who never talks
to us.

## 2026-11-24 (later) — the repository becomes something a stranger can install

Three things were taken out of the code, and one thing was put in its place.

**Out: our addresses as defaults.** `SHARED_PROXY`, `SHARED_SEARCH` and the `vp`
`DOOR` were string constants pointing at `api.<our domain>`. Every app now reads
them from `config.local.js` (`proxy`, `search`, `door`); with none, the app uses
its own `/api/chat` and says so instead of quietly posting to somebody else's
server. The shell (`dock.js`, `engine.js`, `settings.js`) does the same.

**Out: our keys, from the places that had them.** `apps/vz/functions/p/*` carried
the anon JWT and the project URL as constants; they are Pages secrets now
(`VPL_SUPABASE_URL`, `VPL_SUPABASE_ANON`). `apps/api` reads `SUPABASE_URL` from a
secret too. The three doors share one origin list, `apps/api/functions/_origins.js`
— one file to edit, not three copies to drift apart.

**Out: the passwords in the test suites.** Twenty-seven files signed in with a
literal account. They now import `_account.mjs`, which reads `VPL_EMAIL` /
`VPL_PASS` / the guest pair from the environment and, when they are missing,
prints which two variables it wanted and exits 0. Nothing in the repository is a
credential.

**In: `docs/configure.md`** — every value, its default, and the two things
everybody forgets (the proxy's origin list, Supabase's redirect urls) — and a
README rewritten as "install from zero": Supabase project, `db push`, one config
file, `./serve`, then `./deploy`.

Two bugs came out of running the suites that had been quietly broken since the
settings rewrite: the dialog painted its account line once at mount and never
again (`open()` now repaints), and `key-check` was still asking for `#ai-url` /
`#ai-key`, ids that no longer exist — a test that cannot find its own controls.

## 2026-11-24 (later still) — sharing reaches a person, not an address you remembered

A note was written and shared with an address that has an account, the note
said *shared*, and the assistant never saw it: the grant named a different
account from the one being used. Nothing was broken in the database —
`vn_share_role` returned `edit` for that reader, and the note opened in a real
browser signed in as them — but the person had no way to notice that the
address they typed was somebody else.

Two small things, so that it is noticeable:

- **The address box offers the addresses you have already shared with.** It is
  a `<datalist>` filled from the grants you own, so the second share to the same
  person is a pick, not a spelling test.
- **A listed person shows their name when their account has one** (the
  `vn_account_hint` function was already there). An address that is not the
  person you meant now looks like a name you do not recognise.

And one more bug of the "tests go quiet" family: the first attempt used `esc()`,
which vn does not have (it is `escapeHtml`), so `paintShare` threw and the whole
share list stayed empty. The suite caught it in one run, which is what it is for.

## 2026-11 · the box that swapped

The host sat at 16 GB of 20 GB used and 3.6 GB of a 4 GB swap file, with
`vm.swappiness` at 60 — Ubuntu's default, which lets the kernel evict working
memory to disk while it keeps page cache, because "cold cache" looks cheaper
than "hot page". That is a policy choice, and the wrong one for a machine that
is one developer's desktop and one small suite's build box.

`tools/swap-tune.sh` does the two steps and refuses the second when it cannot be
taken back:

- `vm.swappiness=10`, written to `/etc/sysctl.d/60-vpl-swap.conf` so it survives
  a reboot. Swap should answer pressure, not idleness.
- `swapoff -a && swapon -a`, only when `MemAvailable` exceeds what is in swap by
  1.5 GB — bringing 3.6 GB back with 4.2 GB free leaves no margin, and an OOM
  kill during a reload is a self-inflicted wound.
- it names the biggest residents and does **not** stop them. On this machine the
  answer was a single Firefox content process at 9.4 GB, and a browser tab is a
  person's decision, not a script's.

Run it dry to see what it would do, `sudo ./tools/swap-tune.sh --apply` to do it.

The lesson, again in the same shape as the rest of this file: swap tells you
what happened, not what is happening. Read `/proc/meminfo`, `ps` and the swap
file together before changing a number.

## 2026-11 · the bin that only vn had

The complaint was exact: "the recycle bin exists in vn and nowhere else". It was
true, and it had been true since vi. Deletes in the other six apps were
`delete()`, and `delete()` has no undo — a person who pressed ✕ on a requirement
lost the paragraph they had typed. Nothing in the suite was more expensive per
pixel.

So the bin became a column, not a feature: `deleted_at timestamptz` on the
seven tables that can lose a row, `listX(projectId, { bin })` as one query with
`is null` or `not is null`, and one block of CSS in `tokens.css` for the
banner, the filled button, the tinted pane and the `restore` word. vn already
had it; vz already had a bin *view*; the rest were built to the same shape
(`docs/bin.md`).

The first version was too quiet. In vn the open bin was a slightly different
shade of the same paper, which is a signal that only reads if you already know.
Now it is four signals at once — a filled button, a banner with a count in
words, a tinted pane and a `--mark` strip down the edge — and three of them
survive a black-and-white screenshot. The label on the button also stopped
saying "recycle bin — close" (it truncated in a 240 px rail) and started saying
where it goes: *back to notes*.

What the work turned up, in the order it bit:

- **`vr_reqs` uses `pos`, not `position`.** The migration failed on the first
  push; a partial index named a column that does not exist.
- **The share functions did not know about the bin.** A guest could read a
  requirement the owner had set aside. Two migrations redefined all four
  (`vr`, `vd`, `vc`, `va`) with `deleted_at is null`.
- **A shared document showed the first draft.** The share functions aggregated
  outputs oldest-first while the desk lists newest-first, so a reader opened the
  version nobody is working on. Latent for months; the bin work made it visible
  because the copy flow re-ordered the versions.
- **A copy flattened every version into one instant.** `copyToMe` inserted all
  outputs in one statement, all with the same `now()`. "The newest document" is
  a fact only if the timestamps differ, so a copy now keeps each version's own.
- **The bin is a mode, not an address.** vn's router reset `showingTrash` but
  left the tint and the edge behind — a list of live notes wearing the bin's
  clothes. One `paintTrashFrame()` now owns all four signals, and any route
  change goes through it.
- **`replaceState` fires no `hashchange`.** Telling the URL and not the router
  turned the next click on that same note into a no-op, because the router
  believed it was already there.
- **A button that says "back" must go back.** vz's bin button still called
  `openBin` while it read "back to the sheet", so pressing it re-opened the bin.
- **vd/vc/va each carried two copies of the bin markup** and vd and va had two
  `paintBin` declarations. The second copy was invisible until `#btn-bin`
  resolved to two elements and the test said so.
- **vc's dock brief had a `$` missing** — `'the document on the desk ({o.kind})'`
  went to the model literally, quotes and all.

The test is `bin-check.mjs`, one file, seven apps, and it is deliberately about
signals rather than internals: `aria-pressed` **and** a changed word **and** a
computed background that is not the paper's **and** a banner with a number in
it. A bin that is only a different shade passes none of those, which is the
point.

## 2026-11 · the bin you could not find

"One bin in eight apps" shipped and the answer came back immediately: *I still
don't see it*. Both reasons were real, and neither was the CSS being wrong.

- **vi's bin lived inside the ideation panel.** vi is five stages in one column
  and only one stage is on screen — the bin had been placed in that stage's
  `<section>`, so it existed on exactly one of five pages and vanished with the
  stage. The bin is the *column's*, not a stage's: moved out, under all five.
- **in vd, vc and va the button was at the end of the inputs column** — y≈1900
  in an 800 px window. Nobody scrolls to find out whether they can undo. The
  foot is `position: sticky; bottom: 0` and the banner `top: 0`; opening the bin
  scrolls the place into view.

`position: sticky` and `overflow-y: auto` do not mix: a box without a height is
not a scroll container, it is merely a box that turns off sticky for everything
inside it. vi's `.funnel` had carried that line since the funnel was written,
harmlessly, until the day something inside it needed to stick.

And one self-inflicted wound worth writing down because `node --check` will not
catch it: inserting a helper function above `openBin` in vz matched the tail of
`async function openBin` and produced

```
async
/* …comment… */
function scrollBinIntoView() { … }
function openBin() { … await … }
```

`async` on its own line is a valid *identifier expression statement*, so the
file parses — and then `await` inside a now-sync function is a runtime parse
error, so vz booted to a blank page ("Unexpected reserved word"). Syntax checks
that only prove "it parses" say nothing about whether the code is what you meant
to write. The suite caught it because the app never reached its gate.

## 2026-11 · the second dialog that was the same dialog

vn had two settings dialogs. One was the suite's, built by
`packages/shell/settings.js`; the other was vn's own, and it held a name field,
a password field and a delete button. Two gears, one of them hidden behind a
button that no longer existed in the markup (`#btn-settings` was `null`, and a
`quietEl` stub took the listener on the chin — which is why nobody noticed).

The fix was not to delete vn's dialog but to ask what it was for. A name and a
password are *auth calls against the same user*, so they have nothing to do with
notes: they belong to the person, and the person is the suite's. That is the
fifth tab, `you`, and it is in all eight apps. What is not in all eight is
*delete my account* — only vn holds the notes, so only vn can say "this deletes
12 notes and 5 shared links, and the account itself", and only vn draws the
button. A hook an app does not pass is a field that is not drawn.

Then vn's `#settings` dialog, its 6 KB of markup, thirteen `el.` entries and
170 lines of handlers went away. Three lessons worth keeping:

- **A tab that cannot do what it says is worse than a tab that is not there.**
  Hence `account` is optional and every field is conditional on its own hook.
- **A stretched button in a one-column grid reads as centred text.** The first
  rendering of `save the name` looked like a caption, not a control. Buttons
  now carry `justify-self: start` and their own edge, and the delete block sits
  below a rule, because "what would be lost" is not another setting.
- **The dialog must not change size when the tab changes** — and it does not,
  because the panels share one grid cell and the tallest one (`you`, 355 px on
  vn) sets the height for all five.

The test grew with it: `settings-check.mjs` now asserts the five tabs, the
height staying put across the switch (364 → 364 px, ±1), the account line
carrying the signed-in address, a filled name field, a password field, nothing
centred, and `delete my account` **only** in vn. 30/30 in all eight.

## 2026-11 · a law you keep, so you stop pasting it

The first item from `docs/vc-next.md`: `vc_standards`, and *add from library*
in the check. The sentence the screen has to hold is one line — "a law you keep,
so you stop pasting it" — and everything about the design follows from it.

- **A copy, not a pointer.** *add* writes the text into `vc_artifacts` and
  remembers `from_standard`. Provenance is a nullable uuid with `on delete set
  null`, because the interesting case is not "where did this come from" but "what
  happens when the law is replaced next year": the report must still open and
  still read the same. The test proves it by editing the standard and by
  deleting it for good, and then opening the input to find the words unchanged.
- **`chars` is generated, not typed.** `generated always as (char_length(text))
  stored`. It exists for one honest reason: a person should see that 400 000
  characters will not fit in one call *before* the press.
- **The drawer is private.** Owner-only RLS. No share function reads it, and the
  library button is hidden for any role that is not `owner` — the guest check in
  `vc-lib.mjs` is exactly that sentence.
- **✕ bins, like everywhere else.** A 200-page law is the last thing that should
  vanish because a finger slipped, so the first ✕ is the bin, and the second
  press — in the bin — destroys.
- **One thing at a time.** Pressing a row, or *＋ a new standard*, hides the list:
  the row above and the field below must not both claim to be the same document.

Two things the work turned up:

- **A modal `<dialog>` asked about through a locator lied.** `locator('#lib-dialog[open]').count()`
  stayed 0 for twelve seconds while `document.getElementById('lib-dialog').open`
  was already `true`. The test asks the page instead (`pg.evaluate`) and stopped
  flaking. Worth remembering: a locator is a convenience, not the DOM.
- **vc's bin banner was in the markup twice.** Same `id` twice, so the browser
  quietly used the first and the second was dead weight; it surfaced only while
  editing that neighbourhood.
- **A restored standard must not look like it vanished.** Taking the last item
  back out of the bin leaves an empty bin view, so the drawer now returns to the
  library when the bin empties — and stays in the bin when it does not.

`vc-lib.mjs` is 29 checks, green three runs in a row, and it is in
`tools/test-all.sh` and `tools/test-vc.sh`.

## 2026-11 · fifty offers, one list, and a door that reads one page

The library made *a law you keep* true. What was left was everything that makes
a law arrive and everything that makes it meet more than one document.

**Where the words come from.** A standard had three doors: paste, a pdf, a link.
The link was the interesting one, because both sources a compliance check
actually cites — `eur-lex.europa.eu` and `narodne-novine.nn.hr` — answer with
HTML and no CORS headers. A browser cannot read them; that is not a bug to work
around, it is how those servers were configured. So the suite got a second door
next to the model's: `api.terg.hr/fetch`, one page, on demand, no cache and no
crawl. It keeps an allowlist of legal sources, follows a redirect but re-checks
the host it lands on, refuses anything over 3 MB, and strips HTML to text with no
cleverness at all. A PDF comes back as one sentence — *download it and drop it
here* — because a file the person already has does not need a second silo.

The same door exists in `serve.py`, so development does not depend on a
deployment. That is a rule now, not a coincidence: **every function the app talks
to has a local twin**, otherwise the local app is a different app.

- **A pdf becomes text in the browser, the original goes to the bucket under the
  standard's own id** — `<vc_standards.id>/<uuid>-<name>`. The four `vc_files_*`
  policies learned a second question (`vc_can_read_std` / `vc_can_edit_std`)
  rather than gaining a fifth policy: the drawer stays owner-only and nothing new
  is shared by accident.
- **A standard has to exist before its file has somewhere to live.** So a file
  chosen in a fresh draft keeps the standard first, then fills it. Ugly in the
  code, honest on the screen: the row appears the moment the file is dropped.

**The batch.** Fifty offers, or one job ad and a pile of CVs. `vc_targets` is one
row per candidate or offer, and `run all` works it **strictly one at a time, in
order** — not for speed, but because fifty parallel calls is fifty chances to
lose a half-written report and an account at the provider.

- **`running` is only true while somebody is looking.** `openJob` sends a
  `running` row back to `queued`, in its own place. No scheduler, no cron, no
  worker: the queue moves because a person pressed a button and stops when they
  leave. `stop` finishes the one in flight and says so in words.
- **Counts live on the row.** `n_pass` / `n_fail` / `n_unknown` are written when a
  report lands, so the list can be read at a glance without parsing fifty
  documents — and the number is never alone, the word is next to it.
- **Rules stay shared, proofs do not.** A standard added while a row is on the
  desk belongs to the check; a proof belongs to that row. That one sentence is
  the whole data model change; a `target_id` nullable on three tables.
- **The nouns come from the template pack.** A job ad's batch says *uvjeti
  natječaja* and *kandidati*; an audit's says *standardi* and *dokazi*. The third
  template, `tender`, was added because the batch needed its native shape rather
  than a renamed audit.
- **A repaint must not take the caret.** Picking a row rebuilds the list, so the
  field being typed into is found again and the selection restored — the same
  rule as `paintSpec()` not writing into a focused input, one level down.
- **The cap is 50, and it says so** — not a technical limit, a promise that this
  stays a tool and not a document factory.

**Two things the work turned up.** A clicked row that contains an input does not
select itself if the handler skips `.tgt-name` (it looked like "another row is
another pile" was broken when it was the test clicking the input). And a test
that clicks `run all` without a model key does nothing at all, correctly: the
guard opens the settings. Both were test-side discoveries, both worth the note.

`vc-lib.mjs` is 44 checks, `vc-batch.mjs` is 40, both in `tools/test-all.sh` and
`tools/test-vc.sh`.

## 2026-11 · the sentence that was copied five times

`plainAuthError()` was the same twelve lines in `va`, `vc`, `vd`, `vp` and `vz`:
Supabase says *Invalid login credentials* and every app translated it, identically
and separately. It now lives in `packages/shell/words.js` and is imported — the
markup of the gate is still copied, because an app has to keep working when the
rest of the repo is gone, but the words a *code path* produces are one file.

The work turned up something older than the copy-paste. **vp did not notice a
second tab.** `vn`, `vi`, `vr`, `vd`, `vc` and `va` all carry three listeners —
coming back into view, `focus`, and the `storage` event — and all three ask
*storage* (`ai.storedId()`) rather than the client, because the client in a tab
still believes it is whoever loaded the page. vp had none of them: it repainted
on its own auth events only, so a second tab's sign-in left the first showing the
previous person's ledger until somebody reloaded. `auth-check.mjs` had been
reporting it for a while, in the one group `test-all.sh` does not run per app.

And the first fix did not work, for a reason worth writing down: the listeners
were registered inside `boot()` *after* the "there is already a session" branch,
so a person who arrived at the gate and only then typed a password never got
them. **A listener that only exists for people who were already signed in is not
a listener.** It is registered at module scope now, before `boot()`.

**vz had it too.** The same missing three listeners, and the same reason it went
unnoticed: `tools/test-settings.sh` walked six apps out of eight, so `auth-check`
never ran against `vz` or `vp`. Both are in the list now, with their own domains,
because *a group that is not in the list is a group that is green by absence*.

## 2026-11-24 (evening) — an id that is not an address

Three apps had **two `#art-msg`** elements: one in the side panel, one inside the
`input` dialog. `getElementById` returns the first, so every message written from
inside the dialog — *saving…*, an upload that failed, a pdf that would not
parse — was painted **behind the modal**, where nobody could read it. The dialog
had a message line that could never be written to.

The dialog's line is `#art-dlg-msg` now, and the three dialog paths (save, remove,
a read error) report there. The panel keeps the ones that belong to it: *reading a
pdf*, *3 added*.

Two lessons, both cheap:

- **`msg('#art-save', 'saving…')` wrote a message into a button.** `#art-save` is
  the *save* control; the helper sets `textContent` on whatever it is given, so
  the label of a button became the progress line for a moment. A helper that takes
  an id will happily take the wrong one.
- **A duplicate id is invisible until it matters.** The browser does not warn, the
  page looks right, and only the message nobody can see is missing. `chrome-check`
  now lists every id twice and fails, in all eight apps. It would have caught
  these three on the day they were written.

## 2026-11-25 — a policy is about a row; the bug was about a column

RLS answers "may this person touch this row". Four findings in the review were
the same mistake wearing different clothes: the code treated a permission on a
row as a permission on its **fields**, and each time the field was the one that
mattered — `credits_left` (money), `user_id` (whose document it is), `name` (who
somebody is), and, in `va`, the `task.md` that a model with a shell reads.

The fix has the same shape in all four: **stop writing the row, write one thing
through a function; refuse the rest with a trigger.** A `with check` cannot do
this job at all — by the time it runs, the column already holds the new value.

Two things went wrong on the way and both are worth the ink:

- **A policy whose `using` reads a column the caller may not read fails closed.**
  Taking `owner_id` away from `vp`'s holders looked like tightening a hole; it
  silently broke the charges ledger for everybody, holder and issuer alike,
  because the policy expression is evaluated with the caller's privileges. The
  answer is not to put the column back — it is to ask the question in one
  function that runs as its owner (`vp_can_see_key`).
- **A guard must name the write it permits.** `vp_codes_guard` refused every
  update by a person. Redeeming a slip *is* an update by a person
  (`redeemed_by = auth.uid()`), so the button stopped working and the failure
  looked like a broken app rather than a rule. The guard now permits the one
  forward step, and says so in a sentence.

Also learned: `create policy … for insert … as restrictive` is a syntax error —
`as restrictive` comes **before** `for`. It fails at the push, not in review.

## 2026-12-15 — an agent is a reader too

The house has always proved its rules; it had never made them *addressable*. A
suite named `bin-check.mjs` tells you that you broke the bin. Nothing told you
that the bin was a chip in the rail's head, or why, or which other forty rules
were standing behind the page you were about to edit.

Four documents and two commands:

- **`AGENTS.md`** — the page an assistant reads first: three commands, ten rules
  that bite (each with the test that catches it), where things live, what never
  to do. `CLAUDE.md` is one line pointing at it, because Claude Code looks for
  that name and Codex, Copilot and Cursor look for the other.
- **`docs/rules.md`** — the index. Every rule as *rule — why — proof*, grouped by
  what you are touching. `build-notes.md` stays the chronology; this is the
  lookup table.
- **`docs/cookbook.md`** — recipes with the commands in them: add a table, add a
  settings tab, add a bin, add a ninth app, deploy, back up.
- **`prompts/`** — three prompts that end with *read the summary line; do not
  claim what you did not run*.
- **`tools/map.sh`** — the map, generated: tables (including vn's, which arrived
  by `rename`), ports, the shell, the doors, every suite with its own header.
- **`tools/stage.sh --check`** — eight apps hold a copy of `packages/shell`.
  Editing the shell and forgetting to stage means every suite judges the old look
  and passes. That silence is now a red line, first in the gate.

Two ways the gate had been lying, both older than the agent work and both found
while writing it down:

1. **A missing test account exited 0.** A suite that never ran was counted as a
   pass by anything reading an exit code, which is exactly what an assistant
   does. Now it exits 78 (EX_CONFIG), the runner counts it as *skipped*, the
   summary prints it, and a run with a skip in it is **not green**.
   `VPL_ALLOW_ANON=1` restores the quiet behaviour for people who want it.
2. **`chrome-check` waited for *some* sentence from the dock.** The dock still
   held the answer to the previous question, so a slow neighbour — nine servers
   on one machine — looked exactly like an app that had answered wrongly. It
   waits for a *new* sentence now. `bin-check` likewise asks a second time before
   calling a swallowed ✕ click a break.

Also this pass: `vn`'s bin moved from the foot of the tree into the rail's head,
and the head became the drop zone, so all eight apps answer the same question the
same way — and `dnd-check` (24) and `touch-check` (9, rotted and repaired, it had
been waiting for a `#btn-list` that has not existed for months) are in the gate so
a moved target cannot change silently.

The gate is **40 groups**. It was 37 an hour ago and 35 before that; the number
is not the point, the fact that nothing is skipped is.

---

## 2026-12-23 — the edge is a handle, and a token is a person

Four things were asked for in one breath: the themes were eating vr's rail, ✕
destroyed instead of binning, the rail had one width for everybody, and an agent
should be able to work without clicking.

**The rail had no floor.** `.themes` was `flex: 1` beside `.proj-list` that was
also `flex: 1`, so the two lists split whatever was left *after* the taller one
took what it wanted — and the themes, being a tree, took nearly all of it: one
visible project row at 45 themes. `proj-list` now has `min-height: 4.5rem` and
`themes` is `flex: 0 1 auto; max-height: 45%`, each with its own scroller.
Measured: 12 themes → 595/157 px, 45 themes → 414/338 px. The rule underneath is
older than this app: **two lists in one column need a floor and a ceiling, or the
taller one wins.**

**The container was not in the bin.** Seven apps binned rows and three of them
still destroyed the thing that held the rows. `vd`, `vc` and `va` had `deleted_at`
on their projects since `20261214000000`; `vi`, `vr` and `vz` did not.
`20261223000000_project_bin_vi_vr_vz.sql` adds one nullable column to each, and
the rail's ✕ stops asking a question and starts keeping a promise. The rail grew
a **second** bin chip for it (`♲ funnels`, `♲ docs`), because a bin for rows and a
bin for containers are two different losses and two bins must not share a word.
The vz fix had a second half: `vz_read_public` served a binned project at its
public address. It now asks `deleted_at is null` too — proved by reading a binned
publish code (`null`) and a live one (its keys).

**The rail had one width.** `packages/shell/rail.js` is new: a 9 px separator
that sits *over* the border (so it costs the layout nothing), drag or arrow keys,
Home/End for the ends, double-click to go back, one remembered width per app,
clamped to 46 % of the window, hidden under 720 px where the rail is a drawer.
Each app's `.body` now asks for `var(--rail-w, 14rem)` instead of naming a
number, so the handle writes one variable and every layout follows. vn keeps
`--list-w`, which is the same idea under an older name.
`ux-sniff` learned one exception: a `role="separator"` is an edge, not a target,
so the 30 px floor does not apply to it — it is still named and still reachable.

**An agent should not click.** The answer is not a new service; it is that the
apps already have an API and nobody had written it down. `docs/api.md` documents
signing in with a password grant, the tokens, every app's tables, the closed
lists, the bin, uploads, the four doors and the refusals. `tools/vpl-api.mjs` is
the twenty-line version of that document: `login`, `me`, `get`, `post`, `patch`,
`delete`, `rpc`, with the token cached and refreshed. The design decision worth
keeping is the sentence in the file: **a token is a person** — every call runs as
that account, row-level security decides, and the service key is never held by a
tool, because it would make every rule above optional.

Two things were learned by doing rather than by reading. `user_id` is not a
default in the database (the insert policy asks whether the row is you), so the
tool fills it and the document says so. And an upload path starts with the
**project** id (`va_path_project` reads the first segment), not the user id — a
path starting with the user id is refused with the same `42501` as everything
else, which is why the first attempt looked like a permissions mystery.

The gate is now **48 groups** (seven more for `rail-check`, one for `api-check`),
and `api-check` runs with no browser at all.

---

## 2026-11-26/12-23 — the other laptop, and why its list was worth more than mine

A second agent was given one ordinary job on a Windows machine, with no access
to this repository — only the deployed apps and the public REST API. It came
back with seven authorization findings and two runnable skills. Five of the
seven were one mistake wearing different tables, and none of them were visible
from inside the house, where every test signs in as the owner.

**What it found.** A guest could mint a share, with `edit`, for a third party —
the policy asked whether `owner_id` was the caller, and `owner_id` is a column
the client sends. An editor could bin the owner's project, and destroy rows for
good in five tables. A `view` guest could insert an idea. A row a guest wrote was
invisible to the project's owner — the read policy asked "is this row yours?" and
the answer for the owner was no. A guest could re-parent and re-order somebody
else's note. An editor could write a compliance verdict with no run behind it.
And, found while fixing those: `vr_themes` and `vr_vocab` said *if anybody holds
a link code for this document, everyone with an account may read this table*.

**The migration** (`20261224000000_the_other_laptops_findings`) drops every
policy on eighteen tables before writing anything. That is the lesson worth
keeping: **policies are OR'd**, so a narrower rule added beside a wide one
changes nothing, and a hole looks closed until somebody walks through the old
door. Then four questions per table, answered the same way everywhere: read = me
or the project's owner or anybody it was shared with; insert = me into a project
I own or may edit; update = the owner or an editor; delete = me or the owner (an
editor bins, never destroys). Columns that are decisions rather than content —
`deleted_at`, a note's `parent_id`/`position`, a control's three counts — are
triggers, because a policy cannot see a column.

**Two of the fixes were not in the database.** `va_jobs` insert is owner-only
(VA-1, from December), so `apps/va` stopped offering a guest a generate button
that the database would refuse, and says *the owner starts a job here* instead —
a button that cannot do what it says is worse than no button. And the worker's
ability to claim a job had to stay `va_can_edit`: my first rewrite narrowed it to
"your own row or the owner's" and `va-handoff.mjs` failed in one run, which is
exactly what the gate is for. Two migrations later, the story is: the insert is
the owner's, the claiming is the colleague's, and `va_jobs_guard` is the limit.

**The skills.** `skills/vpl-notes` and `skills/vpl-apps` — a `SKILL.md` plus one
script each — are the other half of the kit, and the more useful half for a
person: *write a note called X, put a table in it, share it with an address* is
now six commands from a cold start. They are in the repository, symlinked into
`~/.agents/skills/`, and their traps are the traps the other agent actually hit
(`vn_shares` names `owner_id`, not `user_id`; `tools/vpl-api.mjs post vn_shares`
fails with `PGRST204` because that tool fills `user_id` into every row; a share
for an address with no account is `pending` and grants nothing).

**The two scripts became gate groups**: `authz-matrix.mjs` walks the grid (six
apps, `view` then `edit`, plus a third account that must see nothing) and
`authz-confirm.mjs` proves the seven one at a time, so a regression names itself.
Both exit 78 without their accounts.

What this says about the way we work here: the owner's-eye view is the biased
one. A test that signs in as the person who owns everything can never find a
sharing bug, and it had been "green" for a month.

---

## 2026-12-24 — the relay and the header

The last two of the security review's findings, and they were both "low" for the
same reason: nobody could see the exploit from inside.

**C7/VP-4, the relay.** The doors answered the origin list and nothing else, and
an origin is a header — a program sends what it likes. The obvious fix, an HMAC
minted by the page, is theatre: the secret would be in the page. So the doors now
**bound** what they give away instead of pretending to know who is asking:
`_door.js` refuses anything that is not a POST (405), has no `Origin` (403), is
not json (415), or is over the route's cap (413) — before reading a body, in one
file the four doors share, because `vp` had been accepting a megabyte of JSON and
a form post. `_limit.js` counts sixty calls a minute per address and route in the
edge cache: per-colo, eventually consistent, a speed bump documented as a speed
bump. Nothing secret lives behind a door, so the worst a relay can do is spend
the caller's own quota.

Writing the test found a real bug: the origin list's dotted entries matched
`abc.vpl-vi.pages.dev` but **not** the stable `vpl-vi.pages.dev`, so the suite's
own Pages addresses were refused by its own doors. One line, one assertion.

**C8, the header.** No app had a CSP, and the model key and the session are in
`localStorage` — which makes any XSS in any app a stolen key, not a stolen
paragraph. All eight now send one policy (`apps/<app>/_headers`), and `serve.py`
sends it too, so the local suite tests the page that is deployed: jsdelivr for
the four libraries, no `'unsafe-inline'` for scripts, no `'unsafe-eval'`, and
`object-src`, `base-uri`, `frame-ancestors` and `form-action` closed.

The first thing the policy refused was the app's own theme boot — four lines of
inline `<script>` in eight `index.html` files, the thing that stops the flash of
the wrong theme. It is one file now, `packages/shell/theme.js`, copied into every
`vendor/` by `stage.sh` and loaded blocking before the stylesheet. Eight copies
of a script became one copy of a file, and the policy stayed strict, which is the
shape this repository keeps arriving at: **the shell is a copy, and the checks are
what make a copy safe.**

`csp-check.mjs` does not read the header and call it a day — it walks each app
(sign in, open, settings, theme) and then imports pdf.js and starts its worker,
the one path in the suite that needs `worker-src` and `'wasm-unsafe-eval'`, and
counts the browser's own "Refused to…" lines: zero, in all eight, 128 assertions.
`door-check.mjs` proves the refusals and the bound with no network at all.

The gate is **52 groups**.

## the same day, one more — a redirect is a new address

VC-3 was the last of the review's findings that was still true: `/fetch` used
`redirect: 'follow'` and asked about the host afterwards. The body was never
returned, so it was "only" a blind request — but a blind request to
`169.254.169.254` is how a metadata endpoint is asked a question, and "did it
answer" is the answer.

The door now walks redirects itself: `redirect: 'manual'`, each hop's protocol
and host checked **before** it is fetched, three hops as the limit, and the
answer says where it actually read. `fetch-check.mjs` proves it by replacing
`fetch` with a recorder, which is also how the test can assert the important
half — that an off-list redirect made **one** request, not two.

The gate is **53 groups**. What is left of the review is one item, and it is a
decision rather than a bug: the model key lives in `localStorage`.

### and the bound has to be visible

The first version of the rate limit was a silent `try/catch` that allowed
everything when the cache refused — and it did, so the live door answered 33
requests in a row and my own claim ("sixty a minute") was false while the test
was green. The test could not see it: a fake cache always works. What fixed it
was the smallest possible observability: the count moved into `_middleware.js`
(one count, not four), and every door answer now carries `X-Vpl-Limit: 1/60` or
`unbounded`. Then a `for` loop in a terminal answered the question in five
seconds: 30 answers, then `429` with `retry-after: 60`. **A claim about the edge
needs a header, not a unit test.**
