// The deny rules a sandboxed launch writes (contract item 6c, D16 rule 1).
//
// In bb's sandboxed modes the agent can write its own home and more, and some of what it
// can write is later run, or read as configuration, OUTSIDE its sandbox: OATS's module
// copies and hooks, Claude's settings, `.mcp.json`, git's config and hooks. Each path
// below gets a `permissions.deny` rule `Edit(//<absolute path>)` in the home's
// `.claude/settings.local.json`; Claude refuses its Edit and Write tools there, and makes
// the same paths read-only for sandboxed Bash.
//
// These rules are a defence against accidents, not a boundary: bb lets a command leave the
// sandbox, and an unsandboxed command writes past them (the README says so).
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fail } from "./errors.mjs";

// In the home: OATS's module copies and its record of the instance, Claude's project
// configuration, the skills, the MCP servers, the messaging identity (the key stays
// readable: aw signs with it), the instructions OATS composes and the kernel's task, the
// memory file Claude loads at every launch. (The provider keeps nothing of its own in the home.)
const HOME_ENTRIES = [".oats/**", "instance.json", ".claude/**", ".agents/**", ".mcp.json", ".aw/signing.key", ".aw/workspace.yaml",
  "AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "TASK.md"];
// What Claude loads as configuration from a directory: denied in every directory above
// the home (Claude loads it from a parent of its project), and in bb's thread storage
// (bb passes it to Claude as an added directory; not loaded today, denied so it never is).
const CONFIG_ENTRIES = [".mcp.json", "CLAUDE.md", ".claude/**"];
// Claude's managed settings: root-owned, so the system already refuses; the rule costs nothing.
const MANAGED = "/etc/claude-code/**";
// bb builds its Claude plugin directory under the system's temporary directory: taken
// from this process's own (os.tmpdir()), which is bb's where both run with the same TMPDIR.
const PLUGIN_DIRS = "bb-provider-bridge-*/**";

// A path a rule can carry: absolute, normal, and free of what the rule's own syntax uses
// (parentheses, a line break) or would widen (a wildcard in a path that is not ours to widen).
const CARRIABLE = /^\/[^()\x00-\x1f\x7f*?[\]{}]*$/;
const carriable = (path) => typeof path === "string" && isAbsolute(path) && normalize(path) === path && path !== "/" && CARRIABLE.test(path);

const rule = (path) => `Edit(/${path})`;

/** The directories above `dir`, nearest first, the root included (`/x/y` → `/x`, `/`). */
function ancestors(dir) {
  const out = [];
  for (let at = dirname(dir); ; at = dirname(at)) {
    out.push(at);
    if (at === dirname(at)) return out;
  }
}

/** The path and, where it differs, the path it resolves to: a home reached through a link
 *  is protected under both names. */
function withReal(path) {
  try {
    const real = realpathSync(path);
    return real === path ? [path] : [path, real];
  } catch { return [path]; }
}

/** The first line of a small regular file: a tree's `.git` pointer and a git
 *  directory's `commondir`. Never follows a link, never waits, reads at most 4 KiB.
 *  → the line, undefined where there is no such name, null where the name is there and is
 *  not a small regular file that can be read (git may still read it: the caller refuses). */
function firstLine(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.size > 4096) return null;
  let fd = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return null;
    const buffer = Buffer.alloc(4096);
    const got = readSync(fd, buffer, 0, 4096, 0);
    return buffer.subarray(0, got).toString("utf8").split("\n")[0].trim();
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}

const isDirectory = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

/** The git directories behind a tree whose `.git` is not a directory (a linked worktree):
 *  the directory its pointer names, and that one's common directory (the clone's `.git`,
 *  whose config and hooks git runs for every worktree). → [] where the tree has no `.git`
 *  or its `.git` is a directory (covered by the tree's own rules).
 *
 *  Git reads a pointer and a `commondir` this module may not be able to (a link to one,
 *  a file padded past 4 KiB), and then runs the config and hooks of a directory no rule
 *  covers. So a `.git` or a `commondir` that is there and cannot be read as a small
 *  regular file naming a directory refuses the launch (E_BACKEND_SANDBOX_PATH): a rule
 *  silently missing is the failure that matters. */
function gitDirsOf(tree) {
  const refuse = (what) => fail("E_BACKEND_SANDBOX_PATH", `the tree ${tree} has ${what}, so the sandbox's deny rules cannot cover the git directory that git would use there: repair the tree (git worktree repair), or launch in full mode (--yolo)`);
  const at = join(tree, ".git");
  const stat = lstatSync(at, { throwIfNoEntry: false });
  if (!stat || stat.isDirectory()) return [];
  const pointer = firstLine(at);
  const named = typeof pointer === "string" && pointer.startsWith("gitdir:") ? pointer.slice("gitdir:".length).trim() : "";
  if (!named) throw refuse("a .git that is neither a directory nor a readable pointer file (gitdir: <path>)");
  const gitDir = resolve(tree, named);
  if (!isDirectory(gitDir)) throw refuse(`a .git pointer that names no directory (${gitDir.slice(0, 160)})`);
  const common = firstLine(join(gitDir, "commondir"));
  if (common === undefined) return [gitDir];
  if (!common) throw refuse(`a git directory whose commondir cannot be read as one short line (${gitDir.slice(0, 160)})`);
  const commonDir = resolve(gitDir, common);
  if (!isDirectory(commonDir)) throw refuse(`a git directory whose commondir names no directory (${commonDir.slice(0, 160)})`);
  return [gitDir, commonDir];
}

