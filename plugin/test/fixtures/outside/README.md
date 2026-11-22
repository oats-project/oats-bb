The outside feature's fixtures (`../../../README.md`, "Outside OATS"). It adds no `oats` verb: it
reads the rows of the one `oats status --json` and the features of the one `oats version --json`
(the roster's verbs), so there is no `verbs.json` here; a test names these files for those verbs.

**Shaped, not recorded.** No live `oats status` with `outsideOats` can be recorded yet: it needs a
bb session provider whose stop leaves a thread a message can restart AND a kernel at 0.70.5 in the
real run, and the real run's kernel is pinned at 0.70.0 until the floor moves (the second change of
this feature re-records every fixture at 0.70.5 and records this row live). Until then:

- `status-outside.json`: the recorded status of a home OATS stopped
  (`../roster/status-recorded.json`, key `stoppedByOats`: OATS 0.70.0, bb-app 0.50.1), whole, with
  two additions and nothing else changed: on its one row, `outsideOats` exactly as the kernel's own
  test builds it at the tag v0.70.5 (awebai/oats e5e7a2a4, `test/provider-outside-oats.test.mjs`
  line 45, `outsideOf(name)`: `{ code: "running-outside-oats", backend, message: "a harness runs in
  <name> on <backend>, and OATS recorded this instance stopped: stop it with \`oats instance stop
  <name>\`, or start it from OATS" }`, with the row's own instance and `backend: "bb"`); and
  `provider-outside-oats` at the end of the document's `features`, where that kernel lists it. The
  row's other fields are what the kernel documents for such a row (`docs/desktop-cli-api.md` at the
  tag, anchor `row-outside-oats`): `running: false`, `runtimeState: "stopped"`, `sessionEnd:
  "stopped"`, `open: null`, no claim, which is what the recording holds.
- `version-0.70.5.json`: the recorded `oats version --json` (`../roster/version.json`, OATS 0.70.0)
  with `version: "0.70.5"` and `provider-outside-oats` at the end of `features`
  (`lib/kernel-features.mjs` at the tag). Nothing else of 0.70.5's answer is claimed by it.

The other rows the feature's tests read are recorded ones: `../roster/status-recorded.json`
(`stoppedByOats`: an operator's stop; `threadDeleted`: a session OATS lost, `sessionEnd: "lost"`).
