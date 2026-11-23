# va · solutioning, infrastructure, and the hand-off

Not built. This is the design, written before the code, because `va` is the one
app that can quietly become the monster.

The sentence: **"a desk of papers and a box list; the list becomes a drawing, a
drawing becomes code, and an agent on your own machine does the typing."**

## What it is, in two halves

**Solutioning** — a deck: uploaded documents, ideas, minutes, requirements,
images already drawn elsewhere, and the diagram. Everything the suite already
makes (a `vn` note, a `vr` sheet, a `vc` report, a `vd` offer) arrives by
**clipboard**, not by a database join. That is the suite's rule and `va` is its
best customer, not its exception.

**Infrastructure** — the same deck, read backwards: a pasted inventory (tfstate,
`kubectl get -o json`, a cloud export, a diagram) becomes a box list, a report
and a drawing. Then the box list becomes Terraform.

Both halves are the engine we already have: **artifacts in, a template, one
output**. No new machinery. What is new is exactly two things: the box list and
the hand-off.

## The one diagram, and why the drawing is not the truth

There are dozens of drawing tools. Copying one is the surest way to lose the
week and the lightness. So `va` does not hold a diagram: it holds a **list of
boxes and arrows**, and the canvas is an *editor for that list*.

```yaml
# an artifact of kind: diagram, stored as text like everything else
boxes:
  - id: api            # identity, not a database key
    label: Public API
    kind: service      # service | db | queue | gateway | k8s | vm | external | person
    host: api.example.hr:443
    note: behind Cloudflare
    attrs: {}          # free: namespace, replicas, image, whatever is true
    x: 120
    y: 80
arrows:
  - from: person
    to: api
    label: https
  - from: api
    to: db
    label: reads
```

- **Text is the truth; the canvas edits the text.** Dragging a box writes `x`
  and `y` back into the YAML. The agent writing a box writes the same YAML. That
  is the whole of "bidirectional", and it needs no sync engine, no graph
  database and no shadow model.
- **Three views, one list** — not three diagram types: *context* (people and
  systems, nothing inside), *overview* (everything, with kinds), *deployment*
  (only what has a host, namespace or image, with the address under the label).
  A view is a filter and a layout, not a schema.
- **Universal by construction.** `kind` is from a short closed list; everything
  cloud-specific goes in `attrs`, a free map. No `aws_instance` column, no
  per-hyperscaler fields, no crosswalk. A box is a box on Azure or on a laptop.
- **Validation is a strip, not a gate** (the `vc` lesson): a box without a host
  says `[no address]`, an arrow to an unknown id is an error, an orphan box says
  so, and a component with no `note` gets `[assumption]`. The device cannot be
  all green and vague at once.

**Is the canvas worth it?** A *small* one, yes: boxes, arrows, drag, labels,
three views, maybe a grid. Roughly 500–700 lines of SVG and pointer events — the
same order as `vi`'s road and `vn`'s tree, and it keeps the suite's no-bundler
rule. ReactFlow would give pan/zoom/edges for free and then ask to own the
document's state, which is the one thing we are not giving away. If the canvas
starts needing minimaps, auto-layout, groups and orthogonal routing, that is the
signal to stop and let people draw elsewhere and upload a PNG — which the deck
already accepts.

## The hand-off to an agent

The agent is not inside the app. The app cannot run a command, and this is not a
limitation — it is the design. A web page that can tell a shell-enabled agent
what to do is a remote code execution button with a login screen on it.

**The agent is a colleague with an account.** This was verified against the
existing `eva` workshop on this machine: an Ubuntu container, `pi` 1.5.0 and
node 22 installed, outbound network fine, no docker inside (the workshop *is*
the Linux environment; docker is for giving the same thing to other people).

Given that, the transport is not a folder on somebody's laptop — the agent may
run on GCP free tier. So:

- the agent gets **its own VPL account** (`eva-agent@vpl.local`, a bare name, as
  every account here), and the document is **shared with it as `edit`** through
  the suite's existing two-door sharing. No tunnel, no inbound port, no new
  authentication concept.
- the bucket policies (`va_can_edit`, path per document) already decide what it
  may write, and every write is a normal artifact or file row — so the person
  sees what arrived, and can copy/revert it like anything else.
- a folder (`va-jobs/`) stays as the **local development mode** for an agent on
  the same machine; it is a convenience, not the contract.

