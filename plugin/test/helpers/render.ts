// What every slot test needs: the plugin's registrations, the pinned fixtures as the app's RPC
// answers, and a clean app window between tests.
import { cleanup } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../contract";
import { resetWindow } from "../../app/store";
import { forgetOpened } from "../../app/roster/fold";
import { forgetOpenAgent } from "../../app/roster/open-agent";
import { forgetActed } from "../../app/roster/reading";
import { PAGE_IDS, showEveryPageWhenUnset } from "../../app/workspace/pages";
import type { Agent } from "../../model/types";
import * as automations from "../automations/handlers";
import * as home from "../home/handlers";
import * as lifecycle from "../lifecycle/handlers";
import * as panel from "../panel/handlers";
import * as roster from "../roster/handlers";
import * as spawn from "../spawn/handlers";
import * as workspace from "../workspace/handlers";
import { fixtureAgents, fixtureThreads } from "./fixtures";

// The unit tests draw every page: a slot rendered with no settings stands for a deployment that
// shows them all. The release's default (`home` alone) is what a test names: `settings: { pages: "home" }`.
showEveryPageWhenUnset(true);
/** Every page's id, for a test that names the setting. */
export const ALL_PAGES = PAGE_IDS.join(", ");

export type Contract = typeof rpcContract;
export type Handlers = PluginRpcTestHandlers<Contract>;

export const loadApp = () => loadPluginApp(() => import("../../app"));

/** After each test: unmount, then forget the app window's shared reads and requests, and which parents of the tree were opened. */
export function resetApp(): void {
  cleanup();
  resetWindow();
  forgetOpened();
  forgetOpenAgent();
  forgetActed();
}

export { SOULS } from "../workspace/handlers";

/**
 * The fixtures as the server would answer them, composed from each feature's defaults
 * (test/<feature>/handlers.ts); a test overrides the methods it is about.
 */
export function handlers(over: Partial<Handlers> = {}, agents: Agent[] = fixtureAgents()): Handlers {
  return {
    ...roster.defaults(agents),
    ...home.defaults(),
    ...workspace.defaults(),
    ...spawn.defaults(),
    ...lifecycle.defaults(),
    ...automations.defaults(),
    ...panel.defaults(),
    ...over,
  };
}

export const sidebarThreads = () => ({ status: "ready" as const, threads: fixtureThreads() });
