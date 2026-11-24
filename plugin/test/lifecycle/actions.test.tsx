// @vitest-environment jsdom
// A12: Stop, Start, Restart and Retire in the thread menu (experimental_threadAction), and the
// dialog of each that the plugin's overlay draws: the kernel's plan as what will happen and what
// is kept, the act in progress, its result and its refusal (parity D-158 to D-173).
import { afterEach, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { BbNavigate, PluginThreadAction, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import { UNCONFIRMED_ISSUE } from "../../contract/shared";
import { modelsSdk, retirePlanOf, retireReceiptOf, startCheckOf, startedIn, stopPlanOf, stopReceiptOf } from "./handlers";
import { notified } from "../../app/ui";
import type { Contract, Handlers } from "../helpers/render";
import type { Agent } from "../../model/types";

afterEach(resetApp);

const target = (id: string): PluginThreadActionTarget => {
  const thread = fixtureThreads().find((candidate) => candidate.id === id);
  return {
    id,
    projectId: thread?.projectId ?? "proj_x",
    parentThreadId: null,
    parentNotifications: "off",
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle",
    environment: null,
  };
};

/**
 * What bb does with the plugin's registrations: calls each `useData` in the plugin's scope, asks
 * each `item` for one thread, and mounts the plugin's overlay once per app window.
 */
async function menu(threadId: string, over: Partial<Handlers> = {}, agents?: Agent[], sdk: object = modelsSdk()) {
  const app = await loadApp();
  expect(app.threadActions.map((action) => [action.id, action.group])).toEqual([
    // A group of the plugin's own, which bb sets apart from its own Stop, Archive and Delete ("4_lifecycle") with a separator.
    ["agent", "3_oats"],
    ["stop", "3_oats"],
    ["start", "3_oats"],
    ["restart", "3_oats"],
    ["retire", "3_oats"],
    ["unreadable", "3_oats"],
  ]);
  expect(app.appOverlays).toHaveLength(1);
  const Overlay = app.appOverlays[0]!.component;
  let items: Record<string, PluginThreadAction | null> = {};
  let navigate!: BbNavigate;
  const slot = renderSlot<object, Contract>(
    {
      component: function Menu() {
        navigate = useBbNavigate();
        const next: Record<string, PluginThreadAction | null> = {};
        for (const action of app.threadActions) {
          const data = action.useData!({ threadIds: [threadId] });
          next[action.id] = action.item({ thread: target(threadId), data, sdk: {} as never, navigate, experimental_panel: {} as never });
        }
        items = next;
        return <Overlay />;
      },
    },
    {},
    { rpc: handlers(over, agents), sidebarThreads: sidebarThreads(), sdk: sdk as never },
  );
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  // (The acts that show; the group's first row, which names the agent, has its own test.)
  const shown = () => Object.entries(items).flatMap(([id, item]) => (item === null || id === "agent" ? [] : [id]));
  const pick = (id: string) => items[id]!.run({ requestRename: () => {} });
  return { slot, shown, pick, label: (id: string) => items[id]!.label, item: (id: string) => items[id] ?? null };
}
const calls = (slot: Awaited<ReturnType<typeof menu>>["slot"], ...methods: string[]) =>
  slot.inspection.rpcCalls.filter((call) => methods.includes(call.method));

test("Stop shows on a working agent's thread, and not on a thread that is no agent", async () => {
  const working = await menu("thr_redesign");
  expect(working.shown()).toEqual(["stop", "restart", "retire"]);
  expect(working.label("stop")).toBe("Stop (OATS)"); // the row above names the agent
  resetApp();
  const plain = await menu("thr_plain");
  expect(plain.shown()).toEqual([]);
});

test("an agent the kernel calls stopped beside another word (the stale stop; a tmux-like \"shell\" beside an operator's stop) is offered Start while bb holds a question on its thread", async () => {
  // It counts as needing you (bb's question), so the kernel's own reading of the row is asked: `recordedStopped`.
  for (const change of [{ running: false as const, runtimeState: "unknown", sessionEnd: "stopped" }, { running: false as const, runtimeState: "shell", sessionEnd: "stopped" }]) {
    const agents = fixtureAgents().map((agent): Agent => (agent.instance === "flaky-ci-developer" ? { ...agent, ...change } : agent));
    const { shown } = await menu("thr_ci", {}, agents);
    expect(shown(), JSON.stringify(change)).toContain("start");
    resetApp();
  }
});

test("an agent with no harness loaded that also carries a claim (it is drawn \"Needs you\") is offered Start, and its Start key opens Start: the rule reads the kernel's row, not the drawn state", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false, runtimeState: "unknown" } : agent));
  expect(agents.find((agent) => agent.instance === "flaky-ci-developer")!.waiting).not.toBeNull();
  const { slot, shown } = await menu("thr_ci", {}, agents);
  expect(shown()).toContain("start");
  const { asked, commands } = await import("../../app/lifecycle");
  await commands.find((each) => each.id === "agent-start")!.run({ threadId: "thr_ci", projectId: null, experimental_panel: {} as never });
  expect(asked()).toEqual({ verb: "start", instance: "flaky-ci-developer" });
  expect(notified().map((said) => said.title).join(" ")).not.toMatch(/already running/);
  expect(slot).toBeTruthy();
});

test("an agent whose session ended by itself and that still asks (it is drawn \"Needs you\") is offered Start, and its Start key opens Start", async () => {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "flaky-ci-developer" ? { ...agent, running: false, runtimeState: "shell" } : agent));
  expect(agents.find((agent) => agent.instance === "flaky-ci-developer")!.waiting).not.toBeNull();
  const { shown } = await menu("thr_ci", {}, agents);
  expect(shown()).toContain("start");
  const { asked, commands } = await import("../../app/lifecycle");
  await commands.find((each) => each.id === "agent-start")!.run({ threadId: "thr_ci", projectId: null, experimental_panel: {} as never });
  expect(asked()).toEqual({ verb: "start", instance: "flaky-ci-developer" });
  expect(notified().map((said) => said.title).join(" ")).not.toMatch(/already running/);
});

test("each action shows only in the states it applies to", async () => {
  const by = async (threadId: string, agents?: Agent[]) => {
    const shown = (await menu(threadId, {}, agents)).shown();
    resetApp();
    return shown;
  };
  expect(await by("thr_ci")).toEqual(["stop", "restart", "retire"]); // needs you
  expect(await by("thr_harvest")).toEqual(["stop", "restart", "retire"]); // idle
  expect(await by("thr_digest")).toEqual(["start", "retire"]); // stopped
  const with_ = (change: Partial<Agent>) => fixtureAgents().map((agent) => (agent.instance === "harvest-knowledge-helper" ? { ...agent, ...change } : agent));
  expect(await by("thr_harvest", with_({ runtimeState: "shell" }))).toEqual(["start", "restart", "retire"]); // error
  expect(await by("thr_harvest", with_({ runtimeState: "unreachable" }))).toEqual(["restart", "retire"]);
  // A provider row the kernel calls not running beside "unknown" (its session is there, no harness
  // is loaded) is IDLE, not stopped: the menu is an idle agent's WITH START, since its row says
  // that it does not run ("not loaded"); the thread's own row says what a message and Start each
  // do, with Start (app/outside; the state's rule: test/model/view.test.ts). The key follows the menu.
  expect(await by("thr_harvest", with_({ running: false, runtimeState: "unknown" }))).toEqual(["stop", "start", "restart", "retire"]);
  expect(await by("thr_harvest", with_({ running: false, runtimeState: null }))).toEqual(["start", "retire"]);
  // Stopped while it still carries a claim: it reads Stopped, as on the Desktop (waiting-on-you.mjs
  // `waitingClaim` at 95c7b43b3; the spec's author changed this case on 2026-11-21), and is started.
  expect(await by("thr_harvest", with_({ runtimeState: "stopped", running: false, waiting: { reason: "question", message: "ok?", since: null } }))).toEqual(["start", "retire"]);
});

test("with no roster ever read, every thread's menu has one entry, off, that says OATS can't be read and why: never only bb's own acts", async () => {
  for (const threadId of ["thr_redesign", "thr_plain"]) {
    const { shown, item } = await menu(threadId, { snapshot: () => ({ ok: false, at: "t", code: "OATS_NOT_FOUND", message: "oats: not found", last: null }) });
    expect(shown()).toEqual(["unreadable"]);
    expect(item("unreadable")).toMatchObject({ label: "OATS agents: can't be read", detail: "OATS is not installed on this machine", disabled: true });
    resetApp();
  }
});

// The lead's ruling R4 (2026-11-22) reversed "acts are offered as of <age>": on a roster that is
// the last one read the OATS acts are HELD, as on the Desktop (D-085).
test("while OATS cannot be read after it was, the acts stay in the menu, off, with no reason of their own (the roster's notice says it); nothing runs", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const stale = () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last });
  const { shown, item, slot } = await menu("thr_redesign", { snapshot: stale });
  expect(shown()).toEqual(["stop", "restart", "retire"]);
  for (const id of ["stop", "restart", "retire"]) {
    expect(item(id)).toMatchObject({ disabled: true });
    expect(item(id)).not.toHaveProperty("detail");
  }
  await item("stop")!.run({ requestRename: () => {} });
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain("stopPlan");
  resetApp();
  // A thread that was no agent's has none, and no "can't be read" entry either: the roster is known, as of then.
  expect((await menu("thr_plain", { snapshot: stale })).shown()).toEqual([]);
});

test("with the roster just read the acts are on, with nothing beside them", async () => {
  const { item } = await menu("thr_redesign");
  expect(item("stop")!.detail).toBeUndefined();
  expect(item("stop")!.disabled).toBeUndefined();
});

test("while the first read is in flight the menu says so only once it has taken more than a second", async () => {
  let answer!: (value: ReturnType<typeof fixtureSnapshot>) => void;
  const pending = new Promise<ReturnType<typeof fixtureSnapshot>>((resolve) => (answer = resolve));
  const app = await loadApp();
  let items: Record<string, PluginThreadAction | null> = {};
  const slot = renderSlot<object, Contract>(
    {
      component: function Menu() {
        const navigate = useBbNavigate();
        const next: Record<string, PluginThreadAction | null> = {};
        for (const action of app.threadActions) next[action.id] = action.item({ thread: target("thr_plain"), data: action.useData!({ threadIds: ["thr_plain"] }), sdk: {} as never, navigate, experimental_panel: {} as never });
        items = next;
        return null;
      },
    },
    {},
    { rpc: handlers({ snapshot: () => pending }), sidebarThreads: sidebarThreads() },
  );
  const shown = () => Object.entries(items).flatMap(([id, item]) => (item === null ? [] : [id]));
  expect(shown()).toEqual([]); // a normal start flashes nothing onto the menus
  await waitFor(() => expect(shown()).toEqual(["unreadable"]), { timeout: 3_000 });
  expect(items.unreadable).toMatchObject({ label: "OATS agents: reading…", disabled: true });
  answer(fixtureSnapshot());
  await waitFor(() => expect(shown()).toEqual([]));
  slot.unmount();
});


const button = (slot: Awaited<ReturnType<typeof menu>>["slot"], id: string) => slot.getByTestId(id) as HTMLButtonElement;
const ready = (slot: Awaited<ReturnType<typeof menu>>["slot"]) => waitFor(() => expect(slot.getByTestId("oats-confirm").getAttribute("data-phase")).toBe("ready"));
const phase = (slot: Awaited<ReturnType<typeof menu>>["slot"], kind: string) => waitFor(() => expect(slot.getByTestId("oats-confirm").getAttribute("data-phase")).toBe(kind));
/** The texts of what `selector` finds in `root`, outside a disclosure: what is on screen before Details is pressed. */
const texts = (root: HTMLElement, selector: string) =>
  Array.from(root.querySelectorAll(selector))
    .filter((node) => root.tagName === "DETAILS" || node.closest("details") === null)
    .map((node) => node.textContent);
/** The dialog's lines before the act, in view and under no heading: the one consequence line, and at most one more. */
const says = (slot: Awaited<ReturnType<typeof menu>>["slot"]) => (slot.queryByTestId("oats-confirm-says") === null ? [] : texts(slot.getByTestId("oats-confirm-says"), "li"));
/** What is under a dialog's ONE Details (closed until pressed): `id` is the fold's test id. */
const under = (slot: Awaited<ReturnType<typeof menu>>["slot"], id: string, selector = "li") => {
  const fold = slot.getByTestId(id);
  expect(fold.tagName).toBe("DETAILS");
  expect((fold as HTMLDetailsElement).open).toBe(false);
  expect(fold.querySelector("summary")!.textContent).toBe("▸Details");
  return texts(fold, selector);
};
/** The dialog has no section heading (the four that the cut removed), and one fold at most. */
const plain = (slot: Awaited<ReturnType<typeof menu>>["slot"]) => {
  const dialog = slot.getByTestId("oats-confirm");
  expect(Array.from(dialog.querySelectorAll("h3")).map((heading) => heading.textContent).filter((text) => ["What will happen", "What is kept", "Before you confirm", "Current state"].includes(text ?? ""))).toEqual([]);
  expect(dialog.querySelectorAll("details").length).toBeLessThanOrEqual(1);
};

// ---- Stop (D-167, D-168, D-171) ----

test("Stop opens a dialog titled with the act and the agent, says its one consequence line and who else it stops, the facts that are a reason not to confirm, the rest under Details, and asks the kernel for nothing more", async () => {
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => stopReceiptOf() });
  expect(slot.queryByRole("dialog")).toBeNull();
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  await ready(slot);
  expect(dialog.querySelector("h2")!.textContent).toBe("Stop Redesign ui lead?");
  // In view, under no heading: what a stop means for its thread (this provider does not archive it: the warning), then who else it stops.
  expect(says(slot)).toEqual(["A message in its thread starts it outside OATS.", "Also stops: Desktop mockups developer, Harvest knowledge helper."]);
  // The warning keeps the warning tone; who else it stops is plain.
  expect(Array.from(slot.getByTestId("oats-confirm-says").querySelectorAll("li")).map((line) => line.getAttribute("data-tone"))).toEqual(["warning", null]);
  plain(slot);
  // An agent with uncommitted work is said before the act (the plan's own observation), under no heading: ONE line
  // per agent, in regular weight, its facts as words after its name. And who works on a turn now: bb's own word on
  // each one's thread (the fixture's two are in a turn), after its work. The third agent has neither: no line.
  expect(Array.from(slot.getByTestId("oats-plan-attention").querySelectorAll("li")).some((line) => line.className.includes("font-semibold"))).toBe(false);
  expect(slot.getByTestId("oats-plan-attention").querySelector("h3")).toBeNull();
  expect(texts(slot.getByTestId("oats-plan-attention"), "li")).toEqual([
    "Redesign ui lead · uncommitted work · mid-turn",
    "Desktop mockups developer · uncommitted work · mid-turn",
  ]);
  // One press away, under the dialog's one Details: that nothing is deleted, and the state of each session.
  expect(under(slot, "oats-plan-details")).toEqual(["Nothing is deleted."]);
  expect(under(slot, "oats-plan-details", "dt")).toEqual(["Redesign ui lead", "Desktop mockups developer", "Harvest knowledge helper"]);
  // Nothing the cut removed is anywhere in the dialog.
  expect(slot.getByTestId("oats-confirm").textContent).not.toMatch(/nothing is forced|Stops \d+ sessions|transcript|To talk to it again|Observed/);
  // The button is named for the act; a stop ends something a person may want running, so the focus starts on Cancel.
  expect(button(slot, "oats-confirm-act").textContent).toBe("Stop");
  await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-cancel")));
  expect(calls(slot, "stopPlan", "stopApply").map((call) => call.method)).toEqual(["stopPlan"]); // asked once, nothing applied
});

test("Stop applies the plan with its revision, a key and its choice; the act in progress and the result are said in the dialog", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => held.then(() => stopReceiptOf()) });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(slot.getByTestId("oats-confirm-running").textContent).toBe("Stopping…");
  // While it runs the act cannot be asked twice, and the dialog can be left by its Close (no line says so): its result is never lost
  // (it is told through the toaster then: the tests of "a way out of a dialog whose act runs", below).
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(slot.queryByTestId("oats-confirm-leave-line")).toBeNull();
  expect(button(slot, "oats-confirm-leave").textContent).toBe("Close");
  release();
  await phase(slot, "done");
  const result = slot.getByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("3 sessions stopped.");
  // The title is the result: no row for a session that stopped. One line more, since bb did not archive the thread: the warning.
  expect(texts(result, "p")).toEqual(["A message in its thread starts it outside OATS."]);
  await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-close"))); // (the focus moves in an effect, after the phase is drawn)
  const made = calls(slot, "stopPlan", "stopApply");
  expect(made.map((call) => call.method)).toEqual(["stopPlan", "stopApply"]);
  expect(made[0]!.input).toEqual({ instance: "redesign-ui-lead", recursive: true });
  const apply = made[1]!.input as { instance: string; revision: string; key: string; recursive: boolean };
  expect(apply).toMatchObject({ instance: "redesign-ui-lead", revision: "9c1f2e3d4b5a69788796a5b4", recursive: true });
  expect(apply.key).toMatch(/^[0-9a-f]{32}$/);
  fireEvent.click(button(slot, "oats-confirm-close"));
  expect(slot.queryByRole("dialog")).toBeNull();
});