/** Why a sandboxed launch that names no trees cannot be taken, or null. Git runs a tree's
 *  config and hooks outside any sandbox, and only the kernel knows a home's trees (the
 *  home's own record of them is its agent's to write): a launch that does not name them
 *  would leave some uncovered, so it is refused. → {code, message} | null. */
export function treesRefusal(trees) {
  if (Array.isArray(trees)) return null;
  return { code: "E_BACKEND_SANDBOX_TREES", message: `this launch would run in one of bb's sandboxed modes and its input has no "trees" (the list of the home's work tree and extra trees), so the deny rules could not cover git's config and hooks there, which git runs outside the sandbox. An OATS kernel that protects a provider home's files sends it: upgrade OATS to the release this provider names as its floor, or launch in full mode (--yolo)` };
}

/** The `permissions.deny` rules of a sandboxed launch, in a stable order, each once.
 *  `trees` is the home's work tree and extra trees, as the kernel names them: a launch
 *  that names none is refused (treesRefusal).
 *  A path a rule cannot carry refuses the launch (E_BACKEND_SANDBOX_PATH): a rule that is
 *  silently missing would leave that path writable. → [rule]. */
export function denyRules({ home, trees, dataDir, userHome = homedir(), tmp = tmpdir() }) {
  const paths = [];
  for (const root of withReal(home)) {
    for (const entry of HOME_ENTRIES) paths.push(join(root, entry));
    for (const above of ancestors(root)) for (const entry of CONFIG_ENTRIES) paths.push(join(above, entry));
  }
  // The configuration bb's Claude runs with: the user-scope state file and directory of
  // the OS user that runs bb, which is the user this provider runs as. (A launch that
  // sets CLAUDE_CONFIG_DIR is refused, so the path is known.)
  for (const root of withReal(userHome)) paths.push(join(root, ".claude.json"), join(root, ".claude/**"));
  paths.push(MANAGED);
  const missing = treesRefusal(trees);
  if (missing !== null) throw fail(missing.code, missing.message);
  for (const tree of trees) {
    if (!carriable(tree)) throw fail("E_BACKEND_SANDBOX_PATH", `the launch names a tree the sandbox's deny rules cannot carry (${JSON.stringify(typeof tree === "string" ? tree.slice(0, 120) : null)}): one exact absolute path, with no wildcard or parenthesis`);
    // Named, it must be there: a tree that is no directory is refused, never skipped.
    if (!statSync(tree, { throwIfNoEntry: false })?.isDirectory()) throw fail("E_BACKEND_SANDBOX_PATH", `the launch names a tree that is not a directory (${tree}): the sandbox's deny rules cover each tree the kernel names, and this one cannot be read`);
    for (const root of withReal(tree)) {
      // The pointer (or the directory's own config and hooks), whatever is there now.
      paths.push(join(root, ".git"), join(root, ".git/config"), join(root, ".git/hooks/**"));
      // Behind a worktree's pointer: config and hooks of both directories, and the two
      // files that say where they are (git follows them; rewritten, it would use another).
      for (const gitDir of gitDirsOf(root)) paths.push(join(gitDir, "config"), join(gitDir, "hooks/**"), join(gitDir, "commondir"), join(gitDir, "gitdir"));
    }
  }
  for (const root of withReal(dataDir)) for (const entry of CONFIG_ENTRIES) paths.push(join(root, "thread-storage", entry));
  for (const root of withReal(tmp)) paths.push(join(root, PLUGIN_DIRS));

  const rules = [];
  for (const path of paths) {
    // The wildcards are this module's own, at the end of a path it built; what stands
    // before them must be a plain path.
    const base = path.replace(/\/(\*\*|bb-provider-bridge-\*\/\*\*)$/, "");
    if (!carriable(base)) throw fail("E_BACKEND_SANDBOX_PATH", `a path the sandbox's deny rules must cover cannot be written as a rule (${JSON.stringify(base.slice(0, 160))}): it holds a wildcard, a parenthesis or a control character. Run this home in full mode (--yolo), or move it to a path without them`);
    const text = rule(path);
    if (!rules.includes(text)) rules.push(text);
  }
  return rules;
}

/** The deny rules of a launch in a sandboxed mode, with the one check of this host they
 *  need first: bb's data directory must be the one bb uses, or its thread storage would go
 *  uncovered. The launch and the check of a planned launch share it. → rules. Throws
 *  E_BACKEND_SETTINGS, E_BACKEND_SANDBOX_TREES, E_BACKEND_SANDBOX_PATH. */
export function sandboxDeny({ mode, home, trees, dataDir }) {
  checkDataDir(mode, dataDir);
  return denyRules({ home, trees, dataDir });
}

/** bb does not say where its data directory is: a wrong setting would leave bb's thread
 *  storage out of the deny rules, with nothing to show it. Throws E_BACKEND_SETTINGS. */
export function checkDataDir(mode, dataDir) {
  if (!isAbsolute(dataDir) || normalize(dataDir) !== dataDir || dataDir === "/") throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.dataDir must be an absolute path with no . or .. step: a launch in bb's ${mode} mode reads it to keep the agent's tools off bb's thread storage. Set it in oats-local.yaml, or launch in full mode (--yolo)`);
  if (statSync(join(dataDir, "thread-storage"), { throwIfNoEntry: false })?.isDirectory()) return;
  throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.dataDir (${dataDir}) holds no thread-storage directory, so it is not this bb's data directory: a launch in bb's ${mode} mode must keep the agent's tools off bb's thread storage there. Set it in oats-local.yaml to the directory bb-app runs with (its --data-dir), or launch in full mode (--yolo)`);
}
