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

// ---- the sidebar's row

test("stopped, its thread archived in bb: the row says so, never \"its bb thread is gone\", and opens the archived conversation", async () => {
  const { asked, sdk } = bb(["thr_digest"]);
  const { slot, navigated } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk });
  await waitFor(() => expect(rowFacts(threadless(slot))).toBe("Stopped · oats-expert · its conversation is archived in bb"));
  expect(threadless(slot).querySelector("[data-mark]")!.getAttribute("data-state")).toBe("stopped");
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
  await waitFor(() => expect(rowFacts(threadless(slot))).toBe("Stopped · oats-expert · its conversation was deleted in bb"));
  fireEvent.click(threadless(slot));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: DIGEST } }]);
});

test("a session OATS lost: \"Archived in bb\" or \"Deleted in bb\" in the state's place, by bb's answer for the same row", async () => {
  const lost = () => facts({ [DIGEST]: { sessionEnd: "lost" } });
  const archived = await sidebar({ rpc: lost(), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(rowFacts(threadless(archived.slot))).toBe("Archived in bb · oats-expert · OATS lost its session"));
  expect(threadless(archived.slot).querySelector("[data-mark]")!.getAttribute("data-state")).toBe("archived");
  resetApp();
  const deleted = await sidebar({ rpc: lost(), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(rowFacts(threadless(deleted.slot))).toBe("Deleted in bb · oats-expert · its conversation is gone"));
  expect(threadless(deleted.slot).querySelector("[data-mark]")!.getAttribute("data-state")).toBe("deleted");
});

test("while bb has not said, or cannot say, where the thread is, the row claims nothing of it", async () => {
  const sdk = { threads: { list: async () => Promise.reject(new Error("bb is away")) } } as never as RenderSlotOptions<Contract>["sdk"];
  const { slot } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(rowFacts(threadless(slot))).toBe("Stopped · oats-expert");
});

test("the kernel's report on a row whose thread is open: the words after its soul and the warning mark, under the state OATS recorded", async () => {
  const { slot } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  const row = () => slot.getAllByTestId("oats-agent-row").find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === "thr_digest")!;
  await waitFor(() => expect(rowFacts(row())).toBe("Stopped · oats-expert · running outside OATS"));
  const mark = within(row()).getByTestId("oats-outside-mark");
  expect([mark.getAttribute("role"), mark.getAttribute("aria-label")]).toEqual(["img", "Running outside OATS"]);
  // No other row has it.
  expect(slot.getAllByTestId("oats-outside-mark")).toHaveLength(1);
});

test("an agent the kernel reports running outside OATS is counted at the roster's foot among those that need a person", async () => {
  const { slot } = await sidebar({ rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(slot.getByTestId("oats-needs-line").textContent).toBe("!4 need you")); // the sample's three that wait, and this one
});

test("with nothing reported, the rows are the roster's own: no note, no mark, and bb is asked nothing", async () => {
  const { asked, sdk } = bb([]);
  const { slot } = await sidebar({ rpc: handlers(), sidebarThreads: sidebarThreads(), sdk });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(slot.queryByTestId("oats-outside-mark")).toBeNull();
  expect(slot.getAllByTestId("oats-row-facts").map((line) => line.textContent)).toContain("Stopped · oats-expert");
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
const acts = (slot: Awaited<ReturnType<typeof line>>, within_ = "oats-identity-row") => within(slot.getByTestId(within_)).queryAllByTestId("oats-status-act").map((button) => button.textContent);
const calls = (slot: Awaited<ReturnType<typeof line>>, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
const noEvents: Partial<Handlers> = { panelEvents: () => ({ events: [] }) as never };

test("the kernel's report on the open thread: the line keeps the state OATS recorded, and under it the message, loudly, with Stop and Start", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }, { ...noEvents, start: () => ({ threadId: "thr_new" }) }), sidebarThreads: sidebarThreads() });
  const warning = await slot.findByTestId("oats-outside-warning");
  expect(words(slot)[0]).toBe("Stopped");
  const notice = within(warning).getByTestId("oats-notice");
  expect([notice.getAttribute("data-tone"), notice.querySelector("h3")!.textContent]).toEqual(["warning", "Running outside OATS"]);
  expect(notice.textContent).toContain(MESSAGE);
  expect(notice.textContent).toContain("running-outside-oats");
  // The two acts are the notice's; the line carries no second Start.
  expect(within(warning).getAllByTestId("oats-status-act").map((button) => button.textContent)).toEqual(["Stop", "Start"]);
  expect(within(slot.getByTestId("oats-status-line")).queryAllByTestId("oats-status-act")).toEqual([]);
  fireEvent.click(within(warning).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(calls(slot, "start")).toEqual([{ instance: DIGEST }]));
});

