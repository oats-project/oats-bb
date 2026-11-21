// @vitest-environment jsdom
// The instance panel's frame, its Instance tab and its Soul tab's frame (parity rows D-124 to
// D-129, D-131, D-136 to D-138), drawn from the roster recorded from the real kernel.
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { InstancePanel } from "../../app/panel/Panel";
import type { PanelInstance } from "../../kernel/panel-instance";
import type { Agent } from "../../model/types";
import { handlers, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";
import { instanceAnswer, panelAgents, panelSnapshot, panelThreads } from "./handlers";

afterEach(() => {
  resetApp();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const CHILD = "panel-worktree-helper";
const CHILD_THREAD = "thr_gx4sgexjgw";
/** A quarter of an hour after the recorded agent's board asked its question (18:14:12Z). */
const NOW = Date.parse("2026-11-21T18:29:30.000Z");

type Change = { agent?: (agent: Agent) => Agent; facts?: (facts: PanelInstance) => PanelInstance };
function panel(props: { threadId?: string; instance?: string } = { threadId: CHILD_THREAD }, change: Change = {}, options: RenderSlotOptions<Contract> = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const agents = panelAgents().map((agent) => (agent.instance === CHILD && change.agent ? change.agent(agent) : agent));
  return renderSlot<{ threadId?: string; instance?: string }, Contract>({ component: InstancePanel }, props, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, instance === CHILD ? change.facts : undefined) }),
    sidebarThreads: panelThreads(agents),
    ...options,
  });
}
const text = (element: HTMLElement) => element.textContent;

test("two tabs, Instance first; the header names the instance, its soul and its state in the tree's word", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: null }) });
  await slot.findByTestId("oats-panel-work");
  expect(within(slot.getByRole("tablist")).getAllByRole("tab").map((tab) => `${text(tab)} ${tab.getAttribute("aria-selected")}`)).toEqual(["Instance true", "Soul false"]);
  expect(text(slot.getByTestId("oats-panel-name"))).toBe(CHILD);
  expect(text(slot.getByTestId("oats-panel-header"))).toContain("instance of");
  expect(text(slot.getByTestId("oats-panel-soul-link"))).toBe("oats-expert");
  // The kernel says neither running nor stopped for an agent idle in bb: the tree's word, never "Not reported".
  expect(text(slot.getByTestId("oats-panel-state"))).toBe("Idle");
  expect(slot.getByTestId("oats-panel-state").querySelector('[data-state="idle"]')).not.toBeNull();
  expect(slot.queryByTestId("oats-panel-drift")).toBeNull();
  expect(slot.queryByTestId("oats-panel-waiting")).toBeNull();
});

test("Running with how long since its last start; Stopped", async () => {
  const running = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: true, waiting: null }) });
  await running.findByTestId("oats-panel-work");
  // started 18:13:36Z, read at 18:29:30Z
  expect(text(running.getByTestId("oats-panel-state"))).toBe("Running · 15m");
  expect(running.getByTestId("oats-panel-state").getAttribute("title")).toBe("started 2026-11-21T18:13:36.478Z");
  running.unmount();
  const stopped = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, running: false, runtimeState: "stopped" }) });
  await stopped.findByTestId("oats-panel-work");
  expect(text(stopped.getByTestId("oats-panel-state"))).toBe("Stopped");
  // A stopped agent's claim belongs to an ended session: it is not shown.
  expect(stopped.queryByTestId("oats-panel-waiting")).toBeNull();
});

test("Needs input: the reason in words, how long and since when, and the agent's message", async () => {
  const slot = panel();
  const waiting = await slot.findByTestId("oats-panel-waiting");
  const since = new Date("2026-11-21T18:14:12.916Z");
  const clock = `${String(since.getHours()).padStart(2, "0")}:${String(since.getMinutes()).padStart(2, "0")}`;
  expect(text(within(waiting).getByRole("heading"))).toBe("Needs input");
  expect(text(slot.getByTestId("oats-panel-waiting-head"))).toBe(`Asked for your attention · waiting 15 min (since ${clock})`);
  expect(text(slot.getByTestId("oats-panel-waiting-message"))).toBe("How should I merge the pull request?");
  expect(text(slot.getByTestId("oats-panel-state"))).toBe("Needs you");
});

