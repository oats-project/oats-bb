// Automations' host verbs: the reads (`oats schedule list`, `oats trigger list`,
// `oats trigger status <id>`) and the acts on a row (on and off, run now, test, a summary, delete,
// check a run), on this host (install the scheduler's timer), and creating and editing a local
// schedule (what a soul can launch on, a home's operations, the stored definition, add, update).
import type { host } from "../contract/automations.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  scheduleList: (base, context) => core.run(base, context, (oats) => oats.scheduleList(context.signal)),
  triggerList: (base, context) => core.run(base, context, (oats) => oats.triggerList(context.signal)),
  triggerStatus: ({ id, source, ...base }, context) => core.run(base, context, (oats) => oats.triggerStatus(id, source, context.signal)),

  automationEnable: ({ kind, id, enabled, ...base }, context) => core.run(base, context, (oats) => oats.automationEnable(kind, id, enabled, context.signal)),
  scheduleRun: ({ id, ...base }, context) => core.run(base, context, (oats) => oats.scheduleRun(id, context.signal)),
  automationTest: ({ kind, id, source, runSource, ...base }, context) => core.run(base, context, (oats) => oats.automationTest(kind, id, { source, runSource }, context.signal)),
  automationDescribe: ({ kind, id, description, ...base }, context) => core.run(base, context, (oats) => oats.automationDescribe(kind, id, description, context.signal)),
  scheduleRemove: ({ id, ...base }, context) => core.run(base, context, (oats) => oats.scheduleRemove(id, context.signal)),
  scheduleReconcile: ({ id, ...base }, context) => core.run(base, context, (oats) => oats.scheduleReconcile(id, context.signal)),
  schedulerEnable: (base, context) => core.run(base, context, (oats) => oats.schedulerEnable(context.signal)),

  scheduleSoulBackends: ({ soul, ...base }, context) => core.run(base, context, (oats) => oats.scheduleSoulBackends(soul, context.signal)),
  scheduleHomeOperations: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.scheduleHomeOperations(home, context.signal)),
  scheduleDraft: ({ id, ...base }, context) => core.run(base, context, (oats) => oats.scheduleDraft(id, context.signal)),
  scheduleAdd: ({ id, spec, ...base }, context) => core.run(base, context, (oats) => oats.scheduleAdd(id, spec, context.signal)),
  scheduleUpdate: ({ id, spec, ...base }, context) => core.run(base, context, (oats) => oats.scheduleUpdate(id, spec, context.signal)),
});
