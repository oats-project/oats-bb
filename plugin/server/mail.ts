// The mail's one RPC handler: a read of the home the kernel named for the instance. No act.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/mail.js";
import { MAIL_TIMEOUT_MS } from "../kernel/mail.js";
import type { Core } from "./core.js";

/** The host call's limit: a little past the process's own (kernel/mail.ts), so that the process's answer is the one that arrives. */
export const MAIL_HOST_TIMEOUT_MS = MAIL_TIMEOUT_MS + 10_000;

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  async mail({ instance, older }, context) {
    const agent = await core.agentOf(instance);
    return core.call("mail", { home: agent.home, older }, MAIL_HOST_TIMEOUT_MS, context.experimental_signal);
  },
});
