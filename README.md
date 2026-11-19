# oats-bb: OATS on bb

`oats.bb` is an OATS capability that runs an instance as one [bb](https://getbb.app) thread
instead of a tmux session. It is a **session provider**: it declares `sessionProviders.bb`,
and the kernel calls its four commands (launch, inspect, input, stop) wherever it would
have driven tmux. tmux stays the default; nothing changes for a home that does not ask for
`--backend bb`.

- One OATS home is one bb project rooted at the home, with one live thread in it.
- Claude Code only (`harnesses: ["claude"]`). pi and Codex are not supported yet.
- bb is driven through its public CLI (`bb project …`, `bb thread …`), at one pinned
  bb-app version. Readiness also reads two of bb's HTTP addresses on loopback: the host
  daemon's `/status`, and the server's `/api/v1/system/providers/state` (bb's CLI has no
  command for a provider's sign-in state).
- There is no terminal. `oats session attach` refuses with a link, and a client shows
  **Open in bb**.

This repository will also hold the OATS plugin for bb, in its own directory.

> Status: built ahead of the contract decision (contract r7). The wire to the kernel is in
> [docs/kernel-wire.md](docs/kernel-wire.md) and follows the kernel's session-provider
> contract once that lands.

## Install

1. Install bb-app and Claude Code for the user that runs OATS, and start bb **on
   loopback** (its default):

   ```sh
   npm install -g bb-app@0.50.1 @anthropic-ai/claude-code
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

3. Set the host's facts in the deployment's `oats-local.yaml` (below): at least `version`
   and `trust`.

4. Check it, then spawn:

   ```sh
   oats bb doctor                       # or: oats readiness --soul <soul>
   oats spawn <soul> --backend bb --harness claude --name <task>-<role>
   ```

## Settings

All under `settings.oats.bb` in `oats-local.yaml`. `server`, `daemon`, `trust` and `cli`
are host-only: a committed workspace or soul file cannot set them, because they choose an
executable, an endpoint that runs commands, and a statement about this machine.

```yaml
settings:
  oats.bb:
    version: 0.50.1          # required
    trust: single-user       # required: single-user | container
```

| Setting | Default | Meaning |
|---|---|---|
| `version` | none (required) | The bb-app version this deployment runs, exactly as `bb --version` prints it. Another version is refused at readiness and at every launch: `E_BACKEND_VERSION`. |
| `trust` | none (required) | Who can reach bb's port: `single-user` or `container` (see [the trust group](#the-trust-group)). Unset or anything else: `E_BACKEND_TRUST`. |
| `server` | `http://127.0.0.1:38886` | The bb server. A loopback address only. |
| `daemon` | `http://127.0.0.1:38887` | The bb host daemon. A loopback address only. |
| `cli` | `bb` | The bb CLI: a command on `PATH`, or an absolute path. |

## What the kernel gets

| Call | What the provider does |
|---|---|
| launch | Runs the readiness checks. Finds or creates the bb project rooted at the home. Refuses if another live thread runs there. Archives the home's previous thread (a start after a stop is a fresh conversation). Writes the launch environment into `<home>/.claude/settings.local.json` (`env`, mode 0600). Runs `bb thread spawn --provider claude-code --environment <home> --prompt-file <home>/TASK.md`. Answers `{server, projectId, threadId}`. |
| inspect | One `bb thread list`. Maps bb's status (table below). A second live thread in the home is `E_SESSION_UNAVAILABLE`, naming both. A bb that does not answer is an error, never "stopped". |
| input | Reads the thread's pending interactions; while one is open, refuses with `E_SESSION_PROMPT_OPEN` and sends nothing. Otherwise `bb thread tell`. Only bb's `sent` is a submission. A `queued` tell is withdrawn (`bb thread queue delete`) and answered `E_SESSION_INPUT_QUEUED`. |
| stop | `bb thread stop`, then waits until bb shows the thread settled. Still in a turn after the grace: `E_SESSION_STOP_FAILED`. |
| retire (hook) | Archives the home's live threads. |

| bb thread | present | state | running |
|---|---|---|---|
| starting, active, stopping | true | unknown | true |
| pending, idle | true | unknown | null |
| error | true | shell | false |
| missing or deleted | false | stopped | false |

bb has no "stopped" status: a stopped thread reads `idle`, like one that finished its
turn. The kernel records its own stop and answers "stopped" itself.

**Permission mode.** `--yolo` runs the thread in bb's `full` mode; `--no-yolo` or no choice
runs `accept-edits`. A launch configuration can ask for `auto` with the argument
`--permission-mode auto`.

**What a launch refuses.** bb starts Claude Code itself, so the provider cannot pass
arguments or a process environment:

- A launch argument other than `--permission-mode auto|acceptEdits|bypassPermissions` is
  refused, by name: `E_BACKEND_LAUNCH_ARG`. Nothing is dropped silently.
- A launch environment entry that comes from a secret is refused, by name:
  `E_BACKEND_LAUNCH_ENV`. The environment travels in `.claude/settings.local.json`, and no
  secret is written there. Give bb's server the credential in its own environment instead.

The provider keeps the names it wrote in `<home>/.oats-bb/launch-env.json`, so a later
launch removes a variable it no longer carries and never touches an entry you added to
`settings.local.json` yourself.

## Readiness

`oats readiness` (and `oats bb doctor`) check, and every launch checks first:

| Finding | Code |
|---|---|
| `trust` is not set, or not one of the two words | `E_BACKEND_TRUST` |
| `version` is not set; bb is another version; the CLI cannot be run | `E_BACKEND_VERSION` |
| `server` or `daemon` is not a loopback address; bb's port answers on an address of this host that is not loopback | `E_BACKEND_EXPOSED` |
| a setting has the wrong shape | `E_BACKEND_SETTINGS` |
| bb's server or host daemon does not answer | `E_BACKEND_UNREACHABLE` |
| the host daemon is not connected yet, or serves another server; bb reports its claude-code provider as `not_installed`, `unauthenticated`, `expired` or `unknown` | `E_BACKEND_NOT_READY` |

It also reports, as a warning that blocks nothing, `session-provider-orphaned`: live bb
threads whose project root no longer exists, with their ids and the root. That is what a
retire leaves when it could not reach bb, or when an older kernel retired the home.
Archive them: `bb thread archive <id>`.

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
OATS plugin for bb routes its stop button there.

The same goes for a person's answer: answer a thread's question or permission prompt in
bb. `oats session input` never answers one; it refuses while one is open.

## A team image: two pins

A team container image that runs bb has two version pins:

1. the image's bb-app (its `package.json`), which is what gets installed;
2. this provider's `version` setting, which is what the deployment expects.

They must be equal. `E_BACKEND_VERSION`, at readiness and at every launch, is the check
that keeps them so: move both in one change. In the container, set `trust: container`,
and give Claude's token to the bb server's own environment (the image's supervisor does
this); it is never a launch environment entry.

## Development

```sh
npm test                 # manifest validation and the unit tests (a fake bb)
npm run test:contract    # the contract test: the pinned bb-app in a container (needs docker)
```

The contract test builds `test/contract/Dockerfile` at the version in
`test/contract/bb-version`, starts bb and a mock Anthropic endpoint inside the container,
and calls the provider's commands on their wire. bb runs only in the container: no port is
published. Moving the bb pin is a change to `test/contract/bb-version` that the contract
test must pass.
