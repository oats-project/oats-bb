// Opening bb's Terminal tab on the viewer (app/terminal/open.ts), on a fake of bb's terminals: what
// is called, in what order, and what is answered for each way it can go.
import { describe, expect, test } from "vitest";
import { openTerminal, SETTLE_MS, type TerminalIo } from "../../app/terminal/open";

const COMMAND = { hostId: "host_falcon", argv: ["/usr/local/bin/oats", "session", "attach", "--home", "/srv/oats/agents/a/instances/kernel-fix-developer"], cwd: "/srv/oats/agents/a/instances/kernel-fix-developer" };
const TITLE = "Kernel fix developer";

type Session = { id: string; title: string | null; status: string; exitCode?: number | null; initialCwd?: string | null };
const HOME = COMMAND.cwd;
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
      const made = { id: "term_new", title, status: "running", initialCwd: scope.cwd };
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
      const { io, calls } = bb({ sessions: [{ id: "term_other", title: "Flaky ci developer", status: "running", initialCwd: "/srv/oats/agents/a/instances/flaky-ci-developer" }, { id: "term_held", title: TITLE, status, initialCwd: HOME }] });
      expect(await openTerminal(io, COMMAND, TITLE), status).toEqual({ kind: "opened", terminalId: "term_held", reused: true });
      expect(calls.filter((call) => call.startsWith("create"))).toEqual([]);
      expect(calls).toContain("show term_held");
    }
  });

  test("a terminal of that title that has ended is not the agent's tab: a new one is created", async () => {
    const { io, calls } = bb({ sessions: [{ id: "term_old", title: TITLE, status: "exited", exitCode: 20, initialCwd: HOME }] });
    expect(await openTerminal(io, COMMAND, TITLE)).toEqual({ kind: "opened", terminalId: "term_new", reused: false });
    expect(calls.filter((call) => call.startsWith("create"))).toHaveLength(1);
  });

  test("the command ended at once: said with its status, whatever bb answered to the open (it is no witness); the dead terminal is closed", async () => {
    for (const shown of [true, false]) {
      const { io, calls } = bb({ shown, after: { status: "exited", exitCode: 127 } });
      expect(await openTerminal(io, COMMAND, TITLE), String(shown)).toEqual({ kind: "ended", status: 127 });
      expect(calls.at(-1)).toBe("close term_new force");
    }
    const none = bb({ after: { status: "exited" } });
    expect(await openTerminal(none.io, COMMAND, TITLE)).toEqual({ kind: "ended", status: null });
  });

  test("the command runs and bb showed no tab: the terminal is closed again, so that no viewer stays attached on no tab", async () => {
    const { io, calls } = bb({ shown: false });
    expect(await openTerminal(io, COMMAND, TITLE)).toEqual({ kind: "declined" });
    expect(calls.at(-1)).toBe("close term_new force");
  });

  test("the title alone is no identity: a terminal of the same title in ANOTHER directory is not this agent's tab", async () => {
    // "fix-ci" and "fix--ci" read the same as words; and any other terminal of the machine may carry the title.
    const { io, calls } = bb({ sessions: [{ id: "term_of_another", title: TITLE, status: "running", initialCwd: "/srv/oats/agents/a/instances/kernel--fix-developer" }, { id: "term_untold", title: TITLE, status: "running" }] });
    expect(await openTerminal(io, COMMAND, TITLE)).toEqual({ kind: "opened", terminalId: "term_new", reused: false });
    expect(calls.filter((call) => call.startsWith("show"))).toEqual(["show term_new"]);
  });

  test("a call of bb's that THROWS after the terminal was created: it is closed again before the failure is passed on, so that no viewer stays attached on no tab", async () => {
    // bb has no `experimental_openTerminal` any more.
    const gone = bb();
    gone.io.show = async () => {
      throw new TypeError("nav.experimental_openTerminal is not a function");
    };
    await expect(openTerminal(gone.io, COMMAND, TITLE)).rejects.toThrow("is not a function");
    expect(gone.calls.at(-1)).toBe("close term_new force");
    // bb shows no tab, and then cannot be asked how the terminal stands.
    const cut = bb({ shown: false });
    cut.io.get = async () => {
      throw new Error("network");
    };
    await expect(openTerminal(cut.io, COMMAND, TITLE)).rejects.toThrow("network");
    expect(cut.calls.at(-1)).toBe("close term_new force");
  });

  test("a terminal that was FOUND again is never closed by a press: not on a throw, not when bb shows no tab here (it may be on its tab in another window)", async () => {
    const found = () => bb({ sessions: [{ id: "term_held", title: TITLE, status: "running", initialCwd: HOME }], shown: false });
    const thrown = found();
    thrown.io.get = async () => {
      throw new Error("network");
    };
    await expect(openTerminal(thrown.io, COMMAND, TITLE)).rejects.toThrow("network");
    expect(thrown.calls.filter((call) => call.startsWith("close"))).toEqual([]);
    const declined = found();
    expect(await openTerminal(declined.io, COMMAND, TITLE)).toEqual({ kind: "declined" });
    expect(declined.calls.filter((call) => call.startsWith("close"))).toEqual([]);
  });

  test("bb refuses to close: what is being answered stands (the outcome, or the failure), and the refusal is not thrown over it", async () => {
    const declined = bb({ shown: false });
    declined.io.close = async () => {
      throw new Error("cannot close");
    };
    expect(await openTerminal(declined.io, COMMAND, TITLE)).toEqual({ kind: "declined" });
    const thrown = bb();
    thrown.io.show = async () => {
      throw new Error("no such call");
    };
    thrown.io.close = async () => {
      throw new Error("cannot close");
    };
    await expect(openTerminal(thrown.io, COMMAND, TITLE)).rejects.toThrow("no such call");
  });

  test("a terminal bb calls \"disconnected\" is not called ended: shown, it is the agent's tab; not shown, it is closed", async () => {
    expect(await openTerminal(bb({ after: { status: "disconnected" } }).io, COMMAND, TITLE)).toEqual({ kind: "opened", terminalId: "term_new", reused: false });
    const unseen = bb({ shown: false, after: { status: "disconnected" } });
    expect(await openTerminal(unseen.io, COMMAND, TITLE)).toEqual({ kind: "declined" });
    expect(unseen.calls.at(-1)).toBe("close term_new force");
  });

  test("what bb refuses is the caller's to say: the open does not swallow it", async () => {
    const { io } = bb();
    io.create = async () => {
      throw new Error("bb: terminals are disabled on this machine");
    };
    await expect(openTerminal(io, COMMAND, TITLE)).rejects.toThrow("terminals are disabled");
  });
});
