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
