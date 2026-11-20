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
  // Git takes the whole content less its last line ends: a second line is part of the name.
  mkdirSync(join(root, "decoy"));
  for (const text of [`gitdir: ${join(root, "decoy")}\nx\n`, `gitdir:${gitDir}\n`, `gitdir:  ${gitDir}\n`, `gitdir: ${gitDir} \n`, "", "not a pointer", "gitdir:", `gitdir: ${"x".repeat(5000)}`, `gitdir: ${join(root, "nowhere")}\n`, `gitdir: ${gitDir}\n${"\n".repeat(5000)}`]) {
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

for (const [name, at] of [["a parenthesis", "dev (old)"], ["a wildcard", "dev*"], ["a line break", "dev\nx"], ["a bracket", "dev[1]"], ["a backslash", "dev\\b"]]) {
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

test("a tree that is a clone: its .git directory is covered as a git directory, and a commondir in it is followed as git follows it", (t) => {
  const { root, home, rules } = layout(t);
  const clone = join(home, "trees/clone");
  mkdirSync(join(clone, ".git"), { recursive: true });
  const got = paths(rules({ trees: [clone] }));
  for (const entry of [".git", ".git/config", ".git/config.worktree", ".git/hooks/**", ".git/commondir", ".git/gitdir"]) assert.ok(got.includes(join(clone, entry)), entry);
  // What the agent works with in a clone has no rule: the index, the objects, the refs.
  for (const entry of [".git/index", ".git/objects/**", ".git/refs/**", ".git/info/exclude"]) assert.equal(got.includes(join(clone, entry)), false, entry);
  // A commondir in a clone's .git: git reads config and hooks from the directory it names.
  mkdirSync(join(root, "elsewhere/git"), { recursive: true });
  writeFileSync(join(clone, ".git/commondir"), `${join(root, "elsewhere/git")}\n`);
  const followed = paths(rules({ trees: [clone] }));
  for (const entry of ["config", "config.worktree", "hooks/**"]) assert.ok(followed.includes(join(root, "elsewhere/git", entry)), entry);
  writeFileSync(join(clone, ".git/commondir"), "../nowhere\n");
  assert.throws(() => rules({ trees: [clone] }), (error) => error.code === "E_BACKEND_SANDBOX_PATH");
});

test("git's directories are covered under their real paths too, and a relative pointer is read from the tree's real path, as git reads it", (t) => {
  const { root, home, rules } = layout(t);
  // The clone is reached through a link in the pointer.
  const real = join(root, "realrepo"), gitDir = join(real, ".git/worktrees/w"), tree = join(home, "trees/w");
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(tree, { recursive: true });
  symlinkSync(real, join(root, "linkrepo"));
  writeFileSync(join(tree, ".git"), `gitdir: ${join(root, "linkrepo/.git/worktrees/w")}\n`);
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  const got = paths(rules({ trees: [tree] }));
  for (const base of [join(root, "linkrepo"), real]) {
    for (const entry of [".git/worktrees/w/config", ".git/worktrees/w/hooks/**", ".git/config", ".git/hooks/**"]) assert.ok(got.includes(join(base, entry)), join(base, entry));
  }
  // A tree named through a link, with a relative pointer (git 2.48 writes them): resolved
  // from where the tree really is, not from the link's own directory.
  const deep = join(root, "deep/a/b/tree"), relGitDir = join(root, "deep/a/b/gd");
  mkdirSync(deep, { recursive: true });
  mkdirSync(relGitDir);
  writeFileSync(join(deep, ".git"), "gitdir: ../gd\n");
  symlinkSync(deep, join(root, "treelink"));
  const viaLink = paths(rules({ trees: [join(root, "treelink")] }));
  assert.ok(viaLink.includes(join(relGitDir, "hooks/**")));
  assert.ok(viaLink.includes(join(root, "treelink/.git")) && viaLink.includes(join(deep, ".git")), "the pointer under both names of the tree");
});

// Git finds a pointer's and a commondir's directory through the filesystem: a link is
// followed before a ".." step is taken. Folding the ".." first names another directory.
test("a pointer or a commondir with a .. step after a link is resolved as git resolves it: the directory git uses is the one covered", (t) => {
  const { root, home, rules } = layout(t);
  // 1. A worktree's pointer names its git directory through a link; commondir is "../.." as git writes it.
  const repoGit = join(root, "real/repo/.git"), gitDir = join(repoGit, "worktrees/w2"), tree = join(home, "trees/w2");
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(tree, { recursive: true });
  mkdirSync(join(root, "x"));
  symlinkSync(gitDir, join(root, "x/wlink"));
  writeFileSync(join(tree, ".git"), `gitdir: ${join(root, "x/wlink")}\n`);
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  const first = paths(rules({ trees: [tree] }));
  for (const path of [join(root, "x/wlink/config"), join(gitDir, "config"), join(repoGit, "config"), join(repoGit, "hooks/**")]) assert.ok(first.includes(path), path);

  // 2. A relative pointer through a link in the tree, with a decoy where folding would land.
  const elsewhere = join(root, "elsewhere"), tree2 = join(home, "trees/t2");
  mkdirSync(join(elsewhere, "deep"), { recursive: true });
  mkdirSync(join(elsewhere, "realgit"));
  mkdirSync(join(tree2, "realgit"), { recursive: true });
  symlinkSync(join(elsewhere, "deep"), join(tree2, "sym"));
  writeFileSync(join(tree2, ".git"), "gitdir: sym/../realgit\n");
  const second = paths(rules({ trees: [tree2] }));
  assert.ok(second.includes(join(elsewhere, "realgit/config")) && second.includes(join(elsewhere, "realgit/hooks/**")), "the directory git uses");

  // 3. The same through a commondir.
  const gd = join(root, "gd"), tree3 = join(home, "trees/t3");
  mkdirSync(join(gd, "common"), { recursive: true });
  mkdirSync(join(elsewhere, "common"));
  mkdirSync(tree3, { recursive: true });
  symlinkSync(join(elsewhere, "deep"), join(gd, "sym"));
  writeFileSync(join(tree3, ".git"), `gitdir: ${gd}\n`);
  writeFileSync(join(gd, "commondir"), "sym/../common\n");
  const third = paths(rules({ trees: [tree3] }));
  assert.ok(third.includes(join(elsewhere, "common/config")) && third.includes(join(elsewhere, "common/hooks/**")), "the common directory git uses");
});

test("bb's thread storage is covered under its real path too: a storage linked from the data directory", (t) => {
  const { root, dataDir, rules } = layout(t);
  rmSync(join(dataDir, "thread-storage"), { recursive: true });
  mkdirSync(join(root, "disk/storage"), { recursive: true });
  symlinkSync(join(root, "disk/storage"), join(dataDir, "thread-storage"));
  const got = paths(rules());
  for (const base of [join(dataDir, "thread-storage"), join(root, "disk/storage")]) for (const entry of [".mcp.json", "CLAUDE.md", ".claude/**"]) assert.ok(got.includes(join(base, entry)), join(base, entry));
});
