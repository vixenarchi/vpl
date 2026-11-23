# ux — the measurable half

Taste has to be argued; the floor does not. `apps/vn/test/ux-sniff.mjs` opens
every app twice (a desk at 1280×900 and a phone at 390×844), signs in, and
measures four things that are wrong in any design system:

- **a control too small to hit** — under 30 px in either direction;
- **type too small to read** — under 10.5 px;
- **a control with nothing to announce it** — no label, no text, no `aria-label`;
- **a page that scrolls sideways.**

```bash
node ux-sniff.mjs                                   # every local app, one table
VPL_PROD=1 node ux-sniff.mjs                        # the deployments
APP_URL=http://127.0.0.1:8107 APP_NAME=va node ux-sniff.mjs
```

It exits non-zero when it finds something, so it is also a gate.

## What it found the first time (232 problems)

- **Bar icons were 28 px tall** and the dialog ✕ was 20×24. A mouse forgives
  20 px; a thumb does not. Every tappable thing now keeps a floor
  (`min-width/min-height: 1.9rem`, `2.4rem` on a phone), and the bar grows to
  3.1 rem on a phone.
- **List rows, "copy", "show values", the page arrows and the brand link** were
  21–28 px. Rows are controls too; the brand's only clickable pixels used to be
  the letter itself.
- **Five-grade labels** (`audit`, `context`, `shared`, `public`) were **9.6 px** —
  legible on a desk, a rumour on a phone. Now `0.67rem` / at least 10.5 px.
- **No `aria-label`** on vr's requirement field, va's template select, vp's
  redeem field and vp's four make-code fields: they had a visual label and
  nothing else.
- **A sideways scroll on vr and va** appeared *after* the size floor, when the
  last tool in a row no longer fitted. Tool rows wrap on a phone now, and the
  bar's `◐` steps aside (the theme lives in the settings tab on a phone, where it
  has a name instead of a glyph).

After the fixes: **0 measurable problems** in eight apps, and the existing
suites still green.

## What it deliberately does not do

It cannot tell you that a screen is confusing, that a label lies, or that the
order of two buttons is wrong. Those need eyes: the va drawing looked "empty"
while every measurement was fine, because all the boxes were stacked at 0,0.
`ux-sniff` is the floor, not the review.

## The second pass: the site, and a gate

`./tools/test-all.sh` runs everything in one command — syntax, chrome, settings,
every app suite, the front door and the ux floor in all nine — locally or, with
`VPL_PROD=1`, against the deployments. It found:

- **`vi`'s parked reason field was 28 px** — a thumb-sized miss, invisible on a
  desk. It now has the same 2 rem floor as every other control.
- **A correctly labelled field was reported as unlabelled.** The audit knew
  `aria-label` and text, and nothing else; a `<label for>` is a name too. Two new
  rules were added to `ux-sniff` that day: labels count, and **a link inside a
  sentence is text** (WCAG's own line) rather than a control that is too small.
- **`www.terg.hr` now measures zero** under the same rule as the apps, which was
  the point of pointing the tool at it.
