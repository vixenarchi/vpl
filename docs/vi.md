# vi — vixen idea

An idea funnel you can see. One project, five stages, four of them numbered.
The point is not the database or the model — it is that a person who has never
read a lean book can look at the screen and know what to do next.

`vi` is the second app of the suite: its own tables (`vi_`), its own domain
(`vi.terg.hr`), the same signed-in person, the same shell palette.

## Why a funnel

Ash Maurya's reference funnel (LEANSTACK, 2018) runs Strategy Alignment →
Ideation → Exploration → Selection → Validation → Growth and optimises three
things: the quality and quantity at the top, the **conversion between stages**,
and **time to conversion**.

Six stages is a wall. Five is a story:

- **Context** (optional, not numbered) — the constraints. Skipping it is
  allowed and never punished.
- **1 Ideation** — quantity, no judgement.
- **2 Exploration** — turn an idea into a business: customer, problem, rough
  size, the facts that decide whether it is worth a month.
- **3 Selection** — one idea chosen, with a written reason. Everything else is
  parked, also with a reason.
- **4 Simulation** — validation tests, refinement, and a projection whose
  assumptions are labelled.

Validation and Growth are merged into Simulation on purpose. Growth is the
stage that needs real customers and real months; pretending to run it inside an
app would be theatre.

## The rule that keeps it a funnel

A funnel is not a list of columns. It is decisions with reasons.

- Leaving Exploration requires: **customer**, **problem**, **rough size**, and
  at least **one checkable fact**, with its source.
- Selection requires: **exactly one** chosen idea and **one line why**; every
  other idea is parked with a line why not now.
- Simulation requires: **three assumptions that could be wrong** and what would
  be measured.

Without those, the model produces plausible text forever and the funnel becomes
a kanban board with no decisions — which is exactly what the v1 spec warns
about.

## What the screen is

```
┌ bar ───────────────────────────────────────────────── vpl · vi · idea ┐
├ projects (one level) ┬ project ────────────────────────────────────────┤
│  › Rooftop ERP       │  ROOFTOP ERP           6 ideas · 2 explored     │
│  › Idea funnel       │                                                │
│  + new project       │   (0)──(1)──(2)──(3)──(4)      the road         │
│                      │  context ideate explore select simulate        │
│                      │  ────────────────────────────────────────────── │
│                      │  funnel bands: name and count, clickable        │
│                      │  ────────────────────────────────────────────── │
│                      │  parked ideas (drawer)                          │
│                      │  ────────────────────────────────────────────── │
│                      │  ┌ PANEL 1 · THE WALL ────────────────────┐    │
│                      │  │ the stage's own surface, comic framed    │    │
│                      │  └──────────────────────────────────────────┘   │
└──────────────────────┴─────────────────────────────────────────────────┘
```

The left side is a flat list of projects, never a tree: an idea funnel belongs
to one project, projects do not nest.

## The look, and why it is not a dashboard

The first build was correct and lifeless: five small cards in a row, a table of
colours, a tool that felt like SAP. This is the app where a half-formed idea is
supposed to feel welcome, so the screen is a **comic page read as a road**:

- five **stops** on a winding dotted line, chunky round buttons with a hard ink
  shadow that presses down when tapped — Duolingo's grammar, not its mascot
- ink outlines, offset shadows, slightly tilted bands, a **caption tab** on every
  panel (`panel 2 · the field`), halftone dots in the corner and behind the
  project list
- three typefaces doing three jobs: **Bangers** shouts (captions, stage names,
  numbers), **Nunito** explains, **Caveat** is the handwriting on a sticky note
- motion is small and physical: a stop hops when it becomes current and spins a
  dashed ring, notes land with a slap, the panel is a page, not a card

Two rules survive the costume. Colour is never the only signal — every stop has
a number, a word and an icon. And the same four stages appear twice: as stops
(story) and as bands (picture). Both navigate; neither is decoration.

**Never centre typed text.** No centred input, no centred dialog.

## Stages in detail

### Context (optional)

Free text, or a pile of words: "construction · saturated · capabilities:
high-rise, commercial, residential, roofing". A **Formulate** button turns the
pile into three or four sentences of constraints, which the person can then fix
by hand.

Stored as `vi_projects.context`. Nothing depends on it being filled.

### 1 Ideation

Sticky notes. One line each, one colour from a small palette, added by typing or
by **add with AI** (the model gets the context and the title and proposes 5–8
more, each landing as its own note, each deletable). Nothing is ranked here.

Stored as `vi_ideas` rows with `stage = 'ideation'`.

### 2 Exploration

