// @vitest-environment jsdom
// The places that say what happened to an agent outside OATS: the sidebar's row and the thread's
// line (on an open thread and on an archived one). Each from the kernel's row
// (the snapshot's `Agent`) and bb's own answer for the thread.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { ExperimentalThreadHeaderRowProps, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { setAgentPage } from "../../app/home/agent-tab";
import { asked } from "../../app/lifecycle";
import type { Agent } from "../../model/types";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

const DIGEST = "weekly-digest-helper"; // the sample's stopped agent (an operator's stop), on thr_digest
const MESSAGE = `a harness runs in ${DIGEST} on bb, and OATS recorded this instance stopped: stop it with \`oats instance stop ${DIGEST}\`, or start it from OATS`;
const REPORT = { code: "running-outside-oats" as const, backend: "bb", message: MESSAGE };

/** The pinned roster with the two facts of the kernel's row on the agents named (as kernel/roster.ts reads them: test/outside/kernel.test.ts). */
const roster = (rows: Record<string, { sessionEnd?: string; outsideOats?: typeof REPORT }>): Agent[] => fixtureAgents().map((agent): Agent => ({ ...agent, ...rows[agent.instance] }));
/** The handlers of a roster so changed. */
const facts = (rows: Record<string, { sessionEnd?: string; outsideOats?: typeof REPORT }>, over: Partial<Handlers> = {}): Handlers => handlers(over, roster(rows));

/** bb's threads without the digest's: bb's sidebar lists active threads only, so an archived thread and a deleted one are both absent. */
const withoutDigest = () => ({ status: "ready" as const, threads: fixtureThreads().filter((thread) => thread.id !== "thr_digest") });

type ListArgs = { threadIds: readonly string[]; archived: boolean; includeHidden: boolean };
/** bb's own answer for the ids asked: the archived threads among them. */
function bb(archivedIds: readonly string[]) {
  const asked: ListArgs[] = [];
  const list = async (args: ListArgs) => (asked.push(args), args.threadIds.filter((id) => archivedIds.includes(id)).map((id) => ({ id, archivedAt: 1_763_000_000_000 })));
  return { asked, sdk: { threads: { list, interactions: { list: async () => [] } } } as never as RenderSlotOptions<Contract>["sdk"] };
}

async function sidebar(options: RenderSlotOptions<Contract>) {
  const app = await loadApp();
  let navigated = 0;
  const slot = renderSlot<PluginThreadListProps, Contract>(app.threadLists[0]!, { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => void navigated++, searchQuery: "" }, options);
  await slot.findByTestId("oats-tree");
  return { slot, navigated: () => navigated };
}
const threadless = (slot: Awaited<ReturnType<typeof sidebar>>["slot"]) => slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === DIGEST)!;
const rowFacts = (row: HTMLElement) => within(row).getByTestId("oats-row-facts").textContent;

/**
 * Every parent of the tree opened, as a person does with its chevron: a parent's children are
 * closed when the page loads (test/roster/sidebar.test.tsx pins that), and a test that reads a child's row opens them first.
 */
async function openParents(slot: { findByTestId: (id: string) => Promise<HTMLElement>; container: HTMLElement }) {
  await slot.findByTestId("oats-tree");
  for (;;) {
    const closed = slot.container.querySelector<HTMLElement>('[data-testid="oats-row-toggle"][aria-expanded="false"]');
    if (closed === null) return;
    fireEvent.click(closed);
  }
}
/** A row's mark: the state it draws, and its tone ("warning" for a stopped agent that needs a remedy). */
const markOf = (row: HTMLElement) => [row.querySelector("[data-mark]")!.getAttribute("data-state"), row.querySelector("[data-mark]")!.getAttribute("data-tone")];

// ---- the sidebar's row

test("stopped, its thread archived in bb: the row says \"Stopped\" alone, in the plain tone, never \"its bb thread is gone\", and opens the archived conversation", async () => {
  const { asked, sdk } = bb(["thr_digest"]);
  const { slot, navigated } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk });
  // Nothing is wrong with it (a provider that archives at stop leaves every stopped agent so): the state's word, no reason and no warning.
  await waitFor(() => expect(threadless(slot).getAttribute("data-opens")).toBe("thread")); // bb has answered
  expect(rowFacts(threadless(slot))).toBe("Stopped · oats-expert");
  expect(markOf(threadless(slot))).toEqual(["stopped", null]);
  // bb is asked once, by id, for the archived threads alone, hidden ones included.
  expect(asked).toEqual([{ threadIds: ["thr_digest"], archived: true, includeHidden: true }]);
  fireEvent.click(threadless(slot));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_digest" }]);
  expect(navigated()).toBe(1);
  expect(slot.container.textContent).not.toContain("its bb thread is gone");
});

test("stopped, its thread deleted in bb: the row says it was deleted, and opens the agent's own page", async () => {
  const { sdk } = bb([]);
  const { slot } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk });
  setAgentPage((navigate, instance) => navigate.toPluginPanel("agent", { subPath: instance }));
  await waitFor(() => expect(rowFacts(threadless(slot))).toBe("Stopped · oats-expert · deleted in bb"));
  expect(markOf(threadless(slot))).toEqual(["stopped", "warning"]); // a remedy is needed: Start, for a new conversation
  fireEvent.click(threadless(slot));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: DIGEST } }]);
});

test("a session OATS lost: \"Stopped\" in the warning tone, then the reason, by bb's answer for the same row; never a state of its own", async () => {
  const lost = () => facts({ [DIGEST]: { sessionEnd: "lost" } });
  const archived = await sidebar({ rpc: lost(), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(rowFacts(threadless(archived.slot))).toBe("Stopped · oats-expert · may still run"));
  // The row's title says the whole: where its thread is, and that it may still run.
  expect(threadless(archived.slot).querySelector('[data-testid="oats-row-facts"]')!.getAttribute("title")).toBe("Stopped · oats-expert · Archived in bb while running: it may still run.");
  expect(markOf(threadless(archived.slot))).toEqual(["stopped", "warning"]);
  resetApp();
  const deleted = await sidebar({ rpc: lost(), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(rowFacts(threadless(deleted.slot))).toBe("Stopped · oats-expert · deleted in bb"));
  expect(markOf(threadless(deleted.slot))).toEqual(["stopped", "warning"]);
});

test("while bb has not said, or cannot say, where the thread is, the row claims nothing of it", async () => {
  const sdk = { threads: { list: async () => Promise.reject(new Error("bb is away")) } } as never as RenderSlotOptions<Contract>["sdk"];
  const { slot } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk });
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for a claim to be drawn, if one were made)
  await waitFor(() => expect(rowFacts(threadless(slot))).toBe("Stopped · oats-expert"));
});

