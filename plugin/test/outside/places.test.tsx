// @vitest-environment jsdom
// The places that say what happened to an agent outside OATS: the sidebar's row and the thread's
// line (on an open thread and on an archived one). Each from the kernel's row
// (the snapshot's `Agent`) and bb's own answer for the thread.
import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
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
/** A row's mark: the state it draws, and its tone ("warning" for a stopped agent that needs a remedy). */
const markOf = (row: HTMLElement) => [row.querySelector("[data-mark]")!.getAttribute("data-state"), row.querySelector("[data-mark]")!.getAttribute("data-tone")];

// ---- the sidebar's row

test("stopped, its thread archived in bb: the row says \"Stopped\" and the soul, in the plain tone, never \"its bb thread is gone\", and opens the archived conversation", async () => {
  const { asked, sdk } = bb(["thr_digest"]);
  const { slot, navigated } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk });
  // Nothing is wrong with it (a provider that archives at stop leaves every stopped agent so): the soul, and no warning.
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
  await waitFor(() => expect(rowFacts(threadless(slot))).toBe("Stopped · deleted in bb"));
  expect(markOf(threadless(slot))).toEqual(["stopped", "warning"]); // a remedy is needed: Start, for a new conversation
  fireEvent.click(threadless(slot));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: DIGEST } }]);
});

