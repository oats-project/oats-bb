# The wire between the kernel and this provider (proposal v1, P1 side)

Contract r7 item 1 gives the fields of each call; it does not fix the envelope. This is what
the provider speaks until K1 fixes it. It mirrors the two wires the kernel already has
(`binding.check` and `triggerSources`, docs/capabilities.md). The provider keeps all of it in
`lib/wire.mjs`, so a different choice by K1 is a change to one file.

## Invocation
`node <module>/<script> <words>` from the home's module copy, no shell; one JSON document on
stdin; exit 0 and exactly one JSON document on stdout. Environment as a dispatched command
gets it (`OATS_CAPABILITY`, `OATS_SETTINGS`, `OATS_SETTINGS_ORIGINS`, `OATS_CLI_BIN`,
`OATS_NODE_BIN`) plus `OATS_BACKEND`, `OATS_INSTANCE` and `OATS_INSTANCE_HOME`.

## Request
```json
{"schemaVersion":1,"phase":"launch","provider":"bb","capability":"oats.bb",
 "settings":{"server":"http://127.0.0.1:38886","trust":"single-user","version":"0.50.1"},
 "input":{ ... }}
```
`phase` is `launch | inspect | inspectMany | input | stop`. `settings` is the home's recorded
merged payload (the provider falls back to `OATS_SETTINGS` when the key is absent). `input`:

| phase | input |
|---|---|
| launch | `{home, instance, harness, model, yolo, env, args, promptFile, previous}` |
| inspect | `{home, endpoint}` |
| inspectMany | `{homes: [{home, endpoint}]}` |
| input | `{home, endpoint, text}` |
| stop | `{home, endpoint, graceSeconds}` |

- `env` is a list `[{name, value, source, secret}]`: `source` is a word for where the entry
  came from (for the refusal message), `secret` a boolean. The provider refuses an entry
  whose `secret` is not exactly `false` (`E_BACKEND_LAUNCH_ENV`), so a kernel that cannot
  tell must say `true`.
- `args` is the list of extra harness arguments only (launch hooks' and the launch
  configuration's); model, yolo and the prompt travel in their own fields. The provider
  carries one: `--permission-mode <auto|acceptEdits|bypassPermissions>` (one or two words),
  mapped to bb's `auto | accept-edits | full`. Any other argument: `E_BACKEND_LAUNCH_ARG`.
- `yolo` is `true`, `false` or `null` (no choice). `previous` is the endpoint recorded
  before this launch, or `null`.

## Answer
```json
{"schemaVersion":1,"phase":"launch","provider":"bb","capability":"oats.bb","ok":true,
 "result":{"endpoint":{"server":"http://127.0.0.1:38886","projectId":"proj_…","threadId":"thr_…"}}}
```
`schemaVersion`, `phase`, `provider` and `capability` echo the request. A refusal is
`{…,"ok":false,"error":{"code","message","details"?}}`; `details.unconfirmed: true` when an
effect may have happened (a tell or a spawn whose answer was lost).

| phase | result |
|---|---|
| launch | `{endpoint: {server, projectId, threadId}}` |
| inspect | `{present, state, running, open?}` |
| inspectMany | `{results: [<an inspect result> or {error: {code, message}}]}`, in the request's order |
| input | `{submitted: true, verified}` |
| stop | `{stopped: true}` |

## Codes the provider answers
`E_BACKEND_LAUNCH_ENV`, `E_BACKEND_LAUNCH_ARG`, `E_BACKEND_HARNESS`, `E_BACKEND_VERSION`,
`E_BACKEND_EXPOSED`, `E_BACKEND_TRUST`, `E_BACKEND_NOT_READY`, `E_BACKEND_UNREACHABLE` (bb's
server or host daemon does not answer), `E_BACKEND_SETTINGS` (a malformed setting),
`E_SESSION_UNAVAILABLE`, `E_SESSION_START_FAILED`, `E_SESSION_PROMPT_OPEN`,
`E_SESSION_INPUT_QUEUED`, `E_SESSION_INPUT_FAILED`, `E_SESSION_STOP_FAILED`.

## Time
The contract gives launch 120 s and the others 20 s. The provider bounds every bb call (10 s)
and its own total (launch 100 s, the others 16 s). `stop` waits `graceSeconds` for bb to
settle, at most 12 s, so that it answers inside the kernel's 20 s; a kernel that gives stop
`graceSeconds` plus a margin can lift that cap.

## Readiness and retire
- Readiness is the released `binding.check` wire, with the `slot` the kernel sends (`null`
  for a capability with no layer).
- Retire: the capability's `retire` hook archives every live thread of the home's bb
  project, after the kernel's stop. It needs nothing but the hook environment.