test("the kernel's report on a row: its state IS \"Running outside OATS\", in the warning tone, alone on the row's line; and it is counted among those that need a person", async () => {
  const { slot } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  const row = () => slot.getAllByTestId("oats-agent-row").find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === "thr_digest")!;
  await waitFor(() => expect(rowFacts(row())).toBe("Running outside OATS · oats-expert"));
  expect(markOf(row())).toEqual(["outside", null]); // no grey "Stopped" dot for an agent that runs
  // No other row is in that state.
  expect(slot.container.querySelectorAll('[data-mark][data-state="outside"]')).toHaveLength(1);
  // It is counted among those that need a person (`view.needing`: bb's badge and the home's heading count it); the sidebar has no line of its own for the count.
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
});

test("with nothing reported, the rows are the roster's own: no note, no mark, and bb is asked nothing", async () => {
  const { asked, sdk } = bb([]);
  const { slot } = await sidebar({ rpc: handlers(), sidebarThreads: sidebarThreads(), sdk });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(slot.container.querySelector('[data-mark][data-state="outside"], [data-mark][data-tone="warning"]')).toBeNull();
  await waitFor(() => expect(slot.getAllByTestId("oats-row-facts").map((line) => line.textContent)).toContain("Stopped · oats-expert"));
  expect(asked).toEqual([]);
});

// ---- the thread's line

