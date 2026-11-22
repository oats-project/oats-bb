// Outside OATS: the RPC handler of contract/outside.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/outside.js";
import { OUTSIDE_FEATURE, parseOutsideRow, type OutsideRow } from "../kernel/outside.js";
import type { Core } from "./core.js";

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * No process of its own: the rows are the ones the shared status read kept, and the feature is
   * the shared read of the kernel's version. A version that cannot be read is a kernel whose
   * features are not known: nothing is then said of `outsideOats` (the rows' `sessionEnd` is
   * still answered). Of each raw row only the two facts are answered, never the row.
   */
  async outsideFacts() {
    const { at, rows } = await core.rowsOf();
    const feature = await core.versionOf().then(
      (version) => version.features.includes(OUTSIDE_FEATURE),
      () => false,
    );
    const facts: OutsideRow[] = [];
    for (const { row } of rows.values()) {
      const read = parseOutsideRow(row, feature);
      if (read !== null) facts.push(read);
    }
    return { at, feature, rows: facts };
  },
});
