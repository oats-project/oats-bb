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
  back), as OATS 0.70.0 printed it: there the preview of the same choices answers, and the
  provider is asked at the launch.
- `spawn-preview-pi-refused.json`: the same refusal one step earlier, as OATS 0.70.5 printed it on
  2026-11-23: from 0.70.1 a preview asks the provider's own check, so the PREVIEW with
  `--harness pi` is refused ("… would not be launched … nothing was created") and no spawn is
  asked. The real run keeps whichever of the two its kernel answers.
- `spawn-preview-named.json`, `spawn-preview-child.json`: the preview of the form filled (a soul,
  an instruction, the name `form-spawned-developer`), independent and as a child of
  `harvest-knowledge-helper` (`--relation child --relative-to … --relative-root …`): the second
  carries `relation` and the anchor the kernel bound. Neither carries a warning: the kernel gave
  none. The live checks' form stages answer them (`spawn-preview.json`, recorded earlier with a
  provider that warned of its bb version, stays for the unit tests and for a soul's page).
- `spawn-preview-model-refused.json`: the kernel's refusal of a preview whose `--model` no harness
  has (`E_MODEL_UNKNOWN`).
  These seven were recorded by `container/real/parts/spawn.mjs` on 2026-11-22 (OATS 0.70.0 from
  npm); the live checks' stages (`container/scenes/spawn.mjs`, `stages`) answer them.

No file above is shaped. One answer of a spawn that is shaped is made where it is used, and says
so there: a spawn the kernel refused and could not roll back completely (`details.unconfirmed`),
which the real run cannot make (the kernel's own removal of the home would have to fail). The live
stage `spawn-unconfirmed` (`container/scenes/spawn.mjs`, `rollbackIncomplete`) builds it from
`spawn-pi-refused.json` with the words and the marker the kernel writes on that path, and the unit
tests (`test/spawn/model.test.ts`, `kernel.test.ts`, `page.test.tsx`, `test/host.test.ts`,
`test/server.test.ts`) cite the lines of awebai/oats `lib/core.mjs` at v0.70.5 they follow.

One file here IS shaped, and says so: `spawn-preview-soul-launch.json`, the preview of a soul that
declares its own launch (`launch: { harness: pi, model: claude-fable-5.1 }`), which the kernel
resolves whole from the soul (`harness`, `model`, `modelSource: "soul preference"`, `launch.from:
"soul"`). It has the shape of a real answer of OATS 0.70.4 on 2026-11-23 (`oats spawn <soul>
--preview --json` in a deployment whose souls declare that launch; no `--backend`, so its backend
is tmux), member for member, with every name invented (the soul, the workspace, the capabilities,
the paths, the revisions): the real answer is of a private workspace and is not in the repository.
The form's tests read from it that such a soul's harness and model are the soul's, with no model
asked of the person.

