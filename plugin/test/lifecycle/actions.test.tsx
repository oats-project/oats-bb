// @vitest-environment jsdom
// A12: Stop, Start, Restart and Retire in the thread menu (experimental_threadAction), and the
// plan dialog the plugin's overlay draws.
import { afterEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { BbNavigate, PluginThreadAction, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
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
async function menu(threadId: string, over: Partial<Handlers> = {}, agents?: Agent[]) {
  const app = await loadApp();
  expect(app.threadActions.map((action) => [action.id, action.group])).toEqual([
    ["stop", "4_lifecycle"],
    ["start", "4_lifecycle"],
    ["restart", "4_lifecycle"],
    ["retire", "4_lifecycle"],
    ["unreadable", "4_lifecycle"],
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
    { rpc: handlers(over, agents), sidebarThreads: sidebarThreads() },
  );
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const shown = () => Object.entries(items).flatMap(([id, item]) => (item === null ? [] : [id]));
  const pick = (id: string) => items[id]!.run({ requestRename: () => {} });
  return { slot, shown, pick, label: (id: string) => items[id]!.label, item: (id: string) => items[id] ?? null };
}
const calls = (slot: Awaited<ReturnType<typeof menu>>["slot"], ...methods: string[]) =>
  slot.inspection.rpcCalls.filter((call) => methods.includes(call.method));

test("Stop shows on a working agent's thread, and not on a thread that is no agent", async () => {
  const working = await menu("thr_redesign");
  expect(working.shown()).toEqual(["stop", "restart", "retire"]);
  expect(working.label("stop")).toBe("Stop agent (OATS)");
  resetApp();
  const plain = await menu("thr_plain");
  expect(plain.shown()).toEqual([]);
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
  // is loaded) is IDLE, not stopped: the menu is an idle agent's, and the thread's own row says
  // what a message and Start each do, with Start (app/outside; the state's rule: test/model/view.test.ts).
  expect(await by("thr_harvest", with_({ running: false, runtimeState: "unknown" }))).toEqual(["stop", "restart", "retire"]);
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
test("while OATS cannot be read after it was, the acts stay in the menu, off, each with when it comes back; nothing runs", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const stale = () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "oats did not answer", last });
  const { shown, item, slot } = await menu("thr_redesign", { snapshot: stale });
  expect(shown()).toEqual(["stop", "restart", "retire"]);
  for (const id of ["stop", "restart", "retire"]) expect(item(id)).toMatchObject({ disabled: true, detail: "Comes back when OATS is read again" });
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

test("Stop shows the kernel's plan; Confirm calls stopPlan then stopApply with the plan's revision", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => ({ revision: "rev-7f3a", lines: ["Stops the bb thread thr_redesign", "Keeps the home and its identity"], instance: "redesign-ui-lead" }),
    stopApply: () => ({ ok: true }),
  });
  expect(slot.queryByRole("dialog")).toBeNull();
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  expect(dialog.textContent).toContain("Stop Redesign ui lead?");
  await waitFor(() => expect(slot.getByTestId("oats-plan").textContent).toBe("Stops the bb thread thr_redesignKeeps the home and its identity"));
  expect(calls(slot, "stopPlan", "stopApply").map((call) => call.method)).toEqual(["stopPlan"]); // asked once, nothing applied

  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const made = calls(slot, "stopPlan", "stopApply");
  expect(made.map((call) => call.method)).toEqual(["stopPlan", "stopApply"]);
  expect(made[0]!.input).toEqual({ instance: "redesign-ui-lead" });
  const apply = made[1]!.input as { instance: string; revision: string; key: string };
  expect(apply).toMatchObject({ instance: "redesign-ui-lead", revision: "rev-7f3a" });
  expect(apply.key).toMatch(/^[0-9a-f]{32}$/);
});

test("Cancel calls neither apply; Escape cancels too", async () => {
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => ({ revision: "r1", lines: ["Stops the thread"], instance: "redesign-ui-lead" }) });
  await pick("stop");
  await waitFor(() => expect(slot.getByTestId("oats-plan").textContent).toBe("Stops the thread"));
  fireEvent.click(slot.getByTestId("oats-plan-cancel"));
  expect(slot.queryByRole("dialog")).toBeNull();

  await pick("stop");
  fireEvent.keyDown(await slot.findByRole("dialog"), { key: "Escape" });
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(calls(slot, "stopApply", "retireApply")).toEqual([]);
});

test("Confirm is not offered before the plan is read", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: async () => (await held, { revision: "r1", lines: [], instance: "redesign-ui-lead" }) });
  await pick("stop");
  await slot.findByRole("dialog");
  expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(true);
  release();
  await waitFor(() => expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
});

