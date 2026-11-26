# The busy workspace

The worst case every screen is judged by first: ONE shared set, for every feature's scenes and
images. No feature shapes busy data of its own.

| what | how many |
|---|---|
| agents | 60, four levels deep (six efforts: a lead, three developers, a helper under each, a reviewer under the first helper; twelve agents alone); 52 on bb threads, 8 on tmux |
| asking (needs you) | 11, one of them a lead whose own developer asks too; four of their questions are four lines long |
| failed, lost, outside OATS | 3 failed at their start; 7 whose session was lost (3 on bb, 4 on tmux); 2 running outside OATS |
| souls | 24, most with long names; ONE of them (`oats-developer`) with fifteen capabilities AND twelve of the sixty agents (three that ask, one lost, one outside OATS, one on tmux, one that failed at its start); no other soul has more than three |
| capabilities | 30, with names of up to sixty characters; four of them fill ONE core place (knowledge) |
| automations | 37 (25 schedules, 12 triggers); 5 failing by the Automations page's rule (a launch that failed, two definitions that cannot run, a wrong account, no trust) and one more whose launch state is unknown (a warning there); 4 schedules hold 50 runs each, and on the first the three runs after its newest are of three of the set's agents (one that asks, one that is stopped, one that works); the first schedule's instruction is the recorded one twelve times, numbered; five names are sixty characters long, two of them alike but for their end; every trigger has its recorded state |
| teams, machines | 7 and 5 |
| a busy chat | ONE agent on bb (`chat.json` names it) with a long conversation (ten turns: paragraphs, lists, a code block); a full board, its texts AT the kernel's own bounds and never past them: twelve facts (a value of 80 characters that wraps and one with no space, a unit of 16, one link on a host of a hundred characters), nine open questions (one of four lines, one of 200 characters on one line, three with four options of up to 60); and a full page of mail: fifty messages received, from minutes to more than a year old, subjects short and long, senders with long names, every third the recorded long report, and an older page to read |
| names | up to 61 characters (the kernel's own limit is 63); two efforts' names read alike once they are cut |

## Where it comes from: the recorded answers, multiplied

`generate.mjs` (plain node: no dependency, no clock, no random) READS the answers the other
fixtures hold and WRITES these files. **Every busy row is one recorded row; only its names, ids,
times and relations are varied, and a count that follows the rows. Nothing else.** Exactly:

| file | the answer it multiplies | what alone is varied in a row |
|---|---|---|
| `status.json` | `../roster/status.json` (its rows that ask, work, are idle, stopped, on tmux), `../outside/status-outside.json` (running outside OATS), `../outside/status-failed-at-start.json` (failed at its start), `../panel/status-board.json` (the agent with a board), `../outside/status-archived-while-running.json` (a session lost on bb), `../lifecycle/tmux-row-lost.json` (a session lost on tmux) | the instance's name wherever the row writes it (`instance`, `home`, the identity's alias, the tmux window); its soul (`agent`, the soul's directory in `home`); its bb thread's id (a slot, `thr_busy_NN`, which the live stage fills with the run's own thread); `parentInstance`; a claim's `since` and `message`. On the busy chat's agent `board` is the recorded board multiplied: each fact a recorded fact (its `key`, `label`, `value`, `at` varied, and its `link` and its `unit` where the recorded fact has one), each question the recorded question (its `id`, `question`, `since` varied; on three, its `options`: four texts), and its claim says the oldest question, as the kernel's does; and its `createdAt` is a day before its oldest mail |
| `souls.json` | `../workspace/souls.json` | the soul's name wherever the row writes it; `description`; on ONE soul (`oats-developer`) `capabilities` is its five recorded rows and two more of each, every one a recorded row of that soul under a busy capability's name |
| `capabilities.json` | `../workspace/capabilities.json` | the recorded twelve as they are, then eighteen recorded rows under longer names (the capability's name wherever the row writes it): two more of each capability the fullest soul has, three more of the one that fills the knowledge place, one more of five others |
| `schedule-list.json` | `../automations/schedule-list.json` | the schedule's name wherever the row writes it (five names are sixty characters long, two of them alike but for their last character); `description`; on four of them `recentRuns` is the recorded run fifty times: the NEWEST is the recorded run (the row's `lastRun` is of it), each older one has its own `runId` and is an hour before the one after it (`scheduledFor`, `startedAt`), and `history.stored` follows. `cron` and `nextRun` are the recorded ones. On the FIRST of them the three runs after the newest name three of the set's agents, by a swap of the recorded run's agent wherever the run names it (its `instance`, its `home`); the newest stays the recorded run. The first schedule's `task` is the recorded task twelve times, numbered |
| `trigger-list.json` | `../automations/trigger-list.json` | the trigger's name wherever the row writes it; `description` |
| `trigger-status.json` | `../automations/trigger-status.json` (the answer for all triggers) | one state per busy trigger: the recorded state of its recorded trigger, with the trigger's name wherever the state writes it (its `id`, the keys of what waits and what fired, the agents a fire made) |
| `mail.json` | the DOCUMENT is `../mail/mail-first-page.json`, the WHOLE answer with its envelope: the recorded first page of a mail read, which says there is more and carries the cursor that reads it (the Mail tab offers "Older"); its MESSAGES are the recorded received messages of `../mail/mail.json`. (The busy chat's agent's mail; the set holds one agent's, so the stage answers it for every agent, and the same page for every read) | the agent it is of (its name and its soul's directory, wherever the answer writes them: the target, the alias of its identity, each message's `to`); `messages` is the recorded received messages fifty times, each with its own `id`, `conversationId`, `subject` and `threadTitle`, a `createdAt` that is the newest's less its age (each about a third older than the one before: the fifty span minutes to more than a year), a made-up `body` on the short ones (the long report's body stays as the messaging layer cut it), and, two of every three, a SENDER that is one of the set's long-named agents (`from.alias` and the address); `conversations` follows. `documents`, the messaging layer's own rendering, is the recorded one: the plugin does not read it |
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
fact's and a question's are the recorded time or minutes after it; a message's is the recorded
newest's, less its age (never after the recorded one, never before its agent was made: the busy
chat's agent is made a day before its oldest mail). Where a recorded row says a relation (the
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