test("Stop on the report asks OATS for the plan of that agent", async () => {
  const stopPlan = vi.fn(() => ({ revision: "r1", lines: ["stop weekly-digest-helper"], instance: DIGEST }));
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }, { ...noEvents, stopPlan }), sidebarThreads: sidebarThreads() });
  fireEvent.click(within(await slot.findByTestId("oats-outside-warning")).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(calls(slot, "stopPlan")).toEqual([{ instance: DIGEST }]));
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
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, { ...noEvents, start: () => ({ threadId: "thr_new" }) }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("stopped-archived");
  expect(within(row).getByTestId("oats-outside-agent").textContent).toBe("Weekly digest helper");
  expect(words(slot)).toEqual(["Stopped", "Its conversation is archived in bb"]);
  // Its acts are on this row: bb's menu of an archived thread has none of the roster's.
  expect(acts(slot)).toEqual(["Start", "Retire"]);
  fireEvent.click(within(row).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(calls(slot, "start")).toEqual([{ instance: DIGEST }]));
});

test("the archived thread of an agent whose session OATS lost: \"Archived in bb\", that its process still runs, and Stop", async () => {
  const stopPlan = vi.fn(() => ({ revision: "r1", lines: ["stop weekly-digest-helper"], instance: DIGEST }));
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }, { stopPlan }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  const row = await slot.findByTestId("oats-identity-row");
  expect(row.getAttribute("data-outside")).toBe("lost-archived");
  expect(words(slot)).toEqual(["Archived in bb", "OATS lost its session, and its process still runs. Stop it, then start it from OATS."]);
  expect(within(row).getByTestId("oats-status-line").getAttribute("data-state")).toBe("archived");
  expect(acts(slot)).toEqual(["Stop", "Retire"]);
  fireEvent.click(within(row).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(calls(slot, "stopPlan")).toEqual([{ instance: DIGEST }]));
});

test("Retire on the archived thread's row asks OATS for the retire plan of that agent", async () => {
  const retirePlan = vi.fn(() => ({ revision: "r1", lines: ["Removed: the home of weekly-digest-helper"], instance: DIGEST }));
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }, { ...noEvents, retirePlan }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  fireEvent.click(within(await slot.findByTestId("oats-identity-row")).getByRole("button", { name: "Retire" }));
  await waitFor(() => expect(calls(slot, "retirePlan")).toEqual([{ instance: DIGEST }]));
});

test("a stopped agent on its open thread: since when, then that a message here starts it again without OATS, and Start", async () => {
  const slot = await line("thr_digest", { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(words(slot)).toHaveLength(3)); // the time is read from the agent's events, after the state
  expect(words(slot)).toEqual(["Stopped", expect.stringMatching(/^since /), "A message sent here in bb starts it again without OATS. Use Start."]);
  // The sentence warns, and is drawn as a warning: the time beside it is not.
  expect(within(slot.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual([null, "warning"]);
  expect(acts(slot)).toEqual(["Start"]);
  expect(slot.queryByTestId("oats-outside-warning")).toBeNull();
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
const header = (slot: Awaited<ReturnType<typeof agentPage>>) => {
  const head = slot.getByTestId("oats-panel-header");
  const block = within(head).queryByTestId("oats-outside-agent-block");
  return {
    state: within(within(head).getByTestId("oats-panel-state")).getByTestId("oats-state").textContent,
    kind: block?.getAttribute("data-outside") ?? null,
    sentence: block?.querySelector(":scope > p")?.textContent ?? null,
    acts: block === null ? [] : within(block).queryAllByTestId("oats-status-act").map((button) => button.textContent),
    block,
  };
};

test("an agent whose thread was deleted in bb: its own page says \"Deleted in bb\", what happened, and has Start and Retire", async () => {
  const start = vi.fn(() => ({ threadId: "thr_new" }));
  const slot = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }, { start }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(slot).state).toBe("Deleted in bb"));
  expect(header(slot)).toMatchObject({ kind: "lost-deleted", sentence: "Its conversation is gone. Start it from OATS for a new one.", acts: ["Start", "Retire"] });
  fireEvent.click(within(header(slot).block!).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(calls(slot, "start")).toEqual([{ instance: DIGEST }]));
});

test("a stopped agent whose thread bb has archived, or deleted: its own page says what happened, with Start and Retire", async () => {
  const archived = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk });
  await waitFor(() => expect(header(archived).kind).toBe("stopped-archived"));
  expect(header(archived)).toMatchObject({ state: "Stopped", sentence: "Its conversation is archived in bb", acts: ["Start", "Retire"] });
  resetApp();
  const deleted = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: withoutDigest(), sdk: bb([]).sdk });
  await waitFor(() => expect(header(deleted).kind).toBe("stopped-deleted"));
  expect(header(deleted)).toMatchObject({ state: "Stopped", sentence: "Its conversation was deleted in bb. Start it from OATS for a new one.", acts: ["Start", "Retire"] });
});

