# Changelog

## Unreleased

### The session provider

- **A stop archives the thread: an agent OATS stopped stays stopped.** bb starts a
  stopped thread's agent again at the next message to it, in the same conversation, so a
  message typed in bb's composer restarted an agent OATS had stopped, behind OATS's back.
  bb refuses every message to an archived thread. The provider's stop now archives the
  thread once it has seen it stopped (`bb thread archive`), for pi and for Claude.
  - Nothing of the conversation is lost: it stays in bb as an archived thread (bb's
    thread list under Archived; `bb thread list --archived --project <id>`). A start was
    already a new thread.
  - A stop with no endpoint (the kernel's cleanup after a launch whose answer was lost)
    archives what it archived before: the threads bb made at or after the time the launch
    was sent. A thread that may be a person's is stopped and never archived.
  - An archive bb refuses fails no stop: the answer is `{stopped: true}`, and the
    provider's command writes one warning line on its standard error naming the thread
    (the wire's stop result has no place for it). The next start archives that thread or
    refuses, naming it.
  - A thread a person unarchives in bb takes messages again, and the next one starts its
    agent outside OATS; stop it or start it with OATS.
  - A stop with the host is not archived: where the stop input carries `reason: "host"`
    (the kernel's word for `oats host run`'s shutdown), the thread is stopped and left
    live, since the kernel resumes such a home by an input to that thread.
  - **The OATS floor rises to 0.70.5** (`compatibility.oats`; **PLACEHOLDER(A16): the
    number of the OATS release that sends `reason: "host"`, set before this is
    released**), so that no supported pairing loses a reboot's resume. With an older
    kernel (a trial), the key is absent and every stop archives: bb then refuses the input
    the kernel resumes a host-stopped home by, the home is not resumed when the host
    starts again, and `oats session start` gives it a new thread.
  - The window: a host-stopped home's thread is live and unarchived from the host's
    shutdown until the first resume sweep after it is back (the time the host is off,
    plus up to about a minute after boot). A message in it lands in a home OATS means to
    run.
  - **Upgrade: close the homes that are already stopped, once.** A home OATS stopped
    with an earlier oats.bb still has its thread live in bb, and a message there starts
    its agent again. A home also runs the provider from its own copy of the package, so a
    home spawned before this release stops with the old provider until its copy moves.
    After pinning this release and `oats sync`, for each bb home: stop it if it runs
    (`oats instance stop <name>`), move its copy (`oats instance upgrade <name>`), then
    run `oats instance stop <name>` once more. The kernel asks the provider to stop a home
    it already holds stopped, by its recorded thread, and that stop archives it
    (`test/contract/kernel/pi-run.mjs` pins it under a real kernel). It archives the
    home's own recorded thread and no other thread of its bb project. Nothing is archived
    by a status read.
  - **inspect says whether a thread at rest runs.** For a thread bb shows `idle` or
    `pending` with nothing in line, `running` was `null`. It is now read from this host's
    processes: `true` where the home's own harness is at work (a process named `pi` or
    `claude` that carries the thread's id and has the home as its working directory),
    `false` where it is not, as after `bb thread stop`. A process that only carries the
    thread's id never counts. OATS needs it to tell a home stopped with the host from one
    whose harness came back. On a host without `/proc` (macOS) it stays `null`: there a
    harness started again from bb in a stopped home goes unseen, and the stop's archive
    is what keeps it from starting. A thread in `error` whose harness is still loaded
    reads the same way (`true` where it works in the home; it was `null`); one whose
    harness is gone is a lost session, as before.
  - The retire hook finds no live thread in a home OATS stopped, so it names none in
    `archived` (for a Claude home with nothing else to remove, its answer is
    `{retired: false, reason: "nothing-to-delete"}`).

- **A home's bb thread is titled with the instance's name as words.** bb's header and
  thread list now show the name the OATS Desktop and the OATS plugin for bb draw:
  `release-070-maintainer` is "Release 070 maintainer" (every run of `-` one space, the
  first character upper-cased, nothing else changed). Before, the title was the name as
  it is. The title is given at every start and restart; a thread that is already
  running keeps its title until its instance starts again. The home's bb project keeps
  the name itself.
  - bb does not replace the title: at bb-app 0.50.1 it writes a title of its own only for
    a thread that has none (`test/contract/title.test.mjs` pins it). A rename made in bb
    (by hand, or `bb thread regenerate-title`) stays until the instance starts again.

## 0.3.0

The OATS plugin for bb shows OATS's Automations, and the agent's panel gains its Soul tab,
recorded activity and readiness. The team image's pi bridge moves to `@awebai/oats-pi`
0.70.3. Package `oats.bb` 0.3.0. Nothing changes in the session provider.

**Upgrade:**
- Pin `oats.bb: git:github.com/oats-project/oats-bb@v0.3.0`, then `oats sync`. The floor
  stays OATS 0.70.0 and bb-app 0.50.1, and 0.2.0's upgrade notes for pi agents still apply.
- For pi agents, OATS 0.70.3 with `oats update` brings the bridge's fix for a question that
  could stand unseen after a second pi died during a clear (oats-project/oats#2076). The
  team image pins `@awebai/oats-pi` 0.70.3, and the pi contract test runs with OATS 0.70.3.

### The OATS plugin for bb

- **Automations, read-only.** A page lists OATS's schedules and triggers, grouped by where
  they run: here, needing attention, or elsewhere. It shows each one's definition, last run
  and next due time, and a trigger's recorded state (`oats trigger status`).
  - A schedule's prompt and wake message are drawn whole, as the person wrote them. Every
    other text from OATS goes through the display filter.
  - The sidebar row carries a mark while a schedule's last run failed.
  - It needs an OATS that lists the feature `automations` with `automationsApi` 1. No act
    is offered yet.
- **The agent's panel, part 2, read-only.**
  - The Soul tab shows the soul the instance was spawned from (`oats inspect --home`).
  - Activity shows the instance's recorded lifecycle events (`oats instance events`, the
    last 100).
  - Readiness shows the instance's or its soul's readiness (`oats readiness --policy`).
  - The browser names only the instance. The home and the soul come from the kernel's own
    roster.

## 0.2.0

pi agents run on bb, beside Claude Code agents, and the OATS plugin for bb gains the
agent's panel. Package `oats.bb` 0.2.0.

**Upgrade:**
- Pin `oats.bb: git:github.com/oats-project/oats-bb@v0.2.0`, then `oats sync`. The floor
  stays OATS 0.70.0, and bb-app stays 0.50.1.
- For pi agents:
  - oats.aweb 1.48.0 or later, which OATS 0.70.2 pins;
  - `@awebai/oats-pi` in the pi configuration bb's server runs with, and `@awebai/pi` not
    there;
  - `settings.oats.bb.piAgentDir` naming that directory. The team image's is
    `/state/home/.bb-pi`.
  
  A pi agent's dialog raises needs-input from `@awebai/oats-pi` 0.70.2, which the team
  image now pins.
- Every bb home: on a host without Linux's `/proc` (macOS), a thread in `error` answers
  `E_SESSION_UNAVAILABLE` until it is sent a message in bb itself (below; oats-bb#22).
- Respawn bb homes, or move stopped ones with `oats instance upgrade`, to take 0.2.0.

### pi agents on bb

The bb session provider runs pi agents as well as Claude Code agents: its manifest offers
the harnesses `claude` and `pi` (contract r23: A12 to A14). A soul whose harness is pi, spawned
with `--backend bb --yolo`, runs as a thread of bb's own pi provider. Checked against
bb-app 0.50.1, pi 1.5.2 and @awebai/oats-pi 0.70.2 (`test/contract/pi.test.mjs`, with OATS
0.70.2).

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
  of its env; the retire, and a move to another backend, remove them all; a Claude launch
  of the same home removes the three names. A bb project that is also rooted at another
  directory refuses a pi launch.
- **A retire within about a minute of a model listing in bb** (opening a thread's model
  picker) is refused by the kernel, naming a `pi` process in the home, and succeeds when
  run again: bb's listing starts a pi there that no bb command ends.

For every bb agent, Claude Code included:

- **A thread whose last turn failed is no longer read as a lost session while its agent
  process is still loaded.** bb says `error` both of a failed turn and of an agent that is
  gone. The provider now looks at the host's processes at every inspect: with the thread's
  harness alive (the process named `pi` or `claude` that carries the thread's id; a
  command the agent left running does not count), the thread reads as present and at rest, and an input recovers it;
  before, such a home read LOST and could be neither resumed nor sent to. With none, it
  is a lost session as before. This reads Linux's `/proc` (the environment of a process named `pi` or
  `claude` only, never another program's); on a host without it (macOS) a thread in
  `error` is answered `E_SESSION_UNAVAILABLE`, and the route back is a message to it in
  bb itself (oats-bb#22).
  An input to such a lost thread is told, as before: bb starts the harness again in the
  same conversation, and the kernel counts it as a resume of the home.
- **Readiness speaks for the harness of the planned launch.** A pi launch is not held up
  by bb's Claude being signed out, nor a Claude launch by anything of pi's. A read with no
  planned launch (`oats readiness`, `oats bb doctor`) reports Claude's state as before and
  pi's as one warning, `session-provider-pi-not-ready`.
- **A Claude launch reads the env of the home's bb project**, one more bb call, and unsets
  `OATS_INSTANCE`, `OATS_INSTANCE_HOME` and `PATH` wherever it finds them there, whoever
  set them: bb gives a project's env to every thread of it and starts `claude` by a project
  `PATH`, and a pi launch of the same home leaves those three. A project-level `PATH` an
  operator set by hand in an OATS home's bb project does not survive a launch (put what bb
  needs in the bb server's own environment). A bb that cannot give that env fails the
  launch (a refusal where nothing but those unsets was changed yet, otherwise an outcome in
  doubt).
- **The retire hook and the launch hook ask bb for one more thing**, the env of the home's
  bb project: a bb that cannot be asked adds a warning, as before for its threads.

The team image for bb (`container/`) adds pi and `@awebai/oats-pi`, pinned, and runs bb's
pi with a configuration of its own (`/state/home/.bb-pi`, linked to the image's
`/opt/bb/pi`). Its declared command is now `/usr/local/bin/bb-server`. It ships no model
credential for pi. Set `piAgentDir: /state/home/.bb-pi` in the deployment. It pins pi 1.5.2
and `@awebai/oats-pi` 0.70.2.

### The OATS plugin for bb

- **The agent's panel.** On an agent's own thread, the OATS tab of bb's side panel is
  that agent's panel, as the OATS Desktop's instance panel. Its Instance tab shows the
  agent's state and since when, and what it waits on you for. It also shows where it works
  (folder and home, with Copy), its harness, model and thread, its messaging id, and its
  parent. Its Soul tab shows the soul and the agents root, with Open soul page. The panel
  only reads: it adds no process beside the plugin's one `oats status`.
  - The same panel is a page, `/plugins/oats/agent/<instance>`. At phone width, the
    thread's OATS chip opens it. For an agent with no bb thread, its soul's page has Open.
- **Text from OATS is filtered as the Desktop filters it.** Text that looks like a token,
  a password or a credentialed URL shows as `[withheld]`, and a refusal is drawn one line
  per line. The filter is copied from the Desktop's, and a test pins it to that file.
- **Changes reach the screen sooner.** Between two `oats status` reads, the plugin waits
  1 s or as long as the last read took, whichever is longer. It used to wait 5 s. A read
  that failed is followed by the 1 s floor.
- **Controls are easier to press.** Buttons are 44 px high at phone width, and the
  sidebar's rows are as high as a control.
- The plugin is now one module per feature, with one shared component per pattern. A
  hidden page, `/plugins/oats/patterns`, draws each pattern for the plugin's own checks.

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
