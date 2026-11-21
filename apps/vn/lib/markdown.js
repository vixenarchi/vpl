/* lib/markdown.js — markdown to safe HTML.
 *
 * One rule from §6 governs this file: DOMPurify on every render. Markdown can
 * contain raw HTML; unsanitised rendering is an XSS bug, not a feature.
 *
 * Two libraries, both from a CDN because §4.4 refuses a bundler, and both
 * loaded only when a note is rendered — never during the initial load.
 *
 * Diagrams live in their own component and are deliberately not here. A note
 * that wants a picture links to it. That keeps this file, and the first load,
 * small.
 */

const CDN = 'https://cdn.jsdelivr.net/npm';
const MARKED = `${CDN}/marked@12/lib/marked.esm.js`;
const PURIFY = `${CDN}/dompurify@3/dist/purify.es.mjs`;

let _marked = null;
let _purify = null;

async function libs() {
  if (!_marked) _marked = (await import(MARKED)).marked;
  if (!_purify) _purify = (await import(PURIFY)).default;
  return { marked: _marked, purify: _purify };
}

/* ── `::: box` containers ───────────────────────────────────────────
 * A note needs a block that holds anything, not only code. The source stays
 * plain markdown (`::: box` on its own line, closed by `:::`), which any
 * markdown reader shows as text rather than swallowing. Nesting is counted so
 * an inner box cannot close the outer one. */
function pullBoxes(md) {
  const lines = md.split('\n');
  const boxes = [];
  const text = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^:::\s*(box|note)?\s*$/i.test(lines[i])) { text.push(lines[i]); continue; }

    const open = /^:::\s*(box|note)\s*$/i.test(lines[i]);
    if (!open) { text.push(lines[i]); continue; }   // a bare ::: is just text

    let depth = 1;
    const buf = [];
    i++;
    for (; i < lines.length; i++) {
      if (/^:::\s*(box|note)\s*$/i.test(lines[i])) depth++;
      else if (/^:::\s*$/.test(lines[i])) {
        if (--depth === 0) break;
      }
      buf.push(lines[i]);
    }
    boxes.push(buf.join('\n'));
    text.push(`<div class="blk-box" data-box="${boxes.length - 1}"></div>`);
  }
  return { text: text.join('\n'), boxes };
}

function withBoxes(md, marked) {
  const { text, boxes } = pullBoxes(md);
  return marked.parse(text).replace(
    /<div class="blk-box" data-box="(\d+)"><\/div>/g,
    (whole, idx) => {
      const inner = boxes[Number(idx)];
      if (inner === undefined) return whole;
      return `<div class="blk-box">${withBoxes(inner, marked)}</div>`;
    });
}

/* Renders markdown into `el`. */
export async function render(md, el) {
  const { marked, purify } = await libs();

  marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });

  const raw = withBoxes(md || '', marked);
  el.innerHTML = purify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });

  /* Open links in a new tab without leaking the referrer. */
  for (const a of el.querySelectorAll('a[href]')) {
    if (/^https?:/i.test(a.getAttribute('href'))) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
}

/* A one-line hint of the body for the list (R8). */
export function hint(md, max = 80) {
  const text = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:::.*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
