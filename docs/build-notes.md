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

- R12 deploy to a `terg.hr` subdomain (`wrangler login` — needs Vixen). A
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

The site lives at **https://vn.terg.hr** (`vn` for vpl notes), served by the
Pages project `vpl` and its DNS record `vn → vpl-ae9.pages.dev`, proxied. The
preview of any deployment is `https://<hash>.vpl-ae9.pages.dev`. Adding the
custom domain was one API call; adding the CNAME needs the dashboard, because
the wrangler login token may write Pages but not DNS:

    terg.hr → DNS → Add record → CNAME, name `vn`, target `vpl-ae9.pages.dev`,
    proxy on

Then these two, in this order:

1. **Supabase -> Authentication -> URL Configuration**: set **Site URL** to
   `https://vn.terg.hr` and **Redirect URLs** to `https://vn.terg.hr/**`. Until this
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

- **Site URL** — `https://vn.terg.hr`. The dashboard offers exactly one value and
  that is the point: the app sends its own address with every sign-in, so the
  per-app addresses belong in the list below, not here
- **Redirect URLs** — one entry per app, with the wildcard so query strings work:
  `https://vn.terg.hr/**`, `https://vi.terg.hr/**`, and for local work
  `http://127.0.0.1:8099/**` and `http://127.0.0.1:8100/**`
- **Confirm email** — off, deliberately: the suite has no recovery address habit
  and a confirmation link is a second place to get stuck

The failure mode is quiet, which is why it reads like a bug in the app: Supabase
can only redirect to an address on the list, so a round trip from `vi` with only
`vn` allowed returns to `vn`, already signed in. Add the entry, sign out, sign in
again from `vi`, and it stays in `vi`.

Checked on 21 Nov 2026 after the entries were added: clicking **continue with
Google** on `vi.terg.hr` reaches Google's consent page with
`redirect_uri=https://ebhrjstllsazywbxnbqt.supabase.co/auth/v1/callback` and no
`redirect_uri_mismatch`, and the authorize call carries
`redirect_to=https://vi.terg.hr/` — the same for `vn`. What remains is a person
with a Google account finishing the round trip and watching the address bar.

None of this is a repository change. It is a dashboard step, done once, and it is
the one step in the whole suite that cannot be code.
