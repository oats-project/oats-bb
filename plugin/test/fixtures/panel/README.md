# The instance panel's fixtures

Each file is one answer of the real kernel, whole, printed with one space of indentation, with the
substitution of `test/fixtures/README.md` and no other edit: the paths (the deployment is
`/abs/deployment`, the run's directory `/abs/real`, the container user's home `/abs/home`). bb's
thread and project ids, start ids, commit ids and times are as recorded, and the tests hold them as
literals.

Recorded on 2026-11-21 in the real run's container (`container/real/`, kept with `KEEP=1`, after its
scenario passed): bb-app 0.50.1, OATS 0.70.0 from npm (`@awebai/oats@0.70.0`), the bb session
provider of this repository's `main` at 134ca09ab6d89c0432ba2e53cd7bbfd9bfc185e5, Claude Code on the
mock model, no aweb. In the deployment the scenario left (`redesign-ui-lead` of `oats-product-expert`,
its two children retired by hand), one more agent was spawned, a child on a worktree:

```sh
oats spawn oats-expert --backend bb --yolo --name panel-worktree-helper --parent redesign-ui-lead --task-file <f> --json
```

and, as its session would (in its home, with `OATS_INSTANCE` and `OATS_INSTANCE_HOME` set), two facts
and two questions were put on its board (`oats instance board set`, `oats instance board ask`), which
sets the waiting claim of producer `oats.board`.

| File | The call, in the deployment directory | State |
|---|---|---|
| `status.json` | `oats status --json` | `panel-worktree-helper` idle in bb (`running: null`), on its branch, child of `redesign-ui-lead`, its board and the board's claim in its row |
| `status-soul-moved.json` | `oats status --json` | the same, after one commit to `souls/oats-expert/AGENTS.md` in the workspace's member repository: the row's `soul.status` is `moved` |
