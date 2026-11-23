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
  expect(text(slot.getByTestId("oats-panel-header"))).toContain("instance of");
  expect(text(slot.getByTestId("oats-panel-soul-link"))).toBe("oats-expert");
  // The kernel says the recorded agent's harness is loaded (`running: true`) and bb says its thread is at rest: Idle, the tree's word. What bb says of the thread decides, not `running`.
  expect(stateOf(slot)).toBe("Idle");
  expect(within(slot.getByTestId("oats-panel-state")).getByTestId("oats-state").getAttribute("data-state")).toBe("idle");
  expect(slot.queryByTestId("oats-panel-drift")).toBeNull();
  expect(slot.queryByTestId("oats-panel-waiting")).toBeNull();
});

test("a running agent says Working, as the tree and the thread do, and since when it runs is a fact of its session; a stopped one says Stopped and shows no claim", async () => {
  const running = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: true, waiting: null }), works: true });
  await running.findByTestId("oats-panel-work");
  // started 18:00:56Z, read at 18:16:56Z
  expect(stateOf(running)).toBe("Working· started 18:00");
  // started 18:00:56Z, read at 18:16:56Z: a labelled fact of the session
  expect(text(running.getByTestId("oats-panel-started").closest('[data-testid="oats-fact"]')!)).toBe("Started16 min ago");
  running.unmount();
  const stopped = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: false, runtimeState: "stopped" }) });
  await stopped.findByTestId("oats-panel-work");
  expect(stateOf(stopped)).toBe("Stopped");
  // It does not run since then: "Last started", not "Started".
  expect(text(stopped.getByTestId("oats-panel-started").closest('[data-testid="oats-fact"]')!)).toBe("Last started16 min ago");
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
    expect(stateOf(slot), JSON.stringify(change)).toMatch(/^Needs you· waiting 15 min/);
    expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("How should I merge the pull request?");
    slot.unmount();
  }
});

test("Needs input: the reason in words and the agent's message; how long and since when is said once, by the header", async () => {
  const slot = panel();
  const waiting = await slot.findByTestId("oats-panel-waiting");
  // The clock as the words module says it here: with the date where local midnight falls inside the wait.
  const clock = waitingClock("2026-11-23T18:00:58.993Z", NOW);
  expect(text(within(waiting).getByRole("heading"))).toBe("Needs input");
  expect(text(slot.getByTestId("oats-panel-waiting-head"))).toBe("Asked for your attention");
  expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("How should I merge the pull request?");
  expect(stateOf(slot)).toBe(`Needs you· waiting 15 min (since ${clock})`);
});

test("a claim with no message says the reason alone; its message is drawn as text through the display filter", async () => {
  const bare = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: { reason: "permission", message: null, since: "2026-11-23T18:15:26.000Z" } }) });
  expect(text(await bare.findByTestId("oats-panel-waiting-head"))).toBe("Waiting for a tool approval");
  expect(stateOf(bare)).toMatch(/^Needs you· waiting 1 min \(since .+\)$/);
  expect(bare.queryByTestId("oats-panel-waiting-message")).toBeNull();
  bare.unmount();
  const unsafe = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: { reason: "question", message: "use token=abc123 <b>now</b>", since: null } }) });
  expect(text(await unsafe.findByTestId("oats-panel-waiting-message"))).toBe("[withheld]");
  // No instant from the kernel: the reason alone, no invented time.
  expect(text(unsafe.getByTestId("oats-panel-waiting-head"))).toBe("Asked you a question");
});

