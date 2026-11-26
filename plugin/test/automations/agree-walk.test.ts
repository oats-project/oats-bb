// THE WALK. One question, asked of every state there is and not of the ones somebody thought of:
//   is there a state in which a row, the filter's count and the sidebar's dot do not say the same?
// A state is what was read, in order: at each of three reads, each of the three answers (the schedules, the triggers,
// every trigger's state) is read (one of two recorded contents) or REFUSED, or the server says this OATS has no lists
// at all: so every read is, somewhere in the walk, ok, refused at first, refused after a good read, and mended after a
// refusal, beside every state of the other two; and at the end the roster is not read, has an agent that asks, or has
// none that asks.
// The ORACLE is the kept copy: what the page shows and what the dots say are both computed from it at the draw
// (app/automations/read.ts `keptAfter`, `marksFor`; the list's own functions `oneList`, `attention`, `filterList`,
// `rowLine` in words.ts). The page keeps no copy and the mark no verdict, so the page being open, closed or opened
// again changes nothing here: the slots' own test (agree.test.tsx) holds that the two do read the one copy.
import { describe, expect, it } from "vitest";
import { askingOf, keptAfter, marksFor } from "../../app/automations/read";
import type { Kept } from "../../app/automations/read";
import { attention, filterList, oneList, rowLine, statusFor } from "../../app/automations/words";
import { NO_AUTOMATIONS } from "../../contract/automations";
import type { AutomationList, TriggerStatuses } from "../../contract/automations";
import { fixtureAgents } from "../helpers/fixtures";
import { schedules, triggers } from "./fixtures";
import { STATUSES } from "./handlers";

const NOW = Date.parse("2026-11-21T22:00:00.000Z");
const ASKER = "release-070-maintainer";
const withoutFailing = <List extends AutomationList>(list: List): List => ({ ...list, rows: list.rows.filter((row) => !["local/hourly-check", "local/legacy-herdr", "oats-real/reconcile", "oats-real/release-check", "oats-real/harvest-closed"].includes(row.id)) });
// Two recorded contents of each answer, chosen so that each can alone make a dot: a failing row and a row whose run's
// agent is the one that asks, or neither.
const SCHEDULES: AutomationList[] = [
  { ...schedules(), rows: schedules().rows.map((row) => (row.id === "local/daily-review" ? { ...row, recentRuns: row.recentRuns.map((run) => ({ ...run, instance: ASKER })) } : row)) }, // failing rows, and a run of the asker
  withoutFailing(schedules()), // calm
];
const TRIGGERS: AutomationList[] = [
  triggers(), // one fails by its row alone (a source's check that failed)
  withoutFailing(triggers("trigger-list-poll-failed.json")), // calm by its rows: a failing poll is in the state only
];
const STATES: TriggerStatuses[] = [
  STATUSES().statuses.map((entry) => (entry.id === "local/pr-triage" ? { id: entry.id, status: { ...entry.status, fired: entry.status.fired.map((fired) => ({ ...fired, instance: ASKER })) } } : entry)), // a fire made the asker
  STATUSES("trigger-status-poll-failed.json").statuses, // a poll that failed
];
const refusal = { ok: false as const, code: "E_REFUSED", message: "refused" };
/** What the server answers, three times over, of an OATS from before the lists: the page then shows that in the lists' place, and no row. */
const none = { ok: false as const, code: NO_AUTOMATIONS, message: "this OATS has no automations lists" };
type Step = { schedule: 0 | 1 | 2; trigger: 0 | 1 | 2; statuses: 0 | 1 | 2 } | "no lists"; // 0, 1: read with that content; 2: refused
const answerOf = (step: Step, at: string) =>
  step === "no lists" ? { at, hostId: "host_falcon", oats: null, schedule: none, trigger: none, statuses: none } : readOf(step, at);
const readOf = (step: Exclude<Step, "no lists">, at: string) => ({
  at,
  hostId: "host_falcon",
  oats: null,
  schedule: step.schedule === 2 ? refusal : { ok: true as const, list: SCHEDULES[step.schedule]! },
  trigger: step.trigger === 2 ? refusal : { ok: true as const, list: TRIGGERS[step.trigger]! },
  // (As the server answers: where the triggers' list is refused, no state is read, and its refusal stands for both.)
  statuses: step.trigger === 2 || step.statuses === 2 ? refusal : { ok: true as const, statuses: STATES[step.statuses]! },
});
const STEPS: Step[] = [...[0, 1, 2].flatMap((schedule) => [0, 1, 2].flatMap((trigger) => [0, 1, 2].map((statuses) => ({ schedule, trigger, statuses }) as Step))), "no lists"];
const agents = fixtureAgents();
const ROSTERS = {
  "not read": null,
  "an agent asks": new Map(agents.map((agent) => [agent.instance, { state: agent.instance === ASKER ? ("needs-you" as const) : ("idle" as const) }])),
  "nobody asks": new Map(agents.map((agent) => [agent.instance, { state: "idle" as const }])),
};

