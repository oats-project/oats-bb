The outside feature's fixture (`../../../README.md`, "Outside OATS"). The feature adds no `oats`
verb: it is read from the rows and the `features` of the one `oats status --json` (the roster's
verb), so there is no `verbs.json` here; a test names this file for that verb.

**Recorded live**, by the outside feature's part of the real run (`container/real/parts/outside.mjs`)
on 2026-11-23: OATS 0.70.5 from npm, the bb session provider of this repository's `main` at
a1678578 (oats-bb #40: it archives a home's thread at its stop, and scans its harness), bb-app
0.50.1, Claude Code on the mock model. Each file is `oats status --json` as printed, whole, with
the agent's row alone (the run's other agents are left out of `agents`), the real run's
substitutions (the paths, the machine's name) and no other edit. The agent is
`flaky-ci-2-developer` of `oats-developer`.

- `status-at-rest.json`: the agent idle, its harness loaded: `running: true`, `runtimeState:
  "unknown"`.
- `status-not-loaded.json`: its session there and no harness loaded (the thread's harness process
  ended, as after a reboot on a host without `oats host run`): `running: false` beside
  `runtimeState: "unknown"`, no `sessionEnd`.
- `status-stopped-archived.json`: stopped with OATS (the plugin's own Stop): `running: false`,
  `runtimeState: "stopped"`, `sessionEnd: "stopped"`, `open: null`; bb then holds its thread
  archived (the provider's stop).
- `status-outside.json`: that home after a person unarchived its thread in bb and sent it a
  message there (`bb thread unarchive`, `bb thread tell`): the row OATS recorded, unchanged
  (stopped, not running), with the kernel's own report beside it, `outsideOats: { code:
  "running-outside-oats", backend: "bb", message }`, and `provider-outside-oats` among the
  document's `features`. It replaces the file of this name that was shaped from the kernel's own
  test: the recorded report has the same members and the same sentence.
- `status-archived-while-running.json`: a running agent whose thread a person archived in bb
  (`bb thread archive`): `running: false`, `runtimeState: "stopped"`, `sessionEnd: "lost"`. bb's
  Archive ends OATS's hold on the session, not the harness.

The other rows the feature's tests read are recorded ones: `../roster/status-recorded.json`
(`stoppedByOats`: an operator's stop; `threadDeleted`: a session OATS lost, `sessionEnd: "lost"`).

**Recorded, then filtered: bb's events of three threads** (`events/*.json`: a directory of their own, since every `.json` beside this file is a status document of the case table, `test/model/cases.test.ts`), for the rule that
tells a thread that failed at its start from one whose later turn failed (`../../../README.md`, "A
thread that failed at its start"). Each is the answer of `bb thread messages <id> --json` for one
thread of the pi run's probe (an array of `{id, scope, threadId, seq, createdAt, type, data}`;
recorded by the pi run's developer on bb-app 0.50.1, the pi provider on the run's mock model, OATS
0.70.5; the whole recordings are the probe's `A-`, `B-` and `C-thread-messages.json`, kept in its
scratch directory `thread-state-probe/`, not in this repository), FILTERED to these two types
from the recording: `system/error` and `turn/started`, the two the plugin asks bb for. The events
kept are unchanged; the events of every other type are left out, as the typed read leaves them out
(among them `provider.env-resolved`, which holds the thread's environment).
- `events/never-started.json` (A, 9 events recorded): a spawn with a model pi could not resolve.
  One `system/error` (`data.code` "thread_command_failed", `data.message` "Command thread.start
  failed", `data.detail` the reason), no `turn/started`.
- `events/ran-then-stopped.json` (B, 20 events recorded): a thread that ran one turn and was then
  stopped in bb (`bb thread stop`, outside OATS; bb left its status "idle"). One `turn/started`,
  no `system/error`. It is NOT a session the kernel calls lost: the probe holds none.
- `events/later-turn-failed.json` (C, 35 events recorded): a thread whose later turn failed. Two
  `turn/started` and no `system/error`: bb recorded that failure as four `provider/error` events,
  which the filter leaves out, so the failure itself is not in this file.

Limits of the probe: bb 0.50.1, the pi provider only, the pi run's mock. Whether another failed
command of bb's also arrives as a `system/error` with the code "thread_command_failed" was not seen
(the rule does not read the code or the message: an error and never a turn).
