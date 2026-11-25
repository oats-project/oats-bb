# Changelog

## Unreleased

### The session provider

- **Readiness says when the pi model check is off.** The check refuses a model only where
  bb's list of pi's models is whole, and bb's pi keeps the settings it started with: after
  a change to bb's pi `settings.json` under a running bb (pi writes it itself), every id
  that is not listed passed, one pi does not have failed as its thread started, and
  nothing said the check was off. A read with no planned launch (`oats readiness`, `oats
  bb doctor`) now carries the warning `session-provider-pi-model-check-off`: "the pi model
  check is off until bb restarts: bb's pi settings changed after it started (restart
  bb-app to turn it back on)". A warning: nothing is refused for it. It is given where a
  pi launch would go on and bb-app's record of its start can be read; not where
  `enabledModels` is set (a restart does not turn the check on there), nor for a bb with
  no pi. README, "pi" and "Readiness".

### Development

- **The contract tests' first bb is off bb's default ports.** Each contract container's
  bb ran on 38886 and 38887, which are in Linux's ephemeral range (32768-60999): a
  listener on port 0 or any outgoing connection of the container can hold one, and bb's
  start then fails. It now runs on 18886 and 18887 (`test/contract/rig.mjs`), named to
  the provider as a deployment names such a bb (`server`, `hostDaemonPort`). The
  provider's defaults are unchanged: a person's bb stays on bb's own ports.
- **The contract images install from locks.** The three images installed bb-app, Claude
  Code, pi and the kernel with `npm install -g`, so each build resolved their dependency
  trees anew, and a hiccup of the registry failed the contract job. They now install with
  `npm ci` from committed locks (`test/contract/locks/`, the shape of the plugin's
  checks): nothing is resolved when an image is built. `test/contract/relock.sh <lock>`
  writes a lock again when a pin moves; a unit test holds the locks against `bb-version`
  and the Dockerfiles against `npm install`. The locks hold bb's build toolchain too: bb
  fetched it from npm by itself, with no lock, when the title test installed its plugin,
  and that test now fails a run in which it does. What is not locked is named in the locks'
  README (the aweb extension pi installs into the second pi configuration brings
  `@awebai/aw` by a range).

## 0.4.0

A stop archives the agent's thread, so an agent OATS stopped stays stopped. A host stop is
resumed. A retire also deletes the home's bb environment where every thread on it is the
home's own, and a pi launch whose model bb's pi would not resolve is refused before anything
starts. The OATS plugin for bb gains the lifecycle's acts (Stop, Start, Restart, Retire,
each behind a dialog), a home at parity with the Desktop's, New agent, Automations' acts,
and what it says when something happened to an agent outside OATS. Package `oats.bb` 0.4.0.

**Upgrade:**
- Update OATS to **0.70.5 or later first**: the floor rises (`compatibility.oats`), and an
  older kernel refuses the package (`E_CAPABILITY_INCOMPATIBLE`).
- Pin `oats.bb: git:github.com/oats-project/oats-bb@v0.4.0`, then `oats sync`. bb-app
  stays 0.50.1.
- Then close the homes that are already stopped, once: for each bb home, stop it if it
  runs (`oats instance stop <name>`), move its copy (`oats instance upgrade <name>`), and
  run `oats instance stop <name>` again, which archives its thread. The session
  provider's entry "A stop archives the thread" below says why.
- From this release each launch keeps a small record of the threads it made, in
  `$XDG_STATE_HOME/oats-bb/homes/` (by default `~/.local/state/oats-bb/homes/`, on macOS
  too). A home spawned before it has no record, so its retire archives only, and says so.
  The session provider's entry "A retire deletes the home's bb environment" says what the
  record holds and how a sandboxed launch treats its directory.

**Known in this release:**
- `oats session restart` with a model the provider then refuses still stops the agent first,
  leaving it stopped (a kernel gap). The plugin's Restart dialog holds such a model before
  any call; from the CLI, check the model first.
- The plugin's screens come before the pilot's text cut: much of their wording changes in
  the next release.
- A tmux agent's stopped and started states reach the plugin through OATS's status read: a
  few seconds after the act on a loaded host.
- A bb window that loads while the plugin reads a change can keep the roster from before
  that change until the next change it hears; reload the window to read it again. The same
  was so in 0.3.0; the fix comes in the next release.

### The session provider