test("Include child instances: unticking it reads the plan again for the agent alone, keeps the plan on screen meanwhile, and the apply names the choice", async () => {
  const whole = stopPlanOf();
  const alone = { ...whole, revision: "aaaaaaaaaaaaaaaaaaaaaaaa", recursive: false, targets: whole.targets.slice(0, 1), skipped: whole.targets.slice(1).map((target) => target.instance) };
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: ({ recursive }) => (recursive === false ? held.then(() => alone) : whole),
    stopApply: () => ({ ...stopReceiptOf(), results: stopReceiptOf().results.slice(2) }),
  });
  await pick("stop");
  await ready(slot);
  const tick = within(slot.getByTestId("oats-plan-choice")).getByRole("switch");
  expect(tick.textContent).toBe("Include child instancesOn");
  expect(tick.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(tick);
  // The plan under review stays; nothing can be confirmed until the new one is read, and the dialog says why.
  expect(says(slot)).toContain("Also stops: Desktop mockups developer, Harvest knowledge helper.");
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(slot.getByTestId("oats-confirm-blocked").textContent).toBe("Checking…");
  release();
  // The plan for the agent alone: its one line, and nobody else named; the tick, off, says that children are left out.
  await waitFor(() => expect(says(slot)).toEqual(["A message in its thread starts it outside OATS."]));
  expect(within(slot.getByTestId("oats-plan-choice")).getByRole("switch").textContent).toBe("Include child instancesOff");
  expect(slot.getByTestId("oats-confirm").textContent).not.toMatch(/Not stopped:|Desktop mockups developer/);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Redesign ui lead stopped.");
  expect(calls(slot, "stopApply")[0]!.input).toMatchObject({ revision: "aaaaaaaaaaaaaaaaaaaaaaaa", recursive: false });
});

test("Cancel calls neither apply; Escape cancels too", async () => {
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf() });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-cancel"));
  expect(slot.queryByRole("dialog")).toBeNull();

  await pick("stop");
  fireEvent.keyDown(await slot.findByRole("dialog"), { key: "Escape" });
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(calls(slot, "stopApply", "retireApply")).toEqual([]);
});

test("until the plan is read the dialog names no agent, says what it checks, and cannot be confirmed", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => held.then(() => stopPlanOf()) });
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  expect(dialog.querySelector("h2")!.textContent).toBe("Stop an agent");
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  release();
  await ready(slot);
  expect(button(slot, "oats-confirm-act").disabled).toBe(false);
});

test("the dialog names the agent from the kernel's plan, never from the row that was pressed; a plan that is another agent's is not shown and cannot be confirmed", async () => {
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf("flaky-ci-developer") });
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  await ready(slot);
  expect(dialog.querySelector("h2")!.textContent).toBe("Stop Flaky ci developer?");
  expect(dialog.textContent).toContain("This is not the plan for this agent.");
  // Nothing of the other agent's plan is drawn: no consequence line, no facts, no Details.
  expect(slot.queryByTestId("oats-confirm-says")).toBeNull();
  expect(slot.queryByTestId("oats-plan")).toBeNull();
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
});

test("a plan that changed under the confirmation (E_PLAN_STALE) comes back for review, NOT armed: what changed is said first, the focus is on Cancel, and only Review again makes it confirmable, with a new key", async () => {
  let stale = true;
  const first = stopPlanOf();
  // As it is now: one child stopped by itself meanwhile.
  const fresh = { ...first, revision: "bbbbbbbbbbbbbbbbbbbbbbbb", targets: first.targets.map((target) => (target.instance === "harvest-knowledge-helper" ? { ...target, session: "none" as const } : target)) };
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => (stale ? first : fresh),
    stopApply: ({ revision }) => {
      if (revision !== fresh.revision) {
        stale = false;
        throw new Error("E_PLAN_STALE: the stop plan changed since it was shown; review the fresh plan");
      }
      return stopReceiptOf();
    },
  });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  const notice = await slot.findByTestId("oats-notice");
  expect(notice.querySelector("h3")!.textContent).toBe("Something changed since you opened this");
  expect(texts(notice, "p")).toEqual(["Harvest knowledge helper: its session was running, and is now not running."]);
  // The notice is the first thing in the dialog, above the plan as it is now.
  expect(slot.getByTestId("oats-confirm").firstElementChild).toBe(notice);
  expect(says(slot)).toEqual(["A message in its thread starts it outside OATS.", "Also stops: Desktop mockups developer, Harvest knowledge helper."]); // the plan as it is now, under the notice
  // Not armed: a second Enter confirms nothing. No words beside the button: the notice over the plan says why, and has Review again.
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(slot.queryByTestId("oats-confirm-blocked")).toBeNull();
  expect(within(notice).getByTestId("oats-plan-review").textContent).toBe("Review again");
  await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-cancel")));
  fireEvent.click(button(slot, "oats-confirm-act"));
  expect(calls(slot, "stopApply")).toHaveLength(1);
  fireEvent.click(button(slot, "oats-plan-review"));
  await waitFor(() => expect(button(slot, "oats-confirm-act").disabled).toBe(false));
  expect(slot.queryByTestId("oats-notice")).toBeNull();
  expect(calls(slot, "stopPlan")).toHaveLength(3); // the first, the one after the refusal, and the review
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  const applies = calls(slot, "stopApply").map((call) => call.input as { revision: string; key: string });
  expect(applies.map((apply) => apply.revision)).toEqual(["9c1f2e3d4b5a69788796a5b4", fresh.revision]);
  expect(applies[0]!.key).not.toBe(applies[1]!.key);
});

test("a plan that changed in nothing a person is shown says so, and is still reviewed again before it can be confirmed", async () => {
  let stale = true;
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => ({ ...stopPlanOf(), revision: stale ? "9c1f2e3d4b5a69788796a5b4" : "cccccccccccccccccccccccc" }),
    stopApply: () => {
      stale = false;
      throw new Error("E_PLAN_STALE: the stop plan changed since it was shown; review the fresh plan");
    },
  });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  expect(texts(await slot.findByTestId("oats-notice"), "p")).toEqual(["Nothing shown differs."]);
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
});

test("a refused apply leads with a person's words; the kernel's message and its code are under Details; Review again reads a new plan", async () => {
  const { slot, pick } = await menu("thr_digest", {
    retirePlan: () => retirePlanOf(),
    retireApply: () => {
      throw new Error("E_CHILDREN_RUNNING: 1 child still runs: digest-links-helper\n  stop it first");
    },
  });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  const result = slot.getByTestId("oats-result");
  expect(result.getAttribute("role")).toBe("alert");
  expect(result.querySelector("h3")!.textContent).toBe("Weekly digest helper wasn't retired");
  expect(texts(result, "p")).toEqual(["A child instance wouldn't stop, so nothing was retired. Other children may already have stopped."]);
  // The kernel's own message is one press away, each of its lines a line; and its code with it: the result's ONE fold.
  const details = slot.getByTestId("oats-act-details");
  expect((details as HTMLDetailsElement).open).toBe(false);
  expect(texts(details, "span.block")).toEqual(["1 child still runs: digest-links-helper", "stop it first"]);
  expect(texts(details, "code")).toEqual(["E_CHILDREN_RUNNING"]);
  expect(result.querySelectorAll("details")).toHaveLength(1);
  await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-close"))); // (the focus moves in an effect, after the phase is drawn)
  fireEvent.click(button(slot, "oats-act-review"));
  await ready(slot);
  expect(calls(slot, "retirePlan")).toHaveLength(2);
});

test("an apply whose answer was lost is \"Result not confirmed\": Check again asks for the answer to what was sent, with the same revision and key", async () => {
  let lost = true;
  const { slot, pick } = await menu("thr_digest", {
    retirePlan: () => retirePlanOf(),
    retireApply: () => {
      if (lost) throw new Error("OATS_TIMEOUT: `oats` did not answer within 1500 s and was stopped");
      return { ...retireReceiptOf(), replayed: true };
    },
  });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown")); // neither done nor failed
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Result not confirmed");
  expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["Check again before assuming nothing happened."]);
  expect(texts(slot.getByTestId("oats-act-details"), "code")).toEqual(["OATS_TIMEOUT"]); // the code, under Details
  expect(slot.queryByTestId("oats-act-review")).toBeNull();
  lost = false;
  fireEvent.click(button(slot, "oats-act-check"));
  await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("done"));
  // That it is a result read a second time is under Details, not a line of its face.
  expect(texts(slot.getByTestId("oats-result"), "p").join(" ")).not.toContain("already recorded");
  expect(slot.getByTestId("oats-act-details").textContent).toContain("This is the result already recorded for this confirmation; nothing ran again.");
  const applies = calls(slot, "retireApply").map((call) => call.input as { revision: string; key: string });
  expect(applies).toHaveLength(2);
  expect(applies[0]).toEqual(applies[1]);
});

test("a plan the kernel refuses to give says what could not be checked, in words, with Review again and nothing to confirm", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => {
      throw new Error("E_LIFECYCLE_BUSY: redesign-ui-lead is being retired");
    },
  });
  await pick("stop");
  await phase(slot, "failed");
  const result = slot.getByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("Couldn't check Redesign ui lead");
  expect(texts(result, "span.block")).toEqual(["Nothing was done: OATS refused this as busy.", "Nothing was changed."]);
  expect(texts(slot.getByTestId("oats-act-details"), "code")).toEqual(["E_LIFECYCLE_BUSY"]); // the code, under Details with the kernel's line
  expect(slot.queryByTestId("oats-confirm-act")).toBeNull();
  expect(slot.getByTestId("oats-act-review")).toBeTruthy();
});

test("when OATS itself cannot be read, the dialog shows the notice every place shows, with Retry", async () => {
  let down = true;
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => {
      if (down) throw new Error("OATS_NOT_FOUND: `oats` could not be run (ENOENT)");
      return stopPlanOf();
    },
  });
  await pick("stop");
  const notice = await slot.findByTestId("oats-unreadable");
  expect(notice.getAttribute("data-code")).toBe("OATS_NOT_FOUND");
  down = false;
  fireEvent.click(within(notice).getByText("Retry"));
  await ready(slot);
});

test("an agent the kernel no longer knows: the dialog says it is not in OATS any more, nothing can be confirmed or tried again, and its row says so until the next roster", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => {
      throw new Error('E_SESSION_UNKNOWN: no instance "redesign-ui-lead" under /abs/deployment/agents'); // the kernel's form (test/roster/gone.test.tsx reads the recorded ones)
    },
  });
  await pick("stop");
  await phase(slot, "failed");
  const result = slot.getByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("Redesign ui lead is not in OATS any more");
  expect(result.textContent).toContain("Nothing was changed.");
  expect(result.textContent).toContain("E_SESSION_UNKNOWN");
  expect(slot.queryByTestId("oats-confirm-act")).toBeNull();
  expect(slot.queryByTestId("oats-act-review")).toBeNull();
});

test("text of the kernel's in a dialog is drawn through the display filter: a name that looks like a secret is withheld", async () => {
  const plan = stopPlanOf();
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => ({ ...plan, ambiguous: ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"] }) });
  await pick("stop");
  await ready(slot);
  expect(slot.getByTestId("oats-plan").textContent).not.toContain("ghp_");
});

// ---- Retire (D-169, D-170, D-171) ----

test("Retire opens a dialog that says it cannot be undone and who else it stops; what goes and what stays is under Details; it is destructive, so the focus starts on Cancel", async () => {
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf() });
  await pick("retire");
  const dialog = await slot.findByRole("dialog");
  await ready(slot);
  expect(dialog.querySelector("h2")!.textContent).toBe("Retire Weekly digest helper?");
  // In view, under no heading: the one consequence line, then who else it stops. No box: nothing here is a reason not to confirm.
  expect(says(slot)).toEqual(["This cannot be undone.", "Also stops: Digest links helper."]);
  plain(slot);
  expect(slot.queryByTestId("oats-plan-attention")).toBeNull();
  // One press away: what goes and what stays, and the current state.
  expect(under(slot, "oats-plan-details")).toEqual(["Deletes its home.", "Keeps its worktree, moved aside, on branch agents/weekly-digest-helper."]);
  expect(under(slot, "oats-plan-details", "dt, dd")).toEqual(["Session", "Not running", "Uncommitted work", "1 untracked", "Branch", "agents/weekly-digest-helper"]);
  expect(dialog.textContent).not.toMatch(/won't stop|pull requests|stays readable|recovery copy|Observed/);
  // None of the kernel's own notes is pasted (the first UX read's S9).
  expect(dialog.textContent).not.toContain("SIGTERM");
  expect(dialog.textContent).not.toContain("the ADE reports");
  expect(button(slot, "oats-confirm-act").textContent).toBe("Retire");
  await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-cancel")));
});

test("Also delete the worktree: what is lost is said AT the tick, under its label, only while it is ticked, counted and said once; the dialog's lines stay; and the apply asks for it", async () => {
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => ({ ...retireReceiptOf(), worktree: "removed" as const, movedTo: null }) });
  await pick("retire");
  await ready(slot);
  const tick = within(slot.getByTestId("oats-plan-choice")).getByRole("switch");
  expect(tick.textContent).toBe("Also delete the worktreeOff");
  expect(tick.getAttribute("aria-checked")).toBe("false");
  expect(slot.queryByTestId("oats-plan-warning")).toBeNull();
  fireEvent.click(tick);
  // The dialog's lines stay: who else it stops is a safety fact, in view. What the tick deletes is the tick's own line, right under it, in the destructive tone.
  expect(says(slot)).toEqual(["This cannot be undone.", "Also stops: Digest links helper."]);
  const warning = slot.getByTestId("oats-plan-warning");
  expect([warning.textContent, warning.getAttribute("role"), warning.className.includes("text-destructive-text")]).toEqual(["Deletes 1 uncommitted change too (a copy is saved).", "status", true]);
  expect(warning.previousElementSibling).toBe(slot.getByTestId("oats-plan-choice"));
  expect(under(slot, "oats-plan-details")).toEqual(["Deletes its home."]);
  // Unticked again: the line goes with it.
  fireEvent.click(tick);
  expect(slot.queryByTestId("oats-plan-warning")).toBeNull();
  fireEvent.click(tick);
  expect(slot.getByTestId("oats-confirm").textContent).not.toContain("Keeps its worktree");
  // Said once.
  expect(slot.getByTestId("oats-confirm").textContent!.split("uncommitted change").length - 1).toBe(1);
  expect(calls(slot, "retirePlan")).toHaveLength(1); // the plan is the same: only what the apply asks changes
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "retireApply")[0]!.input).toMatchObject({ instance: "weekly-digest-helper", revision: "ef5028f1e6cb517560247307", discardWorktree: true });
  // The result says no step that only repeats what was asked; and nothing of a worktree that was kept.
  expect(texts(slot.getByTestId("oats-result"), "p").join(" ")).not.toMatch(/Worktree deleted|Worktree kept|Home folder deleted/);
});

test("Retire without the tick applies the plan and keeps the worktree; the result is the facts a person needs later", async () => {
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => retireReceiptOf() });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  const result = slot.getByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("Weekly digest helper retired.");
  expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Retire Weekly digest helper"); // answered: the title asks nothing
  expect(texts(result, "p")).toEqual([
    "1 child instance stopped and kept.",
    "Worktree kept, at:",
    "/abs/deployment/.agents/worktrees/oats-real/agents-weekly-digest-helper",
    "Recovery copy saved at:",
    "/abs/deployment/agents/oats-expert/instances/.oats-retirement/recovery/weekly-digest-helper-mVOWdW",
    "Conversation archived in bb.",
  ]);
  expect(calls(slot, "retireApply")[0]!.input).toMatchObject({ discardWorktree: false });
});

test("an agent with no worktree of its own is offered no tick", async () => {
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => ({ ...retirePlanOf(), ownWorktree: false, workMode: "directory" }) });
  await pick("retire");
  await ready(slot);
  expect(slot.queryByTestId("oats-plan-choice")).toBeNull();
  expect(under(slot, "oats-plan-details")).toContain("It has no worktree of its own, so no worktree is kept or deleted. A tree it links to is not touched.");
});

test("a retire the kernel would refuse is blocked, and the reason beside Retire says what to do first; Check again, under the dialog's Details, reads the plan again (the second UX read's A9)", async () => {
  const blocked = { ...retirePlanOf(), extraTrees: [{ path: "/h/.work-docs", branch: "agents/x-docs", disposition: "refuse", reason: "its target exists" }] };
  let mended = false;
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => (mended ? retirePlanOf() : blocked) });
  await pick("retire");
  await ready(slot);
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(slot.getByTestId("oats-confirm-blocked").textContent).toBe("OATS would refuse: remove its extra worktree on agents/x-docs first.");
  mended = true;
  // Check again is one press away, under Details: not on the dialog's face.
  expect(slot.getByTestId("oats-plan-check").closest("details")).toBe(slot.getByTestId("oats-plan-details"));
  fireEvent.click(within(slot.getByTestId("oats-plan-observed")).getByText("Check again"));
  await waitFor(() => expect(button(slot, "oats-confirm-act").disabled).toBe(false));
  expect(slot.queryByTestId("oats-confirm-blocked")).toBeNull();
});

