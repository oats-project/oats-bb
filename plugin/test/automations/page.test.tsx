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
import { schedules, triggers } from "./fixtures";

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
    expect((await slot.findByTestId("oats-automations-gate")).textContent).toBe("Schedules need the OATS CLI");
    resetApp();
    const other = await page("triggers", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: refused, trigger: refused }) });
    expect((await other.findByTestId("oats-automations-gate")).textContent).toBe("Triggers need the OATS CLI");
  });

  it("an OATS without the automations lists, as the server answers for one", async () => {
    const none = { ok: false as const, code: "OATS_NO_AUTOMATIONS", message: "OATS 0.28.0 has no automations lists: they need OATS 0.29 or later." };
    const slot = await page("triggers", { automations: () => ({ at: AT, hostId: "host_falcon", oats: { version: "0.28.0", features: ["schedule"], automationsApi: null }, schedule: none, trigger: none }) });
    expect((await slot.findByTestId("oats-automations-gate")).textContent).toBe("Triggers need OATS 0.29 or laterUpdate OATS to see the workspace's triggers and this computer's own, and where each one runs.");
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("an OATS without the automations lists: the page says which OATS it needs and why to update", () => {
    const old = { version: "0.28.0", features: ["schedule"], automationsApi: null };
    expect(gateOf("schedule", null, old)).toEqual({ title: "Schedules need OATS 0.29 or later", detail: "Update OATS to see the workspace's schedules and this computer's own, and where each one runs." });
    expect(gateOf("trigger", null, old)).toMatchObject({ title: "Triggers need OATS 0.29 or later" });
    // The feature alone is not the contract: its api must be the one this page reads.
    expect(gateOf("schedule", null, { version: "9.0.0", features: ["automations"], automationsApi: 2 })).not.toBeNull();
    expect(gateOf("schedule", null, { version: "0.70.0", features: ["automations"], automationsApi: 1 })).toBeNull();
    expect(gateOf("schedule", null, null)).toBeNull();
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
    await waitFor(() => expect(slot.getByTestId("oats-automation-history").querySelector("h3")!.textContent).toBe("Recent fireson this computer · 2 of 2 live now · 2 fired in all · 1 waiting"));
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "triggerStatus").map((call) => call.input)).toEqual([{ id: "oats-real/proposal-review" }]);
  });

  it("when that read fails, the row's own last fire still shows", async () => {
    const slot = await page("triggers/oats-real/proposal-review", {
      triggerStatus: () => {
        throw new Error("E_TRIGGER_UNKNOWN: gone");
      },
    });
    const history = await slot.findByTestId("oats-automation-history");
    await waitFor(() => expect(calls(slot)).toContain("triggerStatus"));
    expect(history.textContent).toMatch(/^Recent fireson this computer.+#41 · opened · oats-developer-review-pr-41$/);
  });

  it("a route to a row the list does not hold goes back to the list", async () => {
    const slot = await page("schedules/local/gone");
    await slot.findAllByTestId("oats-automation-row");
    await waitFor(() => expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules" } }]));
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
