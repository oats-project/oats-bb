// The schedule form: New schedule and Edit <id>, for OATS's own local schedules. Its fields, its
// words and what it sends are the Desktop's (awebai/oats packages/desktop/renderer/views/
// schedules.mjs FORM at a4a43220): one of three actions (wake an existing agent, launch a new
// agent, run a provider operation), when, and the extra choices of a launch. The definition goes
// to the kernel whole (`oats schedule add|update --spec-json`); what Edit starts from is the
// kernel's own stored definition, and only one the form can keep whole.
//
// What is the plugin's own, each said in plugin/WORDS.md: Session backend offers the session
// providers the kernel lists for the chosen soul (bb), and starts on bb where it is offered; a job
// on bb runs in bb's full mode, so Permissions is set for it; and a wake of a bb agent says what
// the kernel does with one that is stopped.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { SCHEDULE_NAME } from "../../contract/automations";
import type { AutomationRow, HomeOperation, ScheduleDraft, ScheduleSpec, ScheduleTargets } from "../../contract/automations";
import { CUSTOM, DEFAULT_CRON, DESCRIPTION_MAX, descriptionValid, HARNESSES, newWake, repeatOf, REPEATS, wakeOf } from "../../model/automations";
import type { WakeDraft } from "../../model/automations";
import { attempt, errorMessage } from "../store";
import type { Rpc } from "../store";
import { Button, Field, INPUT, Lines, Loading, Modal, Notice, Switch } from "../ui";
import { shown } from "../ui/text";
import { browserZone, WakeFields } from "./wake";
import { refusalParts } from "./words";

type Kind = ScheduleSpec["kind"];
/** How the form opens: a new schedule (for a soul, where Schedule… on a soul asked), or a stored one. */
export type FormOpen = { mode: "new"; soul: string | null } | { mode: "edit"; draft: ScheduleDraft };
/** The form's fields, as typed. */
export type FormFields = {
  id: string;
  description: string;
  kind: Kind;
  agent: string;
  home: string;
  operation: string;
  task: string;
  purpose: string;
  harness: string;
  model: string;
  backend: string;
  yolo: "" | "true" | "false";
  wake: WakeDraft;
  cron: string;
  tz: string;
  enabled: boolean;
};
type FieldName = "id" | "description" | "agent" | "home" | "operation" | "task" | "cron" | "tz" | "wake";

export const ACTIONS: readonly (readonly [Kind, string])[] = [
  ["wake", "Wake an existing agent"],
  ["spawn", "Launch a new agent"],
  ["operation", "Run a provider operation"],
];
export const SUMMARY_HINT = `One line of up to ${DESCRIPTION_MAX} characters, shown in the list. Without one, the list shows the first line of the message or task.`;
export const CRON_HINT = "Minute, hour, day of month, month, day of week. Missed times are skipped. Wake messages use the agent’s terminal; no interrupts are sent.";
export const TARGETS_UNREAD = "Could not read targets for this form. Reopen it to retry.";
export const BB_FULL_MODE = "Runs in bb's full mode: no sandbox.";
export const BB_WAKE = "A scheduled wake reaches this agent while it is running in bb. It does not start one that is stopped.";
/** A local schedule the form cannot keep whole (the Desktop's sentence). */
export const cannotKeep = (name: string): string => `${name} carries settings this editor cannot keep; edit it with the CLI.`;

