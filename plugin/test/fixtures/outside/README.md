The outside feature's fixture (`../../../README.md`, "Outside OATS"). The feature adds no `oats`
verb: it is read from the rows and the `features` of the one `oats status --json` (the roster's
verb), so there is no `verbs.json` here; a test names this file for that verb.

**Shaped, not recorded.** The real run's kernel is at 0.70.5 (the floor moved there after this
fixture was made), where the kernel prints `outsideOats`; the row recorded live, from a harness
that a message in bb started again in a home OATS stopped, comes with the second change of this
feature (the rows recorded live, and the real run's proofs). Until then,
`status-outside.json` is the recorded status of a home OATS stopped
  (`../roster/status-recorded.json`, key `stoppedByOats`: OATS 0.70.0, bb-app 0.50.1), whole, with
  two additions and nothing else changed: on its one row, `outsideOats` exactly as the kernel's own
  test builds it at the tag v0.70.5 (awebai/oats e5e7a2a4, `test/provider-outside-oats.test.mjs`
  line 45, `outsideOf(name)`: `{ code: "running-outside-oats", backend, message: "a harness runs in
  <name> on <backend>, and OATS recorded this instance stopped: stop it with \`oats instance stop
  <name>\`, or start it from OATS" }`, with the row's own instance and `backend: "bb"`); and
  `provider-outside-oats` at the end of the document's `features`, where that kernel lists it
  (`lib/kernel-features.mjs` at the tag; `features` on `oats status --json` is the kernel's own list). The
  row's other fields are what the kernel documents for such a row (`docs/desktop-cli-api.md` at the
  tag, anchor `row-outside-oats`): `running: false`, `runtimeState: "stopped"`, `sessionEnd:
  "stopped"`, `open: null`, no claim, which is what the recording holds.

The other rows the feature's tests read are recorded ones: `../roster/status-recorded.json`
(`stoppedByOats`: an operator's stop; `threadDeleted`: a session OATS lost, `sessionEnd: "lost"`).

**Recorded, then filtered: bb's events of three threads** (`events-*.json`), for the rule that
tells a thread that failed at its start from one whose later turn failed (`../../../README.md`, "A
thread that failed at its start"). Each is the answer of `bb thread messages <id> --json` for one
thread of the pi run's probe (an array of `{id, scope, threadId, seq, createdAt, type, data}`;
recorded by the pi run's developer on bb-app 0.50.1, the pi provider on the run's mock model, OATS
0.70.5; the whole recordings are the probe's `A-`, `B-` and `C-thread-messages.json`, kept in its
scratch directory `thread-state-probe/`, not in this repository), FILTERED to these two types
from the recording: `system/error` and `turn/started`, the two the plugin asks bb for. The events
kept are unchanged; the events of every other type are left out, as the typed read leaves them out
(among them `provider.env-resolved`, which holds the thread's environment).
- `events-never-started.json` (A, 9 events recorded): a spawn with a model pi could not resolve.
  One `system/error` (`data.code` "thread_command_failed", `data.message` "Command thread.start
  failed", `data.detail` the reason), no `turn/started`.
- `events-ran-then-stopped.json` (B, 20 events recorded): a thread that ran one turn and was then
  stopped in bb (`bb thread stop`, outside OATS; bb left its status "idle"). One `turn/started`,
  no `system/error`. It is NOT a session the kernel calls lost: the probe holds none.
- `events-later-turn-failed.json` (C, 35 events recorded): a thread whose later turn failed. Two
  `turn/started` and no `system/error`: bb recorded that failure as four `provider/error` events,
  which the filter leaves out, so the failure itself is not in this file.

Limits of the probe: bb 0.50.1, the pi provider only, the pi run's mock. Whether another failed
command of bb's also arrives as a `system/error` with the code "thread_command_failed" was not seen
(the rule does not read the code or the message: an error and never a turn).
