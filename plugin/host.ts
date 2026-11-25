// bb.host entry: runs in bb's host daemon, on the machine that holds the OATS homes. It runs `oats`
// and watches the deployment's event log for changes; nothing else. Only this entry sees the
// user's login-shell PATH and can target that machine (evidence B1). It composes the host verbs of
// every feature (host/<feature>.ts) over what they share (host/core.ts: the processes, which are
// all killed when the worker goes away and in `dispose`).
// A new feature adds its module and one line below; a verb is added in the feature's own module.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals } from "./contract/index.js";
import * as automations from "./host/automations.js";
import * as board from "./host/board.js";
import { createHostCore } from "./host/core.js";
import * as home from "./host/home.js";
import * as lifecycle from "./host/lifecycle.js";
import * as panel from "./host/panel.js";
import * as roster from "./host/roster.js";
import * as spawn from "./host/spawn.js";
import * as workspace from "./host/workspace.js";

export function createHostEntry() {
  const core = createHostCore();
  return experimental_defineHostEntry({
    contract: hostContract,
    experimental_signals: hostSignals,
    handlers: {
      ...roster.handlers(core),
      ...home.handlers(core),
      ...workspace.handlers(core),
      ...spawn.handlers(core),
      ...lifecycle.handlers(core),
      ...automations.handlers(core),
      ...panel.handlers(core),
      ...board.handlers(core),
    },
    dispose: core.dispose,
  });
}

export default createHostEntry();
