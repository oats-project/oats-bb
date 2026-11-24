// @vitest-environment jsdom
// The instance panel's frame, its Instance tab and its Soul tab's frame (parity rows D-124 to
// D-129, D-131, D-136 to D-138), drawn from the roster recorded from the real kernel.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { InstancePanel, showPanelTab } from "../../app/panel/Panel";
import { attachCommand } from "../../app/panel/words";
import type { PanelInstance } from "../../kernel/panel-instance";
import type { Agent } from "../../model/types";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "./handlers";
import { waitingClock } from "../../app/ui/words";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const CHILD = "panel-worktree-helper";
const CHILD_THREAD = "thr_u2jw8887aw";
/** A quarter of an hour after the recorded agent's board asked its question (18:00:58Z). */
const NOW = Date.parse("2026-11-23T18:16:56.000Z");

type Change = { agent?: (agent: Agent) => Agent; facts?: (facts: PanelInstance) => PanelInstance; /** bb says a turn runs on the agent's thread */ works?: boolean };
function panel(props: { threadId?: string; instance?: string } = { threadId: CHILD_THREAD }, change: Change = {}, options: RenderSlotOptions<Contract> = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const agents = panelAgents().map((agent) => (agent.instance === CHILD && change.agent ? change.agent(agent) : agent));
  return renderSlot<{ threadId?: string; instance?: string }, Contract>({ component: InstancePanel }, props, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, instance === CHILD ? change.facts : undefined) }),
    sidebarThreads: panelThreads(agents, change.works ? [CHILD] : []),
    ...options,
  });
}
const text = (element: HTMLElement) => element.textContent;
/** The Copy button of a path: the one after it. */
const copyOf = (path: HTMLElement) => within(path.parentElement!).getByTestId("oats-copy");
/** The state the header says, as a screen reader reads it: its word, and after it since when (the mark beside the word is hidden from it). */
function stateOf(slot: { getByTestId(id: string): HTMLElement }): string {
  const line = within(slot.getByTestId("oats-panel-state")).getByTestId("oats-status-line").cloneNode(true) as HTMLElement;
  line.querySelectorAll('[aria-hidden="true"]').forEach((mark) => mark.remove());
  return line.textContent ?? "";
}

test("two tabs, Instance first; the header names the instance as words, its soul, and its state as a mark and its word", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null }) });
  await slot.findByTestId("oats-panel-work");
  const tabs = within(slot.getByRole("tablist", { name: "Instance context" })).getAllByRole("tab");
  expect(tabs.map((tab) => `${text(tab)} ${tab.getAttribute("aria-selected")}`)).toEqual(["Instance true", "Soul false"]);
  expect(slot.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
  expect(tabs[0]!.getAttribute("aria-controls")).toBe(slot.getByRole("tabpanel").id);
  // The name as words; the kernel's own name stays one hover away.
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(slot.getByTestId("oats-panel-name").getAttribute("title")).toBe(CHILD);
  // Its soul, by its name alone (no "instance of"): the name is the way to the Soul tab.
  expect(text(slot.getByTestId("oats-panel-header"))).toBe("PWPanel worktree helperIdleStop…Restart…Retire…oats-expert");
  expect(text(slot.getByTestId("oats-panel-soul-link"))).toBe("oats-expert");
  expect(slot.getByTestId("oats-panel-soul-link").tagName).toBe("BUTTON");
  // The kernel says the recorded agent's harness is loaded (`running: true`) and bb says its thread is at rest: Idle, the tree's word. What bb says of the thread decides, not `running`.
  expect(stateOf(slot)).toBe("Idle");
  expect(within(slot.getByTestId("oats-panel-state")).getByTestId("oats-state").getAttribute("data-state")).toBe("idle");
  expect(slot.queryByTestId("oats-panel-drift")).toBeNull();
  expect(slot.queryByTestId("oats-panel-waiting")).toBeNull();
});

test("a running agent says Working, as the tree and the thread do, and since when it runs is a fact of its session; a stopped one says Stopped, when it stopped is a fact of its session too, and it shows no claim", async () => {
  const running = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: true, waiting: null }), works: true });
  await running.findByTestId("oats-panel-work");
  // The header says the state alone: no time after it.
  expect(stateOf(running)).toBe("Working");
  expect(running.queryByTestId("oats-panel-stopped")).toBeNull();
  await act(async () => {});
  expect(running.inspection.rpcCalls.some((call) => call.method === "panelEvents")).toBe(false); // an agent that runs asks for no events
  // started 18:00:56Z, read at 18:16:56Z: a labelled fact of the session
  expect(text(running.getByTestId("oats-panel-started").closest('[data-testid="oats-fact"]')!)).toBe("Started16 min ago");
  running.unmount();
  const stopped = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: false, runtimeState: "stopped" }) });
  await stopped.findByTestId("oats-panel-work");
  expect(stateOf(stopped)).toBe("Stopped");
  // It does not run since then: "Last started", not "Started".
  expect(text(stopped.getByTestId("oats-panel-started").closest('[data-testid="oats-fact"]')!)).toBe("Last started16 min ago");
  // When OATS stopped it: the time of its last recorded "stopped" (18:23:24Z in the recording), one
  // row of its Session. It is on no line and no row elsewhere: this is where it is said.
  await waitFor(() => expect(text(stopped.getByTestId("oats-panel-stopped").closest('[data-testid="oats-fact"]')!)).toBe(`Stopped${waitingClock("2026-11-23T18:01:33.424Z", NOW)}`));
  expect(stopped.inspection.rpcCalls.filter((call) => call.method === "panelEvents").map((call) => call.input)).toEqual([{ instance: CHILD }]);
  // A stopped agent's claim belongs to an ended session: it is not shown.
  expect(stopped.queryByTestId("oats-panel-waiting")).toBeNull();
});

// One gate for a claim (model/view.ts `claimOf`), the same for the sidebar, the thread's row and
// this panel: a session that ended in a shell, or that the kernel cannot reach, keeps "a claim
// wins" (the spec's author's rule), so the panel says Needs you where the tree does.
test("a failed or unreachable agent that still carries a claim says Needs you and shows it, as its row in the tree does", async () => {
  for (const change of [{ running: false, runtimeState: "shell" }, { running: null, runtimeState: "unreachable" }] as const) {
    const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, ...change }) });
    await slot.findByTestId("oats-panel-work");
    expect(stateOf(slot), JSON.stringify(change)).toBe("Needs you· 15 min");
    expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("How should I merge the pull request?");
    slot.unmount();
  }
});

test("what the agent asks stands first on the page, under no heading; how long it has waited is the header's, once", async () => {
  const slot = panel();
  const waiting = await slot.findByTestId("oats-panel-waiting");
  // The clock as the words module says it here: with the date where local midnight falls inside the wait.
  const clock = waitingClock("2026-11-23T18:00:58.993Z", NOW);
  // No heading "Needs input" (the header two lines up says "Needs you"), and no sentence for the
  // reason where the agent's own message says what it needs. The block keeps its name for a screen reader.
  expect(within(waiting).queryByRole("heading")).toBeNull();
  expect(waiting.getAttribute("aria-label")).toBe("Needs input");
  expect(slot.queryByTestId("oats-panel-waiting-head")).toBeNull();
  expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("How should I merge the pull request?");
  expect(text(waiting)).toBe("How should I merge the pull request?"); // what it asks, alone: the age is the header's, once
  expect(text(slot.getByTestId("oats-panel-page-instance"))).not.toContain(`since ${clock}`); // since when, by the clock, is not said twice: the Activity's row holds the claim's instant
  expect(slot.getByTestId("oats-panel-page-instance").firstElementChild).toBe(waiting); // first on the page
  expect(stateOf(slot)).toBe("Needs you· 15 min");
});

test("a claim with no message says the reason in a word where it says what is needed, else nothing; its message is drawn as text through the display filter", async () => {
  const bare = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: { reason: "permission", message: null, since: "2026-11-23T18:15:26.000Z" } }) });
  expect(text(await bare.findByTestId("oats-panel-waiting-head"))).toBe("approval");
  expect(stateOf(bare)).toBe("Needs you· 1 min"); // what it waits for is said once, with the question's place: the header says how long
  expect(bare.queryByTestId("oats-panel-waiting-message")).toBeNull();
  bare.unmount();
  const unsafe = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: { reason: "question", message: "use token=abc123 <b>now</b>", since: null } }) });
  expect(text(await unsafe.findByTestId("oats-panel-waiting-message"))).toBe("[withheld]");
  // No instant from the kernel: no invented time. A question's reason says nothing "Needs you" does not: no word for it.
  expect(unsafe.queryByTestId("oats-panel-waiting-head")).toBeNull();
  expect(unsafe.getByTestId("oats-panel-state").getAttribute("title")).toBeNull();
  expect(text(unsafe.getByTestId("oats-panel-waiting"))).toBe("[withheld]");
});