**What powers the agent**: `pi` reads `models.json`, and a **vp code** is a
model key. Verified: a provider entry with `baseUrl: https://api.terg.hr/vp/v1`,
`api: openai-completions`, `apiKey: $VPL_VP_KEY` lists the model and answers.
So an agent gets *N calls until a date*, visible in `vp`'s ledger — its spending
is the same ledger as everything else in the suite, and its access can be cut
without touching a provider key.

**Pull, never push.** The person presses *hand it over*, and `va` writes a job:

```
va-jobs/2026-12-03-1422/
  task.md          what to do, in the template's words
  boxes.yaml       the list, if the job is about infrastructure
  inputs/          the artifacts the person chose, as text or files
  README           one paragraph: read task.md, write into out/
          (agent works here)
  out/
    report.md      what it did, in prose a person can check
    boxes.yaml     the list, updated or observed
    files/         code, terraform, directories it created
```

The agent — PI, or a script, or a person — watches that folder. When `out/`
appears, `va` shows **"the agent answered"**: the report as an editable text, the
changed list as a diagram, and the files as a tree with **accept** and **drop**
per item. Nothing lands in a field on its own; that is the suite's balloon rule
with a directory instead of a speech bubble.

Why not a webhook: a page that can make a shell-enabled agent act is remote code
execution with a login screen. The job is written where the agent can read it;
the agent decides when to work, and it writes results back as artifacts. No
endpoint is opened for commands, in either direction.

The docker image, when it exists, is then trivial: Ubuntu, node, `pi`, the
prompts in `/agent`, `models.json` pointed at the vp door with `$VPL_VP_KEY` in
the environment, and a worker loop — **outbound only, no inbound port**. That is
what makes free-tier hosting enough.

Existing prior art on this machine: `eva` is already this shape (Ubuntu + `pi` +
FastAPI on 8080 + shell hands + SQLite memory + supervision). The image for
`va`'s agent should be a stripped `eva`, not a second runtime invented from
scratch.

**From the other direction**, the same job: *"this is the environment (pasted
inventory or a folder the agent reads), tell me what is in it"* → `report.md` +
`boxes.yaml` + a drawing. Migration planning is then a diff between two box
lists, which is a text diff and needs no feature.

## What it deliberately is not

- **No graph database.** The graph is a list of arrows in a text file.
- **No metamodel.** No artifact types, no relations between artifacts, no
  universal Party/Artifact/Project. The four tables of the engine, and `attrs`.
- **No cloud credentials in the app**, ever. Reading a real environment is the
  agent's job, in the agent's own environment, with the agent's own keys.
- **No bidirectional sync with a live environment.** One pull, one drawing, one
  person deciding. Drift detection is a daemon, and daemons are not this suite.
- **No C4 hierarchy, no auto-layout, no templates gallery.** Three views.
- **No code execution, no sandbox, no WebContainer.** The browser does not run
  what the agent wrote.
- **No multi-agent orchestration.** One job, one agent, one answer, a person
  accepting it.
- **No cost estimation, no policy engine, no compliance scoring.** `vc` exists.

## Built: the desk (slice 1)

`apps/va` is live at **`va.terg.hr`** (Pages project `vpl-va`), and it is the
engine's fourth skin: the same desk as `vd`, with `va`'s templates and words.

- Tables **`va_projects`, `va_artifacts`, `va_runs`, `va_outputs`, `va_shares`**,
  bucket **`va-files`** (10 MB), the share functions `va_share_role`,
  `va_read_share`, `va_can_read`, `va_can_edit`, `va_path_project`, and the
  account purge learned `va_` — which is the bug that bit `vc` and `vp` before,
  so the whole suite body is written out again rather than patched.
- Four templates, each a task and a shape: **context** (who uses it, what it
  talks to), **overview** (the components inside, plus the deployment view of the
  same list), **terraform** (files as fenced blocks, variables described, no
  credentials), **report** (read an inventory that already exists).
- Every template ends in the **box list** — `boxes:`/`arrows:` in a fenced yaml
  block, `kind` from the closed list, cloud-specific detail in a free `attrs`
  map. It is text in the answer, so a person can edit it, the agent can write it,
  and the canvas (slice 2) is a renderer, not a database.
- **40/40** checks (`tools/test-va.sh`), locally and against
  `https://vpl-va.pages.dev`: a job, a pasted input, a file whose text is
  extracted, a template that survives a reload, a mocked answer that carries the
  box list, notes that reach the model, versions, silent autosave, copy, a
  read-only link a guest can read but not generate into, copy-to-mine, a phone
  with no sideways scroll, and a clean console.

