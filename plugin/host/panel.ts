// The instance panel's host verbs: `oats inspect --home` (with and without `--board`), `oats instance
// events`, `oats readiness`, and `oats session input` for a board question's answer.
import type { host } from "../contract/panel.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  panelSoul: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.panelSoul(home, context.signal)),
  panelEvents: ({ instance, home, ...base }, context) => core.run(base, context, (oats) => oats.panelEvents(instance, home, context.signal)),
  panelReadiness: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.panelReadiness(home, context.signal)),
  panelBoard: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.panelBoard(home, context.signal)),
  panelBoardAnswer: ({ home, text, ...base }, context) => core.run(base, context, (oats) => oats.panelBoardAnswer(home, text, context.experimental_paths.tempDir, context.signal)),
  panelSoulReadiness: ({ soul, ...base }, context) =>
    core.run(base, context, async (oats) => {
      // A soul is checked against what `oats souls` lists before its process starts, as a spawn's is.
      const known = await core.knownSouls(base, oats, context.signal);
      return known.ok ? oats.panelSoulReadiness(soul, known.value, context.signal) : known;
    }),
});