test("Work: the mode as a fact with the row's own fact, and behind the one fold the paths to copy, the session's id and where the model came from", async () => {
  const writes: string[] = [];
  vi.stubGlobal("navigator", { clipboard: { writeText: async (value: string) => void writes.push(value) } });
  const slot = panel();
  const work = await slot.findByTestId("oats-panel-work");
  expect(text(within(work).getByRole("heading"))).toBe("Work");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toBe("worktree · agents/panel-worktree-helper");
  expect(slot.getByTestId("oats-panel-work-sentence").querySelector("code")!.textContent).toBe("agents/panel-worktree-helper");
  const paths = slot.getByTestId("oats-panel-paths");
  expect(text(paths.querySelector("summary")!)).toContain("Paths");
  expect(paths.hasAttribute("open")).toBe(false);
  // What is wanted and not needed, one press away, in the panel's one fold for it: the folder and the
  // home, then the session's own id and where the model came from (they left the Session card's face).
  expect(within(paths).getAllByTestId("oats-fact").map((fact) => text(fact.querySelector("dt")!))).toEqual(["Folder", "Home", "bb thread", "Model"]);
  expect(text(within(paths).getByTestId("oats-panel-session-id"))).toBe("thr_u2jw8887aw");
  expect(within(paths).getByTestId("oats-panel-session-id").className).toContain("whitespace-nowrap"); // a code, never broken inside
  expect(text(within(paths).getByTestId("oats-panel-model-from"))).toBe("the soul's choice");
  expect(work.querySelectorAll("details")).toHaveLength(1); // one fold in the block
  expect(text(slot.getByTestId("oats-panel-folder"))).toBe("/abs/deployment/agents/oats-expert/instances/panel-worktree-helper/work");
  expect(text(slot.getByTestId("oats-panel-home"))).toBe("/abs/deployment/agents/oats-expert/instances/panel-worktree-helper");
  // its own worktree is not a shared tree
  expect(text(paths)).not.toContain("shared");
  const copyFolder = copyOf(slot.getByTestId("oats-panel-folder"));
  expect([text(copyFolder), copyFolder.getAttribute("aria-label")]).toEqual(["Copy", "Copy folder path"]);
  fireEvent.click(copyFolder);
  await waitFor(() => expect(text(copyFolder)).toBe("Copied"));
  expect(copyOf(slot.getByTestId("oats-panel-home")).getAttribute("aria-label")).toBe("Copy home path");
  fireEvent.click(copyOf(slot.getByTestId("oats-panel-home")));
  await waitFor(() => expect(writes).toEqual(["/abs/deployment/agents/oats-expert/instances/panel-worktree-helper/work", "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper"]));
});

test("a shared tree is tagged shared; a copy the browser refuses says so; a mode the row does not report draws no Work card", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
  const shared = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, work: "attached" }) });
  expect(text(await shared.findByTestId("oats-panel-work-sentence"))).toBe("redesign-ui-lead's tree");
  const tag = within(shared.getByTestId("oats-panel-paths")).getByRole("note");
  expect(text(tag)).toBe("shared");
  expect(tag.getAttribute("aria-label")).toBe("shared: A link to the shared tree; changes here are visible to every instance that shares it.");
  const copy = copyOf(shared.getByTestId("oats-panel-home"));
  fireEvent.click(copy);
  await waitFor(() => expect(text(copy)).toBe("Copy failed"));
  shared.unmount();
  const none = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, work: null }) });
  const session = await none.findByTestId("oats-panel-session");
  expect(none.queryByTestId("oats-panel-work")).toBeNull();
  // With no Work card the one fold is the Session card's, and holds what left the card's face.
  const fold = within(session).getByTestId("oats-panel-paths");
  expect([text(fold.querySelector("summary")!), (fold as HTMLDetailsElement).open]).toEqual(["▸Paths", false]);
  expect(within(fold).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`)).toEqual(["bb thread: thr_u2jw8887aw", "Model: the soul's choice"]);
  expect(none.getAllByTestId("oats-panel-paths")).toHaveLength(1);
});

test("Session: the harness, the model, where the session runs in a word and since when, each a labelled fact; the id and where the model came from are not on its face", async () => {
  const slot = panel();
  const session = await slot.findByTestId("oats-panel-session");
  expect(text(within(session).getByRole("heading"))).toBe("Session");
  expect(within(session).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`)).toEqual([
    "Harness: Claude", "Model: claude-opus-5-5", "Runs in: bb thread", "Started: 16 min ago",
  ]);
  expect(text(session)).not.toMatch(/thr_u2jw8887aw|the soul's choice/);
  expect(session.querySelector("details")).toBeNull(); // the fold is the Work card's: none here
  expect(slot.getByTestId("oats-panel-started").getAttribute("title")).toBe("2026-11-23T18:00:56.149Z · created 2026-11-23T18:00:56.149Z");
  expect(slot.queryByTestId("oats-panel-runtime-error")).toBeNull();
});

test("a home never started says when it was created; the row's runtime error is one press away, with who said it", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, startedAt: null, model: null, runtimeError: "bb did not answer at http://127.0.0.1:38886" }) });
  const session = await slot.findByTestId("oats-panel-session");
  expect(within(session).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`)).toEqual([
    "Harness: Claude", "Runs in: bb thread", "Created: 16 min ago",
  ]);
  // What OATS says of the session is under the panel's one fold, closed, after the paths and the id (no model: no line on where one came from).
  const paths = slot.getByTestId("oats-panel-paths");
  expect((paths as HTMLDetailsElement).open).toBe(false);
  expect(within(paths).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`).slice(2)).toEqual([
    "bb thread: thr_u2jw8887aw", "OATS says: bb did not answer at http://127.0.0.1:38886",
  ]);
  expect(text(slot.getByTestId("oats-panel-session-line"))).toBe("bb thread");
});

test("the messaging id with its copy, only where the row has one: a fact of Lineage, under its fold and under no heading of its own", async () => {
  const without = panel();
  await without.findByTestId("oats-panel-session");
  expect(without.queryByTestId("oats-panel-messaging-id")).toBeNull();
  without.unmount();
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, messagingId: "oats.aweb.ai/panel-worktree-helper" }) });
  const lineage = await slot.findByTestId("oats-panel-lineage");
  // No heading "Messaging & Teams" over one fact: it stands last under Lineage.
  expect(slot.queryByTestId("oats-panel-messaging")).toBeNull();
  expect(text(slot.getByTestId("oats-panel"))).not.toContain("Messaging & Teams");
  expect(within(lineage).getAllByTestId("oats-fact").map((fact) => text(fact.querySelector("dt")!))).toEqual(["Parent", "Messaging ID"]);
  // Not on the page's face: under Lineage's own fold, closed until it is asked for.
  const fold = within(lineage).getByTestId("oats-panel-lineage-details");
  expect([fold.tagName, fold.hasAttribute("open"), text(fold.querySelector("summary")!)]).toEqual(["DETAILS", false, "▸Details"]);
  expect(fold.contains(slot.getByTestId("oats-panel-messaging-id"))).toBe(true);
  expect(fold.contains(slot.getByTestId("oats-panel-parent"))).toBe(false);
  expect(text(slot.getByTestId("oats-panel-messaging-id"))).toBe("oats.aweb.ai/panel-worktree-helper");
  expect(copyOf(slot.getByTestId("oats-panel-messaging-id")).getAttribute("aria-label")).toBe("Copy messaging ID");
});