One bug the screenshot found and the tests could not: the template line said
"expects: undefined" because `va`'s pack had no `needs` field. It is there now,
and it is a reminder that "look at the thing" is still a test.

## Built: the hand-off (slice 3)

The desk can now write a job and an agent can answer it, and **nothing on the
desk can command the agent's shell**. That is not a detail — it is the whole
reason a page like this may exist on the open internet.

- **A job is a row and a folder.** The row is `va_jobs` (`queued → running →
  done|failed`, with `template`, `note`, `path`, `report`, `files`, `error`).
  The folder is `<project>/jobs/<job>/task.md` plus `inputs/*.md` in the
  `va-files` bucket. Both are written by one button, in that order, so a row
  never points at a folder that is not there yet.
- **Who may work a job is the project's own rule.** `va_jobs` reads with
  `va_can_read(project_id)` and writes with `va_can_edit(project_id)` — the same
  functions the bucket policies use. An agent is a colleague the person shared
  the job with, not a new kind of account, and there is no second permission
  system to keep in sync.
- **The claim is the write.** The worker takes a job with
  `PATCH va_jobs?id=…&status=eq.queued`; a second worker's request matches no
  row and it says "somebody else took it". No lock, no lease, no scheduler, no
  worker registry.
- **The worker learns one thing: `--bucket`.** Same loop, same prompts, same
  `runJob`; a small `agent/lib/api.mjs` signs in as the agent's own account over
  plain REST — no supabase-js, no realtime — downloads `task.md` and `inputs/`,
  runs pi in a local mirror under `jobs/.bucket/<id>`, and uploads
  `out/report.md` and `out/files/**` back to the same folder before patching the
  row. Folder mode stays the local dev mode; the two differ by one branch.
- **`--fake` exists so the wiring can be tested for free.** It writes the same
  shape without a model and says "this answer is canned" inside the report.
- **The desk keeps or drops.** *keep what came back* turns the report into a new
  answer on the desk and the agent's files into pile items; *drop* deletes the
  row. A job in flight is the only thing the desk ever polls, and only while it
  is in flight.

**Proved twice.** `apps/vn/test/va-handoff.mjs` — **14/14**, locally and against
`https://vpl-va.pages.dev` — walks the whole loop with `--fake`. Then one real
job: a brief about this app, template `context`, model
`vpl/nemotron-3.5-lightning-30b-a3b` behind **`api.terg.hr/vp`**, worker in the
workshop. **61 s** from the button to *answered*, one file back (`context.yaml`,
two boxes, one arrow), kept as an answer with the agent's own `[assumption]`
marks intact. The worker log is the whole story:

```
14:38:11 job 3d58280c · context · 23. 11. 2026. 15:38
14:38:12 job 3d58280c-… · template context · model vpl/nemotron-…
14:39:02 job 3d58280c-… · done · 50s · 1 file(s)
14:39:03 job 3d58280c · done · 1 file(s) back
```

**Three bugs the two runs found**, all the same family — obvious once it fails:

- `va_jobs.user_id` had no default, so the desk's insert was rejected over a null
  it never meant to send. The session knows who pressed the button; the column
  now defaults to `auth.uid()`.
- The storage path was encoded whole, so `…/task.md` became a single segment and
  storage answered `Bucket not found`. Segments are encoded; slashes are not.
- `va_outputs.kind` is a closed list (`doc|report|code`), so keeping an answer as
  `'answer'` was a 400 that the browser reported as "failed to load resource".

## The slices, in the order that keeps it light

1. ~~**The deck**~~ — done.
2. **The box list and the canvas** — kind `diagram` artifact, YAML as text, the
   SVG canvas, the three views, the validation strip. This is the week's real
   work, and it is where "is the canvas worth it" gets answered by using it.
   Still to do: the agent already produces the list, so the canvas now renders
   something real from the first day.
3. ~~**The hand-off**~~ — done.
4. **Only if it earns it** — the reverse pull, done by the agent, shown as a
   report and a drawing.

## Built: the agent, and where it runs

The agent exists, in `agent/`, and it was built and run in the `eva` workshop —
the Ubuntu container that already hosts a `pi`, so the work was "make it an
agent" rather than "make a machine".

