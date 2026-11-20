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
- **Recorded from the real run** (`container/real/`, its README says how): bb-app 0.50.1, the OATS
  kernel of oats-project/oats#1991 at 5a9db77014443607131f1ed5def0867dd1597dc0 (0.69.21), the bb
  session provider at 37e9abaf83157cf0cdcfc09022ea0a701dee2a78 (wire 1.3), on 2026-11-20. Each is
  what the kernel printed for a call the plugin made through its own RPC, whole, printed with one
  space of indentation. Two substitutions and no other edit: the paths (the deployment is
  `/abs/deployment`, the run's directory `/abs/real`, the container user's home `/abs/home`) and
  the container's host name (`machine`). bb's thread and project ids, start ids, plan and decision
  revisions, commit ids, times and byte counts are as recorded, and the tests hold them as literals:
  a new recording changes both.
  - `spawn.json`: the spawn of `flaky-ci-2-developer`.
  - `stop-apply-stale.json`, `stop-apply.json`: `redesign-ui-lead`, a lead with two children; the
    apply of a plan read before one child was stopped by itself (`E_PLAN_STALE`, with the fresh
    plan in `details`), then the apply of the fresh plan.
  - `start.json`, `restart.json`, `retire-plan.json`, `retire-apply.json`: `weekly-digest-helper`,
    an agent on a worktree with one untracked file and one child.
  - `servers.json`: two servers registered with `oats server add` (no host is behind them).
  - `status-recorded.json`: the whole `oats status --json` (asked on the command line at that
    moment, not by the plugin), one document per state under a key of this file: `working`,
    `idle`, `needsYou` (a claim set with `oats instance attention`), `stoppedByOats`,
    `threadDeleted` (the agent's thread deleted in bb), `parentWithTwoChildren`. The souls of the
    run have no messaging capability, so no row has an identity.
- Recorded from an earlier real kernel (OATS 0.69.20, `--json`), reduced and with the machine's paths
  replaced: `souls.json`, `capabilities.json`, `teams.json` (plus one unmapped team, shaped as the
  reference documents it), `spawn-preview.json` (with `backend: "bb"` and one warning), the targets
  of `stop-plan.json`. In `souls.json`, `knowledge-harvester` is a member soul so that it agrees
  with `status.json`; the real package soul `oats.okf/knowledge-harvester` is beside it, with no
  agents, and `research-expert` and the unspawnable `oats.okf/knowledge-maintainer` are shaped rows.
- Shaped as docs/desktop-cli-api.md documents the answer: `retire-incomplete.json` (a receipt with
  `rollbackIncomplete`, which the kernel prints with exit 1), and what `stop-plan.json` holds
  around its recorded targets.
`container/fake-oats.mjs` prints them; the unit and live tests run the plugin against it.