test("Work: the mode in one sentence with the row's own facts, and the paths to copy", async () => {
  const writes: string[] = [];
  vi.stubGlobal("navigator", { clipboard: { writeText: async (value: string) => void writes.push(value) } });
  const slot = panel();
  const work = await slot.findByTestId("oats-panel-work");
  expect(text(within(work).getByRole("heading"))).toBe("Work");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toBe("Works in its own worktree of oats-real, on branch agents/panel-worktree-helper.");
  const paths = slot.getByTestId("oats-panel-paths");
  expect(text(paths.querySelector("summary")!)).toContain("Paths");
  expect(paths.hasAttribute("open")).toBe(false);
  expect(within(paths).getAllByTestId("oats-fact").map((fact) => text(fact.querySelector("dt")!))).toEqual(["Folder", "Home"]);
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
  expect(text(await shared.findByTestId("oats-panel-work-sentence"))).toBe("Works in redesign-ui-lead's tree, sharing its branch and changes.");
  const tag = within(shared.getByTestId("oats-panel-paths")).getByRole("note");
  expect(text(tag)).toBe("shared");
  expect(tag.getAttribute("aria-label")).toBe("shared: A link to the shared tree; changes here are visible to every instance that shares it.");
  const copy = copyOf(shared.getByTestId("oats-panel-home"));
  fireEvent.click(copy);
  await waitFor(() => expect(text(copy)).toBe("Copy failed"));
  shared.unmount();
  const none = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, work: null }) });
  await none.findByTestId("oats-panel-session");
  expect(none.queryByTestId("oats-panel-work")).toBeNull();
});

