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
];

export const DEFAULT_TEMPLATE = 'audit';

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
