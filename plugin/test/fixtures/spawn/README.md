# Spawn's recorded answers

Each file is what the real kernel printed for a call the plugin made through its own RPC in the
real run (`container/real/`), whole, with the real run's substitutions (the paths) and no other
edit. `../README.md` says how the first two were recorded.

- `spawn-preview.json`, `spawn.json`: `oats spawn <soul> --backend bb --yolo …`, the preview and
  the apply (the scenario's part A).
- `capabilities-show-bb.json`: `oats capabilities show oats.bb --json`, the bb capability as the
  deployment resolves it; its `sessionProviders.bb.harnesses` is the list the New agent form and
  the Start and Restart dialogs offer. Recorded by `container/real/parts/spawn.mjs` on 2026-11-22
  (OATS 0.70.0 from npm, the bb session provider of this repository's `main` at ad7cc278, which
  declares `claude` and `pi`).
- `spawn-preview-unnamed.json`: `oats spawn <soul> --backend bb --yolo --preview --json`, what the
  empty New agent form asks (no name, no instruction): the kernel numbers the agent.
- `spawn-preview-name-taken.json`: the kernel's refusal of a preview whose `--name` is an agent's
  (`E_INSTANCE_NAME_TAKEN`).
- `spawn-decision-stale.json`: the kernel's refusal of an apply whose `--expect-decision` is not
  the decision it holds (`E_DECISION_STALE`): what a spawn meets when something moved between the
  preview a person saw and their press. Nothing is created.
- `spawn-pi-refused.json`: the kernel's refusal of a spawn with `--harness pi` where bb has no pi
  provider it can launch (`E_BACKEND_NOT_READY`, the bb session provider's; the spawn is rolled
  back). The preview of the same choices answers: the provider is asked at the launch.
  These four were recorded by `container/real/parts/spawn.mjs` on 2026-11-22 (OATS 0.70.0 from
  npm); the live checks' stages `spawn-slow`, `spawn-name-taken` and `spawn-refused` answer them.