test("Lineage: the parent is a link to its thread; a sibling is named where the row has one, and the owning human under the fold", async () => {
  const slot = panel();
  const lineage = await slot.findByTestId("oats-panel-lineage");
  // another agent by its name as words, as every place names one; the kernel's own name is the title
  expect(text(lineage)).toBe("LineageParentRedesign ui lead");
  expect(slot.getByTestId("oats-panel-parent").getAttribute("title")).toBe("redesign-ui-lead");
  const parent = slot.getByTestId("oats-panel-parent");
  expect(parent.tagName).toBe("A");
  fireEvent.click(parent);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: panelAgents().find((agent) => agent.instance === "redesign-ui-lead")!.threadId }]);
  slot.unmount();
  const more = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, human: "Ana", parent: null, sibling: "kernel-fix-developer" }) });
  // The agents it is related to are on the page's face; who owns it is under the fold.
  expect(text(await more.findByTestId("oats-panel-lineage"))).toBe("LineageSiblingKernel fix developer▸DetailsOwning humanAna");
  const owner = more.getByTestId("oats-panel-lineage-details");
  expect([owner.hasAttribute("open"), owner.contains(more.getByTestId("oats-panel-human")), owner.contains(more.getByTestId("oats-panel-sibling"))]).toEqual([false, true, false]);
  // an instance that has no thread in bb is named, without a link
  expect(more.getByTestId("oats-panel-sibling").tagName).toBe("SPAN");
});

test("an agent with nothing to say about its lineage has no Lineage section", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, parent: null }) });
  await slot.findByTestId("oats-panel-session");
  expect(slot.queryByTestId("oats-panel-lineage")).toBeNull();
  slot.unmount();
  // One with an owner and no relative: the section, with its fold alone.
  const owned = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, parent: null, human: "Ana" }) });
  expect(text(await owned.findByTestId("oats-panel-lineage"))).toBe("Lineage▸DetailsOwning humanAna");
});

test("older build: a chip that opens to what moved since the spawn", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, drift: { soul: "moved", modules: [{ name: "oats.core", status: "moved", was: "1.26.0", now: "1.27.0", reason: null }] } }) });
  const drift = await slot.findByTestId("oats-panel-drift");
  expect(text(drift.querySelector("summary")!)).toContain("older build");
  expect(text(drift)).toContain("Built from an older state of the workspace:");
  expect(text(drift)).toContain("• Its soul's repository has moved on since it was spawned.");
  expect(text(drift)).toContain("• oats.core has changed since (1.26.0 → 1.27.0).");
  expect(text(drift)).toContain("Re-spawning picks up the new state; this instance keeps what it was built with.");
});

test("the soul's name opens the Soul tab: its name, its description and Open soul page; no lone Details at its foot", async () => {
  const slot = panel();
  const link = await slot.findByTestId("oats-panel-soul-link");
  link.focus();
  fireEvent.click(link);
  expect(slot.getByTestId("oats-tab-soul").getAttribute("aria-selected")).toBe("true");
  // The link leaves with its page: the focus goes to the tab it opened, never to the body.
  await waitFor(() => expect(document.activeElement).toBe(slot.getByTestId("oats-tab-soul")));
  expect(text(await slot.findByTestId("oats-panel-soul-name"))).toBe("oats-expert");
  expect(text(slot.getByTestId("oats-panel-soul-description"))).toBe("OATS expert: answers questions about OATS.");
  // The soul author's own text, as long as they wrote it: two lines at most here, whole in its title (and on the soul's page).
  expect(slot.getByTestId("oats-panel-soul-description").className).toContain("line-clamp-2");
  expect(slot.getByTestId("oats-panel-soul-description").getAttribute("title")).toBe("OATS expert: answers questions about OATS.");
  // No fold of one fact at the tab's foot, with nothing saying of what: the agents root is said under what it
  // explains, in Readiness's fold ("Soul: oats-expert · /abs/deployment/agents": test/panel/soul-activity-readiness.test.tsx).
  expect(slot.queryByTestId("oats-panel-details")).toBeNull();
  expect(slot.queryByTestId("oats-panel-agents-root")).toBeNull();
  const page = slot.getByTestId("oats-panel-page-soul");
  expect(Array.from(page.querySelectorAll("details > summary")).map((summary) => summary.textContent).filter((summary) => summary === "▸Details")).toEqual([]);
  expect(text(page)).not.toContain("Agents root");
  const open = slot.getByTestId("oats-panel-open-soul");
  expect(text(open)).toBe("Open soul page");
  expect(slot.queryByTestId("oats-panel-open-soul-why")).toBeNull();
  fireEvent.click(open);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls", options: { subPath: "oats-expert" } }]);
});

test("a soul OATS does not list has no page to open, and the reason is beside the button", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, {}, { rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => ({ ...instanceAnswer(instance), agentsRoot: null, soul: { key: null, description: null } }) }) });
  fireEvent.click(await slot.findByTestId("oats-tab-soul"));
  expect(text(await slot.findByTestId("oats-panel-open-soul-why"))).toBe("OATS lists no soul of this name here, so there is no soul page to open.");
  expect((slot.getByTestId("oats-panel-open-soul") as HTMLButtonElement).disabled).toBe(true);
  expect(slot.queryByTestId("oats-panel-details")).toBeNull();
  expect(slot.queryByTestId("oats-panel-soul-description")).toBeNull();
});

test("the arrow keys move between the tabs, and the tab a person left the panel on is the one another agent opens on", async () => {
  const slot = panel();
  const instanceTab = await slot.findByTestId("oats-tab-instance");
  fireEvent.keyDown(instanceTab, { key: "ArrowRight" });
  expect(slot.getByTestId("oats-tab-soul").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(slot.getByTestId("oats-tab-soul"));
  expect(slot.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(slot.getByTestId("oats-tab-soul").id);
  slot.unmount();
  const other = panel({ instance: "redesign-ui-lead" });
  expect((await other.findByTestId("oats-tab-soul")).getAttribute("aria-selected")).toBe("true");
  expect(text(await other.findByTestId("oats-panel-soul-name"))).toBe("oats-product-expert");
});

test("another feature turns an open panel to one of its tabs", async () => {
  const slot = panel();
  await slot.findByTestId("oats-panel-work");
  act(() => showPanelTab("soul"));
  expect(slot.getByTestId("oats-tab-soul").getAttribute("aria-selected")).toBe("true");
  expect(text(await slot.findByTestId("oats-panel-soul-name"))).toBe("oats-expert");
});

test("by instance name, for an agent with no thread in bb: the same panel, its state from the kernel's word", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, running: true, waiting: null } : agent));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, backend: "tmux", threadId: null, tmuxSession: "oats-agents" })) }),
    sidebarThreads: panelThreads(agents),
  });
  expect(text(await slot.findByTestId("oats-panel-session-line"))).toBe("tmux session");
  expect(text(slot.getByTestId("oats-panel-session-id"))).toBe("oats-agents"); // the session's own name, under Paths
  expect(slot.getByTestId("oats-panel-session-id").closest("details")).toBe(slot.getByTestId("oats-panel-paths"));
  expect(stateOf(slot)).toBe("Working");
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  // How to reach its session: one word ("Runs in" over it already says tmux), and the command to copy. The
  // home's card of such an agent has no command: this page, where its Open leads, is where it is.
  const attach = slot.getByTestId("oats-panel-attach");
  expect(text(attach.querySelector("p")!)).toBe("Attach:");
  expect(text(within(attach).getByTestId("oats-command"))).toBe(attachCommand(instanceAnswer(CHILD).facts.home));
  expect(text(within(attach).getByTestId("oats-command"))).toMatch(/^oats session attach --home \S+$/);
  expect(within(attach).getByRole("button", { name: "Copy the attach command" })).toBeTruthy();
});

test("the attach command is for an agent on tmux the kernel says runs: none for a stopped, an unreachable or an idle one, none for an agent on a session provider; one for a tmux agent that waits on a person", async () => {
  const onTmux = (change: Partial<Agent>) => {
    const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, waiting: null, ...change } : agent));
    return renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, {
      rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, backend: "tmux", threadId: null, tmuxSession: "oats-agents" })) }),
      sidebarThreads: panelThreads(agents),
    });
  };
  for (const [what, change] of [
    ["stopped", { running: false as const, runtimeState: "stopped" }],
    ["unreachable", { running: null, runtimeState: "unreachable" }],
    ["idle: the kernel does not say it runs", { running: null, runtimeState: "unknown" }],
    ["its session ended in a shell", { running: false as const, runtimeState: "shell" }],
  ] as const) {
    const slot = onTmux(change);
    await slot.findByTestId("oats-panel-session-line");
    expect(slot.queryByTestId("oats-panel-attach"), what).toBeNull();
    slot.unmount();
  }
  // One the kernel cannot reach that still carries a claim has no command: the kernel does not say it runs,
  // and `oats session attach` refuses. (Today the model hides such a claim, so its state is unreachable and
  // the state alone decides; under the one claim rule it will be needs-you, and then the kernel's own
  // `running` is what decides: test/panel/words.test.ts holds that case of the rule itself.)
  const unreachableClaim = onTmux({ running: null, runtimeState: "unreachable", waiting: { reason: "attention", message: "Which branch?", since: "2026-11-23T18:07:26.000Z" } });
  await unreachableClaim.findByTestId("oats-panel-session-line");
  expect(unreachableClaim.queryByTestId("oats-panel-attach")).toBeNull();
  unreachableClaim.unmount();
  // it runs and waits on a person: the command is how to answer it
  const waits = onTmux({ running: true, runtimeState: "running", waiting: { reason: "attention", message: "Which branch?", since: "2026-11-23T18:07:26.000Z" } });
  await waits.findByTestId("oats-panel-session-line");
  expect(stateOf(waits)).toContain("Needs you");
  expect(waits.getByTestId("oats-panel-attach")).toBeTruthy();
  waits.unmount();
  const onBb = panel();
  await onBb.findByTestId("oats-panel-session-line");
  expect(onBb.queryByTestId("oats-panel-attach")).toBeNull();
});

