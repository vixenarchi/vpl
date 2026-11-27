/* vpl · vd — the three documents this app knows how to write.
 *
 * A template is a sentence of intent and a shape. Nothing here is a schema:
 * what comes back is markdown, and the person edits it like a document because
 * that is what it is.
 *
 * Everything a person reads or the model is told is in English — labels, shapes,
 * placeholders, prompts. Croatian lives in the person's own document, not here.
 */

export const TEMPLATES = [
  {
    id: 'offer',
    label: 'offer from a tender',
    about: 'tender papers in, an offer you can send out',
    needs: 'the tender, our terms, notes',
    out: 'Offer',
    kind: 'doc',
    system: 'You are a bid writer for a small, honest IT company. You read a tender carefully, then write the offer that answers it — no marketing, no promises the inputs do not support.',
    task: `Read the tender documents and write an offer that answers them.
Say what is being asked for, what we would deliver, how long it takes and what it costs.
Every price, date and quantity must come from the inputs. When the inputs do not give one, write the heading and a bracketed placeholder such as [price — not in the inputs] instead of inventing a number, and list it again under assumptions.`,
    shape: `# Offer — <job name>
## What is asked for
## What we offer
## Plan and dates
## Price
## Assumptions
## Risks
Keep it under 900 words where the tender allows it.`,
  },
  {
    id: 'summary',
    label: 'summary of documents',
    about: 'a pile of papers in, one page you can read on a tram',
    needs: 'a contract, a rulebook, minutes, a letter',
    out: 'Summary',
    kind: 'doc',
    system: 'You summarise documents for a busy person who will be asked to sign or decide. You keep their numbers and their words where they matter, and you say plainly what is missing.',
    task: `Summarise the inputs for someone who has ten minutes.
Lead with what the document decides or asks for. Then the obligations, the dates, the money and the exit. Quote a sentence when the exact wording is the point.`,
    shape: `# Summary — <document>
## In one sentence
## What is asked or decided
## Obligations and dates
## Money
## What is not clear
No more than 500 words.`,
  },
  {
    id: 'plan',
    label: 'plan from minutes',
    about: 'minutes and notes in, a plan with owners and dates',
    needs: 'minutes, notes, letters, e-mails',
    out: 'Plan',
    kind: 'doc',
    system: 'You turn meeting minutes and scattered notes into a plan somebody can start on Monday. You do not invent tasks, owners or dates; you do mark what nobody was assigned.',
    task: `From the inputs, build a plan. One task per line, each with an owner and a date when the inputs give them. Where an owner or a date is missing, write [not set] in that column. Put decisions and open questions after the tasks.`,
    shape: `# Plan — <subject>
## Decisions
## Tasks
| task | who | by when |
## Open questions
Keep every task to one sentence the person could paste into their own notes.`,
  },
];

export const DEFAULT_TEMPLATE = 'offer';

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
