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
| `pages` | `"home"` | The plugin's pages that are shown, by id (empty: the default), with commas or spaces between them: `home`, `automations`, `souls`, `capabilities`, `teams`, `machines`. A page that is not shown has no link in the sidebar, no mark there, no link to it from the thread's row, and its path answers "This page is not shown in this release of the OATS plugin." with the way back. The default shows the home alone: the other pages are built and tested, and left out until they are finished. The pattern book (`/plugins/oats/patterns`) is no page of this list: no link leads to it, and its path answers under every value, for the checks that draw it. Changing `pages` reads nothing again: the roster stays as it is. Not behind the setting yet, each its owner's to close: the home's Workspace tiles and the panel's "Open soul page" still lead to a hidden page (which answers "not shown"), and the home's own route answers under every value. |

When something is missing, bb stays fully usable. Every place of the plugin shows one notice: what
is missing in a person's words, what to do, the code, the plugin's or the kernel's own message
under Details, Retry, and Open settings where a setting mends it. Where OATS was read before, the
roster stays as last read under that notice, which says its age once ("Showing what was read
<age>."), and the OATS acts are HELD until OATS is read again, as on the Desktop: Stop, Start,
Restart and Retire stay in their place, off, each with the reason, the notice says so in one
sentence with Retry first, and the plugin's server takes no act meanwhile. What a place still
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

## Stopping, starting, restarting and retiring an agent

The four acts are OATS's own, each through the kernel, and each opens a dialog first: nothing runs
on one press. They are in an agent's thread menu (**Stop agent (OATS)**, **Start agent (OATS)**,
**Restart agent (OATS)**, **Retire agent (OATS)**: the menu holds bb's own Stop beside them, hence
the suffix), on the thread's status line (**Start** for an agent that does not run, **Restart** for
one whose session ended), on a soul's page for an agent whose thread bb does not have (**Start**,
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
agent's."). bb does not run a plugin command's shortcut while its Terminal tab has the focus.

- **Stop** and **Retire** read the kernel's plan and show it as sentences about the agent the
  PLAN names (never the row that was pressed): **What will happen**, **What is kept**, the state of
  each session and of its uncommitted work, and what a person should see first (an agent in the
  middle of a task). Stop has the switch **Include child instances** (on: the kernel's default; off
  reads the plan again for the agent alone). Retire has **Also delete the worktree** for an agent
  with a worktree of its own, with what would be lost said under it; without it the worktree is
  kept, moved aside. Both dialogs open with the focus on Cancel. Stop says what it means for the
  agent's thread (as the provider is today, a message sent in it starts the agent again without
  OATS); Retire says that it cannot be undone and that the agent's conversation stays readable in
  bb, archived. Where a retire kept the home (its cleanup did not finish), the result says that
  the thread can be unarchived in bb and a message there starts the agent with no OATS around it.
