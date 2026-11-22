// The lifecycle's slots: Stop, Start, Restart and Retire in every thread's menu, and the overlay
// that draws their dialogs.
import { useEffect, useState } from "react";
import {
  experimental_THREAD_ACTION_GROUPS as THREAD_ACTION_GROUPS,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginAppBuilder, PluginThreadAction, PluginThreadActionItemInput } from "@get-bb/plugin-sdk/app";
import type { Agent, AgentState } from "../../model/types";
import { useOats } from "../oats";
import { failureWords } from "../roster/unreadable";
import { asOf } from "../ui/words";
import type { Oats } from "../oats";
import type { Contract, Rpc } from "../store";
import { ActsOverlay, askPlan, run } from "./acts";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = { stop: "Square", start: "Play", restart: "RotateCcw", retire: "Trash2", oats: "Bot" } as const;

/** How long the first read may take before the menus say that OATS is being read: a normal start flashes no entry onto every menu. */
const READING_AFTER_MS = 1_000;

type ActionData = { oats: Oats; rpc: Rpc; /** the first read has been in flight for more than READING_AFTER_MS */ slow: boolean };
function useActionData(): ActionData {
  const oats = useOats();
  const rpc = useRpc<Contract>();
  const reading = oats.phase === "loading";
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!reading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), READING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [reading]);
  return { oats, rpc, slow };
}

/**
 * One lifecycle action in every thread menu, shown only on a thread that is an OATS agent and
 * only in the states it applies to. Each goes through OATS, so a stopped agent stays stopped.
 */
function lifecycle(
  id: string,
  order: number,
  label: string,
  icon: string,
  when: (state: AgentState, agent: Agent) => boolean,
  act: (instance: string, input: PluginThreadActionItemInput<ActionData>) => void | Promise<void>,
  variant: PluginThreadAction["variant"] = "default",
) {
  return {
    id,
    title: label,
    icon,
    group: THREAD_ACTION_GROUPS.lifecycle,
    order,
    useData: useActionData,
    item: (input: PluginThreadActionItemInput<ActionData>): PluginThreadAction | null => {
      const { oats } = input.data;
      if (oats.phase !== "ready") return null;
      const node = oats.nodeByThread.get(input.thread.id);
      if (node === undefined || !when(node.state, node.agent)) return null;
      // On the last roster read, while OATS cannot be read, the acts stay: each goes to the kernel
      // first, which decides it from its own facts, and without them a person is left with bb's
      // own Stop, Archive and Delete only. The entry says how old what it is offered from is.
      const detail = oats.stale === null ? undefined : asOf(oats.stale.at);
      return { label, icon, variant, ...(detail === undefined ? {} : { detail }), run: () => act(node.agent.instance, input) };
    },
  };
}

export function register(app: PluginAppBuilder): void {
  app.slots.experimental_threadAction(
    lifecycle("stop", 0, "Stop agent (OATS)", ICON.stop, (state) => state === "working" || state === "idle" || state === "needs-you", (instance) =>
      askPlan("stop", instance),
    ),
  );
  app.slots.experimental_threadAction(
    lifecycle(
      "start",
      1,
      "Start agent (OATS)",
      ICON.start,
      // A stopped agent can always be started, also one that still holds a claim and so counts as
      // needing you rather than as stopped: the kernel's word, not the drawn state.
      (state, agent) => state === "error" || agent.runtimeState === "stopped",
      (instance, { data, navigate }) => run("start", instance, data.rpc, navigate),
    ),
  );
  app.slots.experimental_threadAction(
    lifecycle("restart", 2, "Restart agent (OATS)", ICON.restart, (state) => state !== "stopped", (instance, { data, navigate }) =>
      run("restart", instance, data.rpc, navigate),
    ),
  );
  app.slots.experimental_threadAction(
    lifecycle("retire", 3, "Retire agent (OATS)", ICON.retire, () => true, (instance) => askPlan("retire", instance), "destructive"),
  );

  // With no roster at all (never read, or being read for the first time) which thread is an agent is
  // not known: every thread's menu then has ONE entry, off, that says so and why. Never silence:
  // without it only bb's own Stop, Archive and Delete would be there.
  app.slots.experimental_threadAction({
    id: "unreadable",
    title: "OATS agents",
    icon: ICON.oats,
    group: THREAD_ACTION_GROUPS.lifecycle,
    order: 4,
    useData: useActionData,
    item: ({ data }: PluginThreadActionItemInput<ActionData>): PluginThreadAction | null => {
      const { oats, slow } = data;
      if (oats.phase === "failed") {
        return { label: "OATS agents: can't be read", detail: failureWords(oats, oats.machine).title, icon: ICON.oats, disabled: true, run: () => undefined };
      }
      if (oats.phase === "loading" && slow) return { label: "OATS agents: reading…", icon: ICON.oats, disabled: true, run: () => undefined };
      return null;
    },
  });

  // Draws the plan dialogs of Stop and Retire and the progress and failure of Start and Restart,
  // wherever they were asked from.
  app.slots.experimental_appOverlay({ id: "acts", component: ActsOverlay });
}