test("a refused apply shows the kernel's code and message unchanged, keeps the dialog, and a retry reuses the key", async () => {
  const refusal = "E_PLAN_STALE: the plan revision rev-1 is no longer current\n  read the plan again";
  let refuse = true;
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => ({ revision: "rev-1", lines: ["Stops the thread"], instance: "redesign-ui-lead" }),
    stopApply: () => {
      if (refuse) throw new Error(refusal);
      return { ok: true };
    },
  });
  await pick("stop");
  await waitFor(() => expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  // The kernel's code and each of its lines, on a line of its own: no line break is drawn (ui/text.ts).
  const alert = await slot.findByRole("alert");
  expect(Array.from(alert.querySelectorAll("span.block")).map((line) => line.textContent)).toEqual([
    "E_PLAN_STALE: the plan revision rev-1 is no longer current",
    "read the plan again",
  ]);
  expect(slot.getByRole("dialog")).toBeTruthy();

  refuse = false;
  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const keys = calls(slot, "stopApply").map((call) => (call.input as { key: string }).key);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("after a refusal, reading the plan again asks the kernel for a new plan, applied with its revision and a new key", async () => {
  let revision = 1;
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => ({ revision: `rev-${revision++}`, lines: ["Stops the thread"], instance: "redesign-ui-lead" }),
    stopApply: ({ revision: asked }) => {
      if (asked === "rev-1") throw new Error("E_PLAN_STALE: stale");
      return { ok: true };
    },
  });
  await pick("stop");
  await waitFor(() => expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  await slot.findByRole("alert");
  fireEvent.click(slot.getByTestId("oats-plan-reread"));
  await waitFor(() => expect(calls(slot, "stopPlan")).toHaveLength(2));
  await waitFor(() => expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const applies = calls(slot, "stopApply").map((call) => call.input as { revision: string; key: string });
  expect(applies.map((apply) => apply.revision)).toEqual(["rev-1", "rev-2"]);
  expect(applies[0]!.key).not.toBe(applies[1]!.key);
});

test("a plan the kernel refuses to give is shown unchanged, with Retry and no Confirm", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => {
      throw new Error("E_INSTANCE_UNKNOWN: no instance named redesign-ui-lead");
    },
  });
  await pick("stop");
  expect((await slot.findByRole("alert")).textContent).toBe("E_INSTANCE_UNKNOWN: no instance named redesign-ui-leadRetry");
  expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(true);
});

test("Retire shows the kernel's plan and applies it with its revision", async () => {
  const { slot, pick, label } = await menu("thr_digest", {
    retirePlan: () => ({ revision: "rev-r", lines: ["Removes the home", "Keeps the branch agents/weekly-digest-helper"], instance: "weekly-digest-helper" }),
    retireApply: () => ({ ok: true }),
  });
  expect(label("retire")).toBe("Retire agent (OATS)");
  await pick("retire");
  expect((await slot.findByRole("dialog")).textContent).toContain("Retire Weekly digest helper?");
  await waitFor(() => expect(slot.getByTestId("oats-plan").textContent).toBe("Removes the homeKeeps the branch agents/weekly-digest-helper"));
  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  const made = calls(slot, "retirePlan", "retireApply", "stopPlan", "stopApply");
  expect(made.map((call) => call.method)).toEqual(["retirePlan", "retireApply"]);
  expect(made[1]!.input).toMatchObject({ instance: "weekly-digest-helper", revision: "rev-r" });
});

test("Start goes through OATS with no dialog, and opens the thread the kernel answers with", async () => {
  const { slot, pick } = await menu("thr_digest", { start: () => ({ threadId: "thr_digest_2" }) });
  await pick("start");
  expect(slot.queryByRole("dialog")).toBeNull();
  expect(calls(slot, "start").map((call) => call.input)).toEqual([{ instance: "weekly-digest-helper" }]);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_digest_2" }]);
});

test("Restart goes through OATS, and a refusal is shown with the kernel's code and message", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    restart: () => {
      throw new Error("E_SESSION_BUSY: a start is already in progress for redesign-ui-lead");
    },
  });
  await pick("restart");
  expect((await slot.findByRole("alert")).textContent).toBe("E_SESSION_BUSY: a start is already in progress for redesign-ui-lead");
  expect(slot.inspection.navigateCalls).toEqual([]);
  fireEvent.click(slot.getByTestId("oats-act-close"));
  expect(slot.queryByRole("dialog")).toBeNull();
});

test("a Start that fails while a plan dialog is open does not replace it: the failure shows when the dialog closes", async () => {
  let fail!: (cause: Error) => void;
  const { slot, pick } = await menu("thr_digest", {
    start: () => new Promise<never>((_resolve, reject) => (fail = reject)),
    retirePlan: () => ({ revision: "rev-r", lines: ["Removes the home"], instance: "weekly-digest-helper" }),
  });
  const starting = pick("start");
  await slot.findByTestId("oats-act-running");
  await pick("retire"); // the person moves on before Start answers
  await waitFor(() => expect(slot.getByTestId("oats-plan").textContent).toBe("Removes the home"));
  fail(new Error("E_SESSION_START_FAILED: the harness did not come up"));
  await starting;
  expect(slot.getByRole("dialog").textContent).toContain("Retire Weekly digest helper?"); // still the plan
  expect(slot.queryByRole("alert")).toBeNull();
  fireEvent.click(slot.getByTestId("oats-plan-cancel"));
  expect((await slot.findByRole("alert")).textContent).toBe("E_SESSION_START_FAILED: the harness did not come up");
  expect(slot.inspection.navigateCalls).toEqual([]);
});

