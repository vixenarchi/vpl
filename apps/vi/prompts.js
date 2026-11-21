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
      'max 12 words each.\n' +
      'Rules, and they are strict:\n' +
      '- each idea must be a thing this company could sell next month, to a named buyer\n' +
      '- at least three must use a capability or a word from their context or their existing ideas\n' +
      '- name the buyer or the moment, not the technology\n' +
      '- never use the words AI, platform, solution, dashboard, portal, ecosystem, ' +
      'digital, smart, seamless\n' +
      '- no two ideas may be the same product with a different adjective\n' +
      (existing.length ? `- do not repeat or rephrase any of these: ${existing.join('; ')}` : '') },
    { role: 'user', content: 'Six ideas, one per line.' },
  ],

  /* exploration — one idea becomes a business sketch */
  explore: (idea, context, draft) => [
    { role: 'system', content:
      'You sketch the business behind one idea. Four short sections, each on its own line, ' +
      'plain text, no markdown, no praise.\n' +
      'Start every line with its label and a colon, exactly these four, nothing else:\n' +
      'customer: the person who signs the invoice\n' +
      'problem: what they cannot do today, with the moment it hurts\n' +
      'size: the arithmetic with every figure in brackets, like ' +
      '[1 900 firms] x [15 %] x [200 EUR x 12]; write [assumption] before a guess. ' +
      'Never write a market size without brackets.\n' +
      'proves it: one check this month, with the number that means fail\n' +
      'Four lines. No preamble, no headings, no closing sentence.' },
    { role: 'user', content:
      `Idea: ${idea}\n` + (context ? `Context: ${context}\n` : '') +
      (draft ? `Draft so far (improve it, keep what is still true):\n${draft}` : '') },
  ],

  /* selection — compare, recommend, but the person chooses */
  select: (candidates) => [
    { role: 'system', content:
      'You compare candidate businesses and recommend one. Answer with exactly two lines ' +
      'and nothing else — no preamble, no bullets, no reasoning out loud:\n' +
      'pick: the exact words of one candidate, copied from the list\n' +
      'why: one sentence, quoting their own evidence' },
    { role: 'user', content: candidates.map((n, i) => `${i + 1}. ${n.text}\n${(n.exploration || '').trim()}`).join('\n\n') },
  ],

  /* simulation — validation, refinement, and labelled arithmetic */
  simulate: (chosen, context, draft) => [
    { role: 'system', content:
      'You write a lean validation plan. Plain text only: no markdown, no bold, no stars, ' +
      'no headings, no bullets, no closing summary, no praise. Under 200 words in total.\n' +
      'Exactly three paragraphs, each starting with its label and a colon:\n' +
      'tests: three tests in one paragraph, each with who, what, and the threshold that means fail, ' +
      'each costing less than a week\n' +
      'refinement: what changes if the first test fails\n' +
      'projection: the arithmetic that would have to be true, every figure in brackets. ' +
      'Multiply it out before you answer: the product must equal the factors, so if ' +
      '[3 000] x [8 %] x [180 EUR x 12] is your chain, the result is 518 400 EUR and you ' +
      'say so; if your numbers do not multiply out, lower one factor until they do' },
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
