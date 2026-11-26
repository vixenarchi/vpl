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

  /* A url in ordinary text is ordinary text. GFM turns http://… and www.… into
   * links on sight, which is how "this is text" became "this is a link" when
   * you pressed view: nothing was marked, the renderer marked it. A link is
   * something a person makes ([words](address)) and nothing else. */
  marked.use({ tokenizer: { url() { return undefined; } } });

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

/* ── pasted html → the html the editor can keep ──────────────────────
 * A paste from a word processor carries fonts, colours, tables and spans that
 * markdown cannot hold. Left alone, the browser shows them for a while and the
 * next look at the note drops them — the "formatting disappears" complaint.
 * So a paste is cleaned at the door: keep the tags the editor understands,
 * strip every attribute except a link's address, and let the words through
 * untouched. What you see after a paste is what will be saved. */
const KEEP = {
  P: 'p', DIV: 'p', BR: 'br', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em',
  S: 's', DEL: 's', STRIKE: 's', CODE: 'code', PRE: 'pre', A: 'a',
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', UL: 'ul', OL: 'ol', LI: 'li',
  BLOCKQUOTE: 'blockquote', HR: 'hr',
};

/* ── the editable surface's own html ─────────────────────────────────
 * The writing surface builds its html itself (lib/editor.js) and does not go
 * through marked. That is not a reason to skip the sanitiser: this is the same
 * page, with the same key in localStorage, and a note can arrive from somebody
 * else's pen. The list of what the editor may contain is fixed and small.
 *
 * The libs are primed once at boot so this stays synchronous: a sanitizer that
 * has to be awaited is a sanitizer that a call site will forget to await. */
const EDITOR_TAGS = ['p', 'br', 'strong', 'em', 's', 'code', 'pre', 'a',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'hr',
  'div', 'span', 'button'];
const EDITOR_ATTR = ['href', 'class', 'data-lang', 'data-act', 'type', 'title',
  'contenteditable'];

let PURIFY_READY = null;

export async function primeSanitizer() {
  try { PURIFY_READY = (await libs()).purify; } catch { /* offline: the editor's html is built by us */ }
  return !!PURIFY_READY;
}

export function safeEditorHtml(html) {
  const text = String(html ?? '');
  if (!PURIFY_READY) return text;
  return PURIFY_READY.sanitize(text, {
    ALLOWED_TAGS: EDITOR_TAGS,
    ALLOWED_ATTR: EDITOR_ATTR,
    /* a link that survives must survive as a real address */
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}

export async function cleanHtml(html) {
  const { purify } = await libs();
  /* style is allowed through the sanitiser only so the emphasis it carries
   * (font-weight, font-style) can be turned into real tags below; every style
   * attribute is removed again before the html is handed back. */
  const safe = purify.sanitize(String(html || ''), {
    ALLOWED_TAGS: [...Object.keys(KEEP).map((t) => t.toLowerCase()), 'span', 'font', 'u'],
    ALLOWED_ATTR: ['href', 'style'],
  });
  const box = document.createElement('div');
  box.innerHTML = safe;

  /* rewrite to the editor's own alphabet; anything unknown keeps its words */
  const walk = (node) => {
    const kids = [...node.childNodes];
    for (const child of kids) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) { child.remove(); continue; }
      walk(child);

      /* a word processor says "bold" with a style, not with <b> */
      const style = (child.getAttribute('style') || '').toLowerCase();
      if (/font-weight:\s*(bold|bolder|[5-9]00)/.test(style)) {
        const strong = document.createElement('strong');
        strong.append(...child.childNodes);
        child.replaceWith(strong);
        continue;
      }
      if (/font-style:\s*italic/.test(style)) {
        const em = document.createElement('em');
        em.append(...child.childNodes);
        child.replaceWith(em);
        continue;
      }
      if (/text-decoration[^;]*line-through/.test(style)) {
        const s = document.createElement('s');
        s.append(...child.childNodes);
        child.replaceWith(s);
        continue;
      }

      const want = KEEP[child.tagName];
      if (!want) {
        const text = document.createTextNode(child.textContent || '');
        child.replaceWith(text);
        continue;
      }
      const next = document.createElement(want);
      if (want === 'a') {
        const href = child.getAttribute('href') || '';
        if (!/^https?:/i.test(href) && !href.startsWith('#')) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        next.setAttribute('href', href);
      }
      next.append(...child.childNodes);
      child.replaceWith(next);
    }
  };
  walk(box);
  /* nothing that arrives from outside keeps a colour, a font or a size */
  for (const el of box.querySelectorAll('*')) el.removeAttribute?.('style');
  return box.innerHTML;
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