/** The fields a form opens with. */
export function fieldsOf(open: FormOpen, tz: string): FormFields {
  const blank: FormFields = { id: "", description: "", kind: "wake", agent: "", home: "", operation: "", task: "", purpose: "", harness: "", model: "", backend: "", yolo: "", wake: newWake(tz), cron: DEFAULT_CRON, tz, enabled: true };
  if (open.mode === "new") return open.soul === null ? blank : { ...blank, kind: "spawn", agent: open.soul };
  const { id, spec } = open.draft;
  const when = { ...blank, id, description: spec.description ?? "", kind: spec.kind, cron: spec.cron, tz: spec.tz, enabled: spec.enabled };
  if (spec.kind === "wake") return { ...when, home: spec.home, task: spec.message };
  if (spec.kind === "operation") return { ...when, home: spec.home, operation: spec.operation };
  return {
    ...when,
    agent: spec.agent,
    task: spec.task,
    purpose: spec.purpose ?? "",
    harness: spec.harness ?? "",
    model: spec.model ?? "",
    backend: spec.backend ?? "",
    yolo: spec.yolo === undefined ? "" : spec.yolo ? "true" : "false",
    wake: spec.wake === undefined ? newWake(tz) : { enabled: true, ...spec.wake },
  };
}

/**
 * The definition a save sends, or what the form lacks, by field. A launch on bb is sent with
 * `yolo: true` (bb's full mode is the only one the bb backend launches in). Editing keeps what the
 * form does not show: the stored `repo` and `agentsRoot` of a job whose soul was not changed.
 */
