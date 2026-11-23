# va-agent

One person's agent, in a box: it takes a **job directory**, does the work with
`pi` (shell, files, editor), and writes `out/`. It opens no port and listens to
nothing; a job appearing in a directory is the whole interface.

It is the other half of `va`: the desk writes a job, the agent answers, the
person accepts or drops each item. No agent ever receives a command from a
browser — that is a remote code execution button with a login screen on it.

## A job

```
jobs/2026-12-03-1422/
  task.md            ---
                     template: terraform
                     title: Small API on Kubernetes
                     ---
                     the prose request
  inputs/            documents, inventories, diagrams
  out/report.md      written by the worker
  out/files/         what the agent created
  out/state.json     status, model, milliseconds, file list, checks
  out/checks.json    the mechanical reading of any box list
```

`template:` picks the prompt from `prompts/` — `context`, `overview`,
`terraform`, `report` — and `prompts/base.md` is always prepended: evidence
before prose, nothing invented, work only inside the job, leave it editable.
A job with `out/state.json` is finished and is never run twice.

## What it checks for you

Asking for a shape is not checking it. If the agent wrote a box list
(`boxes.yaml`, `context.yaml`, `deployment.yaml`), `lib/boxes.mjs` reads it and
the report ends with **Mechanical checks**: a `name` key where `id` belongs, a
`kind` outside the closed list, an arrow to a box that does not exist, a box
without a host, an orphan box. Each is a sentence, and each is also in
`out/checks.json`.

## Run it

```bash
cp agent.env.example agent.env && chmod 600 agent.env && $EDITOR agent.env
set -a; . ./agent.env; set +a
node worker.mjs            # watch forever
node worker.mjs --once     # one pass, for tests
node worker.mjs --dry      # print the prompt a job would get, touch nothing
node worker.mjs --prune out/files   # tidy a deliverable by hand
```

The model is any OpenAI-compatible endpoint. A **vp key** is the intended one:
`VPL_MODEL_BASE=https://api.terg.hr/vp/v1`, `VPL_MODEL=vpl/<model>`,
`VPL_MODEL_KEY=vp_…` — one credit per call, an expiry, and usage visible in the
vp ledger. The key is passed through the environment and referenced from
`models.json` as `$VPL_MODEL_KEY`, so it is never written to disk. With
`VPL_MODEL_BASE` empty, pi's own provider is used (e.g.
`VPL_MODEL=google/gemini-3.1-flash-lite` with `GEMINI_API_KEY`).

A job is not a single request: a free tier answers `429` after a handful of tool
calls, so the worker waits and takes the job again (`VPL_RETRIES`, default 2)
instead of losing the work.

## Docker

```bash
docker build -t va-agent .
docker run -d --name va-agent -v "$PWD/jobs:/jobs" --env-file agent.env va-agent   # watch
docker run --rm -v "$PWD/jobs:/jobs" --env-file agent.env va-agent node /agent/worker.mjs --once
```

The default command is the watch loop, so the container stays up; add `--once`
to run one pass and exit. The image runs as uid 1000, the usual uid on a laptop,
so the mounted jobs directory is writable as it is — with a different uid, add
`--user "$(id -u):$(id -g)"`.

The image has `pi`, `git`, `ripgrep`, `jq` and `terraform`, and needs outbound
HTTPS only — no inbound port, no database, which is why a free tier box is
enough. The container is the sandbox; on a laptop the agent has **your** shell,
so say that out loud before running it on a machine you care about.

## Test

```bash
node test/worker-test.mjs                                   # 12 checks, no model, no network
node test/make-job.mjs context "a notes app with a database" jobs
node worker.mjs --once && cat jobs/*/out/report.md
```
