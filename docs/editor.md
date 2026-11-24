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

## N / MD, and ¶

At the right end of the formatting bar (`left` end on a phone, where a wrapped
toolbar cannot hide it):

- **N / MD** — the writing surface as rich text, or as the markdown that is
  actually stored. Pressed, the button inverts (ink on paper) and the surface
  becomes a monospace textarea. That is also how the hidden formatting is seen,
  and the only honest way to type what the toolbar cannot reach (`::: box`,
  fences, tables). `Ctrl+M`.
- **¶** — shows the marks the way a word processor does: `·` a space, `¶` the
  end of a line, `°` a hard space. Marks exist only on screen; the body is
  stripped back on the way in, so a note can never be saved with a pilcrow in
  it.

Both live off the same body: switching costs nothing and saves nothing.

## A paste is cleaned at the door

A paste from a word processor carries fonts, sizes, colours and spans that
markdown cannot hold. Left alone the browser shows them, and the next render
drops them — "the formatting disappeared after a while". So `cleanHtml()` runs
on the way in: DOMPurify, then a rewrite into the editor's own alphabet
(`<span style="font-weight:700">` becomes `<strong>`, `div` becomes `p`), and
every remaining `style` attribute — including the ones Chrome re-applies on
insert — removed. What you see immediately after a paste is what will be saved.

## Tests

`apps/vn/test/md-check.mjs` (26) — bare addresses stay text, the two surfaces
share their measurements, blank lines survive a save and a reload, N/MD and ¶
work and save nothing of themselves, a rich paste keeps words and loses
colours, and the settings switch is the `◐` icon again.
