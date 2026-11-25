// A tmux agent's terminal: the kernel's own viewer of one instance (`oats session attach --home`,
// docs/execution-targets.md "attach"), as the command a terminal runs. It is INTERACTIVE: it opens
// a temporary tmux session linked to the agent's window alone and attaches the caller's terminal
// to it, so it is never run by the plugin itself: bb's own Terminal tab runs it (app/terminal).
// Closing the viewer leaves the agent running; typing in it types to the agent.
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/** The kernel's features (`oats version --json`) that gate the viewer's two flags. */
export const DETACH_KEY_FEATURE = "session-attach-detach-key";
export const NO_STATUS_LINE_FEATURE = "session-attach-no-status-line";
/** The one key that leaves the viewer (the kernel's own suggestion, `oats session attach --help`): the viewer then exits with status 20, and bb closes its tab. */
export const DETACH_KEY = "C-\\";

/**
 * The viewer's command for one home. `bin` is the ABSOLUTE path of `oats` on the machine that
 * holds the home: bb's terminal runs a command with the login shell's PATH, not the one the
 * plugin's host entry has (a spike of 25 Nov 2026: `oats` by name ended with status 127 there).
 * A flag is passed only where the kernel lists its feature.
 */
export function viewerArgv(bin: string, home: string, features: readonly string[]): string[] {
  return [
    bin,
    "session",
    "attach",
    "--home",
    home,
    ...(features.includes(DETACH_KEY_FEATURE) ? ["--detach-key", DETACH_KEY] : []),
    ...(features.includes(NO_STATUS_LINE_FEATURE) ? ["--no-status-line"] : []),
  ];
}

/**
 * The absolute path of the `oats` this machine runs: the setting where it is one, else the first
 * executable `oats` on `path` (a PATH: the host entry's own, which is the user's login-shell
 * PATH). Null where there is none.
 */
export function resolveBin(bin: string, path: string | undefined, executable: (file: string) => boolean = isExecutable): string | null {
  if (bin !== "") return isAbsolute(bin) && executable(bin) ? bin : null;
  for (const directory of (path ?? "").split(delimiter)) {
    if (directory === "" || !isAbsolute(directory)) continue;
    const file = join(directory, "oats");
    if (executable(file)) return file;
  }
  return null;
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