test("a claim with no message says the reason alone; its message is drawn as text through the display filter", async () => {
  const bare = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: { reason: "permission", message: null, since: "2026-11-21T18:28:00.000Z" } }) });
  expect(text(await bare.findByTestId("oats-panel-waiting-head"))).toContain("Waiting for a tool approval · waiting 1 min");
  expect(bare.queryByTestId("oats-panel-waiting-message")).toBeNull();
  bare.unmount();
  const unsafe = panel({ threadId: CHILD_THREAD }, { agent: (agent) => ({ ...agent, waiting: { reason: "question", message: "use token=abc123 <b>now</b>", since: null } }) });
  expect(text(await unsafe.findByTestId("oats-panel-waiting-message"))).toBe("[withheld]");
});

test("Work: the mode in one sentence with the row's own facts, and the paths to copy", async () => {
  const writes: string[] = [];
  vi.stubGlobal("navigator", { clipboard: { writeText: async (value: string) => void writes.push(value) } });
  const slot = panel();
  const work = await slot.findByTestId("oats-panel-work");
  expect(text(within(work).getByRole("heading"))).toBe("Work");
  expect(text(slot.getByTestId("oats-panel-work-sentence"))).toBe("Works in its own worktree of oats-real, on branch agents/panel-worktree-helper.");
  const paths = slot.getByTestId("oats-panel-paths");
  expect(text(paths.querySelector("summary")!)).toBe("Paths");
  expect(paths.hasAttribute("open")).toBe(false);
  expect(text(slot.getByTestId("oats-panel-folder"))).toBe("/abs/deployment/agents/oats-expert/instances/panel-worktree-helper/work");
  expect(text(slot.getByTestId("oats-panel-home"))).toBe("/abs/deployment/agents/oats-expert/instances/panel-worktree-helper");
  // its own worktree is not a shared tree
  expect(within(paths).queryByRole("note")).toBeNull();
  const copyFolder = slot.getByTestId("oats-panel-folder-copy");
  expect(copyFolder.getAttribute("aria-label")).toBe("Copy folder path");
  fireEvent.click(copyFolder);
  await waitFor(() => expect(copyFolder.getAttribute("aria-label")).toBe("Copied"));
  expect(slot.getByTestId("oats-panel-home-copy").getAttribute("aria-label")).toBe("Copy home path");
  fireEvent.click(slot.getByTestId("oats-panel-home-copy"));
  await waitFor(() => expect(writes).toEqual(["/abs/deployment/agents/oats-expert/instances/panel-worktree-helper/work", "/abs/deployment/agents/oats-expert/instances/panel-worktree-helper"]));
});

test("a shared tree is tagged shared; a copy the browser refuses says so; a mode the row does not report draws no Work card", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
  const shared = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, work: "attached" }) });
  expect(text(await shared.findByTestId("oats-panel-work-sentence"))).toBe("Works in redesign-ui-lead's tree, sharing its branch and changes.");
  const tag = within(shared.getByTestId("oats-panel-paths")).getByRole("note");
  expect(text(tag)).toBe("shared");
  expect(tag.getAttribute("title")).toBe("A link to the shared tree; changes here are visible to every instance that shares it.");
  fireEvent.click(shared.getByTestId("oats-panel-home-copy"));
  await waitFor(() => expect(shared.getByTestId("oats-panel-home-copy").getAttribute("aria-label")).toBe("Copy failed"));
  shared.unmount();
  const none = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, work: null }) });
  await none.findByTestId("oats-panel-session");
  expect(none.queryByTestId("oats-panel-work")).toBeNull();
});

