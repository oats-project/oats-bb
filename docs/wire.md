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
| launch | `{home, instance, harness, model, yolo, env, unset, pathPrepend, args, promptFile, previous, sandbox?}` | `{endpoint: {server, projectId, threadId}}` |
| inspect | `{home, endpoint}` | `{present, state, running, open?}` |
| inspectMany | `{homes: [{home, endpoint}]}` | `{results: [<inspect result> or {error: {code, message}}]}`, in order |
| input | `{home, endpoint, text}` | `{submitted: true, verified}` |
| stop | `{home, endpoint or null, graceSeconds, launchSent?}` | `{stopped: true}` |
| check | `{home or null, soul or null, settings?, launch?}` | `{status, problems: [{code, message}], warnings: [{code, message}]}` |

- **launch `env`** is a list of `{name, value, source, capability?, secret?}`. The provider
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
  The provider carries one, `--permission-mode`; any other refuses the launch
  (`E_BACKEND_LAUNCH_ARG`).
- **A launch in a sandboxed mode is refused for now.** With `yolo` not true and no
  `--permission-mode bypassPermissions`, the launch would run in bb's `accept-edits` or
  `auto` mode. The provider refuses it before any effect, right after the launch input's own checks
  (`E_BACKEND_SANDBOXED_MODE`). The check says the same of a planned launch: the refusal
  stands alone among the planned launch's findings, beside whatever is wrong with bb
  itself. A check with no planned launch (`oats readiness`, for a soul or a home) cannot
  know the mode, and carries the warning `session-provider-full-mode-only` instead. The deny set of contract item 6c (D16) is not in this release; the
  provider's next change brings it and lifts the refusal. What is written below about
  `sandbox` describes that code, which is here and tested, and runs once the refusal is
  lifted.
- **The endpoint a launch answers is new.** Every launch answers a thread bb made for it.
  bb makes a new thread id for each spawn, and the provider does not take that on trust:
  bb's answer to the spawn is the launch's thread only when it names a thread bb did not
  have before the spawn (not the `previous` endpoint's, not another thread of the home's
  project, live or archived) and, where it names a project, the home's. Any other answer,
  like a spawn whose fate is unknown, makes the launch look: it then takes only a thread
  bb created after the spawn was asked for (bb's `createdAt`; bb and the provider are on
  one host), so an older thread of the home that shows again is not answered (the launch
  stays in doubt). The kernel may tell a new session from an old one by its endpoint.
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
- **stop** with `endpoint: null` stops every live thread that runs in the home (the kernel
  compensating a launch whose answer was lost, or whose caller was killed while it ran):
  it finds the home's bb project and its live threads, and answers `stopped` also when
  there is none, `E_SESSION_STOP_FAILED` when it cannot tell.
  - `launchSent` (the receipt's record that a launch was sent, in the form the kernel
    writes: an ISO 8601 UTC time ending in `Z`; the kernel change that passes it is not
    released yet) says which threads are taken to be that launch's: one bb created at or
    after it (bb's `createdAt`, milliseconds) is archived once stopped, so the next start
    is not refused for a thread nobody recorded. The archive is best effort: where bb does
    not archive it, the stop still answers `stopped` and the next launch names the thread.
    A thread created before it, and every thread when `launchSent` is absent or is not in
    that form, is stopped and not archived: it may be a person's, and the next launch
    names it.
  - The rule's reach: a thread a person starts in the home after the failed launch was
    sent is at or after that time too, and is stopped and archived with it, whenever the
    kernel's next stop, start or retire comes. It stays in bb, archived.
  - A limit: the stop sees what bb shows when it is called. The kernel kills a provider
    command's whole process group, and the provider's bb calls stay in that group (below),
    so no bb call outlives a killed launch; but bb's server may still be making the thread
    of a request it had already received, and show it only after this stop answered.
    Nothing is lost silently: the next launch refuses and names that thread; but this
    stop did not stop it.
- **check** is the readiness check. `status` is `ready`, `needs-configuration`,
  `authorization-required` or `unavailable`; `ready` has no problems. With the planned
  launch (`launch: {harness, yolo, args, sandbox}`, there before every launch and absent on
  a plain readiness read), it also answers what that launch would be refused for (its
  harness, its arguments, its mode, the sandbox it needs), as a problem with the launch's own code, and lists optional rows, skipped
  capabilities and, for a full-mode launch, the gaps, as warnings (optional rows and skipped
  capabilities are named only here: the provider keeps no record of them after a launch). Without it, the check
  says nothing of a launch (the provider keeps no record of one in the home), and says, for a soul or a home,
  which mode the command launches in (`session-provider-full-mode-only`).

## Codes
`E_BACKEND_WIRE`, `E_BACKEND_LAUNCH_ENV`, `E_BACKEND_LAUNCH_ARG`, `E_BACKEND_SANDBOXED_MODE`, `E_BACKEND_HARNESS`, `E_BACKEND_VERSION`,
`E_BACKEND_EXPOSED`, `E_BACKEND_TRUST`, `E_BACKEND_NOT_READY`, `E_BACKEND_UNREACHABLE`,
`E_BACKEND_SETTINGS`, `E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`,
`E_BACKEND_SANDBOX_UNAVAILABLE`, `E_SESSION_UNAVAILABLE`, `E_SESSION_START_FAILED`,
`E_SESSION_PROMPT_OPEN`, `E_SESSION_INPUT_QUEUED`, `E_SESSION_INPUT_FAILED`,
`E_SESSION_STOP_FAILED`.

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
- CLI: `bb --version`, `bb project list`, `bb project create`, `bb thread list` (its rows'
  `archivedAt`, `deletedAt`, `environmentPath`, `queuedWork` and `createdAt`, in milliseconds, included),
  `bb thread show`, `bb thread spawn`, `bb thread tell`, `bb thread interactions list`,
  `bb thread queue list`, `bb thread queue delete`, `bb thread stop` (also of an archived
  thread), `bb thread archive`, and `bb thread list --project <id> --archived`. The
  contract test also sets bb's limit (`bb concurrency-limit global`), to pin what a held
  turn looks like and that a stop withdraws it. A list is read row by
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
  `GET <server>/api/v1/system/providers/state?providerId=claude-code`.

## Hooks
- `launch`: runs at every start of a home that has the capability. On this provider it does
  nothing (the launch verb writes Claude's local settings). On another backend
  (`OATS_BACKEND` set and not `bb`) it removes the provider's two keys (`env`, `sandbox`)
  from `.claude/settings.local.json` when `OATS_PREVIOUS_BACKEND` is `bb`, and only then:
  nothing in the home decides it. Where that variable is absent it removes nothing, and
  warns if a `sandbox` block stands in the file. In every case it deletes, unread and best effort, what an earlier
  version of the provider kept in the home (`.oats-bb/`, `.oats-bb-sandbox.json`).
  It returns no env and no arguments.
- `retire`: archives the home's live bb threads, after the kernel's stop, and deletes those
  two old names too (best effort). The hook is not
  told the home's backend, and nothing in the home proves it has no thread (its agent can
  write there, and the provider keeps nothing of its own there), so bb is asked for every
  home, and a bb that cannot be asked is a warning for every home, a tmux home too;
  threads left that way are what readiness reports as `session-provider-orphaned`.
