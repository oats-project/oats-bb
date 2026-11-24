# bb-plugin-oats

The OATS plugin for bb, in `plugin/` of the `oats-bb` repository.

Your OATS agents in bb: who each one is (soul, instance, aweb alias, parent, children), which ones
need you, and the workspace they come from (souls, capabilities, teams, machines). From bb you can
spawn, stop, start, restart and retire an agent. An agent spawned from bb runs in **bb's full
mode, with no sandbox** between the agent and the account bb runs as: the plugin asks for it on
every spawn ([How it is built](#how-it-is-built), "Spawn runs in bb's full mode"). The plugin draws and asks; it owns nothing: every
OATS fact it shows is an answer of the `oats` CLI's `--json` verbs, every bb fact comes from bb's
SDK, and everything it does goes through `oats`. It never reads `instance.json`, receipts, event
files' contents or bb's database, and it never infers whether an agent runs.

Tested on bb-app 0.50.1 (plugin SDK 0.6.157); `engines` in `package.json` names the range. POSIX
only (Linux, macOS): the host entry runs `oats` in its own process group. bb, its npm packages and
this plugin's dependencies are installed and run only in containers (see [Developing](#developing)).

## Install

```sh
# from the repository, at a tag, a branch or a commit; bb asks once, then builds it and loads it
# (add --yes where nobody can answer); the plugin id is "oats"
bb plugin install git:https://github.com/oats-project/oats-bb.git@<ref> --subdirectory plugin
# or from a checkout whose dependencies are installed (`npm ci` in plugin/, in a container: see
# Developing); a path install builds from what is there and installs nothing itself
bb plugin install <path to the checkout>/plugin --yes
bb plugin list                                       # oats … running
```

`@get-bb/plugin-sdk` is under `dependencies`, not `devDependencies`: the app imports `contract/`
(the watched reads need the contract as a value), bb's frontend build bundles the SDK's root from
the plugin's own install, and a git install omits dev dependencies. The live tests install by
`git:` to keep that true.

The plugin needs, on the bb machine that holds the OATS homes: an OATS deployment (a directory
with `oats-local.yaml`), `oats` on the PATH of that machine's login shell, and an OATS kernel whose
`oats spawn` takes `--backend bb` (the bb session provider). On a kernel without it, the tree is
empty and Spawn shows the kernel's refusal (`E_BAD_ARGS: --backend must be tmux`).

## Settings

`bb plugin config oats set <key> <value>`, or Settings, Installed plugins, OATS.

| Key | Default | Meaning |
|---|---|---|
| `deployment` | `""` | The deployment directory. Empty: the plugin walks up from each bb project's root on the machine to the first directory that holds `oats-local.yaml`. |
| `oatsBin` | `""` | An absolute path to `oats`. Empty: `oats` on the PATH of the machine's login shell. |
| `host` | `""` | The bb machine (its name or id) that holds the homes. Empty: the server's only machine. |
| `pages` | `"home"` | The plugin's pages that are shown, by id (empty: the default), with commas or spaces between them: `home`, `automations`, `souls`, `capabilities`, `teams`, `machines`. A page that is not shown has no link in the sidebar, no mark there, no link to it from the thread's row, and its path answers "This page is not shown in this release of the OATS plugin." with the way back. The default shows the home alone: the other pages are built and tested, and left out until they are finished. The pattern book (`/plugins/oats/patterns`) is no page of this list: no link leads to it, and its path answers under every value, for the checks that draw it. Changing `pages` reads nothing again: the roster stays as it is. The home's own route answers under every value. |

When something is missing, bb stays fully usable. Every place of the plugin shows one notice: what
is missing in a person's words (its title), Retry, and Open settings where a setting mends it;
what to do in a sentence, the code and the plugin's or the kernel's own message are under its
Details. Where OATS was read before, the
roster stays as last read under that notice, which says its age once ("Read <age>."), and the
OATS acts are HELD until OATS is read again, as on the Desktop: Stop, Start, Restart, Retire and
New agent stay in their place, drawn off, the notice says "Acts are off." with its Retry, and the
plugin's server takes no act meanwhile. Beside a page
that shows that notice the sidebar says one line, "Read <age>.", with Retry. What a place still
shows of an agent (its soul, its events, its readiness) can still be read. Where it never was,
bb's threads are listed as usual under the notice. The notice's code:

| Code | When |
|---|---|
| `NO_DEPLOYMENT` | no bb project of the machine is inside a deployment, or the `deployment` setting holds no `oats-local.yaml` |
| `OATS_NOT_FOUND` | `oats` is not on the machine's PATH, or `oatsBin` names no program |
| `CHOOSE_HOST` | the bb server has several machines and `host` is empty |
| `HOST_NOT_FOUND`, `NO_HOST`, `HOST_UNREACHABLE` | the machine set is not one of the server's, the server has none, or its daemon did not answer |
| `OATS_TIMEOUT`, `OATS_NOT_JSON`, `OATS_BAD_ANSWER`, `OATS_FAILED` | `oats status` took more than 20 s, printed something that is not JSON, answered a document the plugin cannot read, or failed with no answer |
| `E_…` | the kernel's own refusal, with its message (drawn through the display filter: "Text from OATS or an agent") |

An act's refusal has the same codes, and two of its own: `RETIRE_INCOMPLETE` (the retire ran, its
cleanup is incomplete, the kernel kept the home and its lines say what is left) and
`NO_THREAD_NAMED` (a spawn or a start went through and the kernel names no bb thread for the agent).

## The sidebar's thread list

The plugin registers a thread list and leaves bb's choice of the list on automatic: it does not pin
itself, because a pin outlives the plugin (after a disable or a removal the sidebar would show "No
thread list plugin is enabled" until someone resets it). On automatic, bb takes the first installed
thread list plugin by plugin id, so another one whose id sorts before `oats` takes the sidebar. To
choose this one, or to go back:

```sh
bb settings ui set sidebar.threadListProvider oats/agents
bb settings ui reset sidebar.threadListProvider
```

**The order of the rows** is ONE for every agent, whatever its backend (`model/view.ts`, `RANK`
and `view().rows`; its table is `test/model/order.test.ts`). Three ranks: an agent that needs you;
then one a person must look at (it runs outside OATS, or it failed); then everything else together
(working, idle, stopped, unreachable). A row is placed by the most urgent rank anywhere in its own
subtree, so a parent rises with a child that waits; children the same way under their parent; and
within a rank by the kernel's own order of the agents. An agent with no bb thread (on tmux, or
whose thread bb does not list) is a root in that same order, not a block after the tree. The order
never follows a thread's latest activity and never puts Working above Idle: no row moves while a
person reads it, unless an agent starts to need them (it rises) or is answered (it falls back to
its kernel place). The sidebar has no line that counts who waits: those rows are first and
marked, and bb's badge on the plugin's entry says how many.

**Children are collapsed by default** (`model/view.ts` `treeRows`, `insideOf`, `ancestorsOf`, whose
table is `test/model/fold.test.ts`; `app/roster/fold.tsx`). A parent has ONE chevron before its
mark, with no count: a button of its own, not part of the row's link, that says whose agents it
shows or hides ("Show Redesign ui lead's agents", "Hide …") and whether they are shown
(`aria-expanded`). Right on a parent's row opens it and Left closes it. Every parent is closed when
the page loads, and stays as the person left it while the window lives: the open set is the
window's memory (it outlives bb's drawer, which draws the sidebar anew), and nothing of it is
stored. A closed parent's children are not in the page, so nothing of them takes the focus. A
closed parent keeps its own state, mark and word, and carries after its own word, named for a
screen reader, the mark of any row its subtree hides that itself carries one: a row that needs a
person, one a person must look at (it runs outside OATS, or failed), and one whose own mark is in
the warning tone (archived in bb while it ran), in that tone. Of several, the most urgent. The parents of the thread that is on screen are open and are never closed over it: while a parent
holds that row its chevron is drawn open and off (disabled, out of the tab order, named
"<Name>'s agents shown"), and is live again once another row is on screen.
A roster with a parent in it keeps a gutter before every row, so every mark stands in one column.

## Stopping, starting, restarting and retiring an agent

The four acts are OATS's own, each through the kernel, and each opens a dialog first: nothing runs
on one press. They are in an agent's thread menu (**Stop (OATS)**, **Start (OATS)**, **Restart (OATS)**, **Retire (OATS)**, under a row that
names the agent: the menu holds bb's own Stop beside them, hence the suffix), on the thread's status line, the OATS line under the thread's header (**Stop…** for an
agent that works or is idle, **Start…** for one that does not run, **Restart…** for one whose session
ended; and **Answer**, which is no act of OATS's: it opens the instance panel at what the agent
waits for), on a soul's page for an agent whose thread bb does not have (**Start**,
**Retire**), and in bb's command palette, each with a shortcut:

| Command | Default shortcut | Acts on |
|---|---|---|
| OATS: Stop agent… | Alt+Shift+X | the agent whose thread is in view |
| OATS: Restart agent… | Alt+Shift+R | the same |
| OATS: Start agent… | Alt+Shift+S | the same |
| OATS: Retire agent… | Alt+Shift+D | the same |

