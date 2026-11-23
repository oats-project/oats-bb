# The lifecycle's recorded answers

`../README.md` says where each file of this directory comes from and how the recording is made
(`container/real/`). Two more, recorded by the lifecycle's own part of the real run
(`container/real/parts/lifecycle.mjs`), where the acts go through their dialogs in the browser:

- `stop-plan-no-recursive.json`: `oats instance stop dialogs-1-helper --plan --no-recursive --json`,
  the plan the Stop dialog reads when "Include child instances" is turned off, for an agent with
  one child (`dialogs-1-child`, under `skipped` with `reason: "recursive=false"`).
- `retire-apply-discard.json`: the receipt of `oats retire dialogs-2-helper --discard-worktree`
  under its plan's revision, as the Retire dialog asks it with "Also delete the worktree" on
  (`retention.worktree: "removed"`, `worktreeRemoved: true`).

Recorded on 2026-11-22 with the versions `../README.md` names, the same one substitution (the
paths), and no other edit. Neither is a default answer of the fake (`verbs.json`): a test names
the file for the verb it asks.
