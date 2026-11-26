# The Automations fixtures

Every `.json` here is what a real kernel printed for one `oats` call, whole (an envelope
`{schemaVersion, ok, result | error}`), printed with one
space of indentation. `recorded.json` names the call behind each file (its argv and exit code) and
the kernel's version. The substitutions are the real run's and there is no other edit: the
deployment is `/abs/deployment`, the run's directory `/abs/real`, the container user's home
`/abs/home`. Times, commit ids, run ids and instance names are as recorded, and the tests hold
some as literals or patterns: a new recording changes both.

(The recorder's kernel is now the one the real run pins, OATS 0.70.5, which the provider's floor
must admit; the files here are still the recording below.)

Recorded on 2026-11-21 from OATS 0.70.0 from npm (`@awebai/oats@0.70.0`), bb-app 0.50.1, the bb
session provider of this repository at `134ca09ab6d89c0432ba2e53cd7bbfd9bfc185e5`, Claude Code on
the mock model, by `record/record.sh` (about twelve minutes; `UPDATE_FIXTURES=1` copies the
answers here):

```sh
UPDATE_FIXTURES=1 plugin/test/fixtures/automations/record/record.sh
```

`record/record.sh` starts the real run's container and runs its setup
(`container/real/setup.sh`), then `record/record.mjs` instead of the real run's scenario.
`record/workspace.sh` adds to the real run's workspace what the lists need.

## What the recording does NOT hold (said loudly)

Two features of the kernel are in no released OATS yet (awebai/oats #2142: `trigger-failure-history`,
`status-automation`; the recording is OATS 0.70.0 and the real run pins 0.70.5), so no file here
holds their fields:

