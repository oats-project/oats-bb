// The board's default RPC answers for the app's tests (test/helpers/render.ts composes them): an
// agent with no board, on a kernel that reports boards. A test of the board gives its own.
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/board";

export const BOARD_AT = "2026-11-23T18:16:56.000Z";

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  board: () => ({ at: BOARD_AT, supported: true, board: null, claim: null }),
  boardDetail: () => ({ inspection: { instance: { board: null } } }),
});
