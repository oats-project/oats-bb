# The real run: the plugin against a real kernel and the bb session provider

The unit and live tests run the plugin against a fake `oats` that prints the files of
`test/fixtures/`. This directory is the other half: one container with bb-app, a real OATS kernel,
the bb session provider (`oats.bb`), Claude Code on a mock model, and the plugin installed from the
checkout. It drives the plugin through its own RPC, checks every act in `oats status --json` and in
bb, takes the screenshots, and records what the kernel printed: that recording is where the
fixtures marked "recorded" in `test/fixtures/README.md` come from.

```sh
KERNEL_REPO=<a clone of the OATS repository> PROVIDER_REPO=<a clone of oats-bb with the provider> \
  plugin/container/real/run.sh
```

| Variable | Default | Meaning |
|---|---|---|
| `KERNEL_REPO` | none, required | a clone of the OATS repository that holds `KERNEL_REF`; only read (`git archive`) |
| `KERNEL_REF` | `5a9db77014443607131f1ed5def0867dd1597dc0` | the kernel commit (oats-project/oats#1991, OATS 0.69.21 with the feature `session-providers`) |
| `PROVIDER_REPO` | none, required | a clone of oats-bb that holds `PROVIDER_REF`; only read |
| `PROVIDER_REF` | `37e9abaf83157cf0cdcfc09022ea0a701dee2a78` | the provider commit (branch `provider`, wire 1.3) |
| `UPDATE_FIXTURES` | `0` | `1`: after a run that passed, copy the recorded answers over `plugin/test/fixtures/` |
| `KEEP`, `NAME`, `IMAGE`, `DOCKER_RUN_ARGS` | as `container/ci.sh` | keep the container, name it, the image, extra `docker run` arguments (`--dns 1.1.1.1`) |

The container is the one of the other tests (`container/Dockerfile`): `--cpus 2 --memory 6g`, no
mount, no port, no Docker socket, nothing of the host's home. The trees go in through `tar` and the
artefacts come out to `plugin/container/real/out/` (ignored by git, and its own directory: the other
tests' `container/out/` is emptied at each of their runs): the run's log is what `run.sh`
prints, and beside it are the screenshots, `fixtures/` (the recorded answers), `answers/` (two more
kernel answers kept as evidence), `doctor.txt`, `bb.out` and `mock.out`. It needs the network for
npm and for the `oats.framework` package (github.com); nothing else leaves the container. A run
takes about five minutes.

## Why CI does not run it

`container/ci.sh all` does not call `run.sh`, and the workflow does not either. The kernel it needs
is an unmerged pull request of another repository (oats-project/oats#1991), and the provider is
not on this repository's `main` yet: a CI runner has neither tree. It can join CI when both of
these hold:

1. an OATS release that lists `session-providers` is on npm: `setup.sh` then installs
   `@awebai/oats@<that version>` instead of packing a tree, and `KERNEL_REPO` goes away;
2. the provider is in this repository (`oats-package/`), with its `compatibility.oats` floor at
   that release: `workspace.sh` then pins the checkout's own tree, the trial-only commit that
   lowers the floor goes away, and so does `PROVIDER_REPO`.

Until then a person or an agent runs it by hand when the kernel, the provider or the plugin's
`kernel/` changes, and with `UPDATE_FIXTURES=1` when the answers are to be recorded again.

## What is in the container

| File | Runs | Does |
|---|---|---|
| `run.sh` | on the host | starts the container, copies in the plugin, the kernel's tree and the provider's tree, runs the two scripts below, copies the artefacts back to `real/out/` |
| `setup.sh` | in the container | the installs and the services, in this order (below) |
| `workspace.sh` | in the container | the provider as a package, the throwaway workspace, the deployment |
| `mock-anthropic.mjs` | in the container | the mock model |
| `oats-record.mjs` | as the plugin's `oats` | the recording wrapper |
| `scenario.mjs` | in the container | the run itself: the acts, the checks, the screenshots |
| `fixtures.mjs` | by `scenario.mjs` | writes the recorded answers, with their two substitutions |

- **bb-app** at the repository's pin (0.50.1), installed by `container/setup.sh`, started sovereign
  (no account, `BB_TELEMETRY=false`, loopback, `--no-in-app-updates`). Its concurrency limit for the
  host is set to 8: the automatic one is one running thread per processor (2 in this container),
  and the run keeps two turns open while a third agent takes its own.
- **The kernel**: `npm pack --ignore-scripts` in the tree, then `npm install -g` of the tarball.
  `setup.sh` stops unless `oats version --json` lists `session-providers`.
- **The provider**: its tree becomes a local git repository with one **trial-only commit** on top
  that sets `compatibility.oats` to `>=<the packed kernel's version>` in both manifests (the
  provider's README, "A trial against an unreleased kernel": its real floor, `>=0.70.0`, refuses a
  kernel built from an unmerged branch). That commit exists only inside the container. The
  workspace pins the package by it: `oats.bb: git:file://…/oats-bb.git@<commit>`.
- **The workspace**: one member repository with five souls named as the fixtures name them
  (`oats-developer`, `oats-product-expert`, `oats-desktop-developer`, `knowledge-harvester`,
  `oats-expert`), each with `oats.core` and `oats.bb` and **no messaging capability**
  (`messaging: none`), each with `launch: { harness: claude }` (the plugin's spawn names no
  harness, and the provider runs Claude Code only). `oats-expert` works in a worktree; the others
  in a directory. Its commits have fixed dates, so the same trees give the same commit ids.
- **The deployment** (`oats onboard`): `settings.oats.bb` holds `trust: container` and the bb
  version, and a default launch configuration for Claude Code sets `yolo: true`. The image has no
  bubblewrap, so in bb's sandboxed modes every command would wait for a person; the plugin's spawn
  has no `--yolo`, so the host's default carries it.
- **The mock model**: Claude Code's user settings point `ANTHROPIC_BASE_URL` at
  `mock-anthropic.mjs` on loopback, and bb's server gets a placeholder key in its own environment
  (bb reports its claude-code provider ready only with a credential). No login, nothing spent. The
  mock answers one line of text and never asks for a tool. A task that holds `MOCK-HOLD:<name>` is
  not answered while the file `mock/hold/<name>` exists: that is how the run keeps an agent
  "working" for as long as a check needs.
- **The recording wrapper**: the plugin's `oatsBin` setting names `oats-record`, which runs the
  real `oats` with the same arguments, passes its output and exit code through, and keeps one file
  per call (`records/`): the argv, the exit code, stdout, stderr. Its configuration can also make
  every call, or the calls of one command, slower: the run's "oats taking seconds".

## What the run does

Everything the plugin can do, it does through the plugin: `bb plugin rpc call oats <method>`, the
calls its UI makes. After each act the script reads `oats status --json` (the real `oats`, in the
deployment) and bb (`bb thread list`), and compares the plugin's own snapshot with the kernel's row.
A refusal counts only when it is the kernel's expected code, shown unchanged.

**Part A, one agent** (`flaky-ci-2-developer` of `oats-developer`): the spawn preview; the spawn,
which answers the new thread's id; a waiting claim set as the agent's session sets it
(`oats instance attention`); stop (plan, apply); start; restart; retire (plan, apply). Between
them, the edge cases, each with its output: a second spawn of the same name, a start on a running
agent, `oats` taking seconds (4 s more on every call, then a status that never answers:
`OATS_TIMEOUT` at 20 s, and the snapshot comes back), a stale stop plan (applied after another
stop), a stop on a stopped agent, the thread archived in bb and then Start, the thread deleted in
bb. Screenshots at 1280x800 and 390x800 of the tree's row and the thread's header row for the agent
working, idle, waiting for a person and stopped by OATS, and of its soul's page ("thread missing")
once its thread is deleted in bb.

**Part B, the scenes the fixtures describe**: a lead with two children (`redesign-ui-lead`; the
children are spawned with `oats spawn --parent` on the command line, since the plugin's spawn names
no parent): its stop plan, a stale apply after one child was stopped by itself, the stop of all
three. Then an agent on a worktree with a child and one untracked file (`weekly-digest-helper`):
start, restart, the retire plan and the retire. Last, two servers registered with
`oats server add` (names under `.invalid`: no host is behind them) for the Machines page.

## What the run found

Each is the kernel's or the provider's to decide; the plugin shows what they say.

- **A thread archived in bb keeps its Claude running in the home.** bb's archive ends no process.
  After a Start (a new thread) the old Claude is still there, and a later retire is refused:
  `E_RUNTIME_QUIESCE_FAILED: … a process works in its home (pid … node, pid … claude)`. The plugin
  shows the refusal unchanged. `bb thread stop <the archived thread>` ends the process, and the
  retire then goes through: the run does that, in its container only, and says so (step A14).
- **An agent stopped by OATS while bb held its turn in line ran its turn afterwards.** With bb's
  automatic limit (2 here) and two threads in a turn, a third agent's first turn waits in bb's
  line; its row reads `running: null`, like an idle one. `oats instance stop` of that agent
  answered ok and its row read `stopped`; when the other two stopped, bb started the waiting turn,
  and the agent did its task while OATS still called it stopped. Seen in an earlier run of this
  script, before the limit was set (the kernel's `stopped` event at 11:07:33, the model request
  of the turn at 11:07:39).
- **A stop plan calls an idle bb agent running, in the middle of a task.** For a bb session the
  kernel's plan says `session: {state: "unknown", present: true}` and `midTask: true` whether the
  thread is in a turn or idle (bb cannot tell a live idle agent from a settled one), so the
  plugin's confirmation reads "running, in the middle of a task" for an agent whose row says
  `running: null`.
- **`oats status --json` names the agents root** (`<deployment>/agents`) as `root`, not the
  deployment. The plugin does not draw it.
- **A waiting claim set by `oats instance attention` has `producer: "agent"`.**
