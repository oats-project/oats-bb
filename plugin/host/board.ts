// The board's host verb: `oats inspect --home --board`.
import type { host } from "../contract/board.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  boardDetail: ({ home, ...base }, context) => core.run(base, context, (oats) => oats.boardDetail(home, context.signal)),
});
