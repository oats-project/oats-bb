// The instance panel's RPC methods as a slot test's default: the facts of the recorded roster's
// rows (test/fixtures/panel/), read by the server's own parser.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/panel";
import { parsePanelInstance, type PanelInstance } from "../../kernel/panel-instance";
import { parseStatus } from "../../kernel/roster";
import type { Agent } from "../../model/types";
import { fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";

type Roster = { root: string; agents: { description?: string; instances: Record<string, unknown>[] }[] };
const roster = (name: string): Roster => JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/panel", name), "utf8")) as Roster;

/** The facts of one instance of a recorded roster, and its soul's description from the roster's agent row. */
export function recordedFacts(instance: string, file = "status.json"): { facts: PanelInstance; description: string | null; root: string } {
  const document = roster(file);
  for (const agent of document.agents) {
    const row = agent.instances.find((candidate) => candidate.instance === instance);
    if (row === undefined) continue;
    const facts = parsePanelInstance(row);
    if (!facts.ok) throw new Error(`${file}: ${facts.error.message}`);
    return { facts: facts.value, description: agent.description ?? null, root: document.root };
  }
  throw new Error(`${file} has no instance ${instance}`);
}

export const PANEL_AT = "2026-11-21T18:30:00.000Z";

/** The answer of `panelInstance` for one instance of the recorded roster, changed by `change`. */
export function instanceAnswer(instance: string, change: (facts: PanelInstance) => PanelInstance = (facts) => facts, file?: string) {
  const { facts, description, root } = recordedFacts(instance, file);
  return { at: PANEL_AT, facts: change(facts), agentsRoot: root, soul: { key: facts.soul, description } };
}

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  panelInstance: ({ instance }) => instanceAnswer(instance),
});

// ---- For the panel's slot tests: the recorded roster as the app's snapshot, and bb threads for its rows.

/** The recorded roster's agents, as the snapshot carries them. */
export function panelAgents(file = "status.json"): Agent[] {
  const status = parseStatus(roster(file));
  if (!status.ok) throw new Error(`${file}: ${status.error.message}`);
  return status.value.agents;
}
export const panelSnapshot = (agents: Agent[] = panelAgents()) => fixtureSnapshot(agents);

/** One bb thread per recorded agent that names one, shaped as bb's sidebar threads are (the pinned recording's first row). */
export function panelThreads(agents: Agent[] = panelAgents()): { status: "ready"; threads: PluginSidebarThread[] } {
  const template = fixtureThreads()[0]!;
  const threads = agents
    .filter((agent) => agent.threadId !== null)
    .map((agent) => ({ ...template, id: agent.threadId!, title: agent.instance, displayTitle: agent.instance, href: `/projects/proj_panel/threads/${agent.threadId}`, projectId: "proj_panel", hasPendingInteraction: false }));
  return { status: "ready", threads };
}
