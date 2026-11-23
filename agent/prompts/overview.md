# Template: overview

The inside of the system: components and what talks to what.

Produce:

- `out/files/boxes.yaml` — the box list, in exactly this shape:

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

- `out/report.md` — a short reading of that list: the two or three components
  that carry the most risk, why, and what is missing. Not a restatement of every
  box.
- `out/files/deployment.yaml` — only the boxes with a host, namespace or image,
  same shape, filtered. Nothing else.

Rules for the list: `id` is lowercase and stable, `label` is what a person says,
`kind` is from the closed list above and nothing else, and everything
cloud-specific goes in `attrs` (no `aws_...` or `gcp_...` keys in the schema
itself — a value inside `attrs` is fine). A box with no host says `host: ""` and
its note starts with `[no address]`. An arrow to an `id` that does not exist is
an error, not a style choice.
