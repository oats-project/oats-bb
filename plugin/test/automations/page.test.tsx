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
import { AT, OATS } from "./handlers";
import { schedules, statusOf, triggers } from "./fixtures";

afterEach(resetApp);

async function page(subPath = "", over: Partial<Handlers> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
const calls = (slot: Awaited<ReturnType<typeof page>>) => slot.inspection.rpcCalls.map((call) => call.method);

describe("the page's registration and its route", () => {
  it("is a page of the plugin at /plugins/oats/automations, out of bb's own navigation", async () => {
    const app = await loadApp();
    const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
    expect([panel.path, panel.title, panel.experimental_hideFromNavigation]).toEqual(["automations", "Automations", true]);
  });

  it("the route names the tab and the open row; an id keeps its slash", () => {
    expect(routeOf("")).toEqual({ kind: "schedule", openId: null });
    expect(routeOf("schedules")).toEqual({ kind: "schedule", openId: null });
    expect(routeOf("triggers")).toEqual({ kind: "trigger", openId: null });
    expect(routeOf("triggers/oats-real/proposal-review")).toEqual({ kind: "trigger", openId: "oats-real/proposal-review" });
    expect(routeOf("schedules/local/daily%20x")).toEqual({ kind: "schedule", openId: "local/daily x" });
    expect(routeOf("elsewhere/x")).toEqual({ kind: "schedule", openId: "x" });
    expect(routeOf("triggers/%E0%A4%A")).toEqual({ kind: "schedule", openId: null });
    expect(subPathOf("trigger")).toBe("triggers");
    expect(subPathOf("schedule", "local/daily-review")).toBe("schedules/local/daily-review");
  });
});

describe("the lists", () => {
  it("are read once, and Schedules shows first with both counts", async () => {
    const slot = await page();
    expect(await slot.findAllByTestId("oats-automation-row")).toHaveLength(11);
    expect(slot.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Schedules11", "Triggers7"]);
    expect(calls(slot)).toEqual(["automations"]);
  });

  it("a tab is a route: choosing Triggers navigates, and its route shows its list", async () => {
    const slot = await page();
    await slot.findAllByTestId("oats-automation-row");
    fireEvent.click(slot.getAllByRole("tab")[1]!);
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "triggers" } }]);
    resetApp();
    const triggersPage = await page("triggers");
    expect(await triggersPage.findAllByTestId("oats-automation-row")).toHaveLength(7);
  });

  it("a row opens its page by its route", async () => {
    const slot = await page();
    const rows = await slot.findAllByTestId("oats-automation-row");
    fireEvent.click(within(rows.find((row) => row.dataset.id === "oats-real/nightly-digest")!).getByTestId("oats-automation-open"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules/oats-real/nightly-digest" } }]);
  });

  it("a list the kernel refused shows the kernel's code and message with Retry; the other tab still lists", async () => {
    const slot = await page("", {
      automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: false as const, code: "E_SCHEDULE_INVALID", message: "oats-schedules.json: jobs must be an object" }, trigger: { ok: true as const, list: triggers() } }),
    });
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toBe("Schedules could not be readoats-schedules.json: jobs must be an objectE_SCHEDULE_INVALIDRetry");
    expect(slot.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Schedules", "Triggers7"]);
    fireEvent.click(within(alert).getByText("Retry"));
    await waitFor(() => expect(calls(slot)).toEqual(["automations", "refresh", "automations"]));
  });

  it("the plugin's own lack (no deployment, no machine chosen) is its own sentence, its code after", async () => {
    const message = 'This bb server has 2 machines (falcon, osprey). Choose the one that holds the OATS homes: set "Machine" in the OATS plugin\'s settings.';
    const refused = { ok: false as const, code: "CHOOSE_HOST", message };
    const slot = await page("", { automations: () => ({ at: AT, hostId: null, oats: null, schedule: refused, trigger: refused }) });
    expect((await slot.findByRole("alert")).textContent).toBe(`Schedules could not be read${message}CHOOSE_HOSTRetry`);
  });

  it("a re-read that fails after one that answered says so over the list still shown, with Retry", async () => {
    let asked = 0;
    const slot = await page("", {
      automations: () => {
        asked += 1;
        if (asked > 1) throw new Error("the plugin's server is restarting");
        return { at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } };
      },
    });
    expect(await slot.findAllByTestId("oats-automation-row")).toHaveLength(11);
    fireEvent.click(slot.getByTestId("oats-automations-refresh"));
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/^Schedules could not be readthe plugin's server is restartingShowing what was read .+\.Retry$/);
    expect(slot.getAllByTestId("oats-automation-row")).toHaveLength(11);
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
    expect(slot.getByRole("alert").textContent).toBe("Schedules could not be readthe plugin's server is restartingRefreshing…Retry");
    expect((slot.getByTestId("oats-automations-refresh") as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(release).toBeDefined());
    release!();
    // It failed the same way: the notice stands, and Retry can be pressed again.
    await waitFor(() => expect((slot.getByTestId("oats-automations-retry") as HTMLButtonElement).disabled).toBe(false));
    expect(slot.getByRole("alert").textContent).toBe("Schedules could not be readthe plugin's server is restartingRetry");
  });

  it("a server that does not answer says so, with Retry", async () => {
    const slot = await page("", {
      automations: () => {
        throw new Error("the plugin's server is restarting");
      },
    });
    expect((await slot.findByRole("alert")).textContent).toBe("Schedules could not be readthe plugin's server is restartingRetry");
  });
});

