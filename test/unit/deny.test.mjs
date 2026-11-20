// The deny rules of a sandboxed launch (contract item 6c, D16 rule 1): which paths the
// agent's tools are kept off, built from what the kernel says and from this host, never
// from anything the home holds.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { denyRules, treesRefusal } from "../../oats-package/capabilities/oats-bb/lib/deny.mjs";

/** /…/deploy/agents/dev/instances/dev-a as a home, a user home, a bb data directory and a
 *  temporary directory, all under one scratch directory. */
function layout(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-bb-deny-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "deploy/agents/dev/instances/dev-a"), userHome = join(root, "user"), dataDir = join(root, "user/.bb"), tmp = join(root, "tmp");
  for (const dir of [join(home, "work"), userHome, join(dataDir, "thread-storage"), tmp]) mkdirSync(dir, { recursive: true });
  return { root, home, userHome, dataDir, tmp, rules: (extra = {}) => denyRules({ home, dataDir, userHome, tmp, trees: [], ...extra }) };
}
const paths = (rules) => rules.map((rule) => { assert.match(rule, /^Edit\(\/\/.*\)$/); return rule.slice("Edit(/".length, -1); });

test("the home: OATS's copies and record, Claude's project configuration, the skills, the MCP servers, the messaging identity and the instructions", (t) => {
  const { home, rules } = layout(t);
  const got = paths(rules());
  for (const entry of [".oats/**", "instance.json", ".claude/**", ".agents/**", ".mcp.json", ".aw/signing.key", ".aw/workspace.yaml", "AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "TASK.md"]) {
    assert.ok(got.includes(join(home, entry)), entry);
  }
  // What the agent works in stays its own: its notes, its state, the work tree's files.
  for (const entry of ["STATE.md", "log.md", "notes/**", "work/**", "work", ".aw/**", ".aw"]) assert.equal(got.includes(join(home, entry)), false, entry);
});

test("every directory above the home: .mcp.json, CLAUDE.md and .claude/**, up to the root", (t) => {
  const { root, home, rules } = layout(t);
  const got = paths(rules());
  for (const above of [join(home, ".."), join(root, "deploy/agents/dev"), join(root, "deploy/agents"), join(root, "deploy"), root, tmpdir(), "/"]) {
    for (const entry of [".mcp.json", "CLAUDE.md", ".claude/**"]) assert.ok(got.includes(join(above, entry)), join(above, entry));
  }
  assert.equal(got.includes(join(root, "deploy/instance.json")), false, "an ancestor is not a home");
});

test("the user's Claude configuration, Claude's managed settings, bb's thread storage and bb's plugin directories", (t) => {
  const { userHome, dataDir, tmp, rules } = layout(t);
  const got = paths(rules());
  for (const path of [join(userHome, ".claude.json"), join(userHome, ".claude/**"), "/etc/claude-code/**",
    join(dataDir, "thread-storage/.mcp.json"), join(dataDir, "thread-storage/CLAUDE.md"), join(dataDir, "thread-storage/.claude/**"), join(tmp, "bb-provider-bridge-*/**")]) {
    assert.ok(got.includes(path), path);
  }
  assert.equal(got.some((path) => path.startsWith(join(dataDir, "bb.db"))), false, "bb's own files are bb's to protect");
});

test("a launch that names no trees is refused: only the kernel knows a home's trees, and git runs their config and hooks outside the sandbox", (t) => {
  const { rules } = layout(t);
  for (const trees of [undefined, null, "work", { 0: "/srv/tree" }]) {
    assert.throws(() => rules({ trees }), (error) => error.code === "E_BACKEND_SANDBOX_TREES" && /no "trees".*upgrade OATS.*--yolo/.test(error.message) && error.message.length < 500, String(trees));
  }
  assert.deepEqual(treesRefusal([]), null, "a home with no tree at all names an empty list");
});

test("the trees the kernel names: a clone's own .git, and a worktree's pointer with the git directory and the common directory behind it", (t) => {
  const { root, home, rules } = layout(t);
  const clone = join(root, "deploy/repo"), tree = join(home, "trees/fix"), gitDir = join(clone, ".git/worktrees/fix");
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, ".git"), `gitdir: ${gitDir}\n`);
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  const got = paths(rules({ trees: [join(home, "work"), tree] }));
  for (const path of [join(home, "work/.git"), join(home, "work/.git/config"), join(home, "work/.git/hooks/**"), join(tree, ".git"),
    join(gitDir, "config"), join(gitDir, "hooks/**"), join(clone, ".git/config"), join(clone, ".git/hooks/**")]) {
    assert.ok(got.includes(path), path);
  }
  // No tree named: none is covered, the home's work/ included (the kernel said so).
  assert.equal(paths(rules({ trees: [] })).some((path) => path.includes("/.git")), false);
  assert.ok(got.includes(join(gitDir, "commondir")) && got.includes(join(gitDir, "gitdir")), "the two files that say where git's directories are");
  // A tree with no .git at all (a home in directory work mode) has no git directory to cover.
  mkdirSync(join(home, "plain"));
  assert.equal(paths(rules({ trees: [join(home, "plain")] })).some((path) => path.startsWith(clone)), false);
});

