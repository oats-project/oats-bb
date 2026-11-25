// The terminal's host verb: the viewer's command for one home, with THIS machine's absolute path
// of `oats` (kernel/terminal.ts). Nothing runs here: bb's Terminal tab runs the command.
import { isAbsolute } from "node:path";
import type { host } from "../contract/terminal.js";
import { codes } from "../kernel/result.js";
import { resolveBin, viewerArgv } from "../kernel/terminal.js";
import type { Handlers, HostCore } from "./core.js";

export const handlers = (_core: HostCore): Handlers<typeof host> => ({
  terminalCommand: async ({ home, features, oatsBin }) => {
    if (!isAbsolute(home)) return { ok: false, error: { code: codes.invalidInput, message: "the home must be an absolute directory" } };
    const bin = resolveBin(oatsBin, process.env.PATH);
    if (bin === null) return { ok: false, error: { code: codes.notFound, message: oatsBin === "" ? "oats is not on this machine's PATH" : `${oatsBin} is not an absolute path to an executable oats` } };
    return { ok: true, value: { argv: viewerArgv(bin, home, features) } };
  },
});