/** What the PAGE says of a kept copy, by the list's own functions: the states of its rows, its red rows, its filter's two counts. */
function pageSays(kept: Kept, roster: (typeof ROSTERS)[keyof typeof ROSTERS]) {
  const statuses = kept.statuses?.statuses ?? null;
  const asking = askingOf(roster, statuses);
  const rows = oneList(kept.schedule?.list.rows ?? [], kept.trigger?.list.rows ?? []);
  return {
    needsRows: rows.filter((row) => attention(row, statusFor(row, statuses), asking) === "needs").length,
    redRows: rows.filter((row) => rowLine(row, statusFor(row, statuses), NOW).some((part) => part.tone === "bad")).length,
    needsCount: filterList(rows, "needs", statuses, asking).length,
    failingCount: filterList(rows, "failing", statuses, asking).length,
  };
}

describe("the walk: a row, the filter's count and the sidebar's dot say the same in every state of the reads", () => {
  it("every sequence of three reads (28 x 28 x 28 = 21 952: each of the three answers read with one of two contents or refused, or an OATS with no lists at all), under each roster: the amber dot is there exactly when a row needs a person and the filter counts one; the red dot exactly when a row is red and the filter counts one", () => {
    let walked = 0;
    const seen = { amber: 0, red: 0, both: 0, none: 0, keptWhileRefused: 0 };
    const disagree: string[] = [];
    for (const first of STEPS) {
      const one = keptAfter({}, answerOf(first, "t1") as never);
      for (const second of STEPS) {
        const two = keptAfter(one, answerOf(second, "t2") as never);
        for (const third of STEPS) {
          const kept = keptAfter(two, answerOf(third, "t3") as never);
          if (third !== "no lists" && ((third.schedule === 2 && kept.schedule !== undefined) || (third.statuses === 2 && kept.statuses !== undefined))) seen.keptWhileRefused += 1;
          // An OATS with no lists: the page draws its notice in the lists' place and no row, whatever was read before: so no dot.
          if (third === "no lists") expect([kept, marksFor(kept, ROSTERS["an agent asks"])]).toEqual([{}, []]);
          for (const [name, roster] of Object.entries(ROSTERS)) {
            walked += 1;
            const page = pageSays(kept, roster);
            const dots = marksFor(kept, roster).map((mark) => mark.tone ?? "failure");
            const amber = dots.includes("warning");
            const red = dots.includes("failure");
            seen[amber && red ? "both" : amber ? "amber" : red ? "red" : "none"] += 1;
            if (amber !== page.needsRows > 0 || amber !== page.needsCount > 0 || page.needsRows !== page.needsCount || red !== page.redRows > 0 || red !== page.failingCount > 0 || page.redRows !== page.failingCount) {
              if (disagree.length < 5) disagree.push(`${JSON.stringify([first, second, third])} ${name}: dots ${JSON.stringify(dots)}, page ${JSON.stringify(page)}`);
            }
          }
        }
      }
    }
    expect(disagree).toEqual([]);
    expect(walked).toBe(28 ** 3 * 3);
    // The walk is not of one answer: every verdict is met, many times, and so is a copy kept under a refusal.
    expect(Object.values(seen).every((count) => count > 500)).toBe(true);
  }, 120_000); // sixty-five thousand states, each judged twice: seconds alone, more beside other files

  it("the kept copy is what was last READ of each answer, and nothing else: against its own definition, over every sequence", () => {
    for (const first of STEPS) {
      for (const second of STEPS) {
        for (const third of STEPS) {
          const steps = [first, second, third];
          const kept = steps.reduce<Kept>((before, step, at) => keptAfter(before, answerOf(step, `t${at + 1}`) as never), {});
          // Nothing read before an OATS with no lists is kept: the definition looks at the reads after the last such answer.
          const from = steps.lastIndexOf("no lists") + 1;
          const last = (read: (step: Exclude<Step, "no lists">) => boolean) => steps.map((step, at) => at >= from && step !== "no lists" && read(step)).lastIndexOf(true);
          const part = (at: number) => steps[at] as Exclude<Step, "no lists">;
          const schedule = last((step) => step.schedule !== 2);
          const trigger = last((step) => step.trigger !== 2);
          const statuses = last((step) => step.trigger !== 2 && step.statuses !== 2);
          expect([kept.schedule?.at ?? null, kept.schedule?.list ?? null]).toEqual(schedule === -1 ? [null, null] : [`t${schedule + 1}`, SCHEDULES[part(schedule).schedule]]);
          expect([kept.trigger?.at ?? null, kept.trigger?.list ?? null]).toEqual(trigger === -1 ? [null, null] : [`t${trigger + 1}`, TRIGGERS[part(trigger).trigger]]);
          expect([kept.statuses?.at ?? null, kept.statuses?.statuses ?? null]).toEqual(statuses === -1 ? [null, null] : [`t${statuses + 1}`, STATES[part(statuses).statuses]]);
        }
      }
    }
  }, 120_000);
});
