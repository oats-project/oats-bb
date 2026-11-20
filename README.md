# oats-bb

Official [OATS](https://github.com/oats-project/oats) package for
[bb](https://www.npmjs.com/package/bb-app): the bb session provider and plugin, which let OATS
agents run as bb threads beside the kernel's tmux backend.

Nothing has been released yet. The work arrives as reviewed pull requests, and it follows the
OATS session-provider contract as decided on the OATS side. The lane map
records how work lands here: <https://github.com/oats-project/oats/issues/1566>.

The repository holds the three parts of the integration, at one pinned bb-app version (the
`bb-version` file):

- **The session provider** (`oats-package/`, the OATS capability `oats.bb`): runs an OATS
  instance as one bb thread instead of a tmux session. This README is about it.
- **The OATS plugin for bb** (`plugin/`): shows OATS agents in bb's UI and acts on them
  through OATS. Its README is there.
- **The team image for bb** (`container/`): an OATS team image with `bb-app` in it, at the
  version in `bb-version`. Its README is there.

## The session provider

`oats.bb` declares `sessionProviders.bb`, and the kernel calls its commands (launch,
inspect, input, stop, and a readiness check) wherever it would have driven tmux. tmux
stays the default; nothing changes for a home that does not ask for `--backend bb`.

- One OATS home is one bb project rooted at the home, with one live thread in it.
- Claude Code only (`harnesses: ["claude"]`). pi and Codex are not supported yet.
- bb is driven through its public CLI (`bb project …`, `bb thread …`). Readiness also
  reads three of bb's HTTP addresses on loopback: the server's `/health`, the host
  daemon's `/status`, and the server's `/api/v1/system/providers/state` (bb's CLI has no
  command for a provider's sign-in state). [docs/wire.md](docs/wire.md) lists the whole
  surface, and what the provider and the kernel say to each other.
- There is no terminal. `oats session attach` refuses with a link, and a client shows
  **Open in bb**.

> **What it needs.** Nothing here is released yet.
>
> - An OATS kernel that speaks this provider's wire, version 1.3 (see
>   [docs/wire.md](docs/wire.md)), and that protects a provider home's own files from its
>   agent. The manifests' `compatibility.oats` floor will be the first OATS release that
>   carries both; `>=0.70.0` is a placeholder until the release lane names that version.
> - oats.aweb 1.45.0 or later: the release that registers a provider home with the host
>   wake broker without a `--backend`. With an older oats.aweb, spawning a bb home fails
>   in its spawn hook.
>
> **bb agents run in full mode (`--yolo`), and nothing else is launched yet.** A launch in
> one of bb's sandboxed modes (`auto`, `accept-edits`; that is `--no-yolo`, or no choice)
> is **refused** before anything starts (`E_BACKEND_SANDBOXED_MODE`). `oats readiness` and
> `oats bb doctor` say, as a warning on every read, that the backend launches in full mode
> only (they are not told which mode a launch would run in); the kernel's check before a
> spawn or a start, which carries the planned launch, names the refusal itself. In those modes the agent's tools can
> write files of its own home that are later run, or read as configuration, outside the
> sandbox; the rules that keep them off (the deny set, contract item 6c) come with the
> provider's next change, which lifts the refusal. This README already says what the
> provider does in a sandboxed mode, because that code is here and tested. Even then the
> modes are no security boundary until the OATS release named above protects the home's
> instructions, hooks and settings from the agent that runs in it.
>
> **No release yet, and what its notes will say.** oats-bb is not released before a run
> against a real OATS kernel with `--backend bb`. The first release's notes say: bb homes
> run in bb's full mode, and claim no sandbox boundary.

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
     oats.bb: git:github.com/<org>/oats-bb@v0.1.0
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

   `--yolo` is bb's full mode, the only one a launch is taken in for now (above).

## Settings

All under `settings.oats.bb` in `oats-local.yaml`. `server`, `daemon`, `trust` and `cli`
are host-only: a committed workspace or soul file cannot set them, because they choose an
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

The capability declares no host requirement for `bb`: a soul that has it may run on tmux on
a host with no bb at all, and `cli` may point off `PATH`. Readiness is what checks the CLI
(`E_BACKEND_VERSION` when it cannot be run).

## What the kernel gets

| Call | What the provider does |
|---|---|
| launch | Runs the readiness checks. Finds or creates the bb project rooted exactly at the home. Refuses if another live thread runs there. Stops and archives the home's previous thread (a start after a stop is a fresh conversation), and stops the home's archived threads: bb keeps an archived thread's Claude process, in the home, until it is stopped. Writes the launch environment, and in a sandboxed mode the sandbox entries, into `<home>/.claude/settings.local.json` (mode 0600). Runs `bb thread spawn --provider claude-code --environment <home> --prompt-file <home>/TASK.md`. Answers `{server, projectId, threadId}`. |
| inspect | One `bb thread list`. Maps bb's status (table below). A second live thread in the home is `E_SESSION_UNAVAILABLE`, naming both. A bb that does not answer is an error, never "stopped". |
| input | Reads the thread's pending interactions; while one is open, refuses with `E_SESSION_PROMPT_OPEN` and sends nothing. Otherwise `bb thread tell`. Only bb's `sent` is a submission. A `queued` tell is withdrawn (`bb thread queue delete`) and answered `E_SESSION_INPUT_QUEUED`, whatever the delete says: where the copy could not be withdrawn the message may arrive anyway, and the mail that carried it stays unread, so the agent may see it twice and never loses it. |
| stop | Withdraws what bb holds in line for the thread (a turn bb's concurrency limit has not started yet: bb would start it by itself later), then `bb thread stop`, then waits until bb shows the thread settled, for the grace the kernel gives, counted from the moment `bb thread stop` answered. Stopped means settled AND nothing left in line; still in a turn after the grace, or a held turn that could not be withdrawn: `E_SESSION_STOP_FAILED`. A thread archived in bb is stopped like any other. |
| retire (hook) | For each of the home's live threads: withdraws what bb holds in line for it, stops it, and archives it once the stop is confirmed (a thread it could not stop is left, and named in a warning). Then stops the home's threads that were archived before. It asks bb for every home that has the capability: the home is its agent's to write, so nothing in it proves there is no thread. |
| stop (no endpoint) | Finds the home's bb project and stops every live thread that runs in the home, and its archived threads: the kernel's cleanup after a launch whose answer was lost, or whose caller was killed while it ran. `stopped` also when there is none; `E_SESSION_STOP_FAILED` when bb's lists cannot be read. A thread bb made at or after the time the kernel says the failed launch was sent (`launchSent`) is taken to be that launch's, and is archived once stopped, so the next start launches (if bb does not archive it, the next launch names it). That includes a thread a person started in the home after that time: it stays in bb, archived. An older thread, or any thread when the kernel gives no time, may be a person's: it is stopped and stays in bb, and the next launch names it until it is archived (in bb, or by the retire). |

| bb thread | present | state | running |
|---|---|---|---|
| starting, active, stopping | true | unknown | true |
| pending, idle | true | unknown | null |
| pending or idle, with a turn bb holds in line (its concurrency limit) | true | unknown | true |
| error | false | stopped | false |
| missing, deleted or archived | false | stopped | false |

**A known limit: many archived threads.** Every start archives the home's previous
thread, and bb keeps an archived thread's Claude process until the thread is stopped, so
a stop, a retire and a launch stop the home's archived threads (several at a time). A bb
project that holds more of them than fit the command's time (some hundreds, fewer on a
small or busy machine) makes the stop fail, and it says so: how many were stopped, of how
many, and the remedy. Remove old archived threads of that project in bb: for each,
`bb thread stop <id>`, then `bb thread delete --yes <id>`.

bb has no "stopped" status: a stopped thread reads `idle`, like one that finished its
turn. The kernel records its own stop and answers "stopped" itself. A thread in `error`
is a lost session (bb never resumes an interrupted turn): it reads as stopped, and the
kernel may resume it with an input, which restarts the thread in its own conversation.

**Permission mode.**

| The launch | bb's mode | |
|---|---|---|
| `--yolo` | `full` | launched |
| `--no-yolo`, or no choice | `accept-edits` | refused for now: `E_BACKEND_SANDBOXED_MODE` |
| a launch configuration's argument `--permission-mode auto` | `auto` | refused for now |
| `--permission-mode acceptEdits` | `accept-edits` | refused for now |
| `--permission-mode bypassPermissions` | `full` | launched |

Where yolo and the argument disagree (`--yolo` with a mode other than
`bypassPermissions`; `--no-yolo` with `bypassPermissions`), the launch is refused
(`E_BACKEND_LAUNCH_ARG`): the provider never picks one.

**The sandbox** (what a launch in a sandboxed mode does, once such a launch is taken). In bb's sandboxed modes (`auto`, `accept-edits`), bb's sandbox applies to
the agent's commands: by itself, `aw` could not reach the aweb server and
`oats instance attention` could not write the deployment's events file. So in those modes
the launch adds, to the home's `.claude/settings.local.json`, exactly the entries the kernel
hands it:

- `sandbox.network.allowedDomains`: the hosts of the home's own messaging, knowledge and
  tasks providers, each taken from that provider's recorded settings;
- `sandbox.filesystem.allowWrite`: the deployment's events directory.

Nothing else is added, and nothing an agent, a task, a mail or a launch argument says can
add one. The entries add to bb's own sandbox settings; they never replace a restriction.
The provider records what it wrote in `<home>/.oats-bb-sandbox.json`, never touches an
entry you put in the file yourself, and removes exactly its own on the next launch that no
longer carries them. In `full` mode there is no sandbox and it writes none. `oats readiness`
lists, for a home, each host and path with who asked for it.

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
plans no launch: there the provider can say only what the home's last launch left on
record.

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
  (after the launch input's own checks), until the provider's next change brings the deny set (above).
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
- A file of the home that the provider reads (`.claude/settings.local.json`, its own
  records) and that is not a regular file there (a link, a pipe, a directory), is larger
  than 1 MiB or is not a JSON object: `E_SESSION_START_FAILED`. The provider follows no
  link out of the home, and puts nothing of such a file into a message.

A variable the launch removes on purpose (one a capability declares and this launch
leaves out) is written with an **empty value**: a settings file can set a variable but not
remove one, and bb's Claude would otherwise inherit whatever the bb server's own
environment holds under that name. Start bb's server from a clean environment all the same.

The launch's PATH addition (the home's `.oats/bin`, so the agent's plain `oats` is the
kernel that launched it) travels the same way: the env file's `PATH` is that directory
followed by the PATH the kernel ran the provider with.

The provider keeps the names it wrote in `<home>/.oats-bb/launch-env.json`, so a later
launch removes a variable it no longer carries, and it leaves alone an entry you added to
`settings.local.json` yourself under another name. A name the launch carries is the
launch's: your own entry of that name is replaced, and goes when the launch stops carrying
it.

**Leaving bb.** When a home that ran on bb starts on another backend (`--backend tmux`),
the capability's launch hook removes what the provider wrote into
`.claude/settings.local.json`: its launch environment and its sandbox entries. Yours stay.

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
| the host daemon is not connected yet, or serves another server; bb reports its claude-code provider as `not_installed`, `unsupported_version`, `unauthenticated`, `expired` or `unknown`; one of bb's answers cannot be read | `E_BACKEND_NOT_READY` |

For a home, it lists what the provider added to the sandbox (`session-provider-sandbox`):
the entries of its record that are in `settings.local.json` now. Both files are in the
home, which its agent can write, so where they disagree readiness says so
(`session-provider-sandbox-mismatch`) and shows only what passed its checks.

On every read with no planned launch it carries the warning
`session-provider-full-mode-only`: for now the backend launches in bb's full mode only.

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

## Stops made outside OATS

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
this); it is never a launch environment entry.

In a team container (`trust: container`), spawn bb agents with `--yolo` (bb `full` mode):
the container is the boundary, as it is for tmux agents there. bb's sandboxed modes need
bubblewrap, which the hardened image doesn't carry; without it every command would wait
for a person in bb (for now a launch without `--yolo` is refused altogether, above).
Readiness says so wherever bubblewrap is missing
(`session-provider-sandbox-unsupported`, a warning: it refuses nothing).

## A trial against an unreleased kernel

The manifests' floor (`compatibility.oats`, `>=0.70.0`) is a placeholder for the first
OATS release that carries both the session-provider wire 1.3 and the kernel's protection
of a provider home's files ([What it needs](#what-it-needs)); the release lane sets the
real number. A kernel built from an
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
npm run test:contract    # the contract test: the pinned bb-app in a container (needs docker)
```

The contract test builds `test/contract/Dockerfile` at the version in `bb-version`, starts
bb and a mock Anthropic endpoint inside the container, and calls the provider's commands
on their wire: every bb command and HTTP address the provider uses. bb runs only in the
container: no port is published. Moving the bb pin is one change to `bb-version` and the
manifest's `version` default (`npm run validate` keeps them equal) that the contract test
must pass.
