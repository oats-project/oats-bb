One directory per feature of the plugin (`../../README.md`, "One module per feature"), each with
its `verbs.json`: the `oats` verbs the fake answers for that feature, and the file of each
(`container/fake-oats.mjs`). The files named below are in `roster/` (`status.json`,
`status-recorded.json`, `threads.json`, `version.json`), `workspace/` (`souls.json`, `capabilities.json`,
`teams.json`, `servers.json`), `spawn/` (`spawn-preview.json`, `spawn.json`) and `lifecycle/` (the
stop, start, restart and retire answers). `outside/` has a README of its own: its one file is
SHAPED from the kernel's own test at v0.70.5, not recorded (no live `outsideOats` can be recorded yet).

Pinned by the spec.
- `status.json`: `oats status --json` reduced to the fields the plugin reads, in the shape agreed
  with the kernel side (interface v3 a7a47d060d2ae33d: a row carries `session: {provider, threadId}`): the design's seven sample agents on bb and
  one agent on tmux. Three need you (two claims; one of them also has a bb pending interaction).
  A sample: its agents, parents, identities and claims are the design's, not a run's. In each of
  its bb rows, the fields the session side decides (`backend`, `tmux`, `session`, `open`,
  `running`, `runtimeState`, `runtimeError`, `sessionEnd`) are the ones the real kernel printed for
  an agent in the same state (running, idle, stopped by OATS; from `status-recorded.json`), with
  the sample's own thread id, and that thread's project in `threads.json`, in place of the recorded
  ones; a field the real row does not have is absent.
- `threads.json`: what bb's `experimental_useSidebarThreads()` returns (field names recorded from
  bb-app 0.50.1), one thread per bb agent plus one thread that is no OATS agent.

The other files are one answer per other `oats` verb, as the kernel prints it (an envelope, except
`retire-apply.json`: a first guarded retire prints the receipt itself).
- **Recorded from the real run** (`container/real/`, its README says how): bb-app 0.50.1, OATS
  0.70.0 from npm (`@awebai/oats@0.70.0`, gitHead 7512163012876511088da79168c74540f9523c66), the bb
  session provider of this repository's `main` at 134ca09ab6d89c0432ba2e53cd7bbfd9bfc185e5 (wire 1.3), with
  the provider's own floor (`compatibility.oats: >=0.70.0`) and no trial commit, on
  2026-11-21, on a deployment with no launch configuration: every agent was spawned with `--yolo`
  (the plugin's own, on every spawn), so the answers have `yolo: true` and `launchConfig: null`. Each is
  what the kernel printed for a call the plugin made through its own RPC, whole, printed with one
  space of indentation. One substitution and no other edit: the paths (the deployment is
  `/abs/deployment`, the run's directory `/abs/real`, the container user's home `/abs/home`). The
  recorder would also write the container's host name as `machine`; no answer of this recording
  held it. bb's thread and project ids, start ids, plan and decision
  revisions, commit ids, times and byte counts are as recorded, and the tests hold them as literals:
  a new recording changes both.
  - `spawn.json`: the spawn of `flaky-ci-2-developer`.
  - `stop-apply-stale.json`, `stop-apply.json`: `redesign-ui-lead`, a lead with two children; the
    apply of a plan read before one child was stopped by itself (`E_PLAN_STALE`, with the fresh
    plan in `details`), then the apply of the fresh plan.
  - `start.json`, `restart.json`, `retire-plan.json`, `retire-apply.json`: `weekly-digest-helper`,
    an agent on a worktree with one untracked file and one child.
  - `lifecycle/gone.json`: what the kernel answers when each act is asked for an agent it no
    longer has (`flaky-ci-2-developer`, after its retire), one refusal per key: `start`, `restart`
    (given the retired home: `E_WORK_INSPECTION_FAILED`, "directory instance home was removed or
    exchanged"), `stopPlan`, `stopApply`, `retirePlan`, `retireApply` (given the name:
    `E_SESSION_UNKNOWN`, `no instance "<name>" under <roots>`). The plugin says "not in OATS any
    more" for a stop plan or a retire plan refused with `E_SESSION_UNKNOWN`, by the code alone
    (`app/roster/gone.ts`), and shows every other refusal as the kernel's. Not recorded, a rule for the type only: a
    stopped row that still carries a claim (the kernel prints none on a stopped row; `claimOf`,
    `model/view.ts`), and a start given a directory that never was a home ("is not an OATS
    instance home": no roster names such a home).
  - `version.json`: `oats version --json`, printed in the run's deployment for the run's own call (no
    RPC of the plugin asks for it yet).
  - `servers.json`: two servers registered with `oats server add` (no host is behind them).
  - `status-recorded.json`: the whole `oats status --json` the kernel printed for the plugin's own
    read, one document per state under a key of this file: `working`,
    `idle`, `needsYou` (a claim set with `oats instance attention`), `question` (the claim
    oats.core's hooks set when Claude Code asks a question), `stoppedByOats`,
    `threadDeleted` (the agent's thread deleted in bb), `parentWithTwoChildren`. The souls of the
    run have no messaging capability, so no row has an identity.
- Recorded from an earlier real kernel (OATS 0.69.20, `--json`), reduced and with the machine's paths
  replaced: `souls.json`, `capabilities.json`, `teams.json` (plus one unmapped team, shaped as the
  reference documents it), `spawn-preview.json` (with `backend: "bb"`, one warning and, as the kernel answers the plugin's
  `spawn … --yolo --preview` on a deployment with no launch configuration, `decision.effective.yolo:
  true`; the real run keeps that answer whole as `container/real/out/answers/spawn-preview.json`), the targets
  of `stop-plan.json`. In `souls.json`, `knowledge-harvester` is a member soul so that it agrees
  with `status.json`; the real package soul `oats.okf/knowledge-harvester` is beside it, with no
  agents, and `research-expert` and the unspawnable `oats.okf/knowledge-maintainer` are shaped rows.
- Shaped as docs/desktop-cli-api.md documents the answer: `retire-incomplete.json` (a receipt with
  `rollbackIncomplete`, which the kernel prints with exit 1), and what `stop-plan.json` holds
  around its recorded targets. In it, the idle child's `midTask` is `"unknown"`, as the kernel of
  the real run prints it for a bb agent whose thread is idle (`container/real/out/answers/stop-plan.json`).
`container/fake-oats.mjs` prints them; the unit and live tests run the plugin against it.
