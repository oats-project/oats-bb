// THE TABLE: every row of an agent that does not run, as the ONE reading gives it (model/rest.ts,
// model/view.ts `recordedStopped` and `state`), with what each place says of it: the state's word,
// this feature's reason, whether the home's card answers or refuses, and whether the Start dialog
// says first that a message carries the conversation on. The test prints the table (run it with
// `npx vitest run test/outside/table.test.ts`) and holds it: a row that moves fails here.
import { expect, test } from "vitest";
import { refusal } from "../../app/home/board";
import { carriesOn } from "../../app/lifecycle/words";
import { said } from "../../app/outside/say";
import { agentStatus } from "../../app/roster/status";
import type { Agent, BbThread } from "../../model/types";
import { rest } from "../../model/rest";
import { sample } from "./rows";

const NOW = Date.parse("2026-11-21T16:00:00.000Z");
const listed = { status: "idle" };
/** A row as the roster's parser reads the fixture's sample with these fields; `sessionEnd` is the plugin's Agent's own field. */
const row = (backend: "bb" | "tmux", running: boolean | null, runtimeState: string | null, sessionEnd?: string): Agent => ({ ...sample("harvest-knowledge-helper", { running, runtimeState }), backend, sessionEnd, waiting: null, ...(backend === "tmux" ? { threadId: null } : {}) });

const failed = { status: "error", startFailure: null }; // bb's word for a thread whose LATER turn failed (bb answered that a turn started there): the session is there
const unanswered = { status: "error" }; // the same thread before bb has answered for its events: it may be one that never started
// bb's word that the thread failed AT ITS START (its events: app/outside/threads.ts), joined on the thread: the agent never ran.
const neverStarted = { status: "error", startFailure: { message: "Command thread.start failed", detail: 'Failed to resolve Pi model "x"' } };
const ROWS: [string, Agent, { status: string; startFailure?: object | null }?][] = [
  ["bb · an operator's stop", row("bb", false, "stopped", "stopped")],
  ["bb · stopped, no word how it ended", row("bb", false, "stopped")],
  ["bb · no word of the runtime's state", row("bb", false, null)],
  ["bb · the stale stop beside \"unknown\"", row("bb", false, "unknown", "stopped")],
  ["bb · the word \"stopped\" beside \"lost\", and no word that it does not run", row("bb", null, "stopped", "lost")],
  ["bb · session lost", row("bb", false, "stopped", "lost")],
  ["bb · its harness ended by itself", row("bb", false, "stopped", "exited")],
  ["bb · ended in a shell", row("bb", false, "shell")],
  ["bb · no harness loaded", row("bb", false, "unknown")],
  ["bb · session lost, on a thread whose last turn failed", row("bb", false, "stopped", "lost"), failed],
  ["bb · ended in a shell, on a thread whose last turn failed", row("bb", false, "shell"), failed],
  ["bb · an operator's stop, on a thread whose last turn failed", row("bb", false, "stopped", "stopped"), failed],
  ["bb · session lost, on a thread in \"error\" bb has not answered for", row("bb", false, "stopped", "lost"), unanswered],
  ["bb · session lost, on a thread that failed at its start", row("bb", false, "stopped", "lost"), neverStarted],
  ["bb · runs outside OATS (the kernel's report), on a thread that failed at its start", { ...row("bb", false, "stopped", "stopped"), outsideOats: { code: "running-outside-oats", backend: "bb", message: "a harness runs" } }, neverStarted],
  ["bb · the kernel cannot reach it (the kernel's row)", row("bb", null, "unreachable")],
  ["bb · runs (a harness is loaded)", row("bb", true, "unknown")],
  ["tmux · stopped with OATS (recorded)", row("tmux", false, "shell", "stopped")],
  ["tmux · session lost (recorded)", row("tmux", false, null, "lost")],
  ["tmux · its window gone, no word", row("tmux", false, null)],
  ["tmux · runs (recorded)", row("tmux", true, null)],
];

