// Automations' host verbs: its developer adds them here, one per method of contract/automations.ts's `host`.
import type { host } from "../contract/automations.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (_core: HostCore): Handlers<typeof host> => ({});