test("a thread that is no agent's, and a name the roster does not hold, draw nothing", async () => {
  const stranger = panel({ threadId: "thr_not_an_agent" });
  await act(async () => {});
  expect(stranger.queryByTestId("oats-panel")).toBeNull();
  stranger.unmount();
  const unknown = panel({ instance: "gone-helper" });
  await act(async () => {});
  expect(unknown.queryByTestId("oats-panel")).toBeNull();
});

test("a first read that fails: a notice in words, the kernel's code after them, its message under Details, and Retry", async () => {
  let fail = true;
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("E_LOCAL_MISSING: no oats-local.yaml here");
        return instanceAnswer(instance);
      },
    }),
  });
  const notice = await slot.findByRole("alert");
  expect(text(within(notice).getByRole("heading"))).toBe("This instance could not be read");
  expect(text(notice)).toContain("E_LOCAL_MISSING");
  expect(text(within(notice).getByTestId("oats-notice-details"))).toContain("no oats-local.yaml here");
  // what the roster already says stays: the name, the state, the claim
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(slot.getByTestId("oats-panel-waiting")).not.toBeNull();
  expect(slot.queryByTestId("oats-panel-work")).toBeNull();
  fail = false;
  fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
  expect(text(await slot.findByTestId("oats-panel-work-sentence"))).toBe("worktree · agents/panel-worktree-helper");
  expect(slot.queryByRole("alert")).toBeNull();
});

test("a later read that fails keeps what was read, says how old it is and why, and offers Retry", async () => {
  let fail = false;
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
        return { ...instanceAnswer(instance), at: "2026-11-23T18:14:26.000Z" };
      },
    }),
  });
  await slot.findByTestId("oats-panel-work");
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  // The one drawing of a failed read: the titled notice, with how old what is still shown is, said once.
  const stale = await slot.findByRole("alert");
  expect(text(within(stale).getByRole("heading"))).toBe("This instance could not be read again");
  // 2 min 40 s, in the one shared form (minutes to the nearest one: `readAge`)
  expect(text(stale)).toBe("This instance could not be read againRead 3 min ago.OATS_TIMEOUT▸DetailsOATS_TIMEOUT: `oats` did not answer within 20 s and was stoppedRetry");
  expect(slot.getByTestId("oats-panel-work")).not.toBeNull();
  fail = false;
  fireEvent.click(within(stale).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
});

test("the panel reads again when OATS changes", async () => {
  let model = "claude-opus-5-5";
  const slot = panel({ threadId: CHILD_THREAD }, {}, { rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, model })) }) });
  expect(text(await slot.findByTestId("oats-panel-model"))).toContain("claude-opus-5-5");
  model = "claude-fable-5.2";
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:18:26.000Z" }));
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-model"))).toContain("claude-fable-5.2"));
});

test("an agent whose session fell back to a shell says Failed, and one the kernel cannot reach Unreachable, as the tree does", async () => {
  const shell = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null, running: false, runtimeState: "shell" }) });
  await shell.findByTestId("oats-panel-work");
  expect(stateOf(shell)).toBe("Failed· session ended");
  shell.unmount();
  const unreachable = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null, running: null, runtimeState: "unreachable" }) });
  await unreachable.findByTestId("oats-panel-work");
  expect(stateOf(unreachable)).toBe("Unreachable"); // the word says it: no sentence repeats it
  unreachable.unmount();
  // The same words for an agent with no thread: a fallback shell is Failed there too, and a pane that is gone Stopped.
  const byName = (change: Partial<Agent>) => {
    const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, waiting: null, ...change } : agent));
    return renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  };
  const tmuxShell = byName({ running: false, runtimeState: "shell" });
  await tmuxShell.findByTestId("oats-panel-work");
  expect(stateOf(tmuxShell)).toBe("Failed· session ended");
  tmuxShell.unmount();
  const tmuxGone = byName({ running: false, runtimeState: null });
  await tmuxGone.findByTestId("oats-panel-work");
  expect(stateOf(tmuxGone)).toBe("Stopped");
});

test("an agent with no thread that waits on a person says Needs you, as its Needs input section does", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, running: true, runtimeState: "running" } : agent));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  await slot.findByTestId("oats-panel-waiting");
  expect(stateOf(slot)).toBe("Needs you· 15 min");
  // The age once: the header's. The clock time is no line of the page and no tooltip (a phone has no hover).
  expect(slot.getByTestId("oats-panel-state").getAttribute("title")).toBeNull();
  expect(slot.queryByTestId("oats-panel-waiting-since")).toBeNull();
  expect(text(slot.getByTestId("oats-panel-waiting"))).not.toMatch(/since/);
});

// One claim rule for bb and tmux (the spec's author, 2026-11-23): a claim is hidden only for an agent the kernel calls stopped.
test("an agent on tmux that the kernel cannot reach still shows what it waits for: a claim wins, as on bb", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, running: null, runtimeState: "unreachable" } : agent));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  await slot.findByTestId("oats-panel-work");
  expect(stateOf(slot)).toBe("Needs you· 15 min");
  expect(slot.getByTestId("oats-panel-waiting")).toBeTruthy();
});

test("an agent that needs you for a question bb shows, with no claim, says Needs you with no time, never the age of its start", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, waiting: null, running: true } : agent));
  const threads = panelThreads(agents, [CHILD]);
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents) }),
    sidebarThreads: { ...threads, threads: threads.threads.map((thread) => (thread.id === CHILD_THREAD ? { ...thread, hasPendingInteraction: true } : thread)) },
  });
  await slot.findByTestId("oats-panel-work");
  // No claim, so no block of what it asks: the question is in the thread, and the header says the state alone.
  expect(stateOf(slot)).toBe("Needs you");
  expect(slot.queryByTestId("oats-panel-waiting")).toBeNull();
});

test("the agent's header draws the letters of its NAME, the Soul tab's the soul's: each hidden from a screen reader beside the name it repeats", async () => {
  const slot = panel();
  const header = within(await slot.findByTestId("oats-panel-header"));
  // "Panel worktree helper" is "PW": the initials of the words beside the tile, not its soul's ("OE", oats-expert).
  const mark = header.getByTestId("oats-agent-mark");
  expect([text(header.getByTestId("oats-panel-name")), text(mark), mark.getAttribute("aria-hidden")]).toEqual(["Panel worktree helper", "PW", "true"]);
  expect(header.queryByTestId("oats-soul-mark")).toBeNull();
  fireEvent.click(slot.getByTestId("oats-tab-soul"));
  const soul = within(await slot.findByTestId("oats-panel-soul-header")).getByTestId("oats-soul-mark");
  expect([text(soul), soul.getAttribute("aria-hidden")]).toEqual(["OE", "true"]);
});