test("Session: the harness, the model and where it came from, where the session runs and since when", async () => {
  const slot = panel();
  const session = await slot.findByTestId("oats-panel-session");
  expect(text(within(session).getByRole("heading"))).toBe("Session");
  expect(text(slot.getByTestId("oats-panel-harness"))).toBe("Claude");
  expect(text(slot.getByTestId("oats-panel-model"))).toBe("claude-opus-5-5 · the soul's choice");
  expect(text(slot.getByTestId("oats-panel-session-line"))).toBe("bb · thread thr_gx4sgexjgw");
  expect(text(slot.getByTestId("oats-panel-started"))).toBe("started 16 min ago");
  expect(slot.getByTestId("oats-panel-started").getAttribute("title")).toBe("2026-11-21T18:13:36.478Z · created 2026-11-21T18:13:36.478Z");
  expect(slot.queryByTestId("oats-panel-runtime-error")).toBeNull();
});

test("a home never started says when it was created; the row's runtime error is said with who said it", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, startedAt: null, model: null, runtimeError: "bb did not answer at http://127.0.0.1:38886" }) });
  expect(text(await slot.findByTestId("oats-panel-started"))).toBe("created 16 min ago");
  expect(slot.queryByTestId("oats-panel-model")).toBeNull();
  expect(text(slot.getByTestId("oats-panel-runtime-error"))).toBe("OATS says: bb did not answer at http://127.0.0.1:38886");
});

test("Messaging & Teams: the messaging id with its copy, only where the row has one", async () => {
  const without = panel();
  await without.findByTestId("oats-panel-session");
  expect(without.queryByTestId("oats-panel-messaging")).toBeNull();
  without.unmount();
  const slot = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, messagingId: "oats.aweb.ai/panel-worktree-helper" }) });
  const messaging = await slot.findByTestId("oats-panel-messaging");
  expect(text(within(messaging).getByRole("heading"))).toBe("Messaging & Teams");
  expect(text(messaging)).toContain("Messaging ID");
  expect(text(slot.getByTestId("oats-panel-messaging-id"))).toBe("oats.aweb.ai/panel-worktree-helper");
  expect(slot.getByTestId("oats-panel-messaging-id-copy").getAttribute("aria-label")).toBe("Copy messaging ID");
});

test("Lineage: the parent is a link to its thread; the owning human and a sibling are named where the row has them", async () => {
  const slot = panel();
  const lineage = await slot.findByTestId("oats-panel-lineage");
  expect(text(lineage)).toBe("LineageParentredesign-ui-lead");
  const parent = slot.getByTestId("oats-panel-parent");
  expect(parent.tagName).toBe("A");
  fireEvent.click(parent);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: panelAgents().find((agent) => agent.instance === "redesign-ui-lead")!.threadId }]);
  slot.unmount();
  const more = panel({ threadId: CHILD_THREAD }, { facts: (facts) => ({ ...facts, human: "Ana", parent: null, sibling: "kernel-fix-developer" }) });
  expect(text(await more.findByTestId("oats-panel-lineage"))).toBe("LineageOwning humanAnaSiblingkernel-fix-developer");
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
  expect(text(drift.querySelector("summary")!)).toBe("older build");
  expect(text(drift)).toContain("Built from an older state of the workspace:");
  expect(text(drift)).toContain("• Its soul's repository has moved on since it was spawned.");
  expect(text(drift)).toContain("• oats.core has changed since (1.26.0 → 1.27.0).");
  expect(text(drift)).toContain("Re-spawning picks up the new state; this instance keeps what it was built with.");
});

test("the soul's name opens the Soul tab: its name, its description, Details with the agents root, and Open soul page", async () => {
  const slot = panel();
  fireEvent.click(await slot.findByTestId("oats-panel-soul-link"));
  expect(slot.getByTestId("oats-panel-tab-soul").getAttribute("aria-selected")).toBe("true");
  expect(text(await slot.findByTestId("oats-panel-soul-name"))).toBe("oats-expert");
  expect(text(slot.getByTestId("oats-panel-soul-description"))).toBe("OATS expert: answers questions about OATS.");
  const details = slot.getByTestId("oats-panel-details");
  expect(text(details.querySelector("summary")!)).toBe("Details");
  expect(text(details)).toContain("Agents root");
  expect(text(slot.getByTestId("oats-panel-agents-root"))).toBe("/abs/deployment/agents");
  expect(slot.getByTestId("oats-panel-agents-root-copy").getAttribute("aria-label")).toBe("Copy agents root path");
  const open = slot.getByTestId("oats-panel-open-soul");
  expect(text(open)).toBe("Open soul page");
  fireEvent.click(open);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls", options: { subPath: "oats-expert" } }]);
});

