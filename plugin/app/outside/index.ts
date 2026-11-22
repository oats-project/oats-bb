// Outside OATS: what the plugin says when something happened to an OATS agent outside OATS (its
// thread archived or deleted in bb, a harness that runs in a home OATS stopped). It registers no
// slot: the roster's row and line and the home's card call it (README, "Outside OATS").
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";

export { lineActs, OutsideActs, OutsideMark, OutsideThreadRow, OutsideWarning } from "./parts";
export { said } from "./say";
export type { Act, Kind, RowFacts, Said, ThreadFact } from "./say";
export { useOutside } from "./use";
export type { Outside } from "./use";
export * as words from "./words";

export function register(_app: PluginAppBuilder): void {
  // No slot of its own.
}
