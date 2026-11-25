# The busy workspace

The worst case every screen is judged by first: ONE shared set, for every feature's scenes and
images. No feature shapes busy data of its own.

| what | how many |
|---|---|
| agents | 60, four levels deep (six efforts: a lead, three developers, a helper under each, a reviewer under the first helper; twelve agents alone); 52 on bb threads, 8 on tmux |
| asking (needs you) | 11, one of them a lead whose own developer asks too; four of their questions are four lines long |
| failed, lost, outside OATS | 3 failed; 7 whose session was lost (3 on bb, 4 on tmux); 2 running outside OATS |
| souls | 24, most with long names |
| automations | 37 (25 schedules, 12 triggers); 5 failing; 4 schedules hold 50 runs each |
| teams, machines | 7 and 5 |
| a busy chat | ONE agent on bb (`chat.json` names it) with a long conversation (ten turns: paragraphs, lists, a code block) and a full board: twelve facts, nine open questions, one of four lines. Its mail: a slot, filled when the mail piece's recorded answers are on main |
| names | up to 61 characters (the kernel's own limit is 63); two efforts' names read alike once they are cut |

## Where it comes from: the recorded answers, multiplied

`generate.mjs` (plain node: no dependency, no clock, no random) READS the answers the other
fixtures hold and WRITES these files. **Every busy row is one recorded row; only its names, ids,
times and relations are varied, and a count that follows the rows. Nothing else.** Exactly:

| file | the answer it multiplies | what alone is varied in a row |
|---|---|---|
| `status.json` | `../roster/status.json` (its rows that ask, work, are idle, stopped, on tmux), `../outside/status-outside.json` (running outside OATS), `../panel/status-board.json` (the agent with a board), `../outside/status-archived-while-running.json` (a session lost on bb), `../lifecycle/tmux-row-lost.json` (a session lost on tmux) | the instance's name wherever the row writes it (`instance`, `home`, the identity's alias, the tmux window); its soul (`agent`, the soul's directory in `home`); its bb thread's id (a slot, `thr_busy_NN`, which the live stage fills with the run's own thread); `parentInstance`; a claim's `since` and `message`. On the busy chat's agent `board` is the recorded board multiplied: each fact a recorded fact (its `key`, `label`, `value`, `at` varied), each question the recorded question (its `id`, `question`, `since` varied), and its claim says the oldest question, as the kernel's does |
| `souls.json` | `../workspace/souls.json` | the soul's name wherever the row writes it; `description` |
| `schedule-list.json` | `../automations/schedule-list.json` | the schedule's name wherever the row writes it; the minute of `cron`; `description`; on four of them `recentRuns` is the recorded run fifty times, each with its own `runId`, `scheduledFor` and `startedAt`, and `history.stored` follows |
| `trigger-list.json` | `../automations/trigger-list.json` | the trigger's name wherever the row writes it; `description` |
| `teams.json` | `../workspace/teams.json` | `label`, `team`, `description`, `default`, and the label in `at`; an unmapped team's problem row follows it |
| `servers.json` | `../workspace/servers.json` | `id`, the host's name, `label` |

The documents around the rows are the recorded ones, with two counts that follow the rows (the
trigger count in the schedule list; the history's count) and, in `status.json`, the `features` of
the kernel that recorded `status-board.json` (it lists `provider-outside-oats` and `instance-board`,
without which the outside rows and the board would say nothing).

**The one shaped kind: a failed agent.** No kernel answer of a failed agent is recorded (the
plugin's README, "its session ended in a shell … (no recording)"). The three failed rows are the
recorded idle row with the two keys of that line of the README's table set: `running: false`,
`runtimeState: "shell"`. `test/busy/busy.test.ts` names them and allows it for them alone.

**The one made-up text: the busy chat's conversation** (`chat.json`). A conversation is no answer
of the kernel's, so none is recorded: the generator holds its ten turns, and the live stage has the
conversation for real, with the mock model answering each `you` with its `agent`
(`container/real/mock-anthropic.mjs`, `say.json`).

The made-up names are no person's and no real project's.

## What holds it

`test/busy/busy.test.ts`: the committed files are byte for byte what the generator makes (a hand
edit fails; run `node test/fixtures/busy/generate.mjs` after a change to a recorded answer and
commit both); every busy row, with its varied fields put back, is the recorded row it was
multiplied from; what was varied is in the table above and nowhere else; the set holds the numbers
above; and the plugin's own parsers read every file.

There is no `verbs.json` here: the busy set is no feature. The live stage `busy`
(`container/live-ui.mjs`; `container/README.md` says how a feature adds its scene) tells the fake
`oats` to answer these files. **For scenes and images only: a parser's tests stay on the recorded
answers.**