- **A trigger's failed spawns** (`failures[]`, `failuresTotal` on a row of `oats trigger status`).
  The recorded states have neither key, and the plugin then claims no history (`failures: null`:
  test/automations/runs.test.ts holds that on every recorded trigger). The ONE test of the rows a
  history would draw (test/automations/view.test.tsx, its name starts "NAMED FIELDS ADDED TO A
  RECORDED ANSWER") adds, by hand, to a recorded state, the fields the kernel's contract names
  (awebai/oats docs/desktop-cli-api.md: `attempt, at, key, event, subject, code, message,
  resolved`): it is a test of the drawing on those names, not of a kernel's answer. It is to be
  replaced by a recording as soon as a released kernel answers them.
- **The automation that made an agent** (`automation` on a row of `oats status`): not read by the
  plugin yet.

The busy sets (test/automations/busy.ts for the unit tests, container/scenes/automations-busy.mjs
for the live scenes: 37 automations, five failing, fifty-run histories, names of sixty
characters) are no recording either: they MULTIPLY the recorded rows of this directory (every row
is a recorded row; only its id, its name and the times and ids of its repeated runs are varied;
the live one also names, as the agent of three runs, three agents of the scenes' roster, and
repeats the recorded instruction of one schedule twelve times, numbered, for a long one). They
are for the worst-case scenes and images, and for the one test that the row's red, the filter's
count and the sidebar's dot agree; a parser's tests stay on the recorded answers.

## What was arranged, and what was not

The script arranges the kernel's input, never its answer:

- **Definitions**, through `oats schedule add` and `oats trigger add`, and the member's own files:
  four workspace schedules and five workspace triggers, placed on this host (`bb-box`) and on
  others, one of them not trusted here and one acting as another account.
- **A capability that fills the knowledge layer with one operation** (`acme.notes`), its soul and
  an agent of it on bb: what a schedule that runs a provider operation names.
- **A capability with a trigger source** (`acme.graph:harvest-branches`, a member capability) and a
  soul that composes it. Its script answers what the recording tells it: two events the trigger
  selects, one it filters, two OATS refuses, two items the source skipped (one with text a hostile
  source could send), and later the source's own refusal.
- **Three things outside OATS that a container does not have**, each a double at that boundary:
  `gh` (answers as the account `ana` and lists five open pull requests; the OATS repository's own
  tests use the same double), and the host's service manager: a `systemctl` that takes the timer's
  install and says it is active. It is on `PATH` only from `host-install.json` to the last tick;
  `host-install-refused.json` is the kernel's own answer on a host without one.
- **One file nobody validated**: the job `legacy-herdr` (`backend: herdr`) was written into
  `oats-schedules.json` by hand, which is how a stored definition that no longer validates gets
  there. Its row (`invalid`) is the kernel's.

Everything else happened: `schedule run` launched a bb agent (and the kernel made that agent's wake
schedule), the ticks polled, fired and launched bb agents, held the events over each trigger's
bound, and recorded the failed poll.

## The files

| File | The call | Holds |
|---|---|---|
| `schedule-list-empty.json`, `trigger-list-empty.json`, `host-status-off.json` | before anything | no row, no snapshot, no host name, no timer |
| `schedule-list-scheduler-off.json` | after the local schedules were added | rows that run here and no host timer |
| `schedule-list.json`, `trigger-list.json` | after the runs and two ticks, the timer installed | the lists the pages start from (below) |
| `trigger-status.json`, `trigger-status-one.json` | the same moment | every trigger's recorded state; one trigger's |
| `trigger-status-poll-failed.json`, `trigger-list-poll-failed.json` | a tick later, the source refusing | a failed poll beside the last good poll's lists |
| `schedule-list-host-unnamed.json`, `trigger-list-host-unnamed.json` | `host.name` taken out of `oats-local.yaml` | every workspace row `host-unnamed` |
| `host-status-on.json`, `host-install.json`, `host-install-refused.json` | `schedule host status`, `install` | the timer on; installed; a host with no service manager (`E_SCHEDULE_HOST`) |
| `schedule-add*.json`, `schedule-show.json`, `schedule-enable*.json`, `schedule-disable*.json`, `schedule-describe*.json`, `schedule-remove*.json` | the verb in the name | the answer, and the refusals (`-exists`, `-invalid`, `-workspace`, `-unknown`) |
| `schedule-test*.json` | `schedule test` | ready here; placed elsewhere; the bb job without yolo |
| `schedule-run*.json` | `schedule run` | a bb agent launched; a launch the provider refused; a command; a provider operation; the refusals (`-elsewhere`, `-disabled`) |
| `capabilities.json` | `oats capabilities` | the capabilities of the recording's workspace (the Capabilities page's list: a trigger source's capability is looked up in it) |
| `inspect-home.json` | `oats inspect --home <the notes keeper's home>` | the operations a home offers |
| `schedule-reconcile.json` | `schedule reconcile status-check` | a run whose state is unknown, checked |
| `trigger-add*.json`, `trigger-show.json`, `trigger-enable.json`, `trigger-disable.json`, `trigger-describe*.json`, `trigger-remove.json` | the verb in the name | the answer, and the refusals |
| `trigger-test.json`, `trigger-test-elsewhere.json` | `trigger test` of a pull-request trigger | what would fire now; one placed elsewhere |
| `trigger-test-source-unconfirmed.json`, `trigger-test-source.json`, `trigger-test-source-failed.json` | `trigger test` of a capability source's trigger, without and with `--run-source` | nothing ran (`E_TRIGGER_SOURCE_RUN`); the source's answer; the source's refusal |

The rows of `schedule-list.json`:

| Row | Is |
|---|---|
| `local/daily-review` | a spawn on bb with `yolo`, a summary and a wake for its agents; run once: a bb agent launched |
| `local/wake-oats-developer-review-<minute>` | the wake the kernel made for that agent |
| `local/hourly-check` | a spawn on bb **without** `yolo`: OATS 0.70.0 saves it, and its run is `launch-failed` (`E_BACKEND_SANDBOXED_MODE`) |
| `local/notes-checkpoint` | a provider operation (`knowledge:checkpoint`) in the home of an agent that keeps the notes; run once |
| `local/status-check` | a command; its run answered no envelope, so its state is unknown (an `attempt`) |
| `local/weekly-cleanup` | a spawn, turned off |
| `local/legacy-herdr` | invalid (above) |
| `oats-real/nightly-digest` | workspace, runs here |
| `oats-real/reconcile` | workspace, `owner-mismatch` |
| `oats-real/release-check` | workspace, `untrusted` |
| `oats-real/weekly-report` | workspace, `assigned-elsewhere` |

The rows of `trigger-list.json`:

| Row | Is |
|---|---|
| `local/pr-triage` | pull requests of `acme/app`; one fired, three wait (its bound is 1) |
| `local/graph-watch` | the capability source, both its events; one fired, two wait |
| `local/old-prs` | turned off |
| `oats-real/proposal-review` | workspace, pull requests with a label and a base; two fired, one waits (its bound is 2) |
| `oats-real/harvest-review` | workspace, the capability source with parameters; one fired, one waits |
| `oats-real/harvest-closed` | workspace, names an event the source does not declare: its check failed at the poll (`invalid` with `at`) |
| `oats-real/docs-review` | workspace, `assigned-elsewhere` |

## What could not be recorded

- An **unreadable** row, and a workspace row with a web address (`origin.url`: the kernel gives one
  for `github.com` members only, and the member here is a local repository).

## What is not recorded

Three answers the live scenes use are written in `container/scenes/automations.mjs`, not recorded,
because each needs a deployment the recording could not go on from:

- `schedule list` refused with `E_SCHEDULE_INVALID` (a definitions file that is not one) and
  `trigger status` refused with `E_TRIGGER_UNKNOWN` (a trigger removed after the list was read).
  Both carry the kernel's own sentence (OATS 0.70.0: `lib/schedule.mjs` `readDefinitions`,
  `lib/triggers.mjs` `requireTrigger`) with the recording's paths.
- `oats version --json` of an OATS from before the lists (0.28.0): its shape with no `automations`
  feature and no `automationsApi`.

Three answers were recorded later, on 2026-11-23, from OATS 0.70.5 (the recorder's kernel now),
by the same recorder at the same point of its story, and only they were copied in (their calls
are in `recorded.json` under `later`, with that kernel and time):
`schedule-enable-unknown.json`, `schedule-describe-unknown.json` and `schedule-test-unknown.json`,
what the kernel answers to `schedule enable`, `schedule update --description` and `schedule test`
of `weekly-cleanup` once it is removed (`E_SCHEDULE_UNKNOWN`, the sentence `schedule-remove-unknown.json`
has from 0.70.0). The live stage `automations-row-gone` plays them: a page that still lists a
schedule someone removed after the list was read. That recording also showed two answers that
0.70.5 gives differently from the ones kept here (a bb job without `yolo` is refused when it is
added, so no run of it fails to launch); the answers here stay the 0.70.0 recording until the
whole set is recorded again.

The unit tests' refusals are written inline, as every feature's are.
