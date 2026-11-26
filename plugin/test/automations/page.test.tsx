// @vitest-environment jsdom
// The Automations page as bb mounts it: registered beside the workspace's pages, its tab and its
// open row in its route, the lists read once through the plugin's server, a trigger's state read
// when its page opens.
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { gateOf, routeOf, subPathOf } from "../../app/automations/Page";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { AT, OATS, STATUSES } from "./handlers";
import { schedules, statusOf, triggers } from "./fixtures";

afterEach(resetApp);

async function page(subPath = "", over: Partial<Handlers> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
/** What the page asked of the server for its own content: every call but the window's roster (`snapshot`, and `souls` for the souls' names), which says of the agents a run made whether each is still there, asks or is stopped. */
const calls = (slot: Awaited<ReturnType<typeof page>>) => slot.inspection.rpcCalls.map((call) => call.method).filter((method) => method !== "snapshot" && method !== "souls");

describe("the page's registration and its route", () => {
  it("is a page of the plugin at /plugins/oats/automations, out of bb's own navigation", async () => {
    const app = await loadApp();
    const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
    expect([panel.path, panel.title, panel.experimental_hideFromNavigation]).toEqual(["automations", "Automations", true]);
  });

  it("the route names the tab and the open row; an id keeps its slash; the earlier tabs' addresses are the list", () => {
    expect(routeOf("")).toEqual({ tab: "list", open: null });
    expect(routeOf("runs")).toEqual({ tab: "runs", open: null });
    expect(routeOf("schedules")).toEqual({ tab: "list", open: null });
    expect(routeOf("triggers")).toEqual({ tab: "list", open: null });
    expect(routeOf("triggers/oats-real/proposal-review")).toEqual({ tab: "list", open: { kind: "trigger", id: "oats-real/proposal-review" } });
    expect(routeOf("schedules/local/daily%20x")).toEqual({ tab: "list", open: { kind: "schedule", id: "local/daily x" } });
    expect(routeOf("elsewhere/x")).toEqual({ tab: "list", open: null });
    expect(routeOf("triggers/%E0%A4%A")).toEqual({ tab: "list", open: null });
    expect(subPathOf("list")).toBe("");
    expect(subPathOf("runs")).toBe("runs");
    expect(subPathOf("list", { kind: "schedule", id: "local/daily-review" })).toBe("schedules/local/daily-review");
    expect(subPathOf("runs", { kind: "trigger", id: "local/pr-triage" })).toBe("triggers/local/pr-triage");
  });
});

describe("the page's title, in bb's own header", () => {
  const title = async (subPath: string, over: Partial<Handlers> = {}) => {
    const app = await loadApp();
    const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
    const seen: unknown[] = [];
    const Probe = (props: { subPath: string }) => {
      seen.push(panel.experimental_usePageTitle!(props as never));
      return null;
    };
    const slot = renderSlot<{ subPath: string }, Contract>({ ...panel, component: Probe as never }, { subPath }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
    return { slot, seen };
  };

  it("the tabs keep the page's own title; a row's page is a breadcrumb of its name, by the list's name for it once the lists are read", async () => {
    expect((await title("")).seen.at(-1)).toBeNull();
    resetApp();
    expect((await title("runs")).seen.at(-1)).toBeNull();
    resetApp();
    const { seen } = await title("schedules/oats-real/nightly-digest");
    await waitFor(() => expect(seen.at(-1)).toEqual({ breadcrumbs: [{ label: "nightly-digest" }], windowTitle: "nightly-digest" }));
  });

  it("the icon is bb's own for automations", async () => {
    const app = await loadApp();
    expect(app.navPanels.find((candidate) => candidate.id === "automations")!.icon).toBe("Repeat");
  });
});

describe("the lists", () => {
  it("are read once, with every trigger's state, and shown as one list", async () => {
    const slot = await page();
    expect(await slot.findAllByTestId("oats-automation-row")).toHaveLength(18);
    expect(slot.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Automations18", "Runs"]);
    // One read of the lists (with every trigger's state), beside the window's roster.
    expect(calls(slot)).toEqual(["automations"]);
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("snapshot");
  });

  it("a tab is a route: choosing Runs navigates, and its route shows every automation's runs", async () => {
    const slot = await page();
    await slot.findAllByTestId("oats-automation-row");
    fireEvent.click(slot.getAllByRole("tab")[1]!);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "runs" } }]);
    resetApp();
    const runsPage = await page("runs");
    expect(await runsPage.findAllByTestId("oats-run")).toHaveLength(9);
    // An automation's name there opens its page, by its route.
    fireEvent.click(within(runsPage.getAllByTestId("oats-run")[0]!).getByTestId("oats-run-owner"));
    expect(runsPage.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "triggers/oats-real/harvest-review" } }]);
  });

  it("a run's agent is a link to its thread while the roster lists it, and plain text once it does not", async () => {
    const slot = await page("schedules/local/daily-review");
    const agent = await slot.findByTestId("oats-run-agent");
    // The recorded run's agent is none of the roster's: its name, plain.
    expect([agent.tagName, agent.dataset.listed, agent.textContent]).toEqual(["SPAN", "false", "oats-developer-review-202611212017"]);
  });

  it("a row opens its page by its route", async () => {
    const slot = await page();
    const rows = await slot.findAllByTestId("oats-automation-row");
    fireEvent.click(within(rows.find((row) => row.dataset.id === "oats-real/nightly-digest")!).getByTestId("oats-automation-open"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules/oats-real/nightly-digest" } }]);
  });

  it("a list the kernel refused shows the kernel's code and message with Retry; the other list's rows stand", async () => {
    const slot = await page("", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: false as const, code: "E_SCHEDULE_INVALID", message: "/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}" }, trigger: { ok: true as const, list: triggers() } }),
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toBe("Schedules could not be readNothing can be shown of this deployment's schedules until they are read.E_SCHEDULE_INVALID▸Details/abs/deployment/oats-schedules.json must be {version: 1|2, jobs: {}}Retry");
    expect(slot.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Automations7", "Runs"]);
    expect(slot.getAllByTestId("oats-automation-row")).toHaveLength(7);
    fireEvent.click(within(alert).getByText("Retry"));
    await waitFor(() => expect(calls(slot)).toEqual(["automations", "refresh", "automations"]));
  });

  it("every trigger's state refused while the lists stand is SAID, over the list and over the Runs tab: no trigger is drawn calm in silence", async () => {
    const refusedState = { ok: false as const, code: "E_TRIGGER_STATE", message: "the trigger state cannot be read" };
    const answer = () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refusedState, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } });
    const slot = await page("", { automations: answer });
    const notice = await slot.findByTestId("oats-automations-state-failed");
    expect(notice.textContent).toBe("Triggers' state could not be readNothing can be shown of what the triggers fired, or of what failed, until it is read.E_TRIGGER_STATE▸Detailsthe trigger state cannot be readRetry");
    // Both lists stand, with every row.
    expect(slot.getAllByTestId("oats-automation-row")).toHaveLength(18);
    expect(slot.queryByTestId("oats-automations-failed")).toBeNull();
    fireEvent.click(within(notice).getByText("Retry"));
    await waitFor(() => expect(calls(slot)).toEqual(["automations", "refresh", "automations"]));
    resetApp();
    // The Runs tab says it too: its table is then the schedules' runs alone.
    const runs = await page("runs", { automations: answer });
    expect((await runs.findByTestId("oats-automations-state-failed")).textContent).toContain("Triggers' state could not be read");
    resetApp();
    // A schedule's own page is not about it.
    const own = await page("schedules/oats-real/nightly-digest", { automations: answer });
    await own.findByTestId("oats-automation-detail");
    expect(own.queryByTestId("oats-automations-state-failed")).toBeNull();
  });

  it("a later read of every trigger's state that is refused keeps the state read before, and says how old it is", async () => {
    let reads = 0;
    const slot = await page("", {
      automations: () => {
        reads += 1;
        // The server's stamp of each read: the age said is from the stamp of the read whose state is kept.
        return { at: new Date(Date.now() - (reads === 1 ? 20e3 : 0)).toISOString(), hostId: "host_falcon", oats: OATS, statuses: reads === 1 ? STATUSES() : { ok: false as const, code: "E_TRIGGER_STATE", message: "the trigger state cannot be read" }, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } };
      },
    });
    const lineOf = () => within(slot.getAllByTestId("oats-automation-row").find((row) => row.dataset.id === "oats-real/proposal-review")!).getByTestId("oats-automation-line").textContent;
    await slot.findAllByTestId("oats-automation-row");
    const before = lineOf();
    expect(before).toContain("Last");
    expect(slot.queryByTestId("oats-automations-state-failed")).toBeNull();
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
    const notice = await slot.findByTestId("oats-automations-state-failed");
    expect(notice.textContent).toBe("Triggers' state could not be readWhat is below is the last state that was read.Read less than a minute ago.E_TRIGGER_STATE▸Detailsthe trigger state cannot be readRetry");
    expect(lineOf()).toBe(before);
  });

  it("a triggers' list that is refused says so itself: no second notice for the state nobody asked of it", async () => {
    const refusedList = { ok: false as const, code: "E_TRIGGER_INVALID", message: "oats-triggers.json cannot be read" };
    const slot = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refusedList, schedule: { ok: true as const, list: schedules() }, trigger: refusedList }) });
    await slot.findByTestId("oats-automations-failed");
    expect(slot.queryByTestId("oats-automations-state-failed")).toBeNull();
  });

  it("the plugin's own lack (no deployment, no machine chosen) is its own sentence, its code after", async () => {
    const message = 'This bb server has 2 machines (falcon, osprey). Choose the one that holds the OATS homes: set "Machine" in the OATS plugin\'s settings.';
    const refused = { ok: false as const, code: "CHOOSE_HOST", message };
    const slot = await page("", { automations: () => ({ at: AT, hostId: null, oats: null, statuses: refused, schedule: refused, trigger: refused }) });
    // The plugin's one notice for an OATS that cannot be read: a person's words, the server's own one press away, and the way to the settings.
    expect((await slot.findByRole("alert")).textContent).toBe(`Choose the machine that holds your agents▸DetailsThis bb server has more than one machine.CHOOSE_HOST: ${message}Open settings`); // (the plugin's one notice since the text cut: its title; the sentence, then "code: message", under its one Details)
  });

  it("a re-read that fails after one that answered says so over the list still shown, with Retry", async () => {
    let asked = 0;
    const slot = await page("", {
      automations: () => {
        asked += 1;
        if (asked > 1) throw new Error("the plugin's server is restarting");
        return { at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } };
      },
    });
    expect(await slot.findAllByTestId("oats-automation-row")).toHaveLength(18);
    fireEvent.click(slot.getByTestId("oats-automations-refresh"));
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/^Automations could not be readWhat is below is the last list that was read\.Held until the list can be read again: what each row is now is not known\.Read .+\.▸Detailsthe plugin's server is restartingRetry$/);
    expect(slot.getAllByTestId("oats-automation-row")).toHaveLength(18);
    // What a row is now is not known: its acts are held (the switch, the menu's acts), and Open and Open file are not.
    const row = slot.getAllByTestId("oats-automation-row").find((entry) => entry.dataset.id === "local/daily-review")!;
    const toggle = within(row).getByRole("switch") as HTMLButtonElement;
    expect([toggle.disabled, toggle.title]).toEqual([true, "Comes back when OATS is read again"]);
    fireEvent.click(within(row).getByRole("button", { name: "Actions for daily-review" }));
    const items = within(row).getAllByRole("menuitem") as HTMLButtonElement[];
    expect(items.map((item) => [item.textContent, item.disabled || item.getAttribute("aria-disabled") === "true"])).toEqual([["Run now", true], ["Test", true], ["Edit summary", true], ["Open file", false], ["Delete…", true]]);
  });

  it("Retry while the server does not answer says it is reading again, and cannot be pressed twice at once", async () => {
    let release: (() => void) | undefined;
    let asked = 0;
    const slot = await page("", {
      automations: async () => {
        asked += 1;
        if (asked > 1) await new Promise<void>((resolve) => (release = resolve));
        throw new Error("the plugin's server is restarting");
      },
    });
    const alert = await slot.findByRole("alert");
    fireEvent.click(within(alert).getByText("Retry"));
    await waitFor(() => expect((slot.getByTestId("oats-automations-retry") as HTMLButtonElement).disabled).toBe(true));
    expect(slot.getByRole("alert").textContent).toBe("Automations could not be readNothing can be shown of this deployment's automations until they are read.Refreshing…▸Detailsthe plugin's server is restartingRetry");
    expect((slot.getByTestId("oats-automations-refresh") as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(release).toBeDefined());
    release!();
    // It failed the same way: the notice stands, and Retry can be pressed again.
    await waitFor(() => expect((slot.getByTestId("oats-automations-retry") as HTMLButtonElement).disabled).toBe(false));
    expect(slot.getByRole("alert").textContent).toBe("Automations could not be readNothing can be shown of this deployment's automations until they are read.▸Detailsthe plugin's server is restartingRetry");
  });

  it("a server that does not answer says so, with Retry", async () => {
    const slot = await page("", {
      automations: () => {
        throw new Error("the plugin's server is restarting");
      },
    });
    expect((await slot.findByRole("alert")).textContent).toBe("Automations could not be readNothing can be shown of this deployment's automations until they are read.▸Detailsthe plugin's server is restartingRetry");
  });
});

