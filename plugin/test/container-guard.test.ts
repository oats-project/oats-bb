// ONLY INSIDE THE CHECKS' CONTAINER (container/guard.sh, container/guard.mjs): an entry script that changes the
// machine it runs on (it renames `claude` and `oats`, installs tools for the user, writes the user's settings,
// removes directories, sets bb's limits) refuses, before it touches anything, wherever the image's mark is not.
// Run by mistake on a person's machine, it must change NOTHING.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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
  // Two entries of the same kind OUTSIDE this directory (the Automations fixtures' recorder runs them in the container, after real/setup.sh):
  "../test/fixtures/automations/record/workspace.sh": "sh", // a `gh` for the user's PATH, commits and pushes, `oats sync`
  "../test/fixtures/automations/record/record.mjs": "node", // adds schedules and triggers, spawns agents
};
/** They run ON THE HOST, and do their work in a container they start (what each writes on the host: container/README.md). */
const HOST = ["ci.sh", "real/run.sh", "real/mail/run.sh", "relock.sh"];
/** Tools: run by the guarded, by a developer in a checkout, and by unit tests on any machine; none does what the guard is for (container/README.md says what each does). */
const TOOLS = ["unit.sh", "no-pi-tools-fetch.sh", "no-toolchain-fetch.sh", "fake-oats.mjs", "real/bb-logs.sh", "real/bb-plugin-command.sh", "real/bb-plugin-command.test.sh", "real/oats-record.mjs", "real/mock-anthropic.mjs", "real/pi/mock-openai.mjs"];
/** Modules: imported, never run (the guards themselves among them). */
const MODULES = ["guard.sh", "guard.mjs", "browser.mjs", "contrast.mjs", "files.mjs", "images.mjs", "tmux-roster.mjs", "real/fixtures.mjs"];
const MODULE_DIRECTORIES = ["scenes/", "real/parts/"];

/**
 * WHERE THE MARK IS (the image), a refusal can only be asked for by the guard's own switch; where it is NOT (a
 * person's machine; and the unit stage's SECOND pass of this file, for which ci.sh moves the mark away), nothing is
 * passed: the guard refuses because the mark is truly absent. That second pass is what fails a guard that no longer
 * looks for the mark.
 */
const MARKED = existsSync(MARK);
const ABSENT: Record<string, string> = MARKED ? { OATS_BB_CHECKS_MARK_ABSENT: "1" } : {};

/** Every end of a line a shell or JavaScript knows: a bare CR ends a `//` comment too. */
const LINE_END = /\r\n|[\n\r\u2028\u2029]/;
/** The first line of a script that DOES something: after the shebang, blank lines and whole-line comments. A statement on a comment's line counts. */
function firstEffective(script: string, runner: "sh" | "bash" | "node"): string | undefined {
  const lines = readFileSync(join(CONTAINER, script), "utf8").split(LINE_END);
  if (runner !== "node") return lines.slice(1).find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  let inComment = false;
  for (const [index, line] of lines.entries()) {
    let rest = line;
    if (inComment) {
      if (!rest.includes("*/")) continue;
      rest = rest.slice(rest.indexOf("*/") + 2);
      inComment = false;
    }
    for (;;) {
      rest = rest.trimStart();
      if (rest.startsWith("/*")) {
        if (!rest.includes("*/")) {
          inComment = true;
          rest = "";
        } else rest = rest.slice(rest.indexOf("*/") + 2);
      } else break;
    }
    if (rest === "" || rest.startsWith("//") || (index === 0 && rest.startsWith("#!"))) continue;
    return line;
  }
  return undefined;
}
/** The one line a guarded script must have first. */
function guardLine(script: string, runner: "sh" | "bash" | "node"): string {
  const up = relative(dirname(join(CONTAINER, script)), CONTAINER); // "" beside the guard, "..", "../..", or a path back into this directory
  return runner === "node"
    ? `import "${up === "" ? "." : up}/guard.mjs"; // FIRST: refuses outside the checks' container, before anything is touched`
    : `. "$(dirname "$0")/${up === "" ? "" : `${up}/`}guard.sh" || exit 97 # refuses outside the checks' container, before anything is touched (and where the guard itself is not beside it)`;
}
/**
 * THE GUARD ITSELF REFUSES HERE, run alone (it touches nothing): asked with the environment the entries are started
 * with. Read once, before any entry is started: with a guard that no longer refuses, NO entry is started by this test.
 */
