// The box list: the one structure va draws. This module is the checker.
//
// It reads the small, deliberately boring shape the prompts ask for:
//
//   boxes:
//     - id: api
//       label: Public API
//       kind: service
//       host: api.example.hr:443
//       note: serves the editor
//       attrs: {}
//   arrows:
//     - from: person
//       to: api
//       label: https
//
// and answers with what is wrong. It is not a YAML parser and does not try to
// be one: a box list that needs anchors, multi-line strings or flow maps is a
// box list somebody made too hard.

export const KINDS = ['service', 'db', 'queue', 'gateway', 'k8s', 'vm', 'external', 'person'];

const unquote = (v) => v.replace(/^["']|["']$/g, '').trim();

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
    if (head) {
      section = head[1];
      current = null;
      continue;
    }

    const item = line.match(/^\s*-\s*([a-z_]+):\s*(.*)$/);
    if (item && section) {
      current = { [item[1]]: unquote(item[2]) };
      (section === 'boxes' ? boxes : arrows).push(current);
      continue;
    }

    const field = line.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (field && current) {
      // An empty value is a value: `host: ""` says "there is no address here",
      // which is different from forgetting the key.
      current[field[1]] = unquote(field[2]);
      continue;
    }
  }

  // A list with only arrows is fine (an edge-only job); a list with nothing is not.
  if (!boxes.length && !arrows.length) problems.push('the file has no boxes and no arrows');

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
    if (!b.note) problems.push(`${id || 'a box'} has no note`);
    if (b.host === undefined) {
      problems.push(`${id || 'a box'} has no host — say host: "" and start the note with [no address]`);
    }
  }

  const touched = new Set();
  for (const a of arrows) {
    if (!a.from || !a.to) {
      problems.push('an arrow has no from or no to');
      continue;
    }
    for (const end of [a.from, a.to]) {
      if (!ids.has(end)) problems.push(`arrow ${a.from} → ${a.to} points at "${end}", which is not a box`);
    }
    if (!a.label) problems.push(`arrow ${a.from} → ${a.to} has no label`);
    touched.add(a.from).add(a.to);
  }

  for (const b of boxes) {
    const id = b.id || b.name;
    if (id && !touched.has(id)) problems.push(`${id} has no arrows — an orphan in a context diagram is a mistake or a missing edge`);
  }

  return { boxes, arrows, problems };
}