// Git reads a pointer or a commondir this provider may not be able to, and then runs the
// config and hooks of a directory no rule covers: so what cannot be read refuses the launch.
test("a .git pointer or a commondir that is there and cannot be read as one short line naming a directory refuses the launch: never skipped", (t) => {
  const { root, home, rules } = layout(t);
  const clone = join(root, "deploy/repo"), tree = join(home, "trees/fix"), gitDir = join(clone, ".git/worktrees/fix");
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(tree, { recursive: true });
  const refused = (what) => assert.throws(() => rules({ trees: [tree] }), (error) => error.code === "E_BACKEND_SANDBOX_PATH" && /git worktree repair.*--yolo/.test(error.message) && error.message.length < 600, what);
  const pointer = (text) => { rmSync(join(tree, ".git"), { force: true }); writeFileSync(join(tree, ".git"), text); };
  for (const text of ["", "not a pointer", "gitdir:", `gitdir: ${"x".repeat(5000)}`, `gitdir: ${join(root, "nowhere")}\n`, `gitdir: ${gitDir}\n${"\n".repeat(5000)}`]) {
    pointer(text);
    refused(`pointer ${JSON.stringify(text.slice(0, 30))}`);
  }
  // A pointer that is a link to a real pointer file: git follows it.
  writeFileSync(join(root, "real-pointer"), `gitdir: ${gitDir}\n`);
  rmSync(join(tree, ".git"));
  symlinkSync(join(root, "real-pointer"), join(tree, ".git"));
  refused("a pointer that is a link");
  // A good pointer, and a commondir git would still read.
  pointer(`gitdir: ${gitDir}\n`);
  assert.ok(paths(rules({ trees: [tree] })).includes(join(gitDir, "hooks/**")), "no commondir: the git directory alone");
  const commondir = join(gitDir, "commondir");
  for (const [what, make] of [
    ["padded past what is read", () => writeFileSync(commondir, `../..\n${"\n".repeat(5000)}`)],
    ["a link to a file", () => { writeFileSync(join(root, "real-commondir"), "../..\n"); symlinkSync(join(root, "real-commondir"), commondir); }],
    ["empty", () => writeFileSync(commondir, "")],
    ["naming no directory", () => writeFileSync(commondir, "../../../nowhere\n")],
    ["a directory", () => mkdirSync(commondir)],
  ]) {
    rmSync(commondir, { recursive: true, force: true });
    make();
    refused(`commondir ${what}`);
  }
  // One that names another directory is believed, as git believes it: that directory is covered.
  rmSync(commondir, { recursive: true, force: true });
  mkdirSync(join(home, "notes/other"), { recursive: true });
  writeFileSync(commondir, `${join(home, "notes/other")}\n`);
  const got = paths(rules({ trees: [tree] }));
  assert.ok(got.includes(join(home, "notes/other/hooks/**")) && got.includes(commondir));
});


test("a home reached through a link is covered under both names, and so are its ancestors", (t) => {
  const { root, home, rules } = layout(t);
  const link = join(root, "link-to-home");
  symlinkSync(home, link);
  const got = paths(rules({ home: link }));
  for (const path of [join(link, ".oats/**"), join(home, ".oats/**"), join(link, "instance.json"), join(home, "instance.json"), join(root, ".mcp.json"), join(home, "../.mcp.json")]) {
    assert.ok(got.includes(path), path);
  }
});

test("the rules are the same for the same input, each once, and none is a path the syntax cannot carry", (t) => {
  const { rules } = layout(t);
  const first = rules();
  assert.deepEqual(rules(), first);
  assert.equal(new Set(first).size, first.length);
  for (const rule of first) assert.doesNotMatch(rule.slice("Edit(".length, -1), /[()\n]/);
});

for (const [name, at] of [["a parenthesis", "dev (old)"], ["a wildcard", "dev*"], ["a line break", "dev\nx"], ["a bracket", "dev[1]"]]) {
  test(`a home whose path holds ${name} refuses a sandboxed launch: a rule that could not be written would leave a path writable`, (t) => {
    const { root, dataDir, userHome, tmp } = layout(t);
    const home = join(root, at, "home");
    mkdirSync(home, { recursive: true });
    assert.throws(() => denyRules({ home, dataDir, userHome, tmp, trees: [] }), (error) => error.code === "E_BACKEND_SANDBOX_PATH" && /full mode \(--yolo\)/.test(error.message));
  });
}

test("a tree the kernel names that is no exact absolute path, or no directory, refuses the launch: never skipped", (t) => {
  const { root, rules } = layout(t);
  writeFileSync(join(root, "a-file"), "");
  for (const tree of ["work", "/srv/../etc", "/srv/tree*", "/", 7, null, join(root, "not-there"), join(root, "a-file"), `${root}/nul\0byte`]) {
    assert.throws(() => rules({ trees: [tree] }), { code: "E_BACKEND_SANDBOX_PATH" }, String(tree));
  }
});
