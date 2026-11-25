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
(`compatibility.oats: >=0.70.0` then): it admitted that kernel, so no trial commit was made.

**The run is now on OATS 0.70.5** (`@awebai/oats@0.70.5`, gitHead
`e5e7a2a48db42140718948553e8272fb4e8e3ed4`, tarball integrity
`sha512-vpIdpZixk1FGGeH5Vkvr/8gltddBaajc3EU40GpbI/dnYnMeIBFq110wtKrUH5aXOU4LXbc9sqHZbl68wuiKUw==`),
which is also the plugin's own floor (`kernel/compat.ts`, `OATS_FLOOR`). It was moved on 2026-11-23
without recording the fixtures again: every check of the run passed on 0.70.5 against the answers
recorded at 0.70.0, and no answer it records gained or lost a field. One fixture is of the 0.70.5
run, because it is the kernel's version itself: `roster/version.json` (`test/fixtures/README.md`).
One recorded answer did differ in what it says: in `oats readiness --home` for a bb home, the item
"harness folder trust" is `status: "unknown"` with `file: "…/.claude.json"` at 0.70.0, and from
OATS 0.70.4 `status: "not-applicable"` with `file: null` ("a session provider runs this launch …
claude folder trust is not read for it"). The instance panel's eight fixtures (`panel/*.json`) were
therefore recorded again, all from one run on 0.70.5 (`test/fixtures/panel/README.md`), and the
panel's tests hold the 0.70.5 answer.
The floor is the provider's own (`compatibility.oats`: `>=0.70.0` when the run was moved, `>=0.70.5`
from oats-bb#40): it admits the kernel, so **no trial commit is made**, and the run's log says so
(`workspace: … (no trial commit: its own floor (>=…) admits the kernel)`).
This is the run the release lane asks for before an oats-bb release.

| Variable | Default | Meaning |
|---|---|---|
| `KERNEL_NPM` | `0.70.5` | the OATS release installed from npm: the registry's tarball is fetched once in the container (`npm pack`, kept as `kernel.json`) and that file is installed |
| `KERNEL_INTEGRITY` | the integrity of 0.70.5's tarball, for that version; none for another | the tarball's integrity, checked before the install; with another `KERNEL_NPM`, set it too, or leave it out for no check |
| `REQUIRE_REAL_FLOOR` | `1` | the provider's floor is its own: a floor that refuses the kernel under test fails the run. `0`: a trial, the floor is lowered inside the container (below, "The provider") |
| `KERNEL_REPO`, `KERNEL_REF` | none | with `KERNEL_NPM=` (empty), an unreleased kernel: a clone of the OATS repository and the commit to run; the clone is only read (`git archive`) and the tree is packed in the container |
| `UPDATE_FIXTURES` | `0` | `1`: after a run that passed, copy the recorded answers over `plugin/test/fixtures/` |
| `KEEP`, `NAME`, `IMAGE`, `DOCKER_RUN_ARGS` | as `container/ci.sh` | keep the container, name it, the image, extra `docker run` arguments (`--dns 1.1.1.1`) |
| `REAL_PI` | `0` | `1`: the pi run instead (below, "pi agents"; `container/ci.sh pi`). It is on the same kernel: `KERNEL_NPM` and `KERNEL_INTEGRITY` are this run's |

A kernel that is on no release yet, the way the run was made before OATS 0.70.0:

```sh
KERNEL_NPM= KERNEL_REPO=<a clone of the OATS repository> KERNEL_REF=<commit> REQUIRE_REAL_FLOOR=0 plugin/container/real/run.sh
```

The container is the one of the other tests (`container/Dockerfile`): `--cpus 2 --memory 6g`, no
mount, no port, no Docker socket, nothing of the host's home. The trees go in through `tar` and the
artefacts come out to `plugin/container/real/out/` (or `real/out.<owner>/` when `out/` holds
another's: container/README.md) (ignored by git, and its own directory: the other
tests' `container/out/` is emptied at each of their runs): the run's log is what `run.sh`
prints, and beside it are the screenshots, `fixtures/` (the recorded answers), `answers/` (two more
kernel answers kept as evidence), `doctor.txt` (the provider's readiness), `install.txt` (the
plugin's install), `bb.out`, `mock.out` and `mock-requests.jsonl` (the model requests), and the
run's own inputs (`rpc-input.json`, the children's `task-*.md`). A run that FAILS, at its setup or
after, also keeps `bb-logs/` (`bb-logs.sh`), which is where a bb that did not start says why: bb's
own logs (the files named `*.log` of bb's log directory, the last 2000 lines of each, 1 MB at
most) and bb's own crash reports (`process-*.json` there, one per uncaught error of a bb process,
1 MB at most: the error's name, message, stack and code, the process's name and pid, the time,
and the runtime's version, platform, architecture and executable). Nothing else of bb's data is
read, nor any login. It needs the network for
npm and for the `oats.framework` package (github.com); nothing else leaves the container. A run
takes about 43 minutes (24 Nov 2026), and grows with each part.

## CI runs it

`container/ci.sh all` ends with this run (`ci.sh real` is the run alone), and the workflow
(`.github/workflows/plugin.yml`) runs `ci.sh real` as a job of its own, `plugin-real`, beside the
unit and the live stages' jobs: the kernel is a release on npm that the
provider's floor admits, and the provider is this checkout's own (`oats-package/`), so a CI runner
needs nothing but docker and the network. The run has a container of its own (with `ci.sh all`,
started once the unit and live tests' container is gone), and its artefacts are kept as the job's own
(`plugin-real`).

In CI the kernel is the release named above, with its integrity checked. A newer kernel is a
change to `run.sh` (`KERNEL_NPM`, `KERNEL_INTEGRITY`), with `UPDATE_FIXTURES=1` when the answers
are to be recorded again: the recording, the tests' literals and the two READMEs' refs change
together.

## What is in the container

| File | Runs | Does |
|---|---|---|
| `run.sh` | on the host | starts the container, copies in the plugin, the provider's tree and, for an unreleased kernel, the kernel's tree (this checkout's `oats-package/` as committed at `HEAD`; uncommitted changes there stop the run), runs the two scripts below, copies the artefacts back to `real/out/` |
| `setup.sh` | in the container | the installs and the services, in this order (below) |
| `bb-logs.sh` | in the container, by `run.sh` (and `../ci.sh`) when the run failed | copies bb's own logs, cut short, and its crash reports beside the artefacts (`bb-logs/`), and says what bb's log directory holds |
| `workspace.sh` | in the container | the provider as a package, the throwaway workspace, the deployment; and a second workspace and deployment with NO bb session provider (`$REAL/plain/deploy`: oats.core alone), for `parts/plain.mjs` |
| `bb-plugin-command.sh` | by `setup.sh` and `scenario.mjs` | runs a command one of bb's plugins adds to its CLI (`bb concurrency-limit status`), waiting up to 60 s for bb to have it; `bb-plugin-command.test.sh` is its test, run by `container/unit.sh` |
| `mock-anthropic.mjs` | in the container | the mock model |
| `oats-record.mjs` | as the plugin's `oats` | the recording wrapper |
| `scenario.mjs` | in the container | the run itself: the acts, the checks, the screenshots |
| `parts/<feature>.mjs` | by `scenario.mjs` | the steps a feature adds for its own acts, run after parts A and B in the files' order (`parts/README.md`). `tagged.mjs` is the LAST and must stay last: it pins the provider by a scratch tag (`v0.4.0`, made in the container), which changes what the kernel prints as the provider's version for every read after it |
| `fixtures.mjs` | by `scenario.mjs` | writes the recorded answers, with their two substitutions |
| `pi/` | with `REAL_PI=1` only | the pi run: its part of the setup, its mock model, its scenario (`pi/README.md`) |

Every image of the real run is taken in bb's light theme and again in its dark one (`…-dark.png`).
The run also says, for each change, WHICH ROAD showed it, by order and not by the clock, from the
wrapper's records of the plugin's own calls: "by its events" only where the snapshot that has the
change is of a status read that had ENDED before the command that made the change began (no
state of the kernel's has changed before that, so that answer cannot hold it) and the plugin
read that instance's events since (`server/core.ts`, the event path); "by a status read" where
the snapshot is of a status read that started after the kernel's record; and "not told", with
why, in every other case: a status read that ended or was in flight after the command began may
hold the change by itself (for a stop the kernel's row says stopped from the moment it records
the stop's start, seconds before it writes the "stopped" event: so a stop can be "not told"). Then it waits
for the status read that started after the record, which must confirm what was shown, and prints
that delay beside the first. The run's freshness line says it ("the claim N ms by its events (the
status read confirmed it at M ms)"), and one check holds the event path against the real kernel:
at least one of the changes measured was shown by its events. A change that a status read shows
first, or whose road is not told, is no failure by itself.

The run also measures freshness (the UX standard, section 6): how long after the kernel recorded a
claim set, a claim cleared and a stop the plugin's own snapshot has it, counted from the kernel's
own record (the time of the event the change wrote, read from `oats instance events --json`, so the
`oats` command's own start-up is not in it); the kernel's own `oats status` time is said beside it,
with the delay from before the command, and a NOTE reports either delay over 3 s. The run's last
lines hold them in ONE line, in every run that reaches its end, green or red ("== freshness, measured …: the claim N ms, the claim
cleared N ms, the agent stopped … N ms"), and `out/freshness.json` keeps them: a drift is to be
seen there, since the delays are printed and fail nothing (the 3 s bar is asserted on a real host
by the release's QA): what the check ASSERTS is the order of reads (a bound on elapsed time
failed pull requests at random on a slow runner): the change comes, and no snapshot it polled on
the way was the answer of a read that started after the kernel's record and yet without the change
(a snapshot's `at` is its read's start). It
shows the server's one read at once (step A5b2; `FOLLOW_UP_WITHIN_MS`, `server/core.ts`) with the
plugin's own `oats status` calls as the wrapper recorded them: the agent sets a claim and clears it
while the read the claim started is in flight (each status is held 600 ms for that, and the clear is
made the moment the plugin's `oats status` is seen running in the process list), and the next
read must start under 1 s after the first ended, which no other read does (and never before it
ended: two calls alive at once fail the step); then it sets a claim
again, in that second read, and the read after it must have waited the pause (1 s or more): never
two reads at once in a row. It tries the three up to four times (whether each change lands in the
read it is meant for is timing) and prints every try's reads and their times. It depends on the
kernel's speed in one way, and says so: where the first read of every try took about the server's
2 s limit or more, the server rightly waits the pause, and the run prints a NOTE that the read at
once is NOT SHOWN, in place of a pass or a failure; and a NOTE where no read followed a pair. And
at its end it compares its images: two scenes of different states must not be the same image (the
thread's own row says its agent's state at every width).

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
  `E_CAPABILITY_INCOMPATIBLE: oats.bb requires oats >=<its floor>; this kernel is …`.
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
  The provider launches in full mode only, and the plugin asks for it on every spawn of a bb thread (`--yolo`),
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

## pi agents: a run of its own, and what a deployment must have

The run above launches Claude Code only: its bb has no pi, and a preview or a spawn with the
harness pi is refused there (`test/fixtures/spawn/spawn-preview-pi-refused.json` and
`spawn-pi-refused.json` are that refusal, recorded). That a person can launch a pi agent from the
plugin's New agent form is shown by a second run, in the same container, with the same setup and
on the same kernel, with what pi needs added:

```sh
plugin/container/ci.sh pi         # or: REAL_PI=1 plugin/container/real/run.sh
```

`pi/README.md` says what it does and what it found. It is a job of its own in CI (`plugin-pi`), it is not
part of `ci.sh all`, it leaves this run and its recorded fixtures as they are, and its artefacts are in
`real/pi/out/`.

What it had to add to this run's setup is what any deployment must have before the New agent form
can launch a pi agent on bb. In plain words, on the machine that runs bb:

1. **pi is installed, and on the PATH** of both bb's server and the `oats` the plugin runs. bb
   starts the command `pi` by name. Install it before bb's server starts, or restart bb after:
   bb then lists pi among its providers as ready.
2. **The OATS bridge for pi, `@awebai/oats-pi`, is installed in the pi configuration bb's server
   runs with**, at the same version as the OATS kernel (`pi install npm:@awebai/oats-pi@<version>`, with
   the version `oats version` prints). The two are released together and tested only as a pair.
   Without the bridge a pi agent loads none of its skills, so OATS refuses to launch it
   (`E_BACKEND_NOT_READY`). That configuration is `~/.pi/agent` of the user that runs bb, unless
   bb's server was started with `PI_CODING_AGENT_DIR`; then name that directory in
   `settings.oats.bb.piAgentDir` in `oats-local.yaml`. The directory must be writable by that user.
3. **The aweb extension for pi, `@awebai/pi`, is NOT in that configuration.** A person who also
   runs pi agents in tmux usually has it in `~/.pi/agent`: OATS then refuses every pi launch on bb
   (`E_BACKEND_PI_LISTENER`). Give bb's server a pi configuration of its own (point 2).
4. **A kernel that pairs with a released bridge.** The pi run is on 0.70.5, and before that on
   0.70.3: those two are what was run. By the provider's README the question a pi extension's
   dialog asks sets a claim, and so reaches the home's card, only from bridge 0.70.2.
5. **A model pi can use.** pi's logins and model list are those of that same configuration. The
   form's model field lists them (bb's own list for its pi provider): pick one, or give the soul a
   `launch: { harness: pi, model: <provider>/<id> }`. A soul whose `launch:` names a Claude model
   and is spawned with the harness pi gets NO model from the kernel (the preview's
   `launch.effective.model` is `null`), and bb's pi then starts on its own default.
6. Every spawn of a bb thread from the plugin already asks for bb's full mode (`--yolo`), which a pi launch
   needs.

The provider's README ("pi") has the detail and the reasons; `oats bb doctor` in the deployment and
the form's own preview say which of these is missing.

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

**What a stop leaves of the thread, and the two providers.** The bb provider up to 0.3 stops a
home's thread and leaves it open in bb; from the release that archives at stop (oats-bb #40) it
stops and archives it. The run is right with both, and reads which one it has: from what its
first stop did (A7: the thread is archived, or there and not active), not from the provider's
manifest, whose version is the same in both until a release names the new one. It says so in a
NOTE and in its last line, and every later stop must leave the same (`run.stopArchives()`,
`run.stoppedThread()`, for the parts). With a provider that keeps the thread, everything is as
above. With one that archives: the images of the stopped agent are of its row of the roster on no
thread ("Stopped", its soul, the plain tone; bb lists no archived thread), which opens the
archived conversation, and of that thread's own row ("Stopped", since when, "Its conversation is
archived in bb. Start begins a new one.", with Start… and Retire…); and the lifecycle's part
presses Start from that row instead of the row's menu, where the Start dialog says "Starts a new
conversation.". What the read cannot tell: a provider that
changed what its stop does, at every stop alike, passes as the other kind; the NOTE is where to
look.

The Stop dialog says two things of the thread, and the lifecycle's part holds each to its own
fact: before the stop, what a provider of the version the kernel prints does (`oats capabilities
show oats.bb --json`, compared as the plugin compares it: a release from 0.4.0 archives); after
it, what bb shows of the thread. This run's workspace pins the provider by commit, and the kernel
then prints the commit as its version: a commit pin reads as "not known to archive", so the
confirmation warns on both providers here, and only the result differs. A provider pinned by a
release is not exercised by this run.

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

- **A stop plan's `midTask` is reported activity, not a turn.** It is `true` for a session that
  runs (a harness is loaded: from the provider that scans its harness, oats-bb #40, an idle bb
  agent too; a tmux agent always) or for uncommitted work, and `"unknown"` from a provider that
  cannot tell (the bb provider before #40, for an idle thread). The plugin's confirmation says
  nothing from it: it says "uncommitted work" from the plan's `work`, and "mid-turn" from bb's
  own word on the thread, as words after the agent's name on its one line.
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
