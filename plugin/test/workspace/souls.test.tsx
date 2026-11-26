// @vitest-environment jsdom
// The Souls tab of the Workspace page and a soul's own page (navPanel `souls`), by the audit of the
// hidden pages and its ruling (25 Nov 2026): the list in groups with ONE line of what a soul does,
// how many of its agents run, and "Can't spawn"; a soul's page with its facts, its capabilities and
// why, its agents as the roster says them, and New agent, which opens the form with that soul.
import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { setAgentPage } from "../../app/home/agent-tab";
import { fixtureAgents, fixtureSnapshot, fixtureThreads } from "../helpers/fixtures";
import { handlers, loadApp, resetApp } from "../helpers/render";
import { asked } from "../../app/lifecycle";
import type { Contract, Handlers } from "../helpers/render";
import type { Agent } from "../../model/types";

afterEach(() => {
  agentPage = null;
  resetApp();
});

// The page of one agent, as these tests name it: none, unless a test gives one. Named after the
// app is loaded, since a feature that has such a page names its own in its `register`.
let agentPage: Parameters<typeof setAgentPage>[0] = null;

async function souls(subPath: string, over: Partial<Handlers> = {}, agents?: Agent[], threads = fixtureThreads()) {
  const app = await loadApp();
  if (agentPage !== null) setAgentPage(agentPage);
  const panel = app.navPanels.find((candidate) => candidate.id === "souls")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over, agents), sidebarThreads: { status: "ready", threads } });
}
type Slot = Awaited<ReturnType<typeof souls>>;
const rpcOf = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method);
const soul = (name: string, over: object = {}) => ({ name, agent: name, description: "", origin: "member github.com/awebai/oats @ e5b6c5ac", capabilities: [], spawnable: true, problem: null, shortName: name, source: { kind: "member", label: "workspace" }, ...over });
/** The souls as the kernel's fuller answer gives them: two of the workspace, one of a package that cannot be spawned. */
const LISTED = [
  soul("oats-developer", { description: "Builds and proves one spec.\nAnd a second line the list does not need.", capabilities: ["oats.developer", "oats.aweb", "oats.core"], harness: "pi", model: "gpt-6-astra", teams: [{ label: "oats", isDefault: true }, { label: "wider", isDefault: false }], why: { "oats.developer": "soul", "oats.aweb": "workspace", "oats.core": "workspace" } }),
  soul("oats-expert"),
  soul("oats.okf/knowledge-harvester", { agent: "knowledge-harvester", shortName: "knowledge-harvester", source: { kind: "package", label: "oats.okf 6.2.0" }, description: "Harvests.", spawnable: false, problem: "E_REMOVED: this soul was removed in oats.okf 6.0" }),
];
const listed = { souls: () => ({ souls: LISTED }) };
const rowsOf = (slot: Slot) => slot.getAllByTestId("oats-soul-row").map((row) => ({ name: within(row).getByTestId("oats-soul-name").textContent, does: within(row).queryByTestId("oats-soul-does")?.textContent ?? null, running: within(row).queryByTestId("oats-soul-running")?.textContent ?? null, cannot: within(row).queryByTestId("oats-soul-cannot")?.textContent ?? null }));

// ---- the list ----