test("a soul OATS does not list has no page to open, and says why", async () => {
  const slot = panel({ threadId: CHILD_THREAD }, {}, { rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => ({ ...instanceAnswer(instance), agentsRoot: null, soul: { key: null, description: null } }) }) });
  fireEvent.click(await slot.findByTestId("oats-panel-tab-soul"));
  const open = await slot.findByTestId("oats-panel-open-soul");
  await waitFor(() => expect(open.getAttribute("title")).toBe("OATS lists no soul of this name here: there is no soul page to open."));
  expect((open as HTMLButtonElement).disabled).toBe(true);
  expect(slot.queryByTestId("oats-panel-details")).toBeNull();
  expect(slot.queryByTestId("oats-panel-soul-description")).toBeNull();
});

test("the arrow keys move between the tabs, and the tab a person left the panel on is the one another agent opens on", async () => {
  const slot = panel();
  const instanceTab = await slot.findByTestId("oats-panel-tab-instance");
  fireEvent.keyDown(instanceTab, { key: "ArrowRight" });
  expect(slot.getByTestId("oats-panel-tab-soul").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(slot.getByTestId("oats-panel-tab-soul"));
  expect(slot.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("oats-panel-tab-soul");
  fireEvent.keyDown(slot.getByTestId("oats-panel-tab-soul"), { key: "ArrowRight" });
  expect(instanceTab.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(instanceTab, { key: "End" });
  slot.unmount();
  const other = panel({ instance: "redesign-ui-lead" });
  expect((await other.findByTestId("oats-panel-tab-soul")).getAttribute("aria-selected")).toBe("true");
  expect(text(await other.findByTestId("oats-panel-soul-name"))).toBe("oats-product-expert");
});

test("by instance name, for an agent with no thread in bb: the same panel, its state from the kernel's word", async () => {
  const agents = panelAgents().map((agent) => (agent.instance === CHILD ? { ...agent, backend: "tmux", threadId: null, running: true, waiting: null } : agent));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const slot = renderSlot<{ instance: string }, Contract>({ component: InstancePanel }, { instance: CHILD }, {
    rpc: handlers({ snapshot: () => panelSnapshot(agents), panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, backend: "tmux", threadId: null, tmuxSession: "oats-agents" })) }),
    sidebarThreads: panelThreads(agents),
  });
  expect(text(await slot.findByTestId("oats-panel-session-line"))).toBe("tmux · oats-agents");
  expect(text(slot.getByTestId("oats-panel-state"))).toBe("Running · 15m");
  expect(text(slot.getByTestId("oats-panel-name"))).toBe(CHILD);
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

test("while the instance is read the header is already there; a read that fails says the kernel's refusal, with Retry", async () => {
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
  const alert = await slot.findByRole("alert");
  expect(text(alert)).toContain("E_LOCAL_MISSING");
  expect(text(alert)).toContain("no oats-local.yaml here");
  // what the roster already says stays: the name, the state, the claim
  expect(text(slot.getByTestId("oats-panel-name"))).toBe(CHILD);
  expect(slot.getByTestId("oats-panel-waiting")).not.toBeNull();
  expect(slot.queryByTestId("oats-panel-work")).toBeNull();
  fail = false;
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(text(await slot.findByTestId("oats-panel-work-sentence"))).toContain("Works in its own worktree");
  expect(slot.queryByRole("alert")).toBeNull();
});

test("the panel reads again when OATS changes", async () => {
  let model = "claude-opus-5-5";
  const slot = panel({ threadId: CHILD_THREAD }, {}, { rpc: handlers({ snapshot: () => panelSnapshot(), panelInstance: ({ instance }) => instanceAnswer(instance, (facts) => ({ ...facts, model })) }) });
  expect(text(await slot.findByTestId("oats-panel-model"))).toContain("claude-opus-5-5");
  model = "claude-fable-5.2";
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T18:31:00.000Z" }));
  await waitFor(() => expect(text(slot.getByTestId("oats-panel-model"))).toContain("claude-fable-5.2"));
});
