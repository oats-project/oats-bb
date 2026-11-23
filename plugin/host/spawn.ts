// Spawn's host verbs: `oats spawn --preview`, and the apply of the previewed decision.
import type { host } from "../contract/spawn.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  spawnHarnesses: (base, context) => core.run(base, context, (oats) => oats.spawnHarnesses(context.signal)),
  spawnPreview: ({ soul, name, task, ...base }, context) =>
    core.run(base, context, async (oats) => {
      const known = await core.knownSouls(base, oats, context.signal);
      if (!known.ok) return known;
      return oats.spawnPreview({ soul, name, task }, { knownSouls: known.value, tempDir: context.experimental_paths.tempDir }, context.signal);
    }),
  spawn: ({ soul, name, task, key, revision, ...base }, context) =>
    core.run(base, context, async (oats) => {
      const known = await core.knownSouls(base, oats, context.signal);
      if (!known.ok) return known;
      return oats.spawn({ soul, name, task, key, revision }, { knownSouls: known.value, tempDir: context.experimental_paths.tempDir }, context.signal);
    }),
});
