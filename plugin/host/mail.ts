// The mail's one host verb: `oats operation run messaging:mail` (kernel/mail.ts), a read.
import type { host } from "../contract/mail.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (core: HostCore): Handlers<typeof host> => ({
  mail: ({ home, older, ...base }, context) => core.run(base, context, (oats) => oats.mail(home, older, context.signal)),
});
