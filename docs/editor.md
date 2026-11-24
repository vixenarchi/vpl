# The writing surface

What a person types, what is stored, and why pressing *view* must not change
the answer. This is the contract behind `apps/vn/lib/editor.js` (storage ⇄
screen) and `apps/vn/lib/markdown.js` (markdown → what you read).

## Text is text; a link is a decision

`http://nesto.hr` and `www.nesto.domena` are **words** until somebody makes
them a link. GFM's autolinker turned every bare address into an `<a>` on sight,
so a note was quietly different in *view* from what had been written in
*write*. The renderer now overrides marked's url tokenizer and the token never
exists:

- `[words](https://address)` — a link.
- `https://address` — the address, in ink, like any other word.

## One shape in both surfaces

The rendered view used to carry its own typography (serif headings, `line-height
1.75`, `0.7em` paragraph margins) against the editor's (sans headings, `1.55`,
no margins). The same text therefore grew lines and gaps as soon as you pressed
*view*. Both surfaces are now measured by one block in `apps/vn/style.css`:
same font, same size, same line height, same heading margins, no paragraph
margin. `md-check.mjs` fails if they drift.

## Blank lines

Markdown has no way to say *blank line here* that is not also the separator
between two paragraphs. So the two are written differently:

- **One blank line** (`\n\n`) separates two blocks. It draws nothing.
- **An empty paragraph** — a blank line the person typed and wants to see — is
  stored as a line holding a single non-breaking space (`\u00a0`).

`htmlToMd` writes the second and `mdToHtml` reads it back as `<p><br></p>`.
Before this, every save collapsed runs of `\n` and dropped empty paragraphs:
"it eats my Enters" was exactly that bug.

## N / M

At the right end of the formatting bar (the left end on a phone, where a wrapped
toolbar cannot hide it):

- **N** — the surface is rich text.
- **M** — the surface is the markdown that is actually stored: a monospace
  textarea, editable, autosaved like everything else. Pressed, the button
  inverts (ink on paper). That is also how the hidden formatting is seen, and
  the only honest way to type what the toolbar cannot reach (`::: box`, fences,
  tables). `Ctrl+M`.

Only one thing scrolls at a time. While the markdown is showing, the page column
stops scrolling and the text does its own: two nested scrollbars in the same
place is a thing you cannot drag with any confidence.

## A paste is cleaned at the door

A paste from a word processor carries fonts, sizes, colours and spans that
markdown cannot hold. Left alone the browser shows them, and the next render
drops them — "the formatting disappeared after a while". So `cleanHtml()` runs
on the way in: DOMPurify, then a rewrite into the editor's own alphabet
(`<span style="font-weight:700">` becomes `<strong>`, `div` becomes `p`), and
every remaining `style` attribute — including the ones Chrome re-applies on
insert — removed. What you see immediately after a paste is what will be saved.

## Tests

`apps/vn/test/md-check.mjs` (23) — bare addresses stay text, the two surfaces
share their measurements, blank lines survive a save and a reload, N/M works and
saves nothing of itself, a rich paste keeps words and loses colours, and the
settings switch is the `◐` icon again.

`apps/vn/test/dock-check.mjs` (20) — the dock knows the note, is told to answer
with the changed text only, offers *replace selection* when words are selected
and *use it* when they are not, keeps a short memory, and never grows the page
upward.

## The dock

The chat line at the bottom of every app is one component
(`packages/shell/dock.js`) copied into each app. It keeps three rules:

- **It is given the work, not a scrape of the page.** An app passes
  `context: () => ({ text, selection })`. vn passes the title and the body, plus
  the words the person selected — remembered the moment they were selected,
  because asking a question means clicking the dock's input, and that click
  ends the selection.
- **A change is answered with the changed text only.** The system prompt says
  so: rewrite, shorten, fix, translate, continue → answer with the new text and
  nothing else, because that answer goes into a document. A question is still a
  question.
- **Nothing lands on its own.** Two verbs, and the label says which:
  *replace selection* when there was a selection (the answer takes its place),
  *use it* when there was not (the answer goes in at the caret). *drop* throws
  it away. It keeps the last two exchanges so "shorter still" has a subject.

### One dock, eight contexts

The dock is one file and eight ways of being given the work. None of them
scrapes the screen — the page is a wall of status words, and a model asked
"make this shorter" needs the sentence, not the table:

- **vn** — the title, the body, and the remembered selection. *replace
  selection*.
- **vi** — the wall's ideas as a list, and the card in front of you. *use it*
  pins a new card; there is no selection to replace in a funnel.
- **vr** — the brief, and the requirement whose detail is open, with its
  strength and status. *use it* writes into the field the person was last
  writing in: the brief or the requirement's sentence.
- **vz** — the dictionary's name, the open pair and the first rows. *use it*
  writes the value.
- **vd / vc / va** — the job's name and the document on the desk (its kind
  too); when there is no document yet, the brief. *use it* goes into
  `#out-body` through the same autosave as typing, so the row follows 750 ms
  later like any other keystroke.
- **vp** — codes in the drawer, and **no button**: a key, a credit and a ledger
  have nowhere honest for chat prose to land.

One helper makes the textarea case work at all: a textarea keeps its
`selectionStart`/`selectionEnd` when it loses focus, so the last field with the
caret in it (`lastField()`) is enough — no remembered DOM range is needed
outside vn's contenteditable. `putInto()` writes over that range and fires
`input`, which is exactly what every app's autosave listens for.

The transcript is a **layer**, not a growing column: about three rows, capped
and scrolled inside itself, sitting exactly on top of the line. Before this it
stretched the app's column upward, and the work area walked off the screen.

The settings dialog is the same size on every tab: the four panels share one
grid cell, the tallest sets the height, and the hidden ones are invisible rather
than removed. (`hidden` cannot be used — the tokens make it
`display: none !important`, and a tab that leaves the layout is a dialog that
resizes under the finger.)
