// Automations' host verbs: `oats schedule list`, `oats trigger list` and `oats trigger status <id>`.
import type { host } from "../contract/automations.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  scheduleList: (base, context) => core.run(base, context, (oats) => oats.scheduleList(context.signal)),
  triggerList: (base, context) => core.run(base, context, (oats) => oats.triggerList(context.signal)),
  triggerStatus: ({ id, source, ...base }, context) => core.run(base, context, (oats) => oats.triggerStatus(id, source, context.signal)),
});