function guardRefusesAlone(): string {
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ...ABSENT };
  const shell = spawnSync("sh", ["-c", `. "${join(CONTAINER, "guard.sh")}"; echo ran`], { encoding: "utf8", env });
  const node = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(join(CONTAINER, "guard.mjs"))}); console.log("ran");`], { encoding: "utf8", env });
  return JSON.stringify([shell.status, shell.stdout, node.status, node.stdout]);
}
let refusesAlone: string | undefined;
/**
 * BEFORE this test RUNS a guarded script (on whatever machine vitest runs on), it has seen that the guard, alone,
 * refuses here, and has READ that the guard is the script's first line that does something and that a shell
 * script's line 1 is a plain shebang: a script whose guard is lost, or has a statement above it, or whose guard no
 * longer refuses, is never started here.
 */
function readToBeGuarded(script: string, runner: "sh" | "bash" | "node") {
  refusesAlone ??= guardRefusesAlone();
  expect(refusesAlone).toBe(JSON.stringify([97, "", 97, ""]));
  const first = readFileSync(join(CONTAINER, script), "utf8").split(LINE_END)[0];
  if (runner !== "node") expect([script, first]).toEqual([script, runner === "bash" ? "#!/bin/bash" : "#!/bin/sh"]);
  expect([script, firstEffective(script, runner)]).toEqual([script, guardLine(script, runner)]);
}

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
    readToBeGuarded(script, runner);
    const person = home();
    const before = holds(person);
    const ran = spawnSync(runner === "node" ? process.execPath : runner, [join(CONTAINER, script)], {
      cwd: person,
      encoding: "utf8",
      timeout: 30_000,
      // (Nothing of the test's own environment is passed; the switch only where the mark is: `ABSENT`.)
      env: { HOME: person, USER: "person", PATH: `${join(person, ".local", "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`, ...ABSENT },
    });
    expect([ran.status, ran.signal, ran.stdout]).toEqual([97, null, ""]);
    expect(ran.stderr).toBe(`refused: ${script.slice(script.lastIndexOf("/") + 1)} runs only inside the container of the oats-bb plugin checks (it changes the machine it runs on); start it with plugin/container/ci.sh, never by hand\n`);
    expect(holds(person)).toEqual(before);
  });

  it("the guard is the FIRST thing a guarded script does: before its own first statement, and before any other import; a shell script's line 1 is a plain shebang", () => {
    for (const [script, runner] of Object.entries(GUARDED)) readToBeGuarded(script, runner);
  });

  it("what counts as a script's first line that does something: a statement on a comment's line, or on line 1, is one", () => {
    // (Held on made-up scripts: `firstEffective` reads from the container directory, so they are written beside it, in the system's temporary directory, and read by a path that leads there.)
    const directory = mkdtempSync(join(tmpdir(), "oats-bb-guard-first-"));
    made.push(directory);
    const first = (text: string, runner: "sh" | "node") => {
      writeFileSync(join(directory, "script"), text);
      return firstEffective(relative(CONTAINER, join(directory, "script")), runner);
    };
    expect(first('// a comment\n/* one */\n/*\n * a block\n */\n\nimport "./guard.mjs";\nimport "./x.mjs";\n', "node")).toBe('import "./guard.mjs";');
    expect(first('/* */ import "./evil.mjs";\nimport "./guard.mjs";\n', "node")).toBe('/* */ import "./evil.mjs";');
    expect(first('/*\n a block */ await import("./evil.mjs");\nimport "./guard.mjs";\n', "node")).toBe(' a block */ await import("./evil.mjs");');
    expect(first('#!/usr/bin/env node\nrmSync(home);\nimport "./guard.mjs";\n', "node")).toBe("rmSync(home);");
    expect(first('// a comment\rimport "./evil.mjs";\nimport "./guard.mjs";\n', "node")).toBe('import "./evil.mjs";'); // a bare CR ends the comment
    expect(first("#!/bin/sh\n# a comment\n\n  # another\n. ./guard.sh\nrm -rf x\n", "sh")).toBe(". ./guard.sh");
    expect(first("#!/bin/sh\n: > /tmp/x # a comment\n. ./guard.sh\n", "sh")).toBe(": > /tmp/x # a comment");
  });

  it("the unit stage runs this file a second time where the mark is truly gone, and this is that pass when ci.sh says so", () => {
    // ci.sh moves the mark away as root, says which pass it is, and puts the mark back whatever the test said.
    const ci = readFileSync(join(CONTAINER, "ci.sh"), "utf8");
    expect(ci).toContain(`  docker exec -u root "$NAME" mv ${MARK} ${MARK}.moved\n  gone=0\n  run env OATS_BB_GUARD_PASS=mark-gone npx vitest run test/container-guard.test.ts || gone=$?\n  docker exec -u root "$NAME" mv ${MARK}.moved ${MARK}\n`);
    expect(ci.match(/^ {4}run sh container\/unit\.sh\n {4}mark_gone_pass$/gm)?.length).toBe(2); // in `unit` and in `all`
    expect(ci.match(/run sh container\/unit\.sh/g)?.length).toBe(2);
    // …and from its clean-up too, first of all: an interrupted pass does not leave a kept container without its mark.
    expect(ci).toContain(`cleanup() {\n  status=$?\n  docker exec -u root "$NAME" sh -c '[ ! -e ${MARK}.moved ] || mv ${MARK}.moved ${MARK}' > /dev/null 2>&1 || true\n`);
    // In that pass the mark IS gone: every refusal above was made with no switch.
    if (process.env.OATS_BB_GUARD_PASS === "mark-gone") expect([MARKED, ABSENT]).toEqual([false, {}]);
    else expect(process.env.OATS_BB_GUARD_PASS).toBeUndefined();
  });

  it.each(Object.entries(GUARDED).filter(([, runner]) => runner !== "node"))("%s, copied somewhere WITHOUT the guard beside it, does not run on: it ends there, and changes nothing", (script, runner) => {
    // (bash goes on after a `.` of a file that is not there: `|| exit 97` on the guard's own line stops it. A `.mjs` whose import is not there does not load at all.)
    readToBeGuarded(script, runner);
    const person = home();
    const alone = mkdtempSync(join(tmpdir(), "oats-bb-guard-alone-"));
    made.push(alone);
    // The copy sits DEEP in the private directory: the path its guard line leads to (up to four levels, then down) stays
    // inside that directory, where nothing is: never a `guard.sh` of the system's temporary directory or of `/`.
    const name = script.slice(script.lastIndexOf("/") + 1);
    const copy = join(alone, "a", "b", "c", "d", "e", name);
    const guardOfCopy = resolve(dirname(copy), relative(dirname(join(CONTAINER, script)), CONTAINER), "guard.sh");
    expect([guardOfCopy.startsWith(`${alone}/`), existsSync(guardOfCopy)]).toEqual([true, false]);
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, readFileSync(join(CONTAINER, script)));
    const before = holds(person);
    const ran = spawnSync(runner, [copy], { cwd: person, encoding: "utf8", timeout: 30_000, env: { HOME: person, USER: "person", PATH: `${join(person, ".local", "bin")}:${dirname(process.execPath)}:/usr/bin:/bin` } });
    expect([ran.status !== 0 && ran.status !== null, ran.stdout, runner === "bash" ? ran.status : 97]).toEqual([true, "", 97]);
    expect(ran.stderr).toMatch(/guard\.sh/);
    expect(holds(person)).toEqual(before);
    expect((readdirSync(alone, { recursive: true }) as string[]).filter((entry) => statSync(join(alone, entry)).isFile())).toEqual([join("a", "b", "c", "d", "e", name)]);
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

  it("every file of the directory that can be run is in one of the lists: a new one is CLASSIFIED by whoever adds it", () => {
    // WHAT THIS IS: a reminder to classify, NOT a proof that an unguarded script is harmless: no pattern can tell
    // that. Whoever adds a file here must put it in a list, and reads the lists' rule when they do; the review of
    // that change is what holds a wrong classification. What IS proven is above: each guarded entry refuses.
    // Every file counts but documents and data (a script under another extension is not let through unlisted).
    const NOT_RUN = /(^|\/)(Dockerfile|\.gitignore)$|\.(md|json|yml|ts|png)$/;
    const files = (readdirSync(CONTAINER, { recursive: true }) as string[])
      .filter((name) => statSync(join(CONTAINER, name)).isFile() && !/(^|\/)out(\.|\/|$)/.test(name) && !name.startsWith("locks/") && !NOT_RUN.test(name))
      .sort();
    const listed = [...Object.keys(GUARDED).filter((name) => !name.startsWith("../")), ...HOST, ...TOOLS, ...MODULES].sort();
    expect(files.filter((name) => !MODULE_DIRECTORIES.some((directory) => name.startsWith(directory)))).toEqual(listed);
    expect(new Set(listed).size).toBe(listed.length);
    // A module directory holds `.mjs` modules alone, none made to be run by itself (no shebang).
    for (const name of files.filter((name) => MODULE_DIRECTORIES.some((directory) => name.startsWith(directory)))) expect([name, name.endsWith(".mjs") && !/^#!/.test(readFileSync(join(CONTAINER, name), "utf8"))]).toEqual([name, true]);
    // A script that is NOT guarded does not do, in so many words, what the guarded do to a person's tools and settings (a host script starts a container for that).
    const CHANGES = /\.away\b|\bnpm (install|i) (-g|--global)|\.claude\/settings\.json|concurrency-limit["', ]+host|\.local\/bin\/(oats|claude)|\bln -sf\b/;
    for (const script of [...TOOLS, ...MODULES]) expect([script, CHANGES.test(readFileSync(join(CONTAINER, script), "utf8"))]).toEqual([script, false]);
    for (const script of HOST) expect([script, /\bdocker (run|exec|build)\b/.test(readFileSync(join(CONTAINER, script), "utf8"))]).toEqual([script, true]);
  });
});
