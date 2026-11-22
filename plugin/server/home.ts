// The home's RPC handlers, one per verb of contract/home.ts.
import type { ExperimentalPluginRpcHandlersWithContext } from "@get-bb/plugin-sdk";
import type { rpc } from "../contract/home.js";
import { compat } from "../kernel/compat.js";
import { codes } from "../kernel/result.js";
import { refusedWith, type Core } from "./core.js";

/** `oats` ran and what it printed for its version is not a version: the CLI is there, and the plugin cannot say which. */
const UNREADABLE: ReadonlySet<string> = new Set([codes.notJson, codes.badAnswer, codes.failed]);

export const handlers = (core: Core): ExperimentalPluginRpcHandlersWithContext<typeof rpc> => ({
  /**
   * No process of its own: the version is the one the server reads once for every feature
   * (`core.versionOf`). Picked fields only. An `oats` that answers no version the plugin can read
   * (one from before `oats version --json`) is "unknown"; one that cannot be run at all is the
   * roster's failure, said there, and refused here as it was.
   */
  async homeCli() {
    try {
      const version = await core.versionOf();
      return { version: version.version, desktopApi: version.desktopApi, state: compat(version) };
    } catch (error) {
      const code = typeof error === "object" && error !== null ? refusedWith.get(error) : undefined;
      if (code !== undefined && UNREADABLE.has(code)) return { version: null, desktopApi: null, state: "unknown" as const };
      throw error;
    }
  },
});