- **Start** and **Restart** first read the agent as the kernel has it now ("Checking
  instance…"), and show its harness, machine and home. **Harness** starts on "Keep the recorded
  harness" and passes nothing; one the bb session provider declares is passed as `--harness`. With
  one harness declared there is no choice. **Model for this start** is blank for the recorded or
  default model, or a model id. Neither act names a mode (the home's recorded choice stands), and
  both say what that mode is on bb: "Runs in bb's full mode: no sandbox."
  Restart says that it stops the current harness first. An agent the kernel says is running is
  not started again: the dialog says so and offers its thread.
- **While the act runs** the dialog says so and cannot be dismissed. **Its result** is said in the
  same dialog, in the Desktop's lines ("3 sessions stopped.", "Home folder deleted.", "Worktree kept
  at …", "Recovery copy saved at …"); a start opens the agent's new thread behind it. When the
  person opened another act's dialog meanwhile, the result reaches them through bb's toaster, with
  **Open <agent>**.
- **A refusal** leads with a person's words, the kernel's code after them, and the kernel's own
  message under **Details**. What to do next is a button: **Review again** reads a new plan (also
  when the plan changed under the confirmation: it comes back as it is now, with what changed
  said first, and cannot be confirmed until it was reviewed again), **Check again** asks
  for the answer to what was already sent (same revision, same key: an answer that was lost reads
  "Result not confirmed", never "nothing happened"), **Refresh status** reads the agent again
  before another start. A plan refused for a name the kernel does not know (`E_SESSION_UNKNOWN`,
  on a stop or a retire plan and nowhere else) says that the agent is not in OATS any more.
- **On a roster that is the last one read** (OATS cannot be read) the acts stay where they are,
  off, with when they come back.

bb's own composer Stop, Archive and Delete cannot be hidden by a plugin, and the plugin never acts
on its own when one of them is used: an agent whose thread was archived or deleted in bb stays in
the roster, as a row that says "its bb thread is gone" and opens the agent's own page, and its
soul's page says "thread missing", with Start and Retire. Nothing is retired because a thread was
deleted. A thread stopped in bb alone is not stopped for OATS: stop an agent with the OATS act, so
that it stays stopped.

How it is built: `kernel/lifecycle.ts` reads a plan and a receipt into typed facts (nothing is
worded there), `app/lifecycle/words.ts` makes the sentences from them (the Desktop's, with the
commit they were copied at in its header), `app/lifecycle/acts.tsx` draws the two dialogs on the
`Confirm` pattern, and `app/lifecycle/index.tsx` registers the ways in. Another feature opens a
dialog with `openAct(verb, instance)`, and can place the acts of one agent as buttons ("Stop…",
"Start…", "Restart…", "Retire…": the ones that apply, for an agent with no bb thread too) with
`<AgentActs instance={…} />` (`app/lifecycle/index.tsx`). No place draws `AgentActs` yet: the
instance panel and the agent's own page take it in their own change.

## The instance panel

On an agent's own thread, the **OATS** tab of bb's side panel is that agent's panel, as the OATS
Desktop's instance panel: who the agent is and how it runs. On any other thread the tab is the
home. On a phone, where bb has no side panel, and for an agent with no bb thread, the same panel is
a page of its own, `/plugins/oats/agent/<instance>`, with the way back.

| Tab | Shows |
|---|---|
| **Instance** | the soul's mark and the instance's name as words, its state on the status line every place shares: the same word as its row and its thread ("Working · session started 14:03", "Needs you · waiting 12 min (since 14:03)", "Stopped", "Idle", "Failed · Its session ended", "Unreachable · OATS cannot reach its session"; for an unreachable agent what OATS itself says is one press away, under Details), and "instance of <soul>" (it opens the Soul tab). An **older build** chip when its soul or one of its capabilities moved since the spawn; it opens to what moved. **Needs input**, while the agent waits on a person: the reason in words and its message (how long it waits is the status line's to say, once). **Work**: the work mode in one sentence, with **Paths** (the folder and the home, each with its Copy; "shared" where the folder is a link to a tree other instances use). **Session**: the harness, the model and where the choice came from, where the session runs ("bb thread", and the thread's id on a line of its own), since when it was started ("Last started" for an agent that does not run), and what OATS says of the session when it has something to say and the status line has not said it. **Messaging & Teams**: the messaging id, with its Copy. **Lineage**: the owning human, and the parent, the sibling and the children, each by its name as words and a link when it has a thread in bb. |
| **Soul** | the soul's mark, key and description, and under them **Open soul page** (off, with the reason beside it, for a soul OATS does not list); the soul **as this instance was spawned from it**: where it was spawned from (soul and commit), its **Core capabilities** (Knowledge, Messaging, Tasks: what fills each and why), its **Capabilities** with the source of each and why it is there (a default, the soul's own, turned off by the soul), the capability **Warnings**; **Soul readiness**; **Details** (the agents root, with its Copy). |

The Instance tab ends with two more sections. **Instance readiness** (`oats readiness`): one line
that says whether it is ready, then, behind "Checks and policy", the four checks (Installed,
Configured, Member, Providers) with their items, what a provider itself answers, and the policy
(child spawns, worktrees); **Refresh readiness** reads it again. These are the kernel's
observations, never launch permission. **Reported lifecycle activity** (`oats instance events`):
nothing is read until **Load activity** is pressed; then the last event and what is reported of
waiting, and behind "Recent lifecycle events" each recorded row, newest first, with its time, its
producer and its recorded facts (Spawned, Launched, Restarted, Stopped, Waiting claim, …); a
launch that was blocked at a prompt also shows where its screen first differed from the
confirmation OATS answers (what OATS expected and what the terminal showed, each under whose text it
is). **Refresh activity** reads it again. It is the history of the instance's address as the kernel
recorded it, not its current state. When the tab is left and come back to, what was read is shown
again as the last observation ("Last observation retained; refresh required."), and nothing is read
until Refresh activity.

A read that is refused says why in a person's words (`app/panel/refusal-words.ts`: the Desktop's
sentence where it says what happened, "The readiness read timed out."; the plugin's own where the
Desktop's is an instruction nobody can follow from here, "OATS knows more than one agent by this
name here, …"; and "OATS refused to read …" for a refusal with no sentence), then the code, with the
kernel's message under Details. It then says what to do next, and offers Retry only where reading
again can change the answer (a slow or failed `oats`, not an agent OATS no longer lists): there the
notice's Retry is the one act, and the section's own Refresh is not drawn beside it. For a refusal
that reading again cannot change as things are, the notice offers none, and the part keeps its own
way to read again for whoever mended it (Refresh readiness, Refresh activity, Read the soul again). A read again
that fails keeps what was read under the same titled notice ("Readiness could not be read again"),
which says once how old what is shown is, always relative ("Showing what was read 12 min ago.").
When OATS itself cannot be read, the panel says it in the words the sidebar and the thread's row
say it (`app/roster/unreadable.tsx`: `Unreadable` whole where nothing was ever read, `failureWords`
in the same notice over what was read).

Who the agent is and where it is (the soul's mark, its name, the status line, "instance of", the
older-build fold) stands over the tabs and does not scroll: a page scrolled to its activity, at any
width, still names the agent and its state.

The header's claim is the roster's, and the activity is read at another moment (on Load activity).
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
retire), `automations` and `panel` (the instance panel). Each has one module, or one directory, in
every layer, and the entry of a layer only composes them:

| Layer | A feature's own | Composed by | Shared by all |
|---|---|---|---|
| contract | `contract/<feature>.ts`: its schemas, `rpc` (app to server) and `host` (server to host) | `contract/index.ts` | `contract/shared.ts` |
| server | `server/<feature>.ts`: `handlers(core)`, one per verb of its `rpc` | `server.ts` | `server/core.ts` |
| host | `host/<feature>.ts`: `handlers(core)`, one per verb of its `host` | `host.ts` | `host/core.ts` |
| kernel | `kernel/<feature>.ts` (and `kernel/<feature>-*.ts`): `verbs(oats)`, the argv and the parser of each command | `kernel/index.ts` | `kernel/runner.ts`, `run.ts`, `envelope.ts`, `input.ts`, `result.ts`, `task-file.ts` |
| app | `app/<feature>/`: its components, and `register(app)` in its `index` | `app.tsx` | `app/ui.tsx`, `app/ui/`, `app/oats.ts`, `app/store.ts`, `app/format.ts`, `app/keys.ts` |
| model | `model/<feature>.ts` for types and pure functions of its own | | `model/types.ts`, `model/view.ts` |
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
| something to open and read ("Details", "Paths") | `Disclosure` | closed until pressed; its summary as high as a control |
| a kernel's own word in a sentence | `Code` | a code, a flag, a file's name, filtered |
| a state | `State`, `StateMark` | pass the `state`, not a word: the mark AND the word (`STATE` in `app/ui/words.ts`; the screens that are not on the patterns yet still print `agentStatus().word` and `Dot`, the older `STATE_WORD`, until the roster's piece moves them); the Desktop's "!" for an agent that waits; a mark that stands alone carries the accessible name |
| where an agent is | `StatusLine` | the state, since when, the question or the reason, the act that applies |
| a state that is not an agent's | `Toned` | a dot (ok, warn, bad, muted) AND its words |
| a fact | `Facts`, `Fact` | `label · value`, the label muted, the value whole; a fact with no value is left out; `LINK` is a link's look |
| a titled block of a page | `Section` | its heading, with a count where it lists things |
| failed, stale, not configured, cannot show | `Notice` | a title in a person's words, sentences, the age of what is still shown, the code after the words, the acts that help |
| nothing to list; a read in flight | `Empty`, `Loading` | the Desktop's sentence and the act that fills it; "Reading …", announced |
| content read earlier | `Stale` | its age, why the unsafe acts are held, a re-read in flight |
| an act on an agent | `Confirm` | the act and the agent in the title, what will happen, what is kept, the button named for the act, the act in progress and its result in the same dialog (done, refused, or not confirmed, with the code after the words); while the kernel is asked, the line of the place that asks ("Checking instance…"); it shows no plan that is another agent's |
| what happened | `Result` | done, failed or not known, in words, with the code after and the next step |
| what happened, once the person has moved on | `notify` | a result or a failure through bb's own toaster (`sonner`, which bb shims for plugins: a type-only devDependency at bb's version, no Toaster of the plugin's), with "Open <agent>"; a failure stays until dismissed; `notified()` is what a slot test reads |
| a form | `Field`, `INPUT`, `DisabledReason` | the label (with "· optional"), a hint, the refusal; why a button is off |
| tabs, a filter, a search, a switch, a row's menu, a copy | `Tabs`, `Segmented`, `SearchField`, `Switch`, `Menu`, `CopyButton` | the WAI-ARIA pattern of each, with its keys |
| the rest | `Button`, `Card`, `Chip`, `Heading`, `Page`, `Modal`, `Mark`, `ErrorLine`, `Lines` | `Modal` takes the focus (on `data-autofocus`), keeps it, and returns it to what opened it, or where `returnFocus` says |

A control is 32 px high, and 44 px at bb's compact width (`TARGET`).

### Text from OATS or an agent

Everything the plugin draws that OATS or an agent wrote (a name, a description, a message, a
refusal) goes through one display filter, `app/ui/text.ts`: the OATS Desktop's
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
  name must match `^[a-z0-9][a-z0-9-]{0,62}$` and is one argv element; a task travels as a 0600
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
- **A start begins a new conversation.** A Start, and a Restart, always make a NEW bb thread; the
  launch stops and archives the one the agent had (the bb session provider's
  `oats-package/capabilities/oats-bb/lib/launch.mjs`). Both dialogs
  say so before the act ("Starts a new conversation. The current one stays readable in bb,
  archived."), and the result opens the new thread. For an agent that was cut off the Start
  and the Restart dialog say first that a message in its thread carries its conversation on, with a button to
  that thread; the act stays possible. Cut off is two facts, both read: the kernel's row says the
  agent does not run and that no operator stopped it (a session lost with the host or with its
  harness: `running: false`, `sessionEnd: "lost"`; or a thread at rest with no harness loaded:
  `running: false` with a runtime state that is not `stopped`), and bb has its thread in the sidebar and not in error. An operator's stop never
  gets the line. The sentence under "What will happen" is decided once, when the check answers:
  the launch archives the old thread while it runs.
- **Spawn.** The kernel takes an idempotency key only with the decision it confirms
  (`--expect-decision`), so Spawn reads the kernel's preview and applies exactly that decision with
  the key; asked again with the same key, it replays the same spawn. A spawn or a retire that runs
  capability hooks can take minutes: if the client stops waiting, the act still finishes and the
  tree shows it.
- **Freshness.** The server keeps one snapshot (`oats status --json`). It rereads on the host
  entry's `changed` signal (a watch on `<deployment>/.agents/events`, where the kernel appends one
  line per spawn, launch, stop, retire and waiting claim, set or cleared), after each of the
  plugin's own acts, on bb's thread created and deleted events, and every 15 s while a client
  watches the snapshot: never two reads at once, a pause between two reads of 1 s or of the time
  the last one took to answer, whichever is longer (after a read that failed, 1 s), 20 s limit. A status that hangs is ended at its limit before the
  next starts: under any burst of events one `oats status` is alive at a time. So a change the watch reports is on screen
  within 3 s on a kernel that answers well under a second (a change that lands just after a read
  started waits that read, the pause and the next read), and a slow kernel spends at most half its
  time on status (the first spec's "never within 5 s of the last" gave way to this). Each
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

App, hooks and components: `experimental_useSidebarThreads`, `experimental_useRpcQuery` (the
watched reads), `experimental_useAppPanel` (`openTab`), `experimental_useTabVisible`,
`experimental_usePluginId`, `experimental_THREAD_ACTION_GROUPS`,
`experimental_ThreadActionsContextMenu`, `experimental_ThreadStatusGlyph`,
`experimental_resolveThreadStatus`, `useBbNavigate().experimental_openFilePreview` (Automations'
Open file: a file of the machine that holds the deployment, in bb's own preview).

App tests: `renderSlot`'s `experimental_panel`, and its `inspection.experimental_panelCalls`.

Not experimental, but bb's to change: the thread rows' `data-sidebar-thread-shortcut-target` and
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
```

`plugin/container/README.md` says what each script does and how to keep a container for a session
of work. The unit tests run `kernel/`, `host.ts` and `server.ts` against a fake `oats`
(`container/fake-oats.mjs`) that prints the recorded answers in `test/fixtures/`; the live tests
run bb-app at the pinned version with the plugin installed from the checkout and the same fake.
CI runs the same command: `.github/workflows/plugin.yml`.

The fake is checked against the real thing by a run of its own: `plugin/container/real/run.sh`
puts bb-app, a real OATS kernel, the bb session provider and Claude Code on a mock model in one
container, drives the plugin through its RPC (spawn, stop, start, restart, retire, and the
refusals), and records what the kernel printed; `test/fixtures/README.md` says which fixtures are
those recordings, and at which versions. It is the last stage of `ci.sh`, so CI runs it too
(`plugin/container/real/README.md`).

The bb version the tests run is the repository's pin: the one line of `bb-version` at the
repository's root where that file exists, else `devDependencies["bb-app"]` in `package.json`. The
two are kept equal, and `engines.bb` contains it.

`contract/`, `model/types.ts` and `test/fixtures/roster/status.json` and `threads.json` are pinned by
the spec: a change to them is agreed with the spec's author first.