describe("what cannot be shown at all (D-285)", () => {
  it("no oats on the machine: the page says the list needs the OATS CLI", async () => {
    const refused = { ok: false as const, code: "OATS_NOT_FOUND", message: "`oats` could not be run (ENOENT)" };
    const slot = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: refused, trigger: refused }) });
    // The title is the Desktop's; the server's own words (which machine, what to do) and its code follow.
    expect((await slot.findByTestId("oats-automations-gate")).textContent).toBe("Schedules need the OATS CLI`oats` could not be run (ENOENT)OATS_NOT_FOUND");
    resetApp();
    const other = await page("triggers", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: refused, trigger: refused }) });
    expect((await other.findByTestId("oats-automations-gate")).textContent).toBe("Triggers need the OATS CLI`oats` could not be run (ENOENT)OATS_NOT_FOUND");
  });

  it("an OATS without the automations lists, as the server answers for one", async () => {
    const none = { ok: false as const, code: "OATS_NO_AUTOMATIONS", message: "OATS 0.28.0 has no automations lists: they need OATS 0.29 or later." };
    const slot = await page("triggers", { automations: () => ({ at: AT, hostId: "host_falcon", oats: { version: "0.28.0", features: ["schedule"], automationsApi: null }, schedule: none, trigger: none }) });
    expect((await slot.findByTestId("oats-automations-gate")).textContent).toBe("Triggers need OATS 0.29 or laterUpdate OATS to see the workspace's triggers and this computer's own, and where each one runs.OATS_NO_AUTOMATIONS");
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("the gate is the server's word: its code for an OATS without the lists, or for no oats, kept with its message; any other refusal is no gate", () => {
    const none = { code: "OATS_NO_AUTOMATIONS", message: "OATS 0.28.0 has no automations lists: they need OATS 0.29 or later." };
    expect(gateOf("schedule", none)).toEqual({ title: "Schedules need OATS 0.29 or later", detail: "Update OATS to see the workspace's schedules and this computer's own, and where each one runs.", code: "OATS_NO_AUTOMATIONS" });
    expect(gateOf("trigger", none)).toMatchObject({ title: "Triggers need OATS 0.29 or later" });
    expect(gateOf("trigger", { code: "OATS_NOT_FOUND", message: "oats was not found on falcon: install OATS there." })).toEqual({ title: "Triggers need the OATS CLI", detail: "oats was not found on falcon: install OATS there.", code: "OATS_NOT_FOUND" });
    expect(gateOf("schedule", { code: "E_SCHEDULE_INVALID", message: "x" })).toBeNull();
    expect(gateOf("schedule", null)).toBeNull();
  });


});

