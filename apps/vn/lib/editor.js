/* lib/editor.js — a rich editor with no framework and no build step.
 *
 * The specification (§3.3) refuses ProseMirror/Quill/TipTap, and it is right:
 * for one document shape they are hundreds of kilobytes and a bundler. But a
 * plain textarea is not rich either. This sits between: a contenteditable
 * surface with a small toolbar, storing plain markdown.
 *
 * Two modes:
 *
 *   WRITE  rich text. Bold, italic, headings, lists, quote, code, link.
 *          Uses document.execCommand, which is deprecated but implemented
 *          everywhere and is the only way to get this without a library.
 *   VIEW   rendered markdown.
 *
 * The storage format stays markdown. A rich editor that invents its own
 * document model would need a converter both ways and would drift; keeping
 * markdown as the source of truth means VIEW is always the truth, and a
 * failed round-trip is visible rather than silent.
 */

/* ── markdown → html for the writing surface ─────────────────────────
 * Deliberately small. This is not the renderer (that is markdown.js with
 * DOMPurify); it only needs to put an existing document on screen in a form
 * the user can edit. */

const SENTINEL = '\u0000';

const INLINE = [
  [/`([^`]+)`/g, '<code>$1</code>'],
  [/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'],
  [/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>'],
  [/~~([^~]+)~~/g, '<s>$1</s>'],
  /* A link is a decision, and it is a decision about an address: only the three
   * schemes a person means are let through. `javascript:` is text with square
   * brackets around it, not a link. The href has already been through esc(), so
   * a quote inside it cannot leave the attribute. */
  [/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
    const url = href.trim().replace(/&amp;/g, '&');
    if (!/^(https?:|mailto:)/i.test(url)) return text;
    return `<a href="${href.trim()}">${text}</a>`;
  }],
];

/* Quotes are escaped too. Without that a markdown link whose address contains a
 * quote closes `href="…"` early and everything after it becomes attributes —
 * `[x](" autofocus onfocus="alert(1)" x=")` is a note that runs code when it is
 * opened. Escaping settles it at the source, for every rule, not just links. */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s) {
  let out = esc(s);
  for (const [re, rep] of INLINE) out = out.replace(re, rep);
  return out;
}

/* Converts markdown to the editable html. Code fences are replaced by a
 * placeholder block first so their contents are never touched by inline
 * rules, then restored. */
export function mdToHtml(md) {
  const lines = (md || '').split('\n');
  const out = [];
  const fences = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    /* ::: box — a container that holds anything; rendered recursively so the
     * inside keeps its markdown (lists, headings, emphasis) while editing */
    if (/^:::\s*(box|note)\s*$/i.test(line)) {
      let depth = 1;
      const buf = [];
      i++;
      for (; i < lines.length; i++) {
        if (/^:::\s*(box|note)\s*$/i.test(lines[i])) depth++;
        else if (/^:::\s*$/.test(lines[i])) {
          if (--depth === 0) { i++; break; }
        }
        buf.push(lines[i]);
      }
      out.push(`<div class="blk-box">${mdToHtml(buf.join('\n'))}</div>`);
      continue;
    }

    /* fenced code — held aside verbatim */
    const fence = line.match(/^```\s*([a-z]*)\s*$/i);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const idx = fences.push({ lang, code: buf.join('\n') }) - 1;
      out.push(`<pre data-fence="${idx}"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    /* heading */
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }

    /* horizontal rule */
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    /* blockquote (single level) */
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
      continue;
    }

    /* lists */
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push(`<ul>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      out.push(`<ol>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    /* A blank line is the separator between two blocks — htmlToMd writes it
     * and mdToHtml reads it, so it must not become a paragraph of its own
     * (that was the bug: every save multiplied the gaps).
     *
     * An empty paragraph is a different thing and needs a different mark: a
     * line holding one non-breaking space. Markdown cannot say "blank line
     * here" in any other way that is not also the separator. */
    if (/^\u00a0$/.test(line)) {
      out.push('<p><br></p>');
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }

    /* paragraph: gather until a blank line or a construct */
    const buf = [];
    while (i < lines.length && lines[i].trim() &&
           !/^(#{1,4})\s/.test(lines[i]) &&
           !/^```/.test(lines[i]) &&
           !/^:::/.test(lines[i]) &&
           !/^\s*[-*+]\s+/.test(lines[i]) &&
           !/^\s*\d+[.)]\s+/.test(lines[i]) &&
           !/^\s*>\s?/.test(lines[i]) &&
           !/^\s*(---|\*\*\*)\s*$/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }

  let html = out.join('');
  /* restore fences as placeholders the toolbar understands */
  html = html.replace(/<pre data-fence="(\d+)"><code>([\s\S]*?)<\/code><\/pre>/g,
    (_, idx, code) => {
      const f = fences[Number(idx)];
      const label = f.lang || 'code';
      return `<div class="blk-code" data-lang="${esc(f.lang)}" contenteditable="false">` +
        `<span class="blk-label">${esc(label)}</span>` +
        `<button class="blk-act" type="button" data-act="uncode" title="turn this back into ordinary text">text</button>` +
        `<pre>${code}</pre></div>`;
    });

  return html || '<p><br></p>';
}

