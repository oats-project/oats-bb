// Opening bb's own Terminal tab on the kernel's viewer of a tmux agent (kernel/terminal.ts), from a
// plugin PAGE: the only place bb shows a terminal for (a sidebar row and the app overlay are
// declined: the terminal probe of 21 Nov 2026). Two calls of bb's: `terminals.create`, then
// `experimental_openTerminal`; and two more that make it safe: `terminals.get` after the open,
// which says a command that ended at once (the tab then never shows, and bb says nothing), and
// `terminals.close` for a terminal bb did not show (it would stay attached, on no tab).
//
// ONE tab per agent: a terminal of the same title that still runs on that machine is shown again,
// never a second viewer.

/** What this needs of bb's SDK (`useSdk().terminals`) and of its navigation, narrowed to what is called. */
export type TerminalIo = {
  list(args: { scope: { kind: "host_path"; hostId: string } }): Promise<{ sessions: readonly { id: string; title: string | null; status: string }[] }>;
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
  /** the command ended before it could be shown: bb's own word of how */
  | { kind: "ended"; status: number | null }
  /** the command runs and bb showed no tab: closed again */
  | { kind: "declined" };

/** The size a terminal is created at: it lasts only until its tab is shown (bb then sizes it to the tab). */
const COLS = 100;
const ROWS = 30;
/** How long after the open the terminal is asked how it stands: a command that cannot run ends within milliseconds. */
export const SETTLE_MS = 1_200;
const RUNS = new Set(["running", "starting"]);

export async function openTerminal(io: TerminalIo, command: Command, title: string): Promise<Opened> {
  const scope = { kind: "host_path" as const, hostId: command.hostId };
  const held = (await io.list({ scope })).sessions.find((session) => session.title === title && RUNS.has(session.status));
  const terminalId = held?.id ?? (await io.create({ scope: { ...scope, cwd: command.cwd }, cols: COLS, rows: ROWS, title, start: { mode: "argv", argv: [...command.argv] } })).id;
  const shown = await io.show(terminalId);
  await (io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(SETTLE_MS);
  // (bb's answer to the open is no witness of a dead terminal: for one that had exited it said false at one width and true at another.)
  const now = await io.get({ terminalId });
  if (!RUNS.has(now.status)) return { kind: "ended", status: now.exitCode ?? null };
  if (!shown) {
    await io.close({ terminalId, mode: "force" });
    return { kind: "declined" };
  }
  return { kind: "opened", terminalId, reused: held !== undefined };
}