test("a session OATS lost: \"Stopped\" in the warning tone, then the reason, by bb's answer for the same row; never a state of its own", async () => {
  const lost = () => facts({ [DIGEST]: { sessionEnd: "lost" } });
  const archived = await sidebar({ rpc: lost(), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(rowFacts(threadless(archived.slot))).toBe("Stopped · archived in bb"));
  expect(markOf(threadless(archived.slot))).toEqual(["stopped", "warning"]);
  resetApp();
  const deleted = await sidebar({ rpc: lost(), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(rowFacts(threadless(deleted.slot))).toBe("Stopped · deleted in bb"));
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
  await waitFor(() => expect(rowFacts(row())).toBe("Running outside OATS"));
  expect(markOf(row())).toEqual(["outside", null]); // no grey "Stopped" dot for an agent that runs
  // No other row is in that state.
  expect(slot.container.querySelectorAll('[data-mark][data-state="outside"]')).toHaveLength(1);
  expect(slot.getByTestId("oats-needs-line").textContent).toBe("!4 need you"); // the sample's three that wait, and this one
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

test("the kernel's report on the open thread: one statement, \"Running outside OATS\"; the notice in a person's words, the kernel's sentence behind Details, and what each act does", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  const warning = await slot.findByTestId("oats-outside-warning");
  // The state, then what OATS recorded and since when, as a fact: never "Stopped" as the state of an agent that runs.
  await waitFor(() => expect(words(slot)).toEqual(["Running outside OATS", expect.stringMatching(/^recorded stopped since /)]));
  const status = within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line");
  expect([status.getAttribute("data-state"), within(status).getByTestId("oats-state").getAttribute("data-tone")]).toEqual(["outside", "warning"]);
  const notice = within(warning).getByTestId("oats-notice");
  expect([notice.getAttribute("data-tone"), notice.querySelector("h3")!.textContent]).toEqual(["warning", "Weekly digest helper is running in bb, but OATS recorded it as stopped."]);
  // What is on screen: a person's words. The kernel's sentence and its code are in the fold, and nothing shown has a backtick or a command.
  const details = within(notice).getByTestId("oats-notice-details");
  expect(details.hasAttribute("open")).toBe(false);
  expect(details.textContent).toBe(`▸Detailsrunning-outside-oats: ${MESSAGE}`);
  const shown = notice.cloneNode(true) as HTMLElement;
  shown.querySelector('[data-testid="oats-notice-details"]')!.remove();
  expect(shown.textContent).toBe(
    "Weekly digest helper is running in bb, but OATS recorded it as stopped.Someone sent it a message in bb. Stop it, or start it from OATS so that OATS tracks it again.Stopstops the harness that runs outside OATSStartstarts it from OATS, in a new conversation",
  );
  expect(shown.textContent).not.toMatch(/`|oats instance/);
  // Each act says what it does here; they are the notice's, and the line carries no second Start.
  expect(within(warning).getAllByTestId("oats-outside-act").map((act) => act.textContent)).toEqual(["Stopstops the harness that runs outside OATS", "Startstarts it from OATS, in a new conversation"]);
  expect(within(status).queryAllByTestId("oats-status-act")).toEqual([]);
  // Start is the lifecycle's own act: its dialog is asked for, and nothing runs on one press.
  fireEvent.click(within(warning).getByRole("button", { name: "Start" }));
  expect(asked()).toEqual({ verb: "start", instance: DIGEST });
  expect(calls(slot, "start")).toEqual([]);
});

test("Stop on the report opens the lifecycle's Stop dialog for that agent", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }, noEvents), sidebarThreads: sidebarThreads() });
  fireEvent.click(within(await slot.findByTestId("oats-outside-warning")).getByRole("button", { name: "Stop" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
});

test("a stopped row with no report (an OATS that does not list the feature answers none) is the roster's own line: nothing is said of it", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, noEvents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
  expect([words(slot)[0], acts(slot)]).toEqual(["Stopped", ["Start"]]);
});

test("failed, on its open thread: \"Failed\", that a message here starts it again, and Restart; no warning", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "shell" } : agent));
  const slot = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: sidebarThreads() });
  await slot.findByTestId("oats-identity-row");
  expect(words(slot)).toEqual(["Failed", "Its session ended. Restart it, or send a message here."]);
  expect(acts(slot)).toEqual(["Restart"]);
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
});

test("the archived thread of a stopped agent has its own row: who it is, \"Stopped\", the fact, and Start", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, noEvents), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("stopped-archived");
  expect(within(row).getByTestId("oats-outside-agent").textContent).toBe("Weekly digest helper");
  expect(words(slot)).toEqual(["Stopped", "Its conversation is archived in bb. Start begins a new one."]);
  // Its acts are on this row: bb's menu of an archived thread has none of the roster's.
  expect(acts(slot)).toEqual(["Start…", "Retire…"]);
  fireEvent.click(within(row).getByRole("button", { name: "Start…" }));
  expect(asked()).toEqual({ verb: "start", instance: DIGEST });
});

test("three agents whose thread bb has archived, side by side: an operator's stop keeps its soul, plain; a lost session and one that still runs say \"archived in bb\" with the warning mark", async () => {
  const HARVEST = "harvest-knowledge-helper";
  const RANKER = "ranker-v3-probe";
  const gone = new Set(["thr_digest", "thr_harvest", "thr_research"]);
  const threads = { status: "ready" as const, threads: fixtureThreads().filter((thread) => !gone.has(thread.id)) };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd: "stopped" } : agent.instance === RANKER ? { ...agent, running: false, runtimeState: "stopped", sessionEnd: "lost", waiting: null } : agent.instance === HARVEST ? { ...agent, running: true, runtimeState: "unknown", waiting: null } : agent));
  const { slot } = await sidebar({ rpc: handlers({}, agents), sidebarThreads: threads, sdk: bb([...gone]).sdk });
  const rowOf = (instance: string) => slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === instance)!;
  await waitFor(() => expect([DIGEST, RANKER, HARVEST].map((instance) => rowOf(instance).getAttribute("data-opens"))).toEqual(["thread", "thread", "thread"]));
  expect([DIGEST, RANKER, HARVEST].map((instance) => [rowFacts(rowOf(instance)), ...markOf(rowOf(instance))])).toEqual([
    ["Stopped · oats-expert", "stopped", null],
    ["Stopped · archived in bb", "stopped", "warning"],
    ["Idle · archived in bb", "idle", "warning"],
  ]);
});

test("the archived thread of an agent that still runs: its state's word in the warning tone, that its process may still run, and Stop, then Retire", async () => {
  const threads = { status: "ready" as const, threads: fixtureThreads().filter((thread) => thread.id !== "thr_harvest") };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: true, runtimeState: "unknown", waiting: null } : agent));
  const slot = await line("thr_harvest", { rpc: handlers(noEvents, agents), sidebarThreads: threads, sdk: bb(["thr_harvest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("running-archived");
  expect(words(slot)).toEqual(["Idle", "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS."]);
  expect(within(within(row).getByTestId("oats-status-line")).getByTestId("oats-state").getAttribute("data-tone")).toBe("warning");
  expect(acts(slot)).toEqual(["Stop", "Retire"]);
  fireEvent.click(within(row).getByRole("button", { name: "Stop" }));
  expect(asked()).toEqual({ verb: "stop", instance: "harvest-knowledge-helper" });
});

test("the archived thread of an agent whose session OATS lost: \"Stopped\" in the warning tone, that its process may still run, and Stop, then Retire", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }, noEvents), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("lost-archived");
  expect(words(slot)).toEqual(["Stopped", "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS."]);
  const status = within(row).getByTestId("oats-status-line");
  expect([status.getAttribute("data-state"), within(status).getByTestId("oats-state").getAttribute("data-tone"), within(status).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))]).toEqual(["stopped", "warning", ["warning"]]);
  // OATS reads it not running; its process may run: Stop is offered, and no Start until it is stopped.
  expect(acts(slot)).toEqual(["Stop", "Retire"]);
  fireEvent.click(within(row).getByRole("button", { name: "Stop" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
});

test("Retire on the archived thread's row opens the lifecycle's Retire dialog for that agent", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, noEvents), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  fireEvent.click(within(await slot.findByTestId("oats-identity-row")).getByRole("button", { name: "Retire…" }));
  expect(asked()).toEqual({ verb: "retire", instance: DIGEST });
});

test("a stopped agent on its open thread: since when, then that a message here starts it again without OATS, and Start", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(words(slot)).toHaveLength(3)); // the time is read from the agent's events, after the state
  expect(words(slot)).toEqual(["Stopped", expect.stringMatching(/^since /), "A message sent here in bb starts it again without OATS. Use Start."]);
  // The line warns: the state's mark and the sentence are in the warning tone; the time beside them is not.
  expect(within(slot.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual([null, "warning"]);
  expect(within(slot.getByTestId("oats-status-line")).getByTestId("oats-state").getAttribute("data-tone")).toBe("warning");
  expect(acts(slot)).toEqual(["Start"]);
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
});

test("bb holds a question on the thread of an agent OATS stopped: \"Needs you\", then what OATS recorded and the warning, with the Start it names", async () => {
  // An answer typed in the thread is the message that starts it without OATS.
  const asking = { status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_digest" ? { ...thread, hasPendingInteraction: true } : thread)) };
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: asking });
  await slot.findByTestId("oats-identity-row");
  expect(words(slot)).toEqual(["!Needs you", "OATS recorded it stopped. A message sent here in bb starts it again without OATS. Use Start."]);
  expect(within(slot.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual(["warning"]);
  expect(acts(slot)).toEqual(["Start"]);
  resetApp();
  // Stopped with the machine: OATS resumes it, and its question is what the line says, as the roster has it.
  const host = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: asking });
  await host.findByTestId("oats-identity-row");
  expect(words(host)).toEqual(["!Needs you", "bb shows its question in this thread"]);
  expect(within(host.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual([null]);
});

test("bb holds a question on the thread of an agent that is not loaded, or that stopped with the machine: the row and the line say \"Needs you\" and the roster's own words, with no reason made for another state and no act of this feature's", async () => {
  const asking = { status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_digest" || thread.id === "thr_harvest" ? { ...thread, hasPendingInteraction: true } : thread)) };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd: "lost" } : agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "unknown" } : agent));
  // The rows: the soul after "Needs you", never "Needs you · with the machine" or "Needs you · not loaded".
  const side = await sidebar({ rpc: handlers({}, agents), sidebarThreads: asking });
  const factsOf = (thread: string) => rowFacts(side.slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === thread)!);
  expect([factsOf("thr_digest"), factsOf("thr_harvest")]).toEqual(["Needs you · oats-expert", "Needs you · knowledge-harvester"]);
  resetApp();
  // The line of the one that is not loaded: bb's question, and no Start (the sentence that says what Start does is not on this line).
  const unloaded = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: asking });
  await unloaded.findByTestId("oats-identity-row");
  expect([words(unloaded), acts(unloaded)]).toEqual([["!Needs you", "bb shows its question in this thread"], []]);
});

test("an agent that is not loaded, on a thread bb says works (a turn runs): the row and the line say \"Working\", with no \"not loaded\" and no Start", async () => {
  // The kernel's `running: false` beside "unknown" says no harness is loaded; bb says a turn runs on the thread. The state is bb's word.
  const active = { status: "ready" as const, threads: fixtureThreads().map((thread) => (thread.id === "thr_harvest" ? { ...thread, status: "active" as const, hasPendingInteraction: false } : thread)) };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "unknown", waiting: null } : agent));
  const side = await sidebar({ rpc: handlers({}, agents), sidebarThreads: active });
  await waitFor(() => expect(rowFacts(side.slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_harvest")!)).toBe("Working · knowledge-harvester"));
  resetApp();
  const unloaded = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: active });
  await unloaded.findByTestId("oats-identity-row");
  await waitFor(() => expect(words(unloaded)[0]).toBe("Working"));
  expect(words(unloaded).join(" ")).not.toMatch(/not loaded|carry on/);
  expect(acts(unloaded)).toEqual([]);
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
/** The agent's page: its state in the header over the tabs, and this feature's block, first on the Instance tab's page. */
const header = (slot: Awaited<ReturnType<typeof agentPage>>) => {
  const head = slot.getByTestId("oats-panel-header");
  const page = slot.getByTestId("oats-panel-page-instance");
  const block = page.firstElementChild?.getAttribute("data-testid") === "oats-outside-agent-block" ? (page.firstElementChild as HTMLElement) : null;
  return {
    state: within(within(head).getByTestId("oats-panel-state")).getByTestId("oats-state").textContent,
    kind: block?.getAttribute("data-outside") ?? null,
    sentence: block?.querySelector(":scope > p")?.textContent ?? null,
    tone: block?.querySelector(":scope > p")?.getAttribute("data-tone") ?? null,
    acts: block === null ? [] : actsIn(block),
    /** The lifecycle's own acts for the agent's state, in the panel's header (`AgentActs`, the panel's). */
    headed: actsIn(within(head).getByTestId("oats-agent-acts")),
    head,
    block,
  };
};

test("an agent whose thread was deleted in bb: its own page says \"Stopped\", what happened, and has the lifecycle's Start and Retire in its header, once", async () => {
  const slot = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(slot).kind).toBe("deleted"));
  expect(header(slot)).toMatchObject({ state: "Stopped", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", tone: "warning", acts: [], headed: ["Start…", "Retire…"] }); // the acts are the header's, once
  fireEvent.click(within(header(slot).head).getByRole("button", { name: "Start…" }));
  expect(asked()).toEqual({ verb: "start", instance: DIGEST });
});

test("an agent whose session OATS lost and whose thread bb archived: its own page has Stop under what happened (the header offers none for an agent that reads stopped), and Retire in the header", async () => {
  const slot = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(slot).kind).toBe("lost-archived"));
  expect(header(slot)).toMatchObject({ state: "Stopped", sentence: "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS.", tone: "warning", acts: ["Stop"], headed: ["Start…", "Retire…"] });
  fireEvent.click(within(header(slot).block!).getByRole("button", { name: "Stop" }));
  expect(asked()).toEqual({ verb: "stop", instance: DIGEST });
});

test("a stopped agent whose thread bb has archived, or deleted: its own page says what happened, with Start and Retire in its header", async () => {
  const archived = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(archived).kind).toBe("stopped-archived"));
  expect(header(archived)).toMatchObject({ state: "Stopped", sentence: "Its conversation is archived in bb. Start begins a new one.", tone: null, acts: [], headed: ["Start…", "Retire…"] }); // a fact, with no remedy needed: not toned
  resetApp();
  const deleted = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(deleted).kind).toBe("deleted"));
  expect(header(deleted)).toMatchObject({ state: "Stopped", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", acts: [], headed: ["Start…", "Retire…"] });
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
  expect(header(runs)).toMatchObject({ acts: [], tone: "warning", sentence: "Its conversation was archived in bb while it ran, and its process may still run. Stop it, then start it from OATS." });
  resetApp();
  // A row that says only where its thread is (failed, its thread archived): no block of this feature's; the acts are the header's.
  const failed = await agentPage(HARVEST, { rpc: handlers({}, fixtureAgents().map((agent): Agent => (agent.instance === HARVEST ? { ...agent, running: false, runtimeState: "shell", waiting: null } : agent))), sidebarThreads: threads, sdk: bb(["thr_harvest"]).sdk });
  await waitFor(() => expect(header(failed).state).toBe("Failed"));
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for a block to be drawn, if one were)
  expect(header(failed)).toMatchObject({ kind: null, acts: [] });
  once(verbs(failed));
  resetApp();
  // It runs outside OATS: the header's Stop, Start and Retire; the notice says what Stop and Start do.
  const outside = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(outside).kind).toBe("outside"));
  expect(verbs(outside)).toEqual(["Stop", "Start", "Retire"]);
});

test("the panel's header of an agent on its thread carries the kernel's report, and nothing else of this feature's", async () => {
  const reported = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(reported).kind).toBe("outside"));
  // The header has the lifecycle's acts; the notice under it says what Stop and Start do, and draws no second button.
  expect(header(reported)).toMatchObject({ state: "Running outside OATS", sentence: null, acts: [], headed: ["Stop…", "Start…", "Retire…"] });
  expect(Array.from(header(reported).block!.querySelectorAll('[data-testid="oats-outside-act"]')).map((act) => act.textContent)).toEqual(["Stopstops the harness that runs outside OATS", "Startstarts it from OATS, in a new conversation"]);
  expect(within(header(reported).block!).getByTestId("oats-notice").querySelector("h3")!.textContent).toBe("Weekly digest helper is running in bb, but OATS recorded it as stopped.");
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
  // The lifecycle's buttons, held with their reason beside them.
  const held = within(await archived.findByTestId("oats-identity-row")).getByTestId("oats-agent-acts");
  expect(Array.from(held.querySelectorAll("button")).map((button) => [button.textContent, button.disabled])).toEqual([["Start…", true], ["Retire…", true]]);
  expect(within(held).getByTestId("oats-disabled-reason").textContent).toBe("Comes back when OATS is read again");
  expect(archived.getByTestId("oats-unreadable").getAttribute("data-compact")).toBe("");
  resetApp();
  const open = await line("thr_digest", { rpc: handlers({ ...noEvents, ...stale(roster({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } })) }), sidebarThreads: sidebarThreads() });
  const buttons = within(await open.findByTestId("oats-outside-warning")).getAllByTestId("oats-status-act") as HTMLButtonElement[];
  expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([["Stop", true], ["Start", true]]);
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
  await waitFor(() => expect(within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line").textContent).toContain("archived in bb while it ran"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The sidebar, the thread's row and the agent's page each read the roster: one request, with one token.
  expect(asked).toEqual([{ threadIds: ["thr_digest"], archived: true, includeHidden: true }]);
});

test("a session OATS lost whose thread bb has archived says the same state word in every place: \"Stopped\", in the sidebar's row, the archived thread's row and the instance panel's header on the agent's own page", async () => {
  const { slot, places } = await everywhere({ [DIGEST]: { sessionEnd: "lost" } }, withoutDigest(), bb(["thr_digest"]).sdk);
  await waitFor(() => expect(within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line").textContent).toContain("archived in bb while it ran"));
  expect(places()).toEqual({ sidebar: "Stopped", thread: "Stopped", panel: "Stopped" });
});

test("an agent the kernel reports running outside OATS says the same state word in every place: \"Running outside OATS\", never \"Stopped\"", async () => {
  const { slot, places } = await everywhere({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }, sidebarThreads(), bb([]).sdk);
  await slot.findByTestId("oats-panel-header");
  await waitFor(() => expect(places()).toEqual({ sidebar: "Running outside OATS", thread: "Running outside OATS", panel: "Running outside OATS" }));
  for (const place of [slot.getByTestId("oats-identity-row"), slot.getByTestId("oats-panel-state")]) expect(place.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("outside");
});
