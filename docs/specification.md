# vpl — specification

**Vixen Productivity Light**
Status: draft for day 1, written while Vixen is out walking.
This is not an architecture. **This is 0-Architecture** — the document that
says what exists, what does not, and why nothing else is allowed in.

---

## 0. The constraint

**One repo, one database, one deploy target, zero servers, zero euro.**

If a requirement below can only be met by adding a server, a queue, a worker
fleet, an admin panel or a build pipeline, it is **not a requirement** — it is a
proposal, and it goes to `idea/sidenote.md` to be argued about later.

The success metric is not features. It is **lightness**: how few things exist.

---

## 1. Who uses it

| Actor | What they do |
|---|---|
| **Vixen** | One person, on her own machine, most of the time. Writes scraps. Sometimes hands a laptop to a friend. |
| **A friend / colleague** | Logs in with Google. Sees their own notes only. Nothing shared unless a note is made public. |
| **Nobody else** | There is no admin. No roles. No team. No orgs. No billing. |

**Explicitly not a user:** a team, an enterprise, a customer, a support agent.
If one appears, this document is wrong and must be rewritten.

---

## 2. Wishes, verbatim from Vixen

> "korisnik se prijavi sa emailom, pise stranice i moze gledati, ako je md onda
> se renderira, moze ubacivati i mermaid diagrame"
>
> "korisnik ima dva moda pregled i pisanje/editoiranje/kreiranje"
>
> "za pocetak samo on gleda i pise, a moze raditi sa bilo cega"
>
> "to je super light"
>
> "light ideje i zapisnike/note kao sto je u joplinu, ali da je super light"
>
> "lijevak u 3 faze (graficki), i pri svakoj fazi lijepis notes-e sa idejama
> i raspravom"

---

## 3. Requirements

### 3.1 Must have (day 2)

| # | Requirement | Accept test |
|---|---|---|
| R1 | Sign in with email + password | User registers, logs in, session survives reload |
| R2 | Sign in with Google | One click, returns to app logged in |
| R3 | Create a note | Title + body, saved, appears in list |
| R4 | Read a note rendered | Markdown → HTML, safely |
| R5 | Edit a note | Two modes: VIEW and EDIT, `Ctrl/Cmd+E` toggles |
| R6 | Autosave | 800 ms debounce, no Save button, no dialog |
| R7 | Delete a note | Confirmation once, then gone |
| R8 | List notes | By `updated_at`, newest first, with a title and a hint of body |
| R9 | RLS | User A cannot read user B's note, proven by a test |
| R10 | Mermaid | A ```mermaid block renders as a diagram; a broken one shows an error, not a crash |
| R11 | Works on a phone | Layout usable at 375 px wide |
| R12 | Deploys | `git push` → live on a `<your-domain>` subdomain |

### 3.2 Must have (day 3 — the funnel)

| # | Requirement | Accept test |
|---|---|---|
| R13 | Send note to funnel | One click in a note; `stage` becomes `inbox` |
| R14 | Funnel view | Three columns, visually narrowing: inbox / explore / build |
| R15 | Gate | Moving a note from inbox→explore requires a decision note ("why") |
| R16 | Attach discussion | A note can be linked to a funnel idea; it appears under it |
| R17 | Back to notes | A funnel idea is still editable as a normal note |

### 3.3 Deliberately absent

Not "later". **Absent.** If someone asks, the answer is this section.

- Folders, nested notebooks, trees
- Tag hierarchies (flat tags only, or none)
- Attachments, file uploads, images in notes
- Sharing, permissions, teams, orgs
- Comments, mentions, notifications
- Version history of a note (git is our history, not the app's)
- Mobile apps (the PWA is the mobile app)
- Offline editing with conflict merge (read-only offline cache only)
- Search across everything (browser find is enough until it isn't)
- An editor like ProseMirror/Quill/TipTap — plain textarea
- AI features in v1
- Analytics, telemetry, cookie banners
- Any server-side code

---

## 4. What exists

### 4.1 One table

```sql
create table notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',
  tags        text[] not null default '{}',
  stage       text not null default 'none'
              check (stage in ('none','inbox','explore','build')),
  gate_note   text,
  parent_id   uuid references notes(id) on delete set null,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

That is the entire data model. One table. Seven meaningful columns.

- `stage = 'none'` → an ordinary note (the 90% case)
- `stage = 'inbox'|'explore'|'build'` → it is in the funnel
- `parent_id` → this note is attached to a funnel idea
- `gate_note` → why it moved, or why it died

**No second table.** If a feature needs one, the feature is wrong.

### 4.2 Three security policies

