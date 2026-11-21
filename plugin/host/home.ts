// The OATS home runs no `oats` command of its own yet (contract/home.ts).
import type { host } from "../contract/home.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (_core: HostCore): Handlers<typeof host> => ({});
