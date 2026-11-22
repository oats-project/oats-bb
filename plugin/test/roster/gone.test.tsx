// @vitest-environment jsdom
// An agent the kernel no longer knows, while the roster on screen still lists it. A stop PLAN or
// a retire PLAN the kernel refuses with E_SESSION_UNKNOWN says so, by that code alone: a notice,
// and the agent's rows (the sidebar's, the thread's own) say "Not in OATS any more" until the next
// roster is read. No other act marks an agent gone: its refusal is shown as the kernel's, and the
// roster read again after the act drops the row. The places are rendered TOGETHER: the link
// between the refusal and the rows is what is held here.
import { recordedEvents } from "../panel/handlers";
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planSaysGone } from "../../app/roster/gone";
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
    // (The agent's events hold no "stopped": its row says no time, so the lines read below are whole.)
    { rpc: handlers({ panelEvents: () => ({ ...recordedEvents(), events: [] }), ...over }), sidebarThreads: sidebarThreads() },
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
  const { slot, ask, facts, mark, line } = await places({ stopPlan: refuse(kernelSays("stopPlan")) });
  expect(facts()).toBe("Stopped · oats-expert");
  expect(line()).toBe("StoppedStartInstance panel");
  act(() => ask().plan("stop"));
  const notice = await within(await slot.findByRole("dialog")).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("Weekly digest helper is not in OATS any more");
  expect(notice.textContent).toContain("E_SESSION_UNKNOWN");
  await waitFor(() => expect(facts()).toBe("Not in OATS any more · oats-expert"));
  expect(mark()).toBe("stopped");
  expect(line()).toBe("Not in OATS any more· OATS has no agent of this name nowInstance panel"); // the words, with the separator the line draws
  expect(slot.queryByTestId("oats-status-act")).toBeNull();
});

test("a retire plan refused the same way says the same", async () => {
  const { slot, ask, facts } = await places({ retirePlan: refuse(kernelSays("retirePlan")) });
  act(() => ask().plan("retire"));
  const notice = await within(await slot.findByRole("dialog")).findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("Weekly digest helper is not in OATS any more");
  await waitFor(() => expect(facts()).toBe("Not in OATS any more · oats-expert"));
});

test("it is the plan's code that says it, never the words: any E_SESSION_UNKNOWN on a plan, and no other code", () => {
  expect(planSaysGone("E_SESSION_UNKNOWN")).toBe(true);
  for (const act of ["stopPlan", "retirePlan"] as const) expect(planSaysGone(refusalCode(kernelSays(act)))).toBe(true);
  for (const code of ["E_WORK_INSPECTION_FAILED", "E_RUNTIME_ENDPOINT_UNKNOWN", "E_PLAN_STALE", "E_SESSION_BUSY", "OATS_NOT_FOUND", null]) expect(planSaysGone(code)).toBe(false);
});

// The kernel's own refusals of a Start and a Restart on a retired home, and of an apply for a
// name it no longer has (recorded): shown as they are. The same codes mean other things on those
// paths (a session whose state cannot be established; a home that is there but was exchanged), so
// none of them marks the agent gone: the roster read after the act is what drops a row.
for (const [name, verb, key] of [
  ["Start", "start", "start"],
  ["Restart", "restart", "restart"],
] as const) {
  test(`${name} on a home that is gone: the kernel's refusal as it is, Try again, and the rows are not marked`, async () => {
    const { slot, ask, facts } = await places({ [verb]: refuse(kernelSays(key)) } as Partial<Handlers>);
    act(() => ask().run(verb));
    const dialog = await slot.findByRole("dialog");
    expect(dialog.querySelector("h2")!.textContent).toBe(`${name} did not happen`); // no agent named from the row
    await waitFor(() => expect(within(dialog).getByTestId("oats-act-failed").textContent).toContain("directory instance home was removed or exchanged"));
    expect(within(dialog).getByTestId("oats-act-failed").textContent).toContain(`OATS was asked to ${verb} Weekly digest helper.`);
    expect(within(dialog).getByTestId("oats-act-failed").textContent).toContain("E_WORK_INSPECTION_FAILED");
    expect(within(dialog).getByTestId("oats-act-again")).toBeTruthy();
    expect(facts()).toBe("Stopped · oats-expert");
  });
}

test("a session whose state cannot be established (the same code as a name the kernel does not know) is not 'gone' on a Start", async () => {
  const { slot, ask, facts } = await places({ start: refuse("E_SESSION_UNKNOWN: cannot establish whether weekly-digest-helper is running, so nothing was started") });
  act(() => ask().run("start"));
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByTestId("oats-act-failed").textContent).toContain("cannot establish whether weekly-digest-helper is running"));
  expect(within(dialog).queryByRole("alert")!.textContent).not.toContain("not in OATS any more");
  expect(within(dialog).getByTestId("oats-act-again")).toBeTruthy();
  expect(facts()).toBe("Stopped · oats-expert");
});

test("an apply the kernel refuses because the agent went after its plan was read: the refusal stays in the confirmation, and the rows are not marked", async () => {
  const { slot, ask, facts } = await places({
    stopPlan: () => ({ revision: "r1", lines: ["Stop weekly-digest-helper: not running"], instance: INSTANCE }),
    stopApply: refuse(kernelSays("stopApply")),
  });
  act(() => ask().plan("stop"));
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect((within(dialog).getByTestId("oats-plan-confirm") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByTestId("oats-plan-confirm"));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain('no instance "flaky-ci-2-developer"'));
  expect(within(dialog).getByTestId("oats-plan-reread")).toBeTruthy(); // reading the plan again is what then says the agent is gone
  expect(facts()).toBe("Stopped · oats-expert");
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
  await waitFor(() => expect(dialog.querySelector("h2")!.textContent).toBe("Stop Weekly digest helper?"));
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
