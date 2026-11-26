// The board feature's app entry: an agent's questions and facts, as a view of its own.
export { Board, BoardAsk } from "./Board";
export { BOARD } from "./words";
export { forgetHidden } from "./hidden";
export { focusBoardQuestion } from "./focus";
export { command } from "./command";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { command } from "./command";

export function register(app: PluginAppBuilder): void {
  app.commands.register(command);
}
