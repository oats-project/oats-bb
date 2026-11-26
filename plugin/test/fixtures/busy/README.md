# The busy workspace

The worst case every screen is judged by first: ONE shared set, for every feature's scenes and
images. No feature shapes busy data of its own.

| what | how many |
|---|---|
| agents | 60, four levels deep (six efforts: a lead, three developers, a helper under each, a reviewer under the first helper; twelve agents alone); 52 on bb threads, 8 on tmux |
| asking (needs you) | 11, one of them a lead whose own developer asks too; four of their questions are four lines long |
| failed, lost, outside OATS | 3 failed at their start; 7 whose session was lost (3 on bb, 4 on tmux); 2 running outside OATS |
| souls | 24, most with long names |
| automations | 37 (25 schedules, 12 triggers); 5 failing; 4 schedules hold 50 runs each |
| teams, machines | 7 and 5 |
| a busy chat | ONE agent on bb (`chat.json` names it) with a long conversation (ten turns: paragraphs, lists, a code block) and a full board: twelve facts, nine open questions, one of four lines (in the data: no screen of the plugin draws a board on main yet); and a full page of mail: fifty messages received, subjects short and long, every third the recorded long report |
| names | up to 61 characters (the kernel's own limit is 63); two efforts' names read alike once they are cut |

## Where it comes from: the recorded answers, multiplied

`generate.mjs` (plain node: no dependency, no clock, no random) READS the answers the other
fixtures hold and WRITES these files. **Every busy row is one recorded row; only its names, ids,
times and relations are varied, and a count that follows the rows. Nothing else.** Exactly:

| file | the answer it multiplies | what alone is varied in a row |
|---|---|---|
| `status.json` | `../roster/status.json` (its rows that ask, work, are idle, stopped, on tmux), `../outside/status-outside.json` (running outside OATS), `../outside/status-failed-at-start.json` (failed at its start), `../panel/status-board.json` (the agent with a board), `../outside/status-archived-while-running.json` (a session lost on bb), `../lifecycle/tmux-row-lost.json` (a session lost on tmux) | the instance's name wherever the row writes it (`instance`, `home`, the identity's alias, the tmux window); its soul (`agent`, the soul's directory in `home`); its bb thread's id (a slot, `thr_busy_NN`, which the live stage fills with the run's own thread); `parentInstance`; a claim's `since` and `message`. On the busy chat's agent `board` is the recorded board multiplied: each fact a recorded fact (its `key`, `label`, `value`, `at` varied), each question the recorded question (its `id`, `question`, `since` varied), and its claim says the oldest question, as the kernel's does |
| `souls.json` | `../workspace/souls.json` | the soul's name wherever the row writes it; `description` |
| `schedule-list.json` | `../automations/schedule-list.json` | the schedule's name wherever the row writes it; `description`; on four of them `recentRuns` is the recorded run fifty times: the NEWEST is the recorded run (the row's `lastRun` is of it), each older one has its own `runId` and is an hour before the one after it (`scheduledFor`, `startedAt`), and `history.stored` follows. `cron` and `nextRun` are the recorded ones |
| `trigger-list.json` | `../automations/trigger-list.json` | the trigger's name wherever the row writes it; `description` |
| `mail.json` | the DOCUMENT is `../mail/mail-first-page.json`, the WHOLE answer with its envelope: the recorded first page of a mail read, which says there is more and carries the cursor that reads it (the Mail tab offers "Older"); its MESSAGES are the recorded received messages of `../mail/mail.json`. (The busy chat's agent's mail; the set holds one agent's, so the stage answers it for every agent, and the same page for every read) | the agent it is of (its name and its soul's directory, wherever the answer writes them: the target, the alias of its identity, each message's `to`); `messages` is the recorded received messages fifty times, each with its own `id`, `conversationId`, `createdAt`, `subject` and `threadTitle`, a made-up `body` on the short ones (the long report's body stays as the messaging layer cut it), and, two of every three, a SENDER that is one of the set's long-named agents (`from.alias` and the address); `conversations` follows. `documents`, the messaging layer's own rendering, is the recorded one: the plugin does not read it |
| `teams.json` | `../workspace/teams.json` | `label`, `team`, `description`, `default`, and the label in `at`; an unmapped team's problem row is the recorded problem row, for that team (its `label`, and the label in `at` and in its message) |
| `servers.json` | `../workspace/servers.json` | `id`, the host's name, `label` |

The documents around the rows are the recorded ones, with two counts that follow the rows (the
trigger count in the schedule list; the history's count) and, in `status.json`, the `features` of
the kernel that recorded `status-board.json` (it lists `provider-outside-oats` and `instance-board`,
without which the outside rows and the board would say nothing).

A group of the roster (`agents[]`) is the recorded group with its soul's `name` and its rows; a
conversation of the mail is the recorded conversation row with its message's `id`.

**No row is shaped.** A failed agent is the kernel's recorded row of a home whose bb thread
failed at its start (`../outside/status-failed-at-start.json`, the pi run's). That row is a lost
session's: what says "Failed at its start" is bb's own record of the thread (an error and never a
turn). So the live stage makes those three agents' threads fail at their start for real
(`threads.json` names them); a thread that could not be made to fail reads as a lost session, and
the stage says so.

**One field is joined from a second recorded row.** The recorded row with a board has no messaging
identity (its agent was spawned with none), and the panel offers no Mail tab for such an agent. So
that ONE agent holds the conversation, the board and the mail, the busy chat's row takes the
`identity` of the recorded roster's lead, with its own name as the alias. No other row has a field
of another's.

**The one made-up DOCUMENT: the busy chat's conversation** (`chat.json`). A conversation is no
answer of the kernel's, so none is recorded: the generator holds its ten turns, and the live stage
has the conversation for real, with the mock model answering each `you` with its `agent`
(`container/real/mock-anthropic.mjs`, `say.json`).

**The made-up TEXTS in rows** (a text is what a row may be varied in): the four-line question and
the claims' words; the board's nine questions and its twelve facts' labels and values; the mail's
ten subjects and three short bodies; the long descriptions of souls, automations and teams.

**What a row keeps of its recorded soul.** Only `agent` and the soul's directory in `home` name
the busy soul; `workspace.soul.id` and `launchAt` still name the recorded one. The plugin reads
neither field.

**What follows what.** A varied time stays beside the recorded times of its row: a claim's, a
fact's and a question's are the recorded time or minutes after it; a message's is the recorded one
or minutes before it (never before its agent was made). Where a recorded row says a relation (the
rows of the kernel that recorded the board), it follows the parent: a child is `"child"` of its
parent (`relation`, `relativeTo`), a root has neither key, as the recorded roots. A run of a
schedule carries the schedule's busy name wherever the recorded run writes it, as the row's
`lastRun` does; all fifty keep the recorded run's `instance`, `home` and `recordedAt`. The person a
recorded row names (`attributedHuman`) is not carried into the set: a made-up name stands there.

The made-up names are no person's and no real project's.

## What holds it

`test/busy/busy.test.ts`: the committed files are byte for byte what the generator makes (a hand
edit fails; run `node test/fixtures/busy/generate.mjs` after a change to a recorded answer and
commit both); every busy row, with its varied fields put back, is the recorded row it was
multiplied from; what was SET in a row is in the table above and nowhere else, and what was
SWAPPED is the row's own name or id (a closed list per kind: never another string of the row);
every row put back IS a row of the recorded answers, which the test reads ITSELF from the fixture
files and puts back with its own hands (a closed list of sources per kind: a row from anywhere
else, or made with no varying, fails); what a field may be set TO is of the recorded value's kind
(nothing stays nothing; a relation is an agent of the set);
THE FILES hold nothing but those rows (every row of every list in every file is one the two tests
above read, in a recorded document that is otherwise unchanged; a list or an object put into a row
is one of six, each compared); the set holds the numbers above; and the plugin's own parsers read
every file.

There is no `verbs.json` here: the busy set is no feature. The live stage `busy`
(`container/live-ui.mjs`; `container/README.md` says how a feature adds its scene) tells the fake
`oats` to answer these files. **For scenes and images only: a parser's tests stay on the recorded
answers.**
