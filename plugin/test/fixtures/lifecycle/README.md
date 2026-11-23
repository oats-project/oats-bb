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
  RECORDED: `stoppedByOats` in `../roster/status-recorded.json` (the row of `flaky-ci-2-developer`),
  and the same row under the sample's name `weekly-digest-helper` in `../roster/status.json`.
- **A lost session**: `running: false`, `runtimeState: "stopped"`, `sessionEnd: "lost"`. The ROW is
  RECORDED: `threadDeleted` in `../roster/status-recorded.json`, an agent whose thread was deleted
  in bb; with no thread in bb it gets no line. What is SHAPED is only its pairing with a thread bb
  still has: a home stopped with the host (`oats host run`'s shutdown; the kernel's
  `lib/instance-listing.mjs` answers the same three fields for it). Its thread is not archived,
  and a message in it carries the conversation on (confirmed by the kernel's side). The live scene
  is that pairing: the same fields over the recorded roster, on a thread the run's bb has. A
  thread in `error` whose harness is gone reads the same row; bb's status excludes it from the
  line, which is harmless (it could take a message too) and kept.
- **A thread at rest with no harness loaded**: `running: false`, `runtimeState: "unknown"`, no
  `sessionEnd`. SHAPED from the bb session provider's A15(1) change (its harness scan answers
  `running` for an idle thread: `inspectAnswer` in the provider's `lib/threads.mjs`, on its branch
  and not on main); the provider on main answers `running: null` for that thread, so no kernel
  prints this row yet. Such a thread takes a message: bb starts the harness and runs the turn on
  the same conversation. To be recorded when that release is pinned.

## A retire receipt's `warnings`

No recorded receipt carries the key: the kernel prints it only with something to say. The tests
that read warnings (`test/lifecycle/kernel.test.ts`, `words.test.ts`) add strings to the recorded
`retire-apply.json`, SHAPED from the kernel's source (`lib/core.mjs` of awebai/oats: `warnings` of
the retire's result is an array of strings). To be recorded when a run produces one.

## The retire refused while a process works in the home (`E_RUNTIME_QUIESCE_FAILED`)

`retire-pi-refused.json`: RECORDED by the pi run (`container/real/pi`, OATS 0.70.5), the kernel's
stdout for `oats retire pi-form-developer --plan-revision <rev> --idempotency-key <key> --json`
asked through the plugin within a minute of opening the agent's pi thread in bb, printed with
exit 1 and an empty stderr. The plan before it went through; nothing was removed; 50 s later
the same retire, from a new plan, went through. Copied as printed: it holds no path, so nothing
is substituted. The line the dialog adds does not depend on its message: it is decided from the
code, the plan's backend and the row's harness.