test("the panel's header of an agent on its thread carries the kernel's report, and nothing else of this feature's", async () => {
  const reported = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } }), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(header(reported).kind).toBe("outside"));
  expect(header(reported)).toMatchObject({ state: "Stopped", sentence: null, acts: ["Stop", "Start"] }); // the notice's own two
  expect(within(header(reported).block!).getByTestId("oats-notice").textContent).toContain(MESSAGE);
  resetApp();
  const plain = await agentPage(DIGEST, { rpc: facts({ [DIGEST]: { sessionEnd: "stopped" } }), sidebarThreads: sidebarThreads() });
  await new Promise((resolve) => setTimeout(resolve, 20));
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
  const start = within(await archived.findByTestId("oats-identity-row")).getByRole("button", { name: "Start" }) as HTMLButtonElement;
  expect((within(archived.getByTestId("oats-identity-row")).getByRole("button", { name: "Retire" }) as HTMLButtonElement).disabled).toBe(true);
  expect([start.disabled, start.title]).toEqual([true, "Comes back when OATS is read again"]);
  expect(archived.getByTestId("oats-unreadable").getAttribute("data-compact")).toBe("");
  resetApp();
  const open = await line("thr_digest", { rpc: handlers({ ...noEvents, ...stale(roster({ [DIGEST]: { sessionEnd: "stopped", outsideOats: REPORT } })) }), sidebarThreads: sidebarThreads() });
  const buttons = within(await open.findByTestId("oats-outside-warning")).getAllByTestId("oats-status-act") as HTMLButtonElement[];
  expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([["Stop", true], ["Start", true]]);
});

// ---- one state, everywhere

test("a session OATS lost whose thread bb has archived says the same word in every place: the sidebar's row, the archived thread's row, and the instance panel's header on the agent's own page", async () => {
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
    { rpc: facts({ [DIGEST]: { sessionEnd: "lost" } }), sidebarThreads: withoutDigest(), sdk: bb(["thr_digest"]).sdk },
  );
  const places = () => ({
    sidebar: rowFacts(threadless(slot)).split(" · ")[0],
    thread: within(within(slot.getByTestId("oats-identity-row")).getByTestId("oats-status-line")).getByTestId("oats-state").textContent,
    panel: within(within(slot.getByTestId("oats-panel-header")).getByTestId("oats-panel-state")).getByTestId("oats-state").textContent,
  });
  await waitFor(() => expect(places()).toEqual({ sidebar: "Archived in bb", thread: "Archived in bb", panel: "Archived in bb" }));
  // And each mark is that state's.
  for (const place of [threadless(slot), slot.getByTestId("oats-identity-row"), slot.getByTestId("oats-panel-state")]) expect(place.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("archived");
});

test("stopped with the machine, and not loaded: each says so on its row and on its line, with no warning tone", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === DIGEST ? { ...agent, sessionEnd: "lost" } : agent.instance === "harvest-knowledge-helper" ? { ...agent, running: false, runtimeState: "unknown" } : agent));
  const side = await sidebar({ rpc: handlers({}, agents), sidebarThreads: sidebarThreads() });
  const factsOf = (thread: string) => rowFacts(side.slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === thread)!);
  expect([factsOf("thr_digest"), factsOf("thr_harvest")]).toEqual(["Stopped · oats-expert · with the machine", "Idle · knowledge-harvester · not loaded"]);
  expect(side.slot.queryByTestId("oats-outside-mark")).toBeNull();
  resetApp();
  const host = await line("thr_digest", { rpc: handlers(noEvents, agents), sidebarThreads: sidebarThreads() });
  await host.findByTestId("oats-identity-row");
  expect([words(host), acts(host)]).toEqual([["Stopped", "with the machine. OATS starts it again when the machine is back."], ["Start"]]);
  expect(within(host.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual([null]);
  resetApp();
  const idle = await line("thr_harvest", { rpc: handlers({}, agents), sidebarThreads: sidebarThreads() });
  await idle.findByTestId("oats-identity-row");
  expect([words(idle), acts(idle)]).toEqual([["Idle", "not loaded. To carry on, send it a message here. Start begins a new conversation."], ["Start"]]);
  expect(idle.getByTestId("oats-status-line").getAttribute("data-state")).toBe("idle");
  expect(within(idle.getByTestId("oats-status-line")).getAllByTestId("oats-status-part").map((part) => part.getAttribute("data-tone"))).toEqual([null]);
});
