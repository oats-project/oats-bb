// The terminal's RPC handler (contract/terminal.ts).
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/terminal.js";
import { codes } from "../kernel/result.js";
import { HOST_TIMEOUT, invalid, refusal, type Core } from "./core.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * The viewer's command for an agent on tmux that RUNS. Refused for any other agent, before the
   * machine is asked: an agent on a bb thread has no terminal (the kernel: E_SESSION_NO_TERMINAL);
   * one that does not run has no session to show. (Every agent of the roster this plugin reads is
   * on the machine that holds the deployment, `core.target()`: it names none of another server
   * of OATS, so there is none to refuse here.)
   */
  async terminalCommand({ instance }, context) {
    // An ACT, as Stop and Start are: what is typed in that tab is typed to the agent. So the agent is
    // the one the kernel's snapshot names NOW: while OATS cannot be read it is refused with why,
    // also for an agent of the last roster that is still shown (the page's button is off then: this
    // is the server's half of the same rule).
    const agent = await core.agentForAct(instance);
    if (agent.backend !== "tmux") throw invalid(`${instance} does not run on tmux: it has no terminal`);
    if (agent.running !== true) throw invalid(`${instance} is not running: there is no session to show`);
    const { features } = await core.versionOf();
    const { argv } = await core.call("terminalCommand", { home: agent.home, features }, HOST_TIMEOUT.read, context.experimental_signal);
    const target = core.target();
    if (target === null) throw refusal({ code: codes.hostUnreachable, message: "The machine that runs oats is not known just now." });
    return { hostId: target.hostId, argv, cwd: agent.home };
  },
});
