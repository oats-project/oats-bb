// The lifecycle's host verbs: `oats instance stop`, `oats session start|restart`, `oats retire`,
// A start that names a harness reads the provider's declared list first (spawn's `spawnHarnesses`).
import type { host } from "../contract/lifecycle.js";
import type { Oats } from "../kernel/index.js";
import type { StartChoices } from "../kernel/lifecycle.js";
import type { Handlers, HostCore } from "./core.js";

/**
 * A start or a restart. A harness named for it must be one the bb session provider declares: the
 * list is read here, on the machine, as a spawn's soul is checked against the souls OATS lists.
 * With no harness named nothing more is asked.
 */
async function begin(oats: Oats, verb: "start" | "restart", home: string, choices: StartChoices, signal: AbortSignal) {
  if (choices.harness === undefined) return oats[verb](home, signal, choices);
  const declared = await oats.spawnHarnesses(signal);
  if (!declared.ok) return declared;
  return oats[verb](home, signal, choices, declared.value.harnesses);
}

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  stopPlan: ({ instance, recursive, ...base }, context) => core.run(base, context, (oats) => oats.stopPlan(instance, context.signal, recursive !== false)),
  stopApply: ({ instance, revision, key, recursive, ...base }, context) =>
    core.run(base, context, (oats) => oats.stopApply({ instance, revision, key, recursive: recursive !== false }, context.signal)),
  start: ({ home, harness, model, ...base }, context) => core.run(base, context, (oats) => begin(oats, "start", home, { harness, model }, context.signal)),
  restart: ({ home, harness, model, ...base }, context) => core.run(base, context, (oats) => begin(oats, "restart", home, { harness, model }, context.signal)),
  retirePlan: ({ instance, ...base }, context) => core.run(base, context, (oats) => oats.retirePlan(instance, context.signal)),
  retireApply: ({ instance, revision, key, discardWorktree, ...base }, context) =>
    core.run(base, context, (oats) => oats.retireApply({ instance, revision, key, discardWorktree: discardWorktree === true }, context.signal)),
});
