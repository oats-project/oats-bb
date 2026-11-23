# What the provider speaks

The kernel's session-provider contract defines the wire (the OATS repository,
`docs/capabilities.md`, once the contract lands there; until then the kernel side's
`k1-session-provider-wire.v1.md`). This is the provider's side of it, in short. All of the
envelope is in `lib/wire.mjs`.

## The call
`node <home>/.oats/modules/oats.bb/bin/oats-bb.mjs session <verb>`, run from the filesystem
root (never from the home: the provider reads the home from its input, and leaves no
process of its own working there), with the home's hook
environment (`OATS_SETTINGS` holds `settings.oats.bb`), one JSON request on stdin, exactly
one JSON document on stdout, exit 0 for a result and for a refusal.

```json
{"schemaVersion":1,"wire":"1.3","phase":"session","capability":"oats.bb","provider":"bb","verb":"inspect",
 "input":{"home":"/abs/home","endpoint":{"server":"http://127.0.0.1:38886","projectId":"proj_…","threadId":"thr_…"}}}
```
```json
{"schemaVersion":1,"phase":"session","capability":"oats.bb","provider":"bb","verb":"inspect","ok":true,
 "result":{"present":true,"state":"unknown","running":null,"open":{"label":"Open in bb","url":"http://127.0.0.1:38886/projects/proj_…/threads/thr_…"}}}
```
A refusal is `"ok": false, "error": {"code": "E_…", "message": "…"}`, and nothing else.

**One wire version.** The provider speaks wire 1.3. Its manifest declares it
(`sessionProviders.bb.wire: "1.3"`), and the kernel calls it only if that is the kernel's
own. Every request carries the kernel's version in `wire`; the provider refuses a request
whose `wire` is absent or another value with `E_BACKEND_WIRE`, naming both, before it reads
or does anything. The answer's header does not echo `wire`.

A refusal says nothing happened: bb's server said no (its own error code, or a 4xx status
in the CLI's message), or the request never reached it. Where the provider cannot tell (a `bb thread spawn` or a `bb thread tell`
that did not answer in time, answered something it cannot read, died, lost its connection
after the request went out, or met a server error), it writes no document and exits nonzero: a failed call, whose outcome the kernel treats as
uncertain. After such a spawn the provider first looks for the thread it may have made: a
new live thread in the home is the launch's, and its endpoint is the answer.

