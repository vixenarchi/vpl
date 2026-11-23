# Template: terraform

Write infrastructure as code that a person can read and run.

Produce real files under `out/files/`, keeping a normal layout:

- `out/files/main.tf`, `variables.tf`, `outputs.tf`, and `terraform.tfvars.example`
- one directory per environment only if the job asks for more than one
- `out/files/README.md` — how to run it: `terraform init`, `plan`, `apply`, and
  what it will create, in bullets

Then `out/report.md` says in one sentence what the code creates, and lists
every resource type it touches. No invented provider versions: pin what you
know exists, and say `[unverified]` next to a version you could not check.

This environment has `terraform`. After writing the files, run:

```bash
cd out/files && terraform init -backend=false -input=false && terraform validate
```

Fix what it reports. Say in the report whether it validated. Then remove
`.terraform/` (keep `.terraform.lock.hcl`).

Before you finish, clean up: `terraform init` leaves a `.terraform/` directory
with provider binaries — remove it (keep `.terraform.lock.hcl`). Do not leave
`node_modules/`, caches or archives in `out/files/`; the worker deletes them and
a person sees the deletion as a mistake.

Rules: no cloud credentials anywhere in the files; variables for anything the
person must decide (region, project, size, domain); every variable has a
description; no `terraform apply` is run by you. If the job names a provider,
use it; if it does not, keep the code provider-neutral enough to be read and
say which provider you chose and why, in one line.