describe("a row's page", () => {
  it("a schedule's route opens its page; Back is the list's route", async () => {
    const slot = await page("schedules/local/daily-review");
    expect((await slot.findByTestId("oats-automation-identity")).textContent).toContain("local/daily-review");
    fireEvent.click(slot.getByTestId("oats-automation-back"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules" } }]);
    // A schedule has no recorded state of a trigger to read.
    expect(calls(slot)).toEqual(["automations"]);
  });

  it("a trigger's page reads that trigger's state once, and shows what fired, is live and waits", async () => {
    const slot = await page("triggers/oats-real/proposal-review");
    await waitFor(() => expect(slot.getByTestId("oats-automation-history-note").textContent).toBe("on this computer · 2 of 2 live now · 2 fired in all · 1 waiting"));
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "triggerStatus").map((call) => call.input)).toEqual([{ id: "oats-real/proposal-review" }]);
  });

  it("a state that cannot be read is said: a person's words, the kernel's message, its code after, Retry; the row's own last fire still shows", async () => {
    let fail = true;
    const slot = await page("triggers/oats-real/proposal-review", {
      triggerStatus: ({ id }) => {
        if (fail) throw new Error("OATS_TIMEOUT: `oats` did not answer within 20 s and was stopped");
        return statusOf(id);
      },
    });
    const notice = await slot.findByTestId("oats-automation-status-failed");
    expect(notice.textContent).toBe("This trigger's state could not be read`oats` did not answer within 20 s and was stoppedWhat is live and what waits is not known; the trigger's last fire, as the list has it, is below.OATS_TIMEOUTRetry");
    expect(within(notice).getByRole("alert")).toBeTruthy();
    expect(slot.getByTestId("oats-automation-history").textContent).toMatch(/#41 · opened · oats-developer-review-pr-41$/);
    // Retry reads it again.
    fail = false;
    fireEvent.click(slot.getByTestId("oats-automation-status-retry"));
    await waitFor(() => expect(slot.getByTestId("oats-automation-history-note").textContent).toBe("on this computer · 2 of 2 live now · 2 fired in all · 1 waiting"));
    expect(slot.queryByTestId("oats-automation-status-failed")).toBeNull();
  });

  it("a state read before stays, marked with its age, when a later read of it fails", async () => {
    let asked = 0;
    let reads = 0;
    const slot = await page("triggers/oats-real/proposal-review", {
      // Each read of the lists is another answer of the server.
      automations: () => ({ at: `2026-11-21T20:4${++reads}:00.000Z`, hostId: "host_falcon", oats: OATS, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }),
      triggerStatus: ({ id }) => {
        asked += 1;
        if (asked > 1) throw new Error("E_TRIGGER_FAILED: the trigger state cannot be read");
        return statusOf(id);
      },
    });
    await waitFor(() => expect(slot.getByTestId("oats-automation-history-note").textContent).toContain("2 of 2 live now"));
    // OATS changed: the lists are read again, and with them the state.
    await slot.behavior.emitRealtime("oats/changed", { at: "2026-11-21T20:50:00.000Z" });
    const notice = await slot.findByTestId("oats-automation-status-failed");
    expect(notice.textContent).toBe("This trigger's state could not be readthe trigger state cannot be readShowing what was read just now.E_TRIGGER_FAILEDRetry");
    expect(slot.getByTestId("oats-automation-history-note").textContent).toContain("2 of 2 live now");
  });



  it("a route to a row the list does not hold goes back to the list", async () => {
    const slot = await page("schedules/local/gone");
    await slot.findAllByTestId("oats-automation-row");
    await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules" } }]));
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
    await unlisted.findByTestId("oats-automation-when");
    await waitFor(() => expect(unlisted.inspection.rpcCalls.map((call) => call.method)).toContain("capabilities"));
    expect(unlisted.queryByTestId("oats-automation-open-capability")).toBeNull();
    resetApp();
    const twice = await page("triggers/oats-real/harvest-review", { capabilities: () => ({ capabilities: [1, 2].map(() => ({ id: "acme.graph", description: "", origin: "x", souls: 0 })) }) });
    await twice.findByTestId("oats-automation-when");
    await waitFor(() => expect(twice.inspection.rpcCalls.map((call) => call.method)).toContain("capabilities"));
    expect(twice.queryByTestId("oats-automation-open-capability")).toBeNull();
  });

  it("Open file of a member with no clone here opens its page on the web", async () => {
    const list = schedules();
    const web = "https://github.com/acme/agents/blob/0123abc/oats-schedules/nightly-digest.yaml";
    const rows = list.rows.map((row) => (row.id === "oats-real/nightly-digest" ? { ...row, origin: { ...row.origin, localPath: null, url: web } } : row));
    const slot = await page("schedules/oats-real/nightly-digest", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: true as const, list: { ...list, rows } }, trigger: { ok: true as const, list: triggers() } }) });
    fireEvent.click(await slot.findByTestId("oats-automation-open-file"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "openUrl", url: web }]);
  });

  it("Open file previews the definition from the machine that holds the deployment", async () => {
    const slot = await page("schedules/oats-real/nightly-digest");
    const button = (await slot.findByTestId("oats-automation-open-file")) as HTMLButtonElement;
    expect(button.title).toBe(schedules().rows.find((row) => row.id === "oats-real/nightly-digest")!.origin.localPath);
    fireEvent.click(button);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_falcon", path: "/abs/deployment/oats-real/oats-schedules/nightly-digest.yaml" }, location: null } },
    ]);
  });
});
