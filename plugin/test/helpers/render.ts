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
import { forgetCli } from "../../app/home/cli";
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
// shows them all. A deployment that shows the home alone is what a test names: `settings: { pages: "home" }`; the release's default (the home and the Workspace page's four tabs) is `showEveryPageWhenUnset(false)`.
showEveryPageWhenUnset(true);
/** Every page's id, for a test that names the setting. */
export const ALL_PAGES = PAGE_IDS.join(", ");

export type Contract = typeof rpcContract;
type Strict = PluginRpcTestHandlers<Contract>;
/** The four acts of the lifecycle, whose answers the plugin's server stamps with when the act ended (`endedAt`). */
type Act = "stopApply" | "retireApply" | "start" | "restart";
type Unstamped<Fn> = Fn extends (...args: infer In) => infer Out ? (...args: In) => Out extends Promise<infer Value> ? Promise<Omit<Value, "endedAt"> & { endedAt?: string }> : Omit<Awaited<Out>, "endedAt"> & { endedAt?: string } | Promise<Omit<Awaited<Out>, "endedAt"> & { endedAt?: string }> : never;
/**
 * The handlers a test gives. An act's handler may leave `endedAt` out: `handlers()` stamps it as the server would,
 * with the "server's clock" a unit test has: the stamp of the roster its own `snapshot` handler answers when the act
 * returns (so a roster with that stamp, or an older one, is from before the act's end, and one with a later stamp is
 * read after it). A test that is about the stamp gives its own.
 */
export type GivenHandlers = Omit<Strict, Act> & { [Key in Act]: Unstamped<Strict[Key]> };
/** The handlers as the app's RPC takes them (what `handlers()` answers). */
export type Handlers = Strict;

export const loadApp = () => loadPluginApp(() => import("../../app"));

/** After each test: unmount, then forget the app window's shared reads and requests, and which parents of the tree were opened. */
export function resetApp(): void {
  cleanup();
  resetWindow();
  forgetOpened();
  forgetOpenAgent();
  forgetActed();
  forgetCli();
}

export { SOULS } from "../workspace/handlers";

/**
 * The fixtures as the server would answer them, composed from each feature's defaults
 * (test/<feature>/handlers.ts); a test overrides the methods it is about.
 */
export function handlers(over: Partial<GivenHandlers> = {}, agents: Agent[] = fixtureAgents()): Strict {
  return stamped({
    ...roster.defaults(agents),
    ...home.defaults(),
    ...workspace.defaults(),
    ...spawn.defaults(),
    ...lifecycle.defaults(),
    ...automations.defaults(),
    ...panel.defaults(),
    ...over,
  });
}

/** The handlers as the app's RPC takes them: each act's answer stamped with when it ended, where the test's handler did not say. */
function stamped(given: GivenHandlers): Strict {
  const clock = async (): Promise<string> => {
    try {
      const now = (await (given.snapshot as (input: unknown) => unknown)({})) as { ok?: boolean; at?: string; last?: { at?: string } | null };
      return (now.ok === true ? now.at : now.last?.at) ?? new Date(0).toISOString();
    } catch {
      return new Date(0).toISOString();
    }
  };
  const stamp = (name: Act) => async (...args: unknown[]) => {
    const answer = (await (given[name] as (...each: unknown[]) => unknown)(...args)) as { endedAt?: string };
    return answer.endedAt === undefined ? { ...answer, endedAt: await clock() } : answer;
  };
  return { ...given, stopApply: stamp("stopApply"), retireApply: stamp("retireApply"), start: stamp("start"), restart: stamp("restart") } as unknown as Strict;
}

export const sidebarThreads = () => ({ status: "ready" as const, threads: fixtureThreads() });