// ---- Start and Restart (D-158 to D-166) ----

test("Start opens a dialog first: nothing is started on one press; it checks the agent as the kernel has it now and is titled with that", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => startedIn("thr_digest_2") }); // (an operator's stop: the recorded row)
  await pick("start");
  const dialog = await slot.findByRole("dialog");
  await ready(slot);
  expect(calls(slot, "start", "restart")).toEqual([]);
  expect(dialog.querySelector("h2")!.textContent).toBe("Start Weekly digest helper");
  // In view, under no heading: the ONE consequence line. A start always makes a NEW conversation (on bb in a new thread).
  expect(says(slot)).toEqual(["Starts a new conversation."]);
  plain(slot);
  // Not cut off (the kernel says stopped): nothing points at its thread.
  expect(slot.queryByTestId("oats-start-thread")).toBeNull();
  // One press away, under the dialog's one Details: a start from bb runs in bb's full mode (there is no control for it), and the agent's facts.
  expect(under(slot, "oats-start-details", "p")).toEqual(["Runs in bb's full mode: no sandbox."]);
  expect(under(slot, "oats-start-details", "dt, dd")).toEqual(["Machine", "falcon", "Home", "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper"]);
  expect(dialog.textContent).not.toMatch(/existing home|saved briefing|stays readable/);
  // A start that can run says nothing more: no status line, and no "Refresh status" (it is for a Start that is off).
  expect(slot.queryByTestId("oats-start-status")).toBeNull();
  expect(slot.queryByTestId("oats-start-refresh")).toBeNull();
  expect(button(slot, "oats-confirm-act").disabled).toBe(false);
  // The harness field starts on the recorded harness; the focus on the form's first field.
  const harness = slot.getByTestId("oats-start-harness") as HTMLSelectElement;
  expect(harness.value).toBe("");
  expect(texts(harness, "option")).toEqual(["Keep the recorded harness: Claude Code", "Claude Code", "pi"]);
  // Under the model field: that the choice outlives this start, and no more.
  expect(slot.getByTestId("oats-start").textContent).toContain("Saved for later starts too.");
  expect(slot.getByTestId("oats-start").textContent).not.toMatch(/Leave blank|No model suggestions/);
  await waitFor(() => expect(document.activeElement).toBe(harness));
  expect(button(slot, "oats-confirm-act").textContent).toBe("Start");
});

test("Start with nothing chosen passes neither a harness nor a model; the thread the kernel answers with opens, and the dialog says that it started", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => startedIn("thr_digest_2") });
  await pick("start");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: "weekly-digest-helper" }]);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_digest_2" }]);
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Weekly digest helper started.");
});

test("a chosen harness and a typed model are passed; a model that is no model name is refused before any call", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => startedIn("thr_digest_2") });
  await pick("start");
  await ready(slot);
  fireEvent.change(slot.getByTestId("oats-start-harness"), { target: { value: "pi" } });
  const model = slot.getByTestId("oats-start-model") as HTMLInputElement;
  fireEvent.change(model, { target: { value: "--yolo" } });
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(slot.getByRole("alert").textContent).toBe("Enter a model name, not a command-line option.");
  fireEvent.change(model, { target: { value: " anthropic/claude-opus-5-5 " } });
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: "weekly-digest-helper", harness: "pi", model: "anthropic/claude-opus-5-5" }]);
});

test("with one harness declared no choice is shown, and the focus starts on the model", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, { harnesses: ["claude"] }) });
  await pick("start");
  await ready(slot);
  expect(slot.queryByTestId("oats-start-harness")).toBeNull();
  expect(under(slot, "oats-start-details", "dt, dd").slice(0, 2)).toEqual(["Harness", "Claude Code"]); // the recorded one, as a fact, under Details
  await waitFor(() => expect(document.activeElement).toBe(slot.getByTestId("oats-start-model")));
});

test("Restart opens its dialog with its one line, that it stops what the agent does now, and nothing restarts until its button is pressed", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_redesign", { startCheck: ({ instance }) => startCheckOf(instance, { running: true, runtimeState: "unknown" }), restart: () => held.then(() => startedIn("thr_redesign_2", "redesign-ui-lead")) });
  await pick("restart");
  const dialog = await slot.findByRole("dialog");
  await ready(slot);
  expect(dialog.querySelector("h2")!.textContent).toBe("Restart Redesign ui lead");
  expect(says(slot)).toEqual(["Stops what it is doing now."]);
  plain(slot);
  // Under Details: that it starts a new conversation too, and bb's full mode.
  expect(under(slot, "oats-start-details", "p")).toEqual(["Starts a new conversation.", "Runs in bb's full mode: no sandbox."]);
  expect(calls(slot, "restart")).toEqual([]);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(slot.getByTestId("oats-confirm-running").textContent).toBe("Restarting…");
  release();
  await phase(slot, "done");
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Redesign ui lead restarted.");
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_redesign_2" }]);
});

test("a refused start says in words what was not started, with the kernel's line and its code under Details; Refresh status reads the agent again before another try", async () => {
  const { slot, pick } = await menu("thr_digest", {
    startCheck: ({ instance }) => startCheckOf(instance),
    start: () => {
      throw new Error("E_SESSION_START_BUSY: a start is already in progress for weekly-digest-helper");
    },
  });
  await pick("start");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  const result = slot.getByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("Weekly digest helper wasn't started");
  expect(texts(result, "p")).toEqual(["OATS refused this start as busy. Nothing was started."]);
  expect(texts(slot.getByTestId("oats-act-details"), "p")).toEqual(["a start is already in progress for weekly-digest-helper"]);
  expect(texts(slot.getByTestId("oats-act-details"), "code")).toEqual(["E_SESSION_START_BUSY"]);
  expect(slot.inspection.navigateCalls).toEqual([]);
  fireEvent.click(button(slot, "oats-start-refresh"));
  await ready(slot);
  expect(calls(slot, "startCheck")).toHaveLength(2);
});

test("a start that stopped at a launch prompt, or whose answer was lost, is neither called started nor failed", async () => {
  for (const [refusal, title] of [
    ["E_SPAWN_INCOMPLETE: launch requires inspection", "OATS could not confirm that Weekly digest helper finished starting"],
    ["OATS_TIMEOUT: `oats` did not answer within 120 s and was stopped", "OATS didn't confirm the start"],
    ["NO_THREAD_NAMED: Started weekly-digest-helper, but the kernel named no bb thread for it", "Weekly digest helper was started, but its thread isn't ready yet"],
  ] as const) {
    const { slot, pick } = await menu("thr_digest", {
      startCheck: ({ instance }) => startCheckOf(instance),
      start: () => {
        throw new Error(refusal);
      },
    });
    await pick("start");
    await ready(slot);
    fireEvent.click(button(slot, "oats-confirm-act"));
    await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
    expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe(title);
    resetApp();
  }
});

test("Start on an agent the kernel says runs is held: the dialog says so and offers its thread", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, { running: true, runtimeState: "unknown" }) });
  await pick("start");
  await ready(slot);
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(slot.getByTestId("oats-confirm-blocked").textContent).toBe("This instance is already running.");
  fireEvent.click(within(slot.getByTestId("oats-start-status")).getByText("Open Weekly digest helper"));
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_digest" }]);
  expect(calls(slot, "start")).toEqual([]);
});

test("Start on an agent whose state the kernel cannot tell is held until its status is read again", async () => {
  let known = false;
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => (known ? startCheckOf(instance) : startCheckOf(instance, { running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" })) });
  await pick("start");
  await ready(slot);
  expect(slot.getByTestId("oats-confirm-blocked").textContent).toBe("Could not verify whether this instance is running. Refresh its status before starting.");
  known = true;
  fireEvent.click(button(slot, "oats-start-refresh"));
  await waitFor(() => expect(button(slot, "oats-confirm-act").disabled).toBe(false));
});

test("the Start dialog is titled from the kernel's answer; an answer for another agent is not shown and cannot be confirmed", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: () => startCheckOf("flaky-ci-developer") });
  await pick("start");
  const dialog = await slot.findByRole("dialog");
  await ready(slot);
  expect(dialog.querySelector("h2")!.textContent).toBe("Start Flaky ci developer");
  expect(dialog.textContent).toContain("This is not the plan for this agent.");
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
});

test("an act that ends after the person opened another act's dialog leaves their screen alone and tells them through the toaster, with Open", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => held.then(() => startedIn("thr_digest_2")), retirePlan: () => retirePlanOf() });
  const before = notified().length;
  await pick("start");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  await pick("retire"); // from a menu: the running dialog gives way to the one just asked
  await waitFor(() => expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Retire Weekly digest helper?"));
  release();
  await waitFor(() => expect(notified().length).toBe(before + 1));
  expect(notified().at(-1)).toMatchObject({ tone: "done", title: "Weekly digest helper started.", open: { label: "Open Weekly digest helper" } });
  expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Retire Weekly digest helper?");
  expect(slot.inspection.navigateCalls).toEqual([]);
});

// ---- the four acts as commands, with their shortcuts (D-174)

test("each act is a command of bb's palette with a default shortcut a person rebinds: the Desktop's letters on bb's own chord", async () => {
  const { commands } = await import("../../app/lifecycle");
  expect(commands.map((command) => [command.id, command.title, command.defaultShortcut])).toEqual([
    ["agent-stop", "OATS: Stop agent…", { key: "x", alt: true, shift: true }],
    ["agent-start", "OATS: Start agent…", { key: "s", alt: true, shift: true }],
    ["agent-restart", "OATS: Restart agent…", { key: "r", alt: true, shift: true }],
    ["agent-retire", "OATS: Retire agent…", { key: "d", alt: true, shift: true }],
  ]);
});

test("a command acts on the agent whose thread is in view: it opens the act's dialog; where it cannot act it says why in one line, and does nothing", async () => {
  const { slot } = await menu("thr_redesign", { stopPlan: () => stopPlanOf() });
  const { commands } = await import("../../app/lifecycle");
  const command = (id: string) => commands.find((each) => each.id === id)!;
  const press = (id: string, threadId: string | null) => command(id).run({ threadId, projectId: null, experimental_panel: {} as never });
  const said = () => notified().at(-1);
  const before = notified().length;

  // A working agent: Start cannot act, and says why in the Desktop's sentence; Stop opens its dialog.
  await press("agent-start", "thr_redesign");
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(said()).toMatchObject({ tone: "hint", title: "Redesign ui lead is already running." }); // one line that leaves by itself, not a failure
  // A stopped agent: Restart says to start it instead.
  await press("agent-restart", "thr_digest");
  expect(said()).toMatchObject({ title: "Weekly digest helper is stopped: Start it instead." });
  // A thread that is no agent's, and no thread at all.
  await press("agent-stop", "thr_plain");
  expect(said()).toMatchObject({ title: "This thread is not an OATS agent's." });
  await press("agent-retire", null);
  expect(said()).toMatchObject({ title: "This thread is not an OATS agent's." });
  expect(notified().length).toBe(before + 4);
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(calls(slot, "stopPlan", "retirePlan", "startCheck")).toEqual([]);

  await press("agent-stop", "thr_redesign");
  await ready(slot);
  expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Stop Redesign ui lead?");
});

test("a command on an agent that runs outside OATS: Stop and Start open their dialogs; Restart says it cannot, and never that the agent is stopped", async () => {
  // OATS recorded it stopped and the kernel reports its harness running (`outsideOats`): its state is "Running outside OATS".
  const report = { code: "running-outside-oats" as const, backend: "bb", message: "a harness runs in weekly-digest-helper on bb" };
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === "weekly-digest-helper" ? { ...agent, outsideOats: report } : agent));
  const { slot, shown } = await menu("thr_digest", {}, agents);
  expect(shown()).toEqual(["stop", "start", "retire"]);
  const { asked, commands } = await import("../../app/lifecycle");
  const press = (id: string) => commands.find((each) => each.id === id)!.run({ threadId: "thr_digest", projectId: null, experimental_panel: {} as never });
  await press("agent-restart");
  expect(notified().at(-1)).toMatchObject({ tone: "hint", title: "Weekly digest helper can't be restarted now." });
  expect(notified().map((said) => said.title).join(" ")).not.toMatch(/is stopped/);
  expect(slot.queryByRole("dialog")).toBeNull();
  await press("agent-stop");
  expect(asked()).toEqual({ verb: "stop", instance: "weekly-digest-helper" });
  resetApp();
  // Whatever else its row says (no kernel prints a report beside a session that ended by itself): never "is stopped" of an agent that runs outside OATS.
  const ended = fixtureAgents().map((agent): Agent => (agent.instance === "weekly-digest-helper" ? { ...agent, running: false, runtimeState: "shell", outsideOats: report } : agent));
  await menu("thr_digest", {}, ended);
  const before = notified().length;
  await (await import("../../app/lifecycle")).commands.find((each) => each.id === "agent-restart")!.run({ threadId: "thr_digest", projectId: null, experimental_panel: {} as never });
  expect(notified().slice(before).map((said) => said.title)).toEqual(["Weekly digest helper can't be restarted now."]);
});

test("a command pressed while the roster is the last one read is held, and says when the acts come back", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const { slot } = await menu("thr_redesign", { snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) });
  const { commands } = await import("../../app/lifecycle");
  await commands.find((each) => each.id === "agent-stop")!.run({ threadId: "thr_redesign", projectId: null, experimental_panel: {} as never });
  expect(notified().at(-1)).toMatchObject({ tone: "hint", title: "Stop, Start, Restart and Retire come back when OATS is read again." });
  expect(slot.queryByRole("dialog")).toBeNull();
});

test("AgentActs places the acts of one agent as buttons: the ones that apply, each opening its dialog", async () => {
  const { AgentActs } = await import("../../app/lifecycle");
  const app = await loadApp();
  const Overlay = app.appOverlays[0]!.component;
  const slot = renderSlot<object, Contract>(
    { component: () => (<><AgentActs instance="weekly-digest-helper" /><Overlay /></>) },
    {},
    { rpc: handlers({ retirePlan: () => retirePlanOf() }), sidebarThreads: sidebarThreads(), sdk: modelsSdk() },
  );
  const acts = await slot.findByTestId("oats-agent-acts");
  expect(Array.from(acts.querySelectorAll("button")).map((each) => each.textContent)).toEqual(["Start…", "Retire…"]); // a stopped agent
  fireEvent.click(slot.getByTestId("oats-agent-act-retire"));
  await ready(slot);
  expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Retire Weekly digest helper?");
});

test("the focus stays in an open dialog: what takes it outside (bb's composer, when a thread opens behind a result) gives it back", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => startedIn("thr_digest_2") });
  const outside = document.createElement("textarea");
  document.body.append(outside);
  try {
    await pick("start");
    await ready(slot);
    fireEvent.click(button(slot, "oats-confirm-act"));
    await phase(slot, "done");
    await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-close"))); // (the focus moves in an effect, after the phase is drawn)
    outside.focus(); // as bb's composer does when the agent's new thread opens
    await waitFor(() => expect(document.activeElement).toBe(button(slot, "oats-confirm-close"))); // (the focus moves in an effect, after the phase is drawn)
    fireEvent.click(button(slot, "oats-confirm-close"));
    // With no dialog open the focus is nobody's to hold.
    outside.focus();
    await waitFor(() => expect(document.activeElement).toBe(outside));
  } finally {
    outside.remove();
  }
});

test("the model field suggests bb's own models for the harness that will run, and asks again when another harness is chosen", async () => {
  const asked: unknown[] = [];
  const app = await loadApp();
  const Overlay = app.appOverlays[0]!.component;
  const { openAct } = await import("../../app/lifecycle");
  const slot = renderSlot<object, Contract>(
    { component: () => <Overlay /> },
    {},
    {
      rpc: handlers({ startCheck: ({ instance }) => startCheckOf(instance) }),
      sidebarThreads: sidebarThreads(),
      sdk: { providers: { models: (async (args: { providerId?: string }) => (asked.push(args), { models: args.providerId === "pi" ? [{ model: "anthropic/claude-opus-5-5", displayName: "Opus 5.5" }] : [{ model: "opus", displayName: "Opus" }] })) as never } },
    },
  );
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  openAct("start", "weekly-digest-helper");
  await ready(slot);
  const options = () => Array.from(slot.getByRole("dialog").querySelectorAll("datalist option")).map((option) => option.getAttribute("value"));
  await waitFor(() => expect(options()).toEqual(["opus"])); // the recorded harness's (Claude Code)
  fireEvent.change(slot.getByTestId("oats-start-harness"), { target: { value: "pi" } });
  await waitFor(() => expect(options()).toEqual(["anthropic/claude-opus-5-5"]));
  // Asked of the machine that holds the deployment, with no project: never a listing that starts a harness in an agent's home.
  expect(asked).toEqual([{ hostId: "host_falcon", providerId: "claude-code", preferCached: true }, { hostId: "host_falcon", providerId: "pi", preferCached: true }]);
});

