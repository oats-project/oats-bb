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
| stop | `{home, endpoint or null, graceSeconds}` | `{stopped: true}` |
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
- **launch `sandbox`** (provisional: the kernel's change that sends it is not merged) is
  `{domains: [{host, capability, setting}], write: [{path, reason}], missing: [{capability,
  setting, team, optional}]}`, built by the kernel from recorded configuration, or
  `{unavailable: "<cause>"}` when the kernel could not resolve it (`false` or an empty
  string there mean it was resolved). A `skipped: [{capability, reason}]` is read and
  listed by the check if it comes; the kernel does not send it today. A kernel may not send the key yet, and then nothing is written (readiness says the
  allowances are missing).
  - In a sandboxed mode the provider writes exactly the `domains` and `write` entries. An
    entry that is not one exact host or one exact absolute path refuses the launch in
    every mode (`E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`).
  - `missing` is what a provider's line named and the deployment has no value for. A
    sandboxed launch with a row that is not `optional` is refused (`E_BACKEND_SANDBOX_HOST`,
    naming each and `oats aweb setup`); a row the provider cannot name is counted, never
    dropped. `unavailable` refuses a sandboxed launch (`E_BACKEND_SANDBOX_UNAVAILABLE`).
  - Beside `unavailable` nothing else of the object is read: there are no lists to write.
  - A sandboxed launch must understand everything it is told: a key the provider does not
    know, or a `missing` that is not a list, refuses it. A full-mode launch writes nothing
    and ignores `missing`, `skipped`, `unavailable` and unknown keys, whatever they hold.
- **stop** with `endpoint: null` stops every live thread that runs in the home (the kernel
  compensating a launch whose answer was lost).
- **check** is the readiness check. `status` is `ready`, `needs-configuration`,
  `authorization-required` or `unavailable`; `ready` has no problems. With the planned
  launch (`launch: {harness, yolo, args, sandbox}`, there before every launch and absent on
  a plain readiness read), it also answers what that launch would be refused for (its
  harness, its arguments, the sandbox it needs), as a problem with the launch's own code, and lists optional rows, skipped
  capabilities and, for a full-mode launch, the gaps, as warnings (optional rows and skipped
  capabilities are named only here: the provider keeps no record of them after a launch). Without it, the check
  can only say, for a home, what its last launch left on record.

## Codes
`E_BACKEND_WIRE`, `E_BACKEND_LAUNCH_ENV`, `E_BACKEND_LAUNCH_ARG`, `E_BACKEND_HARNESS`, `E_BACKEND_VERSION`,
`E_BACKEND_EXPOSED`, `E_BACKEND_TRUST`, `E_BACKEND_NOT_READY`, `E_BACKEND_UNREACHABLE`,
`E_BACKEND_SETTINGS`, `E_BACKEND_SANDBOX_HOST`, `E_BACKEND_SANDBOX_PATH`,
`E_BACKEND_SANDBOX_UNAVAILABLE`, `E_SESSION_UNAVAILABLE`, `E_SESSION_START_FAILED`,
`E_SESSION_PROMPT_OPEN`, `E_SESSION_INPUT_QUEUED`, `E_SESSION_INPUT_FAILED`,
`E_SESSION_STOP_FAILED`.

## Time
The kernel gives launch 120 s, stop 20 s plus its `graceSeconds`, and the other verbs,
`check` included, 20 s. The provider bounds every bb call (10 s), every HTTP read (4 s; the
provider state 6 s) and its own total (launch 100 s; stop 16 s plus the grace, which is how
long it waits for bb to settle; the others 16 s), so a bb that hangs gets a named problem,
never a killed call.

## The bb surface used
At the bb-app version in `bb-version`, pinned by `test/contract/`:
- CLI: `bb --version`, `bb project list`, `bb project create`, `bb thread list` (its rows'
  `archivedAt`, `deletedAt` and `environmentPath` included),
  `bb thread show`, `bb thread spawn`, `bb thread tell`, `bb thread interactions list`,
  `bb thread queue delete`, `bb thread stop`, `bb thread archive`.
- HTTP, loopback only, read-only, bounded in size and time, strictly decoded:
  `GET <server>/health`, `GET <daemon>/status`,
  `GET <server>/api/v1/system/providers/state?providerId=claude-code`.

## Hooks
- `launch`: runs at every start of a home that has the capability. On this provider it does
  nothing (the launch verb writes Claude's local settings). On another backend
  (`OATS_BACKEND` set and not `bb`) it removes what the provider wrote into
  `.claude/settings.local.json`. It returns no env and no arguments.
- `retire`: archives the home's live bb threads, after the kernel's stop.
