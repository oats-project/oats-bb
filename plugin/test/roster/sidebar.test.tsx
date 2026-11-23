// @vitest-environment jsdom
// A8: the Sidebar (experimental_threadList) with the pinned fixtures.
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { addPageLink } from "../../app/workspace/pages";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { ALL_PAGES, handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";

afterEach(resetApp);

async function sidebar(over: Partial<Handlers> = {}, activeThreadId: string | null = null, threads = sidebarThreads()) {
  const app = await loadApp();
  expect(app.threadLists.map((list) => list.id)).toEqual(["agents"]);
  let navigated = 0;
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId, activeProjectId: null, isCompactViewport: false, onNavigate: () => void navigated++, searchQuery: "" },
    { rpc: handlers(over), sidebarThreads: threads },
  );
  return { slot, navigated: () => navigated };
}

/** The roster's own reads and asks, in order: a row another feature added to the block reads for itself. */
const rosterCalls = (slot: Awaited<ReturnType<typeof sidebar>>["slot"]) => slot.inspection.rpcCalls.map((call) => call.method).filter((method) => method === "snapshot" || method === "refresh");

const ids = (rows: HTMLElement[]) => rows.map((row) => row.getAttribute("data-sidebar-thread-id"));

test("the tree: every bb agent has a row with both data-sidebar-thread-* attributes and its href", async () => {
  const { slot } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  // needs-you first (newest first), then working with its children under it, then the rest
  expect(ids(rows)).toEqual(["thr_release", "thr_ci", "thr_research", "thr_redesign", "thr_mockups", "thr_harvest", "thr_digest"]);
  for (const row of rows) {
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    const id = row.getAttribute("data-sidebar-thread-id")!;
    expect(row.getAttribute("href")).toBe(fixtureThreads().find((thread) => thread.id === id)!.href);
  }
});

test("a row is two lines: its name, then its state in a word and its soul; the mark sits beside the word, and no ? or new", async () => {
  const { slot } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  const row = (id: string) => rows.find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === id)!;
  const facts = (id: string) => within(row(id)).getByTestId("oats-row-facts").textContent;
  const mark = (id: string) => row(id).querySelector("[data-mark]")!;

  expect(row("thr_release").textContent).toContain("Release 070 maintainer"); // the instance name as words, never bb's title for the thread (R1)
  expect(facts("thr_release")).toBe("Needs you · oats-maintainer");
  expect(facts("thr_ci")).toBe("Needs you · oats-developer"); // a claim, and a bb pending interaction
  expect(facts("thr_redesign")).toBe("Working · oats-product-expert");
  expect(facts("thr_harvest")).toBe("Idle · knowledge-harvester");
  expect(facts("thr_digest")).toBe("Stopped · oats-expert");
  // The mark says the state too, and is hidden from a screen reader beside its word.
  for (const [id, state] of [["thr_release", "needs-you"], ["thr_redesign", "working"], ["thr_harvest", "idle"], ["thr_digest", "stopped"]] as const) {
    expect(mark(id).getAttribute("data-state")).toBe(state);
    expect(mark(id).getAttribute("aria-hidden")).toBe("true");
  }
  expect(mark("thr_release").textContent).toBe("!"); // the Desktop's mark for an agent that waits
  for (const one of rows) expect(one.textContent).not.toMatch(/(\?|new)$/);
  // The name is bold while the agent waits on a person, read or not.
  expect(row("thr_release").querySelector(".font-semibold")).not.toBeNull();
});

test("two failures are two words: Failed for a session that ended, Unreachable for one the kernel cannot reach", async () => {
  const agents = fixtureAgents().map((agent) => (agent.instance === "harvest-knowledge-helper" ? { ...agent, runtimeState: "shell" } : agent.instance === "weekly-digest-helper" ? { ...agent, running: null, runtimeState: "unreachable" } : agent));
  const { slot } = await sidebar({ snapshot: () => ({ ok: true, at: new Date().toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents }) });
  const rows = await slot.findAllByTestId("oats-agent-row");
  const facts = (id: string) => within(rows.find((row) => row.getAttribute("data-sidebar-thread-id") === id)!).getByTestId("oats-row-facts").textContent;
  expect(facts("thr_harvest")).toBe("Failed · knowledge-harvester");
  expect(facts("thr_digest")).toBe("Unreachable · oats-expert");
});