test("AgentActs offers the acts of an agent with no bb thread too: Start and Retire for one whose thread is gone; the acts of its state for one on tmux, as for one on bb; held on a roster that is the last one read", async () => {
  const { AgentActs } = await import("../../app/lifecycle");
  const acts = async (instance: string, over: Partial<Handlers> = {}, threads = fixtureThreads()) => {
    const slot = renderSlot<object, Contract>({ component: () => <AgentActs instance={instance} /> }, {}, { rpc: handlers(over), sidebarThreads: { status: "ready" as const, threads }, sdk: modelsSdk() });
    await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const found = slot.queryByTestId("oats-agent-acts");
    const answer = { labels: found === null ? [] : Array.from(found.querySelectorAll("button")).map((each) => `${each.textContent}${each.disabled ? " (off)" : ""}`), reason: slot.queryByTestId("oats-disabled-reason")?.textContent ?? null };
    resetApp();
    return answer;
  };
  // Its bb thread is gone (deleted in bb): the agent stays in OATS, stopped.
  expect(await acts("weekly-digest-helper", {}, fixtureThreads().filter((thread) => thread.id !== "thr_digest"))).toEqual({ labels: ["Start…", "Retire…"], reason: null });
  const tmux = fixtureAgents().find((agent) => agent.backend === "tmux")!;
  expect(await acts(tmux.instance)).toEqual({ labels: ["Stop…", "Restart…", "Retire…"], reason: null });
  expect(await acts("no-such-agent")).toEqual({ labels: [], reason: null });
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  expect(await acts("redesign-ui-lead", { snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) })).toEqual({
    labels: ["Stop… (off)", "Restart… (off)", "Retire… (off)"],
    reason: null, // off, with no reason of their own: the place that draws them draws the notice ("Acts are off.", Retry)
  });
});

// ---- from the first review round

const UNSAFE = "x\u202Egnp.exe-ghp_abcdefghijklmnopqrstuvwxyz0123456789"; // a bidi override, and what looks like a token

test("a retire plan's branch, an agent's own choice, is drawn through the display filter in every place of the dialog", async () => {
  const plan = retirePlanOf();
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => ({ ...plan, recordedBranch: UNSAFE, work: { ...plan.work, branch: UNSAFE } }) });
  await pick("retire");
  await ready(slot);
  const drawn = slot.getByRole("dialog").textContent!;
  expect(drawn).not.toContain("\u202E");
  expect(drawn).not.toContain("ghp_");
  expect(under(slot, "oats-plan-details", "dd")).toContain("[withheld]"); // the Branch of the current state, under Details
  resetApp();
  // And in the reason beside a blocked Retire, which names an extra worktree's branch.
  const blocked = await menu("thr_digest", { retirePlan: () => ({ ...plan, extraTrees: [{ path: "/h/.work-x", branch: UNSAFE, disposition: "refuse", reason: null }] }) });
  await blocked.pick("retire");
  await ready(blocked.slot);
  const reason = blocked.slot.getByTestId("oats-confirm-blocked").textContent!;
  expect(reason).not.toContain("\u202E");
  expect(reason).not.toContain("ghp_");
  expect(reason).toBe("[withheld]");
});

test("the Start dialog draws the kernel's row (a record the agent can write) through the display filter: its harness, model and home, in the facts, the field's first entry, its hint and its placeholder", async () => {
  for (const harnesses of [["claude", "pi"], ["claude"]]) {
    const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, { harness: UNSAFE, model: UNSAFE, home: `/abs/${UNSAFE}`, machine: UNSAFE, harnesses }) });
    await pick("start");
    await ready(slot);
    const dialog = slot.getByRole("dialog");
    const everything = [dialog.textContent!, (slot.getByTestId("oats-start-model") as HTMLInputElement).placeholder, ...Array.from(dialog.querySelectorAll("option")).map((option) => `${option.textContent} ${option.getAttribute("label") ?? ""}`)].join("\n");
    expect(everything, String(harnesses)).not.toContain("\u202E");
    expect(everything, String(harnesses)).not.toContain("ghp_");
    expect(everything).toContain("[withheld]");
    resetApp();
  }
});

test("a start that fails after the person moved on is told through the toaster with Show result; one that is not confirmed is told as that, not as a failure", async () => {
  for (const [refusal, tone] of [
    ["E_SESSION_START_BUSY: a start is already in progress", "failed"],
    ["E_SPAWN_INCOMPLETE: launch requires inspection", "unknown"],
  ] as const) {
    let fail!: () => void;
    const held = new Promise<never>((_, reject) => (fail = () => reject(new Error(refusal))));
    const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => held, retirePlan: () => retirePlanOf() });
    const before = notified().length;
    await pick("start");
    await ready(slot);
    fireEvent.click(button(slot, "oats-confirm-act"));
    await phase(slot, "running");
    await pick("retire"); // the person moved on to another act's dialog
    await waitFor(() => expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Retire Weekly digest helper?"));
    fail();
    await waitFor(() => expect(notified().length).toBe(before + 1));
    // Neither is a result a toast can hold (a refusal has Details and Refresh status): it stays, and Show result
    // opens the Start dialog again on it, in the place of the dialog the person had moved on to.
    expect(notified().at(-1)).toMatchObject({ tone, stays: true, open: { label: "Show result" } });
    act(() => notified().at(-1)!.open!.run());
    await waitFor(() => expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Start Weekly digest helper"));
    expect(slot.getByTestId("oats-result")).toBeTruthy();
    expect(slot.inspection.navigateCalls).toEqual([]);
    resetApp();
  }
});

test("a retire accepted for the background, told after the person moved on, is not told as a failure", async () => {
  let answer!: () => void;
  const held = new Promise<void>((resolve) => (answer = resolve));
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => held.then(() => ({ ...retireReceiptOf(), deferred: true })), startCheck: ({ instance }) => startCheckOf(instance) });
  const before = notified().length;
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  await pick("start");
  await waitFor(() => expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Start Weekly digest helper"));
  answer();
  await waitFor(() => expect(notified().length).toBe(before + 1));
  expect(notified().at(-1)).toMatchObject({ tone: "unknown", title: "Retirement accepted" });
});

test("the dialog gives the focus way to a layer of bb's that holds it for itself (a dialog, a menu, the toaster), and never answers its own focus() twice", async () => {
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf() });
  await pick("stop");
  await ready(slot);
  const cancel = button(slot, "oats-confirm-cancel");
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  const layers = ['<div role="dialog"><input></div>', '<div role="menu"><button role="menuitem">Copy link</button></div>', '<ol data-sonner-toaster=""><li><button>Dismiss notification</button></li></ol>'].map((html) => {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    document.body.append(holder);
    return holder;
  });
  const plain = document.createElement("input");
  document.body.append(plain);
  try {
    for (const layer of layers) {
      const inside = layer.querySelector<HTMLElement>("input, button")!;
      // bb's own trap: when the focus leaves its layer it takes it back (Radix FocusScope). Two such traps must not call each other without end.
      let pulls = 0;
      const trap = (event: FocusEvent) => {
        if (!layer.contains(event.target as Node) && pulls++ < 50) inside.focus();
      };
      document.addEventListener("focusin", trap);
      inside.focus();
      expect(document.activeElement, layer.innerHTML).toBe(inside);
      expect(pulls).toBe(0);
      document.removeEventListener("focusin", trap);
      cancel.focus();
    }
    // Anything that is no layer of its own still gives the focus back.
    plain.focus();
    expect(document.activeElement).toBe(cancel);
  } finally {
    for (const node of [...layers, plain]) node.remove();
  }
});

// ---- from the second review round

test("an apply or a start whose CALL failed (nobody answered: bb restarted, the plugin reloaded) is not confirmed: never told as refused, never as nothing happened", async () => {
  const lost = () => {
    throw new Error("Failed to fetch"); // no code of the kernel's or of the plugin's: the call itself failed
  };
  const retire = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: lost });
  await retire.pick("retire");
  await ready(retire.slot);
  fireEvent.click(button(retire.slot, "oats-confirm-act"));
  await waitFor(() => expect(retire.slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  expect(retire.slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Result not confirmed");
  expect(retire.slot.queryByTestId("oats-act-review")).toBeNull();
  expect(retire.slot.getByTestId("oats-act-check")).toBeTruthy();
  resetApp();
  const start = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: lost });
  await start.pick("start");
  await ready(start.slot);
  fireEvent.click(button(start.slot, "oats-confirm-act"));
  await waitFor(() => expect(start.slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  expect(start.slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("OATS didn't confirm the start");
  expect(start.slot.getByTestId("oats-result").textContent).not.toContain("refused");
});

test("the Start gate is the Desktop's: running is already running; what is not known stopped is not known, and is never started on a guess", async () => {
  const gated = async (change: Parameters<typeof startCheckOf>[1], verb: "start" | "restart" = "start") => {
    const { slot, pick } = await menu(verb === "start" ? "thr_digest" : "thr_redesign", { startCheck: ({ instance }) => startCheckOf(instance, change) });
    await pick(verb);
    await ready(slot);
    const reason = slot.queryByTestId("oats-confirm-blocked")?.textContent ?? null;
    resetApp();
    return reason;
  };
  const UNKNOWN = "Could not verify whether this instance is running. Refresh its status before starting.";
  expect(await gated({ running: true, runtimeState: "unknown" })).toBe("This instance is already running.");
  expect(await gated({ running: null, runtimeState: "unknown" })).toBe(UNKNOWN);
  expect(await gated({ running: null, runtimeState: null })).toBe(UNKNOWN);
  expect(await gated({ running: null, runtimeState: "a-later-word" })).toBe(UNKNOWN);
  expect(await gated({ running: false, runtimeState: "unreachable" })).toBe(UNKNOWN);
  expect(await gated({ running: false, runtimeState: "stopped" })).toBeNull();
  expect(await gated({ running: false, runtimeState: "shell" })).toBeNull();
  expect(await gated({ running: false, runtimeState: null })).toBeNull();
  // Only the kernel's `running: false` is stopped: a word of the runtime's state is never read as that.
  expect(await gated({ running: null, runtimeState: "stopped" })).toBe(UNKNOWN);
  expect(await gated({ running: null, runtimeState: "shell" })).toBe(UNKNOWN);
  // Restart: bb reports an idle agent as neither running nor stopped, and it is the ordinary one a person restarts
  // (the named difference from the Desktop). A state that could not be reached is not restarted on a guess.
  expect(await gated({ running: null, runtimeState: "idle" }, "restart")).toBeNull();
  expect(await gated({ running: null, runtimeState: "unknown" }, "restart")).toBeNull();
  expect(await gated({ running: true, runtimeState: "working" }, "restart")).toBeNull();
  expect(await gated({ running: null, runtimeState: "unreachable" }, "restart")).toBe(UNKNOWN);
  expect(await gated({ running: true, runtimeState: "unreachable" }, "restart")).toBe(UNKNOWN);
});

// ---- from the third review round

test("a retire that kept the home of an agent on bb warns first, in the warning tone, that a message in its thread would start it outside OATS; the release lane's words are one press away, under the result's one Details", async () => {
  const incomplete = { ...retireReceiptOf(), removedDir: false, retainedHome: "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper", recoveryPath: null, incomplete: ["retire hook oats.aweb: the team certificate could not be removed (exit 1)"] };
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => incomplete });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  const warning = within(slot.getByTestId("oats-act-warning")).getByTestId("oats-notice");
  expect(warning.getAttribute("data-tone")).toBe("warning");
  expect(warning.querySelector("h3")!.textContent).toBe("Its home was kept: a message in its thread would start it outside OATS.");
  // The release lane's words are one press away: in the result's ONE Details (the warning has no fold of its own), first, before the kernel's lines and the code.
  expect(within(warning).queryByTestId("oats-notice-details")).toBeNull();
  expect(slot.getByTestId("oats-confirm").querySelectorAll("details")).toHaveLength(1);
  const more = slot.getByTestId("oats-act-details") as HTMLDetailsElement;
  expect(more.open).toBe(false);
  expect(texts(more, "p")).toEqual([
    "No status row, no hooks OATS runs for it, no stop by OATS. Where its aweb identity was not released (a team leave waiting for its controller, a retained seat, an alias held), it can send mail as the retired agent.",
    "retire hook oats.aweb: the team certificate could not be removed (exit 1)",
  ]);
  expect(texts(more, "code")).toEqual(["RETIRE_INCOMPLETE"]);
  // The warning stands before the result's steps.
  const result = slot.getByTestId("oats-result");
  expect(warning.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(result.textContent).not.toContain("unarchived");
});

test("Check again settles only on the kernel's own word: asked while OATS cannot be read, or refused by the plugin's own server, the result stays not confirmed", async () => {
  let second: string | null = null;
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => stopPlanOf(),
    stopApply: () => {
      throw new Error(second ?? "OATS_TIMEOUT: `oats` did not answer within 120 s and was stopped");
    },
  });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  for (const refusal of ["OATS_NOT_FOUND: `oats` could not be run (ENOENT)", "Failed to fetch", "E_LIFECYCLE_BUSY: a stop holds redesign-ui-lead"]) {
    second = refusal;
    fireEvent.click(button(slot, "oats-act-check"));
    await waitFor(() => expect(calls(slot, "stopApply").length).toBeGreaterThan(1));
    await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
    expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent, refusal).toBe("Result not confirmed");
    expect(slot.getByTestId("oats-result").textContent).not.toContain("wasn't stopped");
    expect(slot.getByTestId("oats-act-check")).toBeTruthy();
  }
  expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["Still running. Check again."]);
  // The kernel's own refusal is its answer.
  second = "E_SESSION_STOP_FAILED: its harness was signalled and still runs";
  fireEvent.click(button(slot, "oats-act-check"));
  await phase(slot, "failed");
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Redesign ui lead wasn't stopped");
  const keys = calls(slot, "stopApply").map((call) => (call.input as { key: string }).key);
  expect(new Set(keys).size).toBe(1); // every ask was for the same apply
});

test("a start whose check failed says nothing of what a start does: only what could not be checked", async () => {
  const { slot, pick } = await menu("thr_digest", {
    startCheck: () => {
      throw new Error("E_SOMETHING: the roster could not be read");
    },
  });
  await pick("start");
  await phase(slot, "failed");
  const dialog = slot.getByRole("dialog");
  expect(dialog.querySelector("h2")!.textContent).toBe("Start an agent");
  // No consequence line, no field, no Details of an agent that could not be checked.
  expect(slot.queryByTestId("oats-confirm-says")).toBeNull();
  expect(slot.queryByTestId("oats-start")).toBeNull();
  expect(dialog.textContent).not.toMatch(/Starts a new conversation|full mode/);
});

test("a state the kernel cannot tell: Start is off and says why, with Refresh status beside it; the kernel's own reason is under Details, under its name and through the display filter", async () => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, { running: null, runtimeState: "unreachable", runtimeError: `bb did not answer ${UNSAFE}` }) });
  await pick("start");
  await ready(slot);
  const status = slot.getByTestId("oats-start-status");
  expect(status.textContent).toContain("Could not verify whether this instance is running. Refresh its status before starting.");
  // Start is off, and never alone: the reason is on the same screen, with the way to read its status again.
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  expect(within(status).getByTestId("oats-start-refresh").textContent).toBe("Refresh status");
  const says = under(slot, "oats-start-details", "p").join(" ");
  expect(says).toContain("[withheld]");
  expect(slot.getByRole("dialog").textContent).not.toContain("ghp_");
  resetApp();
  const plain = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, { running: null, runtimeState: "unreachable", runtimeError: "bb did not answer" }) });
  await plain.pick("start");
  await ready(plain.slot);
  expect(under(plain.slot, "oats-start-details", "p")).toContain("OATS says: bb did not answer");
  expect(plain.slot.getByTestId("oats-start-status").textContent).not.toContain("OATS says");
});

// ---- from the fourth review round

test("a command's key pressed before OATS was read says that, never that the thread is no agent's", async () => {
  const { commands } = await import("../../app/lifecycle");
  const stop = commands.find((each) => each.id === "agent-stop")!;
  const failed = await menu("thr_redesign", { snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last: null }) });
  await stop.run({ threadId: "thr_redesign", projectId: null, experimental_panel: {} as never });
  const said = notified().at(-1)!;
  expect(said.tone).toBe("hint");
  expect(said.title.startsWith("OATS agents: can't be read. ")).toBe(true);
  expect(said.title).toMatch(/[^.]\.$/); // two sentences, each with its full stop
  expect(said.title).not.toContain("not an OATS agent");
  expect(failed.slot.queryByRole("dialog")).toBeNull();
  resetApp();
  const reading = await menu("thr_redesign", { snapshot: () => new Promise(() => undefined) });
  await stop.run({ threadId: "thr_redesign", projectId: null, experimental_panel: {} as never });
  expect(notified().at(-1)).toMatchObject({ tone: "hint", title: "OATS agents: reading…" });
  expect(reading.slot.queryByRole("dialog")).toBeNull();
});

