// The instance panel's host verbs: its developer adds them here, one per method of contract/panel.ts's `host`.
import type { host } from "../contract/panel.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (_core: HostCore): Handlers<typeof host> => ({});
