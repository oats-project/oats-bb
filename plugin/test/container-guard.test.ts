// ONLY INSIDE THE CHECKS' CONTAINER (container/guard.sh, container/guard.mjs): an entry script that changes the
// machine it runs on (it renames `claude` and `oats`, installs tools for the user, writes the user's settings,
// removes directories, sets bb's limits) refuses, before it touches anything, wherever the image's mark is not.
// Run by mistake on a person's machine, it must change NOTHING.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CONTAINER = join(dirname(fileURLToPath(import.meta.url)), "..", "container");
const MARK = "/etc/oats-bb-checks-image";

/** THE GUARDED: every entry that changes the machine it runs on, and what runs it. Closed: a new script of the directory is in one of the four lists below, or the last test fails. */
const GUARDED: Record<string, "sh" | "bash" | "node"> = {
  "setup.sh": "sh", // installs bb for the user
  "live.sh": "bash", // installs Claude Code, writes ~/.claude/settings.json, starts and ends bb
  "live-ui.mjs": "node", // renames `oats` and `claude`, sets bb's concurrency limit, archives threads
  "locked-install.sh": "sh", // installs a tool for the user and puts it on the PATH
  "real/setup.sh": "bash", // the kernel, Claude Code and bb for the user; the user's settings
  "real/workspace.sh": "sh", // removes and makes a workspace and a deployment
  "real/scenario.mjs": "node", // spawns, stops and retires agents; moves binaries aside
  "real/pi/setup.sh": "bash", // pi and its bridge for the user (~/.pi)
  "real/pi/scenario.mjs": "node",
  "real/mail/inside.sh": "bash", // installs the kernel, aw and Claude Code for the user
  "real/mail/check.mjs": "node",
};
/** They run ON THE HOST, and do their work in a container they start: they write their own out/ alone. */
const HOST = ["ci.sh", "real/run.sh", "real/mail/run.sh", "relock.sh"];
/** Tools that change nothing but the directory they are handed, or only read: run by the guarded, and by unit tests on any machine. */
const TOOLS = ["unit.sh", "no-pi-tools-fetch.sh", "no-toolchain-fetch.sh", "fake-oats.mjs", "real/bb-logs.sh", "real/bb-plugin-command.sh", "real/bb-plugin-command.test.sh", "real/oats-record.mjs", "real/mock-anthropic.mjs", "real/pi/mock-openai.mjs"];
/** Modules: imported, never run (the guards themselves among them). */
const MODULES = ["guard.sh", "guard.mjs", "browser.mjs", "contrast.mjs", "files.mjs", "images.mjs", "tmux-roster.mjs", "real/fixtures.mjs"];
const MODULE_DIRECTORIES = ["scenes/", "real/parts/"];

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});
/** A person's home, as far as these scripts would touch it: a `claude` and an `oats` on the PATH, and the user's own settings. */
function home() {
  const directory = mkdtempSync(join(tmpdir(), "oats-bb-guard-"));
  made.push(directory);
  mkdirSync(join(directory, ".local", "bin"), { recursive: true });
  mkdirSync(join(directory, ".claude"), { recursive: true });
  writeFileSync(join(directory, ".local", "bin", "claude"), "#!/bin/sh\necho a person's claude\n", { mode: 0o755 });
  writeFileSync(join(directory, ".local", "bin", "oats"), "#!/bin/sh\necho a person's oats\n", { mode: 0o755 });
  writeFileSync(join(directory, ".claude", "settings.json"), '{ "a": "person\'s settings" }\n');
  return directory;
}
/** Every file under a directory, with what it holds and its mode. */
const holds = (directory: string): Record<string, string> =>
  Object.fromEntries(
    (readdirSync(directory, { recursive: true }) as string[])
      .sort()
      .map((name) => [name, statSync(join(directory, name)).isDirectory() ? "(a directory)" : `${statSync(join(directory, name)).mode.toString(8)} ${readFileSync(join(directory, name), "utf8")}`]),
  );