async function line(threadId: string, options: RenderSlotOptions<Contract>) {
  const app = await loadApp();
  const Row = app.threadHeaderRows[0]!.component;
  const Overlay = app.appOverlays[0]!.component;
  const slot = renderSlot<ExperimentalThreadHeaderRowProps, Contract>(
    {
      component: function Thread(props: ExperimentalThreadHeaderRowProps) {
        return (
          <>
            <Row {...props} />
            <Overlay />
          </>
        );
      },
    },
    { threadId, projectId: "proj_x", environment: null },
    options,
  );
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  return slot;
}
const words = (slot: Awaited<ReturnType<typeof line>>) => {
  const status = within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line");
  return [within(status).getByTestId("oats-state").textContent, ...within(status).queryAllByTestId("oats-status-part").map((part) => part.textContent!.replace(/^· /, ""))];
};
/** The acts of a place, in order: this feature's own buttons and the line's (`oats-status-act`), and the lifecycle's `AgentActs` (`oats-agent-act-<verb>`, each named with its "…": it opens a dialog). */
const ACT = '[data-testid="oats-status-act"], [data-testid^="oats-agent-act-"]';
const actsIn = (place: HTMLElement) => Array.from(place.querySelectorAll(ACT)).map((button) => button.textContent);
const acts = (slot: Awaited<ReturnType<typeof line>>, within_ = "oats-identity-row") => actsIn(slot.getByTestId(within_));
const calls = (slot: Awaited<ReturnType<typeof line>>, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
const noEvents: Partial<Handlers> = { panelEvents: () => ({ events: [] }) as never };

test("the kernel's report on the open thread: one statement, \"Running outside OATS · stopped in OATS\", in the warning tone, with Stop… (the primary act) and Start… as the line's own acts; under it ONE fold, Details: what happened in a person's words, then the kernel's code and sentence; no box, no title", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  const warning = await slot.findByTestId("oats-outside-warning");
  // The state, then what OATS recorded, as a fact with no time: never "Stopped" as the state of an agent that runs.
  await waitFor(() => expect(words(slot)).toEqual(["Running outside OATS", "stopped in OATS"]));
  const status = within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line");
  // "stopped in OATS" is in the warning tone; the mark is the state's own, as on its row in the sidebar (the state "outside" has the warning colour for its fill: no tone over it).
  expect([status.getAttribute("data-state"), within(status).getByTestId("oats-state").getAttribute("data-tone"), within(status).getByTestId("oats-status-part").getAttribute("data-tone")]).toEqual(["outside", null, "warning"]);
  // No box and no title under the line: nothing repeats it.
  expect(within(slot.getByTestId("oats-identity-row")).queryByTestId("oats-notice")).toBeNull();
  expect(slot.getByTestId("oats-identity-row").textContent).not.toMatch(/is running in bb, but OATS recorded it as stopped|stops the harness|starts it from OATS, in a new conversation/);
  // ONE fold, closed: a person's words first, then the kernel's code and sentence. Nothing in view has a backtick or a command.
  const details = within(warning).getByTestId("oats-outside-details");
  expect(details.hasAttribute("open")).toBe(false);
  expect(Array.from(details.querySelectorAll("p")).map((line) => line.textContent)).toEqual(["Someone sent it a message in bb. Stop, then Start.", `running-outside-oats: ${MESSAGE}`]);
  expect(warning.querySelectorAll("details")).toHaveLength(1);
  const inView = slot.getByTestId("oats-identity-row").cloneNode(true) as HTMLElement;
  inView.querySelector('[data-testid="oats-outside-details"]')!.remove();
  expect(inView.textContent).not.toMatch(/`|oats instance/);
  // Stop… and Start… are the line's own acts, once each: the fold draws no button.
  expect(within(status).getAllByTestId("oats-status-act").map((act) => act.textContent)).toEqual(["Stop…", "Start…"]);
  // Of the two, Stop… is the primary act: the one that brings it back under OATS (Start… begins a new conversation, and is refused while the thread is in a turn).
  expect(within(status).getAllByTestId("oats-status-act").filter((act) => act.hasAttribute("data-primary")).map((act) => act.textContent)).toEqual(["Stop…"]);
  expect(warning.querySelectorAll("button")).toHaveLength(0);
  // Start is the lifecycle's own act: its dialog is asked for, and nothing runs on one press.
  fireEvent.click(within(status).getByRole("button", { name: "Start…" }));
  expect(asked()).toEqual({ verb: "start", instance: DIGEST });
  expect(calls(slot, "start")).toEqual([]);
});

test("Stop on the report's line opens the lifecycle's Stop dialog for that agent", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }, noEvents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-outside-warning");
  fireEvent.click(within(slot.getByTestId("oats-identity-row")).getByRole("button", { name: "Stop…" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
});

test("a stopped row with no report (an OATS that does not list the feature answers none) is the roster's own line: nothing is said of it", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, noEvents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
  expect([words(slot)[0], acts(slot)]).toEqual(["Stopped", ["Start…"]]);
});

test("failed, on its open thread: \"Failed\", why in two words, and the ONE act of a failed agent whose session ended: Start (nothing runs); no warning, and never \"message to continue\"", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "shell" } : agent));
  const slot = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  expect(words(slot)).toEqual(["Failed", "session ended"]);
  expect(acts(slot)).toEqual(["Start…"]);
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
});

test("the archived thread of a stopped agent has its own row: who it is, \"Stopped\", the fact, and Start", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, noEvents), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("stopped-archived");
  expect(within(row).getByTestId("oats-outside-agent").textContent).toBe("Weekly digest helper");
  expect(words(slot)).toEqual(["Stopped", "archived in bb"]);
  // Its acts are on this row: bb's menu of an archived thread has none of the roster's.
  expect(acts(slot)).toEqual(["Start…", "Retire…"]);
  fireEvent.click(within(row).getByRole("button", { name: "Start…" }));
  expect(asked()).toEqual({ verb: "start", instance: DIGEST });
});

test("three agents whose thread bb has archived, side by side: an operator's stop says its state alone, plain; a lost session and one that still runs say \"may still run\" with the warning mark", async () => {
  const HARVEST = "harvest-knowledge-helper";
  const RANKER = "ranker-v3-probe";
  const gone = new Set(["thr_digest", "thr_harvest", "thr_research"]);
  const threads = { status: "ready" as const, threads: fixtureThreads().filter((thread) => !gone.has(thread.id)) };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd: "stopped" } : agent.instance === RANKER ? { ...agent, running: false, runtimeState: "stopped", sessionEnd: "lost", waiting: null } : agent.instance === HARVEST ? { ...agent, running: true, runtimeState: "unknown", waiting: null } : agent));
  const { slot } = await sidebar({ rpc: handlers({}, agents), sidebarThreads: threads, sdk: bb([...gone]).sdk });
  await openParents(slot); // (one of the three has a parent: an agent with no bb thread is under its parent like any other, and a parent is closed as the page loads)
  const rowOf = (instance: string) => slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === instance)!;
  await waitFor(() => expect([DIGEST, RANKER, HARVEST].map((instance) => rowOf(instance).getAttribute("data-opens"))).toEqual(["thread", "thread", "thread"]));
  expect([DIGEST, RANKER, HARVEST].map((instance) => [rowFacts(rowOf(instance)), ...markOf(rowOf(instance))])).toEqual([
    ["Stopped · oats-expert", "stopped", null],
    ["Stopped · research-expert · may still run", "stopped", "warning"],
    ["Idle · knowledge-harvester · may still run", "idle", "warning"],
  ]);
});

test("the archived thread of an agent that still runs: its state's word in the warning tone, that its process may still run, and Stop, then Retire", async () => {
  const threads = { status: "ready" as const, threads: fixtureThreads().filter((thread) => thread.id !== "thr_harvest") };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: true, runtimeState: "unknown", waiting: null } : agent));
  const slot = await line("thr_harvest", { rpc: handlers(noEvents, agents), sidebarThreads: threads, sdk: bb(["thr_harvest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("running-archived");
  expect(words(slot)).toEqual(["Idle", "Archived in bb while running: it may still run."]);
  expect(within(within(row).getByTestId("oats-status-line")).getByTestId("oats-state").getAttribute("data-tone")).toBe("warning");
  expect(acts(slot)).toEqual(["Stop…", "Retire…"]);
  fireEvent.click(within(row).getByRole("button", { name: "Stop…" }));
  expect(asked()).toEqual({ verb: "stop", instance: "harvest-knowledge-helper" });
});

test("the archived thread of an agent whose session OATS lost: \"Stopped\" in the warning tone, that its process may still run, and Stop, then Retire", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }, noEvents), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("lost-archived");
  expect(words(slot)).toEqual(["Stopped", "Archived in bb while running: it may still run."]);
  const status = within(row).getByTestId("oats-status-line");
  expect([status.getAttribute("data-state"), within(status).getByTestId("oats-state").getAttribute("data-tone"), within(status).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))]).toEqual(["stopped", "warning", ["warning"]]);
  // OATS reads it not running; its process may run: Stop is offered, and no Start until it is stopped.
  expect(acts(slot)).toEqual(["Stop…", "Retire…"]);
  fireEvent.click(within(row).getByRole("button", { name: "Stop…" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
});

test("Retire on the archived thread's row opens the lifecycle's Retire dialog for that agent", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, noEvents), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  fireEvent.click(within(await slot.findByTestId("oats-identity-row")).getByRole("button", { name: "Retire…" }));
  expect(asked()).toEqual({ verb: "retire", instance: DIGEST });
});

test("a stopped agent on its open thread: that a message here starts it outside OATS, with no time before it, and Start", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for a time to be drawn, if one were read)
  expect(words(slot)).toEqual(["Stopped", "A message here starts it outside OATS."]);
  expect(calls(slot, "panelEvents")).toEqual([]); // when it stopped is the instance panel's fact: the line reads no events
  // The SENTENCE warns, in the warning tone. The MARK is the state's own grey, the one colour of this agent's dot: the sidebar's row draws the same (the lead's P9).
  expect(within(slot.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual(["warning"]);
  expect(within(slot.getByTestId("oats-status-line")).getByTestId("oats-state").getAttribute("data-tone")).toBeNull();
  expect(acts(slot)).toEqual(["Start…"]);
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
});

test("bb holds a question on the thread of an agent OATS stopped: \"Needs you\", then what OATS recorded and the warning, with the Start it names", async () => {
  // An answer typed in the thread is the message that starts it without OATS.
  const asking = { status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_digest" ? { ...thread, hasPendingInteraction: true } : thread)) };
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: asking });
  await slot.findByTestId("oats-identity-row");
  expect(words(slot)).toEqual(["!Needs you", "Stopped. An answer here starts it outside OATS."]);
  expect(within(slot.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual(["warning"]);
  expect(acts(slot)).toEqual(["Start…"]);
  resetApp();
  // Its session was lost: a message carries it on, and its question is what the line says, as the roster has it.
  const host = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: asking });
  await host.findByTestId("oats-identity-row");
  expect(words(host)).toEqual(["!Needs you"]);
  expect(within(host.getByTestId("oats-status-line")).getByTestId("oats-state").getAttribute("data-tone")).toBeNull();
});

test("bb holds a question on the thread of an agent that is not loaded, or whose session was lost: the row and the line say \"Needs you\" and the roster's own words, with no reason made for another state and no act of this feature's", async () => {
  const asking = { status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_digest" || thread.id === "thr_harvest" ? { ...thread, hasPendingInteraction: true } : thread)) };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd: "lost" } : agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "unknown" } : agent));
  // The rows: the soul after "Needs you", never "Needs you · session lost" or "Needs you · not loaded".
  const side = await sidebar({ rpc: handlers({}, agents), sidebarThreads: asking });
  await openParents(side.slot);
  const factsOf = (thread: string) => rowFacts(side.slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === thread)!);
  expect([factsOf("thr_digest"), factsOf("thr_harvest")]).toEqual(["Needs you · oats-expert", "Needs you · knowledge-harvester"]);
  resetApp();
  // The line of the one that is not loaded: bb's question, and no Start (the sentence that says what Start does is not on this line).
  const unloaded = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: asking });
  await unloaded.findByTestId("oats-identity-row");
  expect([words(unloaded), acts(unloaded)]).toEqual([["!Needs you"], []]);
});

// A ROW's word for a lost session (the lead's L17, 24 Nov 2026): "Lost" in the state's place, and no reason after it;
// the state is untouched, and the row's title, the thread's line and the agent's page keep "Stopped · session lost".
test("what a row draws in the state's place (rowWords): a lost session reads \"Lost\" with no reason; every other row keeps its state's word and its reason", async () => {
  const { rowWords, LOST_WORD } = await import("../../app/outside");
  expect(LOST_WORD).toBe("Lost");
  const whole = (state: string, reason: string | null) => ({ state, reason });
  // Lost: the word, no reason; the title's words are the true ones.
  expect(rowWords("Stopped", "stopped", "session lost")).toEqual({ state: "Lost", reason: null, title: whole("Stopped", "session lost") });
  // An operator's stop (no reason on its row): "Stopped".
  expect(rowWords("Stopped", "stopped", null)).toEqual({ state: "Stopped", reason: null, title: whole("Stopped", null) });
  // A lost session whose thread bb archived, or deleted: its row's reason is where the thread is, in the warning tone
  // (that is what needs a person: its process may still run), so it reads "Stopped" and that reason, never "Lost".
  expect(rowWords("Stopped", "stopped", "archived in bb")).toEqual({ state: "Stopped", reason: "archived in bb", title: whole("Stopped", "archived in bb") });
  // "may still run" stays "Stopped" (no word of its own in the state's place), and its title says the whole sentence.
  expect(rowWords("Stopped", "stopped", "may still run")).toEqual({ state: "Stopped", reason: "may still run", title: whole("Stopped", "Archived in bb while running: it may still run.") });
  expect(rowWords("Stopped", "stopped", "deleted in bb").state).toBe("Stopped");
  // Nothing else gets a word of its own in the state's place: not another reason, and not "session lost" after another state.
  expect(rowWords("Idle", "idle", "not loaded")).toEqual({ state: "Idle", reason: "not loaded", title: whole("Idle", "not loaded") });
  expect(rowWords("Failed", "error", "archived in bb").state).toBe("Failed");
  expect(rowWords("Needs you", "needs-you", "session lost")).toEqual({ state: "Needs you", reason: "session lost", title: whole("Needs you", "session lost") });
  expect(rowWords("Not in OATS any more", "stopped", null).state).toBe("Not in OATS any more");
});

test("a lost session's ROW reads \"Lost\" on bb and on tmux, side by side, and its title, its thread's line and its page say \"Stopped · session lost\"; an agent on tmux that OATS stopped reads \"Stopped\", never \"Failed\"", async () => {
  // The rows as the kernel prints them: on bb "stopped" beside sessionEnd "lost"; on tmux (recorded, the real run) no word
  // beside "lost" for a lost session, and "shell" beside "stopped" for a stop with OATS.
  const TMUX = "kernel-fix-developer";
  const rows = (tmux: Partial<Agent>) => fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd: "lost" } : agent.instance === TMUX ? { ...agent, waiting: null, ...tmux } : agent));
  const lostRows = rows({ running: false, runtimeState: null, sessionEnd: "lost", startedAt: "2026-11-21T10:00:00.000Z" });
  const { slot } = await sidebar({ rpc: handlers({}, lostRows), sidebarThreads: sidebarThreads() });
  const onBb = () => rowFacts(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_digest")!);
  const onTmux = (from: typeof slot) => from.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === TMUX)!;
  // The row: "Lost" in the state's place, no reason after it (so nothing has to fit or leave); the title says all, with the true words.
  await waitFor(() => expect([onBb(), rowFacts(onTmux(slot))]).toEqual(["Lost · oats-expert", "Lost · oats-developer · tmux"]));
  const titleOf = (row: HTMLElement) => within(row).getByTestId("oats-row-facts").getAttribute("title");
  expect([titleOf(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_digest")!), titleOf(onTmux(slot))]).toEqual(["Stopped · oats-expert · session lost", "Stopped · oats-developer · session lost · tmux"]);
  // The state is untouched: the agent is stopped (the stopped mark, plain: nobody did anything wrong).
  expect(markOf(onTmux(slot))).toEqual(["stopped", null]);
  expect(markOf(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_digest")!)).toEqual(["stopped", null]);
  resetApp();
  // The bb agent's line: the reason, then that a message is the way on; no Start on the line, no time (the kernel records none of the loss), no cause, no promise.
  const bbLine = await line("thr_digest", { rpc: handlers(noEvents, lostRows), sidebarThreads: sidebarThreads() });
  await bbLine.findByTestId("oats-identity-row");
  await waitFor(() => expect(words(bbLine)).toEqual(["Stopped", "session lost", "message to continue"]));
  expect(acts(bbLine)).toEqual([]);
  expect(bbLine.getByTestId("oats-identity-row").textContent).not.toMatch(/Nobody stopped|To carry on|Start begins/);
  resetApp();
  // The tmux agent's page: the reason on its header's state line, and no sentence (what Start does is its dialog's one line; when it started is its Session's); the header's own Start, and no Restart: nothing runs.
  const page = await agentPage(TMUX, { rpc: handlers({}, lostRows), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(page).kind).toBe("lost-tmux"));
  // ON the state's line, as on its row: "Stopped · session lost"; nothing alone under the tabs (no block at all: it has no act of this feature's).
  expect(header(page)).toMatchObject({ state: "Stopped", sentence: "session lost", tone: null, acts: [], alone: null, block: null });
  expect(page.queryByTestId("oats-outside-last-started")).toBeNull();
  expect(page.getByTestId("oats-agent-page").textContent).not.toMatch(/Nobody stopped|Start tries|Last started/);
  expect(page.getByTestId("oats-agent-page").textContent!.match(/session lost/g)).toHaveLength(1);
  expect(header(page).headed).toEqual(["Start…", "Retire…"]);
  resetApp();
  // Stopped with OATS, on tmux: "Stopped" and where it is, and nothing of this feature's.
  const stopped = await sidebar({ rpc: handlers({}, rows({ running: false, runtimeState: "shell", sessionEnd: "stopped" })), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(rowFacts(onTmux(stopped.slot))).toBe("Stopped · oats-developer · tmux"));
  expect(markOf(onTmux(stopped.slot))).toEqual(["stopped", null]);
});

test("an agent that is not loaded, on its own thread at rest: \"Idle · not loaded · message to continue\", and no Start on the line", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "unknown", waiting: null } : agent));
  const slot = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  await waitFor(() => expect(words(slot)).toEqual(["Idle", "not loaded", "message to continue"]));
  expect(acts(slot)).toEqual([]);
});

test("an agent that is not loaded, on a thread bb says works (a turn runs): the row and the line say \"Working\", with no \"not loaded\" and no Start", async () => {
  // The kernel's `running: false` beside "unknown" says no harness is loaded; bb says a turn runs on the thread. The state is bb's word.
  const active = { status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_harvest" ? { ...thread, status: "active" as const, hasPendingInteraction: false } : thread)) };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "unknown", waiting: null } : agent));
  const side = await sidebar({ rpc: handlers({}, agents), sidebarThreads: active });
  await openParents(side.slot);
  await waitFor(() => expect(rowFacts(side.slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_harvest")!)).toBe("Working · knowledge-harvester"));
  resetApp();
  const unloaded = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: active });
  await unloaded.findByTestId("oats-identity-row");
  await waitFor(() => expect(words(unloaded)[0]).toBe("Working"));
  expect(words(unloaded).join(" ")).not.toMatch(/not loaded|carry on/);
  // No Start. The line of an agent that works offers Stop (the roster's second pass: it opens the stop dialog, nothing stops on the press).
  expect(acts(unloaded)).toEqual(["Stop…"]);
});

// ---- the agent's own page (the instance panel's header)

async function agentPage(instance: string, options: RenderSlotOptions<Contract>) {
  const app = await loadApp();
  const Overlay = app.appOverlays[0]!.component;
  const Page = app.navPanels.find((candidate) => candidate.id === "agent")!.component;
  const slot = renderSlot<{ subPath: string }, Contract>(
    {
      component: function AgentPage(props: { subPath: string }) {
        return (
          <>
            <Page {...props} />
            <Overlay />
          </>
        );
      },
    },
    { subPath: instance },
    options,
  );
  await slot.findByTestId("oats-panel-header");
  return slot;
}
/**
 * The agent's page: its state in the header over the tabs, with what happened to it ON the state's
 * line (`sentence`, `tone`: nothing of it stands alone under the tabs), and this feature's block,
 * first on the Instance tab's page, where it has an act or the kernel's report to draw.
 */
const header = (slot: Awaited<ReturnType<typeof agentPage>>) => {
  const head = slot.getByTestId("oats-panel-header");
  const page = slot.getByTestId("oats-panel-page-instance");
  const block = page.firstElementChild?.getAttribute("data-testid") === "oats-outside-agent-block" ? (page.firstElementChild as HTMLElement) : null;
  const parts = within(within(head).getByTestId("oats-panel-state")).queryAllByTestId("oats-status-part");
  return {
    state: within(within(head).getByTestId("oats-panel-state")).getByTestId("oats-state").textContent,
    kind: block?.getAttribute("data-outside") ?? within(head).getByTestId("oats-panel-state").getAttribute("data-outside"),
    sentence: parts.length === 0 ? null : parts.map((part) => part.textContent!.replace(/^· /, "")).join(" | "),
    tone: parts.at(-1)?.getAttribute("data-tone") ?? null,
    /** Nothing of what happened stands alone on the page under the tabs: no paragraph in the block, or no block. */
    alone: block?.querySelector(":scope > p")?.textContent ?? null,
    acts: block === null ? [] : actsIn(block),
    /** The lifecycle's own acts for the agent's state, in the panel's header (`AgentActs`, the panel's). */
    /** The lifecycle's own row of acts in the header (none where the status line holds them all: an agent that runs outside OATS). */
    headed: within(head).queryByTestId("oats-agent-acts") === null ? [] : actsIn(within(head).getByTestId("oats-agent-acts")),
    head,
    block,
  };
};

test("an agent whose thread was deleted in bb: its own page says \"Stopped\", what happened, and has the lifecycle's Start and Retire in its header, once", async () => {
  const slot = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(slot).kind).toBe("deleted"));
  expect(header(slot)).toMatchObject({ state: "Stopped", sentence: "deleted in bb", tone: "warning", acts: [], headed: ["Start…", "Retire…"] }); // the acts are the header's, once
  fireEvent.click(within(header(slot).head).getByRole("button", { name: "Start…" }));
  expect(asked()).toEqual({ verb: "start", instance: DIGEST });
});

test("an agent whose session OATS lost and whose thread bb archived: its own page has Stop under what happened (the header offers none for an agent that reads stopped), and Retire in the header", async () => {
  const slot = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(slot).kind).toBe("lost-archived"));
  expect(header(slot)).toMatchObject({ state: "Stopped", sentence: "Archived in bb while running: it may still run.", tone: "warning", acts: ["Stop…"], headed: ["Start…", "Retire…"] });
  fireEvent.click(within(header(slot).block!).getByRole("button", { name: "Stop…" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
});

test("a stopped agent whose thread bb has archived, or deleted: its own page says what happened, with Start and Retire in its header", async () => {
  const archived = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(archived).kind).toBe("stopped-archived"));
  expect(header(archived)).toMatchObject({ state: "Stopped", sentence: "archived in bb", tone: null, acts: [], headed: ["Start…", "Retire…"] }); // a fact, with no remedy needed: not toned
  resetApp();
  const deleted = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(deleted).kind).toBe("deleted"));
  expect(header(deleted)).toMatchObject({ state: "Stopped", sentence: "deleted in bb", acts: [], headed: ["Start…", "Retire…"] });
});

// A reason that is only where the thread is has no sentence of its own; a narrow row may not draw it (it gives way
// first). The agent's page says it whole, on its state's line, after the roster's own words (the specialist's word of
// 24 Nov 2026): what left the row is never said nowhere.
test("the agent's page says, on its state's line, the reason its row says for every kind: where the thread is, after the roster's own words", async () => {
  const HARVEST = "harvest-knowledge-helper";
  const without = (thread: string) => ({ status: "ready" as const, threads: fixtureThreads().filter((each) => each.id !== thread) });
  // Failed, its thread archived in bb: the row says "Failed · <soul> · archived in bb"; the page, "Failed · session ended · archived in bb".
  const failed = await agentPage(HARVEST, { rpc: handlers({}, fixtureAgents().map((agent): Agent => (agent.instance === HARVEST ? { ...agent, running: false, runtimeState: "shell", waiting: null } : agent))), sidebarThreads: without("thr_harvest"), sdk: bb(["thr_harvest"]).sdk });
  await waitFor(() => expect(header(failed)).toMatchObject({ state: "Failed", sentence: "session ended · archived in bb", tone: null, alone: null }));
  resetApp();
  // The same, its thread deleted: plain (it is not stopped: nothing here warns).
  const gone = await agentPage(HARVEST, { rpc: handlers({}, fixtureAgents().map((agent): Agent => (agent.instance === HARVEST ? { ...agent, running: false, runtimeState: "shell", waiting: null } : agent))), sidebarThreads: without("thr_harvest"), sdk: bb([]).sdk });
  await waitFor(() => expect(header(gone)).toMatchObject({ state: "Failed", sentence: "session ended · deleted in bb", tone: null }));
  resetApp();
  // Stopped by an operator, its row names no thread at all: "Stopped · no bb thread".
  const none = await agentPage(DIGEST, { rpc: handlers({}, fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, threadId: null, sessionEnd: "stopped" } : agent))), sidebarThreads: sidebarThreads(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(none)).toMatchObject({ state: "Stopped", sentence: "no bb thread", tone: null }));
  resetApp();
  // An agent that asks through OATS and has no thread: what it asks is said once, in Needs input; the line keeps the reason.
  const asks = await agentPage("flaky-ci-developer", { rpc: handlers({}, fixtureAgents().map((agent): Agent => (agent.instance === "flaky-ci-developer" ? { ...agent, threadId: null } : agent))), sidebarThreads: sidebarThreads(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(asks).sentence).toMatch(/(^| \| )no bb thread$/)); // (after how long it has waited, where the line says that)
  expect(header(asks).state).toBe("!Needs you"); // ("!": the mark of an agent that waits)
  expect(header(asks).sentence).not.toMatch(/permission|Bash/); // what it asks is not said twice
});

test("no act is drawn twice on the agent's page: the three agents whose thread bb has archived, and the one that runs outside OATS", async () => {
  const HARVEST = "harvest-knowledge-helper";
  const verbs = (slot: Awaited<ReturnType<typeof agentPage>>) => actsIn(slot.getByTestId("oats-agent-page")).map((label) => label!.replace("…", ""));
  const once = (all: string[]) => expect(new Set(all).size, all.join(", ")).toBe(all.length);
  // An operator's stop, archived: the header's Start and Retire.
  const stopped = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(stopped).kind).toBe("stopped-archived"));
  expect(verbs(stopped)).toEqual(["Start", "Retire"]);
  resetApp();
  // A session lost, archived: the header's Start and Retire, and this feature's Stop, which the header does not offer.
  const lost = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(lost).kind).toBe("lost-archived"));
  once(verbs(lost));
  expect([...verbs(lost)].sort()).toEqual(["Retire", "Start", "Stop"]);
  resetApp();
  // It still runs, archived: the header's acts for its state; Stop is among them, and this feature adds none.
  const threads = { status: "ready" as const, threads: fixtureThreads().filter((thread) => thread.id !== "thr_harvest") };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === HARVEST ? { ...agent, running: true, runtimeState: "unknown", waiting: null } : agent));
  const runs = await agentPage(HARVEST, { rpc: handlers({}, agents), sidebarThreads: threads, sdk: bb(["thr_harvest"]).sdk });
  await waitFor(() => expect(header(runs).kind).toBe("running-archived"));
  once(verbs(runs));
  expect(verbs(runs)).toContain("Stop");
  expect(header(runs)).toMatchObject({ acts: [], tone: "warning", sentence: "Archived in bb while running: it may still run." });
  resetApp();
  // A row that says only where its thread is (failed, its thread archived): no block of this feature's; the acts are the header's.
  const answer = bb(["thr_harvest"]);
  const failed = await agentPage(HARVEST, { rpc: handlers({}, fixtureAgents().map((agent): Agent => (agent.instance === HARVEST ? { ...agent, running: false, runtimeState: "shell", waiting: null } : agent))), sidebarThreads: threads, sdk: answer.sdk });
  await waitFor(() => expect(header(failed).state).toBe("Failed"));
  await waitFor(() => expect(answer.asked).toHaveLength(1)); // bb has been asked where the thread is: the row is the one that says only that
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for a block to be drawn, if one were)
  expect(header(failed)).toMatchObject({ block: null, alone: null, acts: [] });
  once(verbs(failed));
  resetApp();
  // It runs outside OATS: Stop, Start and Retire, once each, all on the header's line; its Details says what to do.
  const outside = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(outside).kind).toBe("outside"));
  expect(verbs(outside)).toEqual(["Stop", "Start", "Retire"]);
});

test("the page of an agent that runs outside OATS has Stop… and Start… on its LINE, with the roster read or not: neither is missing with nothing to press, and neither is there twice", async () => {
  // The panel holds the agent it showed while the roster is not read, and its header's `AgentActs` then draws
  // nothing. The header's line is drawn with what the panel gives it then (`held`: true once the read has FAILED,
  // false while it is still being read): the line's acts (`pageActs`), then the lifecycle's row of acts without
  // them (`AgentActs except`), the Details under the line, and this feature's block under the tabs.
  const { OutsideAgent, OutsideAgentDetails, pageActs, pageParts } = await import("../../app/outside");
  const { AgentActs } = await import("../../app/lifecycle");
  const { agentStatus } = await import("../../app/roster/status");
  const report = (backend: string) => ({ ...REPORT, backend });
  const drawn = async (threads: RenderSlotOptions<Contract>["sidebarThreads"], held: boolean, backend = "bb") => {
    await loadApp();
    const agent: Agent = { ...fixtureAgents().find((each) => each.instance === DIGEST)!, backend, sessionEnd: "stopped", outsideOats: report(backend) };
    const agents = fixtureAgents().map((each): Agent => (each.instance === DIGEST ? agent : each));
    const roster = { nodeByInstance: new Map(), whereOf: () => "unknown" as const };
    return renderSlot<object, Contract>(
      {
        component: function Held() {
          const line = pageParts(agent, roster, agentStatus(agent, null, 0));
          const acts = pageActs(line.report, DIGEST, held);
          return (
            <>
              <div data-testid="header-line" data-detail={line.detail ?? ""} data-tone={line.tone ?? ""}>
                {acts?.buttons}
              </div>
              <div data-testid="header-acts">
                <AgentActs instance={DIGEST} except={acts?.verbs} />
              </div>
              {/* (As the panel's header has it: the report's Details under the state it explains.) */}
              <div data-testid="header-details">
                <OutsideAgentDetails agent={agent} roster={roster} />
              </div>
              <OutsideAgent agent={agent} roster={roster} held={held} />
            </>
          );
        },
      },
      {},
      { rpc: handlers({}, agents), sidebarThreads: threads },
    );
  };
  const buttons = (place: HTMLElement) => Array.from(place.querySelectorAll<HTMLButtonElement>(ACT)).map((button) => [button.textContent, button.disabled, button.hasAttribute("data-primary")]);
  const lineOf = (slot: Awaited<ReturnType<typeof drawn>>) => slot.getByTestId("header-line");
  // The read failed (bb cannot list its threads): both are the line's, held (off, with no reason of their own: the place's notice of the failed read says why), as every act is then. Stop… is the primary act.
  const failed = await drawn({ status: "error", threads: [] }, true);
  expect([lineOf(failed).getAttribute("data-detail"), lineOf(failed).getAttribute("data-tone")]).toEqual(["stopped in OATS", "warning"]);
  expect(actsIn(failed.getByTestId("header-acts"))).toEqual([]);
  expect(buttons(lineOf(failed))).toEqual([
    ["Stop…", true, true],
    ["Start…", true, false],
    ["Retire…", true, false],
  ]);
  expect(failed.queryByTestId("oats-outside-agent-block")).toBeNull();
  failed.unmount();
  resetApp();
  // Still being read: both are the line's, and can be pressed (the dialog asks the kernel itself).
  const loading = await drawn({ status: "loading", threads: [] } as never, false);
  expect(actsIn(loading.getByTestId("header-acts"))).toEqual([]);
  expect(buttons(lineOf(loading))).toEqual([
    ["Stop…", false, true],
    ["Start…", false, false],
    ["Retire…", false, false],
  ]);
  fireEvent.click(within(lineOf(loading)).getByRole("button", { name: "Stop…" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
  // Each act of the line opens its own dialog: Retire…, the last on the row, too.
  fireEvent.click(within(lineOf(loading)).getByRole("button", { name: "Retire…" }));
  expect(asked()).toEqual({ verb: "retire", instance: DIGEST });
  loading.unmount();
  resetApp();
  // The roster read: the line is the page's ONE row of acts (Stop…, Start…, Retire… last), the lifecycle's own row draws none, and nothing of it is under the tabs. No act is there twice.
  const read = await drawn(sidebarThreads(), false);
  await waitFor(() => expect(read.getByTestId("header-line").querySelectorAll("button")).toHaveLength(3));
  expect(actsIn(read.getByTestId("header-acts"))).toEqual([]);
  expect(actsIn(lineOf(read))).toEqual(["Stop…", "Start…", "Retire…"]);
  expect(read.queryByTestId("oats-outside-agent-block")).toBeNull();
  expect(within(read.getByTestId("header-details")).getByTestId("oats-outside-details")).toBeTruthy();
  read.unmount();
  resetApp();
  // An agent on another session provider has no Start of the lifecycle's: its line has Stop… alone, and nobody reads "Start" with nothing to press.
  const other = await drawn(sidebarThreads(), false, "other");
  expect(actsIn(other.getByTestId("header-acts"))).toEqual([]);
  expect(buttons(lineOf(other))).toEqual([
    ["Stop…", false, true],
    ["Retire…", false, false],
  ]);
  expect(other.queryByTestId("oats-outside-agent-block")).toBeNull();
  // No box and no title; under Details (in the header, under the state), for it: a sentence that does not say to start it (then the kernel's own).
  expect(other.getByTestId("header-details").querySelector("h3")).toBeNull();
  expect(within(other.getByTestId("header-details")).queryByTestId("oats-notice")).toBeNull();
  const sentenceOf = (place: HTMLElement) => place.querySelector('[data-testid="oats-outside-details"] p')!.textContent;
  expect(sentenceOf(other.getByTestId("header-details"))).toBe("Someone sent it a message. Stop it, so that it is stopped as OATS recorded it.");
  other.unmount();
  resetApp();
  // The same agent with the read failed: its line keeps Stop…, held (off), and still no Start; nothing under the tabs.
  const otherFailed = await drawn({ status: "error", threads: [] }, true, "other");
  expect(actsIn(otherFailed.getByTestId("header-acts"))).toEqual([]);
  expect(buttons(lineOf(otherFailed))).toEqual([
    ["Stop…", true, true],
    ["Retire…", true, false],
  ]);
  expect(otherFailed.queryByTestId("oats-outside-agent-block")).toBeNull();
  expect(sentenceOf(otherFailed.getByTestId("header-details"))).toBe("Someone sent it a message. Stop it, so that it is stopped as OATS recorded it.");
  otherFailed.unmount();
  resetApp();
  // An agent on bb: its Details says the two steps.
  const onBb = await drawn(sidebarThreads(), false);
  expect(actsIn(onBb.getByTestId("header-acts"))).toEqual([]);
  expect(sentenceOf(onBb.getByTestId("header-details"))).toBe("Someone sent it a message in bb. Stop, then Start.");
  expect(onBb.getByTestId("header-details").textContent).not.toMatch(/stops the harness|in a new conversation|but OATS recorded it as stopped/);
});

test("the panel's header of an agent on its thread carries the kernel's report, and nothing else of this feature's", async () => {
  const reported = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(reported).kind).toBe("outside"));
  // The header's LINE is the thread's line: the reason "stopped in OATS" in the warning tone, with Stop… (the primary act) and Start… as the line's own acts; the lifecycle's row of acts has what is left (no act twice); and UNDER ITS STATE the ONE fold, Details: no box, no title; nothing of it under the tabs.
  expect(header(reported)).toMatchObject({ state: "Running outside OATS", sentence: "stopped in OATS", tone: "warning", acts: [], headed: [], block: null });
  const state = within(header(reported).head).getByTestId("oats-panel-state");
  expect(within(state).getAllByTestId("oats-status-act").map((act) => [act.textContent, act.hasAttribute("data-primary")])).toEqual([["Stop…", true], ["Start…", false], ["Retire…", false]]);
  expect(Array.from(header(reported).head.querySelectorAll(ACT)).map((act) => act.textContent)).toEqual(["Stop…", "Start…", "Retire…"]);
  expect(within(header(reported).head).queryByTestId("oats-agent-acts")).toBeNull(); // ONE row of acts: the line's; no row of its own for Retire…
  expect(within(state).queryByTestId("oats-notice")).toBeNull();
  expect(state.querySelector("h3")).toBeNull();
  expect(state.querySelectorAll("details")).toHaveLength(1);
  expect(reported.getByTestId("oats-agent-page").querySelectorAll('[data-testid="oats-outside-details"]')).toHaveLength(1);
  expect(Array.from(within(state).getByTestId("oats-outside-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["Someone sent it a message in bb. Stop, then Start.", `running-outside-oats: ${MESSAGE}`]);
  // Behind a lifecycle result that says this agent changed, until the roster is read again: "Reading…" in the state's place, and the line's two acts OFF (as every act is then), still there to see.
  const { noteActed } = await import("../../app/roster/reading");
  const lineActs = () => within(reported.getByTestId("oats-panel-state")).getAllByTestId("oats-status-act").map((button) => [button.textContent, (button as HTMLButtonElement).disabled]);
  expect(lineActs()).toEqual([["Stop…", false], ["Start…", false], ["Retire…", false]]);
  act(() => noteActed([DIGEST], fixtureSnapshot().at));
  await waitFor(() => expect(within(reported.getByTestId("oats-panel-state")).getByTestId("oats-reading").textContent).toBe("Reading…"));
  expect(lineActs()).toEqual([["Stop…", true], ["Start…", true], ["Retire…", true]]);
  expect(reported.getByTestId("oats-panel-state").textContent).not.toMatch(/Running outside OATS/); // never the state of before, stated plainly
  resetApp();
  const plain = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(plain)).toMatchObject({ state: "Stopped" })); // the page is drawn, in its state
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for the block to be drawn, if one were)
  expect(header(plain)).toMatchObject({ state: "Stopped", kind: null });
});

test("a thread that is no agent's, and the id of a thread bb no longer has, draw nothing", async () => {
  const { sdk } = bb([]);
  const plain = await line("thr_plain", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(plain.queryByTestId("oats-identity-row")).toBeNull();
  resetApp();
  const deleted = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(deleted.queryByTestId("oats-identity-row")).toBeNull();
});

test("on a roster that is the last one read the acts are held, on the archived thread's row and on the report", async () => {
  const stale = (agents: Agent[]) => {
    const last = fixtureSnapshot(agents);
    return { snapshot: () => ({ ok: false as const, at: "2026-11-19T12:32:00.000Z", code: "OATS_TIMEOUT", message: "slow", machine: "falcon", last: { at: last.at, deployment: last.deployment, agents: last.agents } }) };
  };
  const archived = await line("thr_digest", { rpc: handlers({ ...noEvents, ...stale(roster({ [DIGEST]: { sessionEnd: "stopped" } })) }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  // The lifecycle's buttons, held; no reason beside them: the row's one-line notice says "Acts are off.", with Retry.
  const held = within(await archived.findByTestId("oats-identity-row")).getByTestId("oats-agent-acts");
  expect(Array.from(held.querySelectorAll("button")).map((button) => [button.textContent, button.disabled])).toEqual([["Start…", true], ["Retire…", true]]);
  expect(within(held).queryByTestId("oats-disabled-reason")).toBeNull();
  const notice = within(archived.getByTestId("oats-identity-row")).getByTestId("oats-unreadable");
  expect(notice.getAttribute("data-compact")).toBe("");
  expect(notice.textContent).toContain("Acts are off.");
  expect(within(notice).getByRole("button", { name: "Retry" })).toBeTruthy();
  resetApp();
  const open = await line("thr_digest", { rpc: handlers({ ...noEvents, ...stale(roster({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } })) }), sidebarThreads: sidebarThreads() });
  await open.findByTestId("oats-outside-warning");
  const buttons = within(within(open.getByTestId("oats-identity-row")).getByTestId("oats-status-line")).getAllByTestId("oats-status-act") as HTMLButtonElement[];
  expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([["Stop…", true], ["Start…", true]]);
  // Off, and never alone: the row's one-line notice says "Acts are off.", with Retry.
  expect(within(open.getByTestId("oats-identity-row")).getByTestId("oats-unreadable").textContent).toContain("Acts are off.");
});

// ---- one state, everywhere

/** The sidebar, a thread's row and the agent's own page (the instance panel's header), drawn together for one roster. */
async function everywhere(rows: Parameters<typeof facts>[0], threads: RenderSlotOptions<Contract>["sidebarThreads"], sdk: RenderSlotOptions<Contract>["sdk"]) {
  const app = await loadApp();
  const Sidebar = app.threadLists[0]!.component;
  const Row = app.threadHeaderRows[0]!.component;
  const Page = app.navPanels.find((candidate) => candidate.id === "agent")!.component;
  const slot = renderSlot<object, Contract>(
    {
      component: function Everywhere() {
        return (
          <>
            <Sidebar activeThreadId={null} activeProjectId={null} isCompactViewport={false} onNavigate={() => undefined} searchQuery="" />
            <Row threadId="thr_digest" projectId="proj_x" environment={null} />
            <Page subPath={DIGEST} />
          </>
        );
      },
    },
    {},
    { rpc: facts(rows), sidebarThreads: threads, sdk },
  );
  const row = () => slot.queryAllByTestId("oats-agent-row-threadless").concat(slot.queryAllByTestId("oats-agent-row")).find((each) => each.getAttribute("data-instance") === DIGEST || each.getAttribute("data-sidebar-thread-id") === "thr_digest")!;
  const places = () => ({
    sidebar: rowFacts(row()).split(" · ")[0],
    thread: within(within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line")).getByTestId("oats-state").textContent,
    panel: within(within(slot.getByTestId("oats-panel-header")).getByTestId("oats-panel-state")).getByTestId("oats-state").textContent,
  });
  return { slot, places };
}

test("bb is asked once for the threads it does not list, whatever number of places are drawn", async () => {
  const { asked, sdk } = bb(["thr_digest"]);
  const { slot } = await everywhere({ [DIGEST]: { sessionEnd: "lost" } }, withoutDigest(), sdk);
  await waitFor(() => expect(within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line").textContent).toContain("Archived in bb while running: it may still run."));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The sidebar, the thread's row and the agent's page each read the roster: one request, with one token.
  expect(asked).toEqual([{ threadIds: ["thr_digest"], archived: true, includeHidden: true }]);
});

test("a session OATS lost whose thread bb has archived says the same state word in every place: \"Stopped\", in the sidebar's row, the archived thread's row and the instance panel's header on the agent's own page", async () => {
  const { slot, places } = await everywhere({ [DIGEST]: { sessionEnd: "lost" } }, withoutDigest(), bb(["thr_digest"]).sdk);
  await waitFor(() => expect(within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line").textContent).toContain("Archived in bb while running: it may still run."));
  expect(places()).toEqual({ sidebar: "Stopped", thread: "Stopped", panel: "Stopped" });
});

test("an agent the kernel reports running outside OATS says the same state word in every place: \"Running outside OATS\", never \"Stopped\"", async () => {
  const { slot, places } = await everywhere({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }, sidebarThreads(), bb([]).sdk);
  await slot.findByTestId("oats-panel-header");
  await waitFor(() => expect(places()).toEqual({ sidebar: "Running outside OATS", thread: "Running outside OATS", panel: "Running outside OATS" }));
  for (const place of [slot.getByTestId("oats-identity-row"), slot.getByTestId("oats-panel-state")]) expect(place.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("outside");
});
