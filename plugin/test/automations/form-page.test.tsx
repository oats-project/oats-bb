// @vitest-environment jsdom
// Creating and editing a schedule from the Automations page (D-273, D-274, D-275, D-187) and the
// recurring wake-up group a spawn form places (D-255, D-264): the Desktop's fields and words, what
// a save sends, and what the kernel answered or refused, said where the person is.
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useState } from "react";
import { scheduleSpec } from "../../contract/automations";
import type { ScheduleDraft } from "../../contract/automations";
import { parseScheduleShow, scheduleDraftOf } from "../../kernel/automations-form";
import { newWake, wakeOf } from "../../model/automations";
import { fieldsOf, specOf } from "../../app/automations/Form";
import { WakeFields, wakeNotice } from "../../app/automations/wake";
import { handlers, loadApp, resetApp, sidebarThreads } from "../helpers/render";
import type { Contract, Handlers } from "../helpers/render";
import { AT, KEEPER_HOME, OATS, TARGETS } from "./handlers";
import { answer, rowOf, schedules, triggers } from "./fixtures";

afterEach(resetApp);

async function page(subPath = "", over: Partial<Handlers> = {}) {
  const app = await loadApp();
  const panel = app.navPanels.find((candidate) => candidate.id === "automations")!;
  return renderSlot<{ subPath: string }, Contract>(panel, { subPath }, { rpc: handlers(over), sidebarThreads: sidebarThreads() });
}
type Slot = Awaited<ReturnType<typeof page>>;
const calls = (slot: Slot, method: string) => slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
const saved = () => ({ row: rowOf(schedules(), "local/daily-review") });
const draftOf = (file: string, backends = ["tmux", "bb"]): ScheduleDraft => {
  const shown = parseScheduleShow(answer(file));
  if (!shown.ok) throw new Error("no schedule");
  return scheduleDraftOf(shown.value, backends)!;
};
/** The form, once it is open and has read what it chooses among. */
async function form(slot: Slot) {
  const dialog = await slot.findByRole("dialog");
  await waitFor(() => expect((within(dialog).getByTestId("oats-schedule-save") as HTMLButtonElement).disabled).toBe(false));
  const field = <Element extends HTMLElement = HTMLInputElement>(name: string) => dialog.querySelector<Element>(`[name="${name}"]`);
  const type = (name: string, value: string) => fireEvent.change(field(name)!, { target: { value } });
  const labels = () => Array.from(dialog.querySelectorAll("label")).map((label) => label.textContent);
  const options = (name: string) => Array.from(field<HTMLSelectElement>(name)!.options).map((option) => option.textContent);
  return { dialog, field, type, labels, options, save: () => fireEvent.click(within(dialog).getByTestId("oats-schedule-save")) };
}
async function newSchedule(over: Partial<Handlers> = {}, subPath = "") {
  const slot = await page(subPath, over);
  if (subPath === "") {
    // Offered once the Schedules list is read.
    await waitFor(() => expect((slot.getByTestId("oats-automations-new-schedule") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(slot.getByTestId("oats-automations-new-schedule"));
  }
  return { slot, ...(await form(slot)) };
}

describe("New schedule (D-273)", () => {
  it("opens the form with the Desktop's fields for waking an existing agent, the focus on Name", async () => {
    const { dialog, labels, options, field } = await newSchedule();
    expect(within(dialog).getByRole("heading").textContent).toBe("New schedule");
    expect(labels()).toEqual(["Name", "Summary · optional", "Action", "Agent home", "Wake message", "Repeat", "Cron expression", "Time zone"]);
    expect(options("kind")).toEqual(["Wake an existing agent", "Launch a new agent", "Run a provider operation"]);
    expect(options("home")).toEqual([`team-notes-keeper · ${KEEPER_HOME}`, "oats-developer-review-202611212017 · /abs/deployment/agents/oats-developer/instances/oats-developer-review-202611212017"]);
    expect(options("repeat")).toEqual(["Every 15 minutes", "Every 5 minutes", "Every 30 minutes", "Every hour", "Daily at 09:00", "Weekdays at 09:00", "Custom cron"]);
    expect([field("cron")!.value, field("id")!.placeholder, field<HTMLTextAreaElement>("task")!.placeholder]).toEqual(["*/15 * * * *", "daily-review", "What should the agent do each time?"]);
    expect(dialog.textContent).toContain("One line of up to 200 characters, shown in the list. Without one, the list shows the first line of the message or task.");
    expect(dialog.textContent).toContain("Minute, hour, day of month, month, day of week. Missed times are skipped. Wake messages use the agent’s terminal; no interrupts are sent.");
    expect(within(dialog).getByRole("switch", { name: /^Enabled/ }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(field("id"));
    // A wake of a bb agent says what the kernel does with one that is stopped.
    expect(dialog.textContent).toContain("A scheduled wake reaches this agent while it is running in bb. It does not start one that is stopped.");
  });

  it("a wake is saved as the kernel takes it: the name, and the definition whole", async () => {
    const { slot, type, save, field } = await newSchedule({ scheduleAdd: saved });
    type("id", "form-wake");
    type("description", "Ask the note keeper for news");
    type("task", "Anything to write down?\nSay what, then stop.");
    type("tz", "Europe/Madrid");
    save();
    await waitFor(() => expect(calls(slot, "scheduleAdd")).toHaveLength(1));
    // Exactly what the recording handed the real kernel.
    expect(calls(slot, "scheduleAdd")[0]).toEqual({ id: "form-wake", spec: { kind: "wake", cron: "*/15 * * * *", tz: "Europe/Madrid", enabled: true, description: "Ask the note keeper for news", home: KEEPER_HOME, message: "Anything to write down?\nSay what, then stop." } });
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(calls(slot, "refresh")).toHaveLength(1);
    expect(field("id")).toBeDefined();
  });

  it("a preset fills the cron, and a cron typed by hand is Custom cron", async () => {
    const { field, type } = await newSchedule();
    fireEvent.change(field<HTMLSelectElement>("repeat")!, { target: { value: "0 9 * * 1-5" } });
    expect(field("cron")!.value).toBe("0 9 * * 1-5");
    type("cron", "5 4 * * *");
    expect(field<HTMLSelectElement>("repeat")!.value).toBe("custom");
  });

  it("what is lacking is said at its field, the first takes the focus, and nothing is sent", async () => {
    const { slot, dialog, save, type, field } = await newSchedule();
    type("id", "Daily Review");
    type("cron", " ");
    save();
    await waitFor(() => expect(within(dialog).getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["A name is lower-case letters, digits and dashes, and starts with a letter or a digit.", "A wake message is needed.", "A cron expression is needed."]));
    expect(field("id")!.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(field("id")));
    expect(calls(slot, "scheduleAdd")).toEqual([]);
  });

  it("the kernel's refusal of one field is said at that field, with its code under the form, and the form stays", async () => {
    const { dialog, save, type, field } = await newSchedule({
      scheduleAdd: () => {
        throw new Error("E_SCHEDULE_INVALID: cron: five fields required (minute hour day month weekday)");
      },
    });
    type("id", "form-bad");
    type("task", "x");
    type("cron", "every day");
    save();
    const refused = await within(dialog).findByTestId("oats-schedule-refused");
    expect(refused.textContent).toBe("The schedule was not createdcron: five fields required (minute hour day month weekday)E_SCHEDULE_INVALID");
    expect(field("cron")!.getAttribute("aria-invalid")).toBe("true");
    expect((within(dialog).getByTestId("oats-schedule-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Cancel and Escape close it and send nothing; without the feature that writes summaries there is no Summary", async () => {
    const { slot, dialog } = await newSchedule();
    fireEvent.click(within(dialog).getByTestId("oats-schedule-cancel"));
    expect(slot.queryByRole("dialog")).toBeNull();
    fireEvent.click(slot.getByTestId("oats-automations-new-schedule"));
    fireEvent.keyDown(await slot.findByRole("dialog"), { key: "Escape" });
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(calls(slot, "scheduleAdd")).toEqual([]);
    resetApp();
    const old = await newSchedule({ automations: () => ({ at: AT, hostId: "host_falcon", oats: { ...OATS, features: ["automations"] }, schedule: { ok: true as const, list: schedules() }, trigger: { ok: true as const, list: triggers() } }) });
    expect(old.labels()).not.toContain("Summary · optional");
  });

  it("is not offered on Triggers, nor over a Schedules list that could not be read", async () => {
    const slot = await page("triggers");
    await slot.findAllByTestId("oats-automation-row");
    expect(slot.queryByTestId("oats-automations-new-schedule")).toBeNull();
    resetApp();
    const failed = await page("", { automations: () => ({ at: AT, hostId: "host_falcon", oats: OATS, schedule: { ok: false as const, code: "E_SCHEDULE_INVALID", message: "x" }, trigger: { ok: true as const, list: triggers() } }) });
    await failed.findByRole("alert");
    expect((failed.getByTestId("oats-automations-new-schedule") as HTMLButtonElement).disabled).toBe(true);
  });

  it("when what it chooses among cannot be read it says so, in the Desktop's sentence, and cannot be saved", async () => {
    const slot = await page("", {
      scheduleTargets: () => {
        throw new Error("the plugin's server is restarting");
      },
    });
    await waitFor(() => expect((slot.getByTestId("oats-automations-new-schedule") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(slot.getByTestId("oats-automations-new-schedule"));
    const dialog = await slot.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Could not read targets for this form. Reopen it to retry."));
    expect((within(dialog).getByTestId("oats-schedule-save") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("launching a new agent on a schedule (D-274)", () => {
  it("offers the soul, the task and the launch's own choices; on bb it runs in full mode, and says so", async () => {
    const { slot, dialog, type, field, labels, options, save } = await newSchedule({ scheduleAdd: saved });
    fireEvent.change(field<HTMLSelectElement>("kind")!, { target: { value: "spawn" } });
    await waitFor(() => expect(field<HTMLSelectElement>("backend")!.value).toBe("bb"));
    expect(labels()).toEqual(["Name", "Summary · optional", "Action", "Soul", "Task", "Purpose · optional", "Harness", "Model", "Session backend", "Permissions", "Repeat", "Cron expression", "Time zone"]);
    expect(options("agent")).toEqual(["oats-developer", "oats-product-expert", "note-keeper"]);
    expect(options("harness")).toEqual(["Soul default", "pi", "claude", "codex"]);
    expect(options("backend")).toEqual(["Soul default", "tmux", "bb"]);
    expect(options("yolo")).toEqual(["Soul / scope setting", "YOLO — skip permission prompts", "Native permission policy"]);
    expect([field<HTMLSelectElement>("yolo")!.value, field<HTMLSelectElement>("yolo")!.disabled]).toEqual(["true", true]);
    expect(dialog.textContent).toContain("Runs in bb's full mode: no sandbox.");
    expect(field("model")!.placeholder).toBe("Soul default");
    expect(calls(slot, "scheduleSoulBackends")).toEqual([{ soul: "oats-developer" }]);

    type("id", "form-spawn");
    type("task", "Look at the build queue.\nReport what is red.");
    type("purpose", "queue");
    fireEvent.change(field<HTMLSelectElement>("harness")!, { target: { value: "claude" } });
    type("model", "claude-sonnet");
    fireEvent.click(within(dialog).getByRole("switch", { name: /^Wake this agent on a schedule/ }));
    type("wake-message", "Anything red?");
    type("wake-cron", "*/30 * * * *");
    type("wake-tz", "Europe/Madrid");
    type("tz", "Europe/Madrid");
    fireEvent.click(within(dialog).getByRole("switch", { name: /^Enabled/ }));
    save();
    await waitFor(() => expect(calls(slot, "scheduleAdd")).toHaveLength(1));
    expect(calls(slot, "scheduleAdd")[0]).toEqual({
      id: "form-spawn",
      spec: { kind: "spawn", cron: "*/15 * * * *", tz: "Europe/Madrid", enabled: false, agent: "oats-developer", task: "Look at the build queue.\nReport what is red.", purpose: "queue", harness: "claude", model: "claude-sonnet", backend: "bb", yolo: true, wake: { cron: "*/30 * * * *", tz: "Europe/Madrid", message: "Anything red?" } },
    });
  });

  it("on tmux or the soul's default, Permissions is the person's choice; a wake-up that lacks a part is said and not sent", async () => {
    const { slot, dialog, type, field, save } = await newSchedule({ scheduleAdd: saved, scheduleSoulBackends: () => ({ backends: [] }) });
    fireEvent.change(field<HTMLSelectElement>("kind")!, { target: { value: "spawn" } });
    await waitFor(() => expect(calls(slot, "scheduleSoulBackends")).toHaveLength(1));
    expect(field<HTMLSelectElement>("backend")!.value).toBe("");
    expect(field<HTMLSelectElement>("yolo")!.disabled).toBe(false);
    expect(dialog.textContent).not.toContain("Runs in bb's full mode");
    type("id", "plain");
    type("task", "x");
    fireEvent.click(within(dialog).getByRole("switch", { name: /^Wake this agent on a schedule/ }));
    save();
    expect((await within(dialog).findByTestId("oats-schedule-wake-error")).textContent).toBe("Specify the wake schedule, time zone, and message");
    expect(calls(slot, "scheduleAdd")).toEqual([]);
    fireEvent.click(within(dialog).getByRole("switch", { name: /^Wake this agent on a schedule/ }));
    fireEvent.change(field<HTMLSelectElement>("yolo")!, { target: { value: "false" } });
    save();
    await waitFor(() => expect(calls(slot, "scheduleAdd")).toHaveLength(1));
    expect(calls(slot, "scheduleAdd")[0]).toMatchObject({ id: "plain", spec: { kind: "spawn", agent: "oats-developer", task: "x", yolo: false } });
    expect(Object.keys((calls(slot, "scheduleAdd")[0] as { spec: object }).spec)).not.toContain("backend");
  });
});

describe("running a provider operation on a schedule (D-273)", () => {
  it("offers the operations of the chosen home, and says where they are resolved", async () => {
    const { slot, dialog, type, field, labels, options, save } = await newSchedule({ scheduleAdd: saved });
    fireEvent.change(field<HTMLSelectElement>("kind")!, { target: { value: "operation" } });
    await waitFor(() => expect(options("providerOperation")).toEqual(["knowledge: checkpoint — Record this instance's checkpoint"]));
    expect(labels()).toEqual(["Name", "Summary · optional", "Action", "Agent home", "Provider operation", "Repeat", "Cron expression", "Time zone"]);
    expect(dialog.textContent).toContain("Resolved through this home's active provider at each run.");
    expect(calls(slot, "scheduleHomeOperations")).toEqual([{ home: KEEPER_HOME }]);
    type("id", "form-operation");
    type("cron", "0 * * * *");
    type("tz", "UTC");
    save();
    await waitFor(() => expect(calls(slot, "scheduleAdd")).toEqual([{ id: "form-operation", spec: { kind: "operation", cron: "0 * * * *", tz: "UTC", enabled: true, home: KEEPER_HOME, operation: "knowledge:checkpoint" } }]));
  });

  it("a home with none says so and cannot be saved for it; a home whose operations cannot be read says the kernel's words", async () => {
    const { dialog, type, field, save } = await newSchedule({ scheduleHomeOperations: () => ({ operations: [] }) });
    fireEvent.change(field<HTMLSelectElement>("kind")!, { target: { value: "operation" } });
    await waitFor(() => expect(dialog.textContent).toContain("No available provider actions for this home."));
    type("id", "none");
    save();
    await waitFor(() => expect(within(dialog).getAllByRole("alert").map((alert) => alert.textContent)).toContain("Select an available provider operation"));
    resetApp();
    const failed = await newSchedule({
      scheduleHomeOperations: () => {
        throw new Error("E_INSPECT_FAILED: the home cannot be inspected");
      },
    });
    fireEvent.change(failed.field<HTMLSelectElement>("kind")!, { target: { value: "operation" } });
    await waitFor(() => expect(failed.dialog.textContent).toContain("E_INSPECT_FAILED: the home cannot be inspected"));
  });
});

describe("Edit (D-275)", () => {
  it("opens the same form on the stored definition, named for the schedule, its name fixed and the focus on the cron", async () => {
    const draft = draftOf("schedule-show.json");
    const slot = await page("", { scheduleDraft: () => ({ draft }), scheduleUpdate: saved });
    fireEvent.click(within((await slot.findAllByTestId("oats-automation-row")).find((row) => row.dataset.id === "local/daily-review")!).getByRole("button", { name: "Actions for local/daily-review" }));
    fireEvent.click(slot.getAllByRole("menuitem").find((item) => item.textContent === "Edit")!);
    const { dialog, field, type, save } = await form(slot);
    expect(calls(slot, "scheduleDraft")).toEqual([{ id: "local/daily-review" }]);
    expect(within(dialog).getByRole("heading").textContent).toBe("Edit daily-review");
    expect([field("id")!.value, field("id")!.disabled]).toEqual(["daily-review", true]);
    expect(document.activeElement).toBe(field("cron"));
    expect([field<HTMLSelectElement>("kind")!.value, field<HTMLSelectElement>("agent")!.value, field<HTMLSelectElement>("backend")!.value, field<HTMLSelectElement>("repeat")!.value, field("purpose")!.value]).toEqual(["spawn", "oats-developer", "bb", "0 9 * * 1-5", "review"]);
    expect(field<HTMLTextAreaElement>("task")!.value).toBe("Review the open pull requests.\nReport what blocks each.");
    expect(field<HTMLTextAreaElement>("wake-message")!.value).toBe("Anything new on your review?");
    type("cron", "0 8 * * 1-5");
    save();
    await waitFor(() => expect(calls(slot, "scheduleUpdate")).toHaveLength(1));
    // What was not touched is sent as it was stored.
    expect(calls(slot, "scheduleUpdate")[0]).toEqual({ id: "daily-review", spec: { ...draft.spec, cron: "0 8 * * 1-5" } });
    expect(scheduleSpec.safeParse((calls(slot, "scheduleUpdate")[0] as { spec: unknown }).spec).success).toBe(true);
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("a schedule with settings the form cannot keep says so, in the Desktop's sentence, and opens no form", async () => {
    const slot = await page("schedules/local/status-check", { scheduleDraft: () => ({ draft: null }) });
    fireEvent.click(await slot.findByTestId("oats-automation-edit"));
    expect((await slot.findByTestId("oats-automations-result")).textContent).toBe("status-check carries settings this editor cannot keep; edit it with the CLI.Dismiss");
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("is offered for a local schedule only; a stored repo and agents root are kept while the soul is the same", async () => {
    const slot = await page("schedules/oats-real/nightly-digest");
    await slot.findByTestId("oats-automation-test-button");
    expect(slot.queryByTestId("oats-automation-edit")).toBeNull();
    const original = { kind: "spawn" as const, cron: "0 9 * * *", tz: "UTC", enabled: true, agent: "dev", repo: "/ws", agentsRoot: "/ws/agents", task: "t" };
    const fields = fieldsOf({ mode: "edit", draft: { id: "nightly", spec: original } }, "UTC");
    expect(specOf(fields, { summaries: true, original })).toEqual({ ok: true, spec: original });
    expect(specOf({ ...fields, agent: "other" }, { summaries: true, original })).toEqual({ ok: true, spec: { kind: "spawn", cron: "0 9 * * *", tz: "UTC", enabled: true, agent: "other", task: "t" } });
    // An OATS without summaries: the stored label is kept, never edited.
    expect(specOf(fieldsOf({ mode: "edit", draft: { id: "n", spec: { ...original, description: "Kept" } } }, "UTC"), { summaries: false, original: { ...original, description: "Kept" } })).toMatchObject({ ok: true, spec: { description: "Kept" } });
  });
});

describe("Schedule… on a soul (D-187)", () => {
  it("the route opens the form to launch that soul, and closing it leaves the Schedules list", async () => {
    const { slot, dialog, field } = await newSchedule({}, "schedules/+new/oats-product-expert");
    expect(within(dialog).getByRole("heading").textContent).toBe("New schedule");
    expect([field<HTMLSelectElement>("kind")!.value, field<HTMLSelectElement>("agent")!.value]).toEqual(["spawn", "oats-product-expert"]);
    expect(await slot.findAllByTestId("oats-automation-row")).toHaveLength(11);
    fireEvent.click(within(dialog).getByTestId("oats-schedule-cancel"));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toPluginPanel", path: "automations", options: { subPath: "schedules" } }]);
  });

  it("openScheduleForm and openSchedules name those routes", async () => {
    const { openScheduleForm, openSchedules } = await import("../../app/automations");
    const went: unknown[] = [];
    const navigate = { toPluginPanel: (path: string, options: { subPath: string }) => void went.push([path, options.subPath]) };
    openScheduleForm(navigate, { soul: "oats-developer", repo: null, agentsRoot: null });
    openSchedules(navigate);
    expect(went).toEqual([["automations", "schedules/+new/oats-developer"], ["automations", "schedules"]]);
  });
});

describe("the recurring wake-up group a spawn form places (D-255, D-264)", () => {
  function Group() {
    const [value, setValue] = useState(() => newWake("Europe/Madrid"));
    return (
      <>
        <WakeFields value={value} onChange={setValue} />
        <output data-testid="asked">{JSON.stringify(wakeOf(value))}</output>
      </>
    );
  }

  it("is off until asked for, then has the Desktop's fields, words and presets", () => {
    const view = render(<Group />);
    const group = view.getByRole("group", { name: "Recurring wake-up" });
    expect(Array.from(group.querySelectorAll("label")).map((label) => label.textContent)).toEqual([]);
    expect(view.getByTestId("asked").textContent).toBe('{"ok":true}');
    fireEvent.click(within(group).getByRole("switch", { name: /^Wake this agent on a schedule/ }));
    expect(Array.from(group.querySelectorAll("label")).map((label) => label.textContent)).toEqual(["Repeat", "Cron expression", "Time zone", "Message on wake-up"]);
    expect(Array.from(group.querySelector<HTMLSelectElement>('[name="wake-repeat"]')!.options).map((option) => option.textContent)).toEqual(["Every 5 minutes", "Every 15 minutes", "Every 30 minutes", "Every hour", "Custom cron"]);
    expect([group.querySelector<HTMLInputElement>('[name="wake-cron"]')!.value, group.querySelector<HTMLInputElement>('[name="wake-tz"]')!.value, group.querySelector<HTMLTextAreaElement>('[name="wake-message"]')!.placeholder]).toEqual(["*/15 * * * *", "Europe/Madrid", "Check your pending work and report anything that needs attention."]);
    expect(group.textContent).toContain("Uses this same agent home and sends the message through its terminal, without an interrupt. The host scheduler must be enabled for wake-ups to run.");
    expect(view.getByTestId("asked").textContent).toBe('{"ok":false,"error":"Specify the wake schedule, time zone, and message"}');
    fireEvent.change(group.querySelector('[name="wake-message"]')!, { target: { value: "Look." } });
    fireEvent.change(group.querySelector('[name="wake-repeat"]')!, { target: { value: "0 * * * *" } });
    expect(view.getByTestId("asked").textContent).toBe('{"ok":true,"wake":{"cron":"0 * * * *","tz":"Europe/Madrid","message":"Look.","enabled":true}}');
    view.unmount();
  });

  it("what a spawn form says once the kernel answered: the Desktop's two sentences, the kernel's code after the one that did not save", () => {
    expect(wakeNotice("review-developer", { saved: true, id: "wake-review-developer", code: null, message: null })).toEqual({ tone: "info", title: "Wake schedule saved for review-developer.", sentence: "Check Schedules to verify its host scheduler is enabled.", code: null, message: null });
    expect(wakeNotice("review-developer", { saved: false, id: null, code: "E_SCHEDULE_INVALID", message: "cron: five fields required" })).toEqual({ tone: "warning", title: "Created review-developer, but its wake schedule was not saved.", sentence: "Add it from Schedules.", code: "E_SCHEDULE_INVALID", message: "cron: five fields required" });
  });
});
