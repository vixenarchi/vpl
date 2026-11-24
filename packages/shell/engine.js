/* vpl · the engine — inputs, a transformation, an output.
 *
 * The three generator apps (vd documents, vc compliance, va architecture) are
 * the same machine with different templates and different screens:
 *
 *     artifacts ──template + prompt──▶ one answer ──▶ one output you can edit
 *
 * This file is the machine. It knows nothing about tables, prefixes or the
 * screen: it builds the messages, calls the model through the suite's own CORS
 * door, and turns a file into text. Each app injects its own store and its own
 * templates, which is why the engine can be copied into every app and none of
 * them depend on each other at runtime.
 *
 * The anti-design, written down: no metamodel, no artifact graph, no workflow
 * engine, no universal "transformation" object. An input is text, an output is
 * text, and the only structure is the one a template asks the model for.
 */

import * as ai from './ai.js';

/* `proxy` in config.local.js names the shared door; the app's own /api/chat is
 * tried first either way. No value means no fallback — and no surprise. */
export const PROXY = ((typeof window !== 'undefined' && window.__VPL_CONFIG__) || {}).proxy || '';

/* How much of one artifact and of all of them together goes to the model. A
 * tender document that is 200 pages is not going to fit, and pretending
 * otherwise produces a quiet truncation the person never sees. */
export const LIMITS = { per: 24000, total: 160000 };

export const NO_KEY = 'no-key';

export function hasKey() {
  return !!ai.readAi().key;
}

export function modelName() {
  return ai.readAi().model || 'gpt-4o-mini';
}

/* One artifact as a block the model can tell apart. Long text is cut in the
 * middle, not the end: a tender's price table is usually at the bottom. */
export function artifactBlock(a, per = LIMITS.per) {
  const body = String(a.text || '').trim();
  const head = `### ${a.title || a.kind || 'input'}${a.kind ? ` (${a.kind})` : ''}`;
  if (!body) return `${head}\n_(no text — a file or an image, see the name: ${a.file_name || 'unnamed'})_`;
  if (body.length <= per) return `${head}\n${body}`;
  const half = Math.floor(per / 2);
  return `${head}\n${body.slice(0, half)}\n\n[... ${body.length - per} characters left out ...]\n\n${body.slice(-half)}`;
}

export function artifactsContext(artifacts, limits = LIMITS) {
  const parts = [];
  let left = limits.total;
  for (const a of artifacts) {
    if (left <= 0) {
      parts.push('### … more inputs were not sent: the context is full');
      break;
    }
    const block = artifactBlock(a, Math.min(limits.per, left));
    parts.push(block);
    left -= block.length;
  }
  return parts.join('\n\n') || '_(no inputs yet)_';
}

/* The messages are deliberately dull: a role, the job, the inputs, the task,
 * then what to do with corrections. A template may add its own paragraphs but
 * cannot opt out of "say what you assumed". */
export function buildMessages({ template, project, artifacts, notes = '' }) {
  const system = [
    template.system || 'You are a careful assistant who writes documents people sign.',
    '',
    'Rules for every answer:',
    '- Write in the language of the input documents.',
    '- Markdown only, no preamble, no "sure", no closing offer to help.',
    '- Every figure, name and date must come from the inputs. When something is missing, say so in place, and mark your own assumption with [assumption].',
    '- Prefer the shape the task asks for; invent no headings it does not ask for.',
  ].join('\n');

  const user = [
    `The job: ${project.title || 'untitled'}`,
    project.brief ? `What is asked of this job:\n${project.brief}` : '',
    '',
    'Inputs, one block each:',
    artifactsContext(artifacts),
    '',
    'The task:',
    template.task,
    template.shape ? `\nReturn exactly this shape:\n${template.shape}` : '',
    notes ? `\nThe person who asked has notes on the last answer — follow them:\n${notes}` : '',
  ].filter((x) => x !== '').join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/* One call, through our own origin. The key is the person's, kept in the
 * browser; the proxy only passes it along. */
export async function callModel(messages, { signal } = {}) {
  const c = ai.readAi();
  if (!c.key) {
    const err = new Error('no model key yet');
    err.code = NO_KEY;
    throw err;
  }
  const body = JSON.stringify({
    url: ai.aiEndpoint(c.url), key: c.key, model: c.model || 'gpt-4o-mini', messages,
  });

  let res = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal,
  });
  /* on a phone or a static host there is no /api/chat; the shared door is it */
  if ((res.status === 404 || res.status === 405) && PROXY) {
    res = await fetch(PROXY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal,
    });
  }
  const text = await res.text();
  if (!res.ok) {
    let d = null;
    try { d = JSON.parse(text); } catch { /* not json */ }
    const why = (d && (d.error?.message || d.error || d.raw)) || text || `http ${res.status}`;
    throw new Error(String(why).slice(0, 200));
  }
  let data = null;
  try { data = JSON.parse(text); } catch { return stripFence(text); }
  const answer = data?.choices?.[0]?.message?.content ?? data?.content ?? '';
  return stripFence(String(answer || ''));
}

/* Models like to wrap a document in ```markdown; a document is not a fence. */
export function stripFence(s) {
  const t = String(s || '').trim();
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(t);
  return (m ? m[1] : t).trim();
}

/* ── files become text ──────────────────────────────────────────────── */
/* pdf.js runs in the browser: there is no server to extract on, and the file
 * never leaves the person's machine except as text they chose to send. */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

export const TEXT_LIKE = /^(text\/|application\/(json|xml|x-yaml|yaml|sql|javascript))/i;

export function isPdf(file) {
  return /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || '');
}

export async function pdfText(file, onPage) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    /* pdf.js hands back runs; join them with spaces and keep line-ish breaks */
    const line = content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('');
    out.push(`--- page ${i} ---\n${line.replace(/[ \t]+/g, ' ').trim()}`);
    if (onPage) onPage(i, doc.numPages);
  }
  return out.join('\n\n');
}

/* A file in, a text out. Returns { text, kind, note } — never throws for a
 * format we simply cannot read, because the person should still get the file
 * attached and a sentence saying why there is no text. */
export async function extract(file, onPage) {
  if (isPdf(file)) {
    try {
      const text = await pdfText(file, onPage);
      return { text, kind: 'file', note: `text taken from ${file.name}` };
    } catch (err) {
      return { text: '', kind: 'file', note: `could not read ${file.name}: ${String(err.message || err).slice(0, 80)}` };
    }
  }
  if (/^image\//i.test(file.type)) {
    return { text: '', kind: 'image', note: 'an image travels with the job, but its text does not' };
  }
  if (TEXT_LIKE.test(file.type) || /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html|sql|log)$/i.test(file.name)) {
    const text = await file.text();
    return { text, kind: 'file', note: `${text.length} characters from ${file.name}` };
  }
  return { text: '', kind: 'file', note: `no text reader for ${file.type || file.name}` };
}

/* ── small things the apps share ───────────────────────────────────── */
export function countWords(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