test("the Souls tab: the souls in groups by where they come from, each by its own name with ONE line of what it does, how many of its agents run, and \"Can't spawn\"; a press opens the soul", async () => {
  const slot = await souls("", listed);
  await slot.findAllByTestId("oats-soul-row");
  // The groups' headings: the workspace's own, then a package with its version; each with its count.
  expect(slot.getAllByTestId("oats-soul-group").map((group) => group.querySelector("h2")!.textContent)).toEqual(["workspace2", "oats.okf 6.2.0" + "1"]);
  await waitFor(() =>
    expect(rowsOf(slot)).toEqual([
      // What it does is the soul's whole description as one line of text, clamped to one line by the page (whole in its title).
      { name: "oats-developer", does: "Builds and proves one spec. And a second line the list does not need.", running: "2 running", cannot: null },
      // A soul none of whose agents runs says nothing of them: "0 agents" is the ordinary.
      { name: "oats-expert", does: null, running: null, cannot: null },
      // A package's soul is its own name under its group; its key is the row's title, whole.
      { name: "knowledge-harvester", does: "Harvests.", running: "1 running", cannot: "Can't spawn" },
    ]),
  );
  const does = within(slot.getAllByTestId("oats-soul-row")[0]!).getByTestId("oats-soul-does");
  expect(does.className).toContain("truncate"); // one line (where the page can measure, cut at a word: the live scene holds that)
  expect(does.getAttribute("title")).toContain("And a second line");
  expect(slot.getAllByTestId("oats-soul-row")[2]!.getAttribute("title")).toBe("oats.okf/knowledge-harvester");
  // No sentence on the page, no heading that repeats the tab, no soul's page beside the list.
  expect(slot.getByTestId("oats-souls-page").textContent).not.toMatch(/Pick a soul|\d+ agents?\b/);
  expect(slot.queryByTestId("oats-soul-detail")).toBeNull();
  expect(slot.getByTestId("oats-tab-souls").getAttribute("aria-selected")).toBe("true");
  expect(slot.queryByTestId("oats-search")).toBeNull(); // three souls need no filter
  fireEvent.click(slot.getAllByTestId("oats-soul-row")[2]!);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls", options: { subPath: "oats.okf/knowledge-harvester" } }]);
});

test("a row's order: the name, how many run, then \"Can't spawn\"; and souls of ONE package keep their heading, which is what names the package", async () => {
  const slot = await souls("", listed);
  await slot.findAllByTestId("oats-soul-row");
  const last = slot.getAllByTestId("oats-soul-row")[2]!;
  await waitFor(() => expect(within(last).queryByTestId("oats-soul-running")).not.toBeNull());
  expect(Array.from(last.firstElementChild!.children).map((part) => part.getAttribute("data-testid"))).toEqual(["oats-soul-name", "oats-soul-running", "oats-soul-cannot"]);
  slot.unmount();
  resetApp();
  const packaged = await souls("", { souls: () => ({ souls: [LISTED[2]!] }) });
  await packaged.findAllByTestId("oats-soul-row");
  expect(packaged.getAllByTestId("oats-soul-group").map((group) => group.querySelector("h2")?.textContent ?? null)).toEqual(["oats.okf 6.2.0" + "1"]);
  packaged.unmount();
  resetApp();
  // Souls of the workspace alone: no heading (it would tell nothing apart).
  const own = await souls("", { souls: () => ({ souls: LISTED.slice(0, 2) }) });
  await own.findAllByTestId("oats-soul-row");
  expect(own.getAllByTestId("oats-soul-group").map((group) => group.querySelector("h2"))).toEqual([null]);
});

test("souls the kernel names no source for are one list with no heading, each by its key", async () => {
  const slot = await souls("");
  await slot.findAllByTestId("oats-soul-row");
  expect(slot.getAllByTestId("oats-soul-group")).toHaveLength(1);
  expect(slot.getByTestId("oats-soul-group").querySelector("h2")).toBeNull();
  expect(rowsOf(slot).map((row) => row.name)).toEqual(["oats-developer", "broken-soul"]);
});

test("from twelve souls on the list has a search field: it narrows by a soul's key and what it does; nothing found says so in two words", async () => {
  const many = Array.from({ length: 12 }, (_, index) => soul(`soul-${index + 1}`, { description: index === 4 ? "Reviews code." : "" }));
  const slot = await souls("", { souls: () => ({ souls: many }) });
  await slot.findAllByTestId("oats-soul-row");
  const search = slot.getByTestId("oats-search") as HTMLInputElement;
  expect([search.getAttribute("aria-label"), search.placeholder]).toEqual(["Search souls", "Search souls"]);
  // One group whole: no heading over it.
  expect(slot.getByTestId("oats-soul-group").querySelector("h2")).toBeNull();
  fireEvent.change(search, { target: { value: "REVIEWS" } });
  expect(rowsOf(slot).map((row) => row.name)).toEqual(["soul-5"]);
  fireEvent.change(search, { target: { value: "soul-1" } });
  expect(rowsOf(slot).map((row) => row.name)).toEqual(["soul-1", "soul-10", "soul-11", "soul-12"]);
  fireEvent.change(search, { target: { value: "nothing like it" } });
  expect(slot.queryAllByTestId("oats-soul-row")).toEqual([]);
  expect(slot.getByText("Nothing matches.").tagName).toBe("P");
  // Eleven souls: no field.
  slot.unmount();
  resetApp();
  const fewer = await souls("", { souls: () => ({ souls: many.slice(0, 11) }) });
  await fewer.findAllByTestId("oats-soul-row");
  expect(fewer.queryByTestId("oats-search")).toBeNull();
});