test("an agent with no bb thread stays in the roster: one that runs in tmux, and one whose thread is gone; each opens its own page", async () => {
  const { slot, navigated } = await sidebar({}, null, { status: "ready", threads: fixtureThreads().filter((thread) => thread.id !== "thr_digest") });
  const rows = await slot.findAllByTestId("oats-agent-row-threadless");
  expect(rows.map((row) => [row.getAttribute("data-instance"), within(row).getByTestId("oats-row-facts").textContent])).toEqual([
    ["weekly-digest-helper", "Stopped · oats-expert · its bb thread is gone"],
    ["kernel-fix-developer", "Working · oats-developer · tmux"],
  ]);
  expect(rows[1]!.textContent).toContain("Kernel fix developer");
  // The count of the workspace line is the count of rows.
  expect(slot.getByTestId("oats-workspace-line").textContent).toBe("oats · falcon · 8 agents");
  expect(slot.getAllByTestId("oats-agent-row").length + rows.length).toBe(8);
  fireEvent.click(rows[0]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "agent", options: { subPath: "weekly-digest-helper" } }]); // the agent's own page, where its acts are
  expect(navigated()).toBe(1);
});

test("children are indented one step under their parent", async () => {
  const { slot } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  const cls = (id: string) => rows.find((row) => row.getAttribute("data-sidebar-thread-id") === id)!.className;
  expect(cls("thr_redesign")).toContain("pl-2");
  expect(cls("thr_mockups")).toContain("pl-6");
  expect(cls("thr_harvest")).toContain("pl-6");
});

test("a click on a row records navigate.toThread(id) and calls onNavigate", async () => {
  const { slot, navigated } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  fireEvent.click(rows.find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_mockups")!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_mockups" }]);
  expect(navigated()).toBe(1);
});

test("a modified click is left to the anchor: nothing is navigated by the plugin", async () => {
  const { slot, navigated } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  // jsdom cannot follow a link: note whether the plugin left the click alone, then stop it
  const leftAlone: boolean[] = [];
  slot.container.addEventListener("click", (event) => {
    leftAlone.push(!event.defaultPrevented);
    event.preventDefault();
  });
  fireEvent.click(rows[0]!, { ctrlKey: true });
  fireEvent.click(rows[0]!, { metaKey: true });
  expect(leftAlone).toEqual([true, true]);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(navigated()).toBe(0);
});

test('"Other threads" lists the thread that is no OATS agent, and it opens like any other', async () => {
  const { slot, navigated } = await sidebar();
  await slot.findByTestId("oats-tree");
  const others = slot.getAllByTestId("oats-other-row");
  expect(ids(others)).toEqual(["thr_plain"]);
  expect(others[0]!.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
  expect(slot.getByText("Other threads")).toBeTruthy();
  fireEvent.click(others[0]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_plain" }]);
  expect(navigated()).toBe(1);
});

test("the workspace line; at the roster's foot the needs line and New agent; then the pages under their heading", async () => {
  const { slot, navigated } = await sidebar();
  expect((await slot.findByTestId("oats-workspace-line")).textContent).toBe("oats · falcon · 8 agents");
  const needs = slot.getByTestId("oats-needs-line");
  expect(needs.textContent).toBe("!3 need you");
  // The order a person reads: the agents, who waits, the act that makes one, then the workspace's pages.
  const order = ["oats-tree", "oats-needs-line", "oats-new-agent", "oats-pages"].map((id) => slot.getByTestId(id));
  for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(slot.getByTestId("oats-new-agent").tagName).toBe("BUTTON");
  expect(slot.getByTestId("oats-new-agent").textContent).toBe("New agent");
  fireEvent.click(needs);
  fireEvent.click(slot.getByTestId("oats-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toPluginPanel", path: "home" },
    { method: "toPluginPanel", path: "souls" },
  ]);
  expect(navigated()).toBe(2);
});

test("the four page rows call toPluginPanel, then onNavigate", async () => {
  const { slot, navigated } = await sidebar();
  await slot.findByTestId("oats-workspace-line");
  for (const path of ["souls", "capabilities", "teams", "machines"]) fireEvent.click(slot.getByTestId(`oats-page-link-${path}`));
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toPluginPanel", path: "souls" },
    { method: "toPluginPanel", path: "capabilities" },
    { method: "toPluginPanel", path: "teams" },
    { method: "toPluginPanel", path: "machines" },
  ]);
  expect(navigated()).toBe(4);
});

