// The four pages' host verbs: `oats souls`, `oats capabilities`, `oats teams`, `oats server list`.
import type { host } from "../contract/workspace.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  souls: (base, context) =>
    core.run(base, context, async (oats) => {
      const listed = await oats.souls(context.signal);
      // The list the Souls page shows is the list a spawn from it is checked against.
      if (listed.ok) core.rememberSouls(base, listed.value.souls);
      return listed;
    }),
  capabilities: (base, context) => core.run(base, context, (oats) => oats.capabilities(context.signal)),
  teams: (base, context) => core.run(base, context, (oats) => oats.teams(context.signal)),
  servers: (base, context) => core.run(base, context, (oats) => oats.servers(context.signal)),
});
