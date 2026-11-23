/* va · the drawing.
 *
 * A canvas that only draws. It owns no state worth keeping and no schema: the
 * text is the truth, this reads it and puts shapes on the screen, and the one
 * thing it can write is where a box sits, because dragging is a way of editing
 * `x` and `y`.
 *
 * Rules it keeps:
 *   - layout is arithmetic, not a force simulation: no libraries, no physics,
 *     and the same text always gives the same picture;
 *   - a box without x,y is placed by kind, so first sight of a new list is still
 *     readable;
 *   - an arrow pointing at nothing is not drawn, it is reported in the strip;
 *   - the SVG scales. It is drawn in a fixed coordinate space and the CSS makes
 *     it fit, so a phone gets the same drawing, smaller.
 */

import { inView } from './boxes.js';

const W = 960;
const H = 620;
const BOX_W = 132;
const BOX_H = 62;
const PAD = 26;

/* Where a kind sits when nobody has said. Left to right, people to pipes. */
const COLUMN = {
  person: 0, external: 0,
  gateway: 1, service: 2, k8s: 2, vm: 2,
  queue: 3, db: 4,
};

const KIND_WORD = {
  service: 'service', db: 'db', queue: 'queue', gateway: 'gateway',
  k8s: 'k8s', vm: 'vm', external: 'outside', person: 'person',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A stable place for every box: given x,y wins, otherwise a column by kind. */
function place(boxes) {
  const columns = new Map();
  const placed = new Map();

  for (const b of boxes) {
    if (b.x !== null && b.y !== null) placed.set(b.id, { x: b.x, y: b.y, fixed: true });
  }

  for (const b of boxes) {
    if (placed.has(b.id)) continue;
    const col = COLUMN[b.kind] ?? 2;
    const list = columns.get(col) || [];
    list.push(b);
    columns.set(col, list);
  }

  const widths = [...columns.keys()].sort((a, b) => a - b);
  const step = (W - PAD * 2) / Math.max(widths.length, 1);
  for (const [i, col] of widths.entries()) {
    const list = columns.get(col);
    const room = H - PAD * 2;
    list.forEach((b, j) => {
      const y = list.length === 1 ? H / 2 : PAD + (room / (list.length - 1)) * j;
      placed.set(b.id, { x: PAD + step * i + step / 2, y, fixed: false });
    });
  }
  return placed;
}

/** Shorten a label to what fits inside a box without lying about it. */
function fit(text, max) {
  const s = String(text || '');
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function draw(svg, list, { view = 'all', onMove } = {}) {
  const boxes = list.boxes.filter((b) => inView(b, view));
  const shown = new Set(boxes.map((b) => b.id));
  const arrows = list.arrows.filter((a) => shown.has(a.from) && shown.has(a.to));
  const at = place(boxes);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const parts = [];
  parts.push(`<defs>
    <marker id="va-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
    </marker>
  </defs>`);

  /* arrows first, so boxes sit on top of their tails */
  for (const a of arrows) {
    const p1 = at.get(a.from);
    const p2 = at.get(a.to);
    if (!p1 || !p2) continue;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    /* leave from the edge of the box, not its middle */
    const ex = (dx / len) * (BOX_W / 2 + 6);
    const ey = (dy / len) * (BOX_H / 2 + 6);
    const x1 = p1.x + ex; const y1 = p1.y + ey;
    const x2 = p2.x - ex; const y2 = p2.y - ey;
    const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
    parts.push(`<g class="edge">
      <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
            marker-end="url(#va-arrow)" />
      ${a.label ? `<text x="${mx.toFixed(1)}" y="${(my - 5).toFixed(1)}" class="edge-label">${esc(fit(a.label, 22))}</text>` : ''}
    </g>`);
  }

  for (const b of boxes) {
    const p = at.get(b.id);
    const x = p.x - BOX_W / 2;
    const y = p.y - BOX_H / 2;
    const kind = KIND_WORD[b.kind] || b.kind || '?';
    parts.push(`<g class="box kind-${esc(b.kind || 'unknown')}" data-id="${esc(b.id)}"
        transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0">
      <rect width="${BOX_W}" height="${BOX_H}" rx="8" />
      <text x="12" y="22" class="box-label">${esc(fit(b.label || b.id, 17))}</text>
      <text x="12" y="40" class="box-kind">${esc(kind)}</text>
      ${b.host ? `<text x="12" y="54" class="box-host">${esc(fit(b.host, 20))}</text>` : ''}
      <title>${esc(b.id)} · ${esc(b.label || '')}${b.note ? ' — ' + esc(b.note) : ''}</title>
    </g>`);
  }

  if (!boxes.length) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" class="empty" text-anchor="middle">no box list in this document</text>`);
  }

  svg.innerHTML = parts.join('\n');

  /* dragging: pointer events, no library, and the move is reported, not stored */
  if (onMove) {
    for (const g of svg.querySelectorAll('g.box')) {
      const id = g.dataset.id;
      g.addEventListener('pointerdown', (e) => {
        const box = boxes.find((b) => b.id === id);
        if (!box) return;
        const p = at.get(id);
        const origin = svg.getBoundingClientRect();
        const scale = W / origin.width;
        const startX = e.clientX;
        const startY = e.clientY;
        const wasX = p.x;
        const wasY = p.y;
        g.setPointerCapture(e.pointerId);
        g.classList.add('dragging');

        const move = (ev) => {
          const nx = wasX + (ev.clientX - startX) * scale;
          const ny = wasY + (ev.clientY - startY) * scale;
          const cx = Math.min(W - BOX_W / 2, Math.max(BOX_W / 2, nx));
          const cy = Math.min(H - BOX_H / 2, Math.max(BOX_H / 2, ny));
          g.setAttribute('transform', `translate(${(cx - BOX_W / 2).toFixed(1)} ${(cy - BOX_H / 2).toFixed(1)})`);
        };
        const stop = (ev) => {
          g.removeEventListener('pointermove', move);
          g.removeEventListener('pointerup', stop);
          g.removeEventListener('pointercancel', stop);
          g.classList.remove('dragging');
          const nx = wasX + (ev.clientX - startX) * scale;
          const ny = wasY + (ev.clientY - startY) * scale;
          const cx = Math.min(W - BOX_W / 2, Math.max(BOX_W / 2, nx));
          const cy = Math.min(H - BOX_H / 2, Math.max(BOX_H / 2, ny));
          if (Math.abs(cx - wasX) < 2 && Math.abs(cy - wasY) < 2) return;
          onMove(id, cx, cy);
        };
        g.addEventListener('pointermove', move);
        g.addEventListener('pointerup', stop);
        g.addEventListener('pointercancel', stop);
      });
    }
  }

  return { boxes: boxes.length, arrows: arrows.length };
}

export const SIZE = { W, H };