What the workshop was given first, because libraries had started to complain:
**node 26.13.1** (the current LTS, at `/opt/node26`, first on `PATH` via
`/etc/profile.d`, with `node`/`npm`/`npx`/`pi` repointed) and **`pi` 1.6.0** on
top of it, plus **terraform 1.17.2**. Old node was 22.19.

The box then got **plain `pi` with the two keys that already exist**: Gemini as
pi's own `google` provider and NVIDIA as a `nim` provider in
`~/.pi/agent/models.json` (`https://integrate.api.nvidia.com/v1`), with the keys
in `~/.pi/agent/providers.env` (mode 600) sourced by login shells. **free-pi was
removed from the workshop** — it refuses unattended work (see below) — and it
stays only for the models outside these two, on a machine where somebody is
watching ads.

`agent/` is one file of loop (`worker.mjs`), four prompts, a box-list checker, a
Dockerfile and a test that needs no model:

- a **job** is a directory with `task.md` (front matter `template:`, `title:`)
  and optional `inputs/`; the worker writes `out/report.md`, `out/files/`,
  `out/state.json`, `out/checks.json`. A job with `state.json` is never run
  twice.
- **nothing is a stream**: no port is opened, no socket, no webhook. A job
  appearing in a directory is the whole interface, and the answer is files.
- **the model is an endpoint, not a dependency**: the default is **plain pi**
  (`google/gemini-3.1-flash-lite`); a base turns it into an OpenAI-shaped
  endpoint, and then `models.json` is generated at start from
  `VPL_MODEL_BASE`/`VPL_MODEL`/`VPL_MODEL_KEY`, the key written as
  `$VPL_MODEL_KEY`, so a token never touches the disk.
- **a job is not a request**: a free tier answered `429` after five calls and
  the first terraform job died at the finish line with the files already
  written. The worker now waits and takes the job again (`VPL_RETRIES`).
- **asking for a shape is not checking it**: `lib/boxes.mjs` reads any
  `boxes.yaml`/`context.yaml`/`deployment.yaml` the agent wrote and appends
  **Mechanical checks** to the report — `name` where `id` belongs, a `kind`
  outside the closed list, an arrow to a box that does not exist, an orphan, a
  box without a host. The first `report` run drew five boxes and **no arrows**,
  and the report said so in five sentences. That is the `vc` verdict strip
  again, at the one place where a drawing can lie.
- **the deliverable is not a build directory**: `terraform init` leaves 100 MB
  of provider binaries; the worker prunes `.terraform/`, `node_modules/`,
  `.git/` and any file over 5 MB before it lists what the agent made.

Three real runs on the workshop, all with the agent doing the work itself:

- `context` — **22 s**, a valid `context.yaml` (six boxes, five arrows) and a
  report that names what it could not check, because `inputs/` was empty.
- `terraform` — **150 s**, five files, and `terraform validate` says
  *"Success! The configuration is valid."*; the report marks the provider
  version `[unverified]` instead of pretending.
- `report` (an inventory read) — **18 s**, an honest list of gaps, and the
  mechanical check catching the missing edges.

The agent then ran **on a vp key**, through `api.terg.hr/vp`, with a real NVIDIA
`nim` model behind the door: a terraform job finished in **157 s**, six files,
`terraform validate` green, and **44 credits** — one job is dozens of calls,
which is the case the ledger was built for. What that first real run found in the
door (an ambiguous column in `vp_spend`, the caller's model winning over the
issuer's, `tools` being dropped, and Gemini's `thought_signature` making tools
impossible behind an OpenAI-shaped relay) is written down in `docs/vp.md`.

One thing the runs proved by failing: **free-pi refuses unattended work**
(`403 ads_required` — ads pay for it, and a headless container shows none). A
docker agent therefore cannot run on the free-pi backend; it runs on a **vp
key**, which is exactly the case vp stage 2 was built for. The chain is now
testable end to end with a real call once a model key exists on an account.

## Tests, when it exists

`va-check.mjs` in the style of the others: the deck saves and autosaves; a box
added on the canvas is in the YAML; a box written into the YAML appears on the
canvas; an arrow to an unknown id is refused with a sentence; the three views
show the same list; a job folder appears with `task.md` and the chosen inputs;
an answer is shown, accepted item by item, and nothing enters a field by itself;
the terraform output is a code block, not prose; print prints the whole document.
`va-agent.mjs` drives a fake agent (a script that writes `out/`) so the hand-off
is proven without an agent.
