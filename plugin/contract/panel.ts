// The instance panel: who an agent is and how it runs, as the OATS Desktop's instance panel shows it.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { panelInstance } from "../kernel/panel-instance.js";
import { instanceName } from "./shared.js";

const instance = z.object({ instance: instanceName }).strict();

/** The Instance tab's facts and the Soul tab's header, as read with the snapshot of `at`. */
export const instanceFacts = z.object({
  at: z.string(),
  /** the instance's own row of `oats status --json` */
  facts: panelInstance,
  /** the roster's `root`, `<deployment>/agents`; null when the status read does not hand it */
  agentsRoot: z.string().nullable(),
  /** the instance's soul, as `oats souls` lists it; each null when that list does not hold it */
  soul: z.object({
    /** the soul key: what the Souls page opens by, and what `oats readiness --soul` takes */
    key: z.string().nullable(),
    description: z.string().nullable(),
  }),
});

/** app -> server */
export const rpc = defineRpcContract({
  panelInstance: { input: instance, output: instanceFacts },
});

/** server -> host: one method per `oats` command the feature runs. */
export const host = defineRpcContract({});
