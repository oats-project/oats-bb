// The kernel's rows the outside feature's tests read, each as the kernel printed it (or, for
// `outsideOats`, as its own test shapes it: test/fixtures/outside/README.md), through the plugin's
// own parsers: the `Agent` of the snapshot and the two facts of the raw row.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseOutsideRow, type OutsideRow } from "../../kernel/outside";
import { parseStatus } from "../../kernel/roster";
import type { Agent } from "../../model/types";

const read = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8"));

export type Row = { agent: Agent; facts: OutsideRow };

/** Every row of one status document. `feature`: whether the kernel that printed it lists `provider-outside-oats`. */
export function rowsOf(document: unknown, feature: boolean): Row[] {
  const status = parseStatus(document);
  if (!status.ok) throw new Error(`${status.error.code}: ${status.error.message}`);
  return status.value.agents.map((agent, index) => {
    const facts = parseOutsideRow(status.value.rows[index]!.row, feature);
    if (facts === null) throw new Error(`no facts for ${agent.instance}`);
    return { agent, facts };
  });
}
const only = (rows: Row[]): Row => {
  if (rows.length !== 1) throw new Error(`expected one row, found ${rows.length}`);
  return rows[0]!;
};

/** One state of the real run's recording (test/fixtures/roster/status-recorded.json): OATS 0.70.0, which has no `provider-outside-oats`. */
export const recorded = (state: "stoppedByOats" | "threadDeleted" | "working" | "idle"): Row => only(rowsOf((read("roster/status-recorded.json") as Record<string, unknown>)[state], false));

/** The row of a home OATS stopped whose harness runs: shaped from the kernel's own test at v0.70.5, not recorded live. */
export const OUTSIDE_STATUS = "outside/status-outside.json";
export const OUTSIDE_VERSION = "outside/version-0.70.5.json";
export const outsideDocument = (): unknown => read(OUTSIDE_STATUS);
export const outside = (feature = true): Row => only(rowsOf(outsideDocument(), feature));

/** A row of the pinned sample (test/fixtures/roster/status.json), with fields replaced as the live scenes replace them for a state no recording holds. */
export function sample(instance: string, change: Record<string, unknown> = {}): Row {
  const document = structuredClone(read("roster/status.json")) as { agents: { instances: Record<string, unknown>[] }[] };
  for (const group of document.agents) for (const row of group.instances) if (row.instance === instance) Object.assign(row, change);
  const found = rowsOf(document, true).find((row) => row.agent.instance === instance);
  if (found === undefined) throw new Error(`the sample has no ${instance}`);
  return found;
}
