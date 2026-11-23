// THE TABLE: every row of an agent that does not run, as the ONE reading gives it (model/rest.ts,
// model/view.ts `recordedStopped` and `state`), with what each place says of it: the state's word,
// this feature's reason, whether the home's card answers or refuses, and whether the Start dialog
// says first that a message carries the conversation on. The test prints the table (run it with
// `npx vitest run test/outside/table.test.ts`) and holds it: a row that moves fails here.
import { expect, test } from "vitest";
import { refuses } from "../../app/home/board";
import { carriesOn } from "../../app/lifecycle/words";
import { said } from "../../app/outside/say";
import { agentStatus } from "../../app/roster/status";
import type { Agent } from "../../model/types";
import { rest } from "../../model/rest";
import { sample } from "./rows";

const NOW = Date.parse("2026-11-21T16:00:00.000Z");
const listed = { status: "idle" };
/** A row as the roster's parser reads the fixture's sample with these fields; `sessionEnd` is the plugin's Agent's own field. */
const row = (backend: "bb" | "tmux", running: boolean | null, runtimeState: string | null, sessionEnd?: string): Agent => ({ ...sample("harvest-knowledge-helper", { running, runtimeState }), backend, sessionEnd, waiting: null, ...(backend === "tmux" ? { threadId: null } : {}) });

const ROWS: [string, Agent][] = [
  ["bb · an operator's stop", row("bb", false, "stopped", "stopped")],
  ["bb · stopped, no word how it ended", row("bb", false, "stopped")],
  ["bb · no word of the runtime's state", row("bb", false, null)],
  ["bb · the stale stop beside \"unknown\"", row("bb", false, "unknown", "stopped")],
  ["bb · session lost", row("bb", false, "stopped", "lost")],
  ["bb · its harness ended by itself", row("bb", false, "stopped", "exited")],
  ["bb · ended in a shell", row("bb", false, "shell")],
  ["bb · no harness loaded", row("bb", false, "unknown")],
  ["bb · the kernel cannot reach it", row("bb", false, "unreachable")],
  ["bb · runs (a harness is loaded)", row("bb", true, "unknown")],
  ["tmux · stopped with OATS (recorded)", row("tmux", false, "shell", "stopped")],
  ["tmux · session lost (recorded)", row("tmux", false, null, "lost")],
  ["tmux · its window gone, no word", row("tmux", false, null)],
  ["tmux · runs (recorded)", row("tmux", true, null)],
];

test("the table of every row, from the one function", () => {
  const table = ROWS.map(([name, agent]) => {
    const on = agent.backend === "tmux" ? said(agent, "none", false) : said(agent, "open", true);
    return {
      row: name,
      rest: rest(agent),
      state: agentStatus(agent, null, NOW).word,
      reason: on === null ? "—" : on.note ?? (on.tone === "warning" ? "(the stop's warning)" : on.kind),
      card: rest(agent) === "runs" ? "—" : refuses(agent, agent.backend === "tmux" ? null : listed) ? "refuses" : "answers",
      dialog: carriesOn({ running: agent.running, runtimeState: agent.runtimeState, sessionEnd: agent.sessionEnd ?? null }, agent.backend === "tmux" ? null : listed) ? "a message carries it on" : "—",
    };
  });
  console.log(["", "| row | rest | state | reason | the home's card | the Start dialog's first line |", "|---|---|---|---|---|---|", ...table.map((line) => `| ${line.row} | ${line.rest} | ${line.state} | ${line.reason} | ${line.card} | ${line.dialog} |`), ""].join("\n"));
  expect(table.map((line) => [line.row, line.rest, line.state, line.reason, line.card, line.dialog])).toEqual([
    ["bb · an operator's stop", "stopped", "Stopped", "(the stop's warning)", "refuses", "—"],
    ["bb · stopped, no word how it ended", "stopped", "Stopped", "(the stop's warning)", "refuses", "—"],
    ["bb · no word of the runtime's state", "stopped", "Stopped", "(the stop's warning)", "refuses", "—"],
    ["bb · the stale stop beside \"unknown\"", "stopped", "Stopped", "(the stop's warning)", "refuses", "—"],
    ["bb · session lost", "lost", "Stopped", "session lost", "answers", "a message carries it on"],
    ["bb · its harness ended by itself", "ended", "Failed", "failed-open", "answers", "a message carries it on"],
    ["bb · ended in a shell", "ended", "Failed", "failed-open", "answers", "a message carries it on"],
    ["bb · no harness loaded", "unloaded", "Idle", "not loaded", "answers", "a message carries it on"],
    ["bb · the kernel cannot reach it", "unloaded", "Unreachable", "—", "refuses", "—"],
    ["bb · runs (a harness is loaded)", "runs", "Idle", "—", "—", "—"],
    ["tmux · stopped with OATS (recorded)", "stopped", "Stopped", "—", "refuses", "—"],
    ["tmux · session lost (recorded)", "lost", "Stopped", "session lost", "refuses", "—"],
    ["tmux · its window gone, no word", "stopped", "Stopped", "—", "refuses", "—"],
    ["tmux · runs (recorded)", "runs", "Working", "—", "—", "—"],
  ]);
});
