# oats-bb: OATS on bb

This repository holds the two parts of the integration between OATS and
[bb](https://getbb.app), at one pinned bb-app version (the `bb-version` file):

- **The session provider** (`oats-package/`, the OATS capability `oats.bb`): runs an OATS
  instance as one bb thread instead of a tmux session. This README is about it.
- **The OATS plugin for bb** (`plugin/`): shows OATS agents in bb's UI. It arrives in its
  own change, with its own README there.

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

> Status: built ahead of the kernel's session-provider contract. It needs an OATS kernel
> that lists the feature `session-providers` in `oats version --json`; the manifests'
> `compatibility.oats` floor (`>=0.70.0`) is a placeholder until that release has a number.
>
> It also needs the oats.aweb release that registers a provider home with the host wake
> broker without a `--backend` (the release carrying awebai/oats-aweb#293; its version is
> not known yet): with an older oats.aweb, a bb home's messaging identity is not set up.

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
   oats spawn <soul> --backend bb --harness claude --name <task>-<role>
   ```

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
| launch | Runs the readiness checks. Finds or creates the bb project rooted exactly at the home. Refuses if another live thread runs there. Archives the home's previous thread (a start after a stop is a fresh conversation). Writes the launch environment, and in a sandboxed mode the sandbox entries, into `<home>/.claude/settings.local.json` (mode 0600). Runs `bb thread spawn --provider claude-code --environment <home> --prompt-file <home>/TASK.md`. Answers `{server, projectId, threadId}`. |
| inspect | One `bb thread list`. Maps bb's status (table below). A second live thread in the home is `E_SESSION_UNAVAILABLE`, naming both. A bb that does not answer is an error, never "stopped". |
| input | Reads the thread's pending interactions; while one is open, refuses with `E_SESSION_PROMPT_OPEN` and sends nothing. Otherwise `bb thread tell`. Only bb's `sent` is a submission. A `queued` tell is withdrawn (`bb thread queue delete`) and answered `E_SESSION_INPUT_QUEUED`, whatever the delete says: where the copy could not be withdrawn the message may arrive anyway, and the mail that carried it stays unread, so the agent may see it twice and never loses it. |
| stop | `bb thread stop`, then waits, for the grace the kernel gives, until bb shows the thread settled. Still in a turn after it: `E_SESSION_STOP_FAILED`. |
| retire (hook) | Archives the home's live threads. |
| stop (no endpoint) | Stops every live thread that runs in the home: the kernel's cleanup after a launch whose answer was lost. |

| bb thread | present | state | running |
|---|---|---|---|
| starting, active, stopping | true | unknown | true |
| pending, idle | true | unknown | null |
| error | false | stopped | false |
| missing, deleted or archived | false | stopped | false |

bb has no "stopped" status: a stopped thread reads `idle`, like one that finished its
turn. The kernel records its own stop and answers "stopped" itself. A thread in `error`
is a lost session (bb never resumes an interrupted turn): it reads as stopped, and the
kernel may resume it with an input, which restarts the thread in its own conversation.

**Permission mode.**

| The launch | bb's mode |
|---|---|
| `--yolo` | `full` |
| `--no-yolo`, or no choice | `accept-edits` |
| a launch configuration's argument `--permission-mode auto` | `auto` |
| `--permission-mode acceptEdits` | `accept-edits` |
| `--permission-mode bypassPermissions` | `full` |

Where yolo and the argument disagree (`--yolo` with a mode other than
`bypassPermissions`; `--no-yolo` with `bypassPermissions`), the launch is refused
(`E_BACKEND_LAUNCH_ARG`): the provider never picks one.

**The sandbox.** In bb's sandboxed modes (`auto`, `accept-edits`), bb's sandbox applies to
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
- A sandbox entry that is not one exact host or one exact absolute path:
  `E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`.

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
OATS plugin for bb will route its stop button there.

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
bubblewrap, which the hardened image doesn't carry; without it every command waits for a
person in bb. Readiness says so wherever bubblewrap is missing
(`session-provider-sandbox-unsupported`, a warning: it refuses nothing).

## A trial against an unreleased kernel

The manifests' floor (`compatibility.oats`, `>=0.70.0`) names the OATS release that will
list `session-providers`; the release lane sets the real number. A kernel built from an
unmerged branch reports an older version and refuses the capability
(`E_CAPABILITY_INCOMPATIBLE`). For a trial only: make a local commit on top of the commit
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
