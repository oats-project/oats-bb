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
