# oats-bb

Official [OATS](https://github.com/oats-project/oats) package for
[bb](https://www.npmjs.com/package/bb-app): the bb session provider and plugin, which let OATS
agents run as bb threads beside the kernel's tmux backend.

The latest release is 0.4.0 ([CHANGELOG.md](CHANGELOG.md)): a stop archives the agent's thread, so an agent OATS stopped stays stopped, and the plugin acts on agents (Stop, Start, Restart, Retire, New agent) beside the Desktop's home, panel and Automations. The work arrives as reviewed pull
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
> - OATS 0.70.5 or later (the manifests' `compatibility.oats` floor): the first OATS
>   release whose host shutdown says so in its stop (`reason: "host"`), so that a home stopped with the host
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
> the real bb and pi with OATS 0.70.5 (`test/contract/pi.test.mjs`). bb homes run in bb's full mode, and
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
     oats.bb: git:github.com/oats-project/oats-bb@v0.4.0
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

All under `settings.oats.bb` in `oats-local.yaml`. `server`, `daemon`, `hostDaemonPort`, `trust`, `cli`,
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
| `daemon` | `http://127.0.0.1:38887`, or the `hostDaemonPort` on 127.0.0.1 where that is set | The bb host daemon: the address readiness asks for its state. A loopback address only. With `hostDaemonPort` set, leave it unset (it follows the port); the two together must name one port (`E_BACKEND_SETTINGS`). |
| `hostDaemonPort` | none | The port of this bb's host daemon, a number from 1 to 65535: what bb-app was started with (`--host-daemon-port`). Set it where the daemon is not on bb's default port, 38887 ([two bbs on one host](#two-bbs-on-one-host)): bb's CLI finds its host daemon by this port alone, and every bb command the provider runs is then told it (`BB_HOST_DAEMON_PORT`). Unset: no port is told, and bb's CLI uses its default. A `BB_HOST_DAEMON_PORT` in the environment OATS runs in never reaches bb, set or unset: the port comes from this setting alone, so that one bb's port is never paired with another bb's `server`. Anything that is not such a number (text included) is refused, `E_BACKEND_SETTINGS`. |
| `cli` | `bb` | The bb CLI: a command on `PATH`, or an absolute path. |
| `dataDir` | `.bb` in the home of the user that runs bb | bb's data directory on this host (bb-app's `--data-dir`), an absolute path. Read only for a launch in a sandboxed mode, which keeps the agent's tools off bb's thread storage there (see "What a sandboxed agent cannot change", below). |
| `piAgentDir` | `.pi/agent` in the home of the user that runs bb | The pi configuration directory bb's server runs pi with: pi's `PI_CODING_AGENT_DIR` as the bb server's own environment has it. bb does not say where it is, so this setting does; it is host-only, set in `oats-local.yaml`. It must be an absolute path: any other value is refused by every launch and every readiness read (`E_BACKEND_SETTINGS`). The directory is read only for a pi launch and its readiness. What readiness reads is the directory itself (the `packages` of its `settings.json`), never whether the setting is there: a setting that names another directory than the one bb's server uses checks the wrong one (see [pi](#pi)). |

The capability declares no host requirement for `bb`: a soul that has it may run on tmux on
a host with no bb at all, and `cli` may point off `PATH`. Readiness is what checks the CLI
(`E_BACKEND_VERSION` when it cannot be run).

## What the kernel gets

| Call | What the provider does |
|---|---|
| launch | Runs the readiness checks. Finds or creates the bb project rooted exactly at the home. Refuses if another live thread runs there. Stops and archives the home's previous thread (a start after a stop is a fresh conversation), and stops the home's archived threads: bb keeps an archived thread's Claude process, in the home, until it is stopped. Writes the launch environment, and in a sandboxed mode the sandbox entries, into `<home>/.claude/settings.local.json` (mode 0600); for a pi launch, its variables (four at most) into the env of the home's bb project instead ([pi](#pi)). Runs `bb thread spawn --provider claude-code` (or `--provider pi`) `--environment <home> --prompt-file <home>/TASK.md --title <the instance's name as words>` ("The thread's title", below). Answers `{server, projectId, threadId}`. |
| inspect | One `bb thread list`. Maps bb's status (table below). For a thread in `error` or at rest (idle, pending), also looks at this host's processes for the thread's harness: whether it lives, and whether it works in the home. A second live thread in the home is `E_SESSION_UNAVAILABLE`, naming both. A bb that does not answer is an error, never "stopped". |
| input | Reads the thread's pending interactions; while one is open, refuses with `E_SESSION_PROMPT_OPEN` and sends nothing. Otherwise `bb thread tell`. Only bb's `sent` is a submission. A `queued` tell is withdrawn (`bb thread queue delete`) and answered `E_SESSION_INPUT_QUEUED`, whatever the delete says: where the copy could not be withdrawn the message may arrive anyway, and the mail that carried it stays unread, so the agent may see it twice and never loses it. |
| stop | Withdraws what bb holds in line for the thread (a turn bb's concurrency limit has not started yet: bb would start it by itself later), then `bb thread stop`, then waits until bb shows the thread settled, for the grace the kernel gives, counted from the moment `bb thread stop` answered. Stopped means settled AND nothing left in line; still in a turn after the grace, or a held turn that could not be withdrawn: `E_SESSION_STOP_FAILED`. A thread archived in bb is stopped like any other. Then archives the thread (`bb thread archive`): bb starts a stopped thread's agent again at the next message to it and refuses every message to an archived one, so an agent OATS stopped stays stopped ("Stops", below). An archive bb refuses fails no stop: `stopped`, and a warning on the command's standard error that names the thread. |
| retire (hook) | For each of the home's live threads: withdraws what bb holds in line for it, stops it, and archives it once the stop is confirmed (a thread it could not stop is left, and named in a warning). Then stops the home's threads that were archived before, and removes the env of the home's bb project (what a pi launch wrote there). Last, it deletes the home's bb environment, where every thread on it is one a launch of this home made ("Retires", below); otherwise the threads are archived only, and its warning says why. It asks bb for every home that has the capability: the home is its agent's to write, so nothing in it proves there is no thread. Its receipt (`meta`) names every thread of the home that is archived in bb when it ends (`archived`: its own, then those archived before, the one the retire's own stop archived among them; only the home's own where the provider's record of them is there), with `retired: true`, and the environments it asked bb to delete (`environments`); `nothing-to-delete` is for a home bb has no thread of. |
| stop (no endpoint) | Finds the home's bb project and stops every live thread that runs in the home, and its archived threads: the kernel's cleanup after a launch whose answer was lost, or whose caller was killed while it ran. `stopped` also when there is none; `E_SESSION_STOP_FAILED` when bb's lists cannot be read. A thread bb made at or after the time the kernel says the failed launch was sent (`launchSent`) is taken to be that launch's, and is archived once stopped, so no message in bb starts it again and the next start launches (if bb does not archive it, the stop warns on its standard error and the next launch names it). That includes a thread a person started in the home after that time: it stays in bb, archived. An older thread, or any thread when the kernel gives no time, may be a person's: it is stopped and stays in bb, and the next launch names it until it is archived (in bb, or by the retire). |

| bb thread | present | state | running |
|---|---|---|---|
| starting, active, stopping | true | unknown | true |
| pending, idle, and the harness bb started for the thread is at work in the home | true | unknown | true |
| pending, idle, and it is not (a thread `bb thread stop` released reads `idle` too; at the pinned bb, a harness the agent itself left running is not it) | true | unknown | false |
| pending, idle, and it cannot be told: what started a harness in the home cannot be read, or it is not bb's runner and bb is not at the pinned version | true | unknown | null |
| pending, idle, on a host whose processes cannot be read (macOS: no `/proc`) | true | unknown | null |
| pending, idle or error, with a turn bb holds in line (its concurrency limit; `queuedWork: "waiting"`) | true | unknown | true |
| pending, idle or error, with a word for its queue the provider does not know | true | unknown | null |
| error, and the thread's harness process (pi, claude) is still loaded on this host | true | unknown | as for a thread at rest: true where bb's own harness works in the home, false where it does not |
| error, and its harness process is gone (whatever else the agent left running) | false | stopped | false |
| missing, deleted or archived | false | stopped | false |

**A known limit: many archived threads.** Every start archives the home's previous
thread, and bb keeps an archived thread's Claude process until the thread is stopped, so
a stop, a retire and a launch stop the home's archived threads (several at a time). A bb
project that holds more of them than fit the command's time (about a hundred to a few
hundred, by the machine's processors and by the command) makes the stop fail, and it says so: how many were stopped, of how
many, and the remedy. Remove old archived threads of that project in bb: for each,
`bb thread stop <id>`, then `bb thread delete --yes <id>`.

> **WARNING: a retired agent whose home was kept can still be started again from bb.**
> A retire deletes the home's bb environment, so a retired agent's thread takes no
> message even once it is unarchived ("Retires", below). That is a deliberate step in
> the way, not a lock. Where the home was kept (`oats retire --keep-dir`, or a retire
> that ended quarantined), a person can still start the agent with three acts in bb:
> **Unarchive** the thread, **Restore** its environment (`bb thread
> restore-environment <id>`, which bb's own refusal names), and send it a message. And
> where the retire **archived only** (the cases under "Retires"), Unarchive and a
> message are enough. A session revived that way runs with NO OATS around it: no status
> row, no hooks OATS runs for it, no stop by OATS. Retire bb agents the ordinary way,
> which removes the home: then nothing can start.
>
> **Whether such a session can send mail as the retired agent** depends on the oats.aweb
> that retired the home:
> - **oats.aweb 1.49.0 or later:** not through `aw`'s ordinary lookup. A retire whose
>   answer exits 0 removes the home's aweb keys, and one that fails holds them aside for
>   the retry (`aw` then answers "not initialized"). That too is a step in the way, not
>   a boundary: held keys stay in the home's `.oats-aweb/held/`, readable by the
>   session's own user, and a retire that crashed leaves them in place (oats.aweb's
>   README, "What retire does with the key material").
> - **An older oats.aweb:** the home keeps its keys. Where its aweb identity was not
>   released (a team leave waiting for its controller, a retained seat, an alias held), a
>   revived session can send mail as the retired agent.

bb has no "stopped" status: a stopped thread reads `idle`, like one that finished its
turn. The kernel records its own stop and answers "stopped" itself, and the provider's
stop archives the thread, so the provider reads it missing from then on.

So whether a thread at rest runs is read from this host's processes, not from bb's word:
`running` is true where the harness bb started for the thread is at work in the home,
which is one process named `pi` or `claude` that carries the thread's id, has the home
as its working directory and is a child of bb's own runner for that provider, and false
where there is none. A process that merely carries the thread's id, a harness at work in
another directory, or a `pi` or a `claude` the agent itself started and left running
detached never counts (at the bb version the provider is pinned to it reads false; at
another bb, where bb's runner may have moved, it reads null: it cannot be told). This is how OATS tells a home stopped with the host (its thread
left live, its harness gone) from one whose harness came back. Two limits follow. What
OATS reports as running outside it is a harness bb revived in a stopped home, not every
process an agent left behind: **an agent's own detached processes outlive a stop of its
thread, and `oats instance stop` does not end them** (in a team container too). And the
rule reads bb-app's own process layout (its bridge worker's file name, pinned by the
contract tests at every bb bump), not its CLI. On a host
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
  - the provider's own state directory, whole (`$XDG_STATE_HOME/oats-bb/`, by default
    `~/.local/state/oats-bb/`): its record of the threads it made for each home, which
    decides whether a retire deletes a home's bb environment ("Retires"). It is outside
    every home and the agent runs as the same user, so only this rule keeps its tools
    off it;
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

## Launch choices

Two things a person picks in bb's own composer can be chosen for a launch on bb: the
**reasoning level** and the **service tier**. The provider declares them
(`sessionProviders.bb.launchChoices` in its manifest), and OATS passes them on, on a
kernel with the feature `launch-choices`:

```sh
oats spawn <soul> --backend bb --launch-choice reasoning-level=high
oats session restart --home <home> --launch-choice service-tier=fast
oats session start --home <home> --launch-choice reasoning-level=default   # clears a recorded one
```

| Choice | What it is | Passed to bb as |
|---|---|---|
| `reasoning-level` | How hard the model thinks: a level bb lists for the launch's model (`low`, `medium`, `high`, `xhigh`, `max`, or one of the model's own) | `bb thread spawn --reasoning-level <level>` |
| `service-tier` | The service tier the thread runs on: one bb lists for the launch's provider (Claude Code has `fast`; pi has none), and for its model where the model narrows them | `bb thread spawn --service-tier <tier>` |

The kernel knows neither choice's meaning. It records a spawn's choices in the home, hands
them to every later start, and checks only that the provider declares the name. What a
value means is this provider's, and its rule is one: **a choice is carried or refused,
never dropped, and what is carried is what bb itself lists**: for the launch's model, its
reasoning levels (`bb provider models <provider> --json`, `supportedReasoningEfforts`);
for its provider, its service tiers (`bb provider list --json`, `serviceTiers`), which a
model's row may narrow (`supportedServiceTiers`; a row with no such list takes every tier
of its provider). Both harnesses.

**Refused, before anything is started** (`E_BACKEND_LAUNCH_ARG`, at the launch and, where
the kernel hands the check the planned launch's `choices` and `model`, at the check):

- a reasoning level the model does not have in bb, naming the levels it has;
- a service tier bb's provider does not list (any tier on pi, which has none), or one the
  model's own list leaves out;
- the value `default`: it is how a recorded choice is cleared in OATS
  (`--launch-choice <name>=default`), and is never a value a launch is handed. (In bb
  `default` is the provider's standard tier, which is what a launch with no choice runs
  on.)
- a choice the provider does not declare, or a value that is not 1 to 40 lowercase
  letters, digits, dashes and underscores (the value becomes an argument of bb's CLI
  of its own, never an option, never a shell word);
- for pi, a model written with pi's own `:<level>` (`anthropic/claude-opus-5-5:high`): on
  bb the level travels as the `reasoning-level` choice alone, and the refusal names the
  model without the suffix and `--launch-choice reasoning-level=<level>` ([pi](#pi), "The
  model").

Why the provider checks, by what bb does (seen at the pinned bb, and pinned by
`test/contract/contract.test.mjs` and `pi.test.mjs`):

- **bb takes any reasoning level, and an unlisted one is a third thing, not the
  default.** A thread spawned with no level starts Claude Code with bb's own,
  `--effort=medium` (not the `defaultReasoningEffort` its list shows for the model,
  `high`). One spawned with a level the model has starts it with that one. One spawned
  with a level the model does not have, or with the word `default`, starts it with **no
  effort at all**: neither the one asked for, nor bb's own. bb answers a thread each
  time, and nothing says what became of the level.
- **A service tier is the provider's, and a model with no list of its own takes them
  all.** bb's own guide (`bb guide providers`): "`bb provider list --json` reports each
  provider's `serviceTiers` […] A model may narrow that list: […] `--json` reports
  `supportedServiceTiers` per model (absent when the provider does not report tiers per
  model, in which case the model accepts every tier the provider lists)". Claude Code's
  are `default` and `fast`, no Claude model's row narrows them, and pi has none.
- **bb refuses a service tier its provider does not list, but only at the spawn**
  ("Provider claude-code does not support the … service tier", "Provider pi does not
  support service tiers"). By then a launch has stopped the home's earlier thread and
  made its project, so the same refusal is given first, with nothing started. A tier
  the provider lists is carried: with `fast`, Claude Code is started in its fast mode.
- **bb remembers nothing of it from one spawn to the next**: after a thread spawned with
  `low`, a thread of the same project spawned with no level is at bb's own again. That
  is why the kernel records the choice in the home and hands it to every start: a
  restart would otherwise lose it.

**Where bb's lists cannot settle it, nothing is refused**: the launch goes on with the
choice, and says once `could not check the launch choice <name> against bb's lists:
<why>` (the warning `session-provider-launch-choice-unchecked` at the check; the provider
command's standard error at the launch). That is the case when a list cannot be read,
the model is not in bb's list (or is in it more than once), or a list does not say which
levels or tiers there are (a model whose levels bb has not discovered yet,
`reasoningDiscovery: "unknown"`, among them).

**A launch that names no model.** bb then picks one by a rule of its own that its list
does not show (the project's remembered model, then its provider's default), so there is
no one row to hold the choice against. Each choice is held against every model of the
provider: a value no model has is refused (bb would drop it, whichever it picks), one
every model has is carried, and one only some have is left open, with the warning.

**The kernel this needs.** The manifest property is one a kernel without `launch-choices`
does not know, so the package's floor (`compatibility.oats`) is the OATS release that has
it: an older kernel refuses the package (`E_CAPABILITY_INCOMPATIBLE`). Without that floor,
an older kernel loses the whole backend, which is why the floor moves with this: OATS
0.70.5 answers every spawn on bb `E_BACKEND_UNKNOWN`, "unknown session backend "bb":
capability oats.bb declares it malformed: session provider "bb": unknown key
"launchChoices" (allowed: commands, harnesses, description, wire)" (seen with
`npm run test:kernel:pi`). `npm run validate` holds the two together: it refuses a
manifest that declares launch choices below that release.

Nothing is chosen unless a person chooses it: a launch with no choice passes none, reads
nothing more of bb, and starts as it did before. A launch configuration, a soul, a host
default, a schedule's job and a trigger's spawn carry no choice. A home on tmux takes
none (the kernel refuses it there; for pi on tmux the model's own `:<level>` sets its
thinking, as before).

## pi

A soul whose harness is pi runs on bb as a thread of bb's own pi provider (`bb thread
spawn --provider pi --model <the launch's model>`; a model is `<pi provider>/<id>`, which
bb splits itself, or the bare `<id>` where one pi provider serves it: "The model",
below). Everything above holds for it, except what follows. Checked against bb-app at
`bb-version`, pi 1.5.2 and @awebai/oats-pi 0.70.5 (`test/contract/pi.test.mjs`).

**What a pi launch carries: four variables at most, and no argument.**

- **No launch argument.** bb starts pi itself, with its own arguments. Every launch
  argument is refused for pi, `--permission-mode` included: `E_BACKEND_LAUNCH_ARG`.
- **Full mode only**, as for Claude, and here it is also bb's own rule: bb's pi has one
  permission mode, no permission prompts and no sandbox. A pi launch without `--yolo` is
  refused: `E_BACKEND_SANDBOXED_MODE`.
- **Nothing of Claude's.** A pi launch neither reads nor writes `.claude/settings.local.json`.
- **The environment: `OATS_INSTANCE`, `OATS_INSTANCE_HOME`, `PATH` and
  `AWEB_IDENTITY_HOME`, and nothing else.**
  pi reads no settings file of the home for its environment, so the launch's variables
  reach the thread through bb's own **project env** (`bb machine env set <NAME> --project
  <id>`, the value on stdin), which bb keeps in its database. Only these four names ever
  go there, each for a reason, and none of them can hold a credential:
  - `OATS_INSTANCE` and `OATS_INSTANCE_HOME` say which home this is (the kernel's own
    entries);
  - `PATH` puts the home's `.oats/bin` first, followed by the PATH oats itself runs with.
    It holds paths only, never a value out of a launch's env;
  - `AWEB_IDENTITY_HOME` says where the agent's messaging identity is, where a
    capability's entry names a directory of the home with it (oats.aweb's: `<home>/.aw`
    for a local seat, `<home>/.aweb-identity` for a seat with a global identity through
    a session grant). It is carried by that one name, not marked secret, and only as a
    path that is the home or inside it, written plainly (absolute, no `.` or `..` step):
    a path of the home is no credential. Where the home is reached through a link and
    the two are written differently, their real paths decide. Any other value of it is
    left out, and the launch says so once on its standard error, without the value
    ("AWEB_IDENTITY_HOME is not carried to this pi thread: …"): the agent would
    otherwise receive mail, fail to send, and nothing would say why. Without it
    a grant seat on pi received its mail and could not send: `aw` finds an identity in
    `.aw` of the directory it runs in, so a local seat's `aw` works from the home either
    way, and a grant seat's identity is not there ("current directory is not initialized
    for aw").

  No harness credential can land in bb's database this way. The rule is these four
  names, and not "what a capability marks as no secret": nothing marks a launch env
  name so today.
  - What else a **capability** adds to a launch's env (oats.aweb's `AWEB_DELIVERY` and
    `AWID_REGISTRY_URL` come with every launch) is **left out** for pi, and so is what a
    launch leaves out on purpose (`unset`): the thread's pi inherits the bb server's own
    environment for everything else.
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
  bb project. A pi launch makes the project's env exactly the names it carries: it unsets
  every other name the project holds, whoever set it. The retire hook unsets them all,
  and so does the launch hook of a home that leaves bb, on the kernel's word that it ran
  on bb before (`OATS_PREVIOUS_BACKEND`), as for the `settings.local.json` keys. A
  project that is also rooted at another directory is refused by a pi launch
  (`E_SESSION_START_FAILED`): its env would reach whatever runs there. Such a project is
  not the home's alone, so the retire hook and a move away remove only those four names
  from it, and leave what a person keeps there. A Claude launch
  sets no project env. It reads the project's env (one more bb call, whose failure
  fails the launch: a refusal where the launch had changed nothing but those unsets,
  otherwise an outcome in doubt, as for any failure after its first effect) and unsets those four names wherever it finds them, whoever set
  them, leaving any other name: bb gives a project's env to every thread of it and starts
  `claude` by a project `PATH`, and a pi launch of the same home composed that one for
  pi. So a project-level `PATH` set by hand in an OATS home's bb project does not survive
  a launch, of either harness. bb shows no value of its env back, and no record of it
  is kept in the home.

**The model must be one bb's pi resolves.** bb takes any model id when a thread is
spawned and resolves it only when the thread starts. An id its pi cannot resolve used to
leave a spawn that looked launched (a thread id, `launched: true`) over a thread that had
failed as it started: `oats status` then read not running, session lost. So a pi launch
that names a model reads the models bb lists for its pi (`bb provider models pi`, one
call) and is **refused before anything is started**, with `E_BACKEND_LAUNCH_ARG`:

| the launch's model | the refusal |
|---|---|
| a bare id no pi provider serves, or a `<provider>/<id>` pi does not have | `pi has no model "<id>" (if you just added it to pi, try again in a minute)` |
| a bare id two or more pi providers serve | `pi model "<id>" is served by A and B: use A/<id> or B/<id> (if you just changed that in pi, try again in a minute)` |
| a model of the list followed by one of pi's own thinking levels, `:<level>` (`<model>:high`) | `pi model "<model>:high" names a thinking level in the model id, which bb's pi does not take: name the model "<model>", and choose the level with --launch-choice reasoning-level=high` |

(The third row: on tmux, pi takes a thinking level written into the model id. bb's pi
resolves the model by its exact id, and a thread spawned with such an id ends in error;
on bb the level is a [launch choice](#launch-choices). It is said only where the suffix
is one of pi's levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) and what
stands before it is a model of the list: a model whose own id holds a colon, or a tag
(`:8b`, `:free`), is not taken for one. And it is that refusal's sentence, no check of
its own: where the list cannot settle an id, nothing is refused, as above. The value it
names is one bb has: pi's own word, but for `:off`, which is `reasoning-level=none` in
bb, and `:minimal`, which bb has for no pi model, so the sentence names no value for
it.)

The rule is bb's own, and no stricter: the id is one model's `<provider>/<id>` exactly,
or it is a bare id and exactly one model's. Nothing is matched loosely (no prefix, no
pattern, no other case). So a soul may name a bare id, `claude-fable-5.1`, as long as
one of pi's providers serves it; where a second one comes to serve it, name the one you
want.

**Where the list cannot settle it, nothing is refused**: the launch goes on as it did
before this check, and says once `could not check the model "<id>" against pi's model
list: <why>`. That is the case when bb's list cannot be read (bb does not answer in
time, answers an error, an empty list or one the provider cannot read), and in three
cases where bb lists fewer models than its pi resolves (the first two seen at bb-app
0.50.1, pi 1.5.2):

- a model whose id ends in a date (`-YYYYMMDD`) is held back from the list, and listed
  only where it is named as its exact `<provider>/<id>`: so named, it is found. Any
  other id that ends in a date and is not listed is not checked (a bare id may itself
  hold a slash, so an id that looks full may be a held-back model's bare one);
- where the pi configuration bb's server runs with sets `enabledModels`
  (`settings.oats.bb.piAgentDir`, its `settings.json`), bb lists only those models, and
  a thread still starts on any other model pi has. A model that is not listed is then
  not checked. Two listed models with the id are still refused (a bare id with no
  slash: one with a slash may be a held-back model's exact `<provider>/<id>`, and is
  not checked). bb's pi keeps the
  setting it started with: after `enabledModels` is removed, bb goes on listing only
  those models, at least while its pi is in use. So a model that is not listed is refused only
  where that `settings.json` sets no `enabledModels` **and has not changed since bb
  started** (bb-app's own record of its start, `bb-app-runtime.json` in
  `settings.oats.bb.dataDir`); where it has, or that record cannot be read, the model
  is not checked. After a change to bb's pi settings, restart bb: until then the check
  is off for every model that is not listed, and readiness says so (below);
- a home with a pi configuration of its own (`<home>/.pi`) may give its thread models
  that bb, which lists from a directory of its own, does not show: its launch is not
  refused for a model that is not listed.

**Readiness says when the check is off until bb restarts.** A change to bb's pi
settings under a running bb turns the check off for every home at once: every id that
is not listed passes, and one pi does not have fails as its thread starts. pi writes
that `settings.json` itself (a default model chosen in pi, for one), so it happens
without anyone editing the file. `oats readiness` and `oats bb doctor` (a read with no
planned launch) then carry the warning `session-provider-pi-model-check-off`: "the pi
model check is off until bb restarts: bb's pi settings changed after it started (restart
bb-app to turn it back on)". It is a warning: nothing is refused for it. It is given
where a pi launch would go on (bb has pi, and its configuration passes the two checks
below), the `settings.json` sets no `enabledModels` (the check is then off by that
setting, and a restart does not turn it on), and bb-app's record of its start can be
read; where it cannot, nothing is said there, and each launch whose model is not listed
warns as above. A bb that does not answer is told nothing of it.

**bb's list may also be older than pi's configuration.** bb's server serves the list it
fetched for a minute as it is, while a thread starts by what pi has now. So where the
pi configuration bb's server runs with changed in the last minute and a half (its
`settings.json`, `models.json` or `auth.json`: a model or a provider added or removed, a
login), neither refusal is given: the launch goes on with the warning. pi writes
`auth.json` itself when it renews a login, and that counts too.

**A wrong refusal is possible in two cases, and only these:**

- where bb's own refresh of pi's list has failed (bb then serves the list it kept, of
  any age, and says nothing) AND a model was added to pi since that list was fetched
  (or a provider removed). It lasts until bb's next good refresh;
- where one of those three files was removed in the last minute (a provider or a login
  taken away with its file): a removed file has no time left to read. Only the
  two-provider refusal can be wrong then, naming a provider pi no longer has, for a
  minute.

That is why each refusal ends with the way out: try again in a minute.

What this rule reads beside bb's list is bb-app's and pi's own layout (`startedAt` in
`bb-app-runtime.json`, the three files' times), pinned against bb-app at `bb-version`
by `test/contract/pi.test.mjs`; whatever cannot be read warns, and never refuses.

One edge is left as it was: a bare id that bb lists once and that a second, held-back
model also has (a dated one, or one outside `enabledModels`) passes here, and bb refuses
it when the thread starts ("Ambiguous Pi model"). Name the one you want,
`<provider>/<id>`.

Then an id bb's pi cannot resolve ends as before: a thread that fails as it starts.

The check of a planned launch (the spawn's preview, and the check before every launch)
says the same, as a problem or as the warning `session-provider-pi-model-unchecked`,
where the kernel hands it the launch's model (`launch.model`); a kernel that does not
is refused at the launch itself, with nothing created in bb. The launch's own warning
goes to the provider command's standard error (a launch result has no place for it).
Nothing is asked of bb for a Claude launch, a pi launch with no model (bb then starts pi
on its own default), or a launch that is refused for something else.

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
| the host daemon is not connected yet, or serves another server; with `hostDaemonPort` set, the daemon at that port is not a connected host of the server (it does not say which host it is, the server does not list it, or its hosts cannot be read); bb reports the provider of the launch's harness (claude-code, or pi) as `not_installed`, `unsupported_version`, `unauthenticated`, `expired` or `unknown`; one of bb's answers cannot be read; for a pi launch, the pi configuration bb's server runs with does not list @awebai/oats-pi | `E_BACKEND_NOT_READY` |
| for a pi launch, that configuration lists @awebai/pi, and `AWEB_DELIVERY` is not in bb's machine env | `E_BACKEND_PI_LISTENER` |
| for a pi launch whose model the check is handed, bb's pi has no such model, or two of its providers serve that bare id, or the id carries pi's `:<level>` ([pi](#pi), "The model") | `E_BACKEND_LAUNCH_ARG` |
| for a launch whose choices the check is handed, a reasoning level the model does not have in bb, a service tier its provider or its model does not list, the value `default`, or a choice the provider does not declare ([launch choices](#launch-choices)) | `E_BACKEND_LAUNCH_ARG` |

Which harness these speak for: with the launch the kernel plans, only that harness's
facts are problems (a pi launch is not held up because bb's Claude is signed out, nor a
Claude launch by anything of pi's). With no planned launch (`oats readiness`, `oats bb
doctor`), Claude's state is a problem as before, and everything of pi's is one warning,
`session-provider-pi-not-ready`, which names the codes a pi launch would be refused
with; a bb with no pi installed is told nothing of pi. Where a pi launch would go on
and bb's pi settings changed after bb started, the warning is
`session-provider-pi-model-check-off` instead: the pi model check refuses nothing until
bb restarts ([pi](#pi), "The model").

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
- A bb agent's resume after a reboot depends on `oats host run`. Where it runs (the team
  container does), its shutdown stops each bb home with the host and its sweep resumes
  them, within about a minute of its start. Where it doesn't (a laptop may not), after a
  reboot a bb home reads idle and present, not lost: no sweep resumes it, and its next
  input, a message or a wake, starts its harness again on the same conversation. On a
  host without `oats host run`, an agent cut off mid-turn by a reboot does not carry on by
  itself: it waits for its next message or wake, so send it one. (Seen with a bb-app
  restart standing in for a reboot, bb-app 0.50.1; not yet with a real reboot.) To carry
  on, send it a message. Don't press Start unless you want a fresh conversation: a Start is
  a new thread and leaves the cut conversation behind.
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

## Retires

**A retire deletes the home's bb environment.** The retire hook stops and archives the
home's threads, and bb unarchives an archived thread at one press, with no question
asked. Where the home is then still on disk (`oats retire --keep-dir`, or a retire that
ended quarantined), a message to the unarchived thread started the agent in the retired
home, outside OATS. So the hook, after the stop and the archive, asks bb to delete the
home's environment (`bb environment delete <id>`). bb marks it destroyed, refuses every
message to a thread whose environment is gone (`thread_environment_unavailable`), and
starts nothing.

- The home directory is not touched, byte for byte: for a local directory bb did not
  make, the delete removes bb's record and nothing on disk.
- The conversation stays in bb, readable, as an archived thread.
- The retire never waits for bb: bb answers the delete at once and finishes within
  seconds. A delete bb refuses, does not answer, or that meets a bb that is down fails
  no retire: the threads stay archived only. The retire's warning says so, and the hook
  writes one line on its standard error with bb's own words and the command to run in
  bb (`bb environment delete <id>`).
- The receipt (`environments`) names each environment bb was asked to delete.

**When the retire archives only.** bb keeps ONE environment per home, shared by every
thread that runs there: the agent's, and any thread a person opened in the home's bb
project. bb's delete takes it from all of them, and nothing bb shows tells a person's
thread from the agent's. So the hook deletes only where it is certain, and otherwise
leaves the threads archived, as before this release, and says why in the retire's
warning:

- **The environment is not the home's own local directory.** Only an environment whose
  path is the home and whose kind is local-path (`project-checkout`, a directory bb
  does not manage) is deleted. A worktree, a remote environment, or one at another
  directory never is. Where a thread of the home's own is on such an environment (one
  moved to another directory), the warning says so; a person's thread of the home's bb
  project that runs elsewhere is passed over in silence.
- **A thread on it is not the home's own.** The provider keeps a record of the threads
  its launches made for each home, and deletes only where bb's list of the threads on
  the environment (`bb thread list --environment <id> --include-archived
  --include-hidden`) was read whole and every thread in it is in that record. A
  person's thread there, archived or not, keeps the environment: it is theirs too.
- **The home has no record.** A home spawned before this release has none, and a
  record is never made up afterwards: such a home is archived only for good. That is
  not a failure. Once such a home is started with this release, it has a record of its
  new threads only: its older threads are not in it and keep the environment, and the
  warning then names them as threads that are not in the home's record. Archive only
  is also what a thread whose launch could not write the record gets (the launch warns
  on its standard error and goes on), and a launch whose answer was lost, and a record
  that cannot be read whole (the warning then says what is wrong with it).
- **A thread of the home could not be stopped and archived**, or bb could not be read.
- **A thread has no environment yet.** bb makes a thread's environment when its first
  turn starts. A home retired before that (bb held the turn in line) has nothing to
  delete, and its thread, unarchived, would still start.
- **bb did not do the delete** (above).

The rule: the retire warns whenever a thread of the home is left without a deleted
environment, because with the home kept that thread can be started from bb.

> **The warning reaches CLI users only.** `oats retire` prints the hook's warning. The
> Desktop's Retire dialog shows no plan warnings and no hook output (oats#2102): a
> retire made there that archived only says nothing. Check in bb
> (`bb environment show <id>`), or retire from the CLI.

**The record.** One file per home in `$XDG_STATE_HOME/oats-bb/homes/` (by default
`~/.local/state/oats-bb/homes/`, on macOS too), for the OS user that runs OATS and bb.
Directories are `0700`, files `0600`.

- It holds the home directory's identity and one thread id per line, nothing else: no
  title, no path, nothing of a person's, no secret. Its name is a hash of the home's
  real path.
- It is a record of one directory, not of a path: the home's inode and birth time must
  match (the device and inode where the filesystem gives no birth time). A home made
  again at the same path is another directory, and an earlier home's record vouches for
  nothing there.
- A file with another mode or owner, a link, or a file with a second name is not read.
  A line that was not written whole makes the record malformed. Both mean archive only.
- Each launch adds its thread's id. Only the retire hook reads it, for this one
  question, and removes it once it has decided: the environment deleted, or a no that
  rests on what it read (a thread that is not the home's own, the wrong kind, a record
  that is malformed). After such a no, the home is archived only for good. A record
  the hook does not read (another mode or owner, a link, a second name) is left as it
  is: it is not the provider's to remove. No other
  command reads it: which threads are a home's stays by project, environment and the
  recorded endpoint.
- Its place is read from the environment of the process that runs OATS
  (`XDG_STATE_HOME`). A launch and a retire that run with different values look in two
  places: the retire then finds no record and archives only.
- Where the hook could not decide (bb could not be asked or read, a thread would not
  stop, bb did not do the delete), the record stays, so a retire run again can still
  delete. So a record can outlive a home whose retire never got through to bb. That is harmless: it holds thread ids only, and a later home
  at that path is another directory, which it does not match (that home's first launch
  replaces it). To remove leftovers by hand, delete the files in
  `$XDG_STATE_HOME/oats-bb/homes/` (`~/.local/state/oats-bb/homes/`) while no bb home
  of this user is running: a file removed under a live home only makes that home's
  retire archive only.
- It is outside the home, and in bb's full mode the agent runs as the same user: it is
  not out of the agent's reach. A launch in a sandboxed mode denies the directory.

## Two bbs on one host

One bb per workspace: where two workspaces share a host, each has a bb-app of its own.
The first runs on bb's default ports. The second needs everything of its own:

- its own data directory, server port and host daemon port:
  `bb-app --data-dir <dir> --server-bind-host 127.0.0.1 --server-port <port> --host-daemon-port <port>`;
- its own service unit, if you run bb as one;
- its own pi configuration directory, if it runs pi agents (`piAgentDir`, and
  `PI_CODING_AGENT_DIR` in that bb server's environment);
- the OATS plugin for bb installed in it too: a bb's plugins are its data directory's.

Then, in that workspace's `oats-local.yaml`:

```yaml
settings:
  oats.bb:
    trust: single-user
    server: http://127.0.0.1:<its server port>
    hostDaemonPort: <its host daemon port>     # a number
    dataDir: <its data directory>
```

`hostDaemonPort` is what makes the second bb usable. bb's CLI finds the host daemon of
the machine it runs on by `BB_HOST_DAEMON_PORT` alone (38887 by default), never from the
server's address. Without the setting, `bb project create`, which a home's first launch
runs, goes to the first bb's daemon, and the second bb's server refuses it: the launch
fails with bb's "Host not found" (or "Cannot reach local host daemon" where no bb is on
the default port), and nothing is created in either bb. With it, every bb command the
provider runs for that workspace is told the second bb's daemon port, and the project
and the thread are made in the second bb alone (`test/contract/contract.test.mjs` pins
both against real bb). `oats bb doctor` prints the port bb's CLI is told
(`host daemon port: …`). "Something answers at that port" would also be true of the
other bb's daemon, so readiness checks what bb itself does: the daemon there says which
host it is and which server it serves (its `/status`), and the server must list that
host, connected (`bb host list`). Where it does not, the finding names the daemon, the
server and the setting. Only two of bb's commands need the local daemon, and so the
port: `bb project create` and `bb thread spawn`, which a launch runs. The others the
provider runs (reading, telling, stopping and archiving a thread, a project's env) go to
the server alone, so a home is still read and stopped whatever port is set (pinned by the
contract test). A `daemon` address on
another port than 38887 with no `hostDaemonPort` is a readiness warning
(`session-provider-host-daemon-port`): every check passes there and the first launch
would not.

The first workspace, on bb's default ports, sets neither `server` nor `hostDaemonPort`.

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

An agent's own detached processes outlive a stop of its thread there, as anywhere: a
command it started with `setsid` or `nohup` is not ended by `oats instance stop`, which
stops the bb thread and its harness and signals no other process. The container's end is
what ends them.

## A trial against an unreleased kernel

The manifests' floor (`compatibility.oats`, `>=0.70.5`) is OATS 0.70.5, the first OATS
release that marks a host shutdown's stop; the
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
container: no port is published. In every contract container bb runs on 18886 and 18887
(`test/contract/rig.mjs`), not on its default ports: those are in Linux's ephemeral range,
where a listener on port 0 or an outgoing connection can hold one as bb starts. The
tests name that bb to the provider with `server` and `hostDaemonPort`, as a deployment
does. Moving the bb pin is one change to `bb-version` and the
manifest's `version` default (`npm run validate` keeps them equal) that the contract test
must pass.

The three contract images install bb-app, Claude Code, pi and the kernel from committed
locks with `npm ci` (`test/contract/locks/`, and its README): no dependency tree is
resolved when an image is built, so a package published upstream that minute cannot
change or fail a run. A moved pin needs its lock written again
(`test/contract/relock.sh claude`, `test/contract/relock.sh pi`); a unit test holds the
locks against `bb-version`.

A second contract file (`test/contract/sandbox.test.mjs`, its own image with a sandbox
runtime) runs bb's sandboxed modes with the sandbox really started, through the tests' own
entry: it is where the deny rules are shown to hold, and where their limit is pinned. Its
container must be able to make user namespaces; the CI job says what that takes on
Ubuntu.

A third (`test/contract/pi.test.mjs`, its own image: bb-app, pi, the OATS kernel's
package and @awebai/oats-pi, and a mock OpenAI-compatible endpoint) runs pi threads: the
launch, the variables through bb's project env (a grant seat's identity home among
them, read by the real `aw` in the thread), the home's skills, the readiness
of bb's pi configuration, a failed turn, input (idle, steering, a dialog), a thread OATS
stopped (archived: a tell is refused and starts nothing; unarchived by hand, a tell
starts pi again), and that no process is left in a home after a stop or a retire. Run it again
on every bump of bb-app or pi.

The first and the third file also pin the retire's delete of the home's bb environment,
for Claude and for pi: the kept home byte for byte unchanged, an Unarchive plus a
message refused with nothing started, and a person's thread on the environment leaving
it alone. The first file also pins that the conversation stays readable, and the door
bb's own Restore leaves.

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
one turn), the stop and the retire, and `oats retire --keep-dir`: the home kept, its bb
environment destroyed, its thread taking no message. CI does not run it either (it needs the network for
the workspace's framework package); run it at a bump of bb, of pi or of the kernel.