test("while a search narrows the list the Souls tab says how many of how many", async () => {
  const many = Array.from({ length: 12 }, (_, index) => soul(`soul-${index + 1}`));
  const slot = await souls("", { souls: () => ({ souls: many }) });
  await slot.findAllByTestId("oats-soul-row");
  expect(slot.getByTestId("oats-tab-souls").textContent).toBe("Souls12");
  fireEvent.change(slot.getByTestId("oats-search"), { target: { value: "soul-1" } });
  expect(slot.getByTestId("oats-tab-souls").textContent).toBe("Souls4 of 12");
  fireEvent.change(slot.getByTestId("oats-search"), { target: { value: "" } });
  expect(slot.getByTestId("oats-tab-souls").textContent).toBe("Souls12");
});

test("no soul at all: two words", async () => {
  const slot = await souls("", { souls: () => ({ souls: [] }) });
  expect((await slot.findByText("No souls.")).tagName).toBe("P");
  expect(slot.queryAllByTestId("oats-soul-row")).toEqual([]);
});

test("while the souls are read the tab says \"Reading…\"; a read that failed is a notice in a person's words with Retry, the kernel's message one press away, never its raw line as the page's face", async () => {
  let failing = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const slot = await souls("", {
    souls: async () => {
      await held;
      if (failing) throw new Error("E_OATS_TIMEOUT: oats souls did not answer in 20 s");
      return handlers().souls(null);
    },
  });
  expect(slot.getByTestId("oats-loading").textContent).toBe("Reading…");
  release();
  const notice = await slot.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS could not be read");
  const details = within(notice).getByTestId("oats-notice-details") as HTMLDetailsElement;
  expect([details.open, details.textContent]).toEqual([false, expect.stringContaining("E_OATS_TIMEOUT: oats souls did not answer in 20 s")]);
  // On the face: the title and Retry, and nothing of the kernel's.
  expect(Array.from(notice.children).filter((part) => part.tagName !== "DETAILS").map((part) => part.textContent)).toEqual(["OATS could not be read", "Retry"]);
  failing = false;
  fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
  expect(await slot.findAllByTestId("oats-soul-row")).toHaveLength(2);
  expect(slot.queryByRole("alert")).toBeNull();
});

// A read that failed is read again with every roster read. While that read is on its way the notice stays: it does
// not give way to "Reading…" and come back (the live gate drew "Reading…" where the failed read's notice had been).
test("a failed read's notice stays while the souls are read again: no \"Reading…\" in its place; the rows follow when the read answers", async () => {
  let mode: "fail" | "hold" | "answer" = "fail";
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const slot = await souls("", {
    souls: async () => {
      if (mode === "fail") throw new Error("E_OATS_TIMEOUT: oats souls did not answer in 20 s");
      if (mode === "hold") await held;
      return handlers().souls(null);
    },
  });
  await slot.findByTestId("oats-read-retry");
  const asked = () => rpcOf(slot, "souls").length;
  const before = asked();
  mode = "hold";
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await waitFor(() => expect(asked()).toBeGreaterThan(before)); // the read is on its way again
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.queryByTestId("oats-loading")).toBeNull();
  expect(slot.getByRole("alert").querySelector("h3")!.textContent).toBe("OATS could not be read");
  expect(within(slot.getByRole("alert")).getByTestId("oats-notice-details").textContent).toContain("E_OATS_TIMEOUT");
  // Retry is off while that read is on its way: a press is seen, and a second press asks nothing more.
  expect((slot.getByTestId("oats-read-retry") as HTMLButtonElement).disabled).toBe(true);
  mode = "answer";
  release();
  expect((await slot.findAllByTestId("oats-soul-row")).length).toBeGreaterThan(0);
  expect(slot.queryByRole("alert")).toBeNull();
});