test("what the kernel's row holds is drawn through the display filter, and copied as the kernel gave it", async () => {
  const writes: string[] = [];
  vi.stubGlobal("navigator", { clipboard: { writeText: async (value: string) => void writes.push(value) } });
  const id = "alias evil\u202Egnp.exe on team";
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, messagingId: id, startedAt: "tomorrow\u202E", harness: "constructor" }) });
  expect(text(await slot.findByTestId("oats-panel-messaging-id"))).toBe("alias evil\uFFFDgnp.exe on team");
  expect(text(slot.getByTestId("oats-panel-started"))).toBe("tomorrow\uFFFD");
  expect(slot.getByTestId("oats-panel-started").getAttribute("title")).not.toContain("\u202E");
  // A harness the plugin has no name for is named as reported, never by a key it did not write.
  expect(text(slot.getByTestId("oats-panel-harness"))).toBe("constructor");
  fireEvent.click(copyOf(slot.getByTestId("oats-panel-messaging-id")));
  await waitFor(() => expect(writes).toEqual([id]));
  slot.unmount();
  // The path drawn is the path copied: spaces and an empty segment stay as they are.
  const odd = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, work: "directory", home: "/abs/My Dir /x y/ /z" }) });
  await odd.findByTestId("oats-panel-work");
  expect(text(odd.getByTestId("oats-panel-home"))).toBe("/abs/My Dir /x y/ /z");
  odd.unmount();
  // A path that looks like a secret as a whole is withheld whole, also where no segment of it does.
  const secret = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, messagingId: "https://ana:hunter2@aweb.example/ana" }) });
  expect(text(await secret.findByTestId("oats-panel-messaging-id"))).toBe("[withheld]");
});

test("when the roster cannot be read again, an open panel keeps what it read, with its age, the refusal's code and Retry", async () => {
  let fail = false;
  let refreshed = 0;
  const failing = { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" };
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({
      snapshot: () => (fail ? failing : panelSnapshot()),
      refresh: () => {
        refreshed += 1;
        return { at: "2026-11-23T18:16:46.000Z" };
      },
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("E_LOCAL_MISSING: no oats-local.yaml here");
        return { ...instanceAnswer(instance), at: "2026-11-23T18:14:26.000Z" };
      },
    }),
  });
  await slot.findByTestId("oats-panel-work");
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  // The words every place of the plugin says for this cause (app/roster/unreadable.tsx), as the sidebar's titled notice, then the code.
  const stale = await slot.findByRole("alert");
  await waitFor(() => expect(text(within(stale).getByRole("heading"))).toBe("OATS could not read this deployment"));
  // Its face: the title and the age (the shared `readAge`); the kernel's code and line are one press away, as in the sidebar's notice.
  expect(text(stale)).toBe("OATS could not read this deploymentRead 3 min ago. Acts are off.▸DetailsE_LOCAL_MISSING: no oats-local.yaml hereRetry");
  expect((within(stale).getByTestId("oats-notice-details") as HTMLDetailsElement).open).toBe(false);
  // Everything it read is still there: the name, the state, the claim, the facts.
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(slot.getByTestId("oats-panel-waiting")).not.toBeNull();
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toBe("worktree · agents/panel-worktree-helper");
  fail = false;
  fireEvent.click(within(stale).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
  expect(refreshed).toBe(1);
  expect(slot.getByTestId("oats-panel-work")).not.toBeNull();
});

// ---- the panel as a page of its own
async function agentPage(subPath: string, options: RenderSlotOptions<Contract> = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const app = await loadApp();
  const page = app.navPanels.find((candidate) => candidate.id === "agent")!;
  expect([page.path, page.experimental_hideFromNavigation]).toEqual(["agent", true]);
  return renderSlot<{ subPath: string }, Contract>(page, { subPath }, { rpc: handlers({ snapshot: () => panelSnapshot() }), sidebarThreads: panelThreads(), ...options });
}

test("the agent's page is the same panel by instance name, with the way back to its thread", async () => {
  const slot = await agentPage(CHILD);
  expect(text(await slot.findByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(text(await slot.findByTestId("oats-panel-work-sentence"))).toBe("worktree · agents/panel-worktree-helper");
  const back = slot.getByTestId("oats-agent-back");
  expect(text(back)).toBe("‹ Thread");
  fireEvent.click(back);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: CHILD_THREAD }]);
});

test("the page of an agent with no thread in bb goes back to Home; a name OATS does not list says so in its title, and no sentence repeats it", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null } : agent));
  const tmux = await agentPage(CHILD, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  expect(text(await tmux.findByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(text(tmux.getByTestId("oats-agent-back"))).toBe("‹ Home");
  fireEvent.click(tmux.getByTestId("oats-agent-back"));
  expect(tmux.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  tmux.unmount();
  const gone = await agentPage("gone-helper");
  // The page is its way back and one title: why it is empty. No sentence under it.
  await waitFor(() => expect(text(gone.getByTestId("oats-agent-page"))).toBe("‹ HomeThis agent is not in OATS"));
  expect(gone.queryByTestId("oats-panel")).toBeNull();
  gone.unmount();
  const none = await agentPage("");
  await waitFor(() => expect(text(none.getByTestId("oats-agent-page"))).toBe("‹ HomeNo agent to show"));
  // The page of a name OATS does not list has a title too.
  none.unmount();
  const again = await agentPage("gone-helper");
  await waitFor(() => expect(text(again.getByTestId("oats-agent-page"))).toContain("This agent is not in OATS"));
});

test("while OATS cannot be read the page shows the notice every place shows: what happened in words, the kernel's code and line under Details, Retry", async () => {
  const slot = await agentPage(CHILD, { rpc: handlers({ snapshot: () => ({ ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" }) }) });
  const alert = await slot.findByRole("alert");
  expect(text(within(alert).getByRole("heading"))).toBe("OATS could not read this deployment");
  expect(text(alert)).toBe("OATS could not read this deployment▸DetailsE_LOCAL_MISSING: no oats-local.yaml hereRetry");
  expect((within(alert).getByTestId("oats-notice-details") as HTMLDetailsElement).open).toBe(false);
  expect(within(alert).getByRole("button", { name: "Retry" })).not.toBeNull();
});

test("on an agent's own thread the plugin's fixed tab is the panel", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const app = await loadApp();
  const tab = app.tabs.find((candidate) => candidate.id === "home")!;
  const slot = renderSlot<{ threadId: string; environment: null }, Contract>(tab as never, { threadId: CHILD_THREAD, environment: null }, {
    rpc: handlers({ snapshot: () => panelSnapshot() }),
    sidebarThreads: panelThreads(),
  });
  expect(text(await slot.findByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(slot.queryByTestId("oats-home-tab")).toBeNull();
});

test("the page keeps the agent and its way back while the roster cannot be read again", async () => {
  let fail = false;
  const slot = await agentPage(CHILD, {
    rpc: handlers({
      snapshot: () => (fail ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped" } : panelSnapshot()),
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
        return instanceAnswer(instance);
      },
    }),
  });
  await slot.findByTestId("oats-panel-work");
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  const stale = await slot.findByRole("alert");
  expect(text(within(stale).getByRole("heading"))).toBe("OATS did not answer on this machine");
  // The roster was read moments ago and the read after it failed: never "just now". What to do in a sentence is under Details.
  expect(text(stale)).toBe("OATS did not answer on this machineRead less than a minute ago. Acts are off.▸DetailsIt took more than 20 s.`oats` did not answer within 20 s and was stoppedRetry");
  expect(text(slot.getByTestId("oats-agent-back"))).toBe("‹ Thread");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toBe("worktree · agents/panel-worktree-helper");
});

test("with the last roster the server kept: the page shows the agent as last read, and says OATS could not be read again, with its code", async () => {
  // The server answers a failed read with the last roster it read (`last`): the roster stays on
  // screen as it was, and the panel says why what it shows is old.
  let fail = false;
  const slot = await agentPage(CHILD, {
    rpc: handlers({
      snapshot: () => {
        const read = panelSnapshot();
        return fail ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here", last: { at: read.at, deployment: read.deployment, agents: read.agents } } : read;
      },
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("E_LOCAL_MISSING: no oats-local.yaml here");
        return instanceAnswer(instance);
      },
    }),
  });
  await slot.findByTestId("oats-panel-work");
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  await waitFor(() => expect(text(within(slot.getByTestId("oats-panel")).getByRole("alert"))).toBe("OATS could not read this deploymentRead less than a minute ago. Acts are off.▸DetailsE_LOCAL_MISSING: no oats-local.yaml hereRetry"));
  expect(text(slot.getByTestId("oats-agent-back"))).toBe("‹ Thread");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toBe("worktree · agents/panel-worktree-helper");
});

test("the fixed tab keeps the agent's panel when the roster cannot be read again, with its age and why", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  let fail = false;
  const app = await loadApp();
  const tab = app.tabs.find((candidate) => candidate.id === "home")!;
  const slot = renderSlot<{ threadId: string; environment: null }, Contract>(tab as never, { threadId: CHILD_THREAD, environment: null }, {
    rpc: handlers({
      snapshot: () => (fail ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" } : panelSnapshot()),
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("E_LOCAL_MISSING: no oats-local.yaml here");
        return instanceAnswer(instance);
      },
    }),
    sidebarThreads: panelThreads(),
  });
  await slot.findByTestId("oats-panel-work");
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  expect(text(await within(await slot.findByTestId("oats-panel")).findByRole("alert"))).toBe("OATS could not read this deploymentRead less than a minute ago. Acts are off.▸DetailsE_LOCAL_MISSING: no oats-local.yaml hereRetry");
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(slot.queryByTestId("oats-home-tab")).toBeNull();
});

// Whether an agent works is what bb says of its thread: a panel that opens from the agent its caller
// remembered, while the roster cannot be read, still has bb's row of the thread to read it from.
test("a panel that opens while the roster cannot be read says Working for an agent whose bb thread has a turn running", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const known = { ...panelAgents().find((agent) => agent.instance === CHILD)!, waiting: null, running: true };
  const slot = renderSlot<{ threadId: string; known: Agent }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD, known }, {
    rpc: handlers({
      snapshot: () => ({ ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" }),
      panelInstance: () => {
        throw new Error("E_LOCAL_MISSING: no oats-local.yaml here");
      },
    }),
    sidebarThreads: panelThreads([known], [CHILD]), // bb lists the thread, with a turn running on it
  });
  await waitFor(() => expect(stateOf(slot)).toContain("Working"));
});

// In a READY roster an agent with no node has no thread to read: the panel says what its row in the
// sidebar says. (Two rows naming one thread: the second is drawn on none, and must not borrow the first's.)
test("in a ready roster an agent drawn on no thread says Idle in its panel, as its row does, whatever bb says of a thread another agent is drawn on", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const child = { ...panelAgents().find((agent) => agent.instance === CHILD)!, waiting: null, running: true };
  const twin = { ...child, instance: "twin-helper" }; // names the same thread; the tree draws the first on it
  const agents = [...panelAgents().filter((agent) => agent.instance !== CHILD), child, twin];
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: "twin-helper" }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance === "twin-helper" ? CHILD : instance) }),
    sidebarThreads: panelThreads(agents, [CHILD]), // the shared thread has a turn running
  });
  await waitFor(() => expect(stateOf(slot)).toMatch(/^Idle/));
});

