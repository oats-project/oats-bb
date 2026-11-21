# Changelog

## Unreleased

### pi agents on bb

The bb session provider runs pi agents as well as Claude Code agents: its manifest offers
the harnesses `claude` and `pi` (contract r23: A12 to A14). A soul whose harness is pi, spawned
with `--backend bb --yolo`, runs as a thread of bb's own pi provider. Checked against
bb-app 0.50.1, pi 1.5.2 and @awebai/oats-pi 0.70.0.

What an operator must set up for pi (the README's "pi" section has the detail):

- **bb's pi configuration.** A pi launch is refused unless the pi configuration bb's
  server runs with lists `@awebai/oats-pi` (`E_BACKEND_NOT_READY`: without it pi loads
  none of the home's skills) and does not list `@awebai/pi` (`E_BACKEND_PI_LISTENER`: bb
  starts hidden pi processes that would take the agent's mail). Give bb's server a pi
  configuration of its own (`PI_CODING_AGENT_DIR`), and name it in the new host-only
  setting `settings.oats.bb.piAgentDir` (an absolute path; default: `.pi/agent` in the home
  of the user that runs bb). `AWEB_DELIVERY` in bb's machine env is accepted beside an `@awebai/pi` that is
  listed; it reaches every pi that bb server runs.
- **oats.aweb 1.48.0 or later.** Earlier releases require `@awebai/pi` in the pi folder of
  every pi launch on any backend, the package this provider refuses in bb's pi.
- **pi on the PATH oats runs with**, and node with it: a pi launch whose PATH would not
  start pi is refused (`E_BACKEND_LAUNCH_ENV`), naming which is missing.

What is different for a pi agent:

- **Its launch environment is three variables**: `OATS_INSTANCE`, `OATS_INSTANCE_HOME` and
  `PATH`, kept in the env of the home's bb project (bb's database). Nothing a capability
  adds is carried, and a launch configuration's variable is refused by name
  (`E_BACKEND_LAUNCH_ENV`). Every launch argument is refused for pi
  (`E_BACKEND_LAUNCH_ARG`).
- **The home's bb project is the provider's**: a pi launch removes every other variable
  of its env; the retire, and a move to another backend, remove them all. A bb project
  that is also rooted at another directory refuses a pi launch.
- **A retire within about a minute of a model listing in bb** (opening a thread's model
  picker) is refused by the kernel, naming a `pi` process in the home, and succeeds when
  run again: bb's listing starts a pi there that no bb command ends.

For every bb agent, Claude Code included:

- **A thread whose last turn failed is no longer read as a lost session while its agent
  process is still loaded.** bb says `error` both of a failed turn and of an agent that is
  gone. The provider now looks at the host's processes at every inspect: with a process
  of the thread alive, the thread reads as present and at rest, and an input recovers it;
  before, such a home read LOST and could be neither resumed nor sent to. With none, it
  is a lost session as before. This reads Linux's `/proc`; on a host without it (macOS) a
  thread in `error` is answered `E_SESSION_UNAVAILABLE`.
  An input to such a lost thread is told, as before: bb starts the harness again in the
  same conversation, and the kernel counts it as a resume of the home.
- **Readiness speaks for the harness of the planned launch.** A pi launch is not held up
  by bb's Claude being signed out, nor a Claude launch by anything of pi's. A read with no
  planned launch (`oats readiness`, `oats bb doctor`) reports Claude's state as before and
  pi's as one warning, `session-provider-pi-not-ready`.
- **The retire hook and the launch hook ask bb for one more thing**, the env of the home's
  bb project: a bb that cannot be asked adds a warning, as before for its threads.

The team image for bb (`container/`) adds pi and `@awebai/oats-pi`, pinned, and runs bb's
pi with a configuration of its own (`/state/home/.bb-pi`, linked to the image's
`/opt/bb/pi`). Its declared command is now `/usr/local/bin/bb-server`. It ships no model
credential for pi. Set `piAgentDir: /state/home/.bb-pi` in the deployment.

## 0.1.0

The first release of oats-bb: OATS agents run as bb threads, beside the kernel's tmux
backend. It contains:

- **the session provider `oats.bb`** (`oats-package/`, package `oats.bb` 0.1.0), which runs
  an OATS instance as one bb thread;
- **the OATS plugin for bb** (`plugin/`), which shows OATS agents in bb and acts on them
  through `oats`;
- **the team image for bb** (`container/`).

**It needs:**
- OATS 0.70.0 or later;
- for a bb home with aweb messaging, oats.aweb 1.48.0 or later (being released next). 1.45.0
  is the first version whose spawn hook runs for a bb home at all, but 1.45.0 to 1.47.0 leave
  gaps for a bb home with aweb:
  - a launch under `delivery: channel` is held to the channel package's requirement, as a tmux
    launch is;
  - an older `aweb-channel` or `@awebai/pi` on the host can open its own mail stream beside
    the wake broker's;
  - a retire may leave the home registered with the broker.

  This release's real run didn't cover aweb: its souls have no messaging capability;
- bb-app 0.50.1, the version this release is tested against (`bb-version`, and the default of
  the `version` setting). A running bb that differs from the deployment's `version` setting is
  refused with `E_BACKEND_VERSION`;
- Claude Code. pi and Codex are not supported yet.

Install: [README.md, "Install"](README.md#install).

### Full mode only, and no sandbox boundary

- **bb agents run only in bb's full mode (`--yolo`), with no sandbox between the agent and the
  account bb runs as.** bb's sandboxed modes limit accidents, not a determined agent, so this
  release claims no boundary. A launch in a sandboxed mode is refused before anything starts
  (`E_BACKEND_SANDBOXED_MODE`).
- **The plugin's Spawn always asks for full mode, and doesn't ask you.** Every spawn from bb
  is `oats spawn <soul> --backend bb --yolo`. The New agent form says so in one line ("Runs in
  bb's full mode: no sandbox."), and there is no switch. A deployment needs no full-mode
  default for the plugin's Spawn.
- **Elsewhere, a spawn must choose full mode.** A spawn from the CLI or the Desktop with
  `--backend bb` needs `--yolo`, or a default launch configuration that sets `yolo: true`.
  Without one it is refused with `E_BACKEND_SANDBOXED_MODE`.
- **Start and Restart keep the mode the home was spawned with.** A home spawned without full
  mode is refused when it starts on bb, from the plugin too.
- **A full-mode launch rewrites the bb home's `.claude/settings.local.json`.** It removes
  `sandbox`, `permissions.deny` and `permissions.blockWritesOutsideWorkingDirectories` from
  that file and rewrites `env`. An entry of your own under one of those four keys is not kept.
  Every other key, such as `permissions.allow`, is left as it is.
  (README.md, "What the kernel gets", under "The sandbox").

### Evidence

Released after the plugin's real run against OATS 0.70.0 from npm, with the package's own
floor and no trial commit, on a deployment with no launch configuration (oats-bb#12, #14 and
#15, in CI). That run doesn't cover a real model, aweb mail, or bb's phone app.