test("Session: the harness, the model and where it came from, where the session runs and since when, each a labelled fact", async () => {
  const slot = panel();
  const session = await slot.findByTestId("oats-panel-session");
  expect(text(within(session).getByRole("heading"))).toBe("Session");
  expect(within(session).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`)).toEqual([
    "Harness: Claude", "Model: claude-opus-5-5 · the soul's choice", "Runs in: bb threadthr_u2jw8887aw", "Started: 16 min ago",
  ]);
  expect(slot.getByTestId("oats-panel-started").getAttribute("title")).toBe("2026-11-23T18:00:56.149Z · created 2026-11-23T18:00:56.149Z");
  expect(slot.queryByTestId("oats-panel-runtime-error")).toBeNull();
});

test("a home never started says when it was created; the row's runtime error is said with who said it", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, startedAt: null, model: null, runtimeError: "bb did not answer at http://127.0.0.1:38886" }) });
  const session = await slot.findByTestId("oats-panel-session");
  expect(within(session).getAllByTestId("oats-fact").map((fact) => `${text(fact.querySelector("dt")!)}: ${text(fact.querySelector("dd")!)}`)).toEqual([
    "Harness: Claude", "Runs in: bb threadthr_u2jw8887aw", "Created: 16 min ago", "OATS says: bb did not answer at http://127.0.0.1:38886",
  ]);
  // The id is a code on a line of its own, never broken inside.
  expect(slot.getByTestId("oats-panel-session-line").querySelector(".whitespace-nowrap")?.textContent).toBe("thr_u2jw8887aw");
});

test("Messaging & Teams: the messaging id with its copy, only where the row has one", async () => {
  const without = panel();
  await without.findByTestId("oats-panel-session");
  expect(without.queryByTestId("oats-panel-messaging")).toBeNull();
  without.unmount();
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, messagingId: "oats.aweb.ai/panel-worktree-helper" }) });
  const messaging = await slot.findByTestId("oats-panel-messaging");
  expect(text(within(messaging).getByRole("heading"))).toBe("Messaging & Teams");
  expect(text(within(messaging).getByTestId("oats-fact").querySelector("dt")!)).toBe("Messaging ID");
  expect(text(slot.getByTestId("oats-panel-messaging-id"))).toBe("oats.aweb.ai/panel-worktree-helper");
  expect(copyOf(slot.getByTestId("oats-panel-messaging-id")).getAttribute("aria-label")).toBe("Copy messaging ID");
});

test("Lineage: the parent is a link to its thread; the owning human and a sibling are named where the row has them", async () => {
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
  expect(text(await more.findByTestId("oats-panel-lineage"))).toBe("LineageOwning humanAnaSiblingKernel fix developer");
  // an instance that has no thread in bb is named, without a link
  expect(more.getByTestId("oats-panel-sibling").tagName).toBe("SPAN");
});

test("an agent with nothing to say about its lineage has no Lineage section", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, parent: null }) });
  await slot.findByTestId("oats-panel-session");
  expect(slot.queryByTestId("oats-panel-lineage")).toBeNull();
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

test("the soul's name opens the Soul tab: its name, its description, Details with the agents root, and Open soul page", async () => {
  const slot = panel();
  const link = await slot.findByTestId("oats-panel-soul-link");
  link.focus();
  fireEvent.click(link);
  expect(slot.getByTestId("oats-tab-soul").getAttribute("aria-selected")).toBe("true");
  // The link leaves with its page: the focus goes to the tab it opened, never to the body.
  await waitFor(() => expect(document.activeElement).toBe(slot.getByTestId("oats-tab-soul")));
  expect(text(await slot.findByTestId("oats-panel-soul-name"))).toBe("oats-expert");
  expect(text(slot.getByTestId("oats-panel-soul-description"))).toBe("OATS expert: answers questions about OATS.");
  const details = slot.getByTestId("oats-panel-details");
  expect(text(details.querySelector("summary")!)).toContain("Details");
  expect(text(within(details).getByTestId("oats-fact").querySelector("dt")!)).toBe("Agents root");
  expect(text(slot.getByTestId("oats-panel-agents-root"))).toBe("/abs/deployment/agents");
  expect(copyOf(slot.getByTestId("oats-panel-agents-root")).getAttribute("aria-label")).toBe("Copy agents root path");
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
  expect(text(await slot.findByTestId("oats-panel-session-line"))).toBe("tmux sessionoats-agents");
  expect(stateOf(slot)).toBe("Working· started 18:00");
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  // Where its session is and how to reach it: one sentence, and the command to copy (the one function the home's card uses).
  const attach = slot.getByTestId("oats-panel-attach");
  expect(text(attach.querySelector("p")!)).toBe("Runs in tmux on falcon. Attach from a terminal:");
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
  expect(text(await slot.findByTestId("oats-panel-work-sentence"))).toContain("Works in its own worktree");
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
  expect(text(stale)).toContain("Showing what was read 3 min ago."); // 2 min 40 s, in the one shared form (minutes to the nearest one: `readAge`)
  expect(text(stale)).toContain("OATS_TIMEOUT");
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
  expect(stateOf(shell)).toBe("Failed· Its session ended");
  shell.unmount();
  const unreachable = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null, running: null, runtimeState: "unreachable" }) });
  await unreachable.findByTestId("oats-panel-work");
  expect(stateOf(unreachable)).toBe("Unreachable· OATS cannot reach its session");
  unreachable.unmount();
  // The same words for an agent with no thread: a fallback shell is Failed there too, and a pane that is gone Stopped.
  const byName = (change: Partial<Agent>) => {
    const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, waiting: null, ...change } : agent));
    return renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  };
  const tmuxShell = byName({ running: false, runtimeState: "shell" });
  await tmuxShell.findByTestId("oats-panel-work");
  expect(stateOf(tmuxShell)).toBe("Failed· Its session ended");
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
  expect(stateOf(slot)).toBe(`Needs you· waiting 15 min (since ${waitingClock("2026-11-23T18:00:58.993Z", NOW)})`);
});

// One claim rule for bb and tmux (the spec's author, 2026-11-23): a claim is hidden only for an agent the kernel calls stopped.
test("an agent on tmux that the kernel cannot reach still shows what it waits for: a claim wins, as on bb", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, running: null, runtimeState: "unreachable" } : agent));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  await slot.findByTestId("oats-panel-work");
  expect(stateOf(slot)).toBe(`Needs you· waiting 15 min (since ${waitingClock("2026-11-23T18:00:58.993Z", NOW)})`);
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
  // No claim, so no Needs input section: the header says where the question is.
  expect(stateOf(slot)).toBe("Needs you· bb shows its question in this thread");
  expect(slot.queryByTestId("oats-panel-waiting")).toBeNull();
});

test("both headers draw the soul's mark, hidden from a screen reader beside the name it repeats", async () => {
  const slot = panel();
  const mark = within(await slot.findByTestId("oats-panel-header")).getByTestId("oats-soul-mark");
  expect([text(mark), mark.getAttribute("aria-hidden")]).toEqual(["OE", "true"]);
  fireEvent.click(slot.getByTestId("oats-tab-soul"));
  expect(text(within(await slot.findByTestId("oats-panel-soul-header")).getByTestId("oats-soul-mark"))).toBe("OE");
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
  expect(text(stale)).toContain("OATS says: no oats-local.yaml here");
  expect(text(stale)).toContain("E_LOCAL_MISSING");
  expect(text(stale)).toContain("Showing what was read 3 min ago."); // as above: the shared `readAge`
  // Everything it read is still there: the name, the state, the claim, the facts.
  expect(text(slot.getByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  expect(slot.getByTestId("oats-panel-waiting")).not.toBeNull();
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toContain("Works in its own worktree");
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
  expect(text(await slot.findByTestId("oats-panel-work-sentence"))).toContain("Works in its own worktree of oats-real");
  const back = slot.getByTestId("oats-agent-back");
  expect(text(back)).toBe("Back to the thread");
  fireEvent.click(back);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: CHILD_THREAD }]);
});

test("the page of an agent with no thread in bb goes back to Home; a name OATS does not list says so", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null } : agent));
  const tmux = await agentPage(CHILD, { rpc: handlers({ snapshot: () => panelSnapshot(agents) }), sidebarThreads: panelThreads(agents) });
  expect(text(await tmux.findByTestId("oats-panel-name"))).toBe("Panel worktree helper");
  fireEvent.click(tmux.getByTestId("oats-agent-back"));
  expect(tmux.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  tmux.unmount();
  const gone = await agentPage("gone-helper");
  await waitFor(() => expect(text(gone.getByTestId("oats-agent-page"))).toContain("OATS lists no agent named gone-helper in this deployment: it may have been retired."));
  expect(gone.queryByTestId("oats-panel")).toBeNull();
  gone.unmount();
  const none = await agentPage("");
  await waitFor(() => expect(text(none.getByTestId("oats-agent-page"))).toContain("No agent to showThis page shows one agent, and its address names none. Open an agent from the sidebar or the home."));
  // The page of a name OATS does not list has a title too.
  none.unmount();
  const again = await agentPage("gone-helper");
  await waitFor(() => expect(text(again.getByTestId("oats-agent-page"))).toContain("This agent is not in OATS"));
});

test("while OATS cannot be read the page shows the notice every place shows: what happened in words, the kernel's line and code, Retry", async () => {
  const slot = await agentPage(CHILD, { rpc: handlers({ snapshot: () => ({ ok: false as const, at: "2026-11-23T18:16:26.000Z", code: "E_LOCAL_MISSING", message: "no oats-local.yaml here" }) }) });
  const alert = await slot.findByRole("alert");
  expect(text(within(alert).getByRole("heading"))).toBe("OATS could not read this deployment");
  expect(text(alert)).toContain("OATS says: no oats-local.yaml here");
  expect(text(alert)).toContain("E_LOCAL_MISSING");
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
  expect(text(stale)).toContain("It took more than 20 s.");
  // The roster was read moments ago and the read after it failed: never "just now".
  expect(text(stale)).toContain("Showing what was read less than a minute ago.");
  expect(text(slot.getByTestId("oats-agent-back"))).toBe("Back to the thread");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toContain("Works in its own worktree");
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
  await waitFor(() => expect(text(within(slot.getByTestId("oats-panel")).getByRole("alert"))).toContain("OATS could not read this deploymentOATS says: no oats-local.yaml here"));
  expect(text(within(slot.getByTestId("oats-panel")).getByRole("alert"))).toContain("E_LOCAL_MISSING");
  expect(text(slot.getByTestId("oats-agent-back"))).toBe("Back to the thread");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toContain("Works in its own worktree");
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
  expect(text(await within(await slot.findByTestId("oats-panel")).findByRole("alert"))).toContain("OATS could not read this deploymentOATS says: no oats-local.yaml here");
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
  expect(text(notice)).toContain("OATS says: no oats-local.yaml here");
  expect(text(notice)).toContain("E_LOCAL_MISSING");
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

test("an unreachable agent: its header says so in a person's words, what OATS says is one press away under Details there, and not again in the Session card", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null, running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" }), facts: (facts) => ({ ...facts, runtimeError: "bb did not answer" }) });
  await slot.findByTestId("oats-panel-session");
  expect(stateOf(slot)).toBe("Unreachable· OATS cannot reach its session");
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

test("an agent with no thread in bb has its acts on its own page: Start and Retire for one whose thread is gone, Stop and Retire for one on tmux", async () => {
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
  expect(actsOf(tmux)).toEqual(["Stop…", "Retire…"]);
});

test("while the roster is the last one read the acts are off, and say why", async () => {
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
  expect(within(slot.getByTestId("oats-agent-acts")).getByTestId("oats-disabled-reason").textContent).not.toBe("");
});