Pick an idea, then work it. The model writes a first pass — customer, problem,
job to be done, rough size, why now, what would prove it — and the person edits
the text underneath. Exploration text is kept per idea, appended as versions, so
a second pass does not erase the first.

Search arrives here (last on the roadmap): one or two key facts with sources,
through our proxy, not through the model's imagination.

Stored as `vi_ideas.exploration` (markdown) with `vi_ideas.explored_at`.

### 3 Selection

The model proposes two or three candidates with one sentence each. The person
chooses **one**. The chosen idea becomes `stage = 'selected'`; every other
explored idea becomes `stage = 'parked'` with a written reason. Parking is not
deleting: parked ideas sit in a box at the bottom of the funnel and can be
restored or **swapped** with the current choice at any time.

Stored as `vi_ideas.stage`, `vi_ideas.reason`, `vi_projects.chosen_id`.

### 4 Simulation

Three panels of text, no spreadsheet:

- **tests** — what will be tested, with whom, what counts as success or failure
- **refinement** — what changes after each test
- **projection** — numbers only with their assumptions spelled out ("2 % of
  40 000 firms, because…")

Stored as `vi_projects.simulation` (markdown, versioned).

## Tables

Almost nothing, on purpose.

- **vi_projects** — `id, user_id, title, context, exploration, simulation,
  chosen_id, created_at, updated_at`. One row per funnel; the stage texts live
  here because they are the project's own document.
- **vi_ideas** — `id, project_id, user_id, text, stage, color, reason,
  exploration, explored_at, position, created_at, updated_at`. `stage` is one of
  `ideation | parked | selected | simulated`.

Two tables, one level of nesting, no joins across apps. `vi_projects` and
`vi_ideas` are owner-only through RLS; sharing (public link plus per-email view
/ edit) reuses the `vn` shape with `vi_` names when it is built, and is a
deliberate next step, not part of the first screen.

## The model, and why nothing is "smart"

Every stage is one call with a fixed prompt and the project's own text as
context. There is no agent loop, no memory, no embedding store. The quality
lives in the prompts, so they live in one file in the app (`prompts.js`), one
constant per stage, readable and editable without touching the UI.

**The model speaks in a balloon.** Nothing it writes lands in a field on its
own: it says something in a speech bubble, and the person presses *use it* or
*drop*. The balloon is the whole etiquette of the app in one component — the
model is a colleague with an opinion, not an author with a keyboard.

**Which model.** Measured, not guessed: five real calls per model through the
funnel, same project, same prompts. `gemini-3.1-flash-lite` won at 1.3 s an
answer with the four labels intact and arithmetic that multiplies out;
`nvidia/nemotron-3.5-bolt-e4b` is faster (0.7 s) and much thinner — it copies
the same market size into two different explorations and cannot name a pick;
`nemotron-3.5-lightning` writes the best prose of the free NVIDIA set and gets
its projection wrong by a factor of nine; `mistral-large-4-1t` takes over a
minute per answer and is unusable in a click-through. `gemini-3.8-flash` is
announced but answered 503, and `gemini-2.5-flash` is retired for new keys.
The prompt work that came out of this — labels on every line, brackets on every
figure, "multiply it out before you answer", a `plain()` belt that strips
markdown anyway — is what makes the cheap models usable.

**Evidence is search, not imagination.** Exploration has a `find facts` button
that sends one query to `/api/search` (our proxy) and returns two to four real
results with their sources, which are added to the draft as bracketed facts.
The key is the person's own, chosen in the same settings dialog: Tavily (1000
free, no card) or Serper (2500). The rule this enforces: a claim about the
market needs a source, and an assumption is written as `[assumption]`.

- the key is the person's own, kept in their browser, as in `vn`
- calls go through the suite's proxy (`/api/chat`, then `api.terg.hr`), because
  model APIs do not send CORS headers
- every AI output is **added** to the stage text, never written over it

## Roadmap

1. ~~the screen: projects, four steps, funnel, sticky notes, parked box~~ done (`f7ca5c5`)
2. the model: formulate context, add ideas, explore, propose, simulate
3. ~~the search: Tavily or Serper through `/api/search`, results as facts with
   sources in Exploration; the person brings their own key~~ done (`/search` on
   api.terg.hr)
4. sharing: public link and per-email grants, `vi_shares`
5. import: parked idea → a note in `vn` through copy-paste markdown, never a
   cross-app write

## Non-goals

No kanban columns, no drag-and-drop between stages, no scores, no deadlines, no
reminders, no attachments, no teams, no realtime, no vector search, no charts.

The funnel is the picture. The decisions are the product.
