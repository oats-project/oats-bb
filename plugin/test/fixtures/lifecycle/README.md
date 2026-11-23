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

## The rows of an agent that does not run (the Start dialog's "cut off" line)

No file: the tests of `carriesOn` and of the Start dialog (`test/lifecycle/words.test.ts`,
`actions.test.tsx`) name the three rows by their fields. Which is recorded, and which is shaped
from a contract:

- **An operator's stop**: `running: false`, `runtimeState: "stopped"`, `sessionEnd: "stopped"`.
  RECORDED: the row of `weekly-digest-helper` in `../roster/status.json` and
  `../roster/status-recorded.json`.
- **A lost session**: `running: false`, `runtimeState: "stopped"`, `sessionEnd: "lost"`. SHAPED
  from the kernel's source, not recorded (`lib/instance-listing.mjs` of awebai/oats: a session the
  host's shutdown stopped, or one that is gone on a home OATS did not stop). The live scene uses
  the same shape over the recorded roster.
- **A thread at rest with no harness loaded**: `running: false`, `runtimeState: "unknown"`, no
  `sessionEnd`. SHAPED from the contract of the bb session provider's NEXT release (its harness
  scan answers `running` for an idle thread); the provider on main answers `running: null` for
  that thread, so no kernel prints this row yet. To be recorded when that release is pinned.
