// Opening bb's own Terminal tab on the kernel's viewer of a tmux agent (kernel/terminal.ts), from a
// plugin PAGE: the only place bb shows a terminal for (a sidebar row and the app overlay are
// declined: the terminal probe of 21 Nov 2026). Two calls of bb's: `terminals.create`, then
// `experimental_openTerminal`; and two more that make it safe: `terminals.get` after the open,
// which says a command that ended at once (the tab then never shows, and bb says nothing), and
// `terminals.close` for a terminal this press created and bb did not show (it would stay
// attached, on no tab).
//
// ONE tab per agent: a terminal of the same title, in the agent's home, that still runs on that machine is shown again,
// never a second viewer.

/** What this needs of bb's SDK (`useSdk().terminals`) and of its navigation, narrowed to what is called. */
export type TerminalIo = {
  list(args: { scope: { kind: "host_path"; hostId: string } }): Promise<{ sessions: readonly { id: string; title: string | null; status: string; initialCwd?: string | null }[] }>;
  create(args: { scope: { kind: "host_path"; hostId: string; cwd: string }; cols: number; rows: number; title: string; start: { mode: "argv"; argv: string[] } }): Promise<{ id: string; status: string }>;
  get(args: { terminalId: string }): Promise<{ status: string; exitCode?: number | null }>;
  close(args: { terminalId: string; mode: "force" | "if-clean" }): Promise<unknown>;
  /** `useBbNavigate().experimental_openTerminal`: whether bb showed the tab. */
  show(terminalId: string): Promise<boolean>;
  sleep?(ms: number): Promise<void>;
};

export type Command = { hostId: string; argv: readonly string[]; cwd: string };

export type Opened =
  | { kind: "opened"; terminalId: string; reused: boolean }
  /** the command ended before it could be shown: bb's own word of how. `left`: bb refused to close the terminal this press made */
  | { kind: "ended"; status: number | null; left: boolean }
  /** the command runs and bb showed no tab: closed again, where this call created it. `left`: bb refused to close it */
  | { kind: "declined"; left: boolean };

/** A failure of bb's after a press made a terminal that bb then refused to close: the failure itself, and that fact for whoever says it. */
export class TerminalLeft extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "TerminalLeft";
  }
}

/** The size a terminal is created at: it lasts only until its tab is shown (bb then sizes it to the tab). */
const COLS = 100;
const ROWS = 30;
/** How long after the open the terminal is asked how it stands: a command that cannot run ends within milliseconds. */
export const SETTLE_MS = 1_200;
/** A terminal that is the agent's tab: one of these is shown again. */
const RUNS = new Set(["running", "starting"]);
/** bb's word for a terminal whose command has ended. (Its fourth word, "disconnected", is of the machine's link, not of the command: such a terminal is not called ended.) */
const ENDED = "exited";

/**
 * NO terminal is left attached on no tab: whatever goes wrong after a terminal was created HERE
 * (bb shows no tab, the command has ended, or a call of bb's THROWS: `experimental_openTerminal`
 * gone from a later bb, a network failure), that terminal is closed again before this answers or
 * rethrows. A viewer left behind is a tmux client nobody sees on the agent's window, whose size
 * it constrains, and the next press would find it by its title and fail on it again.
 * A terminal that was FOUND is never closed from here: it may be on its tab, in this window or
 * in another of bb's, and a press that could not show it here must not end it there.
 */
export async function openTerminal(io: TerminalIo, command: Command, title: string): Promise<Opened> {
  const scope = { kind: "host_path" as const, hostId: command.hostId };
  // The agent's tab: its title AND its directory, the agent's home. The title alone is no identity
  // (it is the name as words: "fix-ci" and "fix--ci" read the same), and another terminal of the
  // machine may carry it.
  const held = (await io.list({ scope })).sessions.find((session) => session.title === title && session.initialCwd === command.cwd && RUNS.has(session.status));
  const terminalId = held?.id ?? (await io.create({ scope: { ...scope, cwd: command.cwd }, cols: COLS, rows: ROWS, title, start: { mode: "argv", argv: [...command.argv] } })).id;
  /**
   * Closes the terminal THIS call created; one that was found again is left as it is. → whether a
   * terminal this press made is LEFT attached because bb refused to close it: that is answered to
   * the caller with the outcome (or the failure), which says it to the person. Nothing else can
   * be done from here.
   */
  const close = async (): Promise<boolean> => {
    if (held !== undefined) return false;
    try {
      await io.close({ terminalId, mode: "force" });
      return false;
    } catch {
      return true;
    }
  };
  try {
    const shown = await io.show(terminalId);
    await (io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(SETTLE_MS);
    // (bb's answer to the open is no witness of a dead terminal: for one that had exited it said false at one width and true at another.)
    const now = await io.get({ terminalId });
    if (now.status === ENDED) return { kind: "ended", status: now.exitCode ?? null, left: await close() };
    if (!shown) return { kind: "declined", left: await close() };
    return { kind: "opened", terminalId, reused: held !== undefined };
  } catch (cause) {
    if (await close()) throw new TerminalLeft(cause);
    throw cause;
  }
}
