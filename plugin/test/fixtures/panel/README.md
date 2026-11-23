# The instance panel's fixtures

Each file is one answer of the real kernel, whole, printed with one space of indentation, with the
substitution of `test/fixtures/README.md` and no other edit: the paths (the deployment is
`/abs/deployment`, the run's directory `/abs/real`, the container user's home `/abs/home`). bb's
thread and project ids, start ids, commit ids and times are as recorded, and the tests hold them as
literals.

Recorded on 2026-11-23 by ONE real run (`plugin/container/ci.sh real`, its scenario and every check
passed), all eight from that run and none edited after it: this repository's `main` at
f4f07d8f488f4e052a6c73a82d59867b0e138f05 (the plugin and the real run's own scripts), bb-app 0.50.1, OATS 0.70.5 from npm
(`@awebai/oats@0.70.5`, gitHead e5e7a2a48db42140718948553e8272fb4e8e3ed4), the plugin's floor; the
bb session provider as the run's lock pins it (`oats.bb` at
9b95a56f237ff4006a69545963d5130d6eb4ddc5, the commit every `oats.bb` origin in these files names),
Claude Code on the mock model, no aweb. `container/real/parts/panel.mjs` makes the state with the
commands below and keeps the answers as the plugin's own calls of `oats` printed them
(`container/real/fixtures.mjs` writes them to the run's `out/fixtures/panel/`, with the paths'
substitution); they were copied here as written.

The eight are of one build and, where the table says so, of one moment: a screen or a test that
draws two of them together shows one agent's one story. Before this recording they were of
2026-11-21 at OATS 0.70.0, made by hand in a kept container, and two differences from then are
visible in them:

- The roster holds every agent the run's scenario leaves (`harvest-knowledge-helper`,
  `desktop-mockups-developer`, `digest-links-helper`, and the agent the scenario's schedule started,
  named for the run's minute: `oats-developer-real-run-digest-202611231207`), beside
  `redesign-ui-lead` and `panel-worktree-helper`: the run retires nobody. The hand recording had
  retired three of them first, so its three status files held their souls with no instance and a
  `key` of null; a soul with an instance has its key, as here. `redesign-ui-lead` therefore has
  three children in these files, not one.
- In `oats readiness --home` for a home on a session provider, the item of producer "harness
  folder trust" is `status: "not-applicable"` with `file: null` and the kernel's reason ("a session
  provider runs this launch (backend bb), with no OATS pane: claude folder trust is not read for
  it …"), from OATS 0.70.4; at 0.70.0 it was `unknown` with the file it had read. The panel says
  the kernel's word on the item's line, as the Desktop does ("launch · not-applicable · optional"),
  and names a configuration file only where the kernel does: `readiness-soul.json`, where no
  session provider is known yet, still holds that item as `unknown` with the file it read.

In the deployment the scenario left (`redesign-ui-lead` of `oats-product-expert`, stopped through
OATS by the scenario's last stop), one more agent
was spawned, a child on a worktree:

```sh
oats spawn oats-expert --backend bb --yolo --name panel-worktree-helper --parent redesign-ui-lead --task-file <f> --json
```

and, as its session would (in its home, with `OATS_INSTANCE` and `OATS_INSTANCE_HOME` set), facts
and questions were put on its board (`oats instance board set`, `oats instance board ask`), which
sets the waiting claim of producer `oats.board`.

| File | The call, in the deployment directory | State |
|---|---|---|
| `status.json` | `oats status --json` | `panel-worktree-helper` idle in bb (`running: null`), on its branch, child of `redesign-ui-lead`, its board and the board's claim in its row |
| `status-soul-moved.json` | `oats status --json` | the same, after one commit to `souls/oats-expert/AGENTS.md` in the workspace's member repository: the row's `soul.status` is `moved` |
| `inspect-home.json` | `oats inspect --home <home of panel-worktree-helper> --json` | the instance as spawned: no core slot filled (the run's workspace has no knowledge, messaging or tasks capability), `oats.bb` and `oats.core` from packages |
| `events.json` | `oats instance events panel-worktree-helper --home <its home> --limit 100 --json` | after `oats session restart`, a stop (`oats instance stop`, plan and apply), `oats session start` and one more board question: 8 rows, the board's claim live |
| `status-board.json` | `oats status --json` | right after `events.json`: the roster of the same moment. The child's claim is the one its activity names (`oats.board`, since 12:15:20, "Which base branch?"); its soul's repository has moved. The live scenes draw this roster with that activity: one agent, one story |
| `readiness-home.json` | `oats readiness --home <its home> --policy --json` | ready; the provider's own answer has two warnings; read after the commit to the member repository, so its `member` item names that commit |
| `readiness-soul.json` | `oats readiness --soul oats-expert --policy --json` | ready |
| `readiness-home-not-ready.json` | `oats readiness --home <its home> --policy --json`, run with a `PATH` that has no `bb` on it | not ready: the session provider's check cannot run bb (`needs-configuration`, `E_BACKEND_VERSION`), one of four required checks fails. Not a call of the plugin's: its host runs `oats` with bb's own `PATH`, so the real run asks the kernel itself (step C panel 3b) |
