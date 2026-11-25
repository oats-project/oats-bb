// @vitest-environment jsdom
// A closed parent of the roster carries a mark for ANY row inside it that itself carries one (the
// specialist's ruling of 24 Nov 2026 on the one tree): the row that waits, the one that runs
// outside OATS, the failed one (test/model/fold.test.ts), AND the row the outside feature draws in
// its warning tone (`rowWarns`, test/outside/say.test.ts): a process may run with no thread a
// person can see, or its thread was deleted in bb. With the one tree such an agent, which has no
// bb thread, is under its parent, and its parent is closed as the page loads: nothing else would
// lead a person to it. Here with bb's own answer for the thread, as the sidebar asks it.
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { Agent } from "../../model/types";
import { noteActed } from "../../app/roster/reading";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import type { Contract } from "../helpers/render";

afterEach(resetApp);

const PARENT_THREAD = "thr_redesign"; // redesign-ui-lead: the parent, on its bb thread, working
const CHILD = "harvest-knowledge-helper"; // its child, on thr_harvest
/** bb's own answer: of the threads asked for, the ones it has archived (a thread it has no row of at all was deleted). */
const bb = (archivedIds: readonly string[]) =>
  ({ threads: { list: async (args: { threadIds: readonly string[] }) => args.threadIds.filter((id) => archivedIds.includes(id)).map((id) => ({ id, archivedAt: 1_763_000_000_000 })), interactions: { list: async () => [] } } }) as never as RenderSlotOptions<Contract>["sdk"];

/** The sidebar with the child's row as given and its thread gone from bb's list (archived when `archived`, else deleted). */
async function sidebar(child: Partial<Agent>, archived: boolean) {
  const agents = fixtureAgents().map((agent): Agent => (agent.instance === CHILD ? { ...agent, waiting: null, ...child } : agent));
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({}, agents), sidebarThreads: { status: "ready" as const, threads: fixtureThreads().filter((thread) => thread.id !== "thr_harvest") }, sdk: bb(archived ? ["thr_harvest"] : []) },
  );
  await slot.findByTestId("oats-tree");
  const parent = () => slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === PARENT_THREAD)!;
  /** The mark the closed parent carries for a row it hides: its state and its tone; null when it carries none. */
  const inside = () => {
    const mark = slot.getAllByTestId("oats-row-toggle").find((each) => each.getAttribute("data-instance") === "redesign-ui-lead")!.querySelector('[data-testid="oats-row-toggle-mark"]')!;
    return mark.getAttribute("data-inside") === null ? null : [mark.getAttribute("data-inside"), mark.getAttribute("data-tone")];
  };
  const toggle = () => slot.getAllByTestId("oats-row-toggle").find((each) => each.getAttribute("data-instance") === "redesign-ui-lead")!;
  return { slot, parent, inside, toggle };
}

test.each([
  ["its thread archived in bb while it ran", { running: true, runtimeState: "unknown" }, true, "idle"],
  ["its session lost, its thread archived in bb", { running: false, runtimeState: "stopped", sessionEnd: "lost" }, true, "stopped"],
  ["its thread deleted in bb", { running: false, runtimeState: "stopped", sessionEnd: "stopped" }, false, "stopped"],
] as const)("a closed parent carries the warning mark of a child with no thread: %s", async (_what, child, archived, state) => {
  const { slot, parent, inside, toggle } = await sidebar(child, archived);
  // The parent is closed as the page loads, and the child's row is not in the page.
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(slot.queryAllByTestId("oats-agent-row-threadless").some((row) => row.getAttribute("data-instance") === CHILD)).toBe(false);
  // bb's answer comes after the first draw: then the parent carries the child's own mark, in the warning tone, after its own word.
  await waitFor(() => expect(inside()).toEqual([state, "warning"]));
  // The chevron's NAME, for a screen reader and a pointer: whose agents it shows, then WHAT THAT ROW ITSELF SAYS: its state's word and its reason,
  // as the row draws them (ruled 25 Nov 2026: the warning's tone is a colour, and the state's name alone, "stopped", says nothing of it).
  const named = toggle().getAttribute("aria-label")!;
  // (The reason is the outside feature's word for that row: "may still run" for a thread archived in bb, since its change after the lead's read; "deleted in bb".)
  expect(named).toMatch(/^Show Redesign ui lead's agents: (Idle|Stopped) · (may still run|archived in bb|deleted in bb)$/);
  expect(toggle().getAttribute("title")).toBe(named);
  expect(within(parent()).getByTestId("oats-row-facts").textContent).toMatch(/^Working/); // the parent's own word stays its own
  // Opened: the child's row is there with that same mark, and the parent carries none.
  fireEvent.click(toggle());
  const row = slot.getAllByTestId("oats-agent-row-threadless").find((each) => each.getAttribute("data-instance") === CHILD)!;
  expect([row.querySelector("[data-mark]")!.getAttribute("data-state"), row.querySelector("[data-mark]")!.getAttribute("data-tone")]).toEqual([state, "warning"]);
  // … and those were the row's own words: what a sighted person reads now that it is shown.
  const drawn = ["state", "reason"].map((phrase) => row.querySelector(`[data-phrase="${phrase}"]`)?.textContent?.replace(/^[\s·]+|[\s·]+$/g, "") ?? "").filter((part) => part !== "").join(" · ");
  expect(named).toBe(`Show Redesign ui lead's agents: ${drawn}`);
  expect(inside()).toBeNull();
});

test("a closed parent carries no mark for a child an operator stopped whose thread is archived: that row is plain, nothing is wrong", async () => {
  const { slot, inside, toggle } = await sidebar({ running: false, runtimeState: "stopped", sessionEnd: "stopped" }, true);
  // Opened first, so that bb's answer is known to have come (the row says where its thread is), then closed again.
  fireEvent.click(toggle());
  const row = () => slot.getAllByTestId("oats-agent-row-threadless").find((each) => each.getAttribute("data-instance") === CHILD)!;
  await waitFor(() => expect(row().getAttribute("data-opens")).toBe("thread"));
  expect(row().querySelector("[data-mark]")!.getAttribute("data-tone")).toBeNull();
  fireEvent.click(toggle());
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(inside()).toBeNull();
});

// A hidden row that says "Reading…" (an act took its agent; the roster on screen is from before the act's end) is no
// row to warn of: after a Stop that archived its thread it is exactly the row this file's first tests mark ("Idle ·
// may still run"), and that warning is of the roster from before. The closed parent carries nothing for it.
test("a closed parent carries no warning mark for a hidden row that says Reading…", async () => {
  const { slot, inside, toggle } = await sidebar({ running: true, runtimeState: "unknown" }, true);
  await waitFor(() => expect(inside()).toEqual(["idle", "warning"]));
  act(() => noteActed([CHILD], fixtureSnapshot().at));
  expect([inside(), toggle().getAttribute("aria-label")]).toEqual([null, "Show Redesign ui lead's agents"]);
  fireEvent.click(toggle());
  const row = slot.getAllByTestId("oats-agent-row-threadless").find((each) => each.getAttribute("data-instance") === CHILD)!;
  expect([row.querySelector('[data-testid="oats-row-reading"]')?.textContent, row.querySelector('[data-testid="oats-row-facts"]'), row.querySelector("[data-mark]")!.getAttribute("data-tone")]).toEqual(["Reading…", null, null]);
});

