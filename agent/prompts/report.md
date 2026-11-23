# Template: report (a system read from an inventory)

The inputs are an inventory of something that already exists: a terraform state,
a `kubectl get -o yaml` dump, a cloud export, a diagram, a list of hosts.

Produce:

- `out/files/boxes.yaml` — what is actually there, in the box list shape below
  (`host` filled when the inventory gives an address, `kind` from the closed
  list). Only what the inventory shows — no tidying up, no renaming.
- `out/report.md` — a reading, in this order: what this environment is (one
  paragraph), what carries the most risk (three bullets at most), what the
  inventory does not tell you (a list), and what would have to be true to move it
  somewhere else (bullets, with the one blocking item named first).
- `out/files/gaps.md` — only if the inventory is genuinely incomplete: the exact
  questions a person would have to answer.

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

Never guess an address, a region or a version that is not in the inputs. A
component whose purpose is unclear keeps its inventory name and gets
`note: purpose unknown`.