test("a plan that changed in a fact with no sentence of its own says that it changed, never that nothing differs", async () => {
  const kept = { ...retirePlanOf(), extraTrees: [{ path: "/abs/x", branch: "feature/x", disposition: "retain" as const, reason: null }] };
  let refuse = false;
  const { slot, pick } = await menu("thr_digest", {
    retirePlan: () => (refuse ? { ...kept, revision: "a-later-revision", extraTrees: [{ ...kept.extraTrees[0]!, disposition: "refuse" as const }] } : kept),
    retireApply: () => {
      refuse = true;
      throw new Error("E_PLAN_STALE: the plan changed");
    },
  });
  await pick("retire");
  await ready(slot);
  const KEPT = "Keeps its extra worktree on branch feature/x, moved aside.";
  expect(under(slot, "oats-plan-details")).toContain(KEPT);
  fireEvent.click(button(slot, "oats-confirm-act"));
  expect(texts(await slot.findByTestId("oats-notice"), "p")).toEqual(["It has changed: read it again."]);
  // And the plan below is the one that differs: it no longer keeps that tree.
  expect(slot.getByRole("dialog").textContent).not.toContain(KEPT);
});

test("a start the lock blocks says so in a sentence that points at Details, where OATS's own line names the lock", async () => {
  const { slot, pick } = await menu("thr_digest", {
    startCheck: ({ instance }) => startCheckOf(instance),
    start: () => {
      throw new Error("E_SESSION_START_LOCK_STUCK: /abs/home/.oats/start.lock is held by pid 4242");
    },
  });
  await pick("start");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["A start lock from an earlier OATS blocks this. Remove it (Details names it)."]);
  expect(texts(slot.getByTestId("oats-act-details"), "p")).toEqual(["/abs/home/.oats/start.lock is held by pid 4242"]);
  expect(texts(slot.getByTestId("oats-act-details"), "code")).toEqual(["E_SESSION_START_LOCK_STUCK"]);
});

// ---- a start begins a new conversation

test("Restart says in its one line that it stops what the agent does now; that it starts a new conversation is under Details", async () => {
  const { slot, pick } = await menu("thr_redesign", { startCheck: ({ instance }) => startCheckOf(instance, { running: true, runtimeState: "working" }) });
  await pick("restart");
  await ready(slot);
  expect(says(slot)).toEqual(["Stops what it is doing now."]);
  expect(under(slot, "oats-start-details", "p")).toEqual(["Starts a new conversation.", "Runs in bb's full mode: no sandbox."]);
  expect(slot.queryByTestId("oats-start-thread")).toBeNull();
});

test("an agent whose recorded thread bb does not have (deleted, or bb cannot be asked) says the same one line: a start begins a new conversation, wherever the last one is", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "weekly-digest-helper" ? { ...agent, threadId: "thr_not_in_bb" } : agent));
  const { slot } = await menu("thr_plain", { startCheck: ({ instance }) => startCheckOf(instance) }, agents);
  const { openAct } = await import("../../app/lifecycle");
  openAct("start", "weekly-digest-helper");
  await ready(slot);
  expect(says(slot)).toEqual(["Starts a new conversation."]);
  expect(under(slot, "oats-start-details", "p")).toEqual(["Runs in bb's full mode: no sandbox."]);
  expect(slot.queryByTestId("oats-start-thread")).toBeNull();
});

// The rows an agent that does not run can read (test/fixtures/lifecycle/README.md says which are recorded and which are shaped from the contract).
const LOST = { running: false, runtimeState: "stopped", sessionEnd: "lost" } as const; // its session was lost with the host, or its harness is gone
const AT_REST = { running: false, runtimeState: "unknown", sessionEnd: null } as const; // its thread at rest, no harness loaded (the bb provider's A15(1) change: the fixtures' README)
const OPERATOR_STOP = { running: false, runtimeState: "stopped", sessionEnd: "stopped" } as const;

test.each([
  ["whose session was lost", LOST],
  ["whose thread is at rest with no harness loaded", AT_REST],
])("an agent that was cut off (%s): Start says first to message it instead to continue its conversation, with the way there; Start stays possible", async (_, row) => {
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, row), start: () => startedIn("thr_digest_2") });
  await pick("start");
  await ready(slot);
  const confirm = slot.getByTestId("oats-confirm");
  const notice = within(confirm).getByTestId("oats-notice");
  expect(notice.querySelector("h3")!.textContent).toBe("To continue its conversation, message it instead.");
  // Said FIRST: before what the start will do.
  expect(confirm.firstElementChild).toBe(notice);
  expect(notice.nextElementSibling).toBe(slot.getByTestId("oats-confirm-says"));
  expect(button(slot, "oats-start-thread").textContent).toBe("Open Weekly digest helper");
  // Start stays possible, and still says that it begins a new conversation.
  expect(button(slot, "oats-confirm-act").disabled).toBe(false);
  expect(says(slot)).toEqual(["Starts a new conversation."]);
  // The way there: the dialog closes on the agent's thread, and nothing was started.
  fireEvent.click(button(slot, "oats-start-thread"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_digest" }]);
  expect(calls(slot, "start", "restart")).toEqual([]);
});

test("the cut-off line is for that state alone: never after an operator's stop, never for a row that does not say how its session ended, never for an agent that runs or whose state is not known", async () => {
  const pointed = async (verb: "start" | "restart", thread: string, change: Parameters<typeof startCheckOf>[1]) => {
    const { slot, pick } = await menu(thread, { startCheck: ({ instance }) => startCheckOf(instance, change) });
    await pick(verb);
    await ready(slot);
    const there = slot.queryByTestId("oats-start-thread") !== null;
    resetApp();
    return there;
  };
  expect(await pointed("start", "thr_digest", LOST)).toBe(true);
  expect(await pointed("start", "thr_digest", OPERATOR_STOP)).toBe(false);
  expect(await pointed("start", "thr_digest", { running: false, runtimeState: "unknown", sessionEnd: "stopped" })).toBe(false);
  expect(await pointed("start", "thr_digest", { running: false, runtimeState: "stopped", sessionEnd: null })).toBe(false);
  expect(await pointed("start", "thr_digest", { running: null, runtimeState: "unknown", sessionEnd: null })).toBe(false);
  // Restart says it under the same condition (below), and not otherwise.
  expect(await pointed("restart", "thr_redesign", OPERATOR_STOP)).toBe(false);
  expect(await pointed("restart", "thr_redesign", { running: true, runtimeState: "unknown", sessionEnd: null })).toBe(false);
  expect(await pointed("restart", "thr_redesign", { running: null, runtimeState: "unknown", sessionEnd: null })).toBe(false);
});

test.each([
  ["whose session was lost", LOST],
  ["whose thread is at rest with no harness loaded", AT_REST],
])("Restart of an agent that was cut off (%s) says the same line first: a restart loses its place in the conversation as a start does; Restart stays possible", async (_, row) => {
  const { slot, pick } = await menu("thr_redesign", { startCheck: ({ instance }) => startCheckOf(instance, row), restart: () => startedIn("thr_redesign_2") });
  await pick("restart");
  await ready(slot);
  const confirm = slot.getByTestId("oats-confirm");
  const notice = within(confirm).getByTestId("oats-notice");
  expect(notice.querySelector("h3")!.textContent).toBe("To continue its conversation, message it instead.");
  expect(confirm.firstElementChild).toBe(notice);
  expect(notice.nextElementSibling).toBe(slot.getByTestId("oats-confirm-says"));
  expect(says(slot)).toEqual(["Stops what it is doing now."]);
  expect(button(slot, "oats-start-thread").textContent).toBe("Open Redesign ui lead");
  expect(button(slot, "oats-confirm-act").disabled).toBe(false);
  expect(button(slot, "oats-confirm-act").textContent).toBe("Restart");
  fireEvent.click(button(slot, "oats-start-thread"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_redesign" }]);
  expect(calls(slot, "start", "restart")).toEqual([]);
});

test("a cut-off agent whose thread cannot take a message gets no line: bb does not list it (archived). A listed thread whose last turn bb calls failed takes a message, and gets the line", async () => {
  // `turnStarted`: bb says of the thread's events that a turn started there (its later turn failed). Until bb has said so a
  // thread in "error" may be one that never started, and no message is invited into it (model/rest.ts `messageResumes`).
  const withThreads = async (threads: ReturnType<typeof fixtureThreads>, turnStarted = false) => {
    const app = await loadApp();
    const Overlay = app.appOverlays[0]!.component;
    const events = { list: async ({ types }: { types: readonly string[] }) => (turnStarted && types.includes("turn/started") ? [{ type: "turn/started", seq: 5, data: {} }] : []) };
    const slot = renderSlot<object, Contract>({ component: () => <Overlay /> }, {}, { rpc: handlers({ startCheck: ({ instance }) => startCheckOf(instance, LOST) }), sidebarThreads: { status: "ready" as const, threads }, sdk: { ...modelsSdk(), threads: { events } } as never });
    await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { openAct } = await import("../../app/lifecycle");
    openAct("start", "weekly-digest-helper");
    await ready(slot);
    if (turnStarted) await waitFor(() => expect(slot.queryByTestId("oats-start-thread")).not.toBeNull());
    const said = { line: slot.queryByTestId("oats-start-thread") !== null, text: slot.getByTestId("oats-confirm").textContent! };
    resetApp();
    return said;
  };
  const inError = await withThreads(fixtureThreads().map((thread) => (thread.id === "thr_digest" ? { ...thread, status: "error" as const } : thread)), true);
  // bb's last turn failed and the session is there (a harness killed in a turn is how a session is lost): bb's composer is live on it.
  expect(inError.line).toBe(true);
  // The one line is the same wherever its last conversation is: a start begins a new one.
  expect(inError.text).toContain("Starts a new conversation.");
  const archived = await withThreads(fixtureThreads().map((thread) => (thread.id === "thr_digest" ? { ...thread, isArchived: true } : thread)));
  expect(archived.line).toBe(false);
  expect(archived.text).toContain("Starts a new conversation.");
  expect(archived.text).not.toMatch(/message it instead|saved briefing|stays readable/);
  const there = await withThreads(fixtureThreads());
  expect(there.line).toBe(true);
});

// ---- a way out of a dialog whose act runs

test("while a stop runs the dialog can be closed (Close, not Cancel; no line says so); closed, the result reaches the person through the toaster", async () => {
  let answer!: (receipt: ReturnType<typeof stopReceiptOf>) => void;
  const held = new Promise<ReturnType<typeof stopReceiptOf>>((resolve) => (answer = resolve));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => held });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(slot.getByTestId("oats-confirm-running").textContent).toBe("Stopping…");
  expect(slot.queryByTestId("oats-confirm-leave-line")).toBeNull();
  // Close, not Cancel: nothing is cancelled. The act's own button stays off.
  expect(slot.queryByTestId("oats-confirm-cancel")).toBeNull();
  expect(button(slot, "oats-confirm-leave").textContent).toBe("Close");
  expect(button(slot, "oats-confirm-leave").disabled).toBe(false);
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  const before = notified().length;
  fireEvent.click(button(slot, "oats-confirm-leave"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(notified().length).toBe(before); // nothing is said before there is a result
  answer(stopReceiptOf());
  await waitFor(() => expect(notified().length).toBe(before + 1));
  // A stop that is done is told whole, with the way to the agent, and may leave by itself: a toast can hold it.
  const toast = notified().at(-1)!;
  expect(toast).toMatchObject({ tone: "done", title: "3 sessions stopped.", open: { label: "Open Redesign ui lead" } });
  expect(toast.stays).toBeUndefined();
  // Its title is the result; its one line, since bb did not archive the thread: the warning.
  expect(toast.lines).toEqual(["A message in its thread starts it outside OATS."]);
  expect(calls(slot, "stopApply")).toHaveLength(1);
});

test("a restart that runs can be closed: Close is on, and no line says so", async () => {
  const { slot, pick } = await menu("thr_redesign", { startCheck: ({ instance }) => startCheckOf(instance, { running: true, runtimeState: "working" }), restart: () => new Promise(() => undefined) });
  await pick("restart");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(slot.getByTestId("oats-confirm-running").textContent).toBe("Restarting…");
  expect(slot.queryByTestId("oats-confirm-leave-line")).toBeNull();
  expect([button(slot, "oats-confirm-leave").textContent, button(slot, "oats-confirm-leave").disabled]).toEqual(["Close", false]);
});

test("Escape leaves a running dialog too, and a refusal that arrives after it is told as a failure, never lost", async () => {
  let refuse!: (cause: Error) => void;
  const held = new Promise<never>((_, reject) => (refuse = reject));
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => held });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(slot.getByTestId("oats-confirm-running").textContent).toBe("Retiring…");
  expect(button(slot, "oats-confirm-leave").disabled).toBe(false);
  fireEvent.keyDown(slot.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const before = notified().length;
  refuse(new Error("E_CHILDREN_RUNNING: a child would not stop"));
  await waitFor(() => expect(notified().length).toBe(before + 1));
  expect(notified().at(-1)).toMatchObject({ tone: "failed", title: "Weekly digest helper wasn't retired" });
});

test("a start that runs can be left as well, by its Close, and the start's result comes through the toaster with the way to the new thread", async () => {
  let answer!: (started: ReturnType<typeof startedIn>) => void;
  const held = new Promise<ReturnType<typeof startedIn>>((resolve) => (answer = resolve));
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => held });
  await pick("start");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(slot.getByTestId("oats-confirm-running").textContent).toBe("Starting…");
  expect(slot.queryByTestId("oats-confirm-leave-line")).toBeNull();
  fireEvent.click(button(slot, "oats-confirm-leave"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const before = notified().length;
  answer(startedIn("thr_digest_2"));
  await waitFor(() => expect(notified().length).toBe(before + 1));
  expect(notified().at(-1)).toMatchObject({ tone: "done", title: "Weekly digest helper started." });
  // The person left: the new thread is offered, not opened under them.
  expect(slot.inspection.navigateCalls).toEqual([]);
});

// ---- a retire refused while bb lists a pi agent's models

test("a retire of an agent that runs pi on bb, refused because a process works in its home, says to try again in a minute; for another harness it does not", async () => {
  const refusal = "E_RUNTIME_QUIESCE_FAILED: the bb session of weekly-digest-helper stopped, and a process works in its home (pid 4242 pi); stop it, then retire again.";
  const WAIT = "If its thread was just opened, try again in a minute.";
  const refused = async (harness: string | null) => {
    const { slot, pick } = await menu("thr_digest", {
      retirePlan: () => retirePlanOf(undefined, harness),
      retireApply: () => {
        throw new Error(refusal);
      },
    });
    await pick("retire");
    await ready(slot);
    fireEvent.click(button(slot, "oats-confirm-act"));
    await phase(slot, "failed");
    const said = { face: texts(slot.getByTestId("oats-result"), "span.block"), details: texts(slot.getByTestId("oats-act-details"), "p") };
    resetApp();
    return said;
  };
  const pi = await refused("pi");
  // The Desktop's sentence, then that waiting is the remedy; OATS's own line is under Details.
  expect(pi.face).toEqual(["OATS tried to end a session or a process and couldn't confirm that it ended.", WAIT]);
  expect(pi.details).toEqual(["the bb session of weekly-digest-helper stopped, and a process works in its home (pid 4242 pi); stop it, then retire again."]);
  expect((await refused("claude")).face).not.toContain(WAIT);
  expect((await refused(null)).face).not.toContain(WAIT);
});

// ---- what a stop's result says of the thread is what bb shows of it

test("a stop's result says of the agent's thread what bb shows after the stop: archived, the title alone; still taking messages, the warning; where bb cannot be asked, what the confirmation said", async () => {
  const MESSAGE = "A message in its thread starts it outside OATS.";
  const stopped = async (get: (args: { threadId: string }) => Promise<unknown>) => {
    const asked: string[] = [];
    const sdk = { ...modelsSdk(), threads: { get: (args: { threadId: string }) => (asked.push(args.threadId), get(args)) } };
    const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => stopReceiptOf() }, undefined, sdk);
    await pick("stop");
    await ready(slot);
    // Before the act the dialog's one line says what the provider's version says: here (none read), that a message starts it outside OATS.
    expect(says(slot)[0]).toBe(MESSAGE);
    fireEvent.click(button(slot, "oats-confirm-act"));
    await phase(slot, "done");
    const result = slot.getByTestId("oats-result");
    const said = { title: result.querySelector("h3")!.textContent, lines: texts(result, "p"), text: result.textContent! };
    resetApp();
    return { ...said, asked };
  };
  // bb shows the thread archived (a provider that archives at stop): the result says so, whatever the confirmation said.
  const archived = await stopped(async ({ threadId }) => ({ id: threadId, archivedAt: 1_763_000_000_000 }));
  expect(archived.asked).toEqual(["thr_redesign"]); // bb is asked once, for the agent's own thread, after the stop
  // The result is its title alone: nothing warns, and nothing repeats that the thread is archived.
  expect([archived.title, archived.lines, archived.text]).toEqual(["3 sessions stopped.", [], "3 sessions stopped."]);
  // bb shows it as it was: a message there still starts the agent, and the result's one line warns of it.
  const live = await stopped(async ({ threadId }) => ({ id: threadId, archivedAt: null }));
  expect(live.lines).toEqual([MESSAGE]);
  // bb cannot be asked, or answers nothing of it: not known, and the result keeps the confirmation's sentence.
  for (const get of [async () => Promise.reject(new Error("bb did not answer")), async () => ({ id: "thr_redesign" }), async () => null]) {
    const unknown = await stopped(get);
    expect(unknown.lines).toEqual([MESSAGE]);
  }
});

