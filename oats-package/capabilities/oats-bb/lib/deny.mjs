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
// In every directory above the home: what Claude loads from a parent of its project.
const ANCESTOR_ENTRIES = [".mcp.json", "CLAUDE.md", ".claude/**"];
// bb's thread storage (bb passes it to Claude as an added directory): not loaded as
// configuration today, denied so it never is.
const STORAGE_ENTRIES = [".mcp.json", "CLAUDE.md", ".claude/**"];
// Claude's managed settings: root-owned, so the system already refuses; the rule costs nothing.
const MANAGED = "/etc/claude-code/**";
// bb builds its Claude plugin directory under the system's temporary directory.
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

/** The first line of a small regular file, or null: a tree's `.git` pointer and a git
 *  directory's `commondir`. Never follows a link, never waits, reads at most 4 KiB. */
function firstLine(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > 4096) return null;
  let fd = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return null;
    const buffer = Buffer.alloc(4096);
    const got = readSync(fd, buffer, 0, 4096, 0);
    return buffer.subarray(0, got).toString("utf8").split("\n")[0].trim();
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}

/** The git directories behind a tree: where `<tree>/.git` is a pointer file (a worktree),
 *  the directory it names and that one's common directory (the clone's `.git`, whose
 *  config and hooks git runs for every worktree). A pointer that names nothing usable
 *  adds nothing: the pointer itself is denied either way. */
function gitDirsOf(tree) {
  const pointer = firstLine(join(tree, ".git"));
  const named = pointer?.startsWith("gitdir:") ? pointer.slice("gitdir:".length).trim() : null;
  if (!named) return [];
  const gitDir = resolve(tree, named);
  const common = firstLine(join(gitDir, "commondir"));
  return [gitDir, ...(common ? [resolve(gitDir, common)] : [])];
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
 *  silently missing would leave that path writable. */
export function denyRules({ home, trees, dataDir, userHome = homedir(), tmp = tmpdir() }) {
  const paths = [];
  for (const root of withReal(home)) {
    for (const entry of HOME_ENTRIES) paths.push(join(root, entry));
    for (const above of ancestors(root)) for (const entry of ANCESTOR_ENTRIES) paths.push(join(above, entry));
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
      for (const gitDir of gitDirsOf(root)) paths.push(join(gitDir, "config"), join(gitDir, "hooks/**"));
    }
  }
  for (const root of withReal(dataDir)) for (const entry of STORAGE_ENTRIES) paths.push(join(root, "thread-storage", entry));
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
  return { rules };
}

/** The deny rules of a launch in a sandboxed mode, with the one check of this host they
 *  need first: bb's data directory must be the one bb uses, or its thread storage would go
 *  uncovered. The launch and the check of a planned launch share it. → rules. Throws
 *  E_BACKEND_SETTINGS, E_BACKEND_SANDBOX_TREES, E_BACKEND_SANDBOX_PATH. */
export function sandboxDeny({ mode, home, trees, dataDir }) {
  checkDataDir(mode, dataDir);
  return denyRules({ home, trees, dataDir }).rules;
}

/** bb does not say where its data directory is: a wrong setting would leave bb's thread
 *  storage out of the deny rules, with nothing to show it. Throws E_BACKEND_SETTINGS. */
export function checkDataDir(mode, dataDir) {
  if (statSync(join(dataDir, "thread-storage"), { throwIfNoEntry: false })?.isDirectory()) return;
  throw fail("E_BACKEND_SETTINGS", `settings.oats.bb.dataDir (${dataDir}) holds no thread-storage directory, so it is not this bb's data directory: a launch in bb's ${mode} mode must keep the agent's tools off bb's thread storage there. Set it in oats-local.yaml to the directory bb-app runs with (its --data-dir), or launch in full mode (--yolo)`);
}