```sql
alter table notes enable row level security;

create policy "own all"    on notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "public read" on notes for select
  using (is_public = true);
```

Everything else about security is the database's job, not ours.

### 4.3 Two routes

```
/                → list of notes
/n/:id           → one note: VIEW or EDIT
/funnel          → the funnel, three columns (day 3)
```

Plus `/login`. That is the whole app.

### 4.4 Files

```
work/vpl/
├── index.html          one page, no router library, hash routing or History API
├── app.js              ~400 lines, no framework
├── style.css           one stylesheet, CSS variables
├── lib/
│   ├── supabase.js     thin wrapper, one client
│   ├── markdown.js     marked + dompurify
│   └── mermaid.js      lazy-loaded only when a note has a mermaid block
├── icons/              a handful of SVG, hand-picked, or none at all
├── sw.js               service worker, cache the shell
└── manifest.webmanifest
```

**No build step.** Files are served as written. Vite is available if a bundle
ever becomes necessary, but the default is: there is no bundler.

**No framework.** Not because React is bad, but because for two views and one
table it is 60 KB of runtime to save 60 lines of code.

---

## 5. What a request looks like

```
GET /rest/v1/notes?select=id,title,updated_at&order=updated_at.desc
    Authorization: Bearer <user jwt>
```

Postgres + Row Level Security decides what comes back. There is no API we wrote.
**The database is the API.**

---

## 6. Non-negotiable small things

1. **DOMPurify on every render.** Markdown can contain HTML. Unsanitised render
   is an XSS bug, not a feature.
2. **Mermaid is dynamic.** `import()` only inside the renderer, only when the
   regex ` ```mermaid ` matches. Never in the initial bundle.
3. **`anon` key is public.** That is correct and expected. RLS is the lock, not
   the key.
4. **No service_role key in the client. Ever.** It bypasses RLS.
5. **Autosave is silent.** No toast, no spinner, no "saved!" popup. The note
   simply exists in its new state.
6. **Tab title turns into a dot** when a note has unsaved changes. That is the
   only saving indicator allowed.

---

## 7. The funnel, drawn

```
        ┌──────────────────────────────────────┐
        │  INBOX                               │  ← every scrap, no filter
        │  ▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸       │     100% width
        └─────────────────┬────────────────────┘
                          │  GATE 1
                          │  "worth thinking about?"
                          │  → keep / scrap (with reason)
        ┌─────────────────▼────────────────────┐
        │  EXPLORE                             │
        │  ▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸▸                  │      60% width
        └─────────────────┬────────────────────┘
                          │  GATE 2
                          │  "do we build it?"
                          │  → build / park (with reason)
        ┌─────────────────▼────────────────────┐
        │  BUILD                               │
        │  ▸▸▸▸▸▸▸▸▸▸▸▸                        │      30% width
        └──────────────────────────────────────┘
```

The narrowing is not decoration. **The number of items in each column should
actually decrease.** If the columns stay full, the gates are being skipped and
the funnel is theatre.

Every gate writes to `gate_note`. A decision with no reason is not a decision.

---

## 8. Risks, honestly

| Risk | What we do about it |
|---|---|
| Supabase pauses after 7 days idle | Weekly ping. Not elegant, works. |
| `marked` + DOMPurify + mermaid ≈ 350 KB | mermaid is lazy; the rest is ~40 KB |
| Someone asks for folders | Answer is section 3.3, not a feature |
| Funnel becomes a kanban board with no decisions | Gates are mandatory; a test asserts the moved note has `gate_note` |
| Two views drift into two apps | Both read the same table; no second data store |
| The code grows a bundler | Review: if a build step appears, ask why |
| 500 MB database | Ten thousand notes is 20 MB. Nothing to do. |

---

## 9. Day 2 plan (in order, no parallel work)

1. Migration `notes` + RLS → `supabase db push`
2. Shell: `index.html`, `style.css`, mode toggle, list view
3. Auth: email + password register/login/logout
4. Create / read / edit / delete, autosave
5. Markdown render + DOMPurify
6. Mermaid lazy
7. Playwright test: two users, RLS isolation proven
8. Google OIDC (needs one click from Vixen — the only blocker)
9. PWA manifest + service worker
10. Deploy: `vpl.<your-domain>` via Cloudflare Pages (needs one `wrangler login`)

**Two clicks in total are needed from Vixen.** Everything else is mechanical.

---

## 10. What this document refuses to become

It will not grow into a design system, a component library, a state machine, a
plugin architecture or a roadmap. When the product needs those, it will be
because it earned them — not because a document said so in advance.

> *Zero architecture is not the absence of design. It is the refusal to build
> rooms nobody will sit in.*