test("bb is not asked about the thread after a stop that did not stop every session", async () => {
  const asked: string[] = [];
  const sdk = { ...modelsSdk(), threads: { get: async (args: { threadId: string }) => (asked.push(args.threadId), { archivedAt: null }) } };
  const failed = { ...stopReceiptOf(), ok: false };
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => failed }, undefined, sdk);
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  expect(asked).toEqual([]);
});

// ---- the OATS entries in bb's menu

test("the OATS entries start with a row that names the agent and its state, off; a thread that is no agent's has none", async () => {
  const working = await menu("thr_redesign");
  expect(working.item("agent")).toMatchObject({ label: "Redesign ui lead · Working", disabled: true });
  resetApp();
  const stopped = await menu("thr_digest");
  expect(stopped.item("agent")).toMatchObject({ label: "Weekly digest helper · Stopped", disabled: true });
  resetApp();
  expect((await menu("thr_plain")).item("agent")).toBeNull();
});

// ---- what the toaster tells of an act whose dialog is gone

/** Leave the dialog of `verb` while it runs: the press, the wait for the running line, Close. */
async function leave(slot: Awaited<ReturnType<typeof menu>>["slot"]) {
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  fireEvent.click(button(slot, "oats-confirm-leave"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  return notified().length;
}

test("a retire that is left while it runs and keeps the home: the toast stays, says first that a message in its thread would start it outside OATS, and Show result opens the dialog on the whole result", async () => {
  let answer!: (receipt: ReturnType<typeof retireReceiptOf>) => void;
  const held = new Promise<ReturnType<typeof retireReceiptOf>>((resolve) => (answer = resolve));
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => held });
  await pick("retire");
  await ready(slot);
  const before = await leave(slot);
  answer({ ...retireReceiptOf(), removedDir: false, retainedHome: "/abs/deployment/agents/oats-expert/instances/weekly-digest-helper", recoveryPath: null, incomplete: ["retire hook oats.aweb: the team certificate could not be removed (exit 1)"] });
  await waitFor(() => expect(notified().length).toBe(before + 1));
  const toast = notified().at(-1)!;
  expect(toast).toMatchObject({ tone: "failed", title: "Retirement didn't finish", stays: true });
  // What the dialog sets apart, first and in the warning tone, is the toast's one line: a toast has no place apart.
  expect(toast.lines).toEqual(["Its home was kept: a message in its thread would start it outside OATS."]);
  expect(toast.open!.label).toBe("Show result");
  // Show result: the dialog again, on that result, with the warning, the steps and Details; the kernel is not asked.
  const asked = calls(slot, "retirePlan", "retireApply").length;
  act(() => toast.open!.run());
  await phase(slot, "failed");
  expect(within(slot.getByTestId("oats-act-warning")).getByTestId("oats-notice").getAttribute("data-tone")).toBe("warning");
  expect(slot.getByTestId("oats-result").textContent).toContain("Home folder kept, at:");
  expect(slot.getByTestId("oats-act-details").textContent).toContain("the team certificate could not be removed");
  expect(calls(slot, "retirePlan", "retireApply")).toHaveLength(asked);
});

test("a retire that finished after its dialog was left: the toast stays until dismissed, and Show result opens where the worktree and the recovery copy are, and the warnings", async () => {
  let answer!: (receipt: ReturnType<typeof retireReceiptOf>) => void;
  const held = new Promise<ReturnType<typeof retireReceiptOf>>((resolve) => (answer = resolve));
  const { slot, pick } = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => held });
  await pick("retire");
  await ready(slot);
  const before = await leave(slot);
  answer({ ...retireReceiptOf(), warnings: ["the bb thread of weekly-digest-helper could only be archived"] });
  await waitFor(() => expect(notified().length).toBe(before + 1));
  const toast = notified().at(-1)!;
  // Done, and not lost to a timer: what it leads to can be read nowhere else once the agent's row is gone.
  expect(toast).toMatchObject({ tone: "done", title: "Weekly digest helper retired.", stays: true, lines: [] });
  expect(toast.open!.label).toBe("Show result");
  act(() => toast.open!.run());
  await phase(slot, "done");
  const result = slot.getByTestId("oats-result").textContent!;
  expect(result).toContain("Worktree kept, at:");
  expect(result).toContain("/abs/deployment/.agents/worktrees/oats-real/agents-weekly-digest-helper");
  expect(result).toContain("Recovery copy saved at:");
  // The kernel's warning is under the result's Details, whole.
  expect(texts(slot.getByTestId("oats-result"), "p").join(" ")).not.toContain("could only be archived");
  expect(texts(slot.getByTestId("oats-act-details"), "p")).toEqual(["the bb thread of weekly-digest-helper could only be archived"]);
});

test("a stop that is left and whose answer is lost: the toast says the result is not confirmed and names no button; Show result opens the dialog, where Check again asks for THAT apply", async () => {
  let second = false;
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => stopPlanOf(),
    stopApply: () => {
      if (second) return stopReceiptOf();
      second = true;
      return new Promise((_, reject) => setTimeout(() => reject(new Error("OATS_TIMEOUT: `oats` did not answer within 120 s and was stopped")), 30));
    },
  });
  await pick("stop");
  await ready(slot);
  const before = await leave(slot);
  await waitFor(() => expect(notified().length).toBe(before + 1));
  const toast = notified().at(-1)!;
  expect(toast).toMatchObject({ tone: "unknown", title: "Result not confirmed", lines: [] });
  expect(JSON.stringify({ ...toast, open: toast.open!.label })).not.toMatch(/Check again|Review again|Details/);
  act(() => toast.open!.run());
  await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  fireEvent.click(button(slot, "oats-act-check"));
  await phase(slot, "done");
  // The same apply was asked for: its revision and its key, which the result kept.
  const sent = calls(slot, "stopApply").map((call) => call.input as { key: string; revision: string });
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
});

test("a start that is refused after its dialog was left: the toast names no button of the dialog, and Show result opens the refusal with Refresh status and Details", async () => {
  let refuse!: (cause: Error) => void;
  const held = new Promise<never>((_, reject) => (refuse = reject));
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => held });
  await pick("start");
  await ready(slot);
  const before = await leave(slot);
  refuse(new Error("E_WORKSPACE_PATH_UNSAFE: directory instance home was removed or exchanged"));
  await waitFor(() => expect(notified().length).toBe(before + 1));
  const toast = notified().at(-1)!;
  expect(toast).toMatchObject({ tone: "failed", title: "OATS refused to start Weekly digest helper", lines: [], stays: true });
  expect(toast.open!.label).toBe("Show result");
  const checks = calls(slot, "startCheck").length;
  act(() => toast.open!.run());
  await phase(slot, "failed");
  expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["Refresh its status before another try."]);
  expect(texts(slot.getByTestId("oats-act-details"), "p")).toEqual(["directory instance home was removed or exchanged"]);
  expect(texts(slot.getByTestId("oats-act-details"), "code")).toEqual(["E_WORKSPACE_PATH_UNSAFE"]);
  expect(calls(slot, "startCheck")).toHaveLength(checks); // nothing is asked until the person asks
  expect(slot.getByTestId("oats-start-refresh")).toBeTruthy();
});

// ---- a dialog opened again on a result keeps what the person had chosen

test("Show result keeps a stop's choice of its children: Review again reads the plan the person had asked for", async () => {
  let refuse!: (cause: Error) => void;
  const held = new Promise<never>((_, reject) => (refuse = reject));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: ({ recursive }) => ({ ...stopPlanOf(), recursive: recursive !== false }), stopApply: () => held });
  await pick("stop");
  await ready(slot);
  fireEvent.click(within(slot.getByTestId("oats-plan-choice")).getByRole("switch")); // without its children
  await waitFor(() => expect(calls(slot, "stopPlan")).toHaveLength(2));
  await ready(slot);
  const before = await leave(slot);
  refuse(new Error("E_SESSION_STOP_FAILED: its harness was signalled and still runs"));
  await waitFor(() => expect(notified().length).toBe(before + 1));
  act(() => notified().at(-1)!.open!.run());
  await phase(slot, "failed");
  fireEvent.click(button(slot, "oats-act-review"));
  await waitFor(() => expect(calls(slot, "stopPlan")).toHaveLength(3));
  expect(calls(slot, "stopPlan").map((call) => (call.input as { recursive?: boolean }).recursive)).toEqual([true, false, false]);
});

test("Show result keeps the harness and the model of a start that was refused: the field the refusal points at holds what was typed", async () => {
  let refuse!: (cause: Error) => void;
  const held = new Promise<never>((_, reject) => (refuse = reject));
  const { slot, pick } = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => held });
  await pick("start");
  await ready(slot);
  fireEvent.change(slot.getByTestId("oats-start-harness"), { target: { value: "pi" } });
  fireEvent.change(slot.getByTestId("oats-start-model"), { target: { value: "no-such-model" } });
  const before = await leave(slot);
  refuse(new Error("E_MODEL_UNKNOWN: pi has no model no-such-model"));
  await waitFor(() => expect(notified().length).toBe(before + 1));
  act(() => notified().at(-1)!.open!.run());
  await phase(slot, "failed");
  expect(slot.getByTestId("oats-result").textContent).toContain("Change it under “Model”, or leave the field blank.");
  fireEvent.click(button(slot, "oats-start-refresh"));
  await ready(slot);
  expect((slot.getByTestId("oats-start-harness") as HTMLSelectElement).value).toBe("pi");
  expect((slot.getByTestId("oats-start-model") as HTMLInputElement).value).toBe("no-such-model");
});

test("a stop's result does not wait on bb's word of the thread beyond a moment: a read that never answers leaves the confirmation's sentence", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const sdk = { ...modelsSdk(), threads: { get: () => new Promise(() => undefined) } };
    const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => stopReceiptOf() }, undefined, sdk);
    await pick("stop");
    await ready(slot);
    fireEvent.click(button(slot, "oats-confirm-act"));
    await phase(slot, "running");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    await phase(slot, "done");
    expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["A message in its thread starts it outside OATS."]);
  } finally {
    vi.useRealTimers();
  }
});

// ---- the provider's version reaches the one function that decides what a stop says of the thread

test("the Stop dialog says what the provider's version says a stop does to the thread: that it archives the thread from oats-bb 0.4.0 on; below it, for a commit, and for none, that a message in its thread starts it outside OATS", async () => {
  const MESSAGE = "A message in its thread starts it outside OATS.";
  const ARCHIVED = "Archives its thread.";
  for (const [version, sentence, other] of [
    ["0.3.0", MESSAGE, ARCHIVED],
    ["0.4.0", ARCHIVED, MESSAGE],
    ["0.10.0", ARCHIVED, MESSAGE],
    ["0.4.0-rc.1", MESSAGE, ARCHIVED],
    ["9b95a56f237ff4006a69545963d5130d6eb4ddc5", MESSAGE, ARCHIVED],
    [null, MESSAGE, ARCHIVED],
  ] as const) {
    const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(undefined, version), stopApply: () => stopReceiptOf() });
    await pick("stop");
    await ready(slot);
    // The dialog's ONE consequence line, first of what it says.
    expect(says(slot)[0], String(version)).toBe(sentence);
    expect(slot.getByTestId("oats-confirm").textContent, String(version)).not.toContain(other);
    // The result, where bb cannot be asked for the thread (this test gives it no such read), follows what the confirmation
    // said: archived, the title alone; else the warning, as its one line.
    fireEvent.click(button(slot, "oats-confirm-act"));
    await phase(slot, "done");
    expect(texts(slot.getByTestId("oats-result"), "p"), String(version)).toEqual(sentence === MESSAGE ? [MESSAGE] : []);
    resetApp();
  }
});

test("on a provider that archives at stop, the result still says what bb SHOWS: a thread bb holds live is told as one a message starts", async () => {
  const sdk = { ...modelsSdk(), threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, archivedAt: null }) } };
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(undefined, "0.4.0"), stopApply: () => stopReceiptOf() }, undefined, sdk);
  await pick("stop");
  await ready(slot);
  expect(says(slot)[0]).toBe("Archives its thread.");
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["A message in its thread starts it outside OATS."]);
});

// ---- the Start dialog's one line is the same wherever the agent's last conversation is

test("an agent whose thread a stop archived, or bb deleted: Start says the same one line, and asks bb nothing for it; the carry-on line is for a thread that can take a message", async () => {
  const NEW = ["Starts a new conversation."];
  // The kernel's row records thr_digest; bb lists it no more (archived), deleted it, or lists it.
  const opened = async (listed: boolean, get: ((args: { threadId: string }) => Promise<unknown>) | null, check: Parameters<typeof startCheckOf>[1] = {}) => {
    const asked: string[] = [];
    const sdk = { ...modelsSdk(), ...(get === null ? {} : { threads: { get: (args: { threadId: string }) => (asked.push(args.threadId), get(args)) } }) };
    const threads = fixtureThreads().map((thread) => (thread.id === "thr_digest" && !listed ? { ...thread, isArchived: true } : thread));
    const app = await loadApp();
    const Overlay = app.appOverlays[0]!.component;
    const slot = renderSlot<object, Contract>({ component: () => <Overlay /> }, {}, { rpc: handlers({ startCheck: ({ instance }) => startCheckOf(instance, check) }), sidebarThreads: { status: "ready" as const, threads }, sdk: sdk as never });
    await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { openAct } = await import("../../app/lifecycle");
    openAct("start", "weekly-digest-helper");
    await ready(slot);
    const said = { says: says(slot), text: slot.getByTestId("oats-confirm").textContent!, carry: slot.queryByTestId("oats-start-thread") !== null, asked };
    resetApp();
    return said;
  };
  // Archived in bb: the one line; where its last conversation stays is no sentence of the dialog's, so bb is not asked for it.
  const archived = await opened(false, async ({ threadId }) => ({ id: threadId, archivedAt: 1_763_000_000_000 }));
  expect(archived.says).toEqual(NEW);
  expect(archived.asked).toEqual([]);
  expect(archived.text).not.toMatch(/stays readable|saved briefing/);
  // An archived thread takes no message: no carry-on line, even for a session that was lost.
  const lost = await opened(false, async ({ threadId }) => ({ id: threadId, archivedAt: 1_763_000_000_000 }), { running: false, runtimeState: "stopped", sessionEnd: "lost" });
  expect(lost.says).toEqual(NEW);
  expect(lost.carry).toBe(false);
  // Deleted in bb, or bb cannot be asked: the same line.
  expect((await opened(false, async () => Promise.reject(new Error("thread not found")))).says).toEqual(NEW);
  expect((await opened(false, null)).says).toEqual(NEW);
  // Listed by bb, and its session lost: the carry-on line is there, from bb's list.
  const listed = await opened(true, async ({ threadId }) => ({ id: threadId, archivedAt: null }), { running: false, runtimeState: "stopped", sessionEnd: "lost" });
  expect(listed.says).toEqual(NEW);
  expect(listed.carry).toBe(true);
  expect(listed.asked).toEqual([]);
});

// ---- a retire the kernel refused and marked unconfirmed
// (SHAPED: no real kernel was made to give a marked refusal; the envelope's form and the code are the kernel's;
// that it marks it, and the message, are ours. test/fixtures/lifecycle/README.md, "An act refused with the kernel's marker".)

test("a retire the kernel refuses with its marker that it cannot confirm what is left is told as not confirmed, with Check again, and OATS's line and code under Details; never as not retired", async () => {
  let marked = true;
  const { slot, pick } = await menu("thr_digest", {
    retirePlan: () => retirePlanOf(),
    retireApply: () => {
      if (!marked) return retireReceiptOf();
      throw Object.assign(new Error("E_RETIRE_INCOMPLETE: the home was moved aside and the retire hooks did not answer"), { code: "conflict", issues: [{ message: UNCONFIRMED_ISSUE.message, path: [...UNCONFIRMED_ISSUE.path] }] });
    },
  });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  const result = slot.getByTestId("oats-result").textContent!;
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Result not confirmed");
  expect(texts(slot.getByTestId("oats-result"), "p")).toEqual(["Check again before assuming nothing happened."]);
  expect(texts(slot.getByTestId("oats-act-details"), "p")).toEqual(["the home was moved aside and the retire hooks did not answer"]);
  expect(texts(slot.getByTestId("oats-act-details"), "code")).toEqual(["E_RETIRE_INCOMPLETE"]);
  expect(result).not.toContain("wasn't retired");
  // Check again asks for the same apply, and the kernel's answer settles it.
  marked = false;
  fireEvent.click(button(slot, "oats-act-check"));
  await phase(slot, "done");
  const sent = calls(slot, "retireApply").map((call) => (call.input as { key: string }).key);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toBe(sent[0]);
});

test("the same refusal WITHOUT the kernel's marker is a refusal: the retire did not happen, as the kernel says", async () => {
  const { slot, pick } = await menu("thr_digest", {
    retirePlan: () => retirePlanOf(),
    retireApply: () => {
      throw Object.assign(new Error("E_CHILDREN_RUNNING: a child would not stop"), { code: "conflict" });
    },
  });
  await pick("retire");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Weekly digest helper wasn't retired");
});

