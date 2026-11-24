/* vpl · va — the four answers this app knows how to write.
 *
 * Each template is a task and a shape: what to do with the pile, and exactly
 * what the paper should look like. The engine knows nothing about these; it is
 * a copy in vendor/engine.js and gets a template pack as an argument.
 *
 * The box list is the one structure `va` has. It is text, in a fenced block,
 * so a person can edit it and a canvas can draw it later — no metamodel, no
 * graph database, no per-cloud schema.
 */

export const BOXES = `boxes:
  - id: api
    label: Public API
    kind: service      # service | db | queue | gateway | k8s | vm | external | person
    host: api.example.hr:443
    note: one clause about what it is responsible for
    attrs: {}          # namespace, image, replicas - anything true and useful
arrows:
  - from: person
    to: api
    label: https`;

export const TEMPLATES = [
  {
    id: 'context',
    name: 'context',
    about: 'who uses it, what it talks to, what crosses each boundary',
    needs: 'a brief, and the names of the outside systems',
    task: `Write the system context of the thing described in the inputs.

One organisation, one system, and only what is outside it: the people who use it
and the external systems it depends on. Not the components inside it.`,
    shape: `A short prose context (three to eight sentences), then one fenced yaml block:

\`\`\`yaml
${BOXES}
\`\`\`

The system itself is one box, \`kind: external\`. Every box needs a \`note\`; every
arrow needs both ends to exist and a label saying what crosses it. No box
without an arrow. Names must match the inputs exactly.`,
    system: 'You draw system context diagrams and write the paragraph that goes with them. You never invent a name, an address or a system that the inputs do not mention.',
  },
  {
    id: 'overview',
    name: 'overview',
    about: 'the components inside, and what talks to what',
    needs: 'a repository, a drawing, or a description of the parts',
    task: `Write the overview of the system: the components inside it and the connections
between them. This is the inside of the box the context diagram stopped at.`,
    shape: `A short reading (what carries the most risk and why — three bullets at most), then one fenced yaml block:

\`\`\`yaml
${BOXES}
\`\`\`

Then one more fenced block with only the boxes that have a host, namespace or
image — the deployment view of the same list:

\`\`\`yaml
${BOXES}
\`\`\`

\`id\` is lowercase and stable; \`kind\` comes from the closed list in the comment
and nothing else; everything cloud-specific goes in \`attrs\`. A box with no
address says \`host: ""\` and starts its note with \`[no address]\`. An arrow to an
id that is not a box is an error.`,
    system: 'You describe software architectures as a short reading plus a list of boxes and arrows. You keep names exactly as the inputs give them and you mark what you assumed.',
  },
  {
    id: 'terraform',
    name: 'terraform',
    about: 'infrastructure as code a person can read and run',
    needs: 'a plan, and the provider and region if they are decided',
    task: `Write Terraform for the infrastructure the inputs describe. Provider and region
come from the inputs; if they do not, choose the one the inputs imply and say
which you chose and why in one sentence.`,
    shape: `A one-sentence summary of what the code creates, the list of resource types it
touches, then the files themselves, each in its own fenced block with the file
name as the language tag:

\`\`\`hcl main.tf
...
\`\`\`

Include \`variables.tf\` (every variable described), \`outputs.tf\` and a
\`terraform.tfvars.example\`. No credentials anywhere; a variable for anything the
person must decide (region, project, size, domain). Mark an unverified provider
version \`[unverified]\` instead of pretending.`,
    system: 'You write Terraform that a person can read, plan and apply. You never put a credential in a file and never present an unchecked version as fact.',
  },
  {
    id: 'report',
    name: 'report',
    about: 'read an environment that already exists',
    needs: 'an inventory — a tfstate, a kubectl dump, a cloud export',
    task: `The inputs are an inventory of something that already exists: a terraform state,
a kubectl dump, a cloud export, a list of hosts, a diagram. Read it.`,
    shape: `In this order:

1. what this environment is (one paragraph)
2. what carries the most risk (three bullets at most)
3. what the inventory does not tell you (a list)
4. what would have to be true to move it somewhere else (bullets, the one blocking item first)

Then one fenced yaml block with what is actually there, nothing tidied up and
nothing renamed:

\`\`\`yaml
${BOXES}
\`\`\`

Never guess an address, a region or a version that is not in the inputs. A
component whose purpose is unclear keeps its inventory name and gets
\`note: purpose unknown\`.

Then write that same list once more, and nothing else, as a file named
\`deployment.yaml\` under \`out/files/\`. It is the same list as the block above,
not a second opinion — the desk draws the file, so the two must agree.`,
    system: 'You read inventories of real systems and say what is there, what is risky and what is missing. You do not tidy, rename or guess.',
  },
];

export const DEFAULT_TEMPLATE = 'context';

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
