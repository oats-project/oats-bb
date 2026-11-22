// The instance panel's RPC handlers, one per verb of contract/panel.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/panel.js";
import { BOARD_PRODUCER, answerText, rowBoard } from "../kernel/panel-board.js";
import { parsePanelInstance } from "../kernel/panel-instance.js";
import { record, text } from "../kernel/panel-read.js";
import { HOST_TIMEOUT, invalid, refusal, type Core } from "./core.js";

/** The instances an answer is being sent to: a second one waits for the first one's outcome. */
const answering = new Set<string>();

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * No process of its own: the facts are read from what the shared status read kept, as the kernel
   * printed it. The instance's own row, the roster's root, and from the row of its agent group
   * the soul's key and description.
   */
  async panelInstance({ instance }) {
    const { at, root, row, agent } = await core.rowOf(instance);
    const facts = parsePanelInstance(row);
    if (!facts.ok) throw refusal(facts.error);
    return { at, facts: facts.value, board: rowBoard(row), boardClaim: record(row.waitingOnYou)?.producer === BOARD_PRODUCER, agentsRoot: text(root), soul: { key: text(agent.key), description: text(agent.description) } };
  },
  /** The soul as the instance was spawned from it: `oats inspect --home`, of the home the kernel named. */
  async panelSoul({ instance }, context) {
    const agent = await core.agentOf(instance);
    return core.call("panelSoul", { home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  /** The instance's recorded lifecycle events: `oats instance events`, of that exact home. */
  async panelEvents({ instance }, context) {
    const agent = await core.agentOf(instance);
    return core.call("panelEvents", { instance, home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  /** `oats readiness` of the instance's home, or of its soul by the key the roster's agent row names. */
  async panelReadiness({ instance, of }, context) {
    if (of === "instance") {
      const agent = await core.agentOf(instance);
      return core.call("panelReadiness", { home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
    }
    const soul = text((await core.rowOf(instance)).agent.key);
    if (soul === null) throw invalid(`OATS names no soul for "${instance}" in this deployment, so its soul's readiness cannot be read`);
    return core.call("panelSoulReadiness", { soul }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  /** The board with its history and its contexts: `oats inspect --home --board`, of the home the kernel named. */
  async panelBoard({ instance }, context) {
    const agent = await core.agentOf(instance);
    return core.call("panelBoard", { home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
  },
  /**
   * One answer to one board question, as the agent's next input (`oats session input`; the status
   * interface, section 3b). The line sent is made here, from the board of the kernel's own row:
   * the question must be open now, asked at `since`, and its line for `option` must be the `text`
   * the person confirmed. Anything else sends nothing.
   */
  async panelBoardAnswer({ instance, id, since, option, text: confirmed }) {
    const { home } = await core.agentOf(instance);
    const { row } = await core.rowOf(instance);
    const question = rowBoard(row).questions.find((each) => each.id === id && each.since === since);
    if (question === undefined) throw invalid(`Question ${id} is no longer open on the board of "${instance}": nothing was sent`);
    const line = answerText(question, option);
    if (!line.ok) throw refusal(line.error);
    if (line.value !== confirmed) throw invalid(`The answer confirmed is not option ${option + 1} of question ${id} as the board holds it now: nothing was sent`);
    if (answering.has(instance)) throw invalid(`An answer is already being sent to "${instance}": nothing more was sent`);
    answering.add(instance);
    try {
      const sent = await core.call("panelBoardAnswer", { home, text: line.value }, HOST_TIMEOUT.act, core.signal);
      return { ...sent, text: line.value };
    } finally {
      answering.delete(instance);
      core.rereadSoon();
    }
  },
});