/* ── html → markdown, for saving ─────────────────────────────────────
 * Walks the editable DOM. Anything it does not recognise is emitted as its
 * text, so no content can be lost silently — it may lose formatting, which
 * is visible, but not words.
 */
export function htmlToMd(root) {
  const blocks = (root) => {
  const out = [];

  const walkInline = (node) => {
    let s = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { s += child.nodeValue.replace(/\u00a0/g, ' '); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      const inner = walkInline(child);
      switch (tag) {
        case 'strong': case 'b': s += `**${inner}**`; break;
        case 'em': case 'i': s += `*${inner}*`; break;
        case 's': case 'del': case 'strike': s += `~~${inner}~~`; break;
        case 'code': s += '`' + inner + '`'; break;
        case 'a': s += `[${inner}](${child.getAttribute('href') || ''})`; break;
        case 'br': s += '\n'; break;
        case 'img': break;
        default: s += inner;
      }
    }
    return s;
  };

  for (const node of root.childNodes) {
    if (node.nodeType === 3) {
      const t = node.nodeValue.trim();
      if (t) out.push(t);
      continue;
    }
    if (node.nodeType !== 1) continue;

    const tag = node.tagName.toLowerCase();

    if (node.classList?.contains('blk-code')) {
      const lang = node.dataset.lang || '';
      const code = node.querySelector('pre')?.textContent ?? '';
      out.push('```' + lang + '\n' + code.replace(/\n$/, '') + '\n```');
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      const n = Math.min(Number(tag[1]), 4);
      out.push('#'.repeat(n) + ' ' + walkInline(node).trim());
      continue;
    }

    if (tag === 'hr') { out.push('---'); continue; }

    if (tag === 'blockquote') {
      const body = walkInline(node).trim().split('\n');
      out.push(body.map((l) => '> ' + l).join('\n'));
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items = [...node.querySelectorAll(':scope > li')];
      const lines = items.map((li, idx) => {
        const t = walkInline(li).trim();
        return (tag === 'ol' ? `${idx + 1}. ` : '- ') + t;
      });
      out.push(lines.join('\n'));
      continue;
    }

    if (tag === 'pre') {
      const code = node.textContent.replace(/\n$/, '');
      out.push('```\n' + code + '\n```');
      continue;
    }

    /* anything boxed stays boxed */
    if (node.classList?.contains('blk-box')) {
      const inner = blocks(node).join('\n\n').trim();
      out.push('::: box\n' + inner + '\n:::');
      continue;
    }

    /* paragraph or stray div — an empty one is a blank line, kept as a line
     * holding a single non-breaking space (see mdToHtml) */
    const t = walkInline(node).trim();
    out.push(t || '\u00a0');
  }

  return out;
  };

  /* No "\n{3,} → \n\n" here: that rule was the bug that ate the blank lines.
   * Every block is separated by one blank line, and an empty paragraph is a
   * block of its own, so a run of them is a run of blank lines. */
  return blocks(root).join('\n\n').replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
}

/* Wraps the selection in a box, or unwraps a box the caret already sits in. */
export function wrapInBox(root) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  const start = sel.anchorNode?.nodeType === 1
    ? sel.anchorNode
    : sel.anchorNode?.parentElement;
  const open = start?.closest?.('.blk-box');

  /* the box the caret is in — take it apart again */
  if (open && root.contains(open)) {
    const parent = open.parentNode;
    while (open.firstChild) parent.insertBefore(open.firstChild, open);
    open.remove();
    return true;
  }

  const box = document.createElement('div');
  box.className = 'blk-box';

  if (!range.collapsed) {
    box.append(range.extractContents());
  } else {
    /* a bare caret: lift its whole block in, so the box is not born empty */
    let block = range.commonAncestorContainer;
    while (block && block !== root && block.parentNode !== root) block = block.parentNode;
    if (block && block !== root && block.nodeType === 1) {
      block.replaceWith(box);
      box.append(block);
    } else {
      box.innerHTML = '<p><br></p>';
    }
  }

  if (!box.parentNode) range.insertNode(box);

  const after = document.createRange();
  after.selectNodeContents(box.lastElementChild || box);
  after.collapse(false);
  sel.removeAllRanges();
  sel.addRange(after);
  return true;
}
