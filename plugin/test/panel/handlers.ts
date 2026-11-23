// The instance panel's RPC methods as a slot test's default: the facts of the recorded roster's
// rows (test/fixtures/panel/), read by the server's own parser.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { rpc } from "../../contract/panel";
import { parsePanelEvents, type PanelEvents } from "../../kernel/panel-events";
import { parsePanelInstance, type PanelInstance } from "../../kernel/panel-instance";
import { parsePanelReadiness, type PanelReadiness } from "../../kernel/panel-readiness";
import { parsePanelSoul, type PanelSoul } from "../../kernel/panel-soul";
import { parseStatus } from "../../kernel/roster";
import type { Agent } from "../../model/types";
import { fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";

type Roster = { root: string; agents: { description?: string; instances: Record<string, unknown>[] }[] };
const roster = (name: string): Roster => JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures", name.includes("/") ? "" : "panel", name), "utf8")) as Roster;

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

export const PANEL_AT = "2026-11-23T12:31:00.000Z";

/** The answer of `panelInstance` for one instance of the recorded roster, changed by `change`. */
export function instanceAnswer(instance: string, change: (facts: PanelInstance) => PanelInstance = (facts) => facts, file?: string) {
  const { facts, description, root } = recordedFacts(instance, file);
  return { at: PANEL_AT, facts: change(facts), agentsRoot: root, soul: { key: facts.soul, description } };
}

/** The pinned sample roster the other features' slot tests draw (test/fixtures/roster/status.json). */
const SAMPLE = "roster/status.json";

/** The `result` of a recorded envelope of the panel's fixtures. */
const result = (file: string): unknown => (JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/panel", file), "utf8")) as { result: unknown }).result;
function parsed<Value>(file: string, parse: (document: unknown) => { ok: true; value: Value } | { ok: false; error: { message: string } }): Value {
  const read = parse(result(file));
  if (!read.ok) throw new Error(`${file}: ${read.error.message}`);
  return read.value;
}
/** The recorded answers of the panel's commands, read by the host's own parsers: what the server answers the app. */
export const recordedSoul = (): PanelSoul | null => parsed("inspect-home.json", parsePanelSoul);
export const recordedEvents = (): PanelEvents => parsed("events.json", parsePanelEvents);
export const recordedReadiness = (of: "instance" | "soul"): PanelReadiness => parsed(of === "instance" ? "readiness-home.json" : "readiness-soul.json", parsePanelReadiness);
/** The home's readiness as the kernel answered it when it could not run bb: not ready. */
export const recordedNotReady = (): PanelReadiness => parsed("readiness-home-not-ready.json", parsePanelReadiness);

export const defaults = (): PluginRpcTestHandlers<typeof rpc> => ({
  // An agent of the panel's recorded roster, else one of the pinned sample: whichever a slot test's snapshot holds.
  panelInstance: ({ instance }) => {
    const recorded = roster("status.json").agents.some((agent) => agent.instances.some((row) => row.instance === instance));
    return instanceAnswer(instance, undefined, recorded ? undefined : SAMPLE);
  },
  panelSoul: () => ({ soul: recordedSoul() }),
  panelEvents: () => recordedEvents(),
  panelReadiness: ({ of }) => recordedReadiness(of),
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
    // bb's own status of each thread: a turn runs on the thread of an agent the roster calls running (what says that it works).
    .map((agent) => ({ ...template, status: agent.running === true ? ("active" as const) : ("idle" as const), id: agent.threadId!, title: agent.instance, displayTitle: agent.instance, href: `/projects/proj_panel/threads/${agent.threadId}`, projectId: "proj_panel", hasPendingInteraction: false }));
  return { status: "ready", threads };
}