test("Retry pressed on a failed read: the notice stays with Retry off until the read answers; a read that fails again says its new message, Retry on", async () => {
  let message = "E_OATS_TIMEOUT: oats souls did not answer in 20 s";
  let release: (() => void) | null = null;
  let hold = false;
  const slot = await souls("", {
    souls: async () => {
      if (hold) await new Promise<void>((resolve) => (release = resolve));
      throw new Error(message);
    },
  });
  const retry = () => slot.getByTestId("oats-read-retry") as HTMLButtonElement;
  await slot.findByTestId("oats-read-retry");
  expect(retry().disabled).toBe(false);
  hold = true;
  message = "E_WORKSPACE_INVALID: oats-workspace.yaml: unknown key";
  fireEvent.click(retry());
  await waitFor(() => expect(retry().disabled).toBe(true));
  expect(slot.queryByTestId("oats-loading")).toBeNull();
  expect(within(slot.getByRole("alert")).getByTestId("oats-notice-details").textContent).toContain("E_OATS_TIMEOUT"); // what the last read said
  await waitFor(() => expect(release).not.toBeNull());
  act(() => release!());
  await waitFor(() => expect(within(slot.getByRole("alert")).getByTestId("oats-notice-details").textContent).toContain("E_WORKSPACE_INVALID"));
  expect(retry().disabled).toBe(false);
});

// Only a notice that was DRAWN is kept. While OATS cannot be read the roster's ONE notice stands and the tab draws none
// of its own: when the roster is readable again before the tab's read has answered, the tab says "Reading…", and no
// notice appears, new, with an old message.
test("under the roster's notice a tab's failed read keeps no notice: when the roster is read again first, the tab says \"Reading…\" until its own read answers", async () => {
  let down = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const slot = await souls("", {
    snapshot: () => (down ? failed(null)() : fixtureSnapshot()),
    souls: async () => {
      if (down) throw new Error("oats was not found on checks-host");
      await held;
      return handlers().souls(null);
    },
  });
  await slot.findByTestId("oats-unreadable");
  await waitFor(() => expect(rpcOf(slot, "souls").length).toBeGreaterThan(0));
  expect(slot.queryByTestId("oats-read-retry")).toBeNull(); // one notice: the roster's
  down = false;
  await act(async () => slot.behavior.emitRealtime("oats/changed", { at: "2026-11-24T12:00:00.000Z" }));
  await waitFor(() => expect(slot.queryByTestId("oats-unreadable")).toBeNull()); // the roster is read again; the souls are still on their way
  expect(slot.queryByRole("alert")).toBeNull();
  expect(slot.getByTestId("oats-loading").textContent).toBe("Reading…");
  release();
  expect((await slot.findAllByTestId("oats-soul-row")).length).toBeGreaterThan(0);
});

// ---- a soul's page ----

test("a soul's page opens over the list with the way back: its key, what it does whole, what its agents start with, its teams, and its origin one press away", async () => {
  const slot = await souls("oats-developer", listed);
  const detail = await slot.findByTestId("oats-soul-detail");
  // No list beside it and no tab strip: the page is the soul's, at every width.
  expect(slot.queryByTestId("oats-soul-row")).toBeNull();
  expect(slot.queryByTestId("oats-tabs")).toBeNull();
  expect(slot.getByTestId("oats-back").textContent).toBe("← Souls");
  expect(detail.querySelector("h2")!.textContent).toBe("oats-developer");
  // Where it comes from, in a word; then what it does, whole.
  expect(within(detail).getByTestId("oats-soul-source").textContent).toBe("workspace");
  expect(within(detail).getByTestId("oats-soul-does").textContent).toBe("Builds and proves one spec. And a second line the list does not need.");
  expect(Array.from(detail.querySelectorAll('[data-testid="oats-fact"]')).map((fact) => [fact.querySelector("dt")!.textContent, fact.querySelector("dd")!.textContent])).toEqual([
    ["Harness · model", "pi · gpt-6-astra"],
    ["Teams", "oats, wider"], // the default first
  ]);
  const under = slot.getByTestId("oats-soul-details") as HTMLDetailsElement;
  expect([under.open, under.querySelector("summary")!.textContent, Array.from(under.querySelectorAll("p")).map((line) => line.textContent)]).toEqual([false, expect.stringContaining("Details"), ["from member github.com/awebai/oats @ e5b6c5ac"]]);
  // Outside Details the origin is not on the page.
  expect(Array.from(detail.querySelectorAll("header *")).map((part) => part.textContent).join(" ")).not.toContain("github.com");
  fireEvent.click(slot.getByTestId("oats-back"));
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "souls" }]);
});