The letters are the OATS Desktop's (after its leader key); the chord is bb's, and every one is
rebound in bb's Settings, Keyboard. A key that cannot act says why in one line, through bb's
toaster ("Weekly digest helper is stopped: Start it instead.", "This thread is not an OATS
agent's."). Start is for an agent that does not run: one that is stopped or failed, and one
that is idle with NO HARNESS LOADED ("Idle · not loaded": the kernel's `running: false` beside a
session that is there), whose key and menu entry open Start and never say "is already running";
its dialog says that it begins a new conversation. bb does not run a plugin command's shortcut
while its Terminal tab has the focus.

- **Every dialog** says ONE consequence line before the act, under no heading, and holds ONE
  **Details** (Joan's direction of 23 Nov 2026, by the text audit ruled on it): Stop "Archives its
  thread."; Retire "This cannot be undone."; Start "Starts a new conversation." (an agent on tmux
  whose session was lost: "Tries to continue its last conversation; else starts fresh."); Restart
  "Stops what it is doing now.". Where others are stopped too, "Also stops: <names>." is the
  second and last line.
- **Stop** and **Retire** read the kernel's plan, for the agent the PLAN names (never the row that
  was pressed). In view: the consequence line, and the facts that are a reason not to confirm, set
  apart, only when true. For a stop those are said from facts, never from the plan's `midTask`
  (reported activity: true for every session that runs, an idle one too): "<Name> has uncommitted
  work." (the plan's own observation of its work tree) and, for an agent on bb, "<Name> is
  mid-turn." (bb's word on its thread); an agent whose session runs with neither gets no line.
  Under Details: what is kept and deleted ("Nothing is deleted."; "Deletes its home.", "Keeps its
  worktree, moved aside, on branch <b>."), who is left out, and the state of each session and of
  its uncommitted work. Stop has the switch **Include child instances** (on: the kernel's default;
  off reads the plan again for the agent alone). Retire has **Also delete the worktree** for an
  agent with a worktree of its own: while it is on, what would be lost is said at the tick, under its
  label ("Deletes 2 uncommitted changes too (a copy is saved)."), once; without it the worktree is
  kept, moved aside. Both dialogs open with the focus on Cancel. Stop's line is what the stop
  means for the agent's thread: on a provider below oats-bb 0.4.0, which leaves the thread open,
  it is the warning "A message in its thread starts it outside OATS.". Where a retire kept the
  home (its cleanup did not finish), the result says first that a message in its thread would
  start it outside OATS.
- **Start** and **Restart** first read the agent as the kernel has it now ("Checking…"). Its
  harness, machine and home are under Details, with what mode it runs in on bb: "Runs in bb's full
  mode: no sandbox." (neither act names a mode: the home's recorded choice stands). **Harness**
  starts on "Keep the recorded harness" and passes nothing; one the bb session provider declares
  is passed as `--harness`. With one harness declared there is no choice. **Model** is blank for
  the recorded or default model, or a model id ("Saved for later starts too."). A start that can
  run says nothing more; an agent the kernel says is running is not started again: Start is off,
  the dialog says why and offers its thread and **Refresh status**.
- **While the act runs** the dialog says so in a word ("Stopping…"), with Close in Cancel's
  place. **Its result** is said in the same dialog: its title ("3 sessions stopped."), the facts a
  person needs later ("Worktree kept, at:" and
  the path on its own line); a start opens the agent's new thread behind it. When the dialog is
  gone by then (the person closed it, or opened another act's), the result reaches them through
  bb's toaster. A stop, a start or a restart that is done is told whole, with **Open <agent>**,
  and leaves by itself. Anything else (a refusal, a result that is not confirmed, a retire,
  whose result holds where the worktree and the recovery copy are) is told by its title, with
  what the dialog sets first (a home that was kept); that toast stays until dismissed and has
  **Show result**, which opens the dialog again on that result, with its Details, its paths and
  its next step ("Check again" asks for the same apply: the plan and its key are kept).
- **A refusal** is a person's words; the kernel's own message and its code are under the
  result's **Details**. What to do next is a button: **Review again** reads a new plan (also
  when the plan changed under the confirmation: it comes back as it is now, with what changed
  said first, and cannot be confirmed until it was reviewed again), **Check again** asks
  for the answer to what was already sent (same revision, same key: an answer that was lost reads
  "Result not confirmed", never "nothing happened"), **Refresh status** reads the agent again
  before another start. A plan refused for a name the kernel does not know (`E_SESSION_UNKNOWN`,
  on a stop or a retire plan and nowhere else) says that the agent is not in OATS any more.
- **On a roster that is the last one read** (OATS cannot be read) the acts stay where they are,
  off; the notice on the same screen says "Acts are off.", with Retry.

bb's own composer Stop, Archive and Delete cannot be hidden by a plugin, and the plugin never acts
on its own when one of them is used: an agent whose thread was archived or deleted in bb stays in
the roster, as a row that says which of the two happened and what to do
([Outside OATS](#outside-oats)), and its soul's page says "thread missing", with Start and Retire. Nothing is retired because a thread was
deleted. A thread stopped in bb alone is not stopped for OATS: stop an agent with the OATS act, so
that it stays stopped.

How it is built: `kernel/lifecycle.ts` reads a plan and a receipt into typed facts (nothing is
worded there), `app/lifecycle/words.ts` makes the sentences from them (the Desktop's, with the
commit they were copied at in its header), `app/lifecycle/acts.tsx` draws the two dialogs on the
`Confirm` pattern, and `app/lifecycle/index.tsx` registers the ways in. Another feature opens a
dialog with `openAct(verb, instance)`, and can place the acts of one agent as buttons ("Stop…",
"Start…", "Restart…", "Retire…": the ones that apply, for an agent with no bb thread too) with
`<AgentActs instance={…} />` (`app/lifecycle/index.tsx`). The instance panel places it in its
header, under the agent's state: on the thread's OATS tab and on the agent's own page
(`app/panel/Panel.tsx`). The outside feature draws it on the archived thread's own row of an agent
the roster draws on no thread ([Outside OATS](#outside-oats)).

## Outside OATS

bb's own acts reach an OATS agent without OATS: a message typed in bb's composer starts an agent
OATS stopped, bb's Archive takes a running agent's thread away and leaves its process running, and
bb's Delete ends it. The plugin cannot hide those acts. It says what happened, on the sidebar's
row, on the thread's own line and on the agent's own page, with the one act that mends it.

**The state's word comes first, and it is one of the set**: Needs you, Working, Idle, Stopped,
Failed, Unreachable, and one more, **Running outside OATS**. After it comes the REASON: two or
three words, on the thread's line and on the sidebar's row (a row is never three lines). A row's line is STATE · SOUL ·
REASON · glyph (`app/ui/row-facts.tsx`): when it is short of room the reason shortens with "…", then
leaves the row (it stays whole in the line's title, on the thread's line and on the agent's page),
and only then the soul shortens; a reason in the warning tone stays, and the soul gives way first.
The state's word and the glyph never shrink. The fit is measured by the line itself, so it holds at
every depth of the tree. ONE reason is said in the state's place on a row: a stopped agent whose
session was lost reads **Lost** (the kernel's own word), with no reason after it ("Lost ·
oats-maintainer · glyph"; app/outside `rowWords`): at bb's sidebar width "session lost" had to leave
every such row. Its state is untouched (it is stopped: its mark, Start, its place), and the row's
title, the thread's line and the agent's page keep "Stopped · session lost". A lost session whose
thread bb archived or deleted reads "Stopped" and that reason, in the warning tone. A sentence stands in the reason's place only where a person would otherwise do harm, and
never names the remedy: that is the button beside it. No line says a time: when OATS stopped an
agent is a fact of the instance panel's Session. "Archived in bb" and "deleted in bb" are reasons,
never states.

| What OATS says | What bb says of its thread | The thread's line | The sidebar's row | Acts |
|---|---|---|---|---|
| stopped by an operator, or stopped with no word how its session ended (`sessionEnd` "stopped" or none) | open: bb's composer is live under it | "Stopped · A message here starts it outside OATS.", in the warning tone. The interim warning, for as long as a stop leaves the thread open; afterwards for a home stopped before the provider archived at stop, and a thread a person unarchived. | "Stopped" | Start |
| its session lost (`sessionEnd: "lost"`: it ended without OATS stopping it) | open | "Stopped · session lost": the reason alone. No warning, no time (the kernel records none of the loss), no cause guessed, nothing promised, and no sentence: what to do is said where it is done (the Start dialog says first to message it instead). | "Stopped · session lost" | Start… (its dialog says first to message it instead: the lifecycle's) |
| its session lost, on TMUX (no thread in bb) | none | on its page, under the header's "Stopped": "session lost", and no sentence (the Start dialog's one line says that Start tries to continue its last conversation, else starts fresh) | "Stopped · session lost", then bb's terminal glyph, named "tmux" | the header's (the lifecycle's) |
| idle, no harness loaded (`running: false` beside `runtimeState: "unknown"`) | open | "Idle · not loaded". Never "Stopped", and no warning: a message carries the conversation on and OATS reads it running at its next read; Start would begin a new thread, and its dialog says so first. | "Idle · not loaded" | Start (its dialog says first to send a message instead: the lifecycle's) |
| stopped, its session not lost | archived | "Stopped · archived in bb" (the Start dialog's one line says that Start begins a new conversation). The row opens the archived thread, which bb shows to read (no composer). | "Stopped", in the plain tone (once the provider archives at stop, this is every stopped agent) | Start…, Retire… |
| its session lost (`sessionEnd: "lost"`) | archived | "Stopped · Archived in bb while running: it may still run.", in the warning tone | "Stopped · archived in bb", its mark in the warning tone | Stop, Retire (Start once it is stopped) |
| still says it runs (not stopped, failed or unreachable, and not `running: false`) | archived | "<its state> · Archived in bb while running: it may still run.", in the warning tone, on the archived thread's own row: a person archived the conversation of an agent whose process goes on | "<its state> · archived in bb" (for example "Idle · archived in bb"), its mark in the warning tone | Stop, Retire |
| stopped, or its session lost | deleted | "Stopped · deleted in bb" on the state's line of the agent's own page's header (it has no thread): the reason in the warning tone, on the line as on the row, never alone under the tabs | "Stopped · deleted in bb", its mark in the warning tone | Start…, Retire… |
| recorded stopped, with the kernel's `outsideOats` | any | "Running outside OATS · recorded stopped", in the warning tone, with **Stop…** and **Start…** as the line's own acts (Stop… alone for an agent that is not on bb); under the line no box and no title: one fold, **Details**, with what happened in a person's words ("Someone sent it a message in bb. Stop it, or start it from OATS so that OATS tracks it again."), then the kernel's own code and sentence. The same drawing on the home's card; on the instance panel the acts are the header's. | "Running outside OATS" | Stop…, Start… |
| failed (its session ended) | open | "Failed · session ended". No warning: status sees a message that starts it. | "Failed" | Restart |
| unreachable | any | "Unreachable" (the kernel's own message under Details); nothing about a message | "Unreachable" | Retry |

What it reads, and nothing else (nothing is derived from words): the agent's status row, as the
snapshot's `Agent` holds it (`running`, `runtimeState`, `session.threadId`, and two fields this
feature added: `sessionEnd` and `outsideOats`), and bb's own answer for the row's thread id
(`Oats.whereOf(agent)`: open, archived, missing, none, or unknown until bb has answered). bb's
sidebar lists its active threads only, so an archived thread and a deleted one look the same
there: the plugin asks bb by id for the archived ones (`threads.list`: one request for all the
rows that need it, whatever number of places are drawn, none when bb lists every agent's thread;
asked again at each roster read and each minute), and a thread bb has neither active nor archived
is deleted. Archived is told from deleted by bb's answer, never by the kernel's message. Until bb
has answered, a row claims nothing of its thread.

**The one state function** (`state(agent, thread)`, `model/view.ts`) changed in two ways, and
every place reads it (the sidebar's row, the thread's line, the instance panel's header, the count
of who needs a person):
- **"Running outside OATS"** is a state of its own, before every other: a row with the kernel's
  `outsideOats`. The row's other fields stay what OATS recorded (stopped, not running) and would
  say "Stopped" of an agent that runs: there is ONE statement about it. Such an agent is counted
  among those that need a person (`view().needing`: bb's badge on the plugin's entry, and the home's heading), since only a
  person can stop or start it again. What OATS recorded is a fact after the state.
- **Stopped is said of a row only when the kernel calls it stopped** (`recordedStopped`, for
  every backend; the claim's gate reads the same predicate): the row does not run, and says that
  an operator stopped it or that its session was lost (`sessionEnd`, beside any word: a tmux agent
  stopped with OATS reads "shell"), or says nothing of how it ended beside the word "stopped" or
  no word at all. A harness that ended by itself (`sessionEnd: "exited"`) failed. A row that is
  not running beside `runtimeState: "unknown"` has its session there and no harness loaded (a
  reboot on a host that does not run `oats host run`, or bb let the harness exit): it is idle, and
  keeps a question it asked. A session the kernel cannot reach is never called stopped. That
  not-loaded row is recorded live (`test/fixtures/outside/status-not-loaded.json`: the real run
  ends the thread's harness process and reads the row), on the provider that scans its harness
  (oats-bb #40); with a provider before it an idle bb thread reads `running: null` and says "Idle"
  with nothing after it.

**Three rows read "not running", and they are never drawn alike**: an operator's stop (Start, and
never a message), a session that was lost (nobody stopped it: a message carries it on), and no
harness loaded (a message; Start begins a new conversation). The state word tells the third from the first two;
the tone tells the first from the others (the line's `tone="warning"`: the state's mark and the
sentence, `data-tone="warning"`); and the rows' words differ. One live scene draws the three side
by side and asserts the word and the tone, not only the text. The tone never carries the meaning
alone: the sentence does.

**One reading of a row that does not run** (`model/rest.ts`: `rest`, `messageResumes`; and
`recordedStopped`, `model/view.ts`), which the state, the claim's gate, this feature's reasons,
the home's card and the Start dialog all read. Where the row says how its session ended
(`sessionEnd`), that decides, for every backend: "stopped" is an operator's stop and "lost" a
lost session, both Stopped beside any word (a tmux agent stopped with OATS reads "shell": the
stop leaves its window at a shell); "exited" is a harness that ended by itself: Failed. Where it
does not say: the word "stopped", or no word at all, is a stop. THE RULE for a message: it is
refused only for a stop (an operator's, or one that does not say that its session was lost: a
message in bb would start a harness OATS does not expect) and where nobody can tell (the kernel
cannot reach its session); everything else that does not run, on bb, with a thread bb lists,
carries on by a message (the kernel's contract for a provider home, `docs/desktop-cli-api.md` at
v0.70.5: a session that a message started reads running at the next status, and `outsideOats` is
reported only against a recorded stop). So **the warning fails closed**: a stopped agent on an
open thread gets the operator's sentence unless its row says "lost" or "exited", and the home's
card of such an agent offers no answer and no reply, and Start. `test/outside/table.test.ts`
prints the table of every row. The spec's author's rulings of 23 Nov 2026.

`outsideOats` is read by the roster's parser (`kernel/roster.ts`, with `kernel/outside.ts`) only
where the status document's own `features` lists `provider-outside-oats` (OATS 0.70.5; `features`
on `oats status --json` is the kernel's own list, as `oats version --json` answers it), only in
the kernel's exact shape (`code: "running-outside-oats"`, `backend`, a one-line `message`), and
only on a row OATS recorded stopped. On an OATS without the feature nothing is said of it: its
absence there says nothing.

**The acts are the lifecycle's own**, never a second path to `oats`: every button of this feature
opens that act's dialog (`openAct`, `app/lifecycle`), which asks the kernel first; nothing runs on
one press. The thread's menu offers Stop for an agent that runs outside OATS too. An agent the
roster draws on no thread has none of the menu's entries, so its row leads to its acts: to the
ARCHIVED thread, whose own row (`OutsideThreadRow`) has them; or, for a thread that is deleted, to
the agent's own page, whose header has them (the panel's `AgentActs`) under its state's line, which
says what happened after the state's word, as the row does ("Stopped · session lost"; `pageParts`).
The kernel's report, and the one act the header lacks, stand first on the Instance tab
(`OutsideAgent`; the header over the tabs does not scroll, so that block is on the page). They are the lifecycle's buttons for the agent's state
(`AgentActs`: Start… and Retire… for a stopped agent), but where a process runs, or may, with no
thread a person can see: a session lost to bb's Archive and an agent archived while it ran have
Stop and Retire on the archived thread's row (Start comes once it is stopped), and the kernel's
report has its Stop and Start in its notice, each with what it does there. On the agent's page
no act is drawn twice, act by act: one the header has is the header's, and the notice there says
what it does; one the header lacks keeps its own button in the notice (while no roster is read
the header has none, and the notice has both: "Stop" and "Start" are never named with nothing to
press). For an agent whose session provider is not bb the lifecycle has no Start, and the notice
names none: Stop alone, and its sentence does not say to start it. And this feature adds one act the header never offers: Stop for a session OATS lost,
which reads stopped.

The words are in `app/outside/words.ts`, with the fact each rests on in `WORDS.md`. Beside the
state, the feature is one pure function (`said`, `app/outside/say.ts`: an agent, bb's answer and
whether the tree draws it on its thread in; the reason, its tone, the row's words, its acts and
the kernel's report out), `outsideOf(oats)` that gives it its inputs from the caller's own roster,
and its drawings (`OutsideWarning`: the notice; `OutsideThreadRow`: the thread's own row on a
thread bb has archived; `OutsideAgent`: the block on the agent's page; `lineParts` and `lineActs`:
what a status line says and offers; `rowParts`: what a sidebar's row says after its state, only
where the reason follows that state). It registers no slot and has no read and no `oats` verb of
its own: the roster's row and line (`app/roster/Sidebar.tsx`, `IdentityRow.tsx`) and the instance
panel (`app/panel/Panel.tsx`) call it. Whether the provider archives a stopped home's thread
(`stopArchivesThread`, the lifecycle dialogs') changes no word here (an open thread under a
stopped agent gets the same sentence before and after): `say.ts` marks the place and says why.

On the home, an agent that runs outside OATS is one of those that need you: its card
(`OutsideCard`, `app/home/Home.tsx`) holds this feature's notice with its Stop and Start, and no
choice and no reply, and the badge, the heading and the count line's "N need you" (Home › Agents) count it as the
sidebar's foot does (`view.needing`).

Not there yet: the line of a thread that belonged to a RETIRED agent.
The rows are recorded live and proven against the real run's kernel (0.70.5, the provider at
oats-bb #40): `container/real/parts/outside.mjs` makes each state, keeps the kernel's row
(`test/fixtures/outside/README.md`) and checks what the plugin says and that its Stop mends it.

### A provider home's row, case by case

One table for the two sides that must agree on it: the bb session provider, which answers
`running` and the state of a home's thread (`inspectAnswer`,
`oats-package/capabilities/oats-bb/lib/threads.mjs`, from bb's status of the thread and from the
harness process it finds in the home), and the plugin, which says the state from the kernel's row
and from bb's own word on the thread (`state` and `threadWorks`, `model/view.ts`). `running` is
endpoint activity: true while a harness is loaded, an idle agent's too; it never says that an
agent works. Each row below that names a recording is the kernel's row as printed: the five
of `outside/` on that provider (OATS 0.70.5, the provider at oats-bb #40), the two of
`roster/status-recorded.json` on the earlier recording (OATS 0.70.0, the provider before #40:
those two rows read the same on both). A test reads every recorded row against this table (`test/model/cases.test.ts`): the row's four fields, and the state the plugin says of
it with the thread as the column gives it. That test holds the plugin's side alone: the
provider's `inspectAnswer` is named here, not checked: no test of the plugin calls it (the
provider's own tests hold its side). A dash is a field the row does not carry, or carries as null.

| Case | `running` | `runtimeState` | `sessionEnd` | `outsideOats` | bb's thread | The plugin says | Recorded as |
|---|---|---|---|---|---|---|---|
| in a turn | true | unknown | - | - | in a turn | Working | `roster/status-recorded.json#working` |
| a turn bb holds in line (a message waits to start: `queuedWork: "waiting"`) | true | unknown | - | - | at rest, a turn in line | Working | (no recording here: the real run's B1b makes it and shows the kernel's row) |
| at rest, its harness loaded | true | unknown | - | - | at rest | Idle | `outside/status-at-rest.json` |
| at rest, with a word for its queue the provider does not know | - | unknown | - | - | at rest | Idle | (no recording: bb 0.50.1 has no such word) |
| at rest, no harness loaded (its process ended; a reboot without `oats host run`) | false | unknown | - | - | at rest | Idle | `outside/status-not-loaded.json` |
| stopped with OATS; the provider archived its thread | false | stopped | stopped | - | archived | Stopped | `outside/status-stopped-archived.json` |
| stopped with OATS, then started again by a message in bb | false | stopped | stopped | running-outside-oats | in a turn | Running outside OATS | `outside/status-outside.json` |
| its thread archived in bb while it ran | false | stopped | lost | - | archived | Stopped | `outside/status-archived-while-running.json` |
| its thread deleted in bb | false | stopped | lost | - | deleted | Stopped | `roster/status-recorded.json#threadDeleted` |
| stopped with the machine (`oats host run`'s shutdown) | false | stopped | lost | - | at rest | Stopped | (no recording: the run stops no host) |
| its session ended in a shell | false | shell | - | - | at rest | Failed | (no recording) |
| the kernel cannot reach its session | - | unreachable | - | - | any | Unreachable | (no recording) |

What comes after the state's word (the reason, the tone, the acts) is the table at the head of
this section; this one holds only what the two functions must agree on. An agent on tmux is not
in it: its row has no `runtimeState` while it runs, and the kernel's `running` is its own word
for whether it works.

## The home

The OATS home (the Bot entry in bb's navigation, with a count when agents need you, the page
`/plugins/oats/home`; on desktop the same view is the OATS tab of a thread that is no agent's) is
the OATS Desktop's Home: what needs you first, then what you have.

| Part | What it shows |
|---|---|
| **Needs you** | one card per agent that waits on you: those you can answer here (they have a thread in bb) first, then those answered elsewhere; within each, the newest claim first. Eight, then **Show all N**. A card says who (the instance's name as words; under it, on one line, its soul, the reason for an agent with no thread in bb ("deleted in bb", "session lost"), and for one on tmux bb's terminal glyph named "tmux"), its state on the shared status line with how long it has waited ("4 d"), what it asks in the agent's own words, and offers the answer its request takes (below). **Open** and the name lead to the agent's thread (to its own page, for an agent with none). With none: "Nothing needs you." |
| the tiles | **Agents** (Home › Agents) and the plugin's pages, each with its count; "Counting…" while a page is read, "Couldn't count" when that failed (the tile still leads to its page, which says why). A page's tile carries the mark its row in the sidebar carries (Automations, while a run failed), read only while the home is seen |
| **Working** | the agents at work, five, then **Show all N** / **Show fewer**; each row is the agent's name (the heading says the state) and opens its agent |
| **Unread** | idle agents whose thread holds something you have not read; not drawn with none |
| **Home › Agents** | `/plugins/oats/home/agents`, reached by that address alone (nothing on the home, the page or the tab, leads to it: the home has no tile for the agents, and the sidebar lists every one), headed **Agents N**: **every** agent OATS has in the sidebar's order, the stopped ones, the failed ones, the ones the kernel cannot reach, the ones on tmux and the ones whose bb thread is gone among them, each with its state in words and, beside its name on one line, its soul, the reason where it has no thread (what became of it: "deleted in bb", "archived in bb", …; "session lost"), and for one on tmux bb's terminal glyph named "tmux" (the row's one order; the reason gives way first); over them the home's one count line, "3 working · 3 need you · 1 idle · 1 stopped": every agent counted once, by the state every place says for it (`app/roster/status.ts`), so the numbers are the sidebar's (working and need you are always said; another state only when it has agents); and **‹ Home** (Esc does the same). Its machine and who started it are on an agent's own page |
| **New agent** | first on every home (the page, Home › Agents, and the tab), where New agent has somewhere to open; off behind the CLI card and while the roster shown is the last one read, with no reason beside it: the card, or the roster's notice, is on the same screen (the card is drawn on Home › Agents too) |
| an empty workspace | "No agents yet."; **New agent**, over it, is drawn as the one thing to press |

The page has no heading of its own (bb's bar over it names it) and no summary line: its headings
count who needs you and who works. It has no tile for the agents (the sidebar lists every one):
its tiles are the plugin's other pages, where the release shows any; with the default, none.

**The installed `oats`.** The home says where the installed `oats` stands against what the plugin
is built for (`kernel/compat.ts`: the oldest OATS it works with, the newest minor it was tested
with, the version of the kernel's JSON answers it reads), and only the home says it:

| The installed `oats` | The home shows |
|---|---|
| from the floor up to the tested minor | nothing |
| older than the floor, or its version cannot be read | a card, **Compatible oats CLI required**: what was detected, what is required, and the command to copy (`npm install -g @awebai/oats@<tested minor>`); the home's New agent is off behind it (the card is why) |
| its JSON answers are of a later version than the plugin reads (`desktopApi`) | a card, **This plugin is older than the installed oats CLI**, "Update the OATS plugin.", with no npm command |
| of a later minor than the plugin was tested with | nothing: no act is turned off, so there is nothing to say |
| it runs (the roster reads) and its version could not be read, also at the home's one more try | nothing; New agent stays on (the roster proves `oats` runs, and the kernel refuses a spawn it cannot make) |

Each card has **Check again**: it asks the server to read `oats version` anew (the server
keeps one answer for every feature), so after an install the card goes, and New agent comes back,
with no reload. A check whose answer is the same leaves the card as it is and can be pressed
again; one that fails says so on the card ("Check failed: …")
and keeps what was read before. The version is read by a call of the home's own (`app/home/cli.ts`),
not by a kept query, so that the home knows when a check ends.

It is one RPC, `homeCli`, which answers picked fields (`version`, `desktopApi`, `state`) from the
`oats version --json` the server reads once for every feature: no process of its own. An `oats`
that cannot be run at all is the roster's notice, not this one.

**The pages shown.** A tile leads to a page, so the home has a tile only for a page this release
shows (the plugin's setting `pages`; the default is `home` alone, and then the tiles are **Agents**
only), and reads a page's count only then. New agent is offered where it has somewhere to open
(the New agent form's page, once that feature names it; else the Souls page when it is shown).

**What a card offers.** An agent is answered by the answer its request takes, and the card offers
that one, not a free-text box beside it as an equal:

| The agent | The card offers |
|---|---|
| bb lists choices for its request (a confirmation, a selection, an approval, a question with options) | the choices, as buttons: pressing one answers it in place (`threads.interactions.respond` / `resolve`). The card then says "Answered: Allow." until the agent goes on and its card leaves, or it asks again (by a request of bb's, or by a new claim of its own) |
| bb shows its request in a form the card cannot draw (a plugin's form, free text) | the card's button reads **Answer** in the place of **Open** (the same press: it opens the thread); no sentence |
| the kernel says it waits for a tool approval (its claim's reason is `permission`) and bb lists **no** request for its thread: the claim is older than bb's request, bb's request was answered in the thread and the claim not yet cleared, or the approval is asked where bb has no interaction for it | **Answer** in the place of **Open**. The card cannot grant what bb does not list, and does not pretend to |
| it asks in its own words (a question, its attention) | the **reply**, on its card, named for it ("Write to Release 070 maintainer…"), sent as the person at the screen through bb's own send. The box grows with what is written, so all of what will be sent is in view. There is no reply apart from a card: a message cannot go to another agent than the one read |
| the kernel cannot reach its session, and it needs you all the same | no choices and no message: nobody can tell where either would go. The card says "Unreachable. Nothing is sent from here." (the word only where the card does not already draw it), with **Open** and no Start (the lifecycle offers none for it) |
| the kernel calls it STOPPED (an operator's stop, or a stop with no word that its session was lost), and it needs you all the same (bb still holds a request on its thread) | no choices and no message: either would go to its thread and start its harness again outside OATS (a stopped agent stays stopped). The card says "Not running. Start it to answer.", and offers **Start…** (the lifecycle's own act and dialog: it asks the kernel first, and starts the agent through OATS; where the kernel cannot say whether the agent runs, the dialog says so and starts nothing) beside **Open** |
| the kernel says it does not run and NOBODY STOPPED IT (its session was lost, it ended in a shell, or no harness is loaded), on a thread bb lists (one whose last turn bb calls failed included) | answered as any other agent: its choices, or the reply. A message in its thread is the provider's designed way back for such a session, and OATS reads it running at its next read; the Start dialog says the same first (`messageResumes`, `model/rest.ts`: one reading for the card, the dialog and the thread's line) |
| it has no thread in bb: it runs in tmux | "tmux" under its name, "Answer it in its terminal.", and **Open**, which leads to its own page: the kernel's own command (`oats session attach --home <its home>`) is there, to copy |
| it has no thread bb lists | what became of it under its name, as far as bb's answer goes, the reason alone: "deleted in bb", "archived in bb", "no bb thread" or "thread not shown in bb" (the sidebar's own words); no reply and no sentence; **Open**, whose accessible name says where it leads: the archived thread where bb has one (the press opens it, as the sidebar's row does), else the agent's own page |

Beside choices, or a request answered in the thread, a message is still possible, behind **Message
instead**, which first says what a message does not do: "A message does not answer its
request: it grants nothing, and the request stays open."

While OATS cannot be read the home keeps the roster as last read, under the one notice every place
shows for it (what happened, how old what is shown is, "Acts are off.", Retry), and every card's
choices and reply are **held** (drawn off, under that notice): what is shown may have changed, and
a message or an answer would go on a question that may no longer be the one asked. Open still opens.

The home has no read of the roster of its own: it draws the roster every place shares (`useOats`, called once per
view and passed down), groups it with one pure function (`app/home/board.ts`: every agent in the
sidebar's order, who needs you, who works, what is finished, and the counts) and says it with
`app/home/home-words.ts`. The tiles' counts are the four pages' own reads, made only while the
home is visible. Answering is the person's act through bb's SDK (`threads.interactions.respond` /
`resolve` for a choice bb offers, `threads.send` for a reply, as the person at the screen): the
home never calls OATS to act, and never types into a session. These are the only calls in the
whole plugin that send anything to a thread (the instance panel sends nothing). **A press asks
first:** what a card offers follows the roster it was drawn from, and that roster can be seconds
old, so a pressed choice and a sent reply first read the roster the plugin's server holds at that
moment (`snapshot`, no process) and go to bb only if it reads and says the agent runs; else the
card says "OATS has stopped this agent since: nothing was sent. Start it to answer." (or that OATS
no longer lists the agent, or that OATS cannot be read now), and what was written is kept. What is left is the age of the server's own
roster (its watch and its poll). Its one way to an act of OATS is
the card of an agent that does not run: **Start…** opens the lifecycle's own dialog there, which
asks the kernel and acts on its own button.

## The instance panel

On an agent's own thread, the **OATS** tab of bb's side panel is that agent's panel, as the OATS
Desktop's instance panel: who the agent is and how it runs. On any other thread the tab is the
home. On a phone, where bb has no side panel, and for an agent with no bb thread, the same panel is
a page of its own, `/plugins/oats/agent/<instance>`, with the way back.

| Tab | Shows |
|---|---|
| **Instance** | the soul's mark and the instance's name as words, its state on the status line every place shares: the same word as its row and its thread ("Working", "Needs you · 12 min", "Stopped", "Idle", "Failed · session ended", "Unreachable"), with what the kernel itself says of an agent it cannot reach one press away, under **Details** in the header ("OATS says: …": the shared piece the thread's row draws too), the lifecycle's **acts** that apply to its state (Stop…, Start…, Restart…, Retire…: each opens its dialog, nothing runs on the press; off while the roster is the last one read, when the panel's notice says "Acts are off." beside the age of what is shown, with Retry; an agent with no thread in bb has them here, on its own page: Start… and Retire… for one whose thread is gone, Stop…, Restart… and Retire… for one that runs on tmux), and the soul's name (it opens the Soul tab). An **older build** chip when its soul or one of its capabilities moved since the spawn; it opens to what moved. While the agent waits on a person, first on the page and under no heading: its message (with none, "approval" for a tool approval), and since when ("since 14:03"; how long it waits is the status line's to say, once). **Work**: the work mode as a fact ("worktree · <branch>", "shared checkout · <repo>", "<parent>'s tree", "own folder", "workspace"), with **Paths**, the panel's one fold for what is wanted and not needed: the folder and the home, each with its Copy ("shared" where the folder is a link to a tree other instances use), then the session's own id, where the model came from, and what OATS says of the session when it has something to say and the status line has not said it (with no Work card the fold is the Session card's). **Session**: the harness, the model, where the session runs ("bb thread", "tmux session"; for an agent on tmux the kernel itself says runs (`running: true`: it works, or it waits on a person; not one it cannot reach, also when that one still carries a claim), also how to reach it: "Attach:" and the kernel's own command to copy, `oats session attach --home <its home>`), since when it was started ("Last started" for an agent that does not run), and for an agent OATS stopped when it stopped ("Stopped 14:03": the time of its last recorded stop, read from its events for this one agent, and again each time it is seen to turn stopped). **Lineage**: the owning human, and the parent, the sibling and the children, each by its name as words and a link when it has a thread in bb; then the messaging ID, with its Copy. |
| **Soul** | the soul's mark, key and description, and under them **Open soul page**, where the Souls page is shown in this release (the setting `pages`; with the default, `home` alone, the button is not drawn: a link leads somewhere). It is off, with the reason beside it, for a soul OATS does not list; the soul **as this instance was spawned from it**: where it was spawned from (soul and commit), its **Core capabilities** (Knowledge, Messaging, Tasks: what fills each; a filled slot's row opens to why), its **Capabilities**, each a row that opens: its name and why it is there in a word ("workspace", "soul", "team · eng", "default", "off"), and, once opened, why in a sentence and its source; the capability **Warnings**; **Readiness** (the soul's); **Details** (the agents root, with its Copy). The soul's description is two lines at most here, whole on the soul's page. |

The Instance tab ends with two more sections. **Readiness** (`oats readiness`): one line
that says whether it is ready ("Ready", or how many checks fail), then, behind "Checks and
policy", the four checks (Installed,
Configured, Member, Providers) with their items, what a provider itself answers, and the policy
(child spawns, worktrees); **Refresh** reads it again. These are the kernel's
observations, never launch permission. **Activity** (`oats instance events`):
nothing is read until **Load** is pressed; then the last event ("Stopped · 18:23"; "No events"
for an empty record), and behind "Events" each recorded row, newest first, with its time, its
producer and its recorded facts (Spawned, Launched, Restarted, Stopped, Waiting claim, …); a
launch that was blocked at a prompt also shows where its screen first differed from the
confirmation OATS answers (what OATS expected and what the terminal showed, each under whose text it
is). **Refresh** reads it again. It is the history of the instance's address as the kernel
recorded it, not its current state. When the tab is left and come back to, what was read is shown
again, and nothing is read until Refresh. (For an agent OATS stopped the events are read by the
Session's "Stopped" fact, so its Activity shows them without a press. A session OATS lost has no
such fact and no such read: the kernel records no time of a loss, and the last "stopped" its events
hold is an earlier stop's.)

Where OATS has none of a thing for a kind of agent (`E_UNSUPPORTED_MODE`: no readiness check, no
record of what it was spawned from), that part is not drawn: there is nothing to show, and no
sentence says so. The Activity, which is read only on a press, answers the press with "No events".

A read that is refused says why in a person's words (`app/panel/refusal-words.ts`: the Desktop's
sentence where it says what happened, "The readiness read timed out."; the plugin's own where the
Desktop's is an instruction nobody can follow from here, "OATS knows more than one agent by this
name."; and "OATS refused to read …" for a refusal with no sentence), then the code. What to do
next, and the kernel's message, are under Details. It offers Retry only where reading
again can change the answer (a slow or failed `oats`, not an agent OATS no longer lists): there the
notice's Retry is the one act, and the section's own Refresh is not drawn beside it. For a refusal
that reading again cannot change as things are, the notice offers none, and the part keeps its own
way to read again for whoever mended it (Refresh; on the Soul tab, Retry). A read again
that fails keeps what was read under the same titled notice ("Readiness could not be read again"),
which says once how old what is shown is, always relative ("Read 12 min ago.").
When OATS itself cannot be read, the panel says it in the words the sidebar and the thread's row
say it (`app/roster/unreadable.tsx`: `Unreadable` whole where nothing was ever read, `failureWords`
in the same notice over what was read).

Who the agent is and where it is (the soul's mark, its name, the status line, its soul's name, the
older-build fold) stands over the tabs and does not scroll: a page scrolled to its activity, at any
width, still names the agent and its state.

The header's claim is the roster's, and the activity is read at another moment (on Load).
After a restart and a new question the roster can be the older of the two: the header would show
the earlier question until the roster's next read (the plugin's server follows the kernel's event
log; the real run measures under a second, the standard allows 3 s). So when an activity just read
names another standing claim than the roster's, the panel asks for the roster again at once, once
per answer (`app/panel/Activity.tsx`).

The panel draws within the part of bb's side panel that is in the window
(`app/panel/Panel.tsx` `useVisibleWidth`). In the live checks up to oats-bb 84720c5, bb 0.50.1 laid
its side panel out past a 1280 px window (by up to 138 px) when its sidebar, a thread and the panel
were all open, and what was drawn there was cut; it has not done so in the runs since, and what
made it stop was not found. So the scenes move bb's panel column 120 px to the right by hand and
check that the panel then draws 120 px narrower, all of it in the window.
An instant is said in one form ("18:23" today, "Nov 21, 18:23" another day; the kernel's own text of
it is the title), an id or a commit is never broken inside, and each sentence of the kernel's in
the activity and in readiness has a plain first line over it (`plugin/WORDS.md` holds each pair).

On the Instance tab's facts and its header, a fact the kernel does not report is not drawn, and the
panel never guesses. Three places do say that the kernel reported nothing, as the Desktop does: a
core slot of an older kernel's inspection ("Not reported"), a recorded event's fact that is null
("Signal: not reported") and a row whose incarnation the kernel does not name. The words are the
Desktop's (`app/panel/words.ts`, `soul-words.ts`, `events-words.ts`, `readiness-words.ts`,
`refusal-words.ts` and `app/ui/words.ts` name where each comes from), and it is drawn with the
patterns of `app/ui.tsx`.

How it reads: `panelInstance` (`contract/panel.ts`) answers one instance's facts from what the one
status read kept, as the kernel printed it (`core.rowOf`: the instance's row, its agent group's row
and the roster's root), parsed by `kernel/panel-instance.ts`. It starts no process. The panel reads
again at every `oats/changed`; when a read fails it keeps what it read and says how old that is,
with Retry; a first read that fails is a notice in words, the kernel's code after them and its
message under Details. The other three reads each run one command on the home the kernel named: `panelSoul`
(`oats inspect --home`), read when the Soul tab first shows and again when the instance was started
again or what it was built from moved; `panelReadiness` (`oats readiness --home|--soul --policy`),
read when its tab first shows and on Refresh; `panelEvents` (`oats instance events`), read only when
asked. A tab turned back to shows what was read and runs nothing (bb's query client would read a
mounted query again once its answer is 2 s old, so each of these queries is on only until it holds
an answer: `app/panel/read.ts`). None is on a timer. One case is bb's: a first read that is still
in flight or that failed is read again by bb when the window takes focus or the network returns
while bb's own connection is down. A soul's readiness is asked by the key the roster
names, checked against `oats souls` before its process starts.
Another feature opens the panel on one of its tabs with
`showPanelTab(tab)` and the page with `openAgentPage(navigate, instance)` (`app/panel/index.ts`).

## The New agent form

**New agent** (at the roster's foot in the sidebar, and in the heading of the home) opens the form: a page of its own,
`/plugins/oats/new-agent`, or `/new-agent/<soul>` with that soul chosen. It is the OATS Desktop's
Spawn dialog, in its order and its words, and it is not one of the pages the setting `pages` can
leave out: whatever a release shows, an agent can be started.

| Field | What it is |
|---|---|
| **Soul** | the souls OATS lists, each with its description, with a filter over them from eight on. A soul that cannot be spawned is drawn apart in the list and says why under the field. |
| **Opening instruction · optional** | what the agent should do. Empty, it starts and waits for its person. |
| **Harness** | "The soul's default" (nothing is passed, and the entry says what the kernel resolved: "The soul's default: pi"), or one the bb session provider declares. A harness bb cannot run on this machine is marked at the choice ("pi · not installed in bb") and the field says what to do: bb's own state of its providers (`sdk.system.providerStates`), never a guess; it can still be chosen, and the kernel and the provider decide. With one harness declared there is no field; when the list cannot be read the field says so, with Retry, and a spawn uses the soul's default. |
| **Model** | "Default" (nothing is passed; it says the model the kernel resolved), one of bb's own models for the harness, or **Custom…**, which opens a field for a typed model id. |
| **Relationship** | Independent, Child of, Sibling of or Parent of, then **Which instance**: one of the roster's, by its name as words with its soul. |
| **Name · optional** | exactly what is typed, in lower case. Empty, the kernel numbers the agent. A name that cannot be used says its fault under the field. |

**What will be created** stands beside the fields, and on a phone between the fields and the
buttons, so that it is read before the press. It is the kernel's own preview (`oats spawn …
--preview --json`) of exactly the values on screen, in a person's words, one fact under the other:
the name and the home, the soul, where it works (the work mode, the branch and its base) and on
which machine, the harness and the model and where they came from, that its session is a bb thread,
the access it runs with ("full mode: no sandbox"), the team it joins, who it is started under, what
sets up its work tree, the core capabilities and the capabilities. Nothing is defaulted in silence:
each line is read from the kernel's answer (the machine from the roster), and a line the answer
does not carry is not drawn. It is read again 0.4 s after the last change; meanwhile the last
facts stay, marked "Updating…" ("Reading defaults…" before the first), and an answer for values
that are no longer on screen is never drawn. A warning is drawn only where the kernel gives one,
as a warning. A path or a branch breaks after "/" and "-", never inside a word. The form reads
`spawnPlan`, which never answers the kernel's preview whole: the host entry answers these facts
and the decision's revision (`contract/spawn.ts` `spawnFacts`, `model/spawn.ts` `formFacts`). A
preview that is no decision a spawn could apply (a launch with a problem, checks that did not
finish, a backend that is not installed) is a refusal there, with the kernel's code.

**Spawn** is held to what the screen shows:

- It is off, with its reason beside it, until the preview of the values on screen is drawn
  ("Reading defaults…", "Choose a soul first.", "The name can’t be used: its field says why.", …).
  The same holds for its key.
- It applies the decision that preview showed (its revision goes with the call), so "Spawn refuses
  if this changes before you confirm" is true: a decision that moved is refused by the kernel,
  nothing is created, the preview that was on screen can no longer be pressed, and the column is
  read again and says so.
- On the press the button reads "Spawning…" and is held, with every field: one press makes one
  agent, however often the button or the key is pressed meanwhile. When the kernel answers the
  form says "Created <name>", stays held, and opens the new agent's thread; "Created <name>." is
  also told through bb's own toaster (`notify`, `app/ui/notify.ts`), with "Open <name>": it stays
  when the thread opens, and reaches a person who left the form while it spawned (a failure is
  told there the same way, and stays until dismissed).
- After a press that did not answer "created", the form goes by what is KNOWN
  (`model/spawn.ts` `SpawnOutcome`). **Refused**, with the values free again, only where something
  says nothing was created: a refusal of the kernel's that the tables name, whose rollback the
  kernel finished, or a call that never reached the kernel. Where the kernel marks that it could
  not confirm what is left (its rollback is incomplete), part of the instance may still be there
  whatever the code: the form stays held, says so, and the kernel's message under Details names
  what to clean up. It is read from the kernel's own marker, `error.details.unconfirmed: true`,
  never from the words of its message: the envelope keeps the marker beside the code and the
  message (`kernel/envelope.ts`, `KernelError.unconfirmed`; nothing else of an error's `details`
  passes, and a `details.unconfirmed` that is not the literal `true` is no marker), and the
  server's refusal carries it to the app as the refusal's one issue (`server/core.ts` `refusal`,
  `contract/shared.ts` `isUnconfirmed`). **Created**, where the kernel says an instance exists whose start did not
  finish, or the spawn went through and named no thread: the form stays held, says so, and sends
  the person to the sidebar; this is read before the marker, which the kernel also sets on an
  instance it kept (`E_SPAWN_INCOMPLETE`). **Unknown** for everything else (the kernel's "could not confirm", a
  time limit, an `oats`, a machine or a server that ended without an answer or with one the plugin
  cannot read, a code nobody classed): rollback is never inferred. There the fields stay held and
  the one act is **Check result** (held like the acts while OATS cannot be read): it asks again under the same idempotency key, so the kernel
  replays the spawn it made or makes the one it did not, never a second.
- A refusal leads with a person's words (the Desktop's, `model/spawn.ts` `spawnProblem`), then the
  kernel's own message under Details, then its code; the values are kept. A sentence names only a
  control the form has.
- A spawn goes on when its page is left: the form, opened again meanwhile, says "A spawn of <soul>
  is in progress." and starts no second one.

While OATS cannot be read the form is held like the acts: the roster's own notice (with the age of
what is shown), the fields and Spawn off with the acts' reason, and nothing asked of the kernel.

Mod+Enter spawns from any field (⌘ on a Mac, Ctrl elsewhere), as in the Desktop's dialog, and is
said beside the button; Enter alone spawns nothing. The Desktop's Mod+1 to Mod+7, which go to a
field, are not built: in a browser tab the browser keeps Ctrl or ⌘ with a digit for its own tabs,
and a hint for a chord that does not fire would mislead. Tab walks the fields in the form's order.

The soul, the harness, the model and the instance are each a field that opens a list
(`app/spawn/Choice.tsx`: the WAI-ARIA combobox that only selects, in the shared look of a field;
opening it moves the page no further than it takes to show the whole list): the form's own for
now, offered to `app/ui` afterwards.

A relation names its anchor with `--relation <kind> --relative-to <instance> --relative-root <agents
root>`: the root is the anchor's home, as the roster's row names it, without its
`<agent>/instances/<instance>` (the kernel's status names no agents root on a row, and derives it
from the home the same way); a home of another shape passes none.

Every spawn is `--backend bb --yolo`: the form says so in one line by the button, "Runs in bb's
full mode: no sandbox.", with no control, and the preview says what the kernel decided
([How it is built](#how-it-is-built)).

The live checks show the form in flight and count the spawns the kernel was asked for; they take no
image of the created agent's thread, because their `oats` is a fake that makes no agent (the thread
it names is one of the fixture's). The created state is shown by the unit tests and by the real
run, whose image is the new agent's own thread, new in the roster under its parent.

A soul's page (the Souls page is not shown in a release's default) still holds the earlier form: a
name, a task, Preview (`spawnPreview`, the kernel's preview as short lines) and Spawn in bb. It
goes when the workspace's pages are rebuilt.

Not in the form yet (a later change), by the Desktop's rows: where to run, on another machine
(D-242, D-263: the agent runs on the machine that holds the deployment, which the preview names);
teams to join (D-245); a name suggested from the task (D-247); Run in background (D-248); the
developer settings: work area, launch configuration, messaging identity (D-249 to D-253); the
session backend as a choice (D-254: it is always a bb thread, and the preview says so); a wake-up
at spawn (D-255, D-264); the Launch prompts of the preview (D-256; what sets up the work tree is
shown); "Changed: press Spawn again" (D-257: Spawn is off while the values on screen have no
preview, so a press is never for other values); the keys to a field (D-258); "Show its row" for a
spawn in flight (D-259); a failed spawn kept with Reopen (D-262); the draft kept (D-265).

## Automations

**Automations** (in the sidebar's block, under Machines; `/plugins/oats/automations`) shows OATS's
own schedules and triggers: the ones this deployment holds and the ones the workspace's members
share through Git. They are the kernel's (`oats schedule …`, `oats trigger …`): the plugin is a
front for them and never uses bb's own automations. The page is the OATS Desktop's Automations
page, in its words.

- **Two tabs, Schedules and Triggers**, each with its count. A list groups its rows by where they
  run, because the first question is what this computer does: **Runs on this computer**, **Needs
  attention here** (wrong account here, not trusted here, an invalid or unreadable definition) and
  **Runs elsewhere**. All / Workspace / Local filters by where the definition lives; the search
  reads the id, the soul, the task or wake message, the summary, the host and the account.
- **A row** says its name and where it is from, its summary (or the first line of its prompt, in
  italics), its soul, when it runs in words, where it runs and as whom, and its last and next run.
  The kernel places every row (`runsHere`, `reason`, `enabledHere`); the plugin reads those facts
  and derives none.
- **A row's page** shows what it sends, whole (the prompt, the wake message, the command's argv,
  the operation), when it runs or what it watches, what it spawns, its recent runs or fires on
  this computer, what is wrong with it, its run state, where it runs and where it comes from. A run
  that did not happen says why in the kernel's words. **Open file** previews the definition from
  the machine that holds the deployment, or opens its web page for a member with no clone here. A schedule's or a trigger's Prompt and a wake's message are
  the one exception to the display filter: they are drawn whole, as the Desktop draws them (their
  lines, blank lines and indentation kept, nothing withheld, nothing cut), because they are the
  definition a person or their workspace wrote and the page is there to read it. Only a character
  that is not text (a control, a bidi override, a zero-width space) is drawn as U+FFFD, so a
  definition from a shared repository cannot reorder or hide what the page shows.
- **A trigger's page** reads `oats trigger status`: what is live, what fired, what waits, the last
  poll and the last error. For a trigger on a capability's source, the trigger file's parameters
  and the source's own words (what it skipped, what OATS refused, its refusal) are shown as quoted
  text under whose text it is, never as a link or as one of the plugin's sentences. **Open
  capability** opens the Capabilities page when that page lists the source's capability once.
- **The header** says the host scheduler's state ("Scheduler on · checked … · up to N at once", or
  "Scheduler off"); when it is off and something here would run, a banner says nothing runs until
  it is enabled.
- **The sidebar's row** carries a red dot, announced "Automations, a run failed", while a
  schedule's last run is launch failed or invalid.

The lists are read together and kept beside the roster read they were made with: whatever makes
the server read OATS again (an event of the deployment, an act, Retry, the poll) renews them, and
the app asks again every 30 s while the page shows them (once a minute for the sidebar's mark
alone), since a run that fails writes no event the server watches. A trigger's state is read when its page opens, for an id the
current list names. An OATS that does not list the feature `automations` (before 0.29) is not
asked: the page says which OATS it needs.

**Acting on a row** goes through the kernel's own verbs, for a row the current list names:

- **The switch** (and Turn off here / Turn on here in the row's ⋯ menu) turns a row on or off on
  this computer: a local item's own switch, a workspace item's entry in this host's opt-outs.
- **Run now** (a schedule that runs here) says what the run did in words: Agent launched, Launch
  failed with the kernel's reason, Launch state unknown. **Check run state** asks the kernel about
  a run whose state is unknown.
- **Test** runs nothing and says whether the row would run here, who `gh` acts as, and what would
  fire now, with what is held and why. Its answer is on the row's page, so Test from the list's
  menu opens that page. For a trigger on a capability's source it first says what will run and
  with which parameters; only **Run test** runs that source's command, once, and only while the
  trigger is what the confirmation showed (a change of its source or parameters, Back or another
  row's page withdraws it).
- **Edit summary** (a local item) and **Delete…** (a local schedule, after a confirmation); a
  workspace item is changed and removed in its repository.
- **Enable scheduler**, where the scheduler is off: a confirmation says what it installs on this
  computer (the timer of `oats schedule host install`, for the account bb's machine runs as)
  before it does.

One act runs at a time. While it runs the page says so in words where its answer will be
("Running daily-review…"); the answer, a test's result and a confirmation take the focus when they
arrive, which brings them into view at any width. Where a row's page is one column (a phone, a
narrow panel) they come first, right under the buttons; from bb's wide layout up they lead the
second column. The lists are read again after every act. While
a list is one that could not be read again its rows stay, with their acts held (what each row is now
is not known) and the notice saying so; Open and Open file stay. An act
is refused before any process starts for an id the list does not name; the kernel's own refusal is
shown in a person's words with its code after.

Not there yet: creating and editing a schedule (its own change). Two of the Desktop's ways into
the page wait for a product decision and are not built: its ⌘3 / Ctrl+3 shortcut and its palette
entry (bb takes both from a plugin command registered with a default shortcut).

`test/fixtures/automations/` holds what the real kernel printed for every command the feature
runs, and `record/` there makes the recording again (its README says what was arranged).

## How it is built

| File | Runs in | Does |
|---|---|---|
| `host.ts` (`bb.host`), `host/` | bb's host daemon, on the machine that holds the homes | runs `oats`, and watches the deployment's event log; nothing else |
| `server.ts` (`bb.server`), `server/` | bb's server process | the settings, the RPC handlers, one cached snapshot for all clients, the realtime invalidation |
| `app.tsx` (`bb.app`), `app/` | the web UI | the slots |
| `contract/` | shared | the RPC contract (app to server), the host contract (server to host), the realtime channel |
| `kernel/` | the host entry and tests | one function per `oats` command: the argv, and the answer read with a schema into the plugin's types |
| `model/` | the app and tests | pure functions from the agents and bb's threads to what each slot draws |

`kernel/` and `model/` import neither bb nor React.

### One module per feature

The plugin's features are `roster` (the sidebar's tree and the thread's header row), `home`,
`spawn` (the New agent form), `workspace` (the four pages), `lifecycle` (stop, start, restart,
retire), `automations`, `panel` (the instance panel) and `outside` (what is said when something
happened to an agent outside OATS; no slot, no read and no `oats` verb of its own). Each has one module, or one directory, in
every layer, and the entry of a layer only composes them:

| Layer | A feature's own | Composed by | Shared by all |
|---|---|---|---|
| contract | `contract/<feature>.ts`: its schemas, `rpc` (app to server) and `host` (server to host) | `contract/index.ts` | `contract/shared.ts` |
| server | `server/<feature>.ts`: `handlers(core)`, one per verb of its `rpc` | `server.ts` | `server/core.ts` |
| host | `host/<feature>.ts`: `handlers(core)`, one per verb of its `host` | `host.ts` | `host/core.ts` |
| kernel | `kernel/<feature>.ts` (and `kernel/<feature>-*.ts`): `verbs(oats)`, the argv and the parser of each command | `kernel/index.ts` | `kernel/runner.ts`, `run.ts`, `envelope.ts`, `input.ts`, `result.ts`, `task-file.ts` |
| app | `app/<feature>/`: its components, and `register(app)` in its `index` where it registers a slot (`app/outside` has none) | `app.tsx` | `app/ui.tsx`, `app/ui/`, `app/oats.ts`, `app/store.ts`, `app/format.ts`, `app/keys.ts` |
| model | `model/<feature>.ts` for types and pure functions of its own | | `model/types.ts`, `model/view.ts`, `model/text.ts` |
| unit tests | `test/<feature>/`, with `handlers.ts`: the slot tests' default answer of each of its RPC verbs | `test/helpers/render.ts` | `test/helpers/`, `test/support/` |
| fixtures | `test/fixtures/<feature>/`, with `verbs.json`: each `oats` verb the fake answers, and its file | `container/fake-oats.mjs` | |
| live checks | `container/scenes/<feature>.mjs` | `container/live-ui.mjs` | `container/` |
| real run | `container/real/parts/<feature>.mjs` | `container/real/scenario.mjs` | `container/real/` |

A change to a feature touches its own modules only. A new verb is one entry in the feature's
`contract/<feature>.ts`, its handler in `server/<feature>.ts`, and for a host verb its handler in
`host/<feature>.ts` and its command in `kernel/<feature>.ts`: the entries (`contract/index.ts`,
`server.ts`, `host.ts`, `kernel/index.ts`, `app.tsx`, `test/helpers/render.ts`) change only when a
feature is added, by one line each. The host contract stays a closed list (`hostVerbs` in
`contract/index.ts`): the server never sends a command, a flag or a path.

What the features share, beyond the entries:

- **One status read.** The server runs one `oats status --json` for everybody and keeps the
  kernel's own rows beside the snapshot. A feature that draws more of a row than `Agent` holds
  (`model/types.ts`, pinned) asks `core.rowOf(instance)` or `core.rowsOf()` in its
  `server/<feature>.ts` and reads with a schema of its own what the kernel printed: the
  instance's `row`, its `agent` group's row (the soul's, without the instances) and the roster's
  `root`, each with the snapshot's `at`. A raw row holds everything the kernel printed (settings of
  capabilities, paths): a feature picks the fields it draws with its schema and answers those to the
  app, never a row whole (bb's API has no login). Nobody starts a second status process. The server publishes `oats/changed` when
  anything the kernel printed changes, a field outside `Agent` included.
- **One read of the kernel's version.** `core.versionOf()` answers `oats version --json`
  (`version`, `desktopApi`, `features`, and `apis`: each `<name>Api` number), read once for every feature and client and reused like a
  page's answer. A feature that depends on a kernel feature asks there.
- **One state in words.** `agentStatus(agent, thread, now)` (`app/roster/status.ts`) answers the
  state, its word and how long the agent has waited. It is the one function for every place that
  says a state in words: the sidebar's rows, the line under a thread's header and the home's card
  read it (the instance panel has the Desktop's own words for its header). `claimOf(agent)`
  (`model/view.ts`) is the one gate for whether an agent's claim is shown, the Desktop's with one
  difference the comment there states: the sidebar, the thread's row and the instance panel all
  read it, so they say Needs you, and show the claim, together.
- **One tab on a thread.** bb gives the plugin one fixed tab on a thread, the home's. A feature
  with a view of one agent (the instance panel) names its component with `setAgentTab`
  (`app/home/agent-tab.ts`) in its `register`: the tab shows it on that agent's thread, and the home
  on every other, and while the roster cannot be read it keeps the view of the agent it showed there.
  `setAgentPage(open)` names how to open one agent's own page (by instance): the thread row's "Instance panel"
  button opens it at the phone's width, and an agent with no bb thread opens it from its row in the sidebar and from its soul's page.
  `openSoul(navigate, key)` (`app/workspace/pages.ts`) opens one soul's page.
- **Whether a page is shown** (the setting `pages`). A page's `navPanel` component is
  `shownPage("<id>", Page)` (`app/workspace/pages.ts`): it draws the page where the release shows
  it, the "not shown" line where it does not, and nothing while bb is still reading the settings.
  A place that links to a page asks `usePageShown("<id>")` (or `usePagesShown()` for several) and
  draws plain text, or nothing, where the page is not shown. A feature tests both cases: a slot
  rendered with no settings stands for every page shown (`test/helpers/render.ts`), and a test
  of the default names `settings: { pages: "home" }`.
- **"New agent".** The form's feature names how to open it, once, in its `register`:
  `setNewAgent((navigate, target) => …)`, where `target.soul` is a soul's key to start with. Every
  "New agent" then opens it through `openNewAgent`; until a feature names one it opens the Souls
  page where that page is shown, and is absent where it is not.
- **A row in the sidebar's block.** A feature with a page of its own lists it under the four pages
  with `addPageLink({ path, title, useMark })` (`app/workspace/pages.ts`) in its `register`;
  `useMark` is a hook that answers a label while the row needs a look, drawn as a dot.
- **A server test of a feature's verbs** starts the whole backend with `startBackend()`
  (`test/support/backend.ts`): bb's fake plugin host, the real host entry, the fake `oats`.

### The patterns: one component each

Every screen of every feature is drawn with the components of `app/ui.tsx` (the UX standard,
section 3); a feature draws no other of its own, and asks for what one lacks. Their words are the
Desktop's (`app/ui/words.ts`; `WORDS.md` holds each word that differs, and why).

| For | Component | What it holds |
|---|---|---|
| something to open and read ("Details", "Paths", a row of a list that opens) | `Disclosure` | closed until pressed; its summary one word, or a row behind its mark, as high as a control |
| a kernel's own word in a sentence | `Code` | a code, a flag, a file's name, filtered |
| a state | `State`, `StateMark` | pass the `state`, not a word: the mark AND the word (`STATE` in `app/ui/words.ts`; the screens that are not on the patterns yet still print `agentStatus().word` and `Dot`, the older `STATE_WORD`, until the roster's piece moves them); the Desktop's "!" for an agent that waits; a mark that stands alone carries the accessible name |
| where an agent is | `StatusLine` | the state, how long it has waited, the question or the reason, the act that applies |
| a state that is not an agent's | `Toned` | a dot (ok, warn, bad, muted) AND its words |
| a fact | `Facts`, `Fact` | `label · value`, the label muted, the value whole; a fact with no value is left out; `LINK` is a link's look |
| a titled block of a page | `Section` | its heading, with a count where it lists things |
| failed, stale, not configured, cannot show | `Notice` | a title in a person's words, sentences, the age of what is still shown, the code after the words, the acts that help; under its one fold (Details) the kernel's message, or several texts in order (what to do, the code and the message) |
| nothing to list; a read in flight | `Empty`, `Loading` | a sentence (or a title alone) and the act that fills it; "Reading…", announced |
| content read earlier | `Stale` | its age, why the unsafe acts are held, a re-read in flight |
| an act on an agent | `Confirm` | the act and the agent in the title, what the act does (the lifecycle dialogs: one consequence line under no heading, and their own one Details; a dialog that is not cut to one line: what will happen, what is kept), the button named for the act, the act in progress and its result in the same dialog (done, refused, or not confirmed); while the kernel is asked, the line of the place that asks ("Checking instance…"); it shows no plan that is another agent's |
| what happened | `Result` | done, failed or not known, in words, with the code after and the next step |
| what happened, once the person has moved on | `notify` | a result or a failure through bb's own toaster (`sonner`, which bb shims for plugins: a type-only devDependency at bb's version, no Toaster of the plugin's), with "Open <agent>"; a failure stays until dismissed; `notified()` is what a slot test reads |
| a form | `Field`, `INPUT`, `DisabledReason` | the label (with "· optional"), a hint, the refusal; why a button is off |
| tabs, a filter, a search, a switch, a row's menu, a copy | `Tabs`, `Segmented`, `SearchField`, `Switch`, `Menu`, `CopyButton` | the WAI-ARIA pattern of each, with its keys |
| the rest | `Button`, `Card`, `Chip`, `Heading`, `Page`, `Modal`, `Mark`, `ErrorLine`, `Lines` | `Modal` takes the focus (on `data-autofocus`), keeps it, and returns it to what opened it, or where `returnFocus` says |

A control is 32 px high, and 44 px at bb's compact width (`TARGET`).

### Text from OATS or an agent

Everything the plugin draws that OATS or an agent wrote (a name, a description, a message, a
refusal) goes through one display filter, `app/ui/text.ts` (its functions are in `model/text.ts`): the OATS Desktop's
(`packages/client/display-text.mjs`). Control characters and line breaks never reach the screen (a
character that is not text is drawn as U+FFFD), a line is cut at 2048 characters, and a text that
looks like a secret or a URL with credentials is drawn as `[withheld]`, whole. `shown(text)` is
one display line; `refusalLines(text)`, which `ErrorLine` and `Lines` of `app/ui.tsx` draw, keeps a
refusal's code and gives each line of the kernel's message a line of its own. The filter is for
display only: what goes back to OATS (an instance, a soul, a revision) is what the kernel gave.
One named exception: `shownBlock(text)` draws a person's own definition text whole, in one block
that keeps its lines (a schedule's or a trigger's Prompt and Wake message, as the Desktop draws
them, and nothing else): no cut, nothing withheld, and only what is no text replaced by U+FFFD.

- **Why the host entry runs `oats`.** Only it sees the user's login-shell PATH, and only it can
  target the machine that holds the homes.
- **Children.** bb reaps no child of a plugin on reload or stop. Every `oats` runs in its own
  process group with the call's abort signal; on an abort, a timeout, the worker's lifecycle signal
  and in `dispose`, the group gets SIGTERM, then SIGKILL after a grace (`kernel/run.ts`). What an
  `oats` that finished by itself left running is the kernel's and is left alone.
- **Inputs are untrusted.** bb's API has no login, so any client of the server can call the
  plugin's RPC. No RPC takes a path, a flag or a command. A soul must be one `oats souls` lists; a
  name must match `^[a-z0-9][a-z0-9-]{0,62}$` and is one argv element; a harness must be one the bb
  session provider declares; a model is one line that cannot be read as an option; a relation is
  one of three words and an instance of the current snapshot, whose agents root the server takes
  from the roster and never from the caller; a task travels as a 0600
  file in the host worker's temporary directory, removed when the call ends; an instance must be in
  the current snapshot, and its home is the one the kernel named. The plugin adds no power a caller
  of bb's own API lacks.
- **Spawn runs in bb's full mode, always.** Every spawn the plugin makes, the preview and the
  apply alike, is `oats spawn <soul> --backend bb --yolo`: bb's full mode, with no sandbox between
  the agent and the account bb runs as. The bb session provider launches in no other mode, so a
  spawn that named none would depend on the host having a full-mode default launch configuration
  and be refused without one (`E_BACKEND_SANDBOXED_MODE`). There is no tick box: the New agent
  form says it in one line ("Runs in bb's full mode: no sandbox."). Chosen by Joan on 2026-11-21
  ("Silent, always full"). Start and Restart name no mode: they keep the home's recorded choice,
  and a home spawned elsewhere without full mode is refused there by the kernel, shown unchanged.
- **An agent on tmux starts, restarts and comes back from bb.** Start and Restart are offered for
  an agent on tmux as for one on bb (its page, the panel): a stopped one starts plainly, a
  running one restarts, and neither opens a thread: the result says where the agent runs, with
  the command that attaches (the instance panel's words). Start of an agent on tmux whose session was LOST (the
  kernel's row at the dialog's check: backend `tmux`, `sessionEnd: "lost"`) is `oats session start
  --resume`: the harness's own last conversation, where a plain start begins fresh on its task.
  The dialog says what it tries and offers no harness or model (the kernel takes none beside
  `--resume`); the plain start stays as a choice that is off. The result says what the kernel
  answered (`resume`): back in its last conversation, started fresh and why, or back and waiting
  in its terminal, with the command that attaches. An agent on tmux has no bb thread: none is
  waited for and none opens. The app sends `resume: true` only from that dialog; the server
  refuses it for a home that is not on tmux and never turns a resume into another start; whether
  the session is still lost is the kernel's to say (`E_RESUME_NOT_LOST`: the dialog goes back to
  its check). A lost agent on bb is unchanged (a new thread; the carry-on line). No harness or
  model is offered for an agent on tmux, by a resume, a plain start or a restart: the only
  harness list and model suggestions the dialog has are the bb session provider's, which say
  nothing of a tmux home, so the kernel starts it with the launch its home recorded. The
  sentences of a resume are this plugin's own (the Desktop resumes without a screen; WORDS.md).
- **A start begins a new conversation.** A Start, and a Restart, always make a NEW bb thread; the
  launch stops and archives the one the agent had (the bb session provider's
  `oats-package/capabilities/oats-bb/lib/launch.mjs`). The Start
  dialog says so before the act, in its one line ("Starts a new conversation."; Restart says it
  under Details), and the result opens the new thread. Where the last conversation stays is no
  line of the dialog, so bb is not asked for it. For an agent that was cut off the Start
  and the Restart dialog say first that a message in its thread carries its conversation on, with a button to
  that thread; the act stays possible. Cut off is two facts, both read: the kernel's row says the
  agent does not run and that no operator stopped it (a session lost with the host or with its
  harness: `running: false`, `sessionEnd: "lost"`; or a thread at rest with no harness loaded:
  `running: false` with a runtime state that is not `stopped`), and bb has its thread in the sidebar (whatever bb says of its last turn: the one reading, `messageResumes`, `model/rest.ts`). An operator's stop never
  gets the line. Whether it is drawn is decided once, when the check answers: the launch archives
  the old thread while it runs.
- **Spawn.** The kernel takes an idempotency key only with the decision it confirms
  (`--expect-decision`), so Spawn applies exactly the decision a preview answered, with the key:
  the one the form showed (its revision comes with the call), else the one the server reads right
  before the apply; asked again with the same key, it replays the same spawn. A spawn or a retire that runs
  capability hooks can take minutes: if the client stops waiting, the act still finishes and the
  tree shows it.
- **Freshness.** The server keeps one snapshot (`oats status --json`). It rereads on the host
  entry's `changed` signal (a watch on `<deployment>/.agents/events`, where the kernel appends one
  line per spawn, launch, stop, retire and waiting claim, set or cleared), after each of the
  plugin's own acts, on bb's thread created and deleted events, and every 15 s while a client
  watches the snapshot: never two reads at once, a pause between two reads of 1 s or of the time
  the last one took to answer, whichever is longer (after a read that failed, 1 s), 20 s limit. A status that hangs is ended at its limit before the
  next starts: under any burst of events one `oats status` is alive at a time. ONE read is at once: a
  read asked for while another is in flight (a change that read may not have seen) starts with no
  pause when that one ends, if it answered within 2 s (`FOLLOW_UP_WITHIN_MS`, `server/core.ts`), and
  only once: a change during that second read waits the pause again. So a change that lands in the
  FIRST read of such a pair is on screen after about two reads: 2.1 to 3.04 s on the pilot's host,
  where one `oats status` took 1.05 to 1.52 s under load (2026-11-23; with the pause it was 3.3 to
  4.3 s), so at its slow end still at the 3 s, not under it. A change that lands in the SECOND read
  (the clear after a set, the second event of one act) still waits that read, the pause and the
  next, as before: no read is later than it was, the worst case is not shorter, the common one is.
  The cost is in a sustained burst: a kernel that answers in t spends 2t of every
  2t + max(1 s, t) on status (63 % at 0.85 s, 67 % from 1 s to 2 s); a kernel slower than 2 s keeps
  the pause after every read and spends at most half its time on status (the first spec's "never
  within 5 s of the last" gave way to this). The server says in its log, at debug level, which rule
  each read asked for mid-read took. Each
  reread that differs publishes `oats/changed`, and the app refetches. A harness that exits by
  itself writes no event: the 15 s poll carries it. The watch dies with the host worker; it is
  asserted again at every start of the plugin's service, after a worker exit, and after any read
  that finds it gone.

## `experimental_*` names used (SDK 0.6.157)

The one list to check at a bb upgrade.

Backend and contracts: `experimental_defineHostEntry`, `experimental_signals`,
`experimental_retryable`, `context.experimental_paths.tempDir`, `context.experimental_watch`,
`context.experimental_emitSignal`, `bb.hosts.experimental_client`, `host.experimental_onSignal`,
`host.experimental_onWorkerExit`, `experimental_PluginRpcRefusal`,
`bb.rpc.experimental_whileWatched`, the RPC handler context's `experimental_signal`.

Backend tests: `experimental_createHostEntryHarness` (`experimental_call`,
`experimental_getSignals`, `experimental_dispose`, `experimental_paths`, `experimental_watch`),
`createFakePluginHost`'s `experimental_callHostRpc`, `experimental_hostRpcCalls`,
`experimental_emitHostSignal`, `experimental_watchRpc`.

App, slots: `experimental_threadList`, `experimental_threadHeaderRow`, `experimental_tab` (a fixed
thread tab), `experimental_threadAction`, `experimental_appOverlay` (draws the dialogs of Stop,
Start, Restart and Retire, which a thread action has no place
to draw), and on `navPanel`:
`experimental_useBadge`, `experimental_hideFromNavigation`.

App, hooks and components: `experimental_Icon` (one glyph of bb's own set drawn in the plugin's
rows: "Terminal", named "tmux", for an agent on tmux; `app/ui/tmux.tsx` looks once whether bb's
set holds it, and draws the word "tmux" where it does not), `experimental_useSidebarThreads`, `experimental_useRpcQuery` (the
watched reads), `experimental_useAppPanel` (`openTab`), `experimental_useTabVisible`,
`experimental_usePluginId`,
`experimental_ThreadActionsContextMenu`, `experimental_ThreadStatusGlyph`,
`experimental_resolveThreadStatus`, `useBbNavigate().experimental_openFilePreview` (Automations'
Open file: a file of the machine that holds the deployment, in bb's own preview).

App tests: `renderSlot`'s `experimental_panel`, and its `inspection.experimental_panelCalls`.

Not experimental, but bb's to change: the strings of bb's thread action groups and their order
(`app/lifecycle/index.tsx` `OATS_GROUP`, "3_oats": a group of the plugin's own, which stands
between bb's "2_organize" and its "3_settings" and "4_lifecycle" by the SDK's string order), the thread rows' `data-sidebar-thread-shortcut-target` and
`data-sidebar-thread-id` attributes, the settings route `/settings/plugins/<plugin id>` (the
"Choose a machine" link), the icon names (each feature's `ICON`; `app.tsx` says how to check one), and bb's compact breakpoint
`(max-width: 767px)` (`app/roster/IdentityRow.tsx`).

## Developing

Everything runs in a container (`--cpus 2 --memory 6g`, no mounts, no Docker socket, no host home;
bb sovereign: no account, `BB_TELEMETRY=false`, loopback). Never `npm install` on the host.

From the repository's root (the scripts find the plugin by their own place, so any directory works):

```sh
plugin/container/ci.sh            # the image, the installs, typecheck, unit tests, build, live tests, the real run
plugin/container/ci.sh unit       # typecheck, unit tests and the build
plugin/container/ci.sh live       # the live tests only (bb-app, the plugin installed, a fake oats)
plugin/container/ci.sh real       # the real run only (bb-app, OATS from npm, the bb session provider)
plugin/container/ci.sh pi         # the pi run only: a pi agent launched from the New agent form (container/real/pi/README.md)
```

`plugin/container/README.md` says what each script does and how to keep a container for a session
of work. The unit tests run `kernel/`, `host.ts` and `server.ts` against a fake `oats`
(`container/fake-oats.mjs`) that prints the recorded answers in `test/fixtures/`; the live tests
run bb-app at the pinned version with the plugin installed from the checkout and the same fake.
CI runs the same three stages, as jobs side by side (`ci.sh unit`, `ci.sh live` once per theme, `ci.sh real`),
and the pi run as one more (`ci.sh pi`):
`.github/workflows/plugin.yml`.

The fake is checked against the real thing by a run of its own: `plugin/container/real/run.sh`
puts bb-app, a real OATS kernel, the bb session provider and Claude Code on a mock model in one
container, drives the plugin through its RPC (spawn, stop, start, restart, retire, and the
refusals), and records what the kernel printed; `test/fixtures/README.md` says which fixtures are
those recordings, and at which versions. It is the last stage of `ci.sh`, and a job of its own in CI
(`plugin/container/real/README.md`).

The bb version the tests run is the repository's pin: the one line of `bb-version` at the
repository's root where that file exists, else `devDependencies["bb-app"]` in `package.json`. The
two are kept equal, and `engines.bb` contains it.

`contract/`, `model/types.ts` and `test/fixtures/roster/status.json` and `threads.json` are pinned by
the spec: a change to them is agreed with the spec's author first.
