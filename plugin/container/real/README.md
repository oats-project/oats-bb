# The real run: the plugin against a real kernel and the bb session provider

The unit and live tests run the plugin against a fake `oats` that prints the files of
`test/fixtures/`. This directory is the other half: one container with bb-app, a real OATS kernel,
the bb session provider (`oats.bb`), Claude Code on a mock model, and the plugin installed from the
checkout. It drives the plugin through its own RPC, checks every act in `oats status --json` and in
bb, takes the screenshots, and records what the kernel printed: that recording is where the
fixtures marked "recorded" in `test/fixtures/README.md` come from.

```sh
plugin/container/real/run.sh        # or: plugin/container/ci.sh real
```

The recording in `test/fixtures/` is of 2026-11-21: the plugin of this checkout against OATS
0.70.0 from npm (`@awebai/oats@0.70.0`, gitHead `7512163012876511088da79168c74540f9523c66`,
tarball integrity
`sha512-DeVGFZi1ev2ClxF3p/UV0OBc4XwAWuLjEckJ56rz7UVCg8deavPAOHPjeIuyIvg5l4g52rzRBtoe3aVsxQrxrQ==`)
and the bb session provider of this repository's `main` at
`134ca09ab6d89c0432ba2e53cd7bbfd9bfc185e5` (oats-bb#8 merged; wire 1.3), bb-app at the root `bb-version`
(0.50.1), Claude Code on a mock model, no aweb. The floor was the provider's real one
(`compatibility.oats: >=0.70.0`): it admits that kernel, so **no trial commit was made**, and the
run's log says so (`workspace: … (no trial commit: its own floor (>=0.70.0) admits the kernel)`).
This is the run the release lane asks for before an oats-bb release.

| Variable | Default | Meaning |
|---|---|---|
| `KERNEL_NPM` | `0.70.0` | the OATS release installed from npm: the registry's tarball is fetched once in the container (`npm pack`, kept as `kernel.json`) and that file is installed |
| `KERNEL_INTEGRITY` | the integrity of 0.70.0's tarball, for that version; none for another | the tarball's integrity, checked before the install; with another `KERNEL_NPM`, set it too, or leave it out for no check |
| `REQUIRE_REAL_FLOOR` | `1` | the provider's floor is its own: a floor that refuses the kernel under test fails the run. `0`: a trial, the floor is lowered inside the container (below, "The provider") |
| `KERNEL_REPO`, `KERNEL_REF` | none | with `KERNEL_NPM=` (empty), an unreleased kernel: a clone of the OATS repository and the commit to run; the clone is only read (`git archive`) and the tree is packed in the container |
| `UPDATE_FIXTURES` | `0` | `1`: after a run that passed, copy the recorded answers over `plugin/test/fixtures/` |
| `KEEP`, `NAME`, `IMAGE`, `DOCKER_RUN_ARGS` | as `container/ci.sh` | keep the container, name it, the image, extra `docker run` arguments (`--dns 1.1.1.1`) |

A kernel that is on no release yet, the way the run was made before OATS 0.70.0:

```sh
KERNEL_NPM= KERNEL_REPO=<a clone of the OATS repository> KERNEL_REF=<commit> REQUIRE_REAL_FLOOR=0 plugin/container/real/run.sh
```

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

## CI runs it

`container/ci.sh all` ends with this run (`ci.sh real` is the run alone), and the workflow
(`.github/workflows/plugin.yml`) calls `ci.sh all`: the kernel is a release on npm that the
provider's floor admits, and the provider is this checkout's own (`oats-package/`), so a CI runner
needs nothing but docker and the network. The run has a container of its own, started once the
unit and live tests' container is gone, and its artefacts are kept beside theirs.

In CI the kernel is the release named above, with its integrity checked. A newer kernel is a
change to `run.sh` (`KERNEL_NPM`, `KERNEL_INTEGRITY`), with `UPDATE_FIXTURES=1` when the answers
are to be recorded again: the recording, the tests' literals and the two READMEs' refs change
together.

## What is in the container

| File | Runs | Does |
|---|---|---|
| `run.sh` | on the host | starts the container, copies in the plugin, the provider's tree and, for an unreleased kernel, the kernel's tree (this checkout's `oats-package/` as committed at `HEAD`; uncommitted changes there stop the run), runs the two scripts below, copies the artefacts back to `real/out/` |
| `setup.sh` | in the container | the installs and the services, in this order (below) |
| `workspace.sh` | in the container | the provider as a package, the throwaway workspace, the deployment |
| `bb-plugin-command.sh` | by `setup.sh` and `scenario.mjs` | runs a command one of bb's plugins adds to its CLI (`bb concurrency-limit status`), waiting up to 60 s for bb to have it; `bb-plugin-command.test.sh` is its test, run by `container/unit.sh` |
| `mock-anthropic.mjs` | in the container | the mock model |
| `oats-record.mjs` | as the plugin's `oats` | the recording wrapper |
| `scenario.mjs` | in the container | the run itself: the acts, the checks, the screenshots |
| `parts/<feature>.mjs` | by `scenario.mjs` | the steps a feature adds for its own acts, run after parts A and B (`parts/README.md`) |
| `fixtures.mjs` | by `scenario.mjs` | writes the recorded answers, with their two substitutions |

Every image of the real run is taken in bb's light theme and again in its dark one (`…-dark.png`).
The run also measures freshness (the UX standard, section 6): how long after the kernel recorded a
claim set, a claim cleared and a stop the plugin's own snapshot has it (3 s at most, counted from
the kernel's own record: the time of the event the change wrote, read from `oats instance events
--json`, so the `oats` command's own start-up is not in it; the kernel's own `oats status` time is
said beside it, with the delay from before the command; a NOTE reports either delay over 3 s), and at its end it compares its images: two scenes of
different states must not be the same image. One pair is, and is reported as a known gap (D-113 /
S1): at 390 px the thread's view says nothing of the agent's state, until the status line of the
identity row is built.

- **bb-app** at the repository's pin (0.50.1), installed by `container/setup.sh`, started sovereign
  (no account, `BB_TELEMETRY=false`, loopback, `--no-in-app-updates`). Its concurrency limit stays
  the automatic one: one running thread per processor, 2 in this container. The run is written for
  that limit (part B). The limit is a plugin's, bundled with bb, and bb loads its plugins after it
  starts: for a few seconds a bb with a machine connected can answer `unknown command
  'concurrency-limit'`. `setup.sh` waits for that command before the run starts, and fails with
  what it waited for when it never comes.
- **The kernel**: the registry's tarball of `@awebai/oats@<KERNEL_NPM>` (`npm pack`, which prints
  its integrity: `setup.sh` prints it with the release's gitHead and checks it against
  `KERNEL_INTEGRITY`), then `npm install -g` of that file, and the installed version is checked.
  For an unreleased kernel: `npm pack --ignore-scripts` in the tree, then the same install.
  `setup.sh` stops unless `oats version --json` lists `session-providers`.
- **The provider**: this checkout's `oats-package/` becomes a local git repository in the
  container, with its own floor: `workspace.sh` prints `no trial commit: its own floor (…) admits
  the kernel`. A floor that refuses the kernel under test fails the run there
  (`REQUIRE_REAL_FLOOR=1`, the default). Only a trial (`REQUIRE_REAL_FLOOR=0`, against a kernel
  that is on no release) lowers it: one **trial-only commit** goes on top that sets
  `compatibility.oats` to `>=<the kernel's version>` in both manifests (the provider's README, "A
  trial against an unreleased kernel"); it exists only inside the container and is never pushed,
  and the line then reads `trial floor >=… in place of …`. Without it such a kernel answers
  `E_CAPABILITY_INCOMPATIBLE: oats.bb requires oats >=0.70.0; this kernel is …`.
  The workspace pins the package by the container's commit:
  `oats.bb: git:file://…/oats-bb.git@<commit>`.
- **The workspace**: one member repository with five souls named as the fixtures name them
  (`oats-developer`, `oats-product-expert`, `oats-desktop-developer`, `knowledge-harvester`,
  `oats-expert`), each with `oats.core` and `oats.bb` and **no messaging capability**
  (`messaging: none`), each with `launch: { harness: claude }` (the plugin's spawn names no
  harness, and the provider runs Claude Code only). `oats-expert` works in a worktree; the others
  in a directory. Its commits have fixed dates, so the same trees give the same commit ids.
- **The deployment** (`oats onboard`): `settings.oats.bb` holds `trust: container` and the bb
  version, and there is **no launch configuration**: nothing on the host chooses bb's full mode.
  The provider launches in full mode only, and the plugin asks for it on every spawn (`--yolo`),
  so the run shows that the plugin's Spawn needs no default of the host: its preview's decision
  and its spawn's answer have `yolo: true` and name no launch configuration. The agents the
  scenario makes on the command line (part B's children) are spawned with `--yolo` too. Start and
  Restart name no mode and keep what the home recorded at its spawn; the run checks that none of
  the plugin's `session` calls carries `--yolo`.
- **The mock model**: Claude Code's user settings point `ANTHROPIC_BASE_URL` at
  `mock-anthropic.mjs` on loopback, and bb's server gets a placeholder key in its own environment
  (bb reports its claude-code provider ready only with a credential). No login, nothing spent. The
  mock answers one line of text. It asks for one tool, and only where a person's message says so:
  a message with a line `MOCK-ASK:<json>` is answered with a call of AskUserQuestion with that
  input, and the request that brings the answer back with the line of text. A task that holds `MOCK-HOLD:<name>` is
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
(`oats instance attention`); a question Claude Code asks (below); stop (plan, apply); start; restart; retire (plan, apply). Between
them, the edge cases, each with its output: a second spawn of the same name, a start on a running
agent, `oats` taking seconds (4 s more on every call, then a status that never answers:
`OATS_TIMEOUT` at 20 s, and the snapshot comes back), a stale stop plan (applied after another
stop), a stop on a stopped agent, the thread archived in bb and then Start, the thread deleted in
bb. Screenshots at 1280x800 and 390x800 of the tree's row and the thread's header row for the agent
working, idle, waiting for a person and stopped by OATS, and of its soul's page ("thread missing")
once its thread is deleted in bb.

**The question** (A5c): a message in the agent's thread makes the mock have Claude Code call
AskUserQuestion. bb then holds a pending interaction, and the hook oats.core wrote into the home's
Claude settings sets a waiting claim: `oats status --json` shows it with `producer: "oats.core"`,
`reason: "question"` and the question's text. That hook is run from the kernel's copy of the
home's modules (`<instances>/.oats-retirement/modules/…`, OATS 0.70.0), and the run prints its
command. The plugin's snapshot has the claim, the tree draws the agent as needing you, and the
home's card shows the question with one button per option. The run presses one, which is the
plugin's `threads.interactions.resolve`: bb has no pending interaction left, the model is asked
again with the answer, the claim is gone from `oats status`, and the agent is idle and drawn so
in the tree.

**Part B, the scenes the fixtures describe**: a lead with two children (`redesign-ui-lead`; the
children are spawned with `oats spawn --parent` on the command line, since the plugin's spawn names
no parent; the idle child first and, once its turn is over, the one that keeps its turn open, so
that bb's limit of two holds neither in line): its stop plan, a stale apply after one child was
stopped by itself, the stop of all three. Between them (B1b), with those two turns open, one more
agent whose first turn bb holds in line: it is stopped through the plugin, and once bb has room
again the run checks that the turn never ran (bb holds nothing in line for the thread, no model
request, the thread not active). Then an agent on a worktree with a child and one untracked file (`weekly-digest-helper`):
start, restart, the retire plan and the retire. Last, two servers registered with
`oats server add` (names under `.invalid`: no host is behind them) for the Machines page.

## What the run found

Each is the kernel's or the provider's to decide; the plugin shows what they say.

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
- **A waiting claim set by `oats instance attention` has `producer: "agent"`**; the one oats.core's
  hooks set for a question has `producer: "oats.core"`, and the row reads `running: true` while
  the question is open (the thread is in its turn).
- **A status row, and the answers of `session start` and `session restart`, carry `moduleCopy`**
  (`{runs: "kernel-copy", homeCopy: "same", differs: []}`) from OATS 0.70.0. The plugin does not
  draw it.