test("a panel that opens while the roster cannot be read shows the agent its caller last read, and why nothing more", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const known = panelAgents().find((agent) => agent.instance === CHILD)!;
  const slot = renderSlot<{ threadId: string; known: Agent }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD, known }, {
    rpc: handlers({
      snapshot: () => ({ ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" }),
      panelInstance: () => {
        throw new Error("E_LOCAL_MISSING: no oats-local.yaml here");
      },
    }),
    sidebarThreads: panelThreads(),
  });
  // The notice every place shows when OATS cannot be read, whole: with Retry and the code.
  await waitFor(() => expect(text(within(slot.getByRole("alert")).getByRole("heading"))).toBe("OATS could not read this deployment"));
  const notice = slot.getByRole("alert");
  expect(notice.closest('[data-testid="oats-unreadable"]')).not.toBeNull();
  expect(text(notice)).toBe("OATS could not read this deployment▸DetailsE_LOCAL_MISSING: no oats-local.yaml hereRetry");
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(stateOf(slot)).toMatch(/^Needs you/);
});

test("at the phone's width the thread's OATS chip opens the agent's page", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)" }));
  const app = await loadApp();
  const slot = renderSlot<{ threadId: string; projectId: string; environment: null }, Contract>(app.threadHeaderRows[0]! as never, { threadId: CHILD_THREAD, projectId: "proj_panel", environment: null }, {
    rpc: handlers({ snapshot: () => panelSnapshot() }),
    sidebarThreads: panelThreads(),
  });
  fireEvent.click(await slot.findByTestId("oats-open-panel"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: CHILD } }]);
});

// ---- from the second UX read

test("Lineage names the agents it started, as the thread's row counts them, each a link where it has a thread", async () => {
  const slot = panel({ threadId: panelAgents().find((agent) => agent.instance === "redesign-ui-lead")!.threadId! });
  const lineage = await slot.findByTestId("oats-panel-lineage");
  // the recorded lead started three agents: each is named, in the roster's order
  const children = within(lineage).getAllByTestId("oats-panel-child");
  expect(children.map((child) => text(child))).toEqual(["Harvest knowledge helper", "Desktop mockups developer", "Panel worktree helper"]);
  expect(text(within(lineage).getAllByTestId("oats-fact").at(-1)!.querySelector("dt")!)).toBe("Children");
  // the kernel's own name is the title
  expect(children.map((child) => child.getAttribute("title"))).toEqual(["harvest-knowledge-helper", "desktop-mockups-developer", CHILD]);
  // each has a thread in bb: each is a link
  expect(children.map((child) => child.tagName)).toEqual(["A", "A", "A"]);
  slot.unmount();
  resetApp();
  // A lead with one child says "Child" (the recorded lead has three: the roster here keeps one of them).
  const lead = panelAgents().find((agent) => agent.instance === "redesign-ui-lead")!;
  const agents = panelAgents().filter((agent) => agent.parent !== lead.instance || agent.instance === CHILD);
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const one = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: lead.threadId! }, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  const single = await one.findByTestId("oats-panel-lineage");
  expect(within(single).getAllByTestId("oats-fact").map((fact) => text(fact))).toContain("ChildPanel worktree helper");
  expect(within(single).getByTestId("oats-panel-child").getAttribute("title")).toBe(CHILD);
});

test("the panel draws within the part of bb's side panel that is in the window, and whole when all of it is", async () => {
  const slot = panel();
  const root = await slot.findByTestId("oats-panel");
  const inner = slot.getByTestId("oats-panel-visible");
  // all of it in the window: no width of its own
  expect(inner.style.width).toBe("");
  // bb lays the panel 480 px wide with its last 120 px past a 1280 px window
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1280 });
  root.getBoundingClientRect = () => ({ left: 920, right: 1400, width: 480, top: 0, bottom: 800, height: 800, x: 920, y: 0, toJSON: () => ({}) });
  act(() => void window.dispatchEvent(new Event("resize")));
  expect(inner.style.width).toBe("360px");
  // and back in the window
  root.getBoundingClientRect = () => ({ left: 800, right: 1280, width: 480, top: 0, bottom: 800, height: 800, x: 800, y: 0, toJSON: () => ({}) });
  act(() => void window.dispatchEvent(new Event("resize")));
  expect(inner.style.width).toBe("");
  Reflect.deleteProperty(document.documentElement, "clientWidth");
});

test("an unreachable agent: its header says so in the state's word alone, what OATS says is one press away under Details there, and not again in the Session card", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null, running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" }), facts: (facts) => ({ ...facts, runtimeError: "bb did not answer" }) });
  await slot.findByTestId("oats-panel-session");
  expect(stateOf(slot)).toBe("Unreachable");
  expect(text(slot.getByTestId("oats-panel-header"))).not.toContain("OATS cannot reach its session");
  const kernel = slot.getByTestId("oats-status-kernel") as HTMLDetailsElement;
  expect(kernel.open).toBe(false);
  expect(kernel.querySelector("p")!.textContent).toBe("OATS says: bb did not answer");
  expect(slot.queryByTestId("oats-panel-runtime-error")).toBeNull();
});

// ---- from the second round of review

test("an agent with several children lists each on a row of its own as high as its target: no two links overlap", async () => {
  const agents = panelAgents();
  const lead = agents.find((agent) => agent.instance === "redesign-ui-lead")!;
  const second = { ...agents.find((agent) => agent.instance === CHILD)!, instance: "panel-second-helper", threadId: "thr_second", waiting: null };
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: lead.threadId! }, {
    rpc: handlers({ snapshot: () => panelSnapshot([...agents, second]), panelInstance: ({ instance }) => instanceAnswer(instance === "panel-second-helper" ? CHILD : instance) }),
    sidebarThreads: panelThreads([...agents, second]),
  });
  const lineage = await slot.findByTestId("oats-panel-lineage");
  const children = within(lineage).getAllByTestId("oats-panel-child");
  expect(children.map((child) => text(child))).toEqual(["Harvest knowledge helper", "Desktop mockups developer", "Panel worktree helper", "Panel second helper"]);
  expect(text(within(lineage).getAllByTestId("oats-fact").at(-1)!.querySelector("dt")!)).toBe("Children");
  // A link of a list takes no height back from its row; a link alone beside its label does.
  for (const child of children) expect(child.className).not.toMatch(/-my-/);
});