test("a stop and a start refused with the kernel's marker are told as not confirmed too: Check again for the stop, Refresh status for the start (shaped from the envelope's form)", async () => {
  const issues = [{ message: UNCONFIRMED_ISSUE.message, path: [...UNCONFIRMED_ISSUE.path] }];
  const stop = await menu("thr_redesign", {
    stopPlan: () => stopPlanOf(),
    stopApply: () => {
      throw Object.assign(new Error("E_SESSION_STOP_FAILED: its harness was signalled; whether it ended is not known"), { code: "conflict", issues });
    },
  });
  await stop.pick("stop");
  await ready(stop.slot);
  fireEvent.click(button(stop.slot, "oats-confirm-act"));
  await waitFor(() => expect(stop.slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  expect(stop.slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Result not confirmed");
  expect(texts(stop.slot.getByTestId("oats-result"), "p")).toEqual(["Check again before assuming nothing happened."]);
  expect(stop.slot.getByTestId("oats-result").textContent).not.toContain("wasn't stopped");
  expect(stop.slot.getByTestId("oats-act-check")).toBeTruthy();
  resetApp();
  const start = await menu("thr_digest", {
    startCheck: ({ instance }) => startCheckOf(instance),
    start: () => {
      throw Object.assign(new Error("E_BACKEND_NOT_READY: the launch was sent and its session was not seen"), { code: "conflict", issues });
    },
  });
  await start.pick("start");
  await ready(start.slot);
  fireEvent.click(button(start.slot, "oats-confirm-act"));
  await waitFor(() => expect(start.slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  const said = start.slot.getByTestId("oats-result").textContent!;
  expect(said).toContain("Result not confirmed");
  expect(texts(start.slot.getByTestId("oats-result"), "p")).toEqual(["Refresh its status before another try."]);
  expect(texts(start.slot.getByTestId("oats-act-details"), "p")).toEqual(["the launch was sent and its session was not seen"]);
  expect(said).not.toContain("wasn't started");
  expect(start.slot.getByTestId("oats-start-refresh")).toBeTruthy();
});

// ---- the start of a tmux agent whose session was lost: a resume

/** The sample roster's agent on tmux, as a row that lost its session (the pilot's rows: not running, no word of the runtime's, sessionEnd "lost"). */
const TMUX = "kernel-fix-developer";
const lostRoster = () => fixtureAgents().map((agent): Agent => (agent.instance === TMUX ? { ...agent, running: false, runtimeState: null } : agent));
const lostCheck = (change: Parameters<typeof startCheckOf>[1] = {}) => startCheckOf(TMUX, { backend: "tmux", running: false, runtimeState: null, sessionEnd: "lost", harness: "claude", ...change });
/** What a resume answers (shaped from the kernel's doc: test/fixtures/lifecycle/README.md), as the plugin's server hands it on: no bb thread. */
const resumedAs = (resume: { resumed: boolean; reason: string | null; waiting: string | null }) => ({ threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume });
async function tmuxStart(over: Partial<Handlers>) {
  const { slot } = await menu("thr_plain", over, lostRoster());
  const { openAct } = await import("../../app/lifecycle");
  openAct("start", TMUX);
  await ready(slot);
  return slot;
}

test("Start of a tmux agent whose session was lost says that it tries to continue its last conversation, offers no harness and no model, and sends a resume; the result says what the kernel answered and opens no thread", async () => {
  const slot = await tmuxStart({ startCheck: () => lostCheck(), start: () => resumedAs({ resumed: true, reason: null, waiting: null }) });
  const dialog = slot.getByRole("dialog");
  expect(dialog.querySelector("h2")!.textContent).toBe("Start Kernel fix developer");
  // The ONE consequence line; nothing of a question its harness may ask (the result says it when it happens).
  expect(says(slot)).toEqual(["Tries to continue its last conversation; else starts fresh."]);
  plain(slot);
  expect(dialog.textContent).not.toMatch(/Claude may|how to load/);
  // Nothing of bb's: no full mode (under Details either), no new thread, no harness or model to choose.
  expect(under(slot, "oats-start-details", "p")).toEqual([]);
  expect(dialog.textContent).not.toContain("full mode");
  expect(dialog.textContent).not.toContain("stays readable in bb");
  expect(slot.queryByTestId("oats-start-harness")).toBeNull();
  expect(slot.queryByTestId("oats-start-model")).toBeNull();
  // The plain start stays, on purpose: a choice that is off.
  expect(within(slot.getByTestId("oats-start-fresh-choice")).getByRole("switch").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: TMUX, resume: true }]);
  const result = slot.getByTestId("oats-result");
  expect(result.querySelector("h3")!.textContent).toBe("Kernel fix developer is back in its last conversation.");
  expect(result.getAttribute("data-tone")).toBe("done");
  expect(slot.queryByTestId("oats-start-waiting")).toBeNull();
  // No thread to open: the way into it, in the panel's own word, and the command that attaches, with its Copy.
  expect(slot.inspection.navigateCalls).toEqual([]);
  const where = slot.getByTestId("oats-start-where");
  expect(where.querySelector("p")!.textContent).toBe("Attach:");
  expect(where.textContent).toContain(`oats session attach --home /abs/deployment/agents/oats-expert/instances/${TMUX}`);
  expect(where.querySelector("button")).not.toBeNull();
  expect(where.textContent).not.toContain("Runs in tmux");
});

test("a resume that started fresh leads with that, in the warning tone, then the kernel's reason; one whose harness waits says so apart, and both say where it runs", async () => {
  const fresh = await tmuxStart({ startCheck: () => lostCheck(), start: () => resumedAs({ resumed: false, reason: "no-conversation", waiting: null }) });
  fireEvent.click(button(fresh, "oats-confirm-act"));
  await waitFor(() => expect(fresh.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown")); // the pattern's warning tone
  expect(fresh.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Kernel fix developer started fresh.");
  expect(texts(fresh.getByTestId("oats-result"), "p").slice(0, 1)).toEqual(["Its last conversation was not found."]); // the kernel's reason, its one line
  expect(fresh.getByTestId("oats-result").textContent).not.toContain("is back in its last conversation");
  expect(fresh.getByTestId("oats-start-where").textContent).toContain("oats session attach --home");
  resetApp();
  const waiting = await tmuxStart({ startCheck: () => lostCheck(), start: () => resumedAs({ resumed: true, reason: null, waiting: "resume-confirmation" }) });
  fireEvent.click(button(waiting, "oats-confirm-act"));
  await phase(waiting, "done");
  const notice = within(waiting.getByTestId("oats-start-waiting")).getByTestId("oats-notice");
  expect(notice.getAttribute("data-tone")).toBe("warning");
  expect(notice.querySelector("h3")!.textContent).toBe("Waiting for you in its terminal.");
  // The way into that terminal follows, once.
  expect(waiting.getByTestId("oats-start-where").textContent).toContain(`oats session attach --home /abs/deployment/agents/oats-expert/instances/${TMUX}`);
  expect(waiting.getByTestId("oats-start-waiting").compareDocumentPosition(waiting.getByTestId("oats-start-where")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("the plain start of a lost tmux agent stays, on purpose: the choice says what it loses, and sends no resume", async () => {
  const slot = await tmuxStart({ startCheck: () => lostCheck(), start: () => ({ threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume: null }) });
  fireEvent.click(within(slot.getByTestId("oats-start-fresh-choice")).getByRole("switch"));
  expect(slot.getByTestId("oats-start-fresh-warning").textContent).toBe("Its last conversation is not brought back.");
  expect(says(slot)).toEqual(["Starts a new conversation."]);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: TMUX }]);
  expect(slot.getByTestId("oats-result").textContent).not.toContain("last conversation");
});

test("a resume the kernel refuses because the session is not lost any more goes back to the check, says that something changed, and then offers the plain start", async () => {
  let lost = true;
  const slot = await tmuxStart({
    startCheck: () => (lost ? lostCheck() : lostCheck({ sessionEnd: "stopped", runtimeState: "stopped" })),
    start: ({ resume }) => {
      if (resume === true) {
        lost = false;
        throw Object.assign(new Error("E_RESUME_NOT_LOST: kernel-fix-developer did not lose its session (stopped)"), { code: "conflict" });
      }
      return { threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume: null };
    },
  });
  fireEvent.click(button(slot, "oats-confirm-act"));
  await waitFor(() => expect(calls(slot, "startCheck")).toHaveLength(2));
  await ready(slot);
  const notice = within(slot.getByTestId("oats-confirm")).getByTestId("oats-notice");
  expect(notice.querySelector("h3")!.textContent).toBe("Something changed since you opened this");
  expect(texts(notice, "p")).toEqual(["Its session is no longer lost."]);
  // The row now says an operator stopped it: a plain start, with no choice of a resume; its one line says what Start does now.
  expect(slot.queryByTestId("oats-start-fresh-choice")).toBeNull();
  expect(says(slot)).toEqual(["Starts a new conversation."]);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: TMUX, resume: true }, { instance: TMUX }]);
});

test("a resume refused because the launch settings changed says that it can only start fresh, OATS's line under Details; Refresh status brings the dialog back with the fresh start already chosen and its line on what is lost", async () => {
  const refusing = (): Partial<Handlers> => ({
    startCheck: () => lostCheck(),
    start: ({ resume }) => {
      if (resume === true) throw Object.assign(new Error("E_LAUNCH_ENV_CHANGED: a launch value differs from the one it last ran with: ANTHROPIC_BASE_URL"), { code: "conflict" });
      return { threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume: null };
    },
  });
  const slot = await tmuxStart(refusing());
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "failed");
  const refused = slot.getByTestId("oats-result").textContent!;
  expect(refused).toContain("Its launch settings changed, so it can only start fresh.");
  // No sentence names a control that is not on the screen: the choice is not drawn beside a result, and is not named.
  expect(refused).not.toContain("Tick");
  expect(slot.queryByTestId("oats-start-fresh-choice")).toBeNull();
  // OATS's own line is one press away, under Details.
  expect(slot.getByTestId("oats-act-details").textContent).toContain("a launch value differs from the one it last ran with: ANTHROPIC_BASE_URL");
  // Refresh status: the dialog again, with the plain start ALREADY chosen and what it loses said; nothing is started by that.
  fireEvent.click(button(slot, "oats-start-refresh"));
  await ready(slot);
  expect(calls(slot, "start")).toHaveLength(1);
  expect(within(slot.getByTestId("oats-start-fresh-choice")).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect(slot.getByTestId("oats-start-fresh-warning").textContent).toBe("Its last conversation is not brought back.");
  expect(says(slot)).toEqual(["Starts a new conversation."]);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: TMUX, resume: true }, { instance: TMUX }]);
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Kernel fix developer started.");
  resetApp();
  // The person may turn it off again: the resume is asked once more (and the kernel answers as it will).
  const again = await tmuxStart(refusing());
  fireEvent.click(button(again, "oats-confirm-act"));
  await phase(again, "failed");
  fireEvent.click(button(again, "oats-start-refresh"));
  await ready(again);
  fireEvent.click(within(again.getByTestId("oats-start-fresh-choice")).getByRole("switch"));
  expect(again.queryByTestId("oats-start-fresh-warning")).toBeNull();
  fireEvent.click(button(again, "oats-confirm-act"));
  await phase(again, "failed");
  expect(calls(again, "start").map((call) => call.input)).toEqual([{ instance: TMUX, resume: true }, { instance: TMUX, resume: true }]);
  resetApp();
  // Left while it ran: Show result opens the result, and Refresh status from there has the choice on too.
  let fail!: (cause: unknown) => void;
  const held = new Promise<never>((_, reject) => (fail = reject));
  const left = await tmuxStart({ startCheck: () => lostCheck(), start: () => held });
  const before = await leave(left);
  fail(Object.assign(new Error("E_LAUNCH_ENV_CHANGED: a launch value differs"), { code: "conflict" }));
  await waitFor(() => expect(notified().length).toBe(before + 1));
  act(() => notified().at(-1)!.open!.run());
  await phase(left, "failed");
  fireEvent.click(button(left, "oats-start-refresh"));
  await ready(left);
  expect(within(left.getByTestId("oats-start-fresh-choice")).getByRole("switch").getAttribute("aria-checked")).toBe("true");
});

test("a resume is for tmux alone: a lost agent on bb keeps its dialog (a new thread, the carry-on line), and a tmux agent an operator stopped starts plainly", async () => {
  const bb = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance, { running: false, runtimeState: "stopped", sessionEnd: "lost" }), start: () => startedIn("thr_digest_2") });
  await bb.pick("start");
  await ready(bb.slot);
  expect(bb.slot.queryByTestId("oats-start-fresh-choice")).toBeNull();
  expect(bb.slot.getByTestId("oats-start-thread")).toBeTruthy();
  expect(says(bb.slot)).toEqual(["Starts a new conversation."]);
  fireEvent.click(button(bb.slot, "oats-confirm-act"));
  await phase(bb.slot, "done");
  expect(calls(bb.slot, "start").map((call) => call.input)).toEqual([{ instance: "weekly-digest-helper" }]);
  resetApp();
  const stopped = await tmuxStart({ startCheck: () => lostCheck({ sessionEnd: "stopped", runtimeState: "stopped" }), start: () => ({ threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume: null }) });
  expect(stopped.queryByTestId("oats-start-fresh-choice")).toBeNull();
  expect(stopped.getByTestId("oats-confirm").textContent).not.toContain("continue its last conversation");
  fireEvent.click(button(stopped, "oats-confirm-act"));
  await phase(stopped, "done");
  expect(calls(stopped, "start").map((call) => call.input)).toEqual([{ instance: TMUX }]);
});

test("AgentActs offers Start for a tmux agent that does not run, and Stop, Restart and Retire for one that runs: as for an agent on bb", async () => {
  const { AgentActs } = await import("../../app/lifecycle");
  const offered = async (agents: Agent[]) => {
    const slot = renderSlot<object, Contract>({ component: () => <AgentActs instance={TMUX} /> }, {}, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads(), sdk: modelsSdk() });
    await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
    await waitFor(() => expect(slot.queryByTestId("oats-agent-acts")).not.toBeNull());
    const labels = Array.from(slot.getByTestId("oats-agent-acts").querySelectorAll("button")).map((each) => each.textContent);
    resetApp();
    return labels;
  };
  expect(await offered(lostRoster())).toEqual(["Start…", "Retire…"]);
  expect(await offered(fixtureAgents())).toEqual(["Stop…", "Restart…", "Retire…"]);
});

test("Restart of an agent on tmux is the plain restart: no harness or model, no thread; the result says that it restarted, with the command that attaches to it", async () => {
  const { slot } = await menu("thr_plain", {
    startCheck: () => startCheckOf(TMUX, { backend: "tmux", running: true, runtimeState: "running", sessionEnd: null }),
    restart: () => ({ threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume: null }),
  });
  const { openAct } = await import("../../app/lifecycle");
  openAct("restart", TMUX);
  await ready(slot);
  expect(says(slot)).toEqual(["Stops what it is doing now."]);
  // Under Details: that it starts a new conversation too; nothing of bb's full mode (it does not run in bb).
  expect(under(slot, "oats-start-details", "p")).toEqual(["Starts a new conversation."]);
  expect(slot.queryByTestId("oats-start-harness")).toBeNull();
  expect(slot.queryByTestId("oats-start-model")).toBeNull();
  expect(slot.queryByTestId("oats-start-fresh-choice")).toBeNull();
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "done");
  expect(calls(slot, "restart").map((call) => call.input)).toEqual([{ instance: TMUX }]);
  expect(slot.getByTestId("oats-result").querySelector("h3")!.textContent).toBe("Kernel fix developer restarted.");
  expect(slot.getByTestId("oats-start-where").querySelector("p")!.textContent).toBe("Attach:");
  expect(slot.getByTestId("oats-start-where").textContent).toContain(`oats session attach --home /abs/deployment/agents/oats-expert/instances/${TMUX}`);
  expect(slot.inspection.navigateCalls).toEqual([]);
});

test("before a resume the dialog says one line, whatever harness is recorded: no line on a question Claude may ask (the result says it when it happens)", async () => {
  for (const harness of ["claude", "pi", "codex", null] as const) {
    const slot = await tmuxStart({ startCheck: () => lostCheck({ harness }) });
    expect(says(slot), String(harness)).toEqual(["Tries to continue its last conversation; else starts fresh."]);
    expect(slot.getByTestId("oats-confirm").textContent, String(harness)).not.toMatch(/Claude may|how to load/);
    resetApp();
  }
  // When it happens: the start succeeded and its harness waits. Said then, apart, in the warning tone.
  const waiting = await tmuxStart({ startCheck: () => lostCheck(), start: () => resumedAs({ resumed: true, reason: null, waiting: "resume-confirmation" }) });
  fireEvent.click(button(waiting, "oats-confirm-act"));
  await phase(waiting, "done");
  expect(within(waiting.getByTestId("oats-start-waiting")).getByTestId("oats-notice").querySelector("h3")!.textContent).toBe("Waiting for you in its terminal.");
});

// ---- the same safety rules for an agent on tmux as for one on bb (the lead's requirement), one test per rule

