# Prompt — review a change against the rules

Use this before you merge, or when somebody hands you a diff and asks "is this
all right?". It turns a reading into checks you can actually run.

---

Review this change in the `vpl` repository. Read `AGENTS.md` first and keep
`docs/rules.md` open; the answer is not an opinion about style, it is which rule
the diff breaks and which command proves it.

**Ask of every diff:**

1. **Independence** — does it import across apps, link to a sibling, write
   another app's tables, or touch `packages/shell` without restaging? (`./tools/stage.sh --check`)
2. **One id, one element** — any new `id` used twice in one document?
   (`chrome-check` fails on duplicates; `getElementById` returns the first, which
   is how a message gets painted behind a modal)
3. **Signal** — does every new state carry a word and a mark, not only a colour?
4. **Deletion** — does any new ✕ destroy? It must bin, and emptying must be a
   separate verb that names what it destroys.
5. **A model writing into a field** — does any response land in an input on its
   own? It must propose in a balloon and wait for *use it*.
6. **The database** — is a permission asserted on a *row* where it is really
   about a *column*? A client must never write `owner_id`/`user_id`; that is a
   trigger (`vpl_owner_is_not_a_field`), not a policy. Does any policy read a
   column the caller may not select? That 403s for everybody — ask through one
   `security definer` function instead.
7. **Print** — does the new chrome stay out of print media, and does `Ctrl+P`
   print what the button prints?
8. **Secrets** — a key, a password, a token, a default address pointing at
   somebody's deployment? None of those belong in the repository.
9. **Tests** — is the new behaviour proved by a suite that *presses the button*,
   and is that suite named in `tools/test-all.sh`? A group that is not in the
   list is green by absence.
10. **The claim** — does the commit message or the report say more than was run?

**Then run, and report numbers:**

```bash
./tools/stage.sh --check
./tools/test-all.sh                 # the whole gate
```

Give me: a bullet per rule that is at risk (with the file and line), a bullet per
rule that is plainly satisfied, and the two numbers from the gate — passed and
skipped. Do not summarise a suite you did not run.