test("the table of every row, from the one function", () => {
  const table = ROWS.map(([name, agent, thread = listed]) => {
    const on = agent.backend === "tmux" ? said(agent, "none", false) : said(agent, "open", true, thread);
    // The state reads bb's thread for one fact here: whether it failed at its start.
    const drawnOn = "startFailure" in thread ? (thread as never as BbThread) : null;
    return {
      row: name,
      rest: rest(agent, agent.backend === "tmux" ? null : thread),
      state: agentStatus(agent, drawnOn, NOW).word,
      reason: on === null ? "—" : on.note ?? (on.tone === "warning" ? "(the stop's warning)" : on.kind),
      card: rest(agent) === "runs" ? "—" : (refusal(agent, agent.backend === "tmux" ? null : thread) ?? "answers").replace(/^(stopped|unreachable)$/, "refuses ($1)"),
      dialog: carriesOn({ running: agent.running, runtimeState: agent.runtimeState, sessionEnd: agent.sessionEnd ?? null }, agent.backend === "tmux" ? null : thread) ? "a message carries it on" : "—",
    };
  });
  console.log(["", "| row | rest | state | reason | the home's card | the Start dialog's first line |", "|---|---|---|---|---|---|", ...table.map((line) => `| ${line.row} | ${line.rest} | ${line.state} | ${line.reason} | ${line.card} | ${line.dialog} |`), ""].join("\n"));
  expect(table.map((line) => [line.row, line.rest, line.state, line.reason, line.card, line.dialog])).toEqual([
    ["bb · an operator's stop", "stopped", "Stopped", "(the stop's warning)", "refuses (stopped)", "—"],
    ["bb · stopped, no word how it ended", "stopped", "Stopped", "(the stop's warning)", "refuses (stopped)", "—"],
    ["bb · no word of the runtime's state", "stopped", "Stopped", "(the stop's warning)", "refuses (stopped)", "—"],
    ["bb · the stale stop beside \"unknown\"", "stopped", "Stopped", "(the stop's warning)", "refuses (stopped)", "—"],
    ["bb · the word \"stopped\" beside \"lost\", and no word that it does not run", "stopped", "Stopped", "(the stop's warning)", "refuses (stopped)", "—"],
    ["bb · session lost", "lost", "Stopped", "session lost", "answers", "a message carries it on"],
    // A harness that ended by itself: no provider prints it on a bb thread, and no fact shows a message carrying it on: no place invites one (the lead's condition of 24 Nov 2026).
    ["bb · its harness ended by itself", "ended", "Failed", "failed-open", "refuses (stopped)", "—"],
    ["bb · ended in a shell", "ended", "Failed", "failed-open", "refuses (stopped)", "—"],
    ["bb · no harness loaded", "unloaded", "Idle", "not loaded", "answers", "a message carries it on"],
    // A thread bb lists whose last turn failed takes a message as any other: the three places still say one thing.
    ["bb · session lost, on a thread whose last turn failed", "lost", "Stopped", "session lost", "answers", "a message carries it on"],
    ["bb · ended in a shell, on a thread whose last turn failed", "ended", "Failed", "failed-open", "refuses (stopped)", "—"],
    ["bb · an operator's stop, on a thread whose last turn failed", "stopped", "Stopped", "(the stop's warning)", "refuses (stopped)", "—"],
    // bb has not answered for the thread's events: it may never have started, so no message is invited anywhere (fail closed).
    ["bb · session lost, on a thread in \"error\" bb has not answered for", "lost", "Stopped", "session lost", "refuses (stopped)", "—"],
    // It never ran: failed, nothing of a lost session, no message.
    ["bb · session lost, on a thread that failed at its start", "never-started", "Failed", "—", "refuses (stopped)", "—"],
    // The kernel's report wins: it runs, whatever bb said of the thread's start.
    ["bb · runs outside OATS (the kernel's report), on a thread that failed at its start", "stopped", "Running outside OATS", "", "refuses (stopped)", "—"],
    ["bb · the kernel cannot reach it (the kernel's row)", "unreachable", "Unreachable", "—", "refuses (unreachable)", "—"],
    ["bb · runs (a harness is loaded)", "runs", "Idle", "—", "—", "—"],
    ["tmux · stopped with OATS (recorded)", "stopped", "Stopped", "—", "refuses (stopped)", "—"],
    ["tmux · session lost (recorded)", "lost", "Stopped", "session lost", "refuses (stopped)", "—"],
    ["tmux · its window gone, no word", "stopped", "Stopped", "—", "refuses (stopped)", "—"],
    ["tmux · runs (recorded)", "runs", "Working", "—", "—", "—"],
  ]);
});
