// @vitest-environment jsdom
// An agent the kernel no longer knows, while the roster on screen still lists it: the act that
// finds it out says so as a notice, and the agent's rows (the sidebar's, the thread's own) say
// "Not in OATS any more" until the next roster is read. The places are rendered TOGETHER: the
// link between the refusal and the rows is what is held here.
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saysGone } from "../../app/roster/gone";
import { refusalCode } from "../../app/ui/text";
import { fixtureSnapshot } from "../helpers/fixtures";
import { FIXTURES } from "../support/fake-oats.js";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

const INSTANCE = "weekly-digest-helper"; // stopped, on thr_digest
const THREAD = "thr_digest";

/** The sidebar, the thread's row and the overlay in one tree; → the slot, and how to ask an act as a place does. */
async function places(over: Partial<Handlers>) {
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const Row = app.threadHeaderRows[0]!.component;
  const Overlay = app.appOverlays[0]!.component;
  const acts = await import("../../app/lifecycle/acts");
  let ask!: { plan: (verb: "stop" | "retire") => void; run: (verb: "start" | "restart") => void };
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: function Places(props: PluginThreadListProps) {
        const rpc = useRpc<Contract>();
        const navigate = useBbNavigate();
        ask = { plan: (verb) => acts.askPlan(verb, INSTANCE), run: (verb) => void acts.run(verb, INSTANCE, rpc, navigate) };
        return (
          <>
            <List {...props} />
            <Row threadId={THREAD} projectId="proj_oats" environment={null} />
            <Overlay />
          </>
        );
      },
    } as never,
    { activeThreadId: THREAD, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers(over), sidebarThreads: sidebarThreads() },
  );
  await slot.findByTestId("oats-tree");
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === THREAD)!).getByTestId("oats-row-facts").textContent;
  const mark = () => slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === THREAD)!.querySelector("[data-mark]")!.getAttribute("data-state");
  const line = () => slot.getByTestId("oats-status-line").textContent;
  return { slot, ask: () => ask, facts, mark, line };
}

const refuse = (text: string) => () => {
  throw new Error(text);
};

/**
 * What the REAL kernel answers when each act is asked for an agent it no longer has: recorded by
 * the real run (container/real/scenario.mjs, A15), never worded by hand. As the plugin's server
 * words a refusal for a client: `<code>: <message>`.
 */
const GONE = JSON.parse(readFileSync(join(FIXTURES, "lifecycle", "gone.json"), "utf8")) as Record<"start" | "restart" | "stopPlan" | "stopApply" | "retirePlan" | "retireApply", { error: { code: string; message: string } }>;
const kernelSays = (act: keyof typeof GONE) => `${GONE[act].error.code}: ${GONE[act].error.message}`;

test("a stop plan the kernel refuses for an agent it does not know: the notice, and both rows say so, with no act left on the thread's row", async () => {
  const { slot, ask, facts, line } = await places({ stopPlan: refuse(kernelSays("stopPlan")) });
  expect(facts()).toBe("Stopped · oats-expert");
  expect(line()).toBe("StoppedStart");
  act(() => ask().plan("stop"));
  const notice = await within(await slot.findByRole("dialog")).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("weekly-digest-helper is not in OATS any more");
  await waitFor(() => expect(facts()).toBe("Not in OATS any more · oats-expert"));
  expect(line()).toBe("Not in OATS any more· OATS has no agent of this name now"); // the words, with the separator the line draws
  expect(slot.queryByTestId("oats-status-act")).toBeNull();
});

test("Start on an agent whose home is gone: the same notice, nothing to try again, and the rows say so", async () => {
  const { slot, ask, facts, mark } = await places({ start: refuse(kernelSays("start")) });
  act(() => ask().run("start"));
  const dialog = await slot.findByRole("dialog");
  const notice = await within(dialog).findByRole("alert");
  expect(dialog.querySelector("h2")!.textContent).toBe("Start did not happen"); // no agent named from the row
  expect(notice.querySelector("h3")!.textContent).toBe("weekly-digest-helper is not in OATS any more");
  expect(within(dialog).queryByTestId("oats-act-again")).toBeNull();
  await waitFor(() => expect(facts()).toBe("Not in OATS any more · oats-expert"));
  expect(mark()).toBe("stopped");
});

