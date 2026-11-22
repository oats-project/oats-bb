// The recurring wake-up a spawn can ask for: its group of fields, in the Desktop's words
// (awebai/oats packages/desktop/renderer/wake-schedule-fields.mjs), and what a spawn form says
// once the kernel answered (views/spawn.mjs). The New agent form places the group and passes
// `wakeOf(draft)` to its spawn; the schedule form nests it under "Launch a new agent".
import { CUSTOM, repeatOf, WAKE_REPEATS } from "../../model/automations";
import type { WakeDraft } from "../../model/automations";
import type { WakeOutcome } from "../../kernel/automations-form";
import { Field, INPUT, Switch } from "../ui";
import { shown } from "../ui/text";

export const WAKE_HELP = "Uses this same agent home and sends the message through its terminal, without an interrupt. The host scheduler must be enabled for wake-ups to run.";
/** The time zone a new wake-up or schedule starts with: this browser's. */
export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The group "Recurring wake-up": off until its switch is on, then when, where and what to say. */
export function WakeFields({ value, onChange, disabled = false }: { value: WakeDraft; onChange: (next: WakeDraft) => void; disabled?: boolean }) {
  const set = (change: Partial<WakeDraft>) => onChange({ ...value, ...change });
  return (
    <fieldset data-testid="oats-wake-fields" className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">Recurring wake-up</legend>
      <Switch label="Wake this agent on a schedule" checked={value.enabled} disabled={disabled} onChange={(enabled) => set({ enabled })} />
      {value.enabled ? (
        <>
          <Field label="Repeat">
            <select className={INPUT} name="wake-repeat" disabled={disabled} value={repeatOf(value.cron, WAKE_REPEATS)} onChange={(event) => (event.target.value === CUSTOM ? undefined : set({ cron: event.target.value }))}>
              {WAKE_REPEATS.map(([cron, label]) => (
                <option key={cron} value={cron}>
                  {label}
                </option>
              ))}
              <option value={CUSTOM}>Custom cron</option>
            </select>
          </Field>
          <Field label="Cron expression">
            <input className={`${INPUT} font-mono`} name="wake-cron" autoComplete="off" disabled={disabled} value={value.cron} onChange={(event) => set({ cron: event.target.value })} />
          </Field>
          <Field label="Time zone">
            <input className={INPUT} name="wake-tz" autoComplete="off" disabled={disabled} value={value.tz} onChange={(event) => set({ tz: event.target.value })} />
          </Field>
          <Field label="Message on wake-up" hint={WAKE_HELP}>
            <textarea className={`${INPUT} py-2`} name="wake-message" rows={3} placeholder="Check your pending work and report anything that needs attention." disabled={disabled} value={value.message} onChange={(event) => set({ message: event.target.value })} />
          </Field>
        </>
      ) : null}
    </fieldset>
  );
}

/**
 * What a spawn form says of the wake-up it asked for, as the shared Notice takes it: the Desktop's
 * two sentences, the kernel's code and message after the one that did not save.
 */
export function wakeNotice(instance: string, outcome: WakeOutcome): { tone: "info" | "warning"; title: string; sentence: string; code: string | null; message: string | null } {
  const name = shown(instance);
  return outcome.saved
    ? { tone: "info", title: `Wake schedule saved for ${name}.`, sentence: "Check Schedules to verify its host scheduler is enabled.", code: null, message: null }
    : { tone: "warning", title: `Created ${name}, but its wake schedule was not saved.`, sentence: "Add it from Schedules.", code: outcome.code, message: outcome.message };
}
