/* va · the box list, read in the browser.
 *
 * The grammar is the agent's (agent/lib/boxes.mjs), on purpose: the model writes
 * it, the checker in the agent checks it, and this file draws it. One shape, one
 * meaning — no second dialect that only the canvas understands.
 *
 *   boxes:
 *     - id: api
 *       label: Public API
 *       kind: service
 *       host: api.example.hr:443
 *       note: serves the editor
 *       view: overview          # optional; absent means "in every view"
 *       x: 120
 *       y: 240                  # optional; the drag writes these back
 *   arrows:
 *     - from: person
 *       to: api
 *       label: https
 *
 * It is not a YAML parser and it does not want to be one: a box list that needs
 * anchors, flow maps or multi-line strings is a box list somebody made too hard.
 */

export const KINDS = ['service', 'db', 'queue', 'gateway', 'k8s', 'vm', 'external', 'person'];

/* Three views, one list. They are filters, not schemas. */
export const VIEWS = [
  { id: 'all', label: 'everything' },
  { id: 'context', label: 'context' },
  { id: 'overview', label: 'inside' },
  { id: 'deployment', label: 'deployment' },
];

const unquote = (v) => v.replace(/^["']|["']$/g, '').trim();
/* Number('') is 0, and `x: ` (an empty value) would then look like a placed box
 * at the top-left corner. An empty value is "nobody has said" — null. */
const num = (v) => {
  if (v === undefined || v === null) return null;
  const digits = String(v).replace(/[^\d.-]/g, '');
  if (!digits || digits === '-' || digits === '.') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
};

const FENCE = /```(?:yaml|yml)?\s*\n([\s\S]*?)```/g;

/** The text of every fenced block that looks like a box list. */
export function listBlocks(text) {
  const out = [];
  const src = String(text || '');
  FENCE.lastIndex = 0;
  let m;
  while ((m = FENCE.exec(src))) {
    if (/^\s*(boxes|arrows):/m.test(m[1])) out.push(m[1]);
  }
  /* A document that is nothing but the list, without fences, still reads. */
  if (!out.length && /^\s*boxes:/m.test(src)) out.push(src);
  return out;
}

export function parseBoxList(text) {
  const boxes = [];
  const arrows = [];
  const problems = [];
  let section = null;
  let current = null;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const head = line.match(/^(boxes|arrows):\s*$/);
    if (head) { section = head[1]; current = null; continue; }

    const item = line.match(/^\s*-\s*([a-z_]+):\s*(.*)$/);
    if (item && section) {
      current = { [item[1]]: unquote(item[2]) };
      (section === 'boxes' ? boxes : arrows).push(current);
      continue;
    }

    const field = line.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (field && current) { current[field[1]] = unquote(field[2]); continue; }
  }

  const ids = new Set();
  for (const b of boxes) {
    const id = b.id || b.name;
    if (!b.id) problems.push(`a box uses "name" instead of "id" (${b.name || b.label || 'unnamed'})`);
    if (!id) problems.push('a box has no id');
    else if (ids.has(id)) problems.push(`duplicate id: ${id}`);
    else ids.add(id);
    if (b.kind && !KINDS.includes(b.kind)) {
      problems.push(`${id || 'a box'} has kind "${b.kind}", which is not one of ${KINDS.join(', ')}`);
    }
    if (!b.kind) problems.push(`${id || 'a box'} has no kind`);
    if (!b.label) problems.push(`${id || 'a box'} has no label`);
    b.x = num(b.x);
    b.y = num(b.y);
  }

  for (const a of arrows) {
    if (!a.from || !a.to) { problems.push('an arrow has no from or no to'); continue; }
    for (const end of [a.from, a.to]) {
      if (!ids.has(end)) problems.push(`arrow ${a.from} → ${a.to} points at "${end}", which is not a box`);
    }
  }

  return { boxes, arrows, problems };
}

/** Every box list in a document, merged — a document may carry more than one. */
export function parseDocument(text) {
  const blocks = listBlocks(text);
  const boxes = [];
  const arrows = [];
  const problems = [];
  const seen = new Set();
  for (const block of blocks) {
    const one = parseBoxList(block);
    for (const b of one.boxes) {
      const id = b.id || b.name;
      if (id && seen.has(id)) problems.push(`duplicate id across the document: ${id}`);
      if (id) seen.add(id);
      boxes.push(b);
    }
    arrows.push(...one.arrows);
    problems.push(...one.problems);
  }
  return { boxes, arrows, problems, blocks: blocks.length };
}

/** Which boxes a view shows: absent means every view. */
export function inView(box, view) {
  if (!view || view === 'all') return true;
  const v = String(box.view || '').trim().toLowerCase();
  if (!v) return true;
  return v.split(/[,\s]+/).includes(view);
}

/**
 * Write x and y for one box back into the text, touching nothing else.
 *
 * This is the whole of "the canvas edits the text": find the box's `- id:` line
 * inside a fenced block, keep going while the indentation is deeper, replace or
 * insert the two keys, and leave every other character alone. Returns the same
 * string when the box is not found, so a caller can tell nothing happened.
 */
export function setXY(text, id, x, y) {
  const src = String(text || '');
  if (!id) return src;
  const lines = src.split('\n');
  let start = -1;
  let end = -1;
  let indent = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)-\s*id:\s*(.+?)\s*$/);
    if (!m) continue;
    if (unquote(m[2]) !== id) continue;
    start = i;
    indent = m[1].length;
    end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j];
      if (!l.trim()) continue;
      const lead = l.match(/^\s*/)[0].length;
      if (lead <= indent && /^\s*-\s/.test(l)) break;
      if (lead <= indent && /^\s*(boxes|arrows):/.test(l)) break;
      end = j;
    }
    break;
  }
  if (start < 0) return src;

  const put = (key, value) => {
    const re = new RegExp(`^(\\s{${indent + 2}})${key}:\\s*.*$`);
    for (let i = start + 1; i <= end; i += 1) {
      if (re.test(lines[i])) { lines[i] = lines[i].replace(re, `$1${key}: ${value}`); return; }
    }
    end += 1;
    lines.splice(end, 0, `${' '.repeat(indent + 2)}${key}: ${value}`);
  };

  put('x', Math.round(x));
  put('y', Math.round(y));
  return lines.join('\n');
}