test("where a soul's harness was chosen is under Details, where the kernel says: its word as the New agent form says it, and the file", async () => {
  const slot = await souls("oats-expert", { souls: () => ({ souls: [soul("oats-expert", { harness: "pi", launchFrom: "local", launchAt: "oats-local.yaml#/souls/launch/oats-expert" })] }) });
  await slot.findByTestId("oats-soul-detail");
  expect(Array.from(slot.getByTestId("oats-soul-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["from member github.com/awebai/oats @ e5b6c5ac", "Harness: set for this soul on this computer (oats-local.yaml#/souls/launch/oats-expert)"]);
});

test("New agent on a soul's page opens the New agent form with that soul chosen; the earlier short form is gone", async () => {
  const slot = await souls("oats-developer", listed);
  await slot.findByTestId("oats-soul-detail");
  const button = slot.getByTestId("oats-soul-new-agent") as HTMLButtonElement;
  expect([button.textContent, button.disabled]).toEqual(["New agent", false]);
  fireEvent.click(button);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "new-agent", options: { subPath: "oats-developer" } }]);
  // No field, no Preview, no "Spawn in bb", no sentence of bb's mode: the form is the New agent page's.
  expect(slot.container.querySelectorAll("input, textarea")).toHaveLength(0);
  expect(slot.getByTestId("oats-souls-page").textContent).not.toMatch(/Preview|Spawn in bb|full mode|What OATS would do/);
  expect(rpcOf(slot, "spawn")).toEqual([]);
});

test("a soul that cannot be spawned keeps New agent, off, with the one reason beside it; the kernel's own words are under Details", async () => {
  const slot = await souls("oats.okf/knowledge-harvester", listed);
  const detail = await slot.findByTestId("oats-soul-detail");
  const button = slot.getByTestId("oats-soul-new-agent") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(within(detail.querySelector("header")!).getByTestId("oats-disabled-reason").textContent).toBe("Can't spawn here");
  fireEvent.click(button);
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(Array.from(slot.getByTestId("oats-soul-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["from member github.com/awebai/oats @ e5b6c5ac", "E_REMOVED: this soul was removed in oats.okf 6.0"]);
  expect(detail.querySelector("header")!.textContent).not.toContain("E_REMOVED");
});

test("a soul's capabilities are rows: the ones that fill a core place first, tagged, then the rest; each says why the soul has it; none: two words", async () => {
  const capabilities = () => ({
    capabilities: [
      { id: "oats.aweb", description: "", origin: "", souls: 1, layer: "messaging" },
      { id: "oats.core", description: "", origin: "", souls: 1, layer: null },
      { id: "oats.developer", description: "", origin: "", souls: 1, layer: null },
    ],
  });
  const slot = await souls("oats-developer", { ...listed, capabilities });
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(slot.getAllByTestId("oats-soul-capability").map((row) => Array.from(row.children).map((part) => part.textContent))).toEqual([["oats.aweb", "core", "workspace"], ["oats.developer", "soul"], ["oats.core", "workspace"]]));
  expect(within(slot.getByTestId("oats-soul-capabilities")).getByRole("heading").textContent).toBe("Capabilities3");
  slot.unmount();
  resetApp();
  const none = await souls("oats-expert", listed);
  await none.findByTestId("oats-soul-detail");
  expect(within(none.getByTestId("oats-soul-capabilities")).getByText("No capabilities.").tagName).toBe("P");
});

test("a soul the kernel could not resolve (it cannot be spawned): nothing is said of its capabilities, never \"none\"; its file is under Details", async () => {
  const broken = soul("oats.okf/knowledge-maintainer", { agent: "knowledge-maintainer", spawnable: false, problem: "E_TEAM_UNKNOWN: team \"reviewers\" is not declared", unresolved: true as const, file: "souls/knowledge-maintainer/soul.yaml" });
  const slot = await souls("oats.okf/knowledge-maintainer", { souls: () => ({ souls: [broken] }) });
  await slot.findByTestId("oats-soul-detail");
  expect(slot.queryByTestId("oats-soul-capabilities")).toBeNull();
  expect(slot.getByTestId("oats-soul-detail").textContent).not.toMatch(/No capabilities|Capabilities/);
  expect(Array.from(slot.getByTestId("oats-soul-details").querySelectorAll("p")).map((line) => line.textContent)).toEqual(["from member github.com/awebai/oats @ e5b6c5ac", "Defined in souls/knowledge-maintainer/soul.yaml", "E_TEAM_UNKNOWN: team \"reviewers\" is not declared"]);
});

test("New agent on a soul's page is held, like every New agent, behind an oats the plugin does not work with", async () => {
  const slot = await souls("oats-developer", { ...listed, homeCli: () => ({ version: "0.1.0", desktopApi: 1, state: "older" as const }) });
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect((slot.getByTestId("oats-soul-new-agent") as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(slot.getByTestId("oats-soul-new-agent"));
  expect(slot.inspection.navigateCalls).toEqual([]);
});

const agentRows = (slot: Slot) => slot.getAllByTestId("oats-soul-agent").map((row) => [row.getAttribute("data-instance"), row.getAttribute("data-where"), within(row).getByTestId("oats-soul-agent-state").textContent]);

test("a soul's agents are the roster's rows: the state as a dot AND its word, where each runs; a row opens its thread, or its own page", async () => {
  const opened: string[] = [];
  agentPage = (_navigate, instance) => void opened.push(instance);
  const slot = await souls("oats-developer", listed);
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(agentRows(slot)).toEqual([["flaky-ci-developer", "thread", expect.stringMatching(/Needs you$/)], ["kernel-fix-developer", "tmux", expect.stringMatching(/(Running|Working)/)]]));
  expect(within(slot.getByTestId("oats-soul-agents")).getByRole("heading").textContent).toBe("Agents2");
  // Each state has its mark AND its word (the standard: never a dot alone).
  for (const row of slot.getAllByTestId("oats-soul-agent")) expect(within(row).getByTestId("oats-state").querySelector("[data-mark]")).not.toBeNull();
  // On a thread: a link to it.
  const onThread = slot.getAllByTestId("oats-soul-agent")[0]!.querySelector("a")!;
  expect(onThread.getAttribute("href")).toBe("/projects/proj_ci/threads/thr_ci");
  fireEvent.click(onThread);
  expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_ci" }]);
  // On tmux: the row itself opens the agent's page (no button "Open").
  const onTmux = slot.getAllByTestId("oats-soul-agent")[1]!;
  expect(onTmux.textContent).not.toMatch(/Open|on tmux/);
  fireEvent.click(onTmux.querySelector("button")!);
  expect(opened).toEqual(["kernel-fix-developer"]);
  // A soul with no agent here: two words.
  slot.unmount();
  resetApp();
  const none = await souls("oats-expert", { souls: () => ({ souls: [soul("oats-expert", { agent: "nobody" })] }) });
  await none.findByTestId("oats-soul-detail");
  expect(await within(none.getByTestId("oats-soul-agents")).findByText("No agents.")).toBeTruthy();
});

test("an agent whose thread bb has archived while it runs is said in the outside feature's words (\"may still run\"), with its acts, each opening its dialog; \"thread missing\" is said nowhere", async () => {
  const threads = fixtureThreads().map((thread) => (thread.id === "thr_ci" ? { ...thread, isArchived: true } : thread));
  const slot = await souls("oats-developer", listed, fixtureAgents(), threads);
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(agentRows(slot)[0]).toEqual(["flaky-ci-developer", "detached", expect.stringMatching(/Needs you· may still run$/)]));
  const row = slot.getAllByTestId("oats-soul-agent")[0]!;
  expect(slot.getByTestId("oats-souls-page").textContent).not.toContain("thread missing");
  const acts = Array.from(row.querySelectorAll<HTMLButtonElement>('[data-testid^="oats-agent-act-"], [data-testid="oats-status-act"]'));
  expect(acts.length).toBeGreaterThan(0);
  expect(acts.every((act) => act.textContent!.endsWith("…"))).toBe(true); // each opens a dialog
  fireEvent.click(acts[0]!);
  // The act's own dialog is asked for (test/lifecycle/actions.test.tsx holds what it does): nothing runs on one press.
  expect(asked()?.instance).toBe("flaky-ci-developer");
  expect(rpcOf(slot, "start")).toEqual([]);
  expect(rpcOf(slot, "stopApply")).toEqual([]);
});

test("a soul name in the URL that the deployment does not have says so, with the way back", async () => {
  const slot = await souls("no%20such%20soul");
  expect((await slot.findByText("This deployment has no soul named no such soul.")).tagName).toBe("P");
  expect(slot.getByTestId("oats-back")).toBeTruthy();
});

test("a package soul's agents are matched by its roster agent name, not by its key", async () => {
  // bb hands the key back as it took it: `/`-separated segments, each percent-encoded
  const slot = await souls("oats.okf/knowledge-harvester", listed);
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(agentRows(slot).map(([instance]) => instance)).toEqual(["harvest-knowledge-helper"]));
  expect(slot.getByTestId("oats-soul-detail").querySelector("h2")!.textContent).toBe("oats.okf/knowledge-harvester");
});

test("a soul key with characters bb percent-encodes is decoded segment by segment", async () => {
  const slot = await souls("my%20pkg/soul%2Fx", { souls: () => ({ souls: [soul("my pkg/soul/x", { agent: "x" })] }) });
  expect((await slot.findByTestId("oats-soul-detail")).querySelector("h2")!.textContent).toBe("my pkg/soul/x");
});

test("while bb is still listing its threads a soul's agents are not drawn at all: none is said to be archived or gone", async () => {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "souls")!;
  const slot = renderSlot<{ subPath: string }, Contract>(panel, { subPath: "oats-developer" }, { rpc: handlers(), sidebarThreads: { status: "loading", threads: [] } });
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(slot.queryAllByTestId("oats-soul-agent")).toEqual([]);
  expect(within(slot.getByTestId("oats-soul-agents")).getByTestId("oats-loading").textContent).toBe("Reading…");
});

// A soul's agents are the roster's: while OATS cannot be read the page says so with the notice
// every place shows, above the agents as last read; with no roster ever read, the notice alone.
const last = (minutes: number) => ({ at: new Date(Date.now() - minutes * 60_000).toISOString(), deployment: { root: "/abs/deployment", workspace: "oats", machine: "checks-host" }, agents: fixtureAgents() });
// Behind a result (an act of ours ended and the window's roster is not yet one read after it) a soul's agent says
// "Reading…" in its state's place and its acts are off, as every place that says an agent's state (app/roster/reading.tsx).
test("behind a result a soul's agent says \"Reading…\" and its acts are off and press nothing; a roster read after the act's end brings both back", async () => {
  const { noteActed, forgetActed } = await import("../../app/roster/reading");
  const { act } = await import("@testing-library/react");
  const threads = fixtureThreads().map((thread) => (thread.id === "thr_ci" ? { ...thread, isArchived: true } : thread));
  const slot = await souls("oats-developer", listed, fixtureAgents(), threads);
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(agentRows(slot)[0]).toEqual(["flaky-ci-developer", "detached", expect.stringMatching(/Needs you· may still run$/)]));
  const row = () => slot.getAllByTestId("oats-soul-agent")[0]!;
  const acts = () => Array.from(row().querySelectorAll<HTMLButtonElement>('[data-testid^="oats-agent-act-"], [data-testid="oats-status-act"]'));
  expect(acts().every((button) => !button.disabled)).toBe(true);
  try {
    act(() => noteActed(["flaky-ci-developer"], fixtureSnapshot().at)); // an act ended; the window's roster was read before that
    await waitFor(() => expect(within(row()).getByTestId("oats-soul-agent-state").textContent).toBe("Reading…"));
    expect(within(row()).getByTestId("oats-soul-agent-state").querySelector("[data-state]")).toBeNull(); // no state's mark: the row says no state
    expect(row().textContent).not.toMatch(/Needs you|may still run/);
    expect(acts().length).toBeGreaterThan(0);
    for (const button of acts()) {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(asked()).toBeNull();
    // The other agent of the soul is not behind a result: its row is as it was.
    expect(agentRows(slot)[1]![2]).toMatch(/^Running/);
  } finally {
    act(() => forgetActed());
  }
  await waitFor(() => expect(within(row()).getByTestId("oats-soul-agent-state").textContent).toMatch(/Needs you/));
  expect(acts().every((button) => !button.disabled)).toBe(true);
});

const failed = (kept: ReturnType<typeof last> | null, code = "OATS_NOT_FOUND") => () => ({ ok: false as const, at: new Date().toISOString(), code, message: "oats was not found on checks-host: install OATS there", machine: "checks-host", last: kept });

test("a soul's page and the Souls tab while OATS cannot be read: ONE notice with the age, above what was last read; with no roster, the notice and nothing of the agents", async () => {
  const stale = await souls("oats-developer", { snapshot: failed(last(40)) });
  const notice = await stale.findByRole("alert");
  expect(notice.querySelector("h3")!.textContent).toBe("OATS is not installed on checks-host");
  expect(notice.textContent).toContain("Read 40 min ago.");
  expect(stale.getAllByTestId("oats-unreadable")).toHaveLength(1);
  expect(stale.getByTestId("oats-soul-detail").textContent).toContain("Flaky ci developer");
  stale.unmount();
  resetApp();
  const never = await souls("oats-developer", { snapshot: failed(null) });
  expect((await never.findByRole("alert")).querySelector("h3")!.textContent).toBe("OATS is not installed on checks-host");
  expect(never.getByTestId("oats-soul-detail").textContent).not.toContain("Flaky ci developer");
  expect(never.getByRole("button", { name: "Retry" })).toBeTruthy();
  // With the roster never read New agent is held, as the home and the sidebar offer none then.
  expect((never.getByTestId("oats-soul-new-agent") as HTMLButtonElement).disabled).toBe(true);
  never.unmount();
  resetApp();
  // The list: the same one notice; the running counts are the last read's.
  const list = await souls("", { ...listed, snapshot: failed(last(40)) });
  expect((await list.findByRole("alert")).textContent).toContain("Read 40 min ago.");
  expect(list.getAllByTestId("oats-unreadable")).toHaveLength(1);
  await waitFor(() => expect(rowsOf(list)[0]!.running).toBe("2 running"));
});

// The acts are held on the last roster read, in this place too: New agent, and the acts of an
// agent whose thread bb does not list, stay in their place, off; the page's notice says why.
test("a soul's page on the last roster read: New agent and the acts of a detached agent are off, and press nothing", async () => {
  const threads = fixtureThreads().map((thread) => (thread.id === "thr_ci" ? { ...thread, isArchived: true } : thread));
  const slot = await souls("oats-developer", { ...listed, snapshot: failed(last(3), "OATS_TIMEOUT") }, fixtureAgents(), threads);
  await slot.findByTestId("oats-soul-detail");
  await waitFor(() => expect(agentRows(slot)[0]![1]).toBe("detached"));
  const buttons = [slot.getByTestId("oats-soul-new-agent") as HTMLButtonElement, ...Array.from(slot.getAllByTestId("oats-soul-agent")[0]!.querySelectorAll<HTMLButtonElement>('[data-testid^="oats-agent-act-"], [data-testid="oats-status-act"]'))];
  expect(buttons.length).toBeGreaterThan(1);
  for (const button of buttons) {
    expect([button.textContent, button.disabled, button.title]).toEqual([button.textContent, true, ""]); // off, with no reason of its own
    fireEvent.click(button);
  }
  expect(slot.inspection.navigateCalls).toEqual([]);
  expect(asked()).toBeNull();
});