test("a Start that succeeds after the person opened a plan dialog leaves their screen alone", async () => {
  let done!: (answer: { threadId: string }) => void;
  const { slot, pick } = await menu("thr_digest", {
    start: () => new Promise<{ threadId: string }>((resolve) => (done = resolve)),
    retirePlan: () => ({ revision: "rev-r", lines: ["Removes the home"], instance: "weekly-digest-helper" }),
  });
  const starting = pick("start");
  await slot.findByTestId("oats-act-running");
  await pick("retire");
  await slot.findByRole("dialog");
  done({ threadId: "thr_digest_2" });
  await starting;
  expect(slot.getByRole("dialog").textContent).toContain("Retire Weekly digest helper?");
  expect(slot.inspection.navigateCalls).toEqual([]);
});

test("while an apply is in flight the dialog cannot be closed, and its refusal is shown", async () => {
  let refuse!: (cause: Error) => void;
  const { slot, pick } = await menu("thr_digest", {
    retirePlan: () => ({ revision: "rev-r", lines: ["Removes the home"], instance: "weekly-digest-helper" }),
    retireApply: () => new Promise<never>((_resolve, reject) => (refuse = reject)),
  });
  await pick("retire");
  await waitFor(() => expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(slot.getByTestId("oats-plan-confirm"));
  await waitFor(() => expect(slot.getByTestId("oats-plan-confirm").textContent).toBe("Working…"));
  expect((slot.getByTestId("oats-plan-cancel") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(slot.getByTestId("oats-plan-cancel"));
  fireEvent.keyDown(slot.getByRole("dialog"), { key: "Escape" });
  fireEvent.mouseDown(slot.getByTestId("oats-modal"));
  expect(slot.getByRole("dialog")).toBeTruthy();
  refuse(new Error("E_RETIRE_REFUSED: the work tree holds uncommitted work"));
  expect((await slot.findByRole("alert")).textContent).toBe("E_RETIRE_REFUSED: the work tree holds uncommitted work");
  fireEvent.click(slot.getByTestId("oats-plan-cancel")); // and now it closes
  expect(slot.queryByRole("dialog")).toBeNull();
});

test("the plan's lines are the kernel's, each one filtered line: a line break is folded, and one that looks like a secret is withheld", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => ({ revision: "rev-1", lines: ["Stop redesign-ui-lead:\n\trunning", "its hook printed password: hunter2", "kept\u202E: its home"], instance: "redesign-ui-lead" }),
  });
  await pick("stop");
  await waitFor(() => expect((slot.getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  expect(Array.from(slot.getByTestId("oats-plan").querySelectorAll("li")).map((line) => line.textContent)).toEqual(["Stop redesign-ui-lead: running", "[withheld]", "kept\uFFFD: its home"]);
});

// The roster on screen may be older than what the kernel knows (it is kept while OATS cannot be
// read): a confirmation is titled with the agent the KERNEL's plan names, never with the row pressed.
test("the confirmation names the agent from the kernel's plan, not from the row that was pressed", async () => {
  const { slot, pick } = await menu("thr_redesign", { stopPlan: () => ({ revision: "r1", lines: ["Stop design-lead-2: running"], instance: "design-lead-2" }) });
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect(dialog.querySelector("h2")!.textContent).toBe("Stop Design lead 2?"));
  expect(dialog.textContent).not.toContain("Redesign ui lead?");
});

test("until the plan is read the confirmation names no agent", async () => {
  let release = () => undefined as void;
  const held = new Promise<void>((done) => (release = done));
  const { slot, pick } = await menu("thr_redesign", { stopPlan: async () => (await held, { revision: "r1", lines: [], instance: "redesign-ui-lead" }) });
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  expect(dialog.querySelector("h2")!.textContent).toBe("Stop an agent");
  release();
  await waitFor(() => expect(dialog.querySelector("h2")!.textContent).toBe("Stop Redesign ui lead?"));
});

test("an agent the kernel no longer knows: its refusal is a notice in the confirmation, nothing can be confirmed, and its row says so until the next roster", async () => {
  const { slot, pick } = await menu("thr_redesign", {
    stopPlan: () => {
      throw new Error('E_SESSION_UNKNOWN: no instance "redesign-ui-lead" under /abs/deployment/agents'); // the kernel's form (test/roster/gone.test.tsx reads the recorded ones)
    },
  });
  await pick("stop");
  const dialog = await slot.findByRole("dialog");
  const notice = await within(dialog).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("Redesign ui lead is not in OATS any more");
  expect(notice.textContent).toContain("Nothing was changed.");
  expect(notice.textContent).toContain("E_SESSION_UNKNOWN");
  expect((within(dialog).getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(true);
});
