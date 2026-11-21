// The lifecycle's slots: Stop, Start, Restart and Retire in every thread's menu, and the overlay
// that draws their dialogs.
import {
  experimental_THREAD_ACTION_GROUPS as THREAD_ACTION_GROUPS,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginAppBuilder, PluginThreadAction, PluginThreadActionItemInput } from "@get-bb/plugin-sdk/app";
import type { Agent, AgentState } from "../../model/types";
import { useOats } from "../oats";
import type { Oats } from "../oats";
import type { Contract, Rpc } from "../store";
import { ActsOverlay, askPlan, run } from "./acts";

/** Checked at runtime on bb-app 0.50.1 (app.tsx says why). */
const ICON = { stop: "Square", start: "Play", restart: "RotateCcw", retire: "Trash2" } as const;

type ActionData = { oats: Oats; rpc: Rpc };
const useActionData = (): ActionData => ({ oats: useOats(), rpc: useRpc<Contract>() });

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
      return { label, icon, variant, run: () => act(node.agent.instance, input) };
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

  // Draws the plan dialogs of Stop and Retire and the progress and failure of Start and Restart,
  // wherever they were asked from.
  app.slots.experimental_appOverlay({ id: "acts", component: ActsOverlay });
}
