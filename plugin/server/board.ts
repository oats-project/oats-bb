// The board's RPC handlers (contract/board.ts). READS ONLY: nothing here asks the kernel for an act.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/board.js";
import { BOARD_FEATURE } from "../model/board.js";
import { HOST_TIMEOUT, type Core } from "./core.js";

/** A text of the kernel's, or null. */
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * No process of its own: the row's `board` and its claim, from what the shared status read kept,
   * as the kernel printed them. Whether this kernel reports boards at all is its own list of
   * features (`oats version --json`) AND the key on the row: an older kernel's rows have none.
   */
  async board({ instance }) {
    const { at, stale, row } = await core.rowOf(instance);
    const { features } = await core.versionOf();
    const claim = record(row.waitingOnYou) ? { producer: text(row.waitingOnYou.producer), reason: text(row.waitingOnYou.reason) } : null;
    return { at, stale, supported: features.includes(BOARD_FEATURE) && Object.hasOwn(row, "board"), board: row.board ?? null, claim };
  },
  /** The board with history and context: `oats inspect --home --board`, of the home the kernel named. */
  async boardDetail({ instance }, context) {
    const agent = await core.agentOf(instance);
    return core.call("boardDetail", { home: agent.home }, HOST_TIMEOUT.read, context.experimental_signal);
  },
});
