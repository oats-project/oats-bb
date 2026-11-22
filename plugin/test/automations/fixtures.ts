// The Automations fixtures (test/fixtures/automations/, recorded from the real kernel: its
// README), as the host entry reads them: an envelope's `result`, or the bare document.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AutomationList, AutomationRow, TriggerStatus } from "../../contract/automations";
import { parseScheduleList, parseTriggerList, parseTriggerStatus } from "../../kernel/automations";

// vitest runs from the package root, under node and under jsdom alike.
export const fixturePath = (name: string): string => resolve(process.cwd(), "test/fixtures/automations", name);

/** What the kernel printed, whole. */
export function recorded(name: string): { ok?: boolean; result?: unknown; error?: { code: string; message: string } } {
  return JSON.parse(readFileSync(fixturePath(name), "utf8"));
}
/** The answer a parser gets: the envelope's `result`. */
export const answer = (name: string): unknown => recorded(name).result;

export function schedules(name = "schedule-list.json"): AutomationList {
  const parsed = parseScheduleList(answer(name));
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}
export function triggers(name = "trigger-list.json"): AutomationList {
  const parsed = parseTriggerList(answer(name));
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}
export function rowOf(list: AutomationList, id: string): AutomationRow {
  const row = list.rows.find((entry) => entry.id === id);
  if (row === undefined) throw new Error(`no row ${id} in the ${list.kind} list (${list.rows.map((entry) => entry.id).join(", ")})`);
  return row;
}
export function statusOf(id: string, name = "trigger-status.json"): TriggerStatus {
  const row = rowOf(triggers(), id);
  const parsed = parseTriggerStatus(answer(name), id, row.on?.source ?? null);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}