- **A pi launch whose model bb's pi would not resolve is refused.** bb takes any model
  id when a thread is spawned and resolves it when the thread starts, so `oats spawn
  <soul> --backend bb --harness pi --model <id>` with an id pi does not have, or a bare
  id two of pi's providers serve, answered `launched: true` with a thread id over a
  thread that had failed as it started (`oats status`: not running, session lost). The
  launch now reads the models bb lists for its pi, once, and refuses before anything is
  started (`E_BACKEND_LAUNCH_ARG`): `pi has no model "<id>"`, or `pi model "<id>" is
  served by A and B: use A/<id> or B/<id>`, each ending with the way out of the one
  wrong refusal that is possible (`try again in a minute`: below).
  - The rule is bb's own, no stricter: an exact `<provider>/<id>`, or a bare id that
    exactly one pi provider serves, passes. A soul that names a bare id
    (`claude-fable-5.1`) keeps working while one provider serves it.
  - Where bb's list cannot settle it, nothing is refused and the launch goes on as
    before, with one warning (`could not check the model "<id>" against pi's model list:
    <why>`): a list that cannot be read, an id that ends in a date and is not listed
    (bb holds such models back from its list unless named by their exact full id), and any model that is not listed
    where bb's pi configuration sets `enabledModels` (bb then lists only those), where
    that configuration changed after bb started (bb lists by the settings its pi started
    with: restart bb after changing them), where the home has a `.pi` of its own, or
    where bb's pi configuration (`settings.json`, `models.json`, `auth.json`) changed in
    the last minute and a half (bb serves the list it fetched for a minute).
  - A wrong refusal is possible in two cases: after a refresh of pi's list that bb
    failed AND a model added to pi since the list bb kept (until bb's next good
    refresh); and, for the two-provider refusal, for a minute after one of those three
    files was removed.
  - The check of a planned launch says the same, at a spawn's preview too, where the
    kernel hands it the launch's model (`launch.model`); with a kernel that does not,
    the refusal comes at the launch, with nothing created in bb.
  - One more bb call for a pi launch that names a model (`bb provider models pi`); none
    for Claude or for a launch with no model. README, "pi".
