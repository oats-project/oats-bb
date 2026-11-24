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
  still has: for example a home stopped with the host (`oats host run`'s shutdown; the kernel's
  `lib/instance-listing.mjs` answers the same three fields for it). Its thread is not archived,
  and a message in it carries the conversation on (confirmed by the kernel's side). The live scene
  is that pairing: the same fields over the recorded roster, on a thread the run's bb has. A
  thread in `error` whose harness is gone reads the same row, and takes a message as any listed
  thread does (bb's composer is live on it): it gets the line too (the one reading,
  `messageResumes`; read from bb's behaviour, not proven by a run).
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

## Two answers the live scenes shape (`container/scenes/lifecycle.mjs`)

Neither is a file, and neither was met by a run of ours to record:

- **A retire accepted for the background**: `{ retired, deferred: true, planRevision,
  idempotencyKey, replayed: false }`, SHAPED from the kernel's source (`lib/core.mjs` of
  awebai/oats: the two places that answer `deferred`). The unit test of it
  (`test/lifecycle/kernel.test.ts`) shapes the same.
- **A start that names no thread**: the recorded `start.json` with
  `result.session.endpoint.threadId` taken out, answered over a roster row changed to
  `running: true`, `runtimeState: "unknown"` and no `session`: the plugin's own code
  `NO_THREAD_NAMED` then (the kernel named no thread, and the next roster names none).

## A resume that started fresh, and one whose harness waits (shaped)

`start-resume-fresh.json`, `start-resume-waiting.json`: SHAPED, not recorded: no real run has met
either yet. They are from the kernel's doc at v0.70.5 (docs/desktop-cli-api.md, "Resume a lost
session (`--resume`)": "the ordinary start answer plus one object", `resume: {resumed, reason,
harness, sessionId, waiting}`). Each holds only the keys the plugin reads of a start's answer, for
the sample roster's agent on tmux (`kernel-fix-developer`), and the `resume` object of one case:
it started fresh (`reason: "no-conversation"`); it continues and the harness waits for its person
(`waiting: "resume-confirmation"`). The refusal `E_LAUNCH_ENV_CHANGED` is shaped in the tests as an
envelope of the kernel's form, with a message of ours. The resume that continues, the plain start,
the restart and the two refusals a real home gave are recorded (the section below);
`verbs.json` answers `session start --resume` with the recorded `tmux-start-resume.json`; the
live scene of the lifecycle (`container/scenes/lifecycle.mjs`) gives it, and the recorded plain
start (`tmux-start.json`), with ONE substitution, the
name of the agent it was recorded on (`lost-tmux-developer`) for the sample roster's agent on tmux,
since the result is named from the kernel's answer.

## An agent on tmux: its rows, and the kernel's answers for a start, a resume and a restart

Recorded by the lost session's part of the real run (`container/real/parts/lost.mjs`) on 2026-11-23,
OATS 0.70.5 from npm, on ONE agent on the tmux backend (`lost-tmux-developer` of `oats-developer`,
Claude Code on the run's mock model in a window of the OATS tmux server), with the one substitution
(the paths) and no other edit. Each is what the kernel printed for the command named, made on the
command line (the plugin offered no Start and no Restart for an agent on tmux when they were recorded); `<home>` is
`/abs/deployment/agents/oats-developer/instances/lost-tmux-developer`. None is a default answer of
the fake (`verbs.json`): a test names the file for the verb it asks.

- `tmux-row-running.json`, `tmux-row-stopped.json`, `tmux-row-lost.json`: the agent's ROW of `oats
  status --json` (one member of `agents[].instances[]`, not the whole document) while it runs
  (`running: true`, no `runtimeState`, no `sessionEnd`); after the plugin's own Stop
  (`running: false`, `runtimeState: "shell"`, `sessionEnd: "stopped"`: an OATS stop leaves the
  agent's tmux window at a shell); and LOST, its tmux window killed as a crash ends it
  (`running: false`, `sessionEnd: "lost"`, no `runtimeState`; the row carries no time of the loss
  and no cause). The plugin's one reading of a row that does not run reads these three
  (`test/model/rest.test.ts`).
- `tmux-start-resume.json`: `oats session start --resume --home <home> --json` on the lost home:
  started, with `resume: {resumed: true, harness: "claude", sessionId}` and `reused: "new"` (a new
  window); `target` names the tmux session, the window and the socket. No `waiting` member: Claude
  Code asked nothing before resuming this short conversation.
- `tmux-start.json`: `oats session start --home <home> --json`, a plain start, after the agent was
  stopped with OATS: started, `reused: "pane"` (the window the stop left), no `resume` member.
- `tmux-restart.json`: `oats session restart --home <home> --json` while it runs: restarted in its
  pane, with the `stop` it made first.
- `tmux-resume-not-lost.json`: `--resume` on the home stopped with OATS: `E_RESUME_NOT_LOST`
  ("… did not lose its session (it stopped) … nothing was started").
- `tmux-resume-running.json`: `--resume` on the home while it runs: `E_SESSION_RUNNING` ("… is
  running (unknown); nothing was started"), not `E_RESUME_NOT_LOST`.

## An act refused with the kernel's marker (shaped, no file)

The four refusals that carry the kernel's marker that it cannot confirm what is left
(`error.details.unconfirmed: true` in its envelope, which the plugin's server hands on as
`UNCONFIRMED_ISSUE`, `contract/shared.ts`) are SHAPED in the tests, not recorded: no real kernel
was made to give one for a stop, a start, a restart or a retire. The envelope's form and the
codes are the kernel's; that it marks them, and the messages, are ours. The tests: `test/lifecycle/words.test.ts` ("an act
the kernel refused and marked unconfirmed…", one case per verb, and "only with the marker") and
`test/lifecycle/actions.test.tsx` (the retire's dialog; the stop's and the start's).

## A restart the provider refuses: before the stop, or after it (recorded elsewhere, no file here)

Why the Restart dialog holds a changed model and holds nothing for a changed harness (plugin/README.md,
"Restart does not stop what it cannot start"; `model/restart-model.ts`) rests on two recordings of
the real kernel, OATS 0.70.5 with the bb session provider's check of pi model ids, kept by the
kernel side and not copied here (no test reads them as fixtures):
`/home/joan/Work/oats/agents/oats-engineering-expert/instances/bb-backend-specialist/evidence/pi-model-check/`
(a copy: `…/bb-plugin-specialist/evidence/pi-model-check/`).
- `refusal-shapes/4-session-restart.*`: `oats session restart --model <a model pi does not have>`
  on a RUNNING agent: `E_BACKEND_LAUNCH_ARG` ("… pi has no model …"), and `4-after.txt`: the
  agent stopped, its thread archived, nothing started. The kernel stopped the session before the
  provider judged the model. (1, 2 and 3 there: a refused spawn, a preview and a start on a
  stopped home harm nothing.)
- `restart-harness/A-*`, `B-*`: a restart on a harness whose bb provider is not ready:
  `E_BACKEND_NOT_READY`, "… nothing was stopped or started", and the agent still runs. The
  message of the dialog's test of that refusal (`test/lifecycle/actions.test.tsx`, "a harness
  changed to one bb cannot run here is NOT held…") is A's, as recorded.
The lists of models in the hold's own tests (`listsSdk`, `PI_LIST`) are SHAPED as bb answers its
SDK's `providers.models` (rows of `model` and, for pi, `routeProviderId`): no answer of that call
is recorded; the pi run's step P4b reads bb's real answer through the dialog.
