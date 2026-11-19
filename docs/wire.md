# What the provider speaks

The kernel's session-provider contract defines the wire (the OATS repository,
`docs/capabilities.md`, once the contract lands there; until then the kernel side's
`k1-session-provider-wire.v1.md`). This is the provider's side of it, in short. All of the
envelope is in `lib/wire.mjs`.

## The call
`node <home>/.oats/modules/oats.bb/bin/oats-bb.mjs session <verb>`, with the home's hook
environment (`OATS_SETTINGS` holds `settings.oats.bb`), one JSON request on stdin, exactly
one JSON document on stdout, exit 0 for a result and for a refusal.

```json
{"schemaVersion":1,"phase":"session","capability":"oats.bb","provider":"bb","verb":"inspect",
 "input":{"home":"/abs/home","endpoint":{"server":"http://127.0.0.1:38886","projectId":"proj_…","threadId":"thr_…"}}}
```
```json
{"schemaVersion":1,"phase":"session","capability":"oats.bb","provider":"bb","verb":"inspect","ok":true,
 "result":{"present":true,"state":"unknown","running":null,"open":{"label":"Open in bb","url":"http://127.0.0.1:38886/projects/proj_…/threads/thr_…"}}}
```
A refusal is `"ok": false, "error": {"code": "E_…", "message": "…"}`, and nothing else.

| verb | input | result |
|---|---|---|
| launch | `{home, instance, harness, model, yolo, env, unset, args, promptFile, previous}` | `{endpoint: {server, projectId, threadId}}` |
| inspect | `{home, endpoint}` | `{present, state, running, open?}` |
| inspectMany | `{homes: [{home, endpoint}]}` | `{results: [<inspect result> or {error: {code, message}}]}`, in order |
| input | `{home, endpoint, text}` | `{submitted: true, verified}` |
| stop | `{home, endpoint or null, graceSeconds}` | `{stopped: true}` |
| check | `{home or null, soul or null, settings?}` | `{status, problems: [{code, message}], warnings: [{code, message}]}` |

- **launch `env`** is a list of `{name, value, source, capability?, secret?}`. The provider
  writes an entry only when its `source` is `kernel`, `capability` or `launch-config` and it
  is not marked `secret`; any other entry refuses the launch (`E_BACKEND_LAUNCH_ENV`). So a
  source word the provider does not know is refused, never written. `unset` names are
  removed from the env file.
- **launch `args`** holds the launch configuration's and the capabilities' arguments only.
  The provider carries one, `--permission-mode`; any other refuses the launch
  (`E_BACKEND_LAUNCH_ARG`).
- **stop** with `endpoint: null` stops every live thread that runs in the home (the kernel
  compensating a launch whose answer was lost).
- **check** is the readiness check. `status` is `ready`, `needs-configuration`,
  `authorization-required` or `unavailable`; `ready` has no problems.

## Codes
`E_BACKEND_LAUNCH_ENV`, `E_BACKEND_LAUNCH_ARG`, `E_BACKEND_HARNESS`, `E_BACKEND_VERSION`,
`E_BACKEND_EXPOSED`, `E_BACKEND_TRUST`, `E_BACKEND_NOT_READY`, `E_BACKEND_UNREACHABLE`,
`E_BACKEND_SETTINGS`, `E_SESSION_UNAVAILABLE`, `E_SESSION_START_FAILED`,
`E_SESSION_PROMPT_OPEN`, `E_SESSION_INPUT_QUEUED`, `E_SESSION_INPUT_FAILED`,
`E_SESSION_STOP_FAILED`.

## Time
The kernel gives launch 120 s and the other verbs 20 s. The provider bounds every bb call
(10 s) and its own total (launch 100 s, the others 16 s). `stop` waits `graceSeconds` for bb
to settle, at most 12 s, so that it answers inside the kernel's 20 s.

## The bb surface used
At the bb-app version in `bb-version`, pinned by `test/contract/`:
- CLI: `bb --version`, `bb project list`, `bb project create`, `bb thread list`,
  `bb thread show`, `bb thread spawn`, `bb thread tell`, `bb thread interactions list`,
  `bb thread queue delete`, `bb thread stop`, `bb thread archive`.
- HTTP, loopback only, read-only, bounded in size and time, strictly decoded:
  `GET <server>/health`, `GET <daemon>/status`,
  `GET <server>/api/v1/system/providers/state?providerId=claude-code`.
