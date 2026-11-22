/* vpl · vr — what we say to the model.
 *
 * Three jobs, one shape: plain lines separated by pipes. Models are willing to
 * obey a line format and hopeless at JSON, and a line is readable in a balloon
 * without a parser that can fail in three ways.
 *
 *   review   · read the sheet and propose corrections, one per line
 *   glossary · name the words the sheet assumes
 *   draft    · turn a paragraph into rows
 */

const SYSTEM = `You are a requirements engineer reviewing a small, real sheet of
requirements. You are terse, concrete and unsentimental. You never write
markdown, never use bullet characters, never add commentary around your answer.`;

const RULES = `A requirement is one testable sentence. "must" means the thing
cannot ship without it; "optional" means it can wait a release; "wish" means it
is wanted but nobody would block on it. "functional" is what the system does,
"nonfunctional" is how well (speed, safety, availability, cost), "constraint" is
a limit nobody chose (a law, a standard, an existing system), "rule" is a
business rule the software must respect.`;

/* Which rows to send: with 300 rows a single call is a novel, so the app sends
 * the strongest musts and the rows that are incomplete. */
function sheet(rows) {
  return rows.map((r) => [
    r.ref,
    r.kind,
    r.strength,
    r.theme || '-',
    r.statement || '(no statement)',
    r.verification ? `proof: ${r.verification}` : 'proof: none',
  ].join(' | ')).join('\n');
}

export const prompts = {
  review(project, rows) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content:
`${RULES}

Here is the sheet of "${project.title}". Lines are: ref | kind | strength | theme | statement | proof.

${sheet(rows)}

Answer with one line per correction, and nothing else:
ref | field | value | why

field is one of: theme, kind, strength, verification, metric.
value is the replacement text, short. why is under twelve words.
Propose a field only when the current value is wrong or empty. At most 12 lines.
If a row is compound, propose a shorter statement that keeps one testable claim.
If nothing is wrong, answer with the single word: nothing` },
    ];
  },

  glossary(project, rows) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content:
`These are the requirements of "${project.title}". Name the words a reader from
another trade would not understand, or would understand wrongly: acronyms,
internal names, units, role names. Skip ordinary words.

${rows.map((r) => r.ref + ' | ' + (r.statement || r.title)).join('\n')}

Answer with one line per term, and nothing else:
term | meaning in one short sentence
At most 10 lines. If every word is plain, answer with the single word: nothing` },
    ];
  },

  draft(project, text) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content:
`${RULES}

The person wrote this about "${project.title}":
${text}

Turn it into requirements. One testable sentence each, in the person's own
language, no invented numbers. Answer with one line per requirement, nothing else:
statement | must|optional|wish | theme
At most 12 lines.` },
    ];
  },
};
