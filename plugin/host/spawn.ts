// Spawn's host verbs: `oats spawn --preview`, and the apply of the previewed decision.
import type { host } from "../contract/spawn.js";
import { ok } from "../kernel/result.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  spawnHarnesses: (base, context) => core.run(base, context, (oats) => oats.spawnHarnesses(context.signal)),
  spawnPreview: ({ soul, name, task, harness, model, relation, background, ...base }, context) =>
    core.run(base, context, async (oats) => {
      const known = await core.knownSouls(base, oats, context.signal);
      if (!known.ok) return known;
      // A named harness is held to the provider's own list, read here, on the machine.
      const declared = harness === undefined ? ok({ harnesses: [] }) : await oats.spawnHarnesses(context.signal);
      if (!declared.ok) return declared;
      return oats.spawnPreview({ soul, name, task, harness, model, relation, background }, { knownSouls: known.value, harnesses: declared.value.harnesses, tempDir: context.experimental_paths.tempDir }, context.signal);
    }),
  spawn: ({ soul, name, task, harness, model, relation, background, key, revision, ...base }, context) =>
    core.run(base, context, async (oats) => {
      const known = await core.knownSouls(base, oats, context.signal);
      if (!known.ok) return known;
      const declared = harness === undefined ? ok({ harnesses: [] }) : await oats.spawnHarnesses(context.signal);
      if (!declared.ok) return declared;
      return oats.spawn({ soul, name, task, harness, model, relation, background, key, revision }, { knownSouls: known.value, harnesses: declared.value.harnesses, tempDir: context.experimental_paths.tempDir }, context.signal);
    }),
});
