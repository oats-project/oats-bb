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

When something is missing, bb stays fully usable: its threads are listed as usual, and the plugin
shows one line that says what is missing. The line's code:

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

## Stopping an agent

Stop an OATS agent with **Stop agent (OATS)** in the thread's menu: it stops the agent through
OATS (the kernel's plan, then one confirmation), so a stopped agent stays stopped. bb's own
composer Stop, Archive and Delete cannot be hidden by a plugin, and the plugin never acts on its
own when one of them is used: an agent whose thread was archived or deleted in bb leaves the tree
and shows on its soul's page as "thread missing", with Start and Retire. Nothing is retired because
a thread was deleted.

## The instance panel

On an agent's own thread, the **OATS** tab of bb's side panel is that agent's panel, as the OATS
Desktop's instance panel: who the agent is and how it runs. On any other thread the tab is the
home. On a phone, where bb has no side panel, and for an agent with no bb thread, the same panel is
a page of its own, `/plugins/oats/agent/<instance>`, with the way back.

| Tab | Shows |
|---|---|
| **Instance** | the instance's name as words, its state as a mark and its word with since when ("Working · 42m" since its last start, "Needs you · waiting 12 min (since 14:03)", "Stopped", "Idle"), and "instance of <soul>" (it opens the Soul tab). An **older build** chip when its soul or one of its capabilities moved since the spawn; it opens to what moved. **Needs input**, while the agent waits on a person: the reason in words, how long and since when, and its message. **Work**: the work mode in one sentence, with **Paths** (the folder and the home, each with its Copy; "shared" where the folder is a link to a tree other instances use). **Session**: the harness, the model and where the choice came from, where the session runs (`bb · thread <id>`), since when, and the kernel's runtime error when it has one. **Messaging & Teams**: the messaging id, with its Copy. **Lineage**: the owning human, the parent and the sibling, each a link when it has a thread in bb. |
| **Soul** | the soul's key and description, **Details** (the agents root, with its Copy) and **Open soul page**. |

A fact the kernel does not report is not drawn: the panel never says "Not reported" and never
guesses. The words are the Desktop's (`app/panel/words.ts` and `app/ui/words.ts` name where each
comes from), and it is drawn with the patterns of `app/ui.tsx`. The
Developer tab, the board, the mail, the teams, the recorded events and the readiness are not in
this version yet.

How it reads: `panelInstance` (`contract/panel.ts`) answers one instance's facts from what the one
status read kept, as the kernel printed it (`core.rowOf`: the instance's row, its agent group's row
and the roster's root), parsed by `kernel/panel-instance.ts`. It starts no process. The panel reads
again at every `oats/changed`; when a read fails it keeps what it read and says how old that is,
with Retry; a first read that fails is a notice in words, the kernel's code after them and its
message under Details. Another feature opens the panel on one of its tabs with
`showPanelTab(tab)` and the page with `openAgentPage(navigate, instance)` (`app/panel/index.ts`).

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
retire), `automations` (registered and empty until its piece lands) and `panel` (the instance
panel). Each has one module, or one directory, in every layer, and the entry of a layer
only composes them:

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
  says a state in words (the tree, the line under a thread's header, the instance panel); today the
  home's card reads its age from it, and the tree draws its dot from the same state.
- **One tab on a thread.** bb gives the plugin one fixed tab on a thread, the home's. A feature
  with a view of one agent (the instance panel) names its component with `setAgentTab`
  (`app/home/agent-tab.ts`) in its `register`: the tab shows it on that agent's thread, and the home
  on every other. `openSoul(navigate, key)` (`app/workspace/pages.ts`) opens one soul's page.
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
| a state | `State`, `StateMark` | the mark AND the word (`STATE` in `app/ui/words.ts`); the Desktop's "!" for an agent that waits; a mark that stands alone carries the accessible name |
| where an agent is | `StatusLine` | the state, since when, the question or the reason, the act that applies |
| a state that is not an agent's | `Toned` | a dot (ok, warn, bad, muted) AND its words |
| a fact | `Facts`, `Fact` | `label · value`, the label muted, the value whole; a fact with no value is left out; `LINK` is a link's look |
| a titled block of a page | `Section` | its heading, with a count where it lists things |
| failed, stale, not configured, cannot show | `Notice` | a title in a person's words, sentences, the age of what is still shown, the code after the words, the acts that help |
| nothing to list; a read in flight | `Empty`, `Loading` | the Desktop's sentence and the act that fills it; "Reading …", announced |
| content read earlier | `Stale` | its age, why the unsafe acts are held, a re-read in flight |
| an act on an agent | `Confirm` | the act and the agent in the title, what will happen, what is kept, the button named for the act, the act in progress and its result in the same dialog; it shows no plan that is another agent's |
| what happened | `Result` | done, failed or not known, in words, with the code after and the next step |
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
- **Spawn.** The kernel takes an idempotency key only with the decision it confirms
  (`--expect-decision`), so Spawn reads the kernel's preview and applies exactly that decision with
  the key; asked again with the same key, it replays the same spawn. A spawn or a retire that runs
  capability hooks can take minutes: if the client stops waiting, the act still finishes and the
  tree shows it.
- **Freshness.** The server keeps one snapshot (`oats status --json`). It rereads on the host
  entry's `changed` signal (a watch on `<deployment>/.agents/events`, where the kernel appends one
  line per spawn, launch, stop, retire and waiting claim, set or cleared), after each of the
  plugin's own acts, on bb's thread created and deleted events, and every 15 s while a client
  watches the snapshot: never two reads at once, never within 5 s of the last, 20 s limit. Each
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
thread tab), `experimental_threadAction`, `experimental_appOverlay` (draws the plan dialogs of Stop
and Retire and the progress and failure of Start and Restart, which a thread action has no place
to draw), and on `navPanel`:
`experimental_useBadge`, `experimental_hideFromNavigation`.

App, hooks and components: `experimental_useSidebarThreads`, `experimental_useRpcQuery` (the
watched reads), `experimental_useAppPanel` (`openTab`), `experimental_useTabVisible`,
`experimental_usePluginId`, `experimental_THREAD_ACTION_GROUPS`,
`experimental_ThreadActionsContextMenu`, `experimental_ThreadStatusGlyph`,
`experimental_resolveThreadStatus`.

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