test("the active thread's row is marked", async () => {
  const { slot } = await sidebar({}, "thr_ci");
  const rows = await slot.findAllByTestId("oats-agent-row");
  expect(rows.filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.getAttribute("data-sidebar-thread-id"))).toEqual(["thr_ci"]);
});

test("while no snapshot has loaded: one line, and every thread is listed", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const { slot } = await sidebar({ snapshot: async () => (await held, handlers().snapshot(null)) });
  expect(slot.getByRole("status").textContent).toBe("Reading your agents…");
  expect(ids(slot.getAllByTestId("oats-other-row"))).toEqual(fixtureThreads().map((thread) => thread.id));
  expect(slot.queryByText("Other threads")).toBeNull();
  expect(slot.queryByTestId("oats-workspace-line")).toBeNull();
  release();
  await slot.findByTestId("oats-tree");
});

test("with a failed snapshot: every thread is listed, the error's first line shows, and Retry rereads", async () => {
  let failing = true;
  const { slot, navigated } = await sidebar({
    snapshot: () =>
      failing
        ? { ok: false, at: "2026-11-19T12:30:00.000Z", code: "NO_DEPLOYMENT", message: "No OATS deployment found.\nSet one in the plugin's settings." }
        : handlers().snapshot(null),
  });
  // A titled notice in a person's words, with Retry and the way to the settings; the raw message is under Details.
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("No OATS deployment found on this machine");
  expect(notice.textContent).toContain("Open a bb project inside the deployment, or set its directory in the plugin's settings.");
  expect(slot.getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe("/settings/plugins/test-plugin");
  expect((slot.getByTestId("oats-notice-details") as HTMLDetailsElement).open).toBe(false);
  expect(Array.from(slot.getByTestId("oats-notice-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["No OATS deployment found.", "Set one in the plugin's settings."]);
  expect(ids(slot.getAllByTestId("oats-other-row"))).toEqual(fixtureThreads().map((thread) => thread.id));
  expect(slot.queryByTestId("oats-tree")).toBeNull();

  // bb stays usable: a thread opens
  fireEvent.click(slot.getAllByTestId("oats-other-row")[0]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_release" }]);
  expect(navigated()).toBe(1);

  failing = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await slot.findByTestId("oats-tree");
  expect(rosterCalls(slot)).toEqual(["snapshot", "refresh", "snapshot"]);
});

test("when the plugin's server does not answer at all, the threads are listed with the error and Retry", async () => {
  const { slot } = await sidebar({
    snapshot: () => {
      throw new Error("plugin oats is not running");
    },
  });
  // In a person's words, with the plugin's own message under Details: nothing here is the kernel's word.
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not be read");
  expect(slot.getByTestId("oats-notice-details").textContent).toContain("plugin oats is not running");
  expect(slot.getAllByTestId("oats-other-row")).toHaveLength(8);
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("an oats/changed event rereads the snapshot once, and the tree follows", async () => {
  let agents = fixtureAgents();
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) });
  await slot.findByTestId("oats-tree");
  agents = agents.filter((agent) => agent.instance !== "weekly-digest-helper");
  await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-19T12:40:00.000Z" });
  await waitFor(() => expect(ids(slot.getAllByTestId("oats-other-row"))).toEqual(["thr_digest", "thr_plain"]));
  // the souls are read once, for their names: a status change does not reread them
  expect(rosterCalls(slot)).toEqual(["snapshot", "snapshot"]);
  expect(slot.inspection.rpcCalls.filter((call) => call.method === "souls")).toHaveLength(1);
});

test("a title with markup is drawn as text", async () => {
  const threads = fixtureThreads().map((thread) =>
    thread.id === "thr_plain" ? { ...thread, title: "<img src=x onerror=alert(1)>", displayTitle: "<img src=x onerror=alert(1)>" } : thread,
  );
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" },
    { rpc: handlers(), sidebarThreads: { status: "ready", threads } },
  );
  const other = await slot.findByTestId("oats-other-row");
  expect(other.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(other.querySelector("img")).toBeNull();
});

test("a row's soul is the matching soul's key once the souls are read, else the roster's name", async () => {
  const { slot } = await sidebar({
    souls: () => ({
      souls: [{ name: "oats.okf/knowledge-harvester", agent: "knowledge-harvester", description: "", origin: "oats.okf 2.1.0", capabilities: [], spawnable: true, problem: null }],
    }),
  });
  const rows = await slot.findAllByTestId("oats-agent-row");
  const row = (id: string) => rows.find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === id)!;
  await waitFor(() => expect(row("thr_harvest").textContent).toContain("oats.okf/knowledge-harvester"));
  expect(row("thr_release").textContent).toContain("oats-maintainer");
});

test("several machines and none chosen: the notice says so and links to the plugin's settings; Retry would not help", async () => {
  const { slot } = await sidebar({
    snapshot: () => ({ ok: false, at: "t", code: "CHOOSE_HOST", message: "This bb server has 2 machines: choose the one that holds the OATS homes." }),
  });
  const link = await slot.findByRole("link", { name: "Open settings" });
  expect(link.getAttribute("href")).toBe("/settings/plugins/test-plugin");
  expect(slot.getByRole("alert").querySelector("h3")!.textContent).toBe("Choose the machine that holds your agents");
  expect(slot.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("a kernel refusal of oats status: what happened in words, the kernel's first line after who says it, its code after the words", async () => {
  const { slot } = await sidebar({
    snapshot: () => ({ ok: false, at: "t", code: "E_WORKSPACE_INVALID", message: "oats-workspace.yaml: unknown key `foo`\nsee docs/workspace.md" }),
  });
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not read this deployment");
  expect(notice.textContent).toContain("OATS says: oats-workspace.yaml: unknown key `foo`");
  expect(slot.getByTestId("oats-unreadable").getAttribute("data-code")).toBe("E_WORKSPACE_INVALID");
  expect(Array.from(slot.getByTestId("oats-notice-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["oats-workspace.yaml: unknown key `foo`", "see docs/workspace.md"]);
});

test("while bb is still listing its threads nothing is joined: no agent is said to be missing or quiet", async () => {
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" },
    { rpc: handlers(), sidebarThreads: { status: "loading", threads: [] } },
  );
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.getByRole("status").textContent).toBe("Reading your agents…");
  expect(slot.queryByTestId("oats-needs-line")).toBeNull();
  expect(slot.queryByText("No OATS agents run in bb yet.")).toBeNull();
});

test("when bb cannot list its threads the line says so, with Retry", async () => {
  const app = await loadApp();
  const slot = renderSlot<PluginThreadListProps, Contract>(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" },
    { rpc: handlers(), sidebarThreads: { status: "error", threads: [] } },
  );
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("bb could not list its threads");
  expect(notice.textContent).toContain("So the OATS agents cannot be matched to them.");
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(slot.queryByTestId("oats-tree")).toBeNull();
});

test("a feature's own page is a row under the four pages, with its mark while its hook gives one", async () => {
  let failed = true;
  const remove = addPageLink({ path: "example", title: "Example", useMark: () => (failed ? { label: "Example, a run failed" } : null) });
  try {
    const { slot } = await sidebar();
    const row = await slot.findByTestId("oats-page-link-example");
    // The four pages first, then what the features added, this one last.
    const rows = Array.from(slot.container.querySelectorAll('[data-testid^="oats-page-link-"]')).map((link) => link.textContent);
    expect(rows.slice(0, 4)).toEqual(["Souls", "Capabilities", "Teams", "Machines"]);
    expect(rows.at(-1)).toBe("Example");
    const mark = row.querySelector('[data-testid="oats-mark"]')!;
    expect([mark.getAttribute("role"), mark.getAttribute("aria-label")]).toEqual(["img", "Example, a run failed"]);
    // The four pages have no mark.
    expect(slot.getByTestId("oats-page-link-souls").querySelector('[data-testid="oats-mark"]')).toBeNull();
    fireEvent.click(row);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "example" }]);
    slot.unmount();
    failed = false;
    const calm = (await sidebar()).slot;
    expect((await calm.findByTestId("oats-page-link-example")).querySelector('[data-testid="oats-mark"]')).toBeNull();
    calm.unmount();
  } finally {
    remove();
  }
  // Taken away: the block is the four pages again.
  const { slot } = await sidebar();
  await slot.findByTestId("oats-page-link-souls");
  expect(slot.queryByTestId("oats-page-link-example")).toBeNull();
});

test("while OATS cannot be read after it was, the tree stays as last read under the one notice: its age said once, that the acts are held, Retry; never bb's flat list", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const { slot } = await sidebar({ snapshot: () => ({ ok: false, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", last }) });
  const rows = await slot.findAllByTestId("oats-agent-row");
  expect(rows).toHaveLength(7); // the same seven agents, joined to their threads
  expect(slot.getAllByTestId("oats-agent-row-threadless")).toHaveLength(1); // and the one that runs in tmux
  const notice = slot.getByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS did not answer on falcon");
  expect(notice.textContent).toContain("Showing what was read 2 min ago.");
  // The age is said once, in one form; the acts are held, and the sentence names Retry first.
  expect(slot.getByTestId("oats-sidebar").textContent!.match(/2 min ago/g)).toHaveLength(1);
  expect(slot.queryByTestId("oats-last-observation")).toBeNull();
  expect(slot.getByTestId("oats-held").textContent).toBe("Press Retry: Stop, Start, Restart, Retire and New agent return when OATS is read again.");
  // "New agent" is held with the acts: in its place, off, with the reason, and it opens nothing.
  const newAgent = slot.getByTestId("oats-new-agent") as HTMLButtonElement;
  expect([newAgent.disabled, newAgent.title]).toEqual([true, "Comes back when OATS is read again"]);
  fireEvent.click(newAgent);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(slot.getByTestId("oats-needs-line").textContent).toBe("!3 need you");
  expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
});

test("an agent the kernel refused as one it does not know says so in its row, until the next roster is read", async () => {
  let at = "2026-11-19T12:30:00.000Z";
  const { slot } = await sidebar({ snapshot: () => ({ ...fixtureSnapshot(), at }) });
  const facts = () => within(slot.getAllByTestId("oats-agent-row").find((row) => row.getAttribute("data-sidebar-thread-id") === "thr_release")!).getByTestId("oats-row-facts").textContent;
  await slot.findByTestId("oats-tree");
  expect(facts()).toBe("Needs you · oats-maintainer");
  const { markGone } = await import("../../app/roster/gone");
  act(() => markGone("release-070-maintainer"));
  expect(facts()).toBe("Not in OATS any more · oats-maintainer");
  // The next roster: the kernel lists it after all, and the row says what the kernel says.
  at = "2026-11-19T12:31:00.000Z";
  await slot.behavior.emitRealtime("oats/changed", { at });
  await waitFor(() => expect(facts()).toBe("Needs you · oats-maintainer"));
});

test("the row of the plugin's page that is shown is the selected one (D-037), and none is while a thread is shown", async () => {
  const { slot } = await sidebar();
  await slot.findByTestId("oats-workspace-line");
  const current = () => ["souls", "capabilities", "teams", "machines"].filter((path) => slot.getByTestId(`oats-page-link-${path}`).getAttribute("aria-current") === "page");
  expect(current()).toEqual([]);
  const { shownPage } = await import("../../app/workspace/pages");
  const Teams = shownPage("teams", () => null);
  const page = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(current()).toEqual(["teams"]));
  expect(slot.getByTestId("oats-page-link-teams").className).toContain("bg-accent");
  page.unmount();
  await waitFor(() => expect(current()).toEqual([]));
});

// One rule for a state (model/view.ts `state`), read by the sidebar's row and by the agent's panel:
// a tmux agent that is stopped, as the kernel prints it (`{ running: false }`, no runtimeState;
// awebai/oats lib/instance-listing.mjs at 95c7b43b3), says "Stopped" in both, rendered together.
test("a stopped tmux agent says Stopped in its sidebar row and in its own panel", async () => {
  const agents = fixtureAgents().map((agent) => (agent.backend === "tmux" ? { ...agent, running: false, runtimeState: null } : agent));
  const app = await loadApp();
  const List = app.threadLists[0]!.component;
  const { InstancePanel } = await import("../../app/panel");
  const slot = renderSlot<PluginThreadListProps, Contract>(
    {
      component: (props: PluginThreadListProps) => (
        <>
          <List {...props} />
          <InstancePanel instance="kernel-fix-developer" />
        </>
      ),
    } as never,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
    { rpc: handlers({ snapshot: () => fixtureSnapshot(agents) }), sidebarThreads: sidebarThreads() },
  );
  const row = (await slot.findAllByTestId("oats-agent-row-threadless")).find((candidate) => candidate.getAttribute("data-instance") === "kernel-fix-developer")!;
  expect(within(row).getByTestId("oats-row-facts").textContent).toBe("Stopped · oats-developer · tmux");
  expect(row.querySelector("[data-mark]")!.getAttribute("data-state")).toBe("stopped");
  const header = await slot.findByTestId("oats-panel-state");
  expect(header.querySelector("[data-state]")!.getAttribute("data-state")).toBe("stopped");
  expect(header.textContent).toContain("Stopped");
});

// The plugin's setting `pages`: a release shows only the pages that are finished (its default: the
// home alone). A page that is not shown has no link in the sidebar and no mark; the count of who
// waits still opens the home; "New agent" is there only where it has somewhere to open.
test("with the release's default (pages: home) the sidebar has the roster, who waits and no page link; with every page, all of them", async () => {
  const withPages = async (pages: string) => {
    const app = await loadApp();
    return renderSlot<PluginThreadListProps, Contract>(
      app.threadLists[0]!,
      { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
      { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages } },
    );
  };
  const pilot = await withPages("home");
  await pilot.findByTestId("oats-tree");
  expect(pilot.queryByTestId("oats-pages")).toBeNull();
  for (const path of ["souls", "capabilities", "teams", "machines", "automations"]) expect(pilot.queryByTestId(`oats-page-link-${path}`)).toBeNull();
  expect(pilot.queryByTestId("oats-new-agent")).toBeNull(); // nowhere to open yet: the form's own page names itself
  fireEvent.click(pilot.getByTestId("oats-needs-line"));
  expect(pilot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  pilot.unmount();
  resetApp();
  const all = await withPages(ALL_PAGES);
  await all.findByTestId("oats-tree");
  for (const path of ["souls", "capabilities", "teams", "machines", "automations"]) expect(all.getByTestId(`oats-page-link-${path}`)).toBeTruthy();
  expect(all.getByTestId("oats-new-agent")).toBeTruthy();
  all.unmount();
  resetApp();
  // With the home itself left out, the count is said and opens nothing.
  const none = await withPages("souls");
  await none.findByTestId("oats-tree");
  expect(none.getByTestId("oats-needs-line").tagName).toBe("P");
  expect(none.getByTestId("oats-page-link-souls")).toBeTruthy();
});

test("the path of a page that is not shown answers one line and the way back; the page itself is not drawn", async () => {
  const { shownPage } = await import("../../app/workspace/pages");
  const Teams = shownPage("teams", () => <p data-testid="the-page">teams</p>);
  const hidden = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages: "home" } });
  expect(hidden.getByTestId("oats-page-not-shown").textContent).toBe("This page is not shown in this release of the OATS plugin.Back to Home");
  expect(hidden.queryByTestId("the-page")).toBeNull();
  fireEvent.click(hidden.getByTestId("oats-page-not-shown-back"));
  expect(hidden.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "home" }]);
  hidden.unmount();
  const shown_ = renderSlot<object, Contract>({ component: Teams } as never, {}, { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages: "home, Teams" } });
  expect(shown_.getByTestId("the-page")).toBeTruthy();
});

test("\"New agent\" opens the form's own page once the spawn feature names it, whatever pages are shown", async () => {
  const { setNewAgent } = await import("../../app/workspace/pages");
  const app = await loadApp();
  setNewAgent((navigate) => navigate.toPluginPanel("new-agent"));
  try {
    const slot = renderSlot<PluginThreadListProps, Contract>(
      app.threadLists[0]!,
      { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "" },
      { rpc: handlers(), sidebarThreads: sidebarThreads(), settings: { pages: "home" } },
    );
    fireEvent.click(await slot.findByTestId("oats-new-agent"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent" }]);
  } finally {
    setNewAgent(null);
  }
});

// One count of who waits (model/view.ts `needing`), read by the sidebar's foot (the home follows in its owner's change):
// an agent with no bb thread that waits on a person is counted, as its own row says it does.
test("the foot counts every agent that waits, the ones with no bb thread included", async () => {
  const claim = { reason: "question", message: "Which branch?", since: "2026-11-19T12:00:00.000Z" };
  // The tmux agent runs and carries a claim; the stopped agent's thread is gone (it shows none).
  const agents = fixtureAgents().map((agent) => (agent.backend === "tmux" ? { ...agent, running: true, runtimeState: null, waiting: claim } : agent));
  const { slot } = await sidebar({ snapshot: () => fixtureSnapshot(agents) }, null, { status: "ready", threads: fixtureThreads().filter((thread) => thread.id !== "thr_digest") });
  await slot.findByTestId("oats-tree");
  expect(slot.getByTestId("oats-needs-line").textContent).toBe("!4 need you"); // three in the tree, and the one on tmux
  const tmux = slot.getAllByTestId("oats-agent-row-threadless").find((row) => row.getAttribute("data-instance") === "kernel-fix-developer")!;
  expect(within(tmux).getByTestId("oats-row-facts").textContent).toBe("Needs you · oats-developer · tmux");
});

// On a deployment that shows more than the default, a page opened by its path must not say "not
// shown" for the moment bb takes to read the settings (round 1 of the second pass).
test("while bb is still reading the settings no page is known to be shown or hidden; settings bb cannot give are the default's", async () => {
  const { pagesOf, showEveryPageWhenUnset } = await import("../../app/workspace/pages");
  showEveryPageWhenUnset(false); // as in the built app
  try {
    const loading = pagesOf({ values: undefined, isLoading: true });
    expect([loading.known, loading.has("home"), loading.has("souls")]).toEqual([false, false, false]);
    const unavailable = pagesOf({ values: undefined, isLoading: false });
    expect([unavailable.known, unavailable.has("home"), unavailable.has("souls")]).toEqual([true, true, false]);
    const read = pagesOf({ values: { pages: "home, Souls" }, isLoading: false });
    expect([read.known, read.has("home"), read.has("souls"), read.has("teams")]).toEqual([true, true, true, false]);
    // A cleared field is the default, as for the plugin's other settings.
    const cleared = pagesOf({ values: { pages: " " }, isLoading: false });
    expect([cleared.has("home"), cleared.has("souls")]).toEqual([true, false]);
    // The values of a read before stay while bb reads them again.
    expect(pagesOf({ values: { pages: "souls" }, isLoading: true }).known).toBe(true);
  } finally {
    showEveryPageWhenUnset(true);
  }
});

// One full notice on a screen (the home read's ruling): beside a page that shows the notice over
// what it keeps, the sidebar says one line, how old the roster is and Retry; alone, it is the notice.
test("on the last roster read, beside a page that shows the full notice the sidebar says one line: \"Last observation — <age>\" and Retry", async () => {
  const last = { at: new Date(Date.now() - 2 * 60_000 - 5_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "falcon" }, agents: fixtureAgents() };
  const failed = { snapshot: () => ({ ok: false as const, at: new Date().toISOString(), code: "OATS_TIMEOUT", message: "`oats` did not answer within 20 s and was stopped", machine: "falcon", last }) };
  const { slot } = await sidebar(failed);
  await slot.findAllByTestId("oats-agent-row");
  expect(slot.getByTestId("oats-held")).toBeTruthy(); // alone: the full notice
  expect(slot.queryByTestId("oats-last-observation")).toBeNull();
  // A page of the plugin is drawn beside it, with the notice above what it keeps.
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "teams")!;
  const page = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "" }, { rpc: handlers(failed), sidebarThreads: sidebarThreads() });
  await waitFor(() => expect(within(page.container).getByTestId("oats-held")).toBeTruthy());
  const line = await waitFor(() => within(slot.container).getByTestId("oats-last-observation"));
  expect(line.textContent).toBe("Last observation — 2 min agoRetry");
  expect(within(slot.container).queryByTestId("oats-held")).toBeNull();
  expect(within(slot.container).queryByRole("alert")).toBeNull();
  expect(within(slot.container).getAllByTestId("oats-agent-row")).toHaveLength(7); // the roster stays
  fireEvent.click(within(line).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(slot.inspection.rpcCalls.some((call) => call.method === "refresh")).toBe(true));
  // The page leaves: the sidebar is the one place again, and says it whole.
  page.unmount();
  await waitFor(() => expect(within(slot.container).getByTestId("oats-held")).toBeTruthy());
  expect(within(slot.container).queryByTestId("oats-last-observation")).toBeNull();
});

// The whole name is one hover away on every row: a name cut after its second line is still there.
test("every roster row's name carries the whole instance name as its title, a bb-thread agent's too", async () => {
  const { slot } = await sidebar();
  const rows = await slot.findAllByTestId("oats-agent-row");
  const titles = rows.map((row) => within(row).getByTestId("oats-row-name").getAttribute("title"));
  expect(titles).toContain("release-070-maintainer");
  expect(titles.every((title) => typeof title === "string" && title.length > 0)).toBe(true);
  const threadless = slot.getByTestId("oats-agent-row-threadless");
  expect(within(threadless).getByTestId("oats-row-name").getAttribute("title")).toBe("kernel-fix-developer");
});
