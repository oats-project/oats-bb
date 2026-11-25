// The terminal's RPC handler (contract/terminal.ts).
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/terminal.js";
import { codes } from "../kernel/result.js";
import { HOST_TIMEOUT, invalid, refusal, type Core } from "./core.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * The viewer's command for an agent on tmux that RUNS on the machine that holds the deployment.
   * Refused for any other agent, before the machine is asked: an agent on a bb thread has no
   * terminal (the kernel: E_SESSION_NO_TERMINAL); one that does not run has no session to show;
   * one on another server of OATS is reached from a person's own terminal (the attach command).
   */
  async terminalCommand({ instance }, context) {
    const agent = await core.agentOf(instance);
    if (agent.backend !== "tmux") throw invalid(`${instance} does not run on tmux: it has no terminal`);
    // (The roster this plugin reads names agents of the deployment's own machine alone today, `server: null`
    // on every row: this holds the rule for a roster that names another.)
    if (agent.server !== null) throw invalid(`${instance} runs on another machine (${agent.server}): its terminal is opened from a terminal of your own`);
    if (agent.running !== true) throw invalid(`${instance} is not running: there is no session to show`);
    const { features } = await core.versionOf();
    const { argv } = await core.call("terminalCommand", { home: agent.home, features }, HOST_TIMEOUT.read, context.experimental_signal);
    const target = core.target();
    if (target === null) throw refusal({ code: codes.hostUnreachable, message: "The machine that runs oats is not known just now." });
    return { hostId: target.hostId, argv, cwd: agent.home };
  },
});
