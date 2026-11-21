// The lifecycle's host verbs: `oats instance stop`, `oats session start|restart`, `oats retire`.
import type { host } from "../contract/lifecycle.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  stopPlan: ({ instance, ...base }, context) => core.run(base, context, (oats) => oats.stopPlan(instance, context.signal)),
  stopApply: ({ instance, revision, key, ...base }, context) => core.run(base, context, (oats) => oats.stopApply({ instance, revision, key }, context.signal)),
  start: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.start(home, context.signal)),
  restart: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.restart(home, context.signal)),
  retirePlan: ({ instance, ...base }, context) => core.run(base, context, (oats) => oats.retirePlan(instance, context.signal)),
  retireApply: ({ instance, revision, key, ...base }, context) => core.run(base, context, (oats) => oats.retireApply({ instance, revision, key }, context.signal)),
});
