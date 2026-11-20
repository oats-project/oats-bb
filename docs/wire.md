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
  `auto` mode. The provider refuses it before it reads or starts anything
  (`E_BACKEND_SANDBOXED_MODE`). The check says the same of a planned launch: the refusal
  stands alone among the planned launch's findings, beside whatever is wrong with bb
  itself. A check with no planned launch (`oats readiness`, for a soul or a home) cannot
  know the mode, and carries the warning `session-provider-full-mode-only` instead. The deny set of contract item 6c (D16) is not in this release; the
  provider's next change brings it and lifts the refusal. What is written below about
  `sandbox` describes that code, which is here and tested, and runs once the refusal is
  lifted.
- **The endpoint a launch answers is new.** Every launch answers a thread bb made for it:
  bb makes a new thread id for each spawn, and the provider never answers an endpoint it
  answered before for that home. It never answers the `previous` endpoint's thread, from
  bb's own answer or otherwise; and where the spawn's fate is unknown it takes only a
  thread bb created after the spawn was asked for (bb's `createdAt`; bb and the provider
  are on one host), so an older thread of the home that shows again is not answered (the
  launch stays in doubt). The kernel may tell a new session from an old one by its
  endpoint.
- **launch `sandbox`** is
  `{domains: [{host, capability, setting}], write: [{path, reason}], missing: [{capability,
  setting, team, optional, defaultTeam}]}`, built by the kernel from recorded configuration, or
  `{unavailable: "<cause>"}` when the kernel could not resolve it (`false` or an empty
  string there mean it was resolved). A `skipped: [{capability, reason}]` is read and
  listed by the check if it comes; the kernel does not send it today. The shape is the
  one decided in the contract (r12); the kernel change that sends it is not released yet,
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
  - A limit: the stop sees what bb shows when it is called. The provider starts each bb
    call in a session of its own, so a bb call can outlive a killed provider and create
    its thread after this stop answered. Nothing is lost silently: the next launch refuses
    and names that thread; but this stop did not stop it.
- **check** is the readiness check. `status` is `ready`, `needs-configuration`,
  `authorization-required` or `unavailable`; `ready` has no problems. With the planned
  launch (`launch: {harness, yolo, args, sandbox}`, there before every launch and absent on
  a plain readiness read), it also answers what that launch would be refused for (its
  harness, its arguments, its mode, the sandbox it needs), as a problem with the launch's own code, and lists optional rows, skipped
  capabilities and, for a full-mode launch, the gaps, as warnings (optional rows and skipped
  capabilities are named only here: the provider keeps no record of them after a launch). Without it, the check
  can only say, for a home, what its last launch left on record, and, for a soul or a home,
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
  `archivedAt`, `deletedAt` and `environmentPath` included),
  `bb thread show`, `bb thread spawn`, `bb thread tell`, `bb thread interactions list`,
  `bb thread queue delete`, `bb thread stop`, `bb thread archive`. A list is read row by
  row: a project needs an `id` and its `sources`, a thread an `id` and a `status` (and a
  `projectId`, `archivedAt`, `deletedAt`, `environmentPath` of the kind bb writes), an
  interaction an `id` and a `status`. One row that is not that, and the whole read is an
  error: only a list the provider can read says a thread, or a prompt, is not there.
- HTTP, loopback only, read-only, bounded in size and time, strictly decoded:
  `GET <server>/health`, `GET <daemon>/status` (`connected`, and a `serverUrl` that is this
  server),
  `GET <server>/api/v1/system/providers/state?providerId=claude-code`.

## Hooks
- `launch`: runs at every start of a home that has the capability. On this provider it does
  nothing (the launch verb writes Claude's local settings). On another backend
  (`OATS_BACKEND` set and not `bb`) it removes what the provider wrote into
  `.claude/settings.local.json`. It returns no env and no arguments.
- `retire`: archives the home's live bb threads, after the kernel's stop. The hook is not
  told the home's backend, and nothing in the home proves it has no thread (its agent can
  write there), so bb is asked for every home. Where the provider's state directory is
  absent (a tmux home, or a cleaned one) a bb that cannot be asked gives no warning;
  threads left that way are what readiness reports as `session-provider-orphaned`.