test("OATS cannot be found any more, over what was read: the panel's notice offers the settings, as the sidebar's does", async () => {
  let fail = false;
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({
      snapshot: () => {
        const read = panelSnapshot();
        return fail ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "OATS_NOT_FOUND", message: "spawn oats ENOENT", machine: "falcon", last: { at: read.at, deployment: read.deployment, agents: read.agents } } : read;
      },
      panelInstance: ({ instance }) => {
        if (fail) throw new Error("OATS_NOT_FOUND: spawn oats ENOENT");
        return instanceAnswer(instance);
      },
    }),
  });
  await slot.findByTestId("oats-panel-work");
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  const notice = await within(slot.getByTestId("oats-panel")).findByRole("alert");
  await waitFor(() => expect(text(within(notice).getByRole("heading"))).toMatch(/^OATS is not installed on /));
  expect(text(notice)).toContain("Install OATS there, or set the path to oats in the plugin's settings.");
  expect(text(within(notice).getByTestId("oats-panel-open-settings"))).toBe("Open settings");
  expect(within(notice).getByRole("button", { name: "Retry" })).not.toBeNull();
});

test("the older-build fold scrolls within its own height: the header does not grow with the number of modules that moved", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, drift: { soul: "moved", modules: Array.from({ length: 12 }, (_, index) => ({ name: `mod.${index}`, status: "moved", was: null, now: null, reason: null })) } }) });
  const fold = await slot.findByTestId("oats-panel-drift");
  const lines = fold.querySelector(".overflow-y-auto")!;
  expect(lines.className).toContain("max-h-32");
  expect(lines.children.length).toBeGreaterThan(12);
});

test("Open soul page is offered only where the Souls page is shown in this release", async () => {
  const shownSlot = panel({ threadId: CHILD_THREAD }, {}, { settings: { pages: "home, souls" } });
  fireEvent.click(await shownSlot.findByTestId("oats-panel-soul-link"));
  expect(text(await shownSlot.findByTestId("oats-panel-open-soul"))).toBe("Open soul page");
  shownSlot.unmount();
  const hidden = panel({ threadId: CHILD_THREAD }, {}, { settings: { pages: "home" } });
  fireEvent.click(await hidden.findByTestId("oats-panel-soul-link"));
  await hidden.findByTestId("oats-panel-soul-name");
  expect(hidden.queryByTestId("oats-panel-open-soul")).toBeNull();
  expect(hidden.queryByTestId("oats-panel-open-soul-why")).toBeNull();
});

// ---- the lifecycle's acts, in the header

const actsOf = (slot: { queryByTestId(id: string): HTMLElement | null }) => Array.from(slot.queryByTestId("oats-agent-acts")?.querySelectorAll("button") ?? []).map((button) => button.textContent);

test("the header offers the lifecycle's acts that apply to the agent's state, under its state; a press opens that act's dialog and runs nothing", async () => {
  const { asked } = await import("../../app/lifecycle");
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null, running: true }), works: true });
  await slot.findByTestId("oats-panel-work");
  expect(actsOf(slot)).toEqual(["Stop…", "Restart…", "Retire…"]);
  // in the header, after the state: it stays in view on both tabs
  const header = slot.getByTestId("oats-panel-header");
  expect(header.contains(slot.getByTestId("oats-agent-acts"))).toBe(true);
  expect(slot.getByTestId("oats-panel-state").compareDocumentPosition(slot.getByTestId("oats-agent-acts")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const before = slot.inspection.rpcCalls.length;
  fireEvent.click(slot.getByTestId("oats-agent-act-stop"));
  expect(asked()).toEqual({ verb: "stop", instance: CHILD });
  // the press asked for the dialog and nothing else: no act of OATS was made from the panel
  expect(slot.inspection.rpcCalls.slice(before).map((call) => call.method).filter((method) => !["snapshot", "souls", "panelInstance"].includes(method))).toEqual([]);
});

test("an agent with no thread in bb has its acts on its own page: Start and Retire for one whose thread is gone, Stop, Restart and Retire for one that runs on tmux", async () => {
  const byName = (change: Partial<Agent>) => {
    const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, waiting: null, ...change } : agent));
    return renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, {
      rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance) }),
      // bb lists the threads it has: not the one the roster still names for an agent whose thread is gone
      sidebarThreads: panelThreads(agents.filter((agent) => agent.threadId !== "thr_gone")),
    });
  };
  // its bb thread is gone (the roster names a thread bb does not have), and the kernel has it stopped
  const gone = byName({ threadId: "thr_gone", running: false, runtimeState: "stopped" });
  await gone.findByTestId("oats-panel-work");
  expect(actsOf(gone)).toEqual(["Start…", "Retire…"]);
  gone.unmount();
  const tmux = byName({ backend: "tmux", threadId: null, running: true, runtimeState: "running" });
  await tmux.findByTestId("oats-panel-work");
  // An agent on tmux has the acts of its state as one on bb has: Start and Restart open its dialog, which opens no thread.
  expect(actsOf(tmux)).toEqual(["Stop…", "Restart…", "Retire…"]);
});

test("while the roster is the last one read the acts are off, and the panel's notice says so, with Retry", async () => {
  let fail = false;
  const slot = renderSlot<{ threadId: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({
      snapshot: () => {
        const read = panelSnapshot();
        return fail ? { ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last: { at: read.at, deployment: read.deployment, agents: read.agents } } : read;
      },
    }),
    sidebarThreads: panelThreads(),
  });
  await slot.findByTestId("oats-panel-work");
  expect(Array.from(slot.getByTestId("oats-agent-acts").querySelectorAll("button")).every((button) => !button.disabled)).toBe(true);
  fail = true;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-23T18:16:26.000Z" }));
  await waitFor(() => expect(Array.from(slot.getByTestId("oats-agent-acts").querySelectorAll("button")).every((button) => button.disabled)).toBe(true));
  // Off, and never alone: no reason beside each act; the panel's one notice says "Acts are off." beside the age, with Retry.
  expect(within(slot.getByTestId("oats-agent-acts")).queryByTestId("oats-disabled-reason")).toBeNull();
  const notice = within(slot.getByTestId("oats-panel")).getByRole("alert");
  expect(within(notice).getByTestId("oats-held").textContent).toBe("Acts are off.");
  expect(within(notice).getByRole("button", { name: "Retry" })).toBeTruthy();
});

// ---- when OATS stopped it: a fact of the Session (it left the thread's line and the sidebar's row;
// Joan's direction of 23 Nov 2026). What the thread's row held of it is held here.

/** The Session's "Stopped" fact as drawn: "Stopped<time>", or null when the card has no such row. */
const stoppedFact = (slot: { queryByTestId(id: string): HTMLElement | null }) => slot.queryByTestId("oats-panel-stopped")?.closest('[data-testid="oats-fact"]')?.textContent ?? null;
const eventReads = (slot: { inspection: { rpcCalls: { method: string }[] } }) => slot.inspection.rpcCalls.filter((call) => call.method === "panelEvents").length;

// The events read runs once and bb keeps its answer: an agent stopped, started and stopped again
// in one window must say the time of THIS stop, never the earlier one's.
test("a stopped agent that was started and stopped again says the time of this stop in its Session: the events are read again each time it turns stopped", async () => {
  const { recordedEvents } = await import("./handlers");
  const [first, started, second] = ["2026-11-21T10:00:00.000Z", "2026-11-21T12:00:00.000Z", "2026-11-21T16:00:00.000Z"];
  const stop = recordedEvents().events.find((event) => event.kind === "stopped")!;
  const of = (over: Partial<Agent>) => panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, waiting: null, ...over } : agent));
  let agents = of({ running: false, runtimeState: "stopped", startedAt: "2026-11-21T09:00:00.000Z" });
  let events = [{ ...stop, at: first }];
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance), panelEvents: () => ({ ...recordedEvents(), events }) }),
  });
  await waitFor(() => expect(stoppedFact(slot)).toBe(`Stopped${waitingClock(first, NOW)}`));
  expect(eventReads(slot)).toBe(1);
  // Started: no "Stopped" row, and nothing more is asked.
  agents = of({ running: true, runtimeState: "running", startedAt: started });
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: started }));
  await waitFor(() => expect(stoppedFact(slot)).toBeNull());
  expect(eventReads(slot)).toBe(1);
  // Stopped again: the kernel has recorded a second "stopped". The events held are from before it.
  agents = of({ running: false, runtimeState: "stopped", startedAt: started });
  events = [{ ...stop, at: first }, { ...stop, at: second }];
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: second }));
  await waitFor(() => expect(stoppedFact(slot)).toBe(`Stopped${waitingClock(second, NOW)}`));
  expect(eventReads(slot)).toBe(2);
});

