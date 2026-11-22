# The instance panel's fixtures

Each file is one answer of the real kernel, whole, printed with one space of indentation, with the
substitution of `test/fixtures/README.md` and no other edit: the paths (the deployment is
`/abs/deployment`, the run's directory `/abs/real`, the container user's home `/abs/home`). bb's
thread and project ids, start ids, commit ids and times are as recorded, and the tests hold them as
literals.

Recorded on 2026-11-21 in the real run's container (`container/real/`, kept with `KEEP=1`, after its
scenario passed): bb-app 0.50.1, OATS 0.70.0 from npm (`@awebai/oats@0.70.0`), the bb session
provider of this repository's `main` at 134ca09ab6d89c0432ba2e53cd7bbfd9bfc185e5, Claude Code on the
mock model, no aweb. By hand, with the commands below, before the real run had a place for a
feature's own steps; `container/real/parts/panel.mjs` now makes the same state with the same
commands and keeps the same answers, as the plugin's own calls of `oats` printed them. One
difference: before the hand recording, three agents the scenario had left were retired (`oats
retire harvest-knowledge-helper`, `desktop-mockups-developer`, `digest-links-helper`); the run
retires nobody, so its roster holds them too.

In the deployment the scenario left (`redesign-ui-lead` of `oats-product-expert`, stopped through
OATS by the scenario's last stop), one more agent
was spawned, a child on a worktree:

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
| `inspect-home.json` | `oats inspect --home <home of panel-worktree-helper> --json` | the instance as spawned: no core slot filled (the run's workspace has no knowledge, messaging or tasks capability), `oats.bb` and `oats.core` from packages |
| `events.json` | `oats instance events panel-worktree-helper --home <its home> --limit 100 --json` | after `oats session restart`, a stop (`oats instance stop`, plan and apply), `oats session start` and one more board question: 8 rows, the board's claim live |
| `readiness-home.json` | `oats readiness --home <its home> --policy --json` | ready; the provider's own answer has two warnings; read after the commit to the member repository, so its `member` item names that commit |
| `readiness-soul.json` | `oats readiness --soul oats-expert --policy --json` | ready |
| `status-board.json` | `oats status --json` | after the events above: the child's board holds its two facts and two open questions (`q3`, and `q4` with a context), and the row's claim is the board's (`oats.board`) |
| `inspect-board.json` | `oats inspect --home <its home> --board --json` | the same moment: each fact with its history, each question with its context |
| `inspect-board-stopped.json` | the same, after `oats instance stop` | a stop ends the session's questions and keeps the facts |
| `input-sent.json` | `oats session input --home <its home> --text-file <f> --json`, the file holding `q3: main: the default` | sent: `submitted: true`, `verified: true` |
| `status-question.json` | `oats status --json` | while a question of the harness's own was open in the agent's bb thread: the row's claim is `oats.core`'s, reason `question`, and the board's questions are still open |
| `input-prompt-open.json` | `oats session input …`, in that state | `E_SESSION_PROMPT_OPEN`: nothing was sent |
| `input-not-running.json` | `oats session input …`, after `oats instance stop` | `E_SESSION_NOT_RUNNING`: nothing was sent |
| `readiness-home-not-ready.json` | `oats readiness --home <its home> --policy --json`, run with a `PATH` that has no `bb` on it | not ready: the session provider's check cannot run bb (`needs-configuration`, `E_BACKEND_VERSION`), one of four required checks fails. Not a call of the plugin's: its host runs `oats` with bb's own `PATH`, so the real run asks the kernel itself (step C panel 3b) |

The real run makes and keeps `status-board.json`, `inspect-board.json` and `input-sent.json` from
the plugin's own calls (step C panel 5). The other four board files were recorded by hand in the
same kept container: the stopped home's two with the commands in the table, and the two of the
open harness question while bb showed a pending `user_question` interaction on the agent's thread,
which the real run's mock model never asks. `E_SESSION_INPUT_QUEUED` has no recording: the tests
hold its sentence by its code alone.