export function specOf(fields: FormFields, { summaries, original }: { summaries: boolean; original: ScheduleSpec | null }): { ok: true; spec: ScheduleSpec } | { ok: false; errors: Partial<Record<FieldName, string>> } {
  const errors: Partial<Record<FieldName, string>> = {};
  const cron = fields.cron.trim();
  const tz = fields.tz.trim();
  if (cron === "") errors.cron = "A cron expression is needed.";
  if (tz === "") errors.tz = "A time zone is needed.";
  const when: { cron: string; tz: string; enabled: boolean; description?: string } = { cron, tz, enabled: fields.enabled };
  if (summaries) {
    // Sent as typed: empty leaves the definition without one, which removes it.
    if (fields.description !== "" && !descriptionValid(fields.description)) errors.description = `Summary: one line of up to ${DESCRIPTION_MAX} characters, without control characters`;
    if (fields.description !== "") when.description = fields.description;
  } else if (original?.description !== undefined) when.description = original.description; // an OATS without summaries: the label is kept
  let spec: ScheduleSpec;
  if (fields.kind === "spawn") {
    if (fields.agent === "") errors.agent = "Choose a soul.";
    if (fields.task.trim() === "") errors.task = "A task is needed.";
    const wake = wakeOf(fields.wake);
    if (!wake.ok) errors.wake = wake.error;
    const kept = original?.kind === "spawn" && original.agent === fields.agent ? { ...(original.repo === undefined ? {} : { repo: original.repo }), ...(original.agentsRoot === undefined ? {} : { agentsRoot: original.agentsRoot }) } : {};
    const yolo = fields.backend === "bb" ? true : fields.yolo === "" ? undefined : fields.yolo === "true";
    spec = {
      kind: "spawn",
      ...when,
      agent: fields.agent,
      ...kept,
      task: fields.task,
      ...(fields.purpose === "" ? {} : { purpose: fields.purpose }),
      ...(fields.harness === "" ? {} : { harness: fields.harness }),
      ...(fields.model === "" ? {} : { model: fields.model }),
      ...(fields.backend === "" ? {} : { backend: fields.backend }),
      ...(yolo === undefined ? {} : { yolo }),
      ...(wake.ok && wake.wake !== undefined ? { wake: { cron: wake.wake.cron, tz: wake.wake.tz, message: wake.wake.message } } : {}),
    };
  } else {
    if (fields.home === "") errors.home = "Choose an agent home.";
    if (fields.kind === "wake") {
      if (fields.task.trim() === "") errors.task = "A wake message is needed.";
      spec = { kind: "wake", ...when, home: fields.home, message: fields.task };
    } else {
      if (fields.operation === "") errors.operation = "Select an available provider operation";
      spec = { kind: "operation", ...when, home: fields.home, operation: fields.operation };
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, spec };
}

/** The field a kernel refusal is about, where its message leads with one (`cron: five fields required…`). */
const FIELD_OF: Record<string, FieldName> = { cron: "cron", tz: "tz", home: "home", agent: "agent", task: "task", message: "task", operation: "operation", description: "description", id: "id" };
export function refusedField(message: string): FieldName | null {
  const lead = /^([a-z]+): /.exec(message);
  return lead === null ? null : (FIELD_OF[lead[1]!] ?? null);
}

export function ScheduleForm({ open, rpc, summaries, onSaved, onClose }: { open: FormOpen; rpc: Rpc; /** This OATS writes summaries (feature automation-descriptions). */ summaries: boolean; onSaved: (row: AutomationRow) => void; onClose: () => void }) {
  const editing = open.mode === "edit" ? open.draft : null;
  const [fields, setFields] = useState<FormFields>(() => fieldsOf(open, browserZone()));
  const set = (change: Partial<FormFields>) => setFields((before) => ({ ...before, ...change }));
  const [targets, setTargets] = useState<ScheduleTargets | "unread" | null>(null);
  const [backends, setBackends] = useState<readonly string[]>([]);
  const [operations, setOperations] = useState<{ home: string; list: HomeOperation[] | null; error: string | null }>({ home: "", list: null, error: null });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [refusal, setRefusal] = useState<{ code: string | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // What the form chooses among: the souls and the homes of this deployment, read once when it opens.
  useEffect(() => {
    attempt(() => rpc.call("scheduleTargets", null)).then(
      (answer) => {
        if (!alive.current) return;
        setTargets(answer);
        // A new schedule starts on the first home and the first soul, as a select does.
        setFields((before) => ({ ...before, home: before.home !== "" ? before.home : (answer.homes[0]?.home ?? ""), agent: before.agent !== "" ? before.agent : (answer.souls.find((soul) => soul.spawnable)?.key ?? "") }));
      },
      () => {
        if (alive.current) setTargets("unread");
      },
    );
  }, [rpc]);
  const ready = targets !== null && targets !== "unread";
  const souls = ready ? targets.souls.filter((soul) => soul.spawnable || soul.key === fields.agent) : [];
  const homes = ready ? targets.homes : [];
  const home = homes.find((entry) => entry.home === fields.home) ?? null;

  // The session backends the chosen soul can launch on, beside tmux. A new launch starts on bb where the kernel offers it.
  const { kind, agent } = fields;
  useEffect(() => {
    if (kind !== "spawn" || agent === "") return;
    let current = true;
    setBackends([]);
    attempt(() => rpc.call("scheduleSoulBackends", { soul: agent })).then(
      (answer) => {
        if (!current || !alive.current) return;
        setBackends(answer.backends);
        if (editing === null && answer.backends.includes("bb")) setFields((before) => (before.backend === "" ? { ...before, backend: "bb" } : before));
      },
      () => undefined, // tmux and the soul's default stay offered; the kernel judges the save
    );
    return () => {
      current = false;
    };
  }, [rpc, kind, agent, editing]);

  // The operations a schedule can run in the chosen home.
  const chosenHome = fields.home;
  useEffect(() => {
    if (kind !== "operation" || chosenHome === "") return;
    let current = true;
    setOperations({ home: chosenHome, list: null, error: null });
    attempt(() => rpc.call("scheduleHomeOperations", { home: chosenHome })).then(
      (answer) => {
        if (!current || !alive.current) return;
        setOperations({ home: chosenHome, list: answer.operations, error: null });
        setFields((before) => (answer.operations.some((operation) => operation.address === before.operation) ? before : { ...before, operation: answer.operations[0]?.address ?? "" }));
      },
      (error: unknown) => {
        if (current && alive.current) setOperations({ home: chosenHome, list: [], error: errorMessage(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [rpc, kind, chosenHome]);

  // While it saves, its controls are off: the focus is put on the dialog, so Tab stays inside it.
  useEffect(() => {
    if (saving) form.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  }, [saving]);

  const save = async () => {
    if (saving || !ready) return;
    const name = fields.id.trim();
    const made = specOf(fields, { summaries, original: editing?.spec ?? null });
    const lacking: Partial<Record<FieldName, string>> = made.ok ? {} : { ...made.errors };
    if (editing === null && !SCHEDULE_NAME.test(name)) lacking.id = "A name is lower-case letters, digits and dashes, and starts with a letter or a digit.";
    setErrors(lacking);
    setRefusal(null);
    if (!made.ok || Object.keys(lacking).length > 0) {
      // The first field that lacks something takes the focus.
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      const { row } = await attempt(() => (editing === null ? rpc.call("scheduleAdd", { id: name, spec: made.spec }) : rpc.call("scheduleUpdate", { id: editing.id, spec: made.spec })));
      if (alive.current) onSaved(row);
    } catch (error) {
      if (!alive.current) return;
      const parts = refusalParts(errorMessage(error));
      const field = refusedField(parts.message);
      // The kernel's refusal of one field is said at that field, with its code under the form.
      if (field !== null) setErrors({ [field]: parts.message });
      setRefusal(parts);
      setSaving(false);
    }
  };

  const off = saving;
  const onBb = fields.kind === "spawn" && fields.backend === "bb";
  const select = (name: string, value: string, onChange: (value: string) => void, options: readonly (readonly [string, string])[], disabled = off): ReactElement<{ id?: string }> => (
    <select className={INPUT} name={name} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([option, label]) => (
        <option key={option} value={option}>
          {label}
        </option>
      ))}
    </select>
  );
  const operationNote =
    operations.list === null
      ? "Loading operations for this home…"
      : operations.error !== null
        ? shown(operations.error)
        : operations.list.length > 0
          ? "Resolved through this home's active provider at each run."
          : "No available provider actions for this home.";
  const backendOptions: (readonly [string, string])[] = [["", "Soul default"], ["tmux", "tmux"], ...backends.map((name) => [name, name] as const)];
  if (fields.backend !== "" && !backendOptions.some(([value]) => value === fields.backend)) backendOptions.push([fields.backend, fields.backend]);

  return (
    <Modal
      title={editing === null ? "New schedule" : `Edit ${shown(editing.id)}`}
      onCancel={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <Button data-testid="oats-schedule-cancel" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="oats-schedule-save" variant="primary" disabled={saving || !ready} onClick={() => void save()}>
            Save schedule
          </Button>
        </>
      }
    >
      <form
        ref={form}
        data-testid="oats-schedule-form"
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name" error={errors.id ?? null}>
          <input className={`${INPUT} font-mono`} name="id" autoComplete="off" placeholder="daily-review" {...(editing === null ? { "data-autofocus": "" } : {})} disabled={off || editing !== null} value={fields.id} onChange={(event) => set({ id: event.target.value })} />
        </Field>
        {summaries ? (
          <Field label="Summary" optional hint={SUMMARY_HINT} error={errors.description ?? null}>
            <input className={INPUT} name="description" autoComplete="off" disabled={off} value={fields.description} onChange={(event) => set({ description: event.target.value })} />
          </Field>
        ) : null}
        <Field label="Action">{select("kind", fields.kind, (value) => set({ kind: value as Kind }), ACTIONS)}</Field>
        {targets === "unread" ? (
          <Notice tone="error" title={TARGETS_UNREAD} />
        ) : !ready ? (
          <Loading>Reading this deployment's souls and agents…</Loading>
        ) : fields.kind === "spawn" ? (
          <Field label="Soul" error={errors.agent ?? null}>
            {select(
              "agent",
              fields.agent,
              (value) => set({ agent: value, backend: "" }),
              souls.map((soul) => [soul.key, shown(soul.key)] as const),
            )}
          </Field>
        ) : (
          <Field label="Agent home" hint={fields.kind === "wake" && home?.backend === "bb" ? BB_WAKE : undefined} error={errors.home ?? null}>
            {select(
              "home",
              fields.home,
              (value) => set({ home: value }),
              homes.map((entry) => [entry.home, `${shown(entry.instance)} · ${shown(entry.home)}`] as const),
            )}
          </Field>
        )}
        {fields.kind === "operation" && ready ? (
          <Field label="Provider operation" hint={operationNote} error={errors.operation ?? null}>
            {select(
              "providerOperation",
              fields.operation,
              (value) => set({ operation: value }),
              (operations.list ?? []).map((operation) => [operation.address, shown(operation.label)] as const),
              off || operations.list === null,
            )}
          </Field>
        ) : null}
        {fields.kind === "operation" ? null : (
          <Field label={fields.kind === "wake" ? "Wake message" : "Task"} error={errors.task ?? null}>
            <textarea className={`${INPUT} py-2`} name="task" rows={4} placeholder="What should the agent do each time?" disabled={off} value={fields.task} onChange={(event) => set({ task: event.target.value })} />
          </Field>
        )}
        {fields.kind === "spawn" ? (
          <div data-testid="oats-schedule-spawn-options" className="flex flex-col gap-3">
            <Field label="Purpose" optional hint="The instance's name starts with it.">
              <input className={INPUT} name="purpose" autoComplete="off" disabled={off} value={fields.purpose} onChange={(event) => set({ purpose: event.target.value })} />
            </Field>
            <div className="grid gap-3 @md:grid-cols-2">
              <Field label="Harness">{select("harness", fields.harness, (value) => set({ harness: value }), [["", "Soul default"], ...HARNESSES.map((name) => [name, name] as const)])}</Field>
              <Field label="Model">
                <input className={INPUT} name="model" autoComplete="off" placeholder="Soul default" disabled={off} value={fields.model} onChange={(event) => set({ model: event.target.value })} />
              </Field>
            </div>
            <div className="grid gap-3 @md:grid-cols-2">
              <Field label="Session backend">{select("backend", fields.backend, (value) => set({ backend: value }), backendOptions)}</Field>
              <Field label="Permissions" hint={onBb ? BB_FULL_MODE : undefined}>
                {select("yolo", onBb ? "true" : fields.yolo, (value) => set({ yolo: value as FormFields["yolo"] }), [["", "Soul / scope setting"], ["true", "YOLO — skip permission prompts"], ["false", "Native permission policy"]], off || onBb)}
              </Field>
            </div>
            <WakeFields value={fields.wake} onChange={(wake) => set({ wake })} disabled={off} />
            {errors.wake === undefined ? null : (
              <p role="alert" data-testid="oats-schedule-wake-error" className="text-xs text-destructive-text">
                {errors.wake}
              </p>
            )}
          </div>
        ) : null}
        <Field label="Repeat">{select("repeat", repeatOf(fields.cron, REPEATS), (value) => (value === CUSTOM ? undefined : set({ cron: value })), [...REPEATS, [CUSTOM, "Custom cron"]])}</Field>
        <div className="grid gap-3 @md:grid-cols-2">
          <Field label="Cron expression" hint={CRON_HINT} error={errors.cron ?? null}>
            <input className={`${INPUT} font-mono`} name="cron" autoComplete="off" {...(editing === null ? {} : { "data-autofocus": "" })} disabled={off} value={fields.cron} onChange={(event) => set({ cron: event.target.value })} />
          </Field>
          <Field label="Time zone" error={errors.tz ?? null}>
            <input className={INPUT} name="tz" autoComplete="off" placeholder="America/Toronto" disabled={off} value={fields.tz} onChange={(event) => set({ tz: event.target.value })} />
          </Field>
        </div>
        <Switch label="Enabled" checked={fields.enabled} disabled={off} onChange={(enabled) => set({ enabled })} />
        {saving ? <Loading>Saving the schedule…</Loading> : null}
        {refusal === null ? null : (
          <div data-testid="oats-schedule-refused">
            <Notice tone="error" title={editing === null ? "The schedule was not created" : "The schedule was not saved"} code={refusal.code}>
              <p>
                <Lines text={refusal.message} />
              </p>
            </Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
