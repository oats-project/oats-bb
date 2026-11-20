# The real run: the plugin against a real kernel and the bb session provider

The unit and live tests run the plugin against a fake `oats` that prints the files of
`test/fixtures/`. This directory is the other half: one container with bb-app, a real OATS kernel,
the bb session provider (`oats.bb`), Claude Code on a mock model, and the plugin installed from the
checkout. It drives the plugin through its own RPC, checks every act in `oats status --json` and in
bb, takes the screenshots, and records what the kernel printed: that recording is where the
fixtures marked "recorded" in `test/fixtures/README.md` come from.

```sh
KERNEL_REPO=<a clone of the OATS repository> plugin/container/real/run.sh
```

The recording in `test/fixtures/` is of 2026-11-20: the plugin of this checkout against the kernel
of awebai/oats `main` at `da296359e97eb435f6de561947ef2fdda92c927c` (oats-project/oats#2040 merged: OATS 0.69.24, session-provider wire
1.3) and the bb session provider of this repository's `main` at `92fecf735475a363c1d55158d6ff078acf017bb7` (oats-bb#3 merged), bb-app at
the root `bb-version` (0.50.1), Claude Code on a mock model, no aweb. The provider's floor
(`compatibility.oats: >=0.70.0`) is above that kernel's version, so the run lowered it **inside
the container only**, with a trial-only commit that is never pushed (below, "The provider").

| Variable | Default | Meaning |
|---|---|---|
| `KERNEL_REPO` | none, required | a clone of the OATS repository that holds `KERNEL_REF`; only read (`git archive`) |
| `KERNEL_REF` | `da296359e97eb435f6de561947ef2fdda92c927c` | the kernel commit (awebai/oats `main`, oats-project/oats#2040 merged: OATS 0.69.24, wire 1.3) |
| `UPDATE_FIXTURES` | `0` | `1`: after a run that passed, copy the recorded answers over `plugin/test/fixtures/` |
| `KEEP`, `NAME`, `IMAGE`, `DOCKER_RUN_ARGS` | as `container/ci.sh` | keep the container, name it, the image, extra `docker run` arguments (`--dns 1.1.1.1`) |

The container is the one of the other tests (`container/Dockerfile`): `--cpus 2 --memory 6g`, no
mount, no port, no Docker socket, nothing of the host's home. The trees go in through `tar` and the
artefacts come out to `plugin/container/real/out/` (ignored by git, and its own directory: the other
tests' `container/out/` is emptied at each of their runs): the run's log is what `run.sh`
prints, and beside it are the screenshots, `fixtures/` (the recorded answers), `answers/` (two more
kernel answers kept as evidence), `doctor.txt` (the provider's readiness), `install.txt` (the
plugin's install), `bb.out`, `mock.out` and `mock-requests.jsonl` (the model requests), and the
run's own inputs (`rpc-input.json`, the children's `task-*.md`). It needs the network for
npm and for the `oats.framework` package (github.com); nothing else leaves the container. A run
takes six to eight minutes.

## Why CI does not run it

`container/ci.sh all` does not call `run.sh`, and the workflow does not either. The provider is this
checkout's own (`oats-package/`), but the kernel it needs is on no npm release yet: it is a commit
of another repository, and a CI runner has no clone of it. The run can join CI when an OATS release
that the provider's floor admits (`compatibility.oats`, `>=0.70.0`) is on npm: `setup.sh` then
installs `@awebai/oats@<that version>` instead of packing a tree, `KERNEL_REPO` goes away, and
`workspace.sh` makes no trial-only commit (it makes one only where the floor refuses the kernel).

Until then a person or an agent runs it by hand when the kernel, the provider or the plugin's
`kernel/` changes, and with `UPDATE_FIXTURES=1` when the answers are to be recorded again.

## What is in the container

| File | Runs | Does |
|---|---|---|
| `run.sh` | on the host | starts the container, copies in the plugin, the kernel's tree and the provider's tree (this checkout's `oats-package/` as committed at `HEAD`; uncommitted changes there stop the run), runs the two scripts below, copies the artefacts back to `real/out/` |
| `setup.sh` | in the container | the installs and the services, in this order (below) |
| `workspace.sh` | in the container | the provider as a package, the throwaway workspace, the deployment |
| `mock-anthropic.mjs` | in the container | the mock model |
| `oats-record.mjs` | as the plugin's `oats` | the recording wrapper |
| `scenario.mjs` | in the container | the run itself: the acts, the checks, the screenshots |
| `fixtures.mjs` | by `scenario.mjs` | writes the recorded answers, with their two substitutions |

- **bb-app** at the repository's pin (0.50.1), installed by `container/setup.sh`, started sovereign
  (no account, `BB_TELEMETRY=false`, loopback, `--no-in-app-updates`). Its concurrency limit stays
  the automatic one: one running thread per processor, 2 in this container. The run is written for
  that limit (part B).
- **The kernel**: `npm pack --ignore-scripts` in the tree, then `npm install -g` of the tarball.
  `setup.sh` stops unless `oats version --json` lists `session-providers`.
- **The provider**: this checkout's `oats-package/` becomes a local git repository in the
  container. Where the provider's floor refuses the kernel under test, and only then, one
  **trial-only commit** goes on top that sets `compatibility.oats` to `>=<the packed kernel's
  version>` in both manifests (the provider's README, "A trial against an unreleased kernel").
  That commit exists only inside the container and is never pushed: the floor in the repository
  stays `>=0.70.0`. It was needed for this recording (the kernel is 0.69.24); without it the
  kernel answers `E_CAPABILITY_INCOMPATIBLE: oats.bb requires oats >=0.70.0; this kernel is …`.
  The workspace pins the package by the container's commit:
  `oats.bb: git:file://…/oats-bb.git@<commit>`; `setup.sh` prints which floor was used.
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
no parent; the idle child first and, once its turn is over, the one that keeps its turn open, so
that bb's limit of two holds neither in line): its stop plan, a stale apply after one child was
stopped by itself, the stop of all three. Between them (B1b), with those two turns open, one more
agent whose first turn bb holds in line: it is stopped through the plugin, and once bb has room
again the run checks that the turn never ran (no model request, the thread not active). Then an agent on a worktree with a child and one untracked file (`weekly-digest-helper`):
start, restart, the retire plan and the retire. Last, two servers registered with
`oats server add` (names under `.invalid`: no host is behind them) for the Machines page.

## What the run found

Each is the kernel's or the provider's to decide; the plugin shows what they say. Two findings of
the first recording (2026-11-20, an unmerged kernel) are fixed in the merged provider, and the run
now checks both: a thread archived in bb no longer leaves a Claude in the home that refuses the
retire (A12 to A14), and an agent stopped while bb held its turn in line no longer runs that turn
afterwards (B1b).

- **A stop plan cannot say whether an idle bb agent works.** For a bb session whose thread is
  idle, the kernel's plan says `session: {state: "unknown", present: true}` and
  `midTask: "unknown"` (bb cannot tell an agent that waits from one that is done); for a thread in
  a turn, or one whose turn bb holds in line, `midTask: true`. The plugin's confirmation says
  "its session is open; bb cannot tell whether it is working" for the first and "running, in the
  middle of a task" for the second.
- **A thread whose turn bb holds in line reads `running: true`** in `oats status --json`, like one
  in its turn.
- **`oats status --json` names the agents root** (`<deployment>/agents`) as `root`, not the
  deployment. The plugin does not draw it.
- **A waiting claim set by `oats instance attention` has `producer: "agent"`.**
