# Template: context

A system context diagram, in words and in one small YAML list.

Produce:

- `out/report.md` — the context in prose: who uses the system, which outside
  systems it talks to, and what crosses each boundary. Three to eight
  sentences, no more. Name each actor and each external system exactly as the
  inputs name them.
- `out/files/context.yaml` — the same thing as a box list:

```yaml
boxes:
  - id: api            # lowercase, stable, and this key is "id" — never "name"
    label: Public API  # what a person says out loud
    kind: service      # service | db | queue | gateway | k8s | vm | external | person
    host: api.example.hr:443
    note: one clause about what it is responsible for
    attrs: {}          # namespace, image, replicas — anything true and useful
arrows:
  - from: person
    to: api
    label: https
```

The worker reads this file mechanically and writes what it finds into the report:
a `name` key instead of `id`, a `kind` outside the list, an arrow to a box that
does not exist, an orphan box and a box without `host` (say `host: ""` and start
the note with `[no address]`) are each reported as a problem. Aim for none.

The system under discussion is **one box** (`kind: external` if you have no
better word); everything inside it belongs to the overview template, not here.
Every box needs a `note`. Every arrow needs both ends to exist and a `label`
that says what crosses it (`https`, `reads`, `publishes`, `nightly export`).
No box without an arrow to or from it.