describe("only inside the checks' container", () => {
  it.each(Object.entries(GUARDED))("%s, run where the image's mark is not, is REFUSED with one line and changes nothing: a person's claude, oats and settings are as they were", (script, runner) => {
    const person = home();
    const before = holds(person);
    const ran = spawnSync(runner === "node" ? process.execPath : runner, [join(CONTAINER, script)], {
      cwd: person,
      encoding: "utf8",
      timeout: 30_000,
      // (The mark made absent: this test also runs inside the image. Nothing else of the test's own environment is passed.)
      env: { HOME: person, USER: "person", PATH: `${join(person, ".local", "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_BB_CHECKS_MARK_ABSENT: "1" },
    });
    expect([ran.status, ran.signal, ran.stdout]).toEqual([97, null, ""]);
    expect(ran.stderr).toBe(`refused: ${script.slice(script.lastIndexOf("/") + 1)} runs only inside the container of the oats-bb plugin checks (it changes the machine it runs on); start it with plugin/container/ci.sh, never by hand\n`);
    expect(holds(person)).toEqual(before);
  });

  it("the guard is the FIRST thing a guarded script does: before its own first statement, and before any other import", () => {
    for (const [script, runner] of Object.entries(GUARDED)) {
      const lines = readFileSync(join(CONTAINER, script), "utf8").split("\n");
      const up = relative(dirname(join(CONTAINER, script)), CONTAINER).split("/").filter(Boolean).map(() => "..").join("/");
      if (runner === "node") {
        const first = lines.find((line) => /^\s*(import|export|const|let|var|function|await|if|for|try)\b/.test(line));
        expect([script, first]).toEqual([script, `import "${up === "" ? "." : up}/guard.mjs"; // FIRST: refuses outside the checks' container, before anything is touched`]);
      } else {
        const first = lines.slice(1).find((line) => line.trim() !== "" && !line.startsWith("#"));
        expect([script, first]).toEqual([script, `. "$(dirname "$0")/${up === "" ? "" : `${up}/`}guard.sh" || exit 97 # refuses outside the checks' container, before anything is touched (and where the guard itself is not beside it)`]);
      }
    }
  });

  it.each(Object.entries(GUARDED).filter(([, runner]) => runner !== "node"))("%s, copied somewhere WITHOUT the guard beside it, does not run on: it ends there, and changes nothing", (script, runner) => {
    // (bash goes on after a `.` of a file that is not there: `|| exit 97` on the guard's own line stops it. A `.mjs` whose import is not there does not load at all.)
    const person = home();
    const alone = mkdtempSync(join(tmpdir(), "oats-bb-guard-alone-"));
    made.push(alone);
    const copy = join(alone, script.slice(script.lastIndexOf("/") + 1));
    writeFileSync(copy, readFileSync(join(CONTAINER, script)));
    const before = holds(person);
    const ran = spawnSync(runner, [copy], { cwd: person, encoding: "utf8", timeout: 30_000, env: { HOME: person, USER: "person", PATH: `${join(person, ".local", "bin")}:${dirname(process.execPath)}:/usr/bin:/bin` } });
    expect([ran.status !== 0 && ran.status !== null, ran.stdout, runner === "bash" ? ran.status : 97]).toEqual([true, "", 97]);
    expect(ran.stderr).toMatch(/guard\.sh/);
    expect(holds(person)).toEqual(before);
    expect(readdirSync(alone)).toEqual([script.slice(script.lastIndexOf("/") + 1)]);
  });

  it("where the mark is, the guard lets a script run; and the switch that makes it absent can only refuse", () => {
    const run = (env: Record<string, string>) => spawnSync("sh", ["-c", `. "${join(CONTAINER, "guard.sh")}"; echo ran`], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", ...env } });
    const inside = existsSync(MARK);
    expect([run({}).status, run({}).stdout]).toEqual(inside ? [0, "ran\n"] : [97, ""]);
    expect(run({ OATS_BB_CHECKS_MARK_ABSENT: "1" }).status).toBe(97);
    // Any other value of the switch changes nothing: it never OPENS the guard where the mark is not.
    expect(run({ OATS_BB_CHECKS_MARK_ABSENT: "0" }).status).toBe(inside ? 0 : 97);
    const node = (env: Record<string, string>) => spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(join(CONTAINER, "guard.mjs"))}); console.log("ran");`], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", ...env } });
    expect([node({}).status, node({}).stdout]).toEqual(inside ? [0, "ran\n"] : [97, ""]);
    expect(node({ OATS_BB_CHECKS_MARK_ABSENT: "1" }).status).toBe(97);
    // The mark is the image's: the Dockerfile writes it, and nothing else in the directory does.
    expect(readFileSync(join(CONTAINER, "Dockerfile"), "utf8")).toMatch(/^RUN printf '[^']+' > \/etc\/oats-bb-checks-image$/m);
  });

  it("every script of the directory is guarded, runs on the host, is a tool that changes nothing of a person's, or is a module: a new one is put in a list", () => {
    const scripts = (readdirSync(CONTAINER, { recursive: true }) as string[])
      .filter((name) => /\.(sh|mjs)$/.test(name) && !/(^|\/)out(\.|\/|$)/.test(name) && !name.startsWith("locks/"))
      .filter((name) => !MODULE_DIRECTORIES.some((directory) => name.startsWith(directory)))
      .sort();
    const listed = [...Object.keys(GUARDED), ...HOST, ...TOOLS, ...MODULES].sort();
    expect(scripts).toEqual(listed);
    expect(new Set(listed).size).toBe(listed.length);
    // A script that is NOT guarded does none of what the guard is for (a host script starts a container for it).
    const CHANGES = /\.away\b|\bnpm (install|i) (-g|--global)|\.claude\/settings\.json|concurrency-limit["', ]+host|\.local\/bin\/(oats|claude)|\bln -sf\b/;
    for (const script of [...TOOLS, ...MODULES]) expect([script, CHANGES.test(readFileSync(join(CONTAINER, script), "utf8"))]).toEqual([script, false]);
    for (const script of HOST) expect([script, /\bdocker (run|exec|build)\b/.test(readFileSync(join(CONTAINER, script), "utf8"))]).toEqual([script, true]);
    // …and a guarded one does import or source nothing BEFORE the guard that could (held by the test above), and every module of a module directory is reached through a guarded entry alone.
    for (const directory of MODULE_DIRECTORIES) for (const name of readdirSync(join(CONTAINER, directory))) expect([name, /^#!/.test(readFileSync(join(CONTAINER, directory, name), "utf8"))]).toEqual([name, false]);
  });
});
