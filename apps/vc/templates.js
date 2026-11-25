/* vpl · vc — compliance. Two kinds of input, one verdict per line.
 *
 * A report here is markdown like any other document, but the screen knows how
 * to count it: every line that begins with PASS, FAIL or UNKNOWN is a finding.
 * That is the whole contract between the template and the sheet — a model that
 * writes prose instead of verdicts gets no strip, and the person sees it.
 */

export const TEMPLATES = [
  {
    id: 'audit',
    label: 'provjera kroz standarde',
    about: 'rules in, a verdict for every control, with the evidence quoted',
    needs: 'standardi (pravilnik, politika, popis kontrola) i dokazi (zapisnici, konfiguracije, slike)',
    out: 'Izvještaj o usklađenosti',
    kind: 'report',
    nouns: {
      rule: 'standard', rules: 'standardi',
      ruleCount: 'standarda', proofCount: 'dokaza',
      proof: 'dokaz', proofs: 'dokazi',
      target: 'kontrola', targets: 'kontrole', targetCount: 'kontrola',
      batch: false,
    },
    system: 'You are an auditor who is paid to be boring. You never mark something as passing without a piece of evidence in front of you, and you say UNKNOWN rather than guess. A person will be asked about every FAIL.',
    task: `Check the evidence against the standards, control by control.
Write one line per finding, and begin each line with exactly one of PASS, FAIL or UNKNOWN, then an em dash, the control, and an em dash, then the reason.
Quote the piece of evidence that decides it, in the same line. UNKNOWN means the evidence was not in the inputs — never a guess.
End with what to fix first and what is missing.`,
    shape: `# Izvještaj o usklađenosti — <subject>

## Sažetak
Two sentences: how many pass, how many fail, and what that means.

## Nalazi
- PASS — <control> — <evidence, quoted>
- FAIL — <control> — <evidence, quoted>
- UNKNOWN — <control> — <what is missing>

## Što prvo popraviti
## Što nedostaje
Verdict lines must be exactly "- PASS — ", "- FAIL — " or "- UNKNOWN — ".`,
  },
  {
    id: 'gaps',
    label: 'samo rupe i pitanja',
    about: 'a short list of what is not proven, and the question to ask',
    needs: 'standardi i dokazi, ili samo standardi',
    out: 'Rupe u usklađenosti',
    kind: 'report',
    nouns: {
      rule: 'standard', rules: 'standardi',
      ruleCount: 'standarda', proofCount: 'dokaza',
      proof: 'dokaz', proofs: 'dokazi',
      target: 'kontrola', targets: 'kontrole', targetCount: 'kontrola',
      batch: false,
    },
    system: 'You write the short version for a person who has one meeting to prepare. You list only what is not proven, and for each one the question that would settle it.',
    task: `From the standards and whatever evidence exists, list only what is not proven.
One line per gap: the control, then the question to ask. Do not write PASS lines at all.
Keep it under a page.`,
    shape: `# Rupe — <subject>

## Što nije dokazano
- UNKNOWN — <control> — <the question that would settle it>

## Prvo pitati
Three questions, ordered by how much they unblock.`,
  },
  {
    id: 'tender',
    label: 'natječaj kroz kandidate',
    about: 'the conditions of a job ad, held against each candidate, one report each',
    needs: 'uvjeti natječaja i kandidati — jedan kandidat po redu, svaki sa svojim dokazima',
    out: 'Ocjena kandidata',
    kind: 'report',
    nouns: {
      rule: 'uvjet natječaja', rules: 'uvjeti natječaja',
      ruleCount: 'uvjeta natječaja', proofCount: 'kandidata',
      proof: 'kandidat', proofs: 'kandidati',
      target: 'kandidat', targets: 'kandidati', targetCount: 'kandidata',
      batch: true,
    },
    system: 'You are on a hiring panel that has to defend every line it writes. You never mark a condition as met without a quoted piece of the candidate\'s own application, and you say UNKNOWN rather than assume.',
    task: `Read the conditions of the job ad, then the candidate's documents.
Write one line per condition, and begin each line with exactly one of PASS, FAIL or UNKNOWN, then an em dash, the condition, and an em dash, then the reason.
Quote the sentence from the candidate's application that decides it. Missing evidence is UNKNOWN, never a guess.
Never score, rank or recommend — a verdict per condition is the whole answer.
End with what to ask the candidate, and nothing else.`,
    shape: `# Ocjena kandidata — <candidate name>

## Sažetak
Two sentences: how many conditions are met, how many are not, and what that means for this application.

## Uvjeti
- PASS — <condition from the ad> — <quoted line from the application>
- FAIL — <condition> — <quoted line, or the absence that settles it>
- UNKNOWN — <condition> — <what is missing>

## Što pitati kandidata
Three questions, ordered by what they unblock.
Verdict lines must be exactly "- PASS — ", "- FAIL — " or "- UNKNOWN — ".`,
  },
];

export const DEFAULT_TEMPLATE = 'audit';

/* The words a screen uses, from the pack: a job ad does not read like an audit.
 * One place, so the left column, the batch list and the cost line agree. */
export function nounsFor(id) {
  return templateById(id).nouns;
}

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