- **A retire deletes the home's bb environment: a retired agent's thread, unarchived in
  bb, takes no message.** The retire hook archives a retired agent's thread, and bb
  unarchives a thread at one press. Where the home was kept (`oats retire --keep-dir`,
  or a retire that ended quarantined), a message to it then started the agent in the
  retired home, with no OATS around it. The hook now also asks bb to delete the home's
  environment (`bb environment delete`), after the stop and the archive. bb marks it
  destroyed, refuses every message to the thread, and starts nothing.
  - The home directory is not touched, and the conversation stays readable in bb.
  - bb keeps one environment per home, shared by a person's threads there. So the hook
    deletes only an environment of the local-path kind (`project-checkout`), and only
    where bb's list of the threads on it was read whole and every one of them is a
    thread a launch of this home made. Otherwise it archives only, as before, and the
    retire's warning says why.
  - **The record.** To know its own threads, each launch notes the thread it made in
    the provider's own record of the home: one file per home in
    `$XDG_STATE_HOME/oats-bb/homes/` (by default `~/.local/state/oats-bb/homes/`, on
    macOS too), directories `0700`, files `0600`, holding the home directory's identity
    and thread ids only. A record that cannot be written never fails a launch: the
    launch warns on its standard error, and that thread is unmarked. The retire hook
    removes the record once it has decided. No other command reads it. A launch in a
    sandboxed mode denies the directory to the agent's tools.
  - **A launch in a sandboxed mode is refused where that directory's path cannot be
    written as a deny rule** (`E_BACKEND_SANDBOX_PATH`): an `XDG_STATE_HOME` (or, where
    it is unset or not absolute, a user home) whose path holds a wildcard, a parenthesis, a backslash or a
    control character. A rule silently missing would leave the record writable by the
    agent's tools. Move the state directory to a path without them, or launch in full
    mode (`--yolo`), which writes no deny rules. (The provider's command takes no
    sandboxed launch today; the check of a planned one says the same.)
  - **A home spawned before this release has no record, and is archived only at its
    retire.** That is not a failure: no record is made up afterwards. The warning says
    so. A home started again with this release gets a record of its new threads only;
    its older threads keep the environment, and the warning names them as threads not
    in the home's record (a person's, one made before oats.bb kept a record, or one the
    provider could not note).
  - The retire never waits for bb's teardown, and a delete bb refuses or does not answer
    fails no retire: the threads stay archived only, the warning says so, and bb's own
    words are on the hook's standard error.
  - The retire warns whenever a thread of the home is left without a deleted
    environment. That includes a home retired before its first turn started: bb makes a
    thread's environment at its first turn, so there is none to delete.
  - Where the hook could not decide (bb could not be asked or read, or did not do the
    delete), the record stays and a retire run again can still delete. So a record can
    outlive a home whose retire never got through to bb. It is harmless, and the README
    says how to remove leftovers.
  - The receipt (`capabilityMeta` of oats.bb) gains `environments`, the environments bb
    was asked to delete. Where the home's record is there, `archived` names only the
    home's own threads (and those the hook itself archived): a home made at a path an
    earlier home had no longer reports that home's threads.
  - **WARNING: this is a step in the way, not a lock.** With the home kept, a person can
    still start a retired agent from bb by three acts: Unarchive, Restore its
    environment (`bb thread restore-environment`), and a message; where the retire
    archived only, by two. Such a session runs with NO OATS around it (no status row, no
    hooks, no stop by OATS). Retire bb agents the ordinary way, which removes the home.
  - Whether such a session can send mail as the retired agent depends on the oats.aweb
    that retired the home. From oats.aweb 1.49.0 it cannot through `aw`'s ordinary
    lookup: a retire whose answer exits 0 removes the home's aweb keys, and one that
    fails holds them aside for the retry (`aw` then answers "not initialized"). That
    too is a step in the way, not a boundary: held keys stay in the home's
    `.oats-aweb/held/`, readable by the session's own user, and a retire that crashed
    leaves them in place. A home retired with an older oats.aweb keeps
    its keys, and where its aweb identity was not released a revived session can send
    mail as the retired agent.
  - The retire's warning reaches CLI users only: the Desktop's Retire dialog shows no
    plan warnings and no hook output (oats#2102).

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
    live, since the kernel resumes such a home by an input to that thread. Such a stop
    answers once the thread's harness has left the home, so the home never reads as
    running right after it.
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
  - **The OATS floor rises to 0.70.5** (`compatibility.oats`), the OATS release that
    sends `reason: "host"`, so that no supported pairing loses a reboot's resume. Update
    OATS to 0.70.5 or later before pinning this release: an older kernel refuses the
    package (`E_CAPABILITY_INCOMPATIBLE`). The team image pins `@awebai/oats-pi`
    0.70.5, and the pi contract test and the kernel run (`npm run test:kernel:pi`) run
    with OATS 0.70.5. With an older kernel (a trial), the key is absent and every stop archives: bb then refuses the input
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
    processes: `true` where the harness bb started for the thread is at work in the home
    (a process named `pi` or `claude` that carries the thread's id, has the home as its
    working directory and is a child of bb's own runner for that provider), `false` where
    it is not, as after `bb thread stop`. A process that only carries the thread's id
    never counts, nor a `pi` or a `claude` the agent itself started and left running
    detached (false at the pinned bb version, `null` at another, where it cannot be told): an agent's own detached processes outlive a stop of its thread, and
    `oats instance stop` does not end them. The rule reads bb-app's own process layout
    (its bridge worker's file name), pinned by the contract tests at every bb bump. OATS needs it to tell a home stopped with the host from one
    whose harness came back. On a host without `/proc` (macOS) it stays `null`: there a
    harness started again from bb in a stopped home goes unseen, and the stop's archive
    is what keeps it from starting. A thread in `error` whose harness is still loaded
    reads the same way (`true` where it works in the home; it was `null`); one whose
    harness is gone is a lost session, as before. A thread whose row says
    `queuedWork: "failed"` (a queued message whose dispatch failed) no longer reads
    `running: true` for that alone: the word does not say a turn will start, and the
    thread reads by its harness (bb may still retry such a message by itself: the answer
    then corrects itself); only a message that
    waits to start (`waiting`) reads `true` without a look, and a queue word the provider
    does not know reads `null`.
  - The retire hook's receipt (`capabilityMeta` of oats.bb) says what bb holds of the
    home when the hook ends. `archived` lists every thread of the home that is archived
    in bb then: the ones the hook archived, then the ones it found archived already (by
    the stop inside the retire, which archives the home's thread; by a person; by an
    earlier start). `retired: true` wherever bb has a thread of the home and none is left
    live. `{retired: false, reason: "nothing-to-delete"}` is now only for a home bb has
    no thread of at all (and no env to remove), such as one that never ran on bb. Before,
    `archived` held only what the hook itself archived.

- **`settings.oats.bb.hostDaemonPort`: a bb whose host daemon is not on bb's default
  port.** Set it, in `oats-local.yaml` only (the key is host-only, as `server` is), when
  a workspace's bb-app runs on other ports than bb's defaults, as the second bb of a host
  with one bb per workspace does: the number bb-app was started with
  (`--host-daemon-port`), beside `server`. bb's CLI finds the host daemon of its machine
  by `BB_HOST_DAEMON_PORT` alone (38887 by default), never from the server's address, so
  without it a home's first launch on such a bb was refused by bb ("Host not found", or
  "Cannot reach local host daemon") at `bb project create`. With it, every bb command the
  provider runs is told that port.
  - **A `BB_HOST_DAEMON_PORT` exported in the environment OATS runs in no longer reaches
    bb**, set or unset: the port comes from this setting alone, as the server comes from
    `server` (one bb's port must never be paired with another bb's server). If you
    exported the variable as a workaround for a bb on other ports, set
    `settings.oats.bb.hostDaemonPort` instead. With the setting unset and nothing
    exported, nothing changes: no bb command is told a port.
  - A value that is not a whole number from 1 to 65535 (text such as `"38887"` included)
    is refused by every command, `E_BACKEND_SETTINGS`, naming the key: never dropped.
  - `daemon` follows it: where `hostDaemonPort` is set and `daemon` is not, the daemon's
    address is that port on 127.0.0.1. The two together must name one port.
  - `oats bb doctor` prints the port bb's CLI is told (`host daemon port: 39012
    (settings.oats.bb.hostDaemonPort)`, or `default 38887`; `hostDaemonPort` in its
    `--json`), and readiness checks that the daemon at that port is this bb's, not only
    that something answers there: the daemon says which host it is and which server it
    serves, and the server must list that host, connected (`bb host list`, asked only
    where the setting is set). Its findings name the daemon, the server and the key.
  - New readiness warning `session-provider-host-daemon-port`: a `daemon` address on
    another port than 38887 with no `hostDaemonPort`. It refuses nothing.
  - The README has the setup: [Two bbs on one host](README.md#two-bbs-on-one-host).

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

### The OATS plugin for bb

- **The lifecycle from bb.** Stop, Start, Restart and Retire each open a dialog first, in
  the Desktop's words, from the instance panel, the agent's page, a thread's line and the
  plugin's own group in bb's thread menu (#39, #53, #54). Start is offered for an agent
  that is idle with no harness loaded, and its sentence comes from the recorded thread
  (#58). An agent on tmux can be started, restarted and resumed from bb, with the attach
  command shown (#60). The Stop dialog warns only of facts: uncommitted work in the home,
  and a turn running now (#64). Start and Restart say that they begin a new conversation,
  and a cut-off agent is pointed at its thread first (#43). The real run proves an agent
  on tmux through its three rows and the Restart, Start and resuming Start dialogs (#71).
- **Restart does not stop what it cannot start.** A model the person changed in the
  Restart dialog arms Restart only when bb's list for that harness has been read and serves
  it exactly once, by the session provider's own rule; otherwise the dialog holds it, the
  word on the field and beside the button: "Not found", "Pick provider" or "Required"
  (#77). The rule is one function of the plugin's, shared with New agent and held against
  the provider's own check by a contract test (#79).
- **An agent whose bb thread failed at its start reads "Failed",** and the New agent form
  never says "Created" of it (#70). The form holds Spawn on a model it cannot place
  ("Required", "Pick provider") and leaves the rest to the provider (#72).
- **The home, at parity with the Desktop's Home.** Each card offers the answer its request
  takes, every agent is counted once, and the CLI is checked (#41). An agent whose session
  was lost, ended by itself or has no harness loaded can be answered in its thread; a
  stopped one is offered Start; one OATS cannot reach is offered nothing (#61).
- **New agent,** a page of its own: the Desktop's Spawn dialog in bb (#47, #49). An
  incomplete rollback is read from the kernel's marker, not from its words (#52).
- **The roster.** One name and one state word per agent, the thread's own row, since
  when, at most three lines a row, acts on a thread's line, and the acts held while the
  roster shown is not the last one read (#31, #37, #56). An agent on a bb thread is
  Working when bb says its thread works (#51). The instance panel has one state word and
  one place for what an agent waits for (#36). A thread's line offers "Stop…", and a read
  asked while one is in flight is made once, after it (#66). A claim and a stop show on
  the screen from the agent's own events between two status reads (#74).
- **What happened outside OATS** (#55, #61): an agent's thread archived or deleted in bb,
  an agent running outside OATS after a stop, and a session lost, on bb and on tmux ("Stopped
  · session lost · tmux"). A tmux agent stopped with OATS reads Stopped.
- **Automations, acting on a row:** on and off, Run now, Test, Edit summary, Delete, Check
  run state and Enable scheduler (#30); a due time that has passed reads as due (#50).
  Automations name the machine, say only what is so, and put a person's own words first
  (#68).
- The plugin's floor is OATS 0.70.5 (#45). CI runs the plugin as five jobs: the unit
  stage, the live stage in each theme, the real run, and a pi agent launched from New
  agent (#46, #59, #63). The instance panel's fixtures were recorded again from one real
  run on OATS 0.70.5 (#67).

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