test("the same code for a session whose state cannot be established is not 'gone': the kernel's refusal, Try again, and the rows unchanged", async () => {
  const { slot, ask, facts } = await places({ start: refuse("E_SESSION_UNKNOWN: cannot establish whether weekly-digest-helper is running") });
  act(() => ask().run("start"));
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByTestId("oats-act-failed").textContent).toContain("cannot establish whether weekly-digest-helper is running"));
  expect(within(dialog).getByTestId("oats-act-failed").textContent).toContain("OATS was asked to start weekly-digest-helper.");
  expect(within(dialog).getByTestId("oats-act-again")).toBeTruthy();
  expect(facts()).toBe("Stopped · oats-expert");
});

test("an apply the kernel refuses because the agent went after the plan was read: the notice replaces the plan, and the rows say so", async () => {
  const { slot, ask, facts } = await places({
    stopPlan: () => ({ revision: "r1", lines: ["Stop weekly-digest-helper: not running"], instance: INSTANCE }),
    stopApply: refuse(kernelSays("stopApply")),
  });
  act(() => ask().plan("stop"));
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect((within(dialog).getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByTestId("oats-plan-confirm"));
  const notice = await within(dialog).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("weekly-digest-helper is not in OATS any more");
  expect((within(dialog).getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(facts()).toBe("Not in OATS any more · oats-expert"));
});

test("an act asked while OATS itself cannot be read: the confirmation opens on the same notice every place shows, in a person's words, with Retry", async () => {
  let fail = true;
  const { slot, ask } = await places({
    stopPlan: () => {
      if (fail) throw new Error("OATS_NOT_FOUND: oats was not found on falcon: install OATS there");
      return { revision: "r1", lines: ["Stop weekly-digest-helper: not running"], instance: INSTANCE };
    },
  });
  act(() => ask().plan("stop"));
  const dialog = await slot.findByRole("dialog");
  const notice = await within(dialog).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on falcon");
  expect(notice.textContent!.indexOf("OATS_NOT_FOUND")).toBeGreaterThan(notice.textContent!.indexOf("Install OATS there"));
  fail = false;
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(dialog.querySelector("h2")!.textContent).toBe("Stop weekly-digest-helper?"));
});

test("the marks last until the next roster is read", async () => {
  let at = "2026-11-19T12:30:00.000Z";
  const { slot, ask, facts } = await places({ snapshot: () => ({ ...fixtureSnapshot(), at }), stopPlan: refuse(kernelSays("stopPlan")) });
  act(() => ask().plan("stop"));
  await waitFor(() => expect(facts()).toBe("Not in OATS any more · oats-expert"));
  at = "2026-11-19T12:31:00.000Z";
  await slot.behavior.emitRealtime("oats/changed", { at });
  await waitFor(() => expect(facts()).toBe("Stopped · oats-expert"));
});

test("each of the six acts' refusals, as the real kernel printed it, says the agent is gone; a session whose state cannot be established, or a busy one, does not", () => {
  for (const act of ["start", "restart", "stopPlan", "stopApply", "retirePlan", "retireApply"] as const) {
    const text = kernelSays(act);
    expect(saysGone(refusalCode(text), text), text).toBe(true);
  }
  // A home that never was an instance's (awebai/oats lib/core.mjs:7938 at 95c7b43b3; not reachable from a roster, which names real homes).
  const never = "E_RUNTIME_ENDPOINT_UNKNOWN: /abs/deployment/agents/oats-expert/instances/nobody is not an OATS instance home (no instance.json); nothing was started";
  expect(saysGone(refusalCode(never), never)).toBe(true);
  // The kernel's own words for the other meanings of the same codes (awebai/oats lib/core.mjs at 95c7b43b3).
  for (const text of [
    "E_SESSION_UNKNOWN: cannot establish whether weekly-digest-helper is running",
    "E_SESSION_BUSY: a start is already in progress for weekly-digest-helper",
    "E_RUNTIME_ENDPOINT_UNKNOWN: the session's endpoint is not recorded",
    "E_PLAN_STALE: the stop plan changed since it was shown",
  ]) {
    expect(saysGone(refusalCode(text), text), text).toBe(false);
  }
});

test("Restart, a retire plan and a retire apply: the same notice from the kernel's own words", async () => {
  for (const [ask, over] of [
    ["restart", { restart: refuse(kernelSays("restart")) }],
    ["retire", { retirePlan: refuse(kernelSays("retirePlan")) }],
  ] as const) {
    const places_ = await places(over);
    act(() => (ask === "restart" ? places_.ask().run("restart") : places_.ask().plan("retire")));
    const notice = await within(await places_.slot.findByRole("dialog")).findByRole("alert");
    expect(notice.querySelector("h3")!.textContent).toBe("weekly-digest-helper is not in OATS any more");
    await waitFor(() => expect(places_.facts()).toBe("Not in OATS any more · oats-expert"));
    places_.slot.unmount();
    resetApp();
  }
});
