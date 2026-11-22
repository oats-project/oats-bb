# oats-bb

Official [OATS](https://github.com/oats-project/oats) package for
[bb](https://www.npmjs.com/package/bb-app): the bb session provider and plugin, which let OATS
agents run as bb threads beside the kernel's tmux backend.

The latest release is 0.3.0 ([CHANGELOG.md](CHANGELOG.md)): pi agents run on bb beside Claude Code agents, and the plugin shows the Desktop's agent panel and Automations. The work arrives as reviewed pull
requests, and it follows the OATS session-provider contract as decided on the OATS side. The lane map
records how work lands here: <https://github.com/oats-project/oats/issues/1566>.

The repository holds the three parts of the integration, at one pinned bb-app version (the
`bb-version` file):

- **The session provider** (`oats-package/`, the OATS capability `oats.bb`): runs an OATS
  instance as one bb thread instead of a tmux session. This README is about it.
- **The OATS plugin for bb** (`plugin/`): shows OATS agents in bb's UI and acts on them
  through OATS. Its README is there.
- **The team image for bb** (`container/`): an OATS team image with `bb-app` in it, at the
  version in `bb-version`, and pi for bb's pi threads. Its README is there.

## The session provider

`oats.bb` declares `sessionProviders.bb`, and the kernel calls its commands (launch,
inspect, input, stop, and a readiness check) wherever it would have driven tmux. tmux
stays the default; nothing changes for a home that does not ask for `--backend bb`.

- One OATS home is one bb project rooted at the home, with one live thread in it.
- Claude Code and pi (`harnesses: ["claude", "pi"]`). Codex is not supported. What is
  particular to pi is in [pi](#pi).
- bb is driven through its public CLI (`bb project …`, `bb thread …`). Readiness also
  reads three of bb's HTTP addresses on loopback: the server's `/health`, the host
  daemon's `/status`, and the server's `/api/v1/system/providers/state` (bb's CLI has no
  command for a provider's sign-in state). [docs/wire.md](docs/wire.md) lists the whole
  surface, and what the provider and the kernel say to each other.
- There is no terminal. `oats session attach` refuses with a link, and a client shows
  **Open in bb**.

> **What it needs.**
>
> - OATS 0.70.5 or later (the manifests' `compatibility.oats` floor; **PLACEHOLDER(A16):
>   the number is set before this is released**): the first OATS release whose host
>   shutdown says so in its stop (`reason: "host"`), so that a home stopped with the host
>   is not archived and is resumed ([Stops](#stops)). The provider's wire, version 1.3
>   (see [docs/wire.md](docs/wire.md)), and the kernel's protection of a provider home's
>   own files from its agent are in OATS since 0.70.0.
> - For a bb home with aweb messaging, oats.aweb 1.48.0 or later. That release requires
>   the channel packages of `tmux` launches only, holds an installed `aweb-channel` or
>   `@awebai/pi` to versions that don't open their own stream beside the wake broker's on a
>   provider launch, and removes a provider home's broker registration at retire. 1.45.0
>   is the first version whose spawn hook runs for a bb home at all (an older oats.aweb
>   fails there), and 1.45.0 to 1.47.0 leave those gaps.
> - For pi agents: pi and @awebai/oats-pi in the pi configuration bb's server runs with
>   ([pi](#pi)).
>
> **bb agents run in full mode (`--yolo`), and nothing else is launched.** A launch in
> one of bb's sandboxed modes (`auto`, `accept-edits`; that is `--no-yolo`, or no choice)
> is **refused** before anything starts (`E_BACKEND_SANDBOXED_MODE`). `oats readiness` and
> `oats bb doctor` say, as a warning on every read, that the backend launches in full mode
> only (they are not told which mode a launch would run in); the kernel's check before a
> spawn or a start, which carries the planned launch, names the refusal itself. Why: bb's
> sandboxed modes limit accidents, not a determined agent. bb lets a command ask to run
> outside the sandbox, and one that does writes past every rule this provider can write.
> Full mode claims no boundary, so nothing is promised that is not kept. This README
> says what the provider does in a sandboxed mode (the allowances, and the rules that keep
> a sandboxed agent's tools off what runs outside the sandbox), because that code is here
> and tested against the pinned bb; it runs for no launch until OATS decides to offer
> those modes.
>
> **Released after a real run.** Each release is cut after the plugin's real run in CI,
> against OATS 0.70.0 from npm with `--backend bb`. The pi support is also run against
> the real bb and pi with OATS 0.70.3 (`test/contract/pi.test.mjs`). bb homes run in bb's full mode, and
> claim no sandbox boundary.

## Install

1. Install bb-app and Claude Code for the user that runs OATS, and start bb **on
   loopback** (its default):

   ```sh
   npm install -g bb-app@0.50.1 @anthropic-ai/claude-code     # the version in bb-version
   bb-app --server-bind-host 127.0.0.1 --no-in-app-updates
   ```

   `--no-in-app-updates` keeps bb at the version you pinned. Sign Claude Code in as that
   user (`claude auth login`), or give the bb server the credential in its own environment.

2. Pin the package in the workspace file and give the capability to the souls that may run
   on bb:

   ```yaml
   # oats-workspace.yaml
   packages:
     oats.bb: git:github.com/oats-project/oats-bb@v0.3.0
   defaults:
     capabilities:
       oats.bb: { from: package }
   ```

   Then `oats sync`.

3. Set the host's facts in the deployment's `oats-local.yaml` (below): at least `trust`.

4. Check it, then spawn:

   ```sh
   oats bb doctor --soul <soul>         # or: oats readiness --soul <soul>
   oats spawn <soul> --backend bb --harness claude --yolo --name <task>-<role>
   ```

   `--yolo` is bb's full mode, the only one a launch is taken in (above).

## Settings

All under `settings.oats.bb` in `oats-local.yaml`. `server`, `daemon`, `trust`, `cli`,
`dataDir` and `piAgentDir` are host-only: a committed workspace or soul file cannot set them, because they choose an
executable, an endpoint that runs commands, and a statement about this machine.

```yaml
settings:
  oats.bb:
    trust: single-user       # required: single-user | container
    version: 0.50.1          # the default of this release
```

| Setting | Default | Meaning |
|---|---|---|
| `version` | the version in `bb-version` | The bb-app version this deployment runs, exactly as `bb --version` prints it. The default is the one version this release of the provider is contract-tested against. Another version is refused at readiness and at every launch: `E_BACKEND_VERSION`. |
| `trust` | none (required) | Who can reach bb's port: `single-user` or `container` (see [the trust group](#the-trust-group)). Unset or anything else: `E_BACKEND_TRUST`. |
| `server` | `http://127.0.0.1:38886` | The bb server. A loopback address only. |
| `daemon` | `http://127.0.0.1:38887` | The bb host daemon. A loopback address only. |
| `cli` | `bb` | The bb CLI: a command on `PATH`, or an absolute path. |
| `dataDir` | `.bb` in the home of the user that runs bb | bb's data directory on this host (bb-app's `--data-dir`), an absolute path. Read only for a launch in a sandboxed mode, which keeps the agent's tools off bb's thread storage there (see "What a sandboxed agent cannot change", below). |
| `piAgentDir` | `.pi/agent` in the home of the user that runs bb | The pi configuration directory bb's server runs pi with: pi's `PI_CODING_AGENT_DIR` as the bb server's own environment has it. bb does not say where it is, so this setting does; it is host-only, set in `oats-local.yaml`. It must be an absolute path: any other value is refused by every launch and every readiness read (`E_BACKEND_SETTINGS`). The directory is read only for a pi launch and its readiness. What readiness reads is the directory itself (the `packages` of its `settings.json`), never whether the setting is there: a setting that names another directory than the one bb's server uses checks the wrong one (see [pi](#pi)). |

The capability declares no host requirement for `bb`: a soul that has it may run on tmux on
a host with no bb at all, and `cli` may point off `PATH`. Readiness is what checks the CLI
(`E_BACKEND_VERSION` when it cannot be run).

## What the kernel gets

| Call | What the provider does |
|---|---|
| launch | Runs the readiness checks. Finds or creates the bb project rooted exactly at the home. Refuses if another live thread runs there. Stops and archives the home's previous thread (a start after a stop is a fresh conversation), and stops the home's archived threads: bb keeps an archived thread's Claude process, in the home, until it is stopped. Writes the launch environment, and in a sandboxed mode the sandbox entries, into `<home>/.claude/settings.local.json` (mode 0600); for a pi launch, the three variables into the env of the home's bb project instead ([pi](#pi)). Runs `bb thread spawn --provider claude-code` (or `--provider pi`) `--environment <home> --prompt-file <home>/TASK.md --title <the instance's name as words>` ("The thread's title", below). Answers `{server, projectId, threadId}`. |
| inspect | One `bb thread list`. Maps bb's status (table below). For a thread in `error` or at rest (idle, pending), also looks at this host's processes for the thread's harness: whether it lives, and whether it works in the home. A second live thread in the home is `E_SESSION_UNAVAILABLE`, naming both. A bb that does not answer is an error, never "stopped". |
| input | Reads the thread's pending interactions; while one is open, refuses with `E_SESSION_PROMPT_OPEN` and sends nothing. Otherwise `bb thread tell`. Only bb's `sent` is a submission. A `queued` tell is withdrawn (`bb thread queue delete`) and answered `E_SESSION_INPUT_QUEUED`, whatever the delete says: where the copy could not be withdrawn the message may arrive anyway, and the mail that carried it stays unread, so the agent may see it twice and never loses it. |
| stop | Withdraws what bb holds in line for the thread (a turn bb's concurrency limit has not started yet: bb would start it by itself later), then `bb thread stop`, then waits until bb shows the thread settled, for the grace the kernel gives, counted from the moment `bb thread stop` answered. Stopped means settled AND nothing left in line; still in a turn after the grace, or a held turn that could not be withdrawn: `E_SESSION_STOP_FAILED`. A thread archived in bb is stopped like any other. Then archives the thread (`bb thread archive`): bb starts a stopped thread's agent again at the next message to it and refuses every message to an archived one, so an agent OATS stopped stays stopped ("Stops", below). An archive bb refuses fails no stop: `stopped`, and a warning on the command's standard error that names the thread. |
| retire (hook) | For each of the home's live threads: withdraws what bb holds in line for it, stops it, and archives it once the stop is confirmed (a thread it could not stop is left, and named in a warning). Then stops the home's threads that were archived before, and removes the env of the home's bb project (what a pi launch wrote there). It asks bb for every home that has the capability: the home is its agent's to write, so nothing in it proves there is no thread. |
| stop (no endpoint) | Finds the home's bb project and stops every live thread that runs in the home, and its archived threads: the kernel's cleanup after a launch whose answer was lost, or whose caller was killed while it ran. `stopped` also when there is none; `E_SESSION_STOP_FAILED` when bb's lists cannot be read. A thread bb made at or after the time the kernel says the failed launch was sent (`launchSent`) is taken to be that launch's, and is archived once stopped, so no message in bb starts it again and the next start launches (if bb does not archive it, the stop warns on its standard error and the next launch names it). That includes a thread a person started in the home after that time: it stays in bb, archived. An older thread, or any thread when the kernel gives no time, may be a person's: it is stopped and stays in bb, and the next launch names it until it is archived (in bb, or by the retire). |

| bb thread | present | state | running |
|---|---|---|---|
| starting, active, stopping | true | unknown | true |
| pending, idle, and the home's own harness process is at work in the home | true | unknown | true |
| pending, idle, and it is not (a thread `bb thread stop` released reads `idle` too) | true | unknown | false |
| pending, idle, on a host whose processes cannot be read (macOS: no `/proc`) | true | unknown | null |
| pending, idle or error, with a turn bb holds in line (its concurrency limit) | true | unknown | true |
| error, and the thread's harness process (pi, claude) is still loaded on this host | true | unknown | true where it works in the home, false where it works elsewhere |
| error, and its harness process is gone (whatever else the agent left running) | false | stopped | false |
| missing, deleted or archived | false | stopped | false |

**A known limit: many archived threads.** Every start archives the home's previous
thread, and bb keeps an archived thread's Claude process until the thread is stopped, so
a stop, a retire and a launch stop the home's archived threads (several at a time). A bb
project that holds more of them than fit the command's time (about a hundred to a few
hundred, by the machine's processors and by the command) makes the stop fail, and it says so: how many were stopped, of how
many, and the remedy. Remove old archived threads of that project in bb: for each,
`bb thread stop <id>`, then `bb thread delete --yes <id>`.

> **A known limit: a retired agent whose home was kept can be started again from bb.**
> A retired agent whose home was kept (`oats retire --keep-dir`, or a retire that ended
> quarantined) can be started again from bb: its archived thread can be unarchived in bb,
> and a message then starts the harness in the kept home with NO OATS around it: no
> status row, no hooks OATS runs for it, no stop by OATS. Where its aweb identity was not
> released (a team leave waiting for its controller, a retained seat, an alias held), it
> can send mail as the retired agent. Retire bb agents the ordinary way, which removes
> the home: then nothing can start.

bb has no "stopped" status: a stopped thread reads `idle`, like one that finished its
turn. The kernel records its own stop and answers "stopped" itself, and the provider's
stop archives the thread, so the provider reads it missing from then on.

So whether a thread at rest runs is read from this host's processes, not from bb's word:
`running` is true where the home's own harness is at work, which is one process named
`pi` or `claude` that carries the thread's id and has the home as its working directory,
and false where there is none. A process that merely carries the thread's id, or a
harness at work in another directory, never counts. This is how OATS tells a home
stopped with the host (its thread left live, its harness gone) from one whose harness
came back. The harness is known by its name: a `pi` or a `claude` the agent itself
started in its home and left running detached reads as the thread's harness. On a host
without `/proc` (macOS) the provider cannot look, and answers
`running: null`: there OATS cannot see a harness started again from bb in a home it holds
stopped, a home stopped with the host that already runs gets one more turn (its resume
notice), and what keeps a stopped agent stopped is the stop's archive.

bb says `error` of a thread whose last turn failed (the model endpoint refused it, for
one) and of one whose agent is gone, and they are not the same for OATS. After a failed
turn bb keeps the thread's agent process loaded in the home (seen for pi and for Claude,
at the pinned bb), and the next input starts a turn and brings the thread back to `idle`:
that thread is there and at rest. Read as a lost session, the kernel would try to resume
it beside the process that is still there, and refuses to. So the provider decides at
every inspect, from the processes of this host and never from bb's word alone: a thread
in `error` is there while its harness process lives, and a lost session once it does not,
which the kernel may resume with an input. The harness is the process that carries the
thread's id (bb gives a thread's harness, and what it starts, `BB_THREAD_ID`) and is
named `pi`, for a thread of bb's pi provider, or `claude`, for one of its claude-code
provider. A command the agent started and left running (a dev server, a `sleep`)
carries the id too and is not the harness: alone, it does not keep the thread there, so
every input to a thread whose harness died is a resume the kernel counts. Two limits.
The harness is known by its name: a `pi` or a `claude` that the agent itself started and
left running, with the id it inherited, counts as the thread's harness. And the kernel
has a rule of its own: it resumes no lost session while any process still works in the
home, and names the process. So a command the agent left running whose working
directory is in the home keeps the home from being resumed: end that process, or start
the home again (`oats session start`). What failed is the harness's to report (a "Turn failed"
needs-input claim), not this table's. The provider reads a process's environment from
Linux's `/proc`, as the user bb runs as. On a host without it (macOS) it cannot tell, and
a thread in `error` is then answered `E_SESSION_UNAVAILABLE`, never a guess. While the
thread stays in `error` there, OATS cannot act on the home: `oats session start` and
`oats session input` refuse, because whether the home runs cannot be established. The
route back is bb's own: send the thread a message in bb (`bb thread tell <thread id>
<text>`, or in its UI), which starts a turn and brings it back to `idle`; OATS reads it
again from then. A look that works on macOS is
[oats-bb#22](https://github.com/oats-project/oats-bb/issues/22).

**An input to a thread in `error` whose process is gone is told, like any other**
(contract r23, A14): bb answers sent, starts the harness again in the same conversation
and runs the turn once, for pi and for Claude (pinned by the contract tests at the
pinned bb: a bb that stops doing so fails them). The provider refuses nothing there.
Since such a home reads as a lost session, the kernel takes that input for its resume
and counts it against the home's resume cap before it calls the provider; at the cap
the kernel refuses, and nothing is sent. An input to a thread in `error` whose process
lives is no resume, and is not counted.

**The thread's title.** A home's thread is titled with the instance's name as words, the
form the OATS Desktop and the OATS plugin for bb draw, so bb's header and thread list show
the same name: every run of `-` is one space, the ends are trimmed, and only the first
character is upper-cased (`release-070-maintainer` is "Release 070 maintainer"). The
home's bb project keeps the name itself: it identifies the home. The provider gives the
title once, at the spawn, so at every start and restart (each is a new thread), and never
sets it again. At the pinned bb that holds: bb writes a title of its own only for a
thread that has none, and replaces none, across turns and a restart of bb
(`test/contract/title.test.mjs`). A known limit: a rename in bb stays until the next
start. A person who renames the thread in bb or has bb write a title
(`bb thread regenerate-title`), or an agent that runs those commands on its own thread,
changes what bb shows, and the provider does not put the name back until the instance
starts again.

**Permission mode.**

| The launch | bb's mode | |
|---|---|---|
| `--yolo` | `full` | launched |
| `--no-yolo`, or no choice | `accept-edits` | refused (not offered): `E_BACKEND_SANDBOXED_MODE` |
| a launch configuration's argument `--permission-mode auto` | `auto` | refused |
| `--permission-mode acceptEdits` | `accept-edits` | refused |
| `--permission-mode bypassPermissions` | `full` | launched |

Where yolo and the argument disagree (`--yolo` with a mode other than
`bypassPermissions`; `--no-yolo` with `bypassPermissions`), the launch is refused
(`E_BACKEND_LAUNCH_ARG`): the provider never picks one.

**The sandbox** (what a launch in a sandboxed mode does; no launch is taken in one today, above). In bb's sandboxed modes (`auto`, `accept-edits`), bb's sandbox applies to
the agent's commands: by itself, `aw` could not reach the aweb server and
`oats instance attention` could not write the deployment's events file. So in those modes
the launch adds, to the home's `.claude/settings.local.json`, exactly the entries the kernel
hands it:

- `sandbox.network.allowedDomains`: the hosts of the home's own messaging, knowledge and
  tasks providers, each taken from that provider's recorded settings;
- `sandbox.filesystem.allowWrite`: the deployment's events directory.

Nothing else is added, and nothing an agent, a task, a mail or a launch argument says can
add one. The provider keeps no record of them in the home (the home is its agent's to
write): the `sandbox` key is rewritten whole at every launch (see "What a sandboxed agent
cannot change", below). In `full` mode there is no sandbox and the key is removed.
The kernel's check before a launch lists each host and path that launch would add, with
who asked for it.

Two limits of bb's sandbox that no entry lifts. A service on this machine (an aweb server
on `localhost` or a loopback address) cannot be reached from a sandboxed mode: run the
agent in `full` mode, or give the service an address that is not loopback. And the two
modes differ in what a host outside the list does: in `auto` the command is refused, in
`accept-edits` it raises a prompt for a person in bb.

Where the deployment has no value for something a provider's line names (the agent's
default team, when its aweb service was never recorded), a launch in a sandboxed mode is **refused**
(`E_BACKEND_SANDBOX_HOST`, naming it; for oats.aweb the remedy is `oats aweb setup`): the agent's
messaging would be cut off inside the sandbox. A line a provider marks optional never
refuses; the kernel's check before the launch names it (the provider keeps no record of it
after the launch). A missing host of a team that is not the agent's default does not
refuse either: the agent's own team is served, and readiness says what it then cannot do
for the other (`session-provider-sandbox-team-unreachable`: that team's mail is
unreachable in `auto`, and raises a prompt in `accept-edits`). Where the kernel cannot resolve the deployment's
configuration at all, a sandboxed launch is refused too (`E_BACKEND_SANDBOX_UNAVAILABLE`).
In `full` mode the launch goes on in every one of these cases. The kernel asks the provider
before every launch (a spawn, a start, and a restart before it stops anything), handing it
the launch it plans, so the refusal comes before anything changes. A plain `oats readiness`
plans no launch: there the provider says nothing of a launch, as it keeps no record of
one.

Three things to know:

- The entries come from the kernel. A kernel that hands a launch none leaves a sandboxed
  home without them: readiness says so (`session-provider-sandbox-missing`), `aw` and
  `oats instance attention` are blocked there, and the home should run in `full` mode
  (`--yolo`) until the kernel supplies them.
- A knowledge base's host is often a general forge (github.com). Allowing it lets the
  agent's commands reach every repository on that forge, not only the base. Readiness
  warns when this is so.
- In `accept-edits`, a compound command (`cmd; echo $?`) raises a bb approval even when
  everything it touches is allowed. That is bb's behaviour.

**What a sandboxed agent cannot change** (again: what such a launch does, were one taken). In bb's sandboxed modes the agent can write its
own home, and some of what is there is later run, or read as configuration, *outside* its
sandbox: OATS's module copies and hooks, Claude's settings, `.mcp.json`, git's config and
hooks. So a launch in a sandboxed mode also writes, into the same
`.claude/settings.local.json`:

- `permissions.deny`: one rule per path below. Claude refuses its Edit and Write tools
  there, and makes the same paths read-only for sandboxed commands:
  - in the home: `.git` (the home is no tree, and git walks up to it from a directory
    that has none), `.oats/`, `instance.json`, `.claude/`, `.agents/`, `.mcp.json`,
    `.aw/signing.key`, `.aw/workspace.yaml`, and the instructions `AGENTS.md`,
    `CLAUDE.md`, `CLAUDE.local.md` and `TASK.md`;
  - in every directory above the home: `.mcp.json`, `CLAUDE.md` and `.claude/`;
  - the Claude configuration of the user that runs bb (`~/.claude.json`, `~/.claude/`) and
    Claude's managed settings (`/etc/claude-code/`);
  - in `work/` and every extra tree: the `.git` pointer, and `config`, `config.worktree`
    and `hooks/` of its git directory and of the clone behind it, with the two files
    there that say where those directories are (found as git finds them, through the
    filesystem). A pointer or a `commondir` the provider cannot read as git
    would refuses the launch (`E_BACKEND_SANDBOX_PATH`): a rule silently missing is worse;
  - in bb's data directory: the thread storage's `.mcp.json`, `CLAUDE.md` and `.claude/`;
  - bb's own plugin directory for Claude, under the temporary directory
    (`bb-provider-bridge-*`; the provider takes its own temporary directory for bb's,
    which holds where both run with the same `TMPDIR`);
  - and the one MCP tool bb pre-allows for its Claude, which moves a thread to another
    directory (`mcp__bb-bridge__update_environment_directory`).
- `permissions.blockWritesOutsideWorkingDirectories: true`: without it Claude's Write and
  Edit tools write anywhere the user can, whatever the sandbox says.

`sandbox`, `permissions.deny`, `permissions.blockWritesOutsideWorkingDirectories` and `env`
are the provider's keys in a bb home, each whole: every launch rewrites them from the
launch input and never reads what they held, so a file the agent changed is put right at
the next launch, and **an entry of your own under one of those four keys is not kept**. A
launch in `full` mode removes the first three. Every other key (`permissions.allow`, where
Claude keeps a person's "don't ask again", and the rest) is left as it is. No other OATS
capability writes those four keys in that file; one that wanted to would be a change to
the contract between OATS and this provider.

Three things the launch must be told, and is refused without:

- **The home's trees** (`trees` in the launch input: `work/` and every extra tree). Only the
  kernel knows them, from Git's own worktree list; the home's record of them is its agent's
  to write. A sandboxed launch with no `trees` is refused (`E_BACKEND_SANDBOX_TREES`): it
  needs an OATS kernel that sends them. A tree that is not an existing directory, or a
  path a rule cannot carry (a wildcard, a parenthesis, a backslash, a line break, bytes
  that are not UTF-8, a `..` step, in the tree's path or
  the home's), is refused too (`E_BACKEND_SANDBOX_PATH`), never skipped.
- **What the kernel keeps outside the home** (`protected` in the launch input: the
  instances' `.oats-retirement/`, which holds the kernel's own copy of the home's modules,
  the one it runs hooks from).
  The agent must read and run them where they are, and never write them: each gets a
  rule for the whole directory. A sandboxed launch with no `protected` is refused
  (`E_BACKEND_SANDBOX_PROTECTED`); an entry that is not an existing directory (the kernel
  makes each before a launch) is refused too (`E_BACKEND_SANDBOX_PATH`).
- **bb's data directory** (`settings.oats.bb.dataDir`). bb does not say where it is; the
  default is `.bb` in the home of the user that runs bb. A directory that holds no
  `thread-storage` refuses a sandboxed launch (`E_BACKEND_SETTINGS`).

**bb's sandboxed modes limit accidents, not a determined agent: they are not a security
boundary between an agent and the operator's account.** bb lets a command ask to run
outside the sandbox, and nothing this provider can write takes that away; a command that
runs outside it writes past every rule above. What then happens differs by mode:

- in `accept-edits`, every way out of the sandbox raises a prompt in bb that a person must
  approve. No mail can approve such a prompt, only a person at bb's interface;
- in `auto`, no person is asked: Claude's own classifier decides, and a command it does not
  flag runs outside the sandbox.

So the rules above are a defence against accidents only. One part of them is known not
to be settled: how the provider finds the directories git will use for a tree (a pointer,
a `commondir`, links, names git reads differently from other programs). Four reviews of
that code each found a way a rule could be missing, each since closed, and nothing says a
fifth would find none. Before OATS offers the sandboxed modes, that code is reviewed again
on its own.

A property of the sandboxed modes, if they are offered: a sandboxed agent can read and edit
the files of its trees, but can neither stage nor commit. In a linked worktree, git writes
its index, objects and refs in the clone, outside the home, and the provider adds no
write path there (the allowances are the kernel's to send). In a tree that is a clone of
its own, the rule on its `.git` makes that whole directory read-only for the agent's
commands. An agent that commits runs in `full` mode.

And a limit of the rules: they cover the hooks git runs from a git directory. A
repository whose own configuration points `core.hooksPath` into the tree (a `.husky`
directory) keeps those hooks writable by the agent; the provider does not read git's
configuration. The same holds for a submodule's git directory.

Also by design: the agent's messaging key (`.aw/signing.key`) stays readable, since `aw`
signs with it. A sandboxed agent can read, and so use, its own key; it cannot replace it.

Where sandboxed launches are taken, readiness reports a home as sandboxed
(`session-provider-sandboxed`) only where its settings hold both the deny of bb's
directory-move tool and the switch. A file with some of the provider's sandbox keys and
not both of those says so (`session-provider-sandbox-incomplete`): the home's agent can
write that file, and the next launch rewrites it. The provider's command, which takes no
sandboxed launch, wrote none of those keys and reports neither.

**bb's Claude, not the launch's.** A bb thread's Claude loads the home's own settings,
hooks, skills and `CLAUDE.md` (bb starts it in the home), and beside them the **user
settings and hooks of the Claude configuration bb's server runs with**. It runs on **the
account of bb's server**: the Claude login of bb's user, or the credential in the bb
server's environment. A launch cannot choose either.

**What a launch refuses.** bb starts Claude Code itself, so the provider cannot pass
arguments or a process environment:

- A launch argument other than `--permission-mode auto|acceptEdits|bypassPermissions` is
  refused, by name: `E_BACKEND_LAUNCH_ARG`. Nothing is dropped silently.
- A launch that is not in bb's full mode: `E_BACKEND_SANDBOXED_MODE`, before any effect
  (after the launch input's own checks): bb homes run in full mode only (above).
- A launch environment entry that comes from a secret (a launch configuration's `fromEnv`
  or `fromFile`) is refused, by name: `E_BACKEND_LAUNCH_ENV`. The environment travels in
  `.claude/settings.local.json`, and no secret is written there. Give bb's server the
  credential in its own environment instead.
- A launch environment entry that would choose Claude's configuration (`CLAUDE_CONFIG_DIR`)
  or its account or endpoint is refused, by name, whatever its source:
  `E_BACKEND_LAUNCH_ENV`. That is every `ANTHROPIC_*` variable except the ones that only
  pick a model (`ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL*`, `ANTHROPIC_DEFAULT_*_MODEL*`,
  `ANTHROPIC_CUSTOM_MODEL_OPTION*`), `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_API_*`,
  `CLAUDE_CODE_OAUTH_*`, `CLAUDE_CODE_SKIP_*_AUTH` and `AWS_BEARER_TOKEN_BEDROCK`. It is never ignored. A launch
  that would remove one of them is refused the same way.
- In a sandboxed mode, a sandbox entry that is not one exact host or one exact absolute
  path: `E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`; a host the deployment does not
  record for the agent's default team, or a configuration the kernel could not resolve:
  `E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_UNAVAILABLE`. A launch in `full` mode writes
  no sandbox entry and is never refused for any of these.
- A file of the home that the provider reads (`.claude/settings.local.json`, the only one)
  and that is not a regular file there (a link, a pipe, a directory), is larger
  than 1 MiB or is not a JSON object: `E_SESSION_START_FAILED`. The provider follows no
  link out of the home, and puts nothing of such a file into a message.

A variable the launch removes on purpose (one a capability declares and this launch
leaves out) is written with an **empty value**: a settings file can set a variable but not
remove one, and bb's Claude would otherwise inherit whatever the bb server's own
environment holds under that name. Start bb's server from a clean environment all the same.

The launch's PATH addition (the home's `.oats/bin`, so the agent's plain `oats` is the
kernel that launched it) travels the same way: the env file's `PATH` is that directory
followed by the PATH the kernel ran the provider with.

**The `env` key is the provider's, whole.** In a bb home, every launch writes the `env`
key of `.claude/settings.local.json` anew from the launch input and never reads what it
held: a variable an earlier launch carried and this one does not is gone, and so is an
entry you added under `env` yourself. Put a variable of your own in the launch
configuration instead. Every key of the file that is not one of the provider's four
(above) is left as it is. The provider keeps nothing of its own in
the home: no record, no state directory. What an earlier version kept there (`.oats-bb/`,
`.oats-bb-sandbox.json`) is deleted, unread, at the home's next start, on any backend, or
at its retire (best effort: a name that cannot be deleted holds nothing up).

**Leaving bb.** When a home that ran on bb starts on another backend (`--backend tmux`),
the capability's launch hook removes the provider's four keys from
`.claude/settings.local.json` (`env`, `sandbox`, `permissions.deny` and
`permissions.blockWritesOutsideWorkingDirectories`). It does so only on the kernel's word
that the home ran on bb before (`OATS_PREVIOUS_BACKEND=bb` in the hook's environment):
nothing in the home decides it, so a home that never ran on bb keeps its own `env`. A
kernel that does not say removes nothing: the launch environment of the home's last bb
launch then stays in the file, to be removed by hand, and the hook says the keys may be
stale only where a `sandbox` block, or the deny of bb's directory-move tool, stands there.
On the same word, the hook removes what a pi launch wrote into the env of the home's bb
project ([pi](#pi)); it asks bb for that, and a bb that cannot be asked is a warning,
never a failed start.

## pi

A soul whose harness is pi runs on bb as a thread of bb's own pi provider
(`bb thread spawn --provider pi --model <the launch's model>`; a model is
`<pi provider>/<id>`, which bb splits itself). Everything above holds for it, except what
follows. Checked against bb-app at `bb-version`, pi 1.5.2 and @awebai/oats-pi 0.70.3
(`test/contract/pi.test.mjs`).

**What a pi launch carries: three variables, and no argument.**

- **No launch argument.** bb starts pi itself, with its own arguments. Every launch
  argument is refused for pi, `--permission-mode` included: `E_BACKEND_LAUNCH_ARG`.
- **Full mode only**, as for Claude, and here it is also bb's own rule: bb's pi has one
  permission mode, no permission prompts and no sandbox. A pi launch without `--yolo` is
  refused: `E_BACKEND_SANDBOXED_MODE`.
- **Nothing of Claude's.** A pi launch neither reads nor writes `.claude/settings.local.json`.
- **The environment: `OATS_INSTANCE`, `OATS_INSTANCE_HOME` and `PATH`, and nothing else.**
  pi reads no settings file of the home for its environment, so the launch's variables
  reach the thread through bb's own **project env** (`bb machine env set <NAME> --project
  <id>`, the value on stdin), which bb keeps in its database. Only those three names ever
  go there: the two say which home this is, and `PATH` puts the home's `.oats/bin` first,
  followed by the PATH oats itself runs with. `PATH` holds paths only, never a value out
  of a launch's env. No harness credential can land in bb's database this way.
  - What a **capability** adds to a launch's env (oats.aweb's `AWEB_DELIVERY`,
    `AWEB_IDENTITY_HOME` and `AWID_REGISTRY_URL` come with every launch) is **left out**
    for pi, and so is what a launch leaves out on purpose (`unset`): the thread's pi
    inherits the bb server's own environment for everything else. `aw` works from the
    home all the same: it finds the home's identity by the directory it runs in.
  - What a **launch configuration** sets (a literal or a secret), or an entry of a source
    the provider does not know, is **refused** by name: `E_BACKEND_LAUNCH_ENV`. A person
    asked for it and it cannot reach pi. What pi needs of the host (a model provider's
    key) belongs in the bb server's own environment.
- **`PATH` must hold pi and what pi is run with.** bb starts the command `pi` by the
  thread's PATH, and a project `PATH` replaces the one bb's own process has. A launch
  whose PATH holds no executable `pi`, or holds pi and not the program its script asks
  `env` for (node), is refused, naming which is missing: `E_BACKEND_LAUNCH_ENV`. Without
  the check the launch would answer a thread that ends at once ("pi exited (code 127)").
  Put pi's directory on the PATH of the process that runs oats. A cost: on a host whose
  bb starts pi by an absolute `BB_PI_BRIDGE_COMMAND`, pi must still be on that PATH.
- **The home's bb project is the provider's, and so is its env, whole.** One home is one
  bb project. A pi launch makes the project's env exactly those three names: it unsets
  every other name the project holds, whoever set it. The retire hook unsets them all,
  and so does the launch hook of a home that leaves bb, on the kernel's word that it ran
  on bb before (`OATS_PREVIOUS_BACKEND`), as for the `settings.local.json` keys. A
  project that is also rooted at another directory is refused by a pi launch
  (`E_SESSION_START_FAILED`): its env would reach whatever runs there. Such a project is
  not the home's alone, so the retire hook and a move away remove only those three names
  from it, and leave what a person keeps there. A Claude launch
  sets no project env. It reads the project's env (one more bb call, whose failure
  fails the launch: a refusal where the launch had changed nothing but those unsets,
  otherwise an outcome in doubt, as for any failure after its first effect) and unsets those three names wherever it finds them, whoever set
  them, leaving any other name: bb gives a project's env to every thread of it and starts
  `claude` by a project `PATH`, and a pi launch of the same home composed that one for
  pi. So a project-level `PATH` set by hand in an OATS home's bb project does not survive
  a launch, of either harness. bb shows no value of its env back, and no record of it
  is kept in the home.

**The home's skills load through @awebai/oats-pi**, the OATS bridge for pi, and only
when `OATS_INSTANCE_HOME` names the home: that is what the project env is for (never
pi's own trust file). It must be installed in the pi configuration bb's server runs
with; it needs the OATS kernel's package on that host, which it finds by the home's
`.oats/bin/oats`.

**Nothing in bb's pi may hold the agent's mail stream.** A bb home's mail is delivered
by the host wake broker, as an input to the home's thread. bb starts more pi processes
than the thread's: a hidden one per bridge worker, which lists models, with the home as
its working directory and every user extension loaded. With the aweb extension for pi
(`@awebai/pi`) in the pi configuration bb's server runs with, each of them connects to
aweb as the agent, and the hidden one takes mail as a turn nobody sees. So a pi launch
is **refused**, and the check of a planned pi launch says so first, unless that
configuration:

- lists `@awebai/oats-pi` (else `E_BACKEND_NOT_READY`, naming the install), and
- does not list `@awebai/pi` (else `E_BACKEND_PI_LISTENER`).

The provider only reads that configuration: setting it is the operator's, or the team
image's. The route to prefer is **a pi configuration of bb's own**: start bb's server
with `PI_CODING_AGENT_DIR=<a directory>`, install the bridge there
(`PI_CODING_AGENT_DIR=<that directory> pi install npm:@awebai/oats-pi`), and name the
directory in `settings.oats.bb.piAgentDir`. The host's tmux pi agents keep their own
`~/.pi/agent`, with `@awebai/pi` in it.

One other state is accepted beside an `@awebai/pi` that is listed: **`AWEB_DELIVERY` in
bb's machine env** (`printf session | bb machine env set AWEB_DELIVERY`), which silences
the extension. bb shows no value of its env, so the name is what the provider can read:
set it to `session`. That variable reaches every pi bb runs on that server, the threads
of its other projects included, not only OATS homes; it reaches no process bb did not
start, so a tmux pi home on the same host keeps its own delivery (the contract test pins
that much: with the variable set in bb, every pi bb starts has it, and a pi started
outside bb by the same user, with a configuration that lists `@awebai/pi`, does not; it
does not open an aweb stream, which needs an identity the test has none of). The same variable in
the bb server's own process environment has the same effect on bb's pi, and the provider
cannot see it there: it is not accepted as evidence.

`piAgentDir` is a statement about this host, like `dataDir`: readiness reads the
directory it names (the `packages` of its `settings.json`), never whether the setting is
there. Limits: packages are recognised by their npm names (`npm:@awebai/pi`, with or
without a version, as a string or an entry's `source`). One installed from a local path
or a git URL, or an extension loaded by an `extensions` entry or dropped into the
directory, is not recognised; and nothing proves the directory is the one bb's server
uses.

**oats.aweb 1.48.0 or later, for pi on bb.** Up to 1.47.0, oats.aweb requires
`@awebai/pi` in the pi folder of every pi launch when its `delivery` setting is `channel`
(the default), on any backend: the very package this provider refuses in bb's pi, so no
pi home could start on bb. From 1.48.0 that requirement is the tmux backend's alone, and
a launch on a session provider is asked only that an aweb extension, if one is
installed, is recent enough. A bb home is delivered by the host wake broker whatever
`delivery` says.

**Needs-input, questions and failed turns.** pi has no permission prompts. A dialog an
extension opens (`ctx.ui.confirm`, `select`, `input`, `editor`) is a pending interaction
in bb: input to the thread is refused while it is open (`E_SESSION_PROMPT_OPEN`), and a
person answers it in bb. Whether such a dialog raises a needs-input claim is
@awebai/oats-pi's: from 0.70.2 it sets a `question` claim in every pi home while the
dialog is open (0.70.0 and 0.70.1 set none); a failed
turn raises its "Turn failed" claim, which the kernel shows because the thread reads as
there (the table above).

**Stopping.** `bb thread stop` ends the thread's pi, its bridge worker and that worker's
catalog pi: no process is left in the home after a stop or a retire. One exception the
provider cannot end: **a model listing's catalog pi**. When a person opens the thread's
model picker in bb (or runs `bb provider models pi --project <id>`), bb starts a catalog
pi in a bridge worker of its own, in the home, and no stop of any thread ends it; it
leaves by itself after about a minute. The kernel refuses to retire a home while a
process works in it, and names the process (`pi`): **a retire within about a minute of a
model listing is refused naming that pi, and succeeds when run again.** The provider
signals no process.

**Limits.** One model per thread, chosen at launch. pi's own logins and model
configuration are those of the pi configuration bb's server runs with. No sandbox: a pi
agent's shell reaches whatever bb's user reaches. `oats session inspect` says
`wakeHold: "unknown"` for a pi home, as for a tmux pi home.

## Readiness

`oats readiness` (the provider's `check` command) and `oats bb doctor` check, and every
launch checks first:

| Finding | Code |
|---|---|
| `trust` is not set, or not one of the two words | `E_BACKEND_TRUST` |
| bb is another version than `version`; the CLI cannot be run | `E_BACKEND_VERSION` |
| `server` or `daemon` is not a loopback address; bb's port answers on an address of this host that is not loopback | `E_BACKEND_EXPOSED` |
| a setting has the wrong shape | `E_BACKEND_SETTINGS` |
| bb's server or host daemon does not answer | `E_BACKEND_UNREACHABLE` |
| the host daemon is not connected yet, or serves another server; bb reports the provider of the launch's harness (claude-code, or pi) as `not_installed`, `unsupported_version`, `unauthenticated`, `expired` or `unknown`; one of bb's answers cannot be read; for a pi launch, the pi configuration bb's server runs with does not list @awebai/oats-pi | `E_BACKEND_NOT_READY` |
| for a pi launch, that configuration lists @awebai/pi, and `AWEB_DELIVERY` is not in bb's machine env | `E_BACKEND_PI_LISTENER` |

Which harness these speak for: with the launch the kernel plans, only that harness's
facts are problems (a pi launch is not held up because bb's Claude is signed out, nor a
Claude launch by anything of pi's). With no planned launch (`oats readiness`, `oats bb
doctor`), Claude's state is a problem as before, and everything of pi's is one warning,
`session-provider-pi-not-ready`, which names the codes a pi launch would be refused
with; a bb with no pi installed is told nothing of pi.

With the launch the kernel plans (before every launch), the check lists what a sandboxed
launch would write into the home's sandbox, each host and path with who asked for it
(`session-provider-sandbox`), and warns of a general forge among the hosts
(`session-provider-sandbox-forge`). With no planned launch it says nothing of a sandbox:
the provider reads no record of an earlier launch, and keeps none.

On every read with no planned launch it carries the warning
`session-provider-full-mode-only`: the backend launches in bb's full mode only; sandboxed modes are not offered.

It also reports, as a warning that blocks nothing, `session-provider-orphaned`: live bb
threads whose project root no longer exists, with their ids and the root. That is what a
retire leaves when it could not reach bb, or when an older kernel retired the home.
Archive them: `bb thread archive <id>`.

`oats bb doctor` also says where bb's Claude takes its credential from, by bb's own report
(a Claude login of bb's user, or a credential in bb's configuration or the bb server's
environment). It never prints a credential or an account name.

## The trust group

bb's API has no login, and it runs commands and reads files. With tmux, the socket sits in
a directory only your user can enter, so the group that can drive your agents is your OS
user. bb listens on a TCP port on loopback, and **every process of every local user can
connect to it**. That is a wider group, and the provider makes you say it is acceptable:

- `trust: single-user`: this host has one person's user. Nobody else logs in.
- `trust: container`: one OATS team container with one bb server in it. The container is
  the boundary.

On a shared multi-user host, neither holds: do not run this provider there.

## Exposure, and Tailscale Serve

The provider refuses a bb that is reachable off loopback (`E_BACKEND_EXPOSED`): a `server`
or `daemon` setting that names another host, a bb started with
`--server-bind-host 0.0.0.0` (or `BB_SERVER_BIND_HOST=0.0.0.0`), or anything else that
answers on bb's port on one of this host's other addresses. It checks by connecting to the
port on each of them.

To use bb's UI from another device, keep bb on loopback and put a Tailscale Serve route in
front of it:

```sh
tailscale serve --bg 38886          # https://<host>.<tailnet>.ts.net -> 127.0.0.1:38886
```

Your tailnet's ACL is then the access control for bb: everyone it admits to that route can
run commands as bb's user. Serve the route on its default port (443). A route that listens
on bb's own port number (38886 or 38887) on the tailnet address looks the same as an
exposed bb to the check, and is refused.

## Stops

**A thread OATS stopped is archived.** `oats instance stop <instance>` records the stop,
stops the thread and archives it. bb starts a stopped thread's agent again at the next
message to it, in the same conversation, so before oats.bb archived at a stop, a message
typed in bb's composer restarted an agent OATS had stopped. bb refuses every message to
an archived thread, so the agent stays stopped until OATS starts it, and a start is a new
thread, as before.

- The conversation is not lost: it is in bb, readable, under the project's archived
  threads (`bb thread list --archived --project <id>`).
- If bb does not archive the thread, the stop still succeeds, and the provider's command
  writes a warning on its standard error naming the thread; archive it in bb
  (`bb thread archive <id>`), or start the agent with OATS, which archives it.
- If you unarchive the thread in bb (`bb thread unarchive <id>`) and message it, bb
  starts its agent again, outside OATS: OATS still holds the instance stopped. Stop it
  with `oats instance stop <instance>`, or start it with OATS.
- A home stopped with the host (`oats host run`'s shutdown) is one OATS brings back, by
  an input to its thread, so that stop must not archive. The provider leaves the thread
  live when the kernel says the stop is the host's (`reason: "host"` in the stop input).
  An OATS below this package's floor does not say so: with one (a trial against an
  older kernel), a bb home stopped with the host is archived like any other and is not
  resumed after the host starts again. Start it with `oats session start`, which gives
  it a new thread.
- The window that leaves: a home stopped with the host has its thread live and
  unarchived from the host's shutdown until the first resume sweep after the host is
  back (`oats host run` runs one at its start and each minute; the clients when they
  open): the time the host is off, plus up to about a minute after boot. A message
  typed in it then lands in a home OATS means to run.

### Stops made outside OATS

A thread stopped in bb's own UI is not stopped for OATS: bb shows it `idle`, OATS has no
record of the stop, and the next mail's tell restarts it. **Stop an OATS agent with OATS**
(`oats instance stop <instance>`), which records the stop and then stops the thread. The
OATS plugin for bb adds a **Stop agent (OATS)** entry to the thread's menu that does this.

An OATS agent's thread **archived** in bb is gone for OATS: bb refuses every message to an
archived thread, so the home reads as stopped, mail to it is refused, and
`oats session start` gives it a new thread. Unarchive it in bb to keep the conversation.

The same goes for a person's answer: answer a thread's question or permission prompt in
bb. `oats session input` never answers one; it refuses while one is open.

## A team image: two pins

A team container image that runs bb has two version pins:

1. the image's bb-app (its `package.json`), which is what gets installed;
2. this provider's `version` setting, which is what the deployment expects: by default the
   version this release of the provider was tested against (`bb-version`).

They must be equal. `E_BACKEND_VERSION`, at readiness and at every launch, is the check
that keeps them so: move the image's pin together with the provider release (or the
`version` setting). In the container, set `trust: container`,
and give Claude's token to the bb server's own environment (the image's supervisor does
this); it is never a launch environment entry. For pi agents, set
`piAgentDir: /state/home/.bb-pi`: the image's bb server runs pi with a configuration of
its own there, which lists @awebai/oats-pi and not @awebai/pi
([the image's README](container/README.md#pi)).

In a team container (`trust: container`), spawn bb agents with `--yolo` (bb `full` mode):
the container is the boundary, as it is for tmux agents there. bb's sandboxed modes need
bubblewrap, which the hardened image doesn't carry; without it every command would wait
for a person in bb (a launch without `--yolo` is refused altogether, above).
Readiness says so wherever bubblewrap is missing
(`session-provider-sandbox-unsupported`, a warning: it refuses nothing).

## A trial against an unreleased kernel

The manifests' floor (`compatibility.oats`, `>=0.70.5`; PLACEHOLDER(A16): set before this
is released) is the first OATS release that marks a host shutdown's stop; the
session-provider wire 1.3 and the kernel's protection of a provider home's files are in
OATS since 0.70.0 ([What it needs](#the-session-provider)). A kernel built from an
unmerged branch reports an older version and refuses the capability
(`E_CAPABILITY_INCOMPATIBLE`). A kernel that has session providers but not yet wire 1.3
refuses this manifest for its `wire` key (`E_BACKEND_UNKNOWN`): that is intended, the two
must speak the same wire. For a trial only: make a local commit on top of the commit
you are trying that sets `compatibility.oats` in `oats-package/oats-package.json` and
`oats-package/capabilities/oats-bb/oats.json` to `>=<your kernel's version>`, and pin that commit
(`oats.bb: git:<repository>@<that commit>`). Never ship or push that commit: the floor in
the repository stays.

## Development

```sh
npm test                 # manifest validation and the unit tests (a fake bb)
npm run test:contract    # the contract tests: the pinned bb-app in a container (needs docker)
npm run test:kernel      # the provider under a real OATS kernel (needs docker, a clone of OATS, the network)
npm run test:kernel:pi   # a pi home and a Claude home under the released kernel (needs docker, the network)
```

The contract test builds `test/contract/Dockerfile` at the version in `bb-version`, starts
bb and a mock Anthropic endpoint inside the container, and calls the provider's commands
on their wire: every bb command and HTTP address the provider uses. bb runs only in the
container: no port is published. Moving the bb pin is one change to `bb-version` and the
manifest's `version` default (`npm run validate` keeps them equal) that the contract test
must pass.

A second contract file (`test/contract/sandbox.test.mjs`, its own image with a sandbox
runtime) runs bb's sandboxed modes with the sandbox really started, through the tests' own
entry: it is where the deny rules are shown to hold, and where their limit is pinned. Its
container must be able to make user namespaces; the CI job says what that takes on
Ubuntu.

A third (`test/contract/pi.test.mjs`, its own image: bb-app, pi, the OATS kernel's
package and @awebai/oats-pi, and a mock OpenAI-compatible endpoint) runs pi threads: the
launch, the three variables through bb's project env, the home's skills, the readiness
of bb's pi configuration, a failed turn, input (idle, steering, a dialog), a thread OATS
stopped (archived: a tell is refused and starts nothing; unarchived by hand, a tell
starts pi again), and that no process is left in a home after a stop or a retire. Run it again
on every bump of bb-app or pi.

A fourth (`test/contract/title.test.mjs`, the first file's image) pins what bb does to a
thread's title by itself, and that a launched thread's title is the instance's name as
words and stays so. bb writes titles through an AI service, which a signed-out bb has
none of, so the test installs a bb plugin that registers one
(`test/contract/title-service/`). Run it again on every bump of bb-app.

`npm run test:kernel` (`test/contract/kernel/`) runs the provider under a real kernel:
`OATS_KERNEL_REPO=<a clone of OATS> OATS_KERNEL_REF=<commit> npm run test:kernel`. The
kernel's own spawn, check, inspect and retire drive the provider as it ships (full mode),
and a trial-only package whose session verbs take the sandboxed modes shows a sandboxed
launch made by that kernel: what it sends (`trees`, `protected`), and that the agent
runs the kernel's module copy and cannot change it. CI does not run it (it has no kernel
checkout at a chosen commit); run it when the kernel's side of the wire moves, and at a
bb bump.

`npm run test:kernel:pi` (`test/contract/kernel/pi-run.mjs`) runs a pi home and a Claude
home under the kernel the pi contract image installs from npm, with no clone: the
kernel's spawn on bb, `oats session input`, a failed turn (the home stays present), a
thread in `error` whose process is gone (the home reads lost, and an input is the
kernel's resume: counted once, then bb starts the harness again in the same thread for
one turn), the stop and the retire. CI does not run it either (it needs the network for
the workspace's framework package); run it at a bump of bb, of pi or of the kernel.