test("tmux, rule 1: the dialog is named from the kernel's check, never from the place that was pressed", async () => {
  // The check answers for another agent than the one asked: no plan is drawn and nothing can be confirmed.
  const slot = await menu("thr_plain", { startCheck: () => lostCheck({ instance: "another-tmux-agent" }) }, lostRoster());
  const { openAct } = await import("../../app/lifecycle");
  openAct("start", TMUX);
  await waitFor(() => expect(slot.slot.getByRole("dialog").textContent).toContain("This is not the plan for this agent."));
  expect(slot.slot.getByRole("dialog").textContent).not.toContain("continue its last conversation");
  expect(button(slot.slot, "oats-confirm-act").disabled).toBe(true);
  resetApp();
  // And named as the kernel names it.
  const named = await tmuxStart({ startCheck: () => lostCheck() });
  expect(named.getByRole("dialog").querySelector("h2")!.textContent).toBe("Start Kernel fix developer");
});

test("tmux, rule 2: the consequence is said before the press, for each of its three shapes: a resume, a plain start, a restart", async () => {
  const says = async (verb: "start" | "restart", check: Parameters<typeof startCheckOf>[1]) => {
    const { slot } = await menu("thr_plain", { startCheck: () => startCheckOf(TMUX, { backend: "tmux", harness: "pi", ...check }) }, lostRoster());
    const { openAct } = await import("../../app/lifecycle");
    openAct(verb, TMUX);
    await ready(slot);
    const lines = texts(slot.getByTestId("oats-confirm-says"), "li");
    resetApp();
    return lines;
  };
  // ONE line each, in view, before the press.
  expect(await says("start", { running: false, runtimeState: null, sessionEnd: "lost" })).toEqual(["Tries to continue its last conversation; else starts fresh."]);
  // Stopped by an operator (the kernel's row of a tmux home stopped with OATS: runtimeState "shell", sessionEnd "stopped"): the same words as for bb, and nothing of a bb thread.
  expect(await says("start", { running: false, runtimeState: "shell", sessionEnd: "stopped" })).toEqual(["Starts a new conversation."]);
  expect(await says("restart", { running: true, runtimeState: null, sessionEnd: null })).toEqual(["Stops what it is doing now."]);
});

test("tmux, rule 3: one act per press: opening the dialog starts nothing, and a second press while it runs sends nothing more", async () => {
  let answer!: (started: ReturnType<typeof resumedAs>) => void;
  const held = new Promise<ReturnType<typeof resumedAs>>((resolve) => (answer = resolve));
  const slot = await tmuxStart({ startCheck: () => lostCheck(), start: () => held });
  expect(calls(slot, "start", "restart")).toEqual([]);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  expect(button(slot, "oats-confirm-act").disabled).toBe(true);
  fireEvent.click(button(slot, "oats-confirm-act"));
  answer(resumedAs({ resumed: true, reason: null, waiting: null }));
  await phase(slot, "done");
  expect(calls(slot, "start")).toHaveLength(1);
});

test("tmux, rule 4: on a roster kept as last read the acts of a tmux agent are held, with no reason of their own (the place that draws them draws the notice), and its Start opens nothing", async () => {
  const { AgentActs } = await import("../../app/lifecycle");
  const last = { at: new Date(Date.now() - 2 * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: lostRoster() };
  const slot = renderSlot<object, Contract>(
    { component: () => <AgentActs instance={TMUX} /> },
    {},
    { rpc: handlers({ snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last }) }), sidebarThreads: sidebarThreads(), sdk: modelsSdk() },
  );
  await waitFor(() => expect(slot.queryByTestId("oats-agent-acts")).not.toBeNull());
  const buttons = Array.from(slot.getByTestId("oats-agent-acts").querySelectorAll("button"));
  expect(buttons.map((each) => `${each.textContent}${each.disabled ? " (off)" : ""}`)).toEqual(["Start… (off)", "Retire… (off)"]);
  // No reason beside the acts (test/panel/panel.test.tsx and test/outside/places.test.tsx pin the notice of each place that draws them).
  expect(slot.queryByTestId("oats-disabled-reason")).toBeNull();
  fireEvent.click(buttons[0]!);
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(calls(slot as never, "startCheck", "start")).toEqual([]);
});

// ---- an agent that is idle with no harness loaded ("Idle · not loaded") does not run: Start is for it

test("the Start key on an agent that is idle with no harness loaded opens Start, and never says that it is already running; with a harness loaded it still says so", async () => {
  // The kernel's row of a provider's session that is there with no harness: running false beside "unknown", no end of a session.
  const idle = (running: boolean) => fixtureAgents().map((agent): Agent => (agent.instance === "weekly-digest-helper" ? { ...agent, running, runtimeState: "unknown", sessionEnd: null } : agent));
  const { slot, shown } = await menu("thr_digest", { startCheck: () => startCheckOf("weekly-digest-helper", { running: false, runtimeState: "unknown", sessionEnd: null }) }, idle(false));
  // The thread's menu follows the same rule as the key: Start is among its acts.
  expect(shown()).toEqual(["stop", "start", "restart", "retire"]);
  const { commands } = await import("../../app/lifecycle");
  const press = (id: string) => commands.find((each) => each.id === id)!.run({ threadId: "thr_digest", projectId: null, experimental_panel: {} as never });
  const before = notified().length;
  await press("agent-start");
  await ready(slot);
  expect(slot.getByRole("dialog").querySelector("h2")!.textContent).toBe("Start Weekly digest helper");
  expect(notified().length).toBe(before);
  expect(notified().map((said) => said.title).join(" ")).not.toMatch(/already running/);
  resetApp();
  // Idle WITH a harness loaded (the kernel's `running: true`): it runs, and the key says so.
  const loaded = await menu("thr_digest", {}, idle(true));
  expect(loaded.shown()).toEqual(["stop", "restart", "retire"]);
  const again = await import("../../app/lifecycle");
  await again.commands.find((each) => each.id === "agent-start")!.run({ threadId: "thr_digest", projectId: null, experimental_panel: {} as never });
  expect(notified().at(-1)).toMatchObject({ tone: "hint", title: "Weekly digest helper is already running." });
  expect(loaded.slot.queryByRole("dialog")).toBeNull();
});

// ---- a tmux act whose dialog was left: no result of it is told whole by a toast (its result says where it runs)

test("a tmux start, a resume and a resume that started fresh, each left while it runs: the toast stays with Show result, never plain; the fresh one in the warning tone; the dialog again has the command that attaches to it", async () => {
  type Answer = ReturnType<typeof resumedAs> | { threadId: null; instance: string; harness: string; model: null; warnings: string[]; resume: null };
  const left = async (check: () => ReturnType<typeof lostCheck>, answer: Answer) => {
    let give!: (started: Answer) => void;
    const held = new Promise<Answer>((resolve) => (give = resolve));
    const slot = await tmuxStart({ startCheck: check, start: () => held });
    const before = await leave(slot);
    give(answer);
    await waitFor(() => expect(notified().length).toBe(before + 1));
    const toast = notified().at(-1)!;
    expect(toast.stays).toBe(true);
    expect(toast.open!.label).toBe("Show result");
    act(() => toast.open!.run());
    await phase(slot, "done");
    const where = slot.getByTestId("oats-start-where").textContent!;
    expect(slot.getByTestId("oats-start-where").querySelector("p")!.textContent).toBe("Attach:");
    expect(where).toContain(`oats session attach --home /abs/deployment/agents/oats-expert/instances/${TMUX}`);
    expect(within(slot.getByTestId("oats-start-where")).getByRole("button", { name: "Copy the command" })).toBeTruthy();
    // Shown again, the kernel is asked nothing more.
    expect(calls(slot, "start")).toHaveLength(1);
    resetApp();
    return { tone: toast.tone, title: toast.title, lines: toast.lines };
  };
  const stopped = () => lostCheck({ runtimeState: "shell", sessionEnd: "stopped" });
  expect(await left(stopped, { threadId: null, instance: TMUX, harness: "claude", model: null, warnings: [], resume: null })).toEqual({ tone: "done", title: "Kernel fix developer started.", lines: [] });
  expect(await left(() => lostCheck(), resumedAs({ resumed: true, reason: null, waiting: null }))).toEqual({ tone: "done", title: "Kernel fix developer is back in its last conversation.", lines: [] });
  expect(await left(() => lostCheck(), resumedAs({ resumed: false, reason: "no-conversation", waiting: null }))).toEqual({ tone: "unknown", title: "Kernel fix developer started fresh.", lines: [] });
});

test("a tmux start whose end is not known still says where it runs, with the command: its session is or may be there", async () => {
  const slot = await tmuxStart({
    startCheck: () => lostCheck(),
    start: () => {
      throw Object.assign(new Error("E_SPAWN_INCOMPLETE: launch requires inspection"), { code: "conflict" });
    },
  });
  fireEvent.click(button(slot, "oats-confirm-act"));
  await waitFor(() => expect(slot.getByTestId("oats-result").getAttribute("data-tone")).toBe("unknown"));
  // The sentence names no thread (a tmux agent has none): the command that attaches is under it.
  expect(slot.getByTestId("oats-result").textContent).toContain("Its session was kept. Refresh status before another try.");
  expect(slot.getByTestId("oats-result").textContent).not.toContain("open its thread");
  expect(slot.getByTestId("oats-start-where").textContent).toContain(`oats session attach --home /abs/deployment/agents/oats-expert/instances/${TMUX}`);
  resetApp();
  // A start the kernel REFUSED started nothing: no place is said for it.
  const refused = await tmuxStart({
    startCheck: () => lostCheck(),
    start: () => {
      throw Object.assign(new Error("E_SESSION_RUNNING: kernel-fix-developer is running (unknown); nothing was started"), { code: "conflict" });
    },
  });
  fireEvent.click(button(refused, "oats-confirm-act"));
  await phase(refused, "failed");
  expect(refused.queryByTestId("oats-start-where")).toBeNull();
});

test("Start and Restart are for an agent on bb and for one on tmux: an agent of another session provider has Stop and Retire alone, in every state", async () => {
  const { AgentActs } = await import("../../app/lifecycle");
  const other = (change: Partial<Agent>) => fixtureAgents().map((agent): Agent => (agent.instance === TMUX ? { ...agent, backend: "other", ...change } : agent));
  const offered = async (agents: Agent[]) => {
    const slot = renderSlot<object, Contract>({ component: () => <AgentActs instance={TMUX} /> }, {}, { rpc: handlers({}, agents), sidebarThreads: sidebarThreads(), sdk: modelsSdk() });
    await waitFor(() => expect(slot.queryByTestId("oats-agent-acts")).not.toBeNull());
    const labels = Array.from(slot.getByTestId("oats-agent-acts").querySelectorAll("button")).map((each) => each.textContent);
    resetApp();
    return labels;
  };
  expect(await offered(other({}))).toEqual(["Stop…", "Retire…"]);
  expect(await offered(other({ running: false, runtimeState: null }))).toEqual(["Retire…"]);
});

test("a resume left while it runs that the kernel refuses because the session is not lost any more, and one whose end is not known: each toast stays with Show result, and the dialog again has what it offers", async () => {
  const left = async (code: string) => {
    let fail!: (cause: unknown) => void;
    const held = new Promise<never>((_, reject) => (fail = reject));
    const slot = await tmuxStart({ startCheck: () => lostCheck(), start: () => held });
    const before = await leave(slot);
    fail(Object.assign(new Error(`${code}: as the kernel says it`), { code: "conflict" }));
    await waitFor(() => expect(notified().length).toBe(before + 1));
    const toast = notified().at(-1)!;
    expect(toast).toMatchObject({ stays: true, open: { label: "Show result" } });
    act(() => toast.open!.run());
    await waitFor(() => expect(slot.queryByTestId("oats-result")).not.toBeNull());
    return { slot, toast };
  };
  // Not lost any more: told as not started, with the reason; Refresh status reads the row again.
  const notLost = await left("E_RESUME_NOT_LOST");
  expect(notLost.toast).toMatchObject({ tone: "failed", title: "Kernel fix developer wasn't started" });
  expect(notLost.slot.getByTestId("oats-result").textContent).toContain("Its session is no longer lost.");
  expect(notLost.slot.queryByTestId("oats-start-where")).toBeNull();
  expect(button(notLost.slot, "oats-start-refresh")).toBeTruthy();
  resetApp();
  // Its end is not known: the session is or may be there, so where it runs is said.
  const unknown = await left("E_SPAWN_INCOMPLETE");
  expect(unknown.toast).toMatchObject({ tone: "unknown", title: "OATS could not confirm that Kernel fix developer finished starting" });
  expect(unknown.slot.getByTestId("oats-start-where").textContent).toContain("oats session attach --home");
});

// ---- behind a result (the lead's L13): a result that says the agents changed marks them, with the stamp of the roster the
// window held when the act was SENT; the places that say their state then say "Reading…" until the roster is read again
// (test/roster/reading.test.tsx). A result that says nothing changed marks nothing.

test("a result that says the agents stopped marks every agent of the plan, with the roster's stamp from when the act was sent; nothing before the result", async () => {
  const { actedAt } = await import("../../app/roster/reading");
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf(), stopApply: () => held.then(() => stopReceiptOf()) });
  await pick("stop");
  await ready(slot);
  fireEvent.click(button(slot, "oats-confirm-act"));
  await phase(slot, "running");
  const TARGETS = ["redesign-ui-lead", "desktop-mockups-developer", "harvest-knowledge-helper"];
  expect(TARGETS.map(actedAt)).toEqual([null, null, null]); // the act runs: nothing is said of its end yet
  release();
  await phase(slot, "done");
  expect(TARGETS.map(actedAt)).toEqual([fixtureSnapshot().at, fixtureSnapshot().at, fixtureSnapshot().at]); // the server's stamp of the roster, never the window's clock
  expect(actedAt("weekly-digest-helper")).toBeNull(); // no agent the plan did not stop
});

test("a start and a retire that are done mark their agent; a refused apply marks nothing", async () => {
  const { actedAt } = await import("../../app/roster/reading");
  const start = await menu("thr_digest", { startCheck: ({ instance }) => startCheckOf(instance), start: () => startedIn("thr_digest_2") });
  await start.pick("start");
  await ready(start.slot);
  expect(actedAt("weekly-digest-helper")).toBeNull();
  fireEvent.click(button(start.slot, "oats-confirm-act"));
  await phase(start.slot, "done");
  expect(actedAt("weekly-digest-helper")).toBe(fixtureSnapshot().at);
  resetApp();
  expect(actedAt("weekly-digest-helper")).toBeNull();
  const retire = await menu("thr_digest", { retirePlan: () => retirePlanOf(), retireApply: () => retireReceiptOf() });
  await retire.pick("retire");
  await ready(retire.slot);
  fireEvent.click(button(retire.slot, "oats-confirm-act"));
  await phase(retire.slot, "done");
  expect(actedAt("weekly-digest-helper")).toBe(fixtureSnapshot().at);
  resetApp();
  const refused = await menu("thr_digest", {
    retirePlan: () => retirePlanOf(),
    retireApply: () => {
      throw new Error("E_CHILDREN_RUNNING: 1 child still runs: digest-links-helper\n  stop it first");
    },
  });
  await refused.pick("retire");
  await ready(refused.slot);
  fireEvent.click(button(refused.slot, "oats-confirm-act"));
  await phase(refused.slot, "failed");
  expect(actedAt("weekly-digest-helper")).toBeNull();
});

// ---- a plan is of the moment it was read (the pass for what reads as present, 24 Nov 2026): its age is said under
// Details, before the way to read it again, in the plugin's one form for content read earlier.

test("a Stop and a Retire plan say how old they are under Details, before Check again: \"Read <age>.\"; nothing of it on the dialog's face", async () => {
  for (const [verb, over] of [["stop", { stopPlan: () => stopPlanOf() }], ["retire", { retirePlan: () => retirePlanOf() }]] as const) {
    const { slot, pick } = await menu(verb === "stop" ? "thr_redesign" : "thr_digest", over);
    await pick(verb);
    await ready(slot);
    const details = slot.getByTestId("oats-plan-details");
    const read = within(details).getByTestId("oats-plan-read");
    expect(read.textContent).toBe("Read less than a minute ago.");
    expect(read.nextElementSibling).toBe(within(details).getByTestId("oats-plan-check"));
    expect(within(details).getByTestId("oats-plan-check").textContent).toBe("Check again");
    expect(slot.getAllByTestId("oats-plan-read")).toHaveLength(1);
    expect(texts(slot.getByTestId("oats-confirm"), "span, p, li").join(" ")).not.toMatch(/Read /); // the face is as it was
    resetApp();
  }
});

test("the plan's age follows the window's clock from the moment the plan was read, and starts again when it is read again", async () => {
  // (The clock and its ticks alone are the test's: the waits of the test run on the real timers.)
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  try {
    const { slot, pick } = await menu("thr_redesign", { stopPlan: () => stopPlanOf() });
    await pick("stop");
    await ready(slot);
    const read = () => slot.getByTestId("oats-plan-read").textContent;
    expect(read()).toBe("Read less than a minute ago.");
    act(() => void vi.advanceTimersByTime(3 * 60_000));
    expect(read()).toBe("Read 3 min ago.");
    fireEvent.click(button(slot, "oats-plan-check"));
    await waitFor(() => expect(read()).toBe("Read less than a minute ago."));
  } finally {
    vi.useRealTimers();
  }
});
