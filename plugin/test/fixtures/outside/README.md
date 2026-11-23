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
