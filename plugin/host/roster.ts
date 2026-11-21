// The roster's host verbs: finding the deployment, `oats status`, and the watch on the
// deployment's event log.
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExperimentalHostWatchSubscription } from "@get-bb/plugin-sdk";
import type { host } from "../contract/roster.js";
import type { Handlers, HostCore } from "./core.js";

/** The file that marks a deployment directory. */
const DEPLOYMENT_MARKER = "oats-local.yaml";
/**
 * The deployment's event log. Checked on a real deployment (OATS 0.69.20): a spawn, a launch, a
 * stop, a retire and every waiting claim, set or cleared, append one line to a file of this flat
 * directory. It does not change when a harness exits by itself; the server's slow poll carries that.
 */
const EVENTS = [".agents", "events"] as const;

export const handlers = (core: HostCore): Handlers<typeof host> => {
  let watching: { path: string; subscription: ExperimentalHostWatchSubscription } | null = null;
  let watchQueue: Promise<unknown> = Promise.resolve();
  return {
    discover: ({ deployment, roots }, context) => {
      core.bind(context);
      const machine = hostname();
      if (deployment !== "") {
        const found = isAbsolute(deployment) && existsSync(join(deployment, DEPLOYMENT_MARKER));
        return { deployment: found ? resolve(deployment) : null, machine };
      }
      for (const root of roots) {
        if (!isAbsolute(root)) continue;
        for (let directory = resolve(root); ; directory = dirname(directory)) {
          if (existsSync(join(directory, DEPLOYMENT_MARKER))) return { deployment: directory, machine };
          if (dirname(directory) === directory) break;
        }
      }
      return { deployment: null, machine };
    },

    status: (base, context) => core.run(base, context, (oats) => oats.status(context.signal)),

    watch: ({ deployment }, context) => {
      core.bind(context);
      // One at a time: two calls must not leave two subscriptions.
      const next = watchQueue.then(async () => {
        const path = isAbsolute(deployment) ? join(resolve(deployment), ...EVENTS) : null;
        if (watching && watching.path === path) return { watching: path };
        if (watching) {
          await watching.subscription.dispose();
          watching = null;
        }
        // No event log yet (a deployment nothing was spawned in): the server asks again later.
        if (path === null || !existsSync(path)) return { watching: null };
        const subscription = await context.experimental_watch({ rootPath: path, debounceMs: 250, maxWaitMs: 2_000 }, async (event) => {
          if (event.kind === "watch-error") {
            // The daemon's watcher gave up on this directory: forget it, so the next call watches again.
            if (watching?.path === path) watching = null;
            await subscription.dispose();
          }
          await context.experimental_emitSignal("changed", { reason: event.kind });
        });
        watching = { path, subscription };
        return { watching: path };
      });
      watchQueue = next.catch(() => undefined);
      return next;
    },
  };
};