describe("what cannot be shown at all (D-285)", () => {
  it("no oats on the machine: the notice every place of the plugin shows for it, naming the machine, with Retry and the way to the settings", async () => {
    const refused = { ok: false as const, code: "OATS_NOT_FOUND", message: "`oats` could not be run (ENOENT)" };
    const named = await page("", { automations: () => ({ at: AT, hostId: null, machine: "falcon", oats: null, statuses: refused, schedule: refused, trigger: refused }) });
    const gate = await named.findByTestId("oats-automations-gate");
    expect(gate.textContent).toBe("OATS is not installed on falcon▸DetailsInstall OATS there, or set the path to oats in the plugin's settings.OATS_NOT_FOUND: `oats` could not be run (ENOENT)RetryOpen settings"); // (the plugin's one notice since the text cut: the sentence and "code: message" under its one Details)
    expect(within(gate).getByTestId("oats-unreadable").dataset.code).toBe("OATS_NOT_FOUND");
    expect(within(gate).getByRole("link", { name: "Open settings" }).getAttribute("href")).toMatch(/^\/settings\/plugins\//);
    // Retry asks the server to read OATS again.
    fireEvent.click(within(gate).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(named.inspection.rpcCalls.filter((call) => call.method === "refresh")).toHaveLength(1));
    expect(named.getAllByRole("tab")).toHaveLength(2);
    resetApp();
    const slot = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refused, schedule: refused, trigger: refused }) });
    expect((await slot.findByTestId("oats-automations-gate")).textContent).toBe("OATS is not installed on this machine▸DetailsInstall OATS there, or set the path to oats in the plugin's settings.OATS_NOT_FOUND: `oats` could not be run (ENOENT)RetryOpen settings");
    resetApp();
    const other = await page("runs", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: refused, schedule: refused, trigger: refused }) });
    expect((await other.findByTestId("oats-automations-gate")).textContent).toBe("OATS is not installed on this machine▸DetailsInstall OATS there, or set the path to oats in the plugin's settings.OATS_NOT_FOUND: `oats` could not be run (ENOENT)RetryOpen settings");
  });

  it("an OATS without the automations lists, as the server answers for one", async () => {
    const none = { ok: false as const, code: "OATS_NO_AUTOMATIONS", message: "OATS 0.28.0 has no automations lists: they need OATS 0.29 or later." };
    const slot = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: { version: "0.28.0", features: ["schedule"], automationsApi: null }, statuses: none, schedule: none, trigger: none }) });
    expect((await slot.findByTestId("oats-automations-gate")).textContent).toBe("Automations need OATS 0.29 or laterUpdate OATS to see the workspace's schedules and triggers and this computer's own, and where each one runs.OATS_NO_AUTOMATIONS");
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("the gate is the server's word: its code for an OATS without the lists, or for no oats, kept with its message; any other refusal is no gate", () => {
    const none = { code: "OATS_NO_AUTOMATIONS", message: "OATS 0.28.0 has no automations lists: they need OATS 0.29 or later." };
    expect(gateOf(none)).toEqual({ title: "Automations need OATS 0.29 or later", detail: "Update OATS to see the workspace's schedules and triggers and this computer's own, and where each one runs.", code: "OATS_NO_AUTOMATIONS" });
    // No `oats` at all is not this gate: it is the plugin's one notice for an OATS that cannot be read.
    expect(gateOf({ code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there." })).toBeNull();
    expect(gateOf({ code: "E_SCHEDULE_INVALID", message: "x" })).toBeNull();
    expect(gateOf(null)).toBeNull();
  });


});

describe("a row's page", () => {
  const said = (slot: Awaited<ReturnType<typeof page>>) => slot.queryAllByTestId("oats-run").map((run) => `${run.dataset.of}: ${within(run).getByTestId("oats-run-said").textContent}`);
  const PROPOSAL = ["pending: #43 opened · Waiting", "fired: #41 opened · Agent launched", "fired: #42 opened · Agent launched"];

  it("a schedule's route opens its page; Escape is the list's route", async () => {
    const slot = await page("schedules/local/daily-review");
    expect((await slot.findByTestId("oats-automation-identity")).textContent).toContain("daily-review");
    fireEvent.keyDown(slot.getByTestId("oats-automation-detail"), { key: "Escape" });
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "" } }]);
    // A schedule has no recorded state of a trigger to read.
    expect(calls(slot)).toEqual(["automations"]);
  });

  it("a trigger's page shows its runs at once, from the state read beside the lists, and reads that trigger's own state once", async () => {
    const slot = await page("triggers/oats-real/proposal-review");
    await waitFor(() => expect(said(slot)).toEqual(PROPOSAL));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "triggerStatus").map((call) => call.input)).toEqual([{ id: "oats-real/proposal-review" }]));
  });

  it("a state that cannot be read is said: the kernel's message, its code after, Retry; what was read beside the lists still shows", async () => {
    let fail = true;
    const slot = await page("triggers/oats-real/proposal-review", {
      triggerStatus: ({ id }) => {
        if (fail) throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
        return statusOf(id);
      },
    });
    const notice = await slot.findByTestId("oats-automation-status-failed");
    expect(notice.textContent).toBe("This trigger's state could not be readOATS_TIMEOUT▸Details`oats` did not answer within 20 s and was stoppedRetry");
    expect(within(notice).getByRole("alert")).toBeTruthy();
    expect(said(slot)).toEqual(PROPOSAL);
    // Retry reads it again.
    fail = false;
    fireEvent.click(slot.getByTestId("oats-automation-status-retry"));
    await waitFor(() => expect(slot.queryByTestId("oats-automation-status-failed")).toBeNull());
    expect(said(slot)).toEqual(PROPOSAL);
  });

  it("a state read before stays, marked with its age, when a later read of it fails", async () => {
    let asked = 0;
    let reads = 0;
    const slot = await page("triggers/oats-real/proposal-review", {
      // Each read of the lists is another answer of the server.
      automations: () => ({ at: `2026-11-21T20:4${++reads}:00.000Z`, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }),
      triggerStatus: ({ id }) => {
        asked += 1;
        if (asked > 1) throw new Error("E_TRIGGER_FAILED: the trigger state cannot be read");
        return statusOf(id);
      },
    });
    await waitFor(() => expect(asked).toBe(1));
    // OATS changed: the lists are read again, and with them the state.
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
    const notice = await slot.findByTestId("oats-automation-status-failed");
    expect(notice.textContent).toBe("This trigger's state could not be readRead less than a minute ago.E_TRIGGER_FAILED▸Detailsthe trigger state cannot be readRetry");
    expect(said(slot)).toEqual(PROPOSAL);
  });

  it("a route to a row the list does not hold goes back to the list", async () => {
    const slot = await page("schedules/local/gone");
    await slot.findAllByTestId("oats-automation-row");
    await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "" } }]));
  });

  it("Open capability shows for a source whose capability the Capabilities page lists once, and opens that page", async () => {
    const listed = { capabilities: () => ({ capabilities: [{ id: "acme.graph", description: "A knowledge graph.", origin: "oats-real", souls: 1 }] }) };
    const slot = await page("triggers/oats-real/harvest-review", listed);
    const button = await slot.findByTestId("oats-automation-open-capability");
    expect(button.getAttribute("aria-label")).toBe("Open capability acme.graph");
    fireEvent.click(button);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "capabilities" }]);
    resetApp();
    // Not listed, or listed twice: the source stays text.
    const unlisted = await page("triggers/oats-real/harvest-review");
    await unlisted.findByTestId("oats-automation-details");
    await waitFor(() => expect(unlisted.inspection.rpcCalls.map((call) => call.method)).toContain("capabilities"));
    expect(unlisted.queryByTestId("oats-automation-open-capability")).toBeNull();
    resetApp();
    const twice = await page("triggers/oats-real/harvest-review", { capabilities: () => ({ capabilities: [1, 2].map(() => ({ id: "acme.graph", description: "", origin: "x", souls: 0 })) }) });
    await twice.findByTestId("oats-automation-details");
    await waitFor(() => expect(twice.inspection.rpcCalls.map((call) => call.method)).toContain("capabilities"));
    expect(twice.queryByTestId("oats-automation-open-capability")).toBeNull();
  });

  it("Open file of a member with no clone here opens its page on the web", async () => {
    const list = schedules();
    const web = "https://github.com/acme/agents/blob/0123abc/oats-schedules/nightly-digest.yaml";
    const rows = list.rows.map((row) => (row.id === "oats-real/nightly-digest" ? { ...row, origin: { ...row.origin, localPath: null, url: web } } : row));
    const slot = await page("schedules/oats-real/nightly-digest", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, statuses: STATUSES(), schedule: { ok: true as const, list: { ...list, rows } }, trigger: { ok: true as const, list: triggers() } }) });
    fireEvent.click(await slot.findByTestId("oats-automation-open-file"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "openUrl", url: web }]);
  });

  it("Open file previews the definition from the machine that holds the deployment", async () => {
    const slot = await page("schedules/oats-real/nightly-digest");
    const button = (await slot.findByTestId("oats-automation-open-file")) as HTMLButtonElement;
    expect(button.textContent).toBe(schedules().rows.find((row) => row.id === "oats-real/nightly-digest")!.origin.path);
    fireEvent.click(button);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_falcon", path: "/abs/deployment/oats-real/oats-schedules/nightly-digest.yaml" }, location: null } },
    ]);
  });
});
