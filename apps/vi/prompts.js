/* vpl · vi — the prompts, in one file, one per stage.
 *
 * Every stage is one call with a fixed instruction and the person's own text as
 * context. There is no agent loop and no memory: the quality of this app is
 * these five strings. Keep them plain, keep them short, and never let them ask
 * for praise.
 */

const plain = 'Plain text, no markdown, no headings, no praise, no invented numbers.';

export const prompts = {
  /* context — a pile of words becomes constraints */
  context: (raw) => [
    { role: 'system', content:
      'You turn a rough pile of words into the constraints of a business idea funnel. ' +
      'Write 3 to 4 plain sentences in the language of the input. No lists, no headings, ' +
      'no praise. Only facts the writer gave you; invent nothing.' },
    { role: 'user', content: raw },
  ],

  /* ideation — quantity, no judgement */
  ideate: (title, context, existing) => [
    { role: 'system', content:
      `You are helping someone fill an idea funnel called “${title}”. ` +
      (context ? `Their context: ${context}\n` : '') +
      'Give 6 short business ideas, one per line, no numbering, no explanation, ' +
      'max 12 words each. Concrete and different from each other. ' +
      (existing.length ? `Skip any idea already listed here: ${existing.join('; ')}.` : '') },
    { role: 'user', content: 'Six ideas, one per line.' },
  ],

  /* exploration — one idea becomes a business sketch */
  explore: (idea, context, draft) => [
    { role: 'system', content:
      'You sketch the business behind one idea. Four short sections, each on its own line, ' +
      'plain text, no markdown, no praise, no numbers you cannot justify:\n' +
      'customer: who exactly, one line\nproblem: what they cannot do today, one line\n' +
      'size: rough, and say what it rests on\nproves it: one check a person could run this month' },
    { role: 'user', content:
      `Idea: ${idea}\n` + (context ? `Context: ${context}\n` : '') +
      (draft ? `Draft so far (improve it, keep what is still true):\n${draft}` : '') },
  ],

  /* selection — compare, recommend, but the person chooses */
  select: (candidates) => [
    { role: 'system', content:
      'You compare candidate businesses and recommend one. Answer in exactly this shape, ' +
      'nothing else:\n\npick: the exact name of one candidate\nwhy: one sentence, quoting their evidence' },
    { role: 'user', content: candidates.map((n, i) => `${i + 1}. ${n.text}\n${(n.exploration || '').trim()}`).join('\n\n') },
  ],

  /* simulation — validation, refinement, and labelled arithmetic */
  simulate: (chosen, context, draft) => [
    { role: 'system', content:
      'You write a lean validation plan. Three sections, plain text, no praise, ' +
      'no invented market sizes. Label every number as an assumption in brackets.\n' +
      'tests: three tests, each with who, what, and the threshold that means fail\n' +
      'refinement: what changes if the first test fails\n' +
      'projection: the arithmetic that would have to be true, assumptions bracketed' },
    { role: 'user', content:
      (chosen ? `Chosen idea: ${chosen.text}\n${chosen.exploration || ''}\n` : '') +
      (context ? `Context: ${context}\n` : '') +
      (draft ? `Draft so far:\n${draft}` : '') },
  ],

  /* the one-line check the test button uses */
  ping: () => [
    { role: 'system', content: plain },
    { role: 'user', content: 'reply with the single word: ok' },
  ],
};
