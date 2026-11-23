// Outside OATS: what the plugin says when something happened to an OATS agent outside OATS (its
// thread archived or deleted in bb, a harness that runs in a home OATS stopped). It registers no
// slot and reads nothing of its own: the roster's row and line call it, and the home's card will
// (README, "Outside OATS"). The STATE of such an agent is the one state function's (model/view.ts).
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";

export { detachedActs, lineActs, OutsideActs, OutsideAgent, OutsideMark, OutsideThreadRow, OutsideWarning } from "./parts";
export { said } from "./say";
export type { Act, Kind, Said } from "./say";
export { outsideOf } from "./use";
export type { Outside } from "./use";
export * as words from "./words";

export function register(_app: PluginAppBuilder): void {
  // No slot of its own.
}
