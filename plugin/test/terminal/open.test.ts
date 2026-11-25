// Opening bb's Terminal tab on the viewer (app/terminal/open.ts), on a fake of bb's terminals: what
// is called, in what order, and what is answered for each way it can go.
import { describe, expect, test } from "vitest";
import { openTerminal, SETTLE_MS, type TerminalIo } from "../../app/terminal/open";

const COMMAND = { hostId: "host_falcon", argv: ["/usr/local/bin/oats", "session", "attach", "--home", "/srv/oats/agents/a/instances/kernel-fix-developer"], cwd: "/srv/oats/agents/a/instances/kernel-fix-developer" };
const TITLE = "Kernel fix developer";

type Session = { id: string; title: string | null; status: string; exitCode?: number | null };
/** bb's terminals, as far as the open asks them: `shown` is what bb answers to the open; `after` what a created terminal is by the time it is asked. */
function bb(given: { sessions?: Session[]; shown?: boolean; after?: { status: string; exitCode?: number | null } } = {}) {
  const sessions = [...(given.sessions ?? [])];
  const calls: string[] = [];
  const io: TerminalIo = {
    list: async ({ scope }) => {
      calls.push(`list ${scope.kind} ${scope.hostId}`);
      return { sessions };
    },
    create: async ({ scope, title, start, cols, rows }) => {
      calls.push(`create ${scope.hostId} ${scope.cwd} "${title}" ${cols}x${rows} ${start.mode} ${start.argv.join(" ")}`);
      const made = { id: "term_new", title, status: "running" };
      sessions.push(made);
      return made;
    },
    show: async (terminalId) => {
      calls.push(`show ${terminalId}`);
      return given.shown ?? true;
    },
    get: async ({ terminalId }) => {
      calls.push(`get ${terminalId}`);
      const held = sessions.find((session) => session.id === terminalId)!;
      return terminalId === "term_new" && given.after ? given.after : { status: held.status, exitCode: held.exitCode ?? null };
    },
    close: async ({ terminalId, mode }) => {
      calls.push(`close ${terminalId} ${mode}`);
    },
    sleep: async (ms) => {
      calls.push(`sleep ${ms}`);
    },
  };
  return { io, calls };
}

describe("opening the terminal", () => {
  test("no terminal of that title: one is created on that machine, in the home, with the command as an argv; shown; asked how it stands", async () => {
    const { io, calls } = bb();
    expect(await openTerminal(io, COMMAND, TITLE)).toEqual({ kind: "opened", terminalId: "term_new", reused: false });
    expect(calls).toEqual([
      "list host_path host_falcon",
      `create host_falcon ${COMMAND.cwd} "${TITLE}" 100x30 argv ${COMMAND.argv.join(" ")}`,
      "show term_new",
      `sleep ${SETTLE_MS}`,
      "get term_new",
    ]);
  });

  test("ONE tab per agent: a terminal of that title that still runs is shown again, and none is created", async () => {
    for (const status of ["running", "starting"]) {
      const { io, calls } = bb({ sessions: [{ id: "term_other", title: "Flaky ci developer", status: "running" }, { id: "term_held", title: TITLE, status }] });
      expect(await openTerminal(io, COMMAND, TITLE), status).toEqual({ kind: "opened", terminalId: "term_held", reused: true });
      expect(calls.filter((call) => call.startsWith("create"))).toEqual([]);
      expect(calls).toContain("show term_held");
    }
  });

  test("a terminal of that title that has ended is not the agent's tab: a new one is created", async () => {
    const { io, calls } = bb({ sessions: [{ id: "term_old", title: TITLE, status: "exited", exitCode: 20 }] });
    expect(await openTerminal(io, COMMAND, TITLE)).toEqual({ kind: "opened", terminalId: "term_new", reused: false });
    expect(calls.filter((call) => call.startsWith("create"))).toHaveLength(1);
  });

  test("the command ended at once: said with its status, whatever bb answered to the open (it is no witness), and nothing is closed", async () => {
    for (const shown of [true, false]) {
      const { io, calls } = bb({ shown, after: { status: "exited", exitCode: 127 } });
      expect(await openTerminal(io, COMMAND, TITLE), String(shown)).toEqual({ kind: "ended", status: 127 });
      expect(calls.filter((call) => call.startsWith("close"))).toEqual([]);
    }
    const none = bb({ after: { status: "exited" } });
    expect(await openTerminal(none.io, COMMAND, TITLE)).toEqual({ kind: "ended", status: null });
  });

  test("the command runs and bb showed no tab: the terminal is closed again, so that no viewer stays attached on no tab", async () => {
    const { io, calls } = bb({ shown: false });
    expect(await openTerminal(io, COMMAND, TITLE)).toEqual({ kind: "declined" });
    expect(calls.at(-1)).toBe("close term_new force");
  });

  test("what bb refuses is the caller's to say: the open does not swallow it", async () => {
    const { io } = bb();
    io.create = async () => {
      throw new Error("bb: terminals are disabled on this machine");
    };
    await expect(openTerminal(io, COMMAND, TITLE)).rejects.toThrow("terminals are disabled");
  });
});
