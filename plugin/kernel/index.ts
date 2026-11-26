// The kernel, as the host entry calls it: one function per `oats` command, composed from one module
// per feature (kernel/<feature>.ts: the argv of each of its commands, and the answer read with a
// schema into the plugin's types). No bb and no React import, so plain unit tests cover it.
// A new feature adds its module and one line below; a command is added in the feature's own module.
import * as automations from "./automations.js";
import * as lifecycle from "./lifecycle.js";
import * as mail from "./mail.js";
import * as panel from "./panel.js";
import * as roster from "./roster.js";
import { Runner, type OatsOptions } from "./runner.js";
import * as spawn from "./spawn.js";
import * as workspace from "./workspace.js";

const verbs = (runner: Runner) => ({
  ...roster.verbs(runner),
  ...workspace.verbs(runner),
  ...spawn.verbs(runner),
  ...lifecycle.verbs(runner),
  ...automations.verbs(runner),
  ...panel.verbs(runner),
  ...mail.verbs(runner),
});

/** Every `oats` command the plugin runs, in one deployment. */
export type Oats = ReturnType<typeof verbs>;
export const createOats = (options: OatsOptions): Oats => verbs(new Runner(options));

export { Processes } from "./run.js";
export { codes, isKernelCode, type KernelError, type Result } from "./result.js";
export { timeouts, type OatsOptions, type Timeouts } from "./runner.js";
