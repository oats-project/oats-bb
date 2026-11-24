// The roster's host verbs: finding the deployment, `oats status`, and the watch on the
// deployment's event log.
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ExperimentalHostWatchSubscription } from "@get-bb/plugin-sdk";
import { CHANGED_FILES_MAX, eventFileName } from "../contract/index.js";
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

/**
 * The watch's wait before it delivers a batch: bb's own defaults (75 ms of quiet, 500 ms at most).
 * The event path reads one instance's events on the signal, so the wait is part of how soon a
 * claim or a stop is on the screen; a longer one would only buy fewer signals in a burst, which
 * the server's own rules bound (one events read per instance at a time, one `oats status` at a
 * time with its pause).
 */
const WATCH = { debounceMs: 75, maxWaitMs: 500 } as const;

/**
 * The instances' files a batch of changes names: base names only (the watcher's path may be
 * absolute or relative to the watched directory), each once, only names of the log's own form;
 * none when the batch names more than CHANGED_FILES_MAX (the status read carries a sweep).
 */
export function changedFiles(changes: readonly { path: string }[]): string[] {
  const names = [...new Set(changes.map((change) => basename(change.path)).filter((name) => eventFileName.safeParse(name).success))];
  return names.length > CHANGED_FILES_MAX ? [] : names;
}

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
    rosterEvents: ({ instance, home, since, ...base }, context) => core.run(base, context, (oats) => oats.rosterEvents(instance, home, since, context.signal)),
    version: (base, context) => core.run(base, context, (oats) => oats.version(context.signal)),

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
        const subscription = await context.experimental_watch({ rootPath: path, ...WATCH }, async (event) => {
          if (event.kind === "watch-error") {
            // The daemon's watcher gave up on this directory: forget it, so the next call watches again.
            if (watching?.path === path) watching = null;
            await subscription.dispose();
          }
          await context.experimental_emitSignal("changed", { reason: event.kind, files: event.kind === "changed" ? changedFiles(event.changes) : [] });
        });
        watching = { path, subscription };
        return { watching: path };
      });
      watchQueue = next.catch(() => undefined);
      return next;
    },
  };
};