test("events read before the session's start hold no time for this stop: the Session has no Stopped row, never an earlier stop's time", async () => {
  // The recorded events: stopped at 2026-11-23T18:01:33.424Z; the roster says the session started after that.
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: false, runtimeState: "stopped", startedAt: "2026-11-23T18:05:00.000Z" }) });
  await slot.findByTestId("oats-panel-session");
  await waitFor(() => expect(eventReads(slot)).toBe(1));
  await act(async () => {});
  expect(stoppedFact(slot)).toBeNull();
});

// A session OATS LOST: nobody stopped it, and the kernel records no time of a loss. The last
// "stopped" its events hold is an EARLIER stop's (here the recorded one, of 21 Nov 18:23; the
// roster names no start for the row, so nothing tells the card that it is older): no date stands
// beside "Stopped" for it (the specialist's ruling of 24 Nov 2026 on the lost tmux agent's page).
test("a session OATS lost has no Stopped row: an earlier stop's time is never put beside it, and its events are not read for one", async () => {
  const row = (sessionEnd: "lost" | "stopped") => (agent: Agent): Agent => ({ ...agent, waiting: null, running: false, runtimeState: null, sessionEnd, startedAt: null });
  const lost = panel({ threadId: CHILD_THREAD }, { agent: row("lost") });
  await lost.findByTestId("oats-panel-session");
  await act(async () => {});
  await new Promise((resolve) => setTimeout(resolve, 20)); // (time for a read to be asked, if one were)
  expect(within(lost.getByTestId("oats-panel-state")).getByTestId("oats-state").textContent).toBe("Stopped");
  expect([stoppedFact(lost), eventReads(lost)]).toEqual([null, 0]);
  expect(lost.getByTestId("oats-panel-session").textContent).not.toMatch(/Stopped|18:23/);
  resetApp();
  // The same row as an operator's stop: the card says when (the read and the row are there for a stop).
  const stopped = panel({ threadId: CHILD_THREAD }, { agent: row("stopped") });
  await waitFor(() => expect(stoppedFact(stopped)).toBe(`Stopped${waitingClock("2026-11-23T18:01:33.424Z", NOW)}`));
  expect(eventReads(stopped)).toBe(1);
});

// The time of a stop is an extra: when the read of the events fails, the Session says none, and
// nothing of the failure is drawn on the card or in the header (the Activity, read on a press, has its own notice).
test("a stopped agent whose events cannot be read has no Stopped row, and no error in its header or its Session", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: false, runtimeState: "stopped" }) }, {
    rpc: handlers({
      snapshot: () => panelSnapshot(panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, running: false, runtimeState: "stopped" } : agent))),
      panelInstance: ({ instance }) => instanceAnswer(instance),
      panelEvents: () => {
        throw new Error("E_EVENTS_UNREADABLE: the instance's events could not be read");
      },
    }),
  });
  const session = await slot.findByTestId("oats-panel-session");
  await waitFor(() => expect(eventReads(slot)).toBeGreaterThan(0));
  await act(async () => {});
  expect(stoppedFact(slot)).toBeNull();
  expect(stateOf(slot)).toBe("Stopped");
  expect(text(session)).not.toContain("E_EVENTS_UNREADABLE");
  expect(text(slot.getByTestId("oats-panel-header"))).not.toContain("E_EVENTS_UNREADABLE");
});

// The soul is on no row of the sidebar and no row of the thread: the header here is where it is
// said. Its name is the matching soul's key once the souls are read, else the roster's name.
test("the header's soul is the matching soul's key once the souls are read, else the roster's name", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: ({ instance }) => instanceAnswer(instance),
      souls: () => ({ souls: [{ name: "oats.okf/oats-expert", agent: "oats-expert", description: "", origin: "oats.okf 2.1.0", capabilities: [], spawnable: true, problem: null }] }),
    }),
  });
  await slot.findByTestId("oats-panel-work");
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-soul-link"))).toBe("oats.okf/oats-expert"));
  slot.unmount();
  resetApp();
  const plain = panel({ threadId: CHILD_THREAD }, {}, { rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance), souls: () => ({ souls: [] }) }) });
  await plain.findByTestId("oats-panel-work");
  expect(text(plain.getByTestId("oats-panel-soul-link"))).toBe("oats-expert");
});

// ---- behind a lifecycle result (the lead's L13; app/roster/reading.tsx, whose own tests are test/roster/reading.test.tsx):
// the agent's header, on its panel and on its page, says "Reading…" in the state's place and offers no act, until the
// roster is read again. A RETIRE's result too: the agent is gone, and the page that still draws it says the same.

test("behind a result that says the agent changed, its header says \"Reading…\" in the state's place and every act of its is off; a roster read after the act says the state again", async () => {
  const { noteActed } = await import("../../app/roster/reading");
  let agents = panelAgents();
  let at = panelSnapshot().at;
  const slot = renderSlot<{ threadId?: string; instance?: string }, Contract>({ component: InstancePanel }, { threadId: CHILD_THREAD }, {
    rpc: handlers({ snapshot: () => ({ ...panelSnapshot(agents), at }), panelInstance: ({ instance }) => instanceAnswer(instance) }),
    sidebarThreads: panelThreads(agents),
  });
  const state = await slot.findByTestId("oats-panel-state");
  await waitFor(() => expect(within(state).queryByTestId("oats-state")).not.toBeNull());
  const word = within(state).getByTestId("oats-state").textContent;
  const acts = () => Array.from(slot.getByTestId("oats-agent-acts").querySelectorAll("button")).map((button) => button.disabled);
  expect(acts().length).toBeGreaterThan(0);
  expect(acts().every((off) => off === false)).toBe(true);
  // The result says it stopped (or was retired: the same for the page that still draws it).
  act(() => noteActed([CHILD], at));
  expect(within(state).getByTestId("oats-reading").textContent).toBe("Reading…");
  expect(within(state).queryByTestId("oats-state")).toBeNull(); // never the old state stated plainly
  expect(state.textContent).not.toContain(word!);
  expect(acts().every((off) => off === true)).toBe(true); // nothing offers an act
  // The roster is read again, after the act: the state is what it says.
  agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, waiting: null, running: false, runtimeState: "stopped", sessionEnd: "stopped" } : agent));
  at = new Date(Date.parse(at) + 4_000).toISOString();
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at }));
  await waitFor(() => expect(within(state).queryByTestId("oats-reading")).toBeNull());
  expect(within(state).getByTestId("oats-state").textContent).toBe("Stopped");
});

// The panel's own live read is answered from the server's cache, as the roster's is: an event that
// arrives while its FIRST answer is on its way is not served by that answer (app/store.ts `reread`;
// the roster's side of it: test/app/window-loads.test.tsx). Without it a panel that is opened, or a
// window that loads on a thread, while the server reads a change keeps the facts from before it.
test("the panel's live read: the change is published while its first answer is on its way, and the panel ends on the facts after the change", async () => {
  let calls = 0;
  let deliver: (() => void) | undefined;
  const first = new Promise<void>((resolve) => (deliver = resolve));
  const slot = panel({ threadId: CHILD_THREAD }, {}, {
    rpc: handlers({
      snapshot: () => panelSnapshot(),
      panelInstance: async ({ instance }) => {
        calls += 1;
        if (calls === 1) {
          await first;
          return instanceAnswer(instance, (facts) => ({ ...facts, model: "claude-opus-5-5" })); // made by the server before the change
        }
        return instanceAnswer(instance, (facts) => ({ ...facts, model: "claude-fable-5.2" }));
      },
    }),
  });
  await waitFor(() => expect(calls).toBe(1));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:31:00.000Z" }));
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:31:00.300Z" })); // and a second: one read is owed for both
  await act(async () => deliver!());
  // (The first answer, from before the change, may be drawn for a moment or not at all: what is held is where the panel ENDS.)
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-model"))).toContain("claude-fable-5.2"));
  expect(calls).toBe(2);
});