| verb | input | result |
|---|---|---|
| launch | `{home, instance, harness, model, yolo, env, unset, pathPrepend, args, promptFile, previous, sandbox?}` | `{endpoint: {server, projectId, threadId}}` (and the thread's id is added to the provider's record of the home's threads, "Hooks": outside the home, never part of the answer) |
| inspect | `{home, endpoint}` | `{present, state, running, open?}` |
| inspectMany | `{homes: [{home, endpoint}]}` | `{results: [<inspect result> or {error: {code, message}}]}`, in order |
| input | `{home, endpoint, text}` | `{submitted: true, verified}` |
| stop | `{home, endpoint or null, graceSeconds, launchSent?, reason?}` | `{stopped: true}` |
| check | `{home or null, soul or null, settings?, launch?}` | `{status, problems: [{code, message}], warnings: [{code, message}]}` |

- **launch `env`** is a list of `{name, value, source, capability?, secret?}`. (For Claude;
  what a pi launch carries of it is under "pi" below.) The provider
  writes an entry only when its `source` is `kernel`, `capability` or `launch-config` and it
  is not marked `secret`; any other entry refuses the launch (`E_BACKEND_LAUNCH_ENV`). So a
  source word the provider does not know is refused, never written. `unset` names are
  written with an empty value (a settings file cannot remove a variable, and bb's Claude
  inherits the bb server's environment): empty, never the inherited value.
- **launch `pathPrepend`** (the home's kernel shim directory) is carried as the env file's
  `PATH`: those directories, then the launch's own `PATH` entry if it has one, else the
  `PATH` the provider was called with. An entry that cannot go on a PATH refuses the launch.
- A launch never resumes: a bb thread is resumed by an input into its own conversation. (A
  launch input that carried a non-null `resume` would be refused, `E_SESSION_START_FAILED`.)
- **launch `args`** holds the launch configuration's and the capabilities' arguments only.
  For Claude the provider carries one, `--permission-mode` (for pi, none: "pi" below); any other refuses the launch
  (`E_BACKEND_LAUNCH_ARG`).
- **A launch in a sandboxed mode is refused.** With `yolo` not true and no
  `--permission-mode bypassPermissions`, the launch would run in bb's `accept-edits` or
  `auto` mode. The provider refuses it before any effect, right after the launch input's own checks
  (`E_BACKEND_SANDBOXED_MODE`). The check says the same of a planned launch: the refusal
  stands alone among the planned launch's findings, beside whatever is wrong with bb
  itself. A check with no planned launch (`oats readiness`, for a soul or a home) cannot
  know the mode, and carries the warning `session-provider-full-mode-only` instead. The contract keeps bb homes
  in full mode (bb lets a command leave its sandbox, so the sandboxed modes are no
  boundary) until its two sides offer them. What is written below about `sandbox`,
  `trees` and the deny rules describes code that is here and tested, behind that refusal.
- **The endpoint a launch answers is new.** Every launch answers a thread bb made for it.
  bb makes a new thread id for each spawn, and the provider does not take that on trust:
  bb's answer to the spawn is the launch's thread only when it names a thread bb did not
  have before the spawn (not the `previous` endpoint's, not another thread of the home's
  project, live or archived) and, where it names a project, the home's. Any other answer,
  like a spawn whose fate is unknown, makes the launch look: it then takes only a thread
  bb created after the spawn was asked for (bb's `createdAt`; bb and the provider are on
  one host), so an older thread of the home that shows again is not answered (the launch
  stays in doubt). The kernel may tell a new session from an old one by its endpoint.
- **The thread's title is the instance's name as words.** The launch passes it to the
  spawn (`--title`): `instance` with every run of `-` as one space, the ends trimmed, and
  only the first character upper-cased (`tui-leader-hint-developer-2` is "Tui leader hint
  developer 2"), the rule of OATS's `instanceDisplayName`. The project the launch creates
  is named `instance` as it is. The title is given at the spawn and by no other verb:
  inspect and input read and write none. At the pinned bb a thread spawned with a title
  keeps it (bb asks its title service only for a thread with none, and applies a
  generated title only to a thread with none; the same guard holds for a name the
  thread's own agent gives it, which the contract test does not exercise); what changes
  it is `bb thread update --title` or `bb thread regenerate-title`, a person's or an
  agent's own act, which stays until the next launch.
- **stop is complete only when nothing of the thread can run.** bb's concurrency limit
  holds a turn in line (the thread is `pending`, its list row says `queuedWork`), and
  `bb thread stop` leaves it there: bb starts it by itself when a slot frees. So a stop is
  confirmed, by one rule every path uses (the stop verb, the stop with no endpoint, the
  retire hook, a launch's cleanup): the thread's queue is withdrawn (`bb thread queue
  list`, `bb thread queue delete`), bb acknowledges a stop, the thread shows settled, its
  queue reads empty, and the thread shows settled once more after that. A message found
  in line after the thread settled is withdrawn and the thread is stopped and looked at
  again, since bb may have started it as a turn in the same instant. Anything else by the
  end of the grace is `E_SESSION_STOP_FAILED`. Inspect reads a settled thread with work
  in line as `running: true`.
- **stop archives the thread it stopped** (contract r24, A15(1)). bb has no stopped
  state: a stopped thread reads `idle`, and bb starts its agent again at the next message
  to it, from bb's composer or `bb thread tell`, in the same conversation. bb refuses
  every message to an archived thread. So once a stop is confirmed the provider archives
  the thread (`bb thread archive`), and an instance OATS stopped stays stopped from bb's
  side too, until OATS starts it: a start is a new thread, as it always was. A stop with
  an endpoint archives that thread; a stop with `endpoint: null` archives the threads it
  takes to be the failed launch's (below), never one that may be a person's. A thread bb
  no longer has is not asked for, and one bb had archived already is left as it is.
  - After its archive the thread is stopped and confirmed once more, by the stop's whole
    rule (above): a message typed in bb between the stop's last look and the archive
    starts a turn, or is held in line, and nothing reads an archived thread afterwards.
    So a stop never answers `stopped` from a look that came before its archive, whatever
    bb answered to the archive (one cut off by time may have been made all the same).
    That second confirmation has a grace of its own, inside the command's time.
  - Nothing of the conversation is lost: it stays in bb, readable, as an archived thread
    (bb's thread list under Archived; `bb thread list --archived --project <id>`).
  - An archive bb refuses, or does not answer for, fails no stop: the thread is stopped,
    the answer is `{stopped: true}`, and the provider writes one warning line on its
    standard error, naming the thread and the remedy (`bb thread archive <id>`) before
    bb's own words (made one line, and cut where they are long). The wire
    has no other place for it: a stop's result is exactly `{stopped: true}`, and the
    kernel does not read a provider's standard error. Such a thread stays live in bb: a
    message to it there starts its agent again, and the next launch archives it (it is the
    launch's `previous` thread) or refuses, naming it.
  - A thread a person unarchives in bb (`bb thread unarchive <id>`) takes messages again,
    and the next one starts its agent, outside OATS: the provider's inspect then reads the
    thread present. OATS still holds the home stopped; stop it or start it with OATS.
  - **A stop with the host is not archived** (contract r25, A16). `reason: "host"` in the stop input is the
    kernel's word for a stop made by `oats host run`'s shutdown. Such a home is lost, not
    stopped: the kernel resumes it by an input to the recorded thread, which bb would
    refuse of an archived one. So the provider stops that thread by the same rule and
    leaves it live. Only that exact value does: any other, and none, is a stop that
    archives. (With no endpoint the key changes nothing: that stop settles a launch nobody
    recorded, which no resume brings back.)
  - Where the key is absent (a kernel below the package's floor, which is the OATS
    release that sends it), the provider archives at every stop: a home stopped with the
    host is then archived like any other, its resume's input is refused by bb, and the
    home is not resumed. `oats session start` gives it a new thread. The provider never
    refuses a stop for the key's absence.
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
  - The window: a host-stopped home's thread is live and unarchived from the host's
    shutdown until the first resume sweep after the host is back (`oats host run` runs it
    at its start and each minute; the clients when they open): the time the host is off,
    plus up to about a minute after boot. A message in it lands in a home OATS means to
    run.
- **A refusal means nothing was changed.** A launch reads everything it needs first (bb's
  projects and threads, the home's archived threads, its own files in the home). From the first call that may have
  changed something, it no longer answers a refusal: a stop of an earlier thread of the
  home (a loaded process may have been released, a held message withdrawn), the archive
  of the previous thread, the creation of the home's project, each also when its answer
  was lost. Whatever fails after that, in bb or on this machine, ends with no answer and a nonzero exit,
  as every outcome in doubt does, and the kernel keeps its record that a launch was sent.
  Two failures stay refusals, because they are known to have changed nothing: bb's own no
  to creating the home's project, when nothing came before it; and bb's own no to the
  spawn, when the launch's only change was its own files in the home, which it then puts
  back as they were (their bytes and modes, or their absence).
- **Helpers stay in the command's process group.** The kernel gives each provider command
  a process group and kills that group to end the command. The provider starts every bb
  call inside it, never in a session or group of its own. A bb call cut off by time is
  ended by its launcher process and its pipes are let go; what the launcher started is
  left in the group, for the kernel.
- **No Claude of an old thread is left in the home.** bb keeps the Claude process of an
  archived thread loaded, with the home as its working directory, and shows nothing that
  tells such a thread from one whose process is gone. `bb thread stop` releases it, and
  changes nothing where nothing is loaded. So the provider stops a thread before every
  archive it makes, and sweeps the archived threads of the home's bb project (stops each
  one): a launch before it spawns, a stop with `endpoint: null`, and the retire hook. A
  launch sweeps the threads archived at or after its `previous` thread was created
  (earlier ones were swept by the launch that made that thread); with no `previous`, or
  where bb does not show when it was created, it sweeps them all. A stop with
  `endpoint: null` and the retire hook are told no thread to count from, and sweep them
  all: one bb call per archived thread of that project, several at a time (the count only
  grows, and the sweep starts over at every call; most of a bb call is the CLI's own start,
  so several at once fit about twice as many threads in the time on two processors, up to
  four times on eight), and one more read of the lists. Where the command's time still
  runs out, the stop says how many were stopped, of how many, and to remove old archived
  threads of the project in bb (stop, then delete); the retire hook says the same in its
  warning. Where bb does not answer one such call in that call's time, the stop names the
  threads and says to try again.
  An archived thread is confirmed stopped by the same rule as a live one, with the reads
  shared: bb acknowledges each stop, the lists are read again, and every thread stopped
  must show, in its one row, settled and `queuedWork: "none"`; one whose row says anything
  else, or does not say, goes through the rule above
  by itself. Never by the row it was found in. What none of this can show is the
  process: it ends a moment after bb's acknowledgement, and the provider does not look at
  processes (the kernel does, in the home, before it retires one). So the old thread's
  Claude, already stopped, may still be exiting when the new thread's starts.
- **launch `sandbox`** is
  `{domains: [{host, capability, setting}], write: [{path, reason}], missing: [{capability,
  setting, team, optional, defaultTeam}]}`, built by the kernel from recorded configuration, or
  `{unavailable: "<cause>"}` when the kernel could not resolve it (`false` or an empty
  string there mean it was resolved). A `skipped: [{capability, reason}]` is read and
  listed by the check if it comes; the kernel does not send it today. The shape is the
  one decided in the contract; the kernel change that sends it is not released yet,
  and a kernel that sends no `sandbox` key gets nothing written (readiness says the
  allowances are missing).
  - In a sandboxed mode the provider writes exactly the `domains` and `write` entries, and
    an entry that is not one exact host or one exact absolute path refuses the launch
    (`E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`). A full-mode launch writes none
    of it, so it reads neither list and is never refused for what the object holds.
  - `missing` is what a provider's line named and the deployment has no value for. A
    sandboxed launch is refused (`E_BACKEND_SANDBOX_HOST`, naming each and the remedy) for
    a row that is neither `optional: true` nor another team's (`defaultTeam: false`): the
    soul's default team, or a setting with no value at all. Another team's row goes to
    readiness (`session-provider-sandbox-team-unreachable`); a row the provider cannot name is counted, never
    dropped. `unavailable` refuses a sandboxed launch (`E_BACKEND_SANDBOX_UNAVAILABLE`).
  - Beside `unavailable` nothing else of the object is read: there are no lists to write.
  - A sandboxed launch must understand everything it is told: a key the provider does not
    know, or a `missing` that is not a list, refuses it. A full-mode launch writes nothing
    and ignores `missing`, `skipped`, `unavailable` and unknown keys, whatever they hold.
- **launch `trees`** (optional, wire 1.3): `[<absolute path>]`, the home's `work/` and every
  extra tree, as the kernel reads them from Git's own worktree list (never from the home).
  A launch in a sandboxed mode needs it for its deny rules (the `.git` pointer of each
  tree, and `config` and `hooks/**` of its git directory and of the common directory
  behind it): with no `trees`, or one that is not a list, it is refused
  (`E_BACKEND_SANDBOX_TREES`); an entry that is not an exact absolute path of an existing
  directory, or that a rule cannot carry, refuses it too (`E_BACKEND_SANDBOX_PATH`), never
  skipped. A full-mode launch does not read it. The check reads `launch.trees` the same
  way where the planned launch carries it, and says nothing of trees where it does not.
- **launch `protected`** (optional, wire 1.3): `[<absolute path>]`, the directories the
  kernel keeps outside the home that the agent must never write and must still read and
  run where they are: the instances' `.oats-retirement/`, which holds the kernel's own
  copy of each home's modules, somewhere below it (where exactly is the kernel's, and changes at an upgrade: the provider reads no path there). The kernel makes each before a launch. A sandboxed launch denies
  each whole (`Edit(//<path>)`, `Edit(//<path>/**)`, under its real path too); with no
  `protected`, or one that is not a list, it is refused (`E_BACKEND_SANDBOX_PROTECTED`);
  an entry that is not an exact absolute path of an existing directory, or that a rule
  cannot carry, refuses it too (`E_BACKEND_SANDBOX_PATH`). A full-mode launch does not
  read it. The check reads `launch.protected` the same way: a planned launch that
  carries `trees` or `protected` has the whole set built, and one that carries neither
  has nothing said of either.
- **what a sandboxed launch writes** into `<home>/.claude/settings.local.json`, each key
  whole and from the launch input alone: `sandbox` (the allowances), `permissions.deny`
  (one `Edit(//<path>)` rule per path of contract item 6c, the provider's own state
  directory among them, whole: `$XDG_STATE_HOME/oats-bb` and `/**`, under its real path
  too, and under the names it will have where the first launch has yet to make it; a
  state directory a rule cannot carry refuses the launch, `E_BACKEND_SANDBOX_PATH`; then
  `mcp__bb-bridge__update_environment_directory`),
  `permissions.blockWritesOutsideWorkingDirectories: true`, and `env`. A full-mode launch
  writes `env` and removes the other three. Before it writes, a sandboxed launch checks
  that `settings.oats.bb.dataDir` holds a `thread-storage` directory
  (`E_BACKEND_SETTINGS`).
- **stop** with `endpoint: null` stops every live thread that runs in the home (the kernel
  compensating a launch whose answer was lost, or whose caller was killed while it ran):
  it finds the home's bb project and its live threads, and answers `stopped` also when
  there is none, `E_SESSION_STOP_FAILED` when it cannot tell.
  - `launchSent` (the receipt's record that a launch was sent, in the form the kernel
    writes: an ISO 8601 UTC time ending in `Z`; the kernel change that passes it is not
    released yet) says which threads are taken to be that launch's: one bb created at or
    after it (bb's `createdAt`, milliseconds) is archived once stopped, so no message in
    bb starts it again and the next start is not refused for a thread nobody recorded.
    Where bb does not archive it, the stop still answers `stopped`, warns on its standard
    error (above), and the next launch names the thread.
    A thread created before it, and every thread when `launchSent` is absent or is not in
    that form, is stopped and not archived: it may be a person's, and the next launch
    names it.
  - The rule's reach, a stated limit: with no endpoint nothing names the home's own
    thread, so a thread a person starts in the home's project after the failed launch was
    sent, and before the kernel settles that launch, is at or after that time too, and is
    stopped and archived with the launch's, whenever the kernel's next stop, start or
    retire comes. It stays in bb, archived and readable, and the person can unarchive it
    (`bb thread unarchive <id>`). A stop with an endpoint never touches a person's thread.
  - A limit: the stop sees what bb shows when it is called. The kernel kills a provider
    command's whole process group, and the provider's bb calls stay in that group (below),
    so no bb call outlives a killed launch; but bb's server may still be making the thread
    of a request it had already received, and show it only after this stop answered.
    Nothing is lost silently: the next launch refuses and names that thread; but this
    stop did not stop it.
- **check** is the readiness check. `status` is `ready`, `needs-configuration`,
  `authorization-required` or `unavailable`; `ready` has no problems. With the planned
  launch (`launch: {harness, yolo, args, sandbox, trees?, protected?}`, there before every launch and absent on
  a plain readiness read), it also answers what that launch would be refused for (its
  harness, its arguments, its mode, the sandbox it needs, its trees where it carries them, bb's data directory), as a problem with the launch's own code, and lists optional rows, skipped
  capabilities and, for a full-mode launch, the gaps, as warnings (optional rows and skipped
  capabilities are named only here: the provider keeps no record of them after a launch). Without it, the check
  says nothing of a launch (the provider keeps no record of one in the home), and says, for a soul or a home,
  which mode the command launches in (`session-provider-full-mode-only`).
  Where sandboxed launches are taken (the tests' entry; never the provider's command), it
  also reads, for a home, the home's `.claude/settings.local.json`, for the report only
  (nothing the provider writes or deletes depends on it): `session-provider-sandboxed`
  where the file holds the deny of bb's directory-move tool and
  `permissions.blockWritesOutsideWorkingDirectories: true`;
  `session-provider-sandbox-incomplete` where it holds some of the provider's sandbox
  keys and not both of those; nothing where it holds none.

## Codes
`E_BACKEND_WIRE`, `E_BACKEND_LAUNCH_ENV`, `E_BACKEND_LAUNCH_ARG`, `E_BACKEND_SANDBOXED_MODE`, `E_BACKEND_HARNESS`, `E_BACKEND_VERSION`,
`E_BACKEND_EXPOSED`, `E_BACKEND_TRUST`, `E_BACKEND_NOT_READY`, `E_BACKEND_PI_LISTENER`, `E_BACKEND_UNREACHABLE`,
`E_BACKEND_SETTINGS`, `E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`,
`E_BACKEND_SANDBOX_TREES`, `E_BACKEND_SANDBOX_PROTECTED`, `E_BACKEND_SANDBOX_UNAVAILABLE`, `E_SESSION_UNAVAILABLE`, `E_SESSION_START_FAILED`,
`E_SESSION_PROMPT_OPEN`, `E_SESSION_INPUT_QUEUED`, `E_SESSION_INPUT_FAILED`,
`E_SESSION_STOP_FAILED`.

## pi (contract r23: A12 to A14)
The harness `pi` is the same wire, with these differences. All of it is pinned against
the real bb and pi by `test/contract/pi.test.mjs`.

- **launch** runs `bb thread spawn --provider pi --model <model>`, the launch input's
  `model` as it is (`<pi provider>/<id>`; bb splits it). `args`: every entry is refused
  (`E_BACKEND_LAUNCH_ARG`), `--permission-mode` included. `yolo` must be true
  (`E_BACKEND_SANDBOXED_MODE` otherwise, whatever the command takes for Claude: bb's pi
  has full mode only). Nothing of `.claude` is read or written, and `sandbox`, `trees`,
  `protected` and `unset` are not read.
- **launch `env`, for pi.** The provider carries exactly `OATS_INSTANCE` and
  `OATS_INSTANCE_HOME` (entries of source `kernel`, not marked secret) and `PATH`, which
  it composes from `pathPrepend` and the PATH it was called with: paths only, never the
  value of an env entry. They go into the env of the home's bb project (`bb machine env
  set <NAME> --project <id>`, the value on stdin, never an argument), which bb keeps in
  its database. Every other entry is not carried: one of source `kernel` or `capability`
  is left out, a secret mark on it included; one of a launch configuration (its literal,
  `launch-config`, or its secret reference), or of a source the provider does not know,
  refuses the launch by name (`E_BACKEND_LAUNCH_ENV`). A
  `PATH` with no executable `pi` on it, or with pi and not the program pi's script asks
  `env` for, refuses the launch too, naming which is missing.
- **The project's env is the provider's, whole.** A pi launch reads the names bb holds
  for the project (`bb machine env list --project <id>`), unsets every one that is not
  among the three it carries, and sets those. A project with a root other than the home
  refuses a pi launch (`E_SESSION_START_FAILED`) before anything is changed. The env
  reaches no process before the spawn and the next launch rewrites it, so a launch that
  is refused after writing it is still a refusal: nothing was started. A Claude launch
  of a home whose project exists reads the project's env and unsets those three names
  wherever it finds them, whoever set them (a pi launch of the same home leaves them, and
  bb starts `claude` by a project `PATH`); it sets none, and leaves every other name. A
  read or an unset that bb refuses there fails the launch: a refusal
  (`E_SESSION_START_FAILED`) when nothing but those unsets came before it (some of the
  three names may then be gone already: the env reaches no process before the spawn),
  otherwise in doubt, as every failure after a launch's first effect is (above).
- **inspect, `running` for a thread at rest** (both harnesses; contract r25, A16). bb says
  `idle` of a thread whose agent is loaded and waits for its next message, and of one
  `bb thread stop` released: the word does not say whether the agent runs. For a thread
  that is `idle` or `pending` with nothing in line, the provider reads it from this host's
  processes, at every call: `running: true` where the harness bb started for the thread
  is at work in the home, `false` where it is not. That harness is one process that is
  named `pi` or `claude` (as below, by the thread's `providerId`), carries
  `BB_THREAD_ID=<the thread's id>`, has the home as its working directory (exactly the
  home, where bb starts a thread's harness; read from `/proc/<pid>/cwd`), AND is a child
  of bb's own runner for the thread's provider (its parent, from `/proc/<pid>/stat`, is a
  process whose command line runs bb-app's `bb-provider-bridge-worker.mjs` with the word
  `provider-<the thread's providerId>`). The working directory and the parent are read
  only of such a process. A process that merely carries the id (a command the agent left
  running) is never counted, nor a harness at work in another directory, nor a `pi` or a
  `claude` the agent itself started: a false `true` is the dangerous answer, since the
  kernel reads a home stopped with the host whose harness runs as one that came back,
  and sends it no resume. So a thread the provider stopped and left live (`reason:
  "host"`) reads `running: false`, and the same thread after bb started its harness again
  reads `true`. A turn bb holds in line (`queuedWork: "waiting"` in the thread's list
  row: bb starts it by itself) still reads `running: true` without a look. A thread
  whose row says `queuedWork: "failed"` (a queued message whose dispatch failed) reads by
  its harness, like any thread at rest, so a home stopped with the host whose thread
  holds only a failed message is not read as running. bb's word does not say that
  nothing will start: it wins over `waiting` in the row, and covers a message bb will
  retry by itself as well as one that waits for a person. So such a thread may read
  `running: false` a moment before bb starts a turn in it; the answer corrects itself
  when it does, and a false `true` is the one the provider must never give. A word for the queue that
  the provider does not know (bb-app 0.50.1 has `none`, `waiting` and `failed`) reads
  `running: null`: it cannot be told. (A stop still clears whatever is in line, a failed
  message too, and a launch still refuses to start over one.) A
  thread in `error` whose harness lives (below) is at rest too, and its `running` is read
  the same way: `true` where that harness works in the home (a stopped home a person
  started again in bb, whose turn then failed, still runs), `false` where it works
  somewhere else. One look serves an `inspect` or an `inspectMany`, made only when a
  thread needs it.
  - **Only a harness bb itself started** (contract r29, A20). A `pi` or a `claude` the
    agent starts in its home and leaves running detached (`setsid claude …`, `nohup pi
    …`) inherits the thread's id, is named as the harness, works in the home, and
    outlives every stop of the thread. Its parent is whatever adopted it (init, a
    subreaper), and one the agent did not detach is a child of a shell under the harness:
    neither is bb's runner, and neither is ever counted as running. The answers, for a
    thread at rest:
    - no process named as the thread's harness, with its id, in the home: `false`;
    - one whose parent is bb's runner for the thread's provider: `true`;
    - one whose parent cannot be read (it or its parent ended meanwhile): `null`;
    - one whose parent can be read and is not that runner: `false` where bb is at the
      version the provider is pinned to (`settings.oats.bb.version`), since there the
      runner's command line is the one the contract tests pin and the process is one the
      agent left behind; `null` where bb is at another version, its version cannot be read
      or no version is pinned, since a bb that moved its runner would look the same.
    bb's version is read as readiness reads it (`bb --version`), once per `inspect` or
    `inspectMany` at most, and only when such a process is there. It decides that one
    answer and refuses nothing: an inspect is answered at any bb version. So a home
    stopped with the host is never read as running for what its agent left behind (false
    at the pinned bb, null at another), and is resumed: the kernel takes such a home for
    one that came back on `running: true` alone.
  - **This rests on bb-app's own layout, not on its CLI** (seen at 0.50.1, pinned by
    `test/contract`): bb's host daemon runs one `node …/bb-app/host-daemon/dist/bb-provider-bridge-worker.mjs
    <artifact> provider-<id> <data dir>` per thread, with the thread's harness as its
    direct child; neither that process's command line nor its environment names the
    thread (the harness's environment does). A bb that moves the file or the word is
    another version than the pin (the contract tests fail at such a bump): there a loaded
    harness reads `running: null`, never `true`, so a home stopped with the host is
    resumed by an input all the same, and a harness started again in a stopped home goes
    unseen until the provider knows that bb's runner. A pin moved along with bb, before
    the provider knows that bb, makes its harnesses read `false`: the safe direction too.
  - Where bb's host daemon ends under a loaded harness (seen with the daemon killed, for
    pi and for Claude, pinned by `test/contract`): bb-app starts the daemon again, the
    harness ends with the old one and no process is left that carries the thread's id
    (none is reparented, so there is no orphan for the rule to miss), the thread still
    reads `idle`, and it reads `running: false`. The next tell starts a harness under the
    new daemon's runner.
  - A stop with the host (`reason: "host"`) answers only once that harness has left the
    home (it leaves a moment after bb shows the thread settled), within the stop's grace:
    an inspect made right after the stop reads `running: false`. Where it has not left by
    then, the stop still answers `stopped` (bb's stop is confirmed) and warns on its
    standard error.
  - What the kernel's `outsideOats` then reports is a harness bb revived in a home OATS
    holds stopped, not every process an agent left behind. **An agent's own detached
    processes outlive a stop of its thread, and `oats instance stop` does not end them**
    (in a team container too): the provider signals no process.
  - **The limit on macOS is the provider's: no `/proc`, so `running` is `null`** for
    every thread at rest (never a guess, and no error: such a thread is still read as
    there). The kernel then cannot see a harness that was started again from bb in a home
    it holds stopped, and a home stopped with the host that already runs gets one more
    turn, its resume notice. What closes the door there is the stop's archive (A15(1)):
    bb refuses every message to the thread of a home OATS stopped.
- **inspect, for a thread in `error`** (both harnesses). bb says `error` of a thread
  whose last turn failed and of one whose agent is gone. The provider decides at every
  call from this host's processes: the thread's harness, which is a process whose
  environment carries `BB_THREAD_ID=<the thread's id>` and which is named `pi` (a thread
  whose `providerId` is `pi`) or `claude` (`claude-code`), by its process name or the
  first word of its command line (the second, behind `node`, `bun` or `deno`). bb gives
  the variable to what the harness starts too: a command the agent left running carries
  it, is not the harness, and alone does not count (a `pi` or `claude` the agent itself
  started and left running does: the harness is known by its name). A lost session
  with a process still working in the home is the kernel's to refuse to resume, naming
  it (its own rule): end that process, or `oats session start`. A live harness makes the thread present, `state: unknown`, with `running` read as for a thread at rest (above); none makes it a
  lost session (`present: false`), as before. A turn bb holds in line reads `running:
  true` without a look. The look reads Linux's `/proc/<pid>/environ`, once per
  `inspect` or `inspectMany` and only when a thread needs it (one in `error`, or one at
  rest, above); for a thread in `error`, where it cannot be
  made (macOS: oats-bb#22), that thread's answer is `E_SESSION_UNAVAILABLE`, whose message
  says how to get the thread back (a message to it in bb itself: the kernel starts and
  sends to no home whose session it cannot read). A process's name and command line are
  read first, and its environment only where one of its names is a harness's: no other
  program's environment is opened.
- **input, to a thread in `error`** (contract r23, A14): told like any other thread, with
  no look at processes and no refusal. Where the thread's process is gone, bb answers
  sent, starts the harness again in the same conversation and runs the turn once (pinned
  for pi and for Claude). That home reads as lost, so the kernel counts the input as a
  resume before it calls the provider: the cap is the kernel's.
- **check, and every launch, for pi.** bb's provider state is read for the harness of
  the launch: `providerId=pi` for a pi launch, `claude-code` otherwise and on a read with
  no planned launch. A pi launch also needs the pi configuration bb's server runs with
  (`settings.oats.bb.piAgentDir`, default `.pi/agent` in the home of the provider's user)
  to list `@awebai/oats-pi` in its `settings.json` `packages` (`E_BACKEND_NOT_READY`)
  and not to list `@awebai/pi` (`E_BACKEND_PI_LISTENER`), unless `AWEB_DELIVERY` is among
  the names of bb's machine env (`bb machine env list --json`, read only then; bb shows
  no value). That variable reaches every pi bb runs on that server, other projects'
  threads included, and no process bb did not start. The provider reads the directory
  and bb's env, and never changes either. With no planned launch, all of pi's findings
  are one warning, `session-provider-pi-not-ready`, and none where bb reports pi
  `not_installed` or reports no pi provider. A `piAgentDir` that is not an absolute path
  is `E_BACKEND_SETTINGS` for every launch and every check, whatever the harness.
- **Hooks.** The retire hook unsets every name of the env of each bb project rooted at
  the home (`meta.env` is how many), after its threads are archived; from a project that
  is also rooted elsewhere, only the three names a pi launch writes. The launch hook
  does the same when the home starts on another backend and `OATS_PREVIOUS_BACKEND` is
  `bb`, and only then. A bb that cannot be asked is a warning in both, in the hook's one
  last line.
- **What the provider does not do.** It signals no process. A catalog pi bb starts for
  a model listing (`bb provider models pi --project <id>`) works in the home in a bridge
  worker of its own; no stop of a thread ends it, and it leaves by itself (about 70 s at
  the pinned bb).

## Time
The kernel gives launch 120 s, stop 20 s plus its `graceSeconds`, and the other verbs,
`check` included, 20 s. The provider bounds every bb call (10 s), every HTTP read (4 s; the
provider state 6 s) and its own total (launch 100 s; stop 16 s plus the grace, which is how
long it waits for bb to settle, counted from the moment `bb thread stop` answered; the
others 16 s), so a bb that hangs gets a named problem,
never a killed call. Each limit is a timer of the provider's own process (on Node 20 a
read whose connection is dropped as it is accepted never settles by itself), and a provider that ever ran
out of work before it had an answer exits 1 with a line on stderr: never status 0 with
nothing on stdout.

## The bb surface used
At the bb-app version in `bb-version`, pinned by `test/contract/`:
- Every CLI call carries `BB_SERVER_URL`, and, where `settings.oats.bb.hostDaemonPort` is
  set, `BB_HOST_DAEMON_PORT` (contract A23): bb's CLI finds the host daemon of the machine
  it runs on by that port alone (38887 by default), never from the server's address, and
  `bb project create` needs that daemon. Unset, the provider tells no port. Either way a
  `BB_HOST_DAEMON_PORT` in the provider's own environment is removed, as `BB_SERVER_URL`
  is: the port comes from the setting alone. Pinned with two bb-apps in one container:
  with the second bb's port a launch makes its project and thread there alone; without
  it bb refuses the project (`host_not_found`) and nothing is made. With the setting,
  readiness also runs `bb host list`: the daemon at the port (its `/status`: `hostId`,
  `serverUrl`) must be a connected host of the configured server. Of the commands the
  provider runs, `bb project create` and `bb thread spawn` are the two that need the local
  daemon and so the port; `bb thread show`, `list`, `queue list`, `interactions list`,
  `tell`, `stop`, `archive` and `bb machine env` go to the server alone, with any port.
- CLI: `bb --version`, `bb project list`, `bb project create`, `bb thread list` (its rows'
  `archivedAt`, `deletedAt`, `environmentPath`, `queuedWork` and `createdAt`, in milliseconds, included),
  `bb thread show`, `bb thread spawn` (with `--title`), `bb thread tell`, `bb thread interactions list`,
  `bb thread queue list`, `bb thread queue delete`, `bb thread stop` (also of an archived
  thread), `bb thread archive`, and `bb thread list --project <id> --archived`. For the
  retire's delete of a home's environment: `bb environment show <id>` (its `id`, `path`,
  `status`, `environmentProviderId` and `managed`; `environment_not_found` is "none"),
  `bb thread list --environment <id> --include-archived --include-hidden` (which leaves
  deleted threads out; a thread row's `environmentId` is read here and in the project's
  archived list) and `bb environment delete <id>`. The contract test pins what that
  rests on: one environment per home, shared by a person's thread there; the delete
  answering before the teardown; a destroyed environment's `path: null`; the home
  untouched; the tell refused; and `bb thread restore-environment`. The
  contract test also pins what the stop's archive rests on, for pi and for Claude: bb
  refuses a tell to an archived thread and starts nothing, lists it under
  `bb thread list --archived --project <id>`, and after `bb thread unarchive` takes a
  tell again and starts the agent in the same conversation. For pi:
  `bb machine env list` (with and without `--project`), `bb machine env set <NAME>
  --project <id>` and `bb machine env unset <NAME> --project <id>`, of whose answers only
  the `variables` names are read. The
  contract test also sets bb's limit (`bb concurrency-limit global`), to pin what a held
  turn looks like and that a stop withdraws it. It also pins bb's own handling of a
  thread's title (`bb thread update --title`, `bb thread regenerate-title`, and a title
  service registered by a test plugin: `bb plugin install`, `bb settings ai-services
  show`), none of which the provider runs. A list is read row by
  row: a project needs an `id` and its `sources` (each with its `type`, and a local one
  its `path`), a thread an `id` and a `status` that is one of bb's words (`pending`,
  `idle`, `starting`, `active`, `stopping`, `error`), with a `projectId`, `archivedAt`,
  `deletedAt`, `environmentPath` of the kind bb writes (times are numbers), an
  interaction an `id` and a `status` that is one of bb's (`pending`, `resolving`,
  `resolved`, `interrupted`; the first two hold input). One row that is not that, and the whole read is an
  error: only a list the provider can read says a thread, or a prompt, is not there.
- HTTP, loopback only, read-only, bounded in size and time, strictly decoded:
  `GET <server>/health`, `GET <daemon>/status` (`connected`, and a `serverUrl` that is this
  server),
  `GET <server>/api/v1/system/providers/state?providerId=claude-code` (`providerId=pi`
  for a pi launch, and both on a read with no planned launch).

## Hooks
- `launch`: runs at every start of a home that has the capability. On this provider it does
  nothing (the launch verb writes Claude's local settings). On another backend
  (`OATS_BACKEND` set and not `bb`) it removes the provider's four keys (`env`, `sandbox`,
  `permissions.deny`, `permissions.blockWritesOutsideWorkingDirectories`)
  from `.claude/settings.local.json` when `OATS_PREVIOUS_BACKEND` is `bb`, and only then:
  nothing in the home decides it. Where that variable is absent it removes nothing, and
  warns that they may be stale if a `sandbox` block, or the deny of bb's directory-move tool, stands in the file. In every case it deletes, unread and best effort, what an earlier
  version of the provider kept in the home (`.oats-bb/`, `.oats-bb-sandbox.json`).
  On the same word it removes the env of the home's bb project (what a pi launch wrote; "pi" above).
  It returns no env and no arguments.
- `retire`: its last line's `meta` is the provider's receipt of what bb holds of the home
  when the hook ends: `archived`, every thread of the home that is archived in bb then
  (those the hook archived, then those it found archived already: by the stop inside the
  retire, by a person, by an earlier start; only its own where the archived threads could
  not be listed); `retired: true` where bb has a thread of the home and none is left live;
  `{retired: false, reason: "nothing-to-delete"}` only where bb has no thread of the home
  at all and no env was removed. Where the provider's record of the home's threads is
  there and is this home's (below), `archived` names, of the threads found archived
  already, only those in it: a home made at a path an earlier home had shares that
  home's bb project, and does not report its threads. `environments`: the bb environments
  the hook asked bb to delete, where it did.
  The hook archives the home's live bb threads, after the kernel's stop, removes the env of
  the home's bb project, and deletes those two old names too (best effort). The hook is not
  told the home's backend, and nothing in the home proves it has no thread (its agent can
  write there, and the provider keeps nothing of its own there), so bb is asked for every
  home, and a bb that cannot be asked is a warning for every home, a tmux home too;
  threads left that way are what readiness reports as `session-provider-orphaned`.
  **The home's bb environment (contract r32, A17).** Last, the hook deletes the home's bb
  environment (`bb environment delete <id>`), so that a thread of the home, even once a
  person unarchived it, takes no message (`thread_environment_unavailable`) and starts
  nothing in a home that was kept. bb keeps one environment per home, shared by every
  thread that runs there, a person's included, so the delete is asked only where all of
  this holds; anything else leaves the threads archived only, and the warning says why:
  - every thread of the home was stopped and archived by the hook's rule, and the home's
    archived threads were listed;
  - the environment (the one a thread of the home's project is on, `bb environment show`)
    is there, has the home as its `path`, and is the local-path kind:
    `environmentProviderId: "project-checkout"` and `managed: false`. One bb has destroyed
    already is passed over in silence. One at another directory is never deleted: the
    warning says so where a thread of the home's own is on it, and nothing where only
    other threads of the home's bb project are;
  - `bb thread list --environment <id> --include-archived --include-hidden` was read
    whole (every row readable, every row on that environment, and none missing of the
    threads the hook itself saw on it in the home's project), and every thread in it is
    archived and is in the home's record.
  The delete answers at once and bb tears the environment down afterwards; the hook
  waits for neither more than one bb call. A delete that bb refuses, that does not
  answer, or that meets a bb that is down fails nothing: one line on the hook's stderr
  with bb's own words and the command to run in bb, and the warning says it was not
  done. The warning's rule: it is given whenever a thread of the home is left without a
  deleted environment. So also for a thread with no environment yet (a row whose
  `environmentId` is null: bb makes the environment when the thread's first turn
  starts), which leaves nothing to delete. Which threads are the home's, for that and
  for `archived`: those in its record and those the hook archived; with no record that
  is this home's, every thread of the home's bb project.
  **The record.** `$XDG_STATE_HOME/oats-bb/homes/<sha256 of the home's real path>`
  (`~/.local/state/oats-bb/homes/` where the variable is unset or not absolute, on every
  platform), directories `0700`, the file `0600`. Line 1: `oats-bb-home 1 dev=<n>
  ino=<n> birth=<nanoseconds|->`, the home directory's identity. Every other line: one
  thread id. Each line is written whole (one append; a new record by write and rename).
  The launch verb adds the thread it answers; a write that fails never fails the launch
  (one line on stderr), and that thread is then unmarked. A record is this home's where
  its birth time and inode both equal the directory's, whatever the device; a record
  with no birth time, where device and inode both do. One of another directory at the
  path is ignored (and replaced by that home's next launch). Not read: a file that is
  not regular, has a second name, another owner or another mode, or whose directories
  are not this user's `0700` directories (unreadable); anything but that first line and
  whole lines of one id (malformed). The hook removes the record once it has decided
  (deleted, or a no that rests on what was read: the kind, a malformed record, a thread
  that is not the home's own). An unreadable record, and one of another directory, is
  never removed by the hook. Where it could not decide (bb could not be asked or read, a
  thread would not stop, a thread on the environment was not archived, bb did not do the
  delete) the record stays, and a retire run again decides. So one can outlive a home
  whose retire never got through to bb: harmless (ids only; a later home at the
  path does not match it and replaces it), and an operator may delete the files of
  `homes/` while no bb home of that user runs. No other verb or hook reads or writes it.
  **WARNING: a retired agent whose home was kept (`oats retire --keep-dir`, or a retire
  that ended quarantined) can still be started again from bb.** The delete is a
  deliberate step in the way, not a lock: bb's own Restore (`bb thread
  restore-environment <id>`, which its refusal names) gives the unarchived thread an
  environment at the kept home again, a new one made from the destroyed one's recorded
  path, and a message then starts the harness there. Where the hook archived only,
  Unarchive and a message are enough. Such a session runs with NO OATS around it: no
  status row, no hooks OATS runs for it, no stop by OATS. Where its aweb identity was not
  released (a team leave waiting for its controller, a retained seat, an alias held), it
  can send mail as the retired agent. Retire bb agents the ordinary way, which removes
  the home: then nothing can start. The hook's warning reaches CLI users only: the
  Desktop's Retire dialog shows no plan warnings and no hook output (oats#2102). A home
  spawned before the record existed has none and is archived only: not a failure.
