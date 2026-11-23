// The kernel's rows the outside feature's tests read, each as the kernel printed it
// (test/fixtures/outside/README.md), through the plugin's
// own parser into the snapshot's `Agent`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStatus } from "../../kernel/roster";
import type { Agent } from "../../model/types";

const read = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8"));

/** Every row of one status document. */
export function agentsOf(document: unknown): Agent[] {
  const status = parseStatus(document);
  if (!status.ok) throw new Error(`${status.error.code}: ${status.error.message}`);
  return status.value.agents;
}
const only = (agents: Agent[]): Agent => {
  if (agents.length !== 1) throw new Error(`expected one row, found ${agents.length}`);
  return agents[0]!;
};

/** One state of the real run's recording (test/fixtures/roster/status-recorded.json): OATS 0.70.0, which has no `provider-outside-oats`. */
export const recorded = (state: "stoppedByOats" | "threadDeleted" | "working" | "idle"): Agent => only(agentsOf((read("roster/status-recorded.json") as Record<string, unknown>)[state]));

/** The status of a home OATS stopped whose harness runs: recorded live by the real run (test/fixtures/outside/README.md). */
export const OUTSIDE_STATUS = "outside/status-outside.json";
type Document = { features?: string[]; agents: { instances: Record<string, unknown>[] }[] };
/** `feature: false`: the same document as a kernel that does not list `provider-outside-oats` prints its features. */
export function outsideDocument(feature = true): Document {
  const document = read(OUTSIDE_STATUS) as Document;
  return feature ? document : { ...document, features: (document.features ?? []).filter((name) => name !== "provider-outside-oats") };
}
export const outside = (feature = true): Agent => only(agentsOf(outsideDocument(feature)));
/** An agent idle with no harness loaded (`running: false` beside `runtimeState: "unknown"`), recorded live by the real run. */
export const notLoaded = (): Agent => only(agentsOf(read("outside/status-not-loaded.json")));

/** A row of the pinned sample (test/fixtures/roster/status.json), with fields replaced as the live scenes replace them for a state no recording holds. */
export function sample(instance: string, change: Record<string, unknown> = {}): Agent {
  const document = structuredClone(read("roster/status.json")) as Document;
  for (const group of document.agents) for (const row of group.instances) if (row.instance === instance) Object.assign(row, change);
  const found = agentsOf(document).find((agent) => agent.instance === instance);
  if (found === undefined) throw new Error(`the sample has no ${instance}`);
  return found;
}
