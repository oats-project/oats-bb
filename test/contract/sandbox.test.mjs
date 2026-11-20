// The contract test of bb's sandboxed modes (contract item 6c, D16 rules 1, 2 and 4): the
// provider against the pinned bb-app and Claude Code, in a container whose image lets
// Claude Code's sandbox really start (test/contract/sandbox/Dockerfile). The first contract
// file's image has no sandbox runtime on purpose; this one is where a sandboxed launch is
// shown to keep the agent's tools off what runs, or is read as configuration, outside the
// sandbox, and where the limit of that is pinned too (rule 4: the agent can leave it).
//
// Run: npm run test:contract (needs docker, and a host that lets a container make user
// namespaces: the container runs with seccomp, apparmor and systempaths unconfined).
// Again on every bump of bb-app or Claude Code.
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { BB_VERSION, MODEL, rig, waitFor } from "./rig.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEPLOYMENT = "/home/node/deployment";
const EVENTS = `${DEPLOYMENT}/.agents/events`;
const INSTANCES = `${DEPLOYMENT}/agents/soul/instances`;
const CLONE = `${DEPLOYMENT}/repo`;
const DATA = "/home/node/bbdata";
const MOVE_TOOL = "mcp__bb-bridge__update_environment_directory";
// What the kernel keeps outside the home and names as protected: its own copy of a home's
// modules (it runs hooks from there, and the harness runs what they name), and the
// retirement directory. (The paths are this test's; the kernel names its own.)
const COPIES = `${DEPLOYMENT}/.oats/kernel-modules`;
const RETIREMENT = `${INSTANCES}/.oats-retirement`;

const box = rig({
  name: `oats-bb-contract-sandbox-${process.pid}`,
  image: `oats-bb-contract-sandbox:${BB_VERSION}`,
  dockerfileDir: resolve(here, "sandbox"),
  // What bubblewrap needs to make its namespaces inside a container.
  runArgs: ["--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined", "--security-opt", "systempaths=unconfined"],
  settings: { version: BB_VERSION, trust: "container", dataDir: DATA },
  // The provider's own command takes no sandboxed launch (not offered): the tests' entry does.
  entry: "/repo/test/fixtures/sandboxed-bin.mjs",
});
const { sh, provider, toolCall } = box;

/** A home as the kernel leaves one, with what a sandboxed agent must not change: OATS's
 *  module copies and record, Claude's project configuration, a skill, the messaging
 *  identity, the instructions; and `work/`, a linked worktree of the deployment's clone. */
async function makeHome(name) {
  const home = `${INSTANCES}/${name}`;
  await sh([
    `mkdir -p ${home}/.oats/modules ${home}/.claude ${home}/.agents/skills/a ${home}/.aw ${home}/notes ${EVENTS}`,
    `test -d ${CLONE} || (git init -q ${CLONE} && git -C ${CLONE} -c user.name=t -c user.email=t@example.org commit -q --allow-empty -m first)`,
    `git -C ${CLONE} worktree add -q ${home}/work -b agents/${name}`,
    `git -C ${CLONE} worktree add -q ${home}/trees/extra -b agents/${name}-extra`,
    // And a tree that is a clone of its own: its .git is a directory, in the home.
    `git init -q ${home}/trees/clone && git -C ${home}/trees/clone -c user.name=t -c user.email=t@example.org commit -q --allow-empty -m first`,
    `printf '#!/bin/sh\\necho hook\\n' > ${home}/.oats/modules/hook.sh`,
    `mkdir -p ${COPIES}/${name}/hooks ${RETIREMENT} && printf '#!/bin/sh\\necho ran-from-the-kernel-copy\\n' > ${COPIES}/${name}/hooks/hook.sh && chmod 755 ${COPIES}/${name}/hooks/hook.sh`,
    `echo '{"name":"${name}"}' > ${home}/instance.json`,
    `echo '{}' > ${home}/.claude/settings.json`,
    `echo skill > ${home}/.agents/skills/a/SKILL.md`,
    `echo key > ${home}/.aw/signing.key && echo team > ${home}/.aw/workspace.yaml`,
    `for f in AGENTS.md CLAUDE.md; do echo instructions > ${home}/$f; done`,
    `printf 'TASK-${name} say hi.\\n' > ${home}/TASK.md`,
    `chmod 700 ${home}`,
  ].join(" && "));
  return home;
}

const SANDBOX = { domains: [{ host: "app.aweb.ai", capability: "oats.aweb", setting: "server" }], write: [{ path: EVENTS, reason: "instance events" }], missing: [] };
const launchInput = (home, name, extra = {}) => ({
  home, instance: name, harness: "claude", model: MODEL, yolo: false,
  env: [{ name: "OATS_INSTANCE", value: name, source: "kernel" }], unset: [], args: [],
  promptFile: `${home}/TASK.md`, previous: null, sandbox: SANDBOX, trees: [`${home}/work`, `${home}/trees/extra`, `${home}/trees/clone`], protected: [`${COPIES}/${name}`, RETIREMENT], ...extra,
});
const started = [];
async function launched(name, extra) {
  const home = await makeHome(name);
  const since = (await box.requests()).length;
  const answer = await provider("launch", launchInput(home, name, extra));
  assert.equal(answer.ok, true, JSON.stringify(answer));
  started.push(answer.result.endpoint.threadId);
  await box.firstTurnOver(answer.result.endpoint.threadId, since);
  return { home, endpoint: answer.result.endpoint };
}
const settingsOf = async (home) => JSON.parse(await sh(`cat ${home}/.claude/settings.local.json`));

/** What a sandboxed agent must not be able to change, for one home (rule 1). Each is
 *  written to if it can be; `PLANTED` in any of them afterwards is a failure. */
const protectedPaths = (home) => [
  // the home (its own .git too: git walks up to it from a directory that has none)
  `${home}/.git/config`, `${home}/.git/hooks/pre-commit`,
  `${home}/.oats/modules/hook.sh`, `${home}/.oats/modules/new.sh`, `${home}/instance.json`, `${home}/.claude/settings.json`, `${home}/.claude/commands/x.md`,
  `${home}/.agents/skills/a/SKILL.md`, `${home}/.mcp.json`, `${home}/.aw/signing.key`, `${home}/.aw/workspace.yaml`,
  `${home}/AGENTS.md`, `${home}/CLAUDE.md`, `${home}/CLAUDE.local.md`, `${home}/TASK.md`,
  // every directory above it
  `${INSTANCES}/.mcp.json`, `${INSTANCES}/CLAUDE.md`, `${DEPLOYMENT}/.claude/settings.json`, "/home/node/.mcp.json", "/home/node/CLAUDE.md",
  // the user's Claude configuration
  "/home/node/.claude.json", "/home/node/.claude/settings.json", "/home/node/.claude/commands/x.md",
  // git: the worktree's pointer, and config and hooks of the clone (the test adds the worktree's own git directory)
  `${home}/work/.git`, `${CLONE}/.git/config`, `${CLONE}/.git/hooks/pre-commit`,
  // bb's thread storage
  `${DATA}/thread-storage/.mcp.json`, `${DATA}/thread-storage/CLAUDE.md`, `${DATA}/thread-storage/.claude/settings.json`,
];
const planted = async (paths) => (await sh(`for p in ${paths.map((path) => `'${path}'`).join(" ")} /tmp/bb-provider-bridge-*/PLANTED-HERE; do grep -ls PLANTED "$p" 2>/dev/null; test -e "$p" && case "$p" in */PLANTED-HERE) echo "$p";; esac; done; true`)).split("\n").filter(Boolean);

afterEach(async () => {
  for (const id of started.splice(0)) await sh(`bb thread stop ${id} --json >/dev/null 2>&1 || true`);
  await sh("rm -f mock-next-cmd mock-severity");
});
before(() => box.start(), { timeout: 900_000 });
after(() => box.stop());

test("the image can start Claude Code's sandbox, and readiness says nothing against it", async () => {
  assert.equal((await sh("bb --version")).trim(), BB_VERSION);
  await sh("command -v bwrap && command -v socat && command -v rg");
  // The sandbox makes a user namespace inside this container, and another inside that
  // one (Claude Code's seccomp helper). A host that forbids either (an AppArmor policy on
  // unprivileged user namespaces, a container with too few rights) fails here, by name,
  // before the tests that need the sandbox fail one by one.
  const userns = await sh("bwrap --unshare-user --unshare-pid --ro-bind / / --proc /proc --dev /dev bwrap --unshare-user --ro-bind / / --dev /dev true 2>&1 && echo userns-ok || true");
  assert.match(userns, /userns-ok/, `this host does not let the container make user namespaces, so Claude Code's sandbox cannot start: ${userns.trim().slice(0, 300)}`);
  const { result } = await provider("check", { home: null, soul: null });
  assert.equal(result.status, "ready");
  assert.equal(result.warnings.some((warning) => warning.code === "session-provider-sandbox-unsupported"), false, JSON.stringify(result.warnings));
});

test("bb pre-allows exactly one MCP tool for its Claude, the one that moves a thread's directory: a bb that pre-allows another fails here", async () => {
  // Rule 1 denies what bb pre-allows by name. A bb that pre-allows a tool this test does
  // not name is a bb whose sandboxed modes have not been looked at: stop, and look.
  const { endpoint } = await launched("preallowed", { yolo: true, sandbox: undefined });
  const { argv, allowed } = await preAllowed();
  assert.deepEqual([...allowed], [MOVE_TOOL], `bb's Claude runs with --allowedTools ${JSON.stringify(argv)}`);
  // In full mode nothing is denied: the tool is there for the model to call.
  assert.equal((await settingsOf(`${INSTANCES}/preallowed`)).permissions, undefined);
  assert.ok(endpoint.threadId);
});

/** The tools bb pre-allows for the Claude processes that run now: every `--allowedTools`
 *  argument of every process in the container, with the argument after it where the value
 *  is not joined by "=". → {argv, allowed}. */
async function preAllowed() {
  const argv = (await sh("for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/cmdline 2>/dev/null | grep -A1 -e '^--allowedTools' -e '^--allowed-tools' | grep -v '^--$'; done; true")).split("\n").filter(Boolean);
  const allowed = new Set();
  argv.forEach((arg, at) => {
    if (!/^--allowed-?[tT]ools/.test(arg)) return;
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[at + 1] ?? "";
    for (const tool of value.split(/[, ]+/)) if (tool) allowed.add(tool);
  });
  assert.ok(argv.length > 0, "bb's Claude is running");
  return { argv, allowed };
}

for (const [mode, extra] of [["accept-edits", {}], ["auto", { yolo: null, args: ["--permission-mode", "auto"] }]]) {
  test(`${mode}: a sandboxed launch writes the four keys, and neither Bash nor the file tools change what runs outside the sandbox`, async () => {
    const name = `deny-${mode}`;
    const { home, endpoint } = await launched(name, extra);
    const id = endpoint.threadId;

    // What bb pre-allows for a Claude of this mode: the same one tool, which rule 1 denies.
    assert.deepEqual([...(await preAllowed()).allowed], [MOVE_TOOL]);

    // The four keys the provider owns, as it wrote them.
    const settings = await settingsOf(home);
    // Each worktree's own git directory, as its pointer names it.
    const gitDirOf = async (tree) => (await sh(`cat ${tree}/.git`)).trim().replace(/^gitdir: /, "");
    const gitDir = await gitDirOf(`${home}/work`), extraGitDir = await gitDirOf(`${home}/trees/extra`);
    for (const dir of [gitDir, extraGitDir]) assert.match(dir, new RegExp(`^${CLONE}/\\.git/worktrees/`));
    assert.notEqual(gitDir, extraGitDir);
    assert.deepEqual(Object.keys(settings).sort(), ["env", "permissions", "sandbox"]);
    assert.deepEqual(settings.sandbox, { network: { allowedDomains: ["app.aweb.ai"] }, filesystem: { allowWrite: [EVENTS] } });
    assert.deepEqual(Object.keys(settings.permissions).sort(), ["blockWritesOutsideWorkingDirectories", "deny"]);
    assert.equal(settings.permissions.blockWritesOutsideWorkingDirectories, true);
    assert.equal(settings.permissions.deny.at(-1), MOVE_TOOL);
    for (const path of [`${home}/.oats/**`, `${home}/TASK.md`, `${INSTANCES}/.mcp.json`, "/home/node/.claude.json", "/home/node/.claude/**", "/etc/claude-code/**",
      `${home}/work/.git`, `${gitDir}/config`, `${gitDir}/hooks/**`, `${gitDir}/commondir`, `${gitDir}/gitdir`,
      `${home}/trees/extra/.git`, `${extraGitDir}/config`, `${extraGitDir}/hooks/**`, `${home}/.git/**`,
      `${COPIES}/${name}/**`, `${RETIREMENT}/**`, `${CLONE}/.git/config`, `${CLONE}/.git/hooks/**`, `${DATA}/thread-storage/.mcp.json`, "/tmp/bb-provider-bridge-*/**"]) {
      assert.ok(settings.permissions.deny.includes(`Edit(/${path})`), path);
    }
    // Readiness reports the home sandboxed: the block and both additions stand in its settings.
    assert.ok((await provider("check", { home, soul: null })).result.warnings.some((warning) => warning.code === "session-provider-sandboxed"));

    // Bash, in the sandbox: every listed path, by append, by a new file, by rename and by
    // removal, and by renaming away the directory that holds a denied file. What the agent
    // works in stays writable, and so does what OATS needs. (For the paths outside the
    // home, sandboxed Bash is refused with or without a rule: there the rules are shown by
    // the file tools below. Inside the home, only the rule stands in the way.)
    const paths = [...protectedPaths(home), `${gitDir}/config`, `${gitDir}/hooks/pre-commit`, `${gitDir}/commondir`, `${home}/trees/extra/.git`, `${extraGitDir}/config`, `${extraGitDir}/hooks/pre-commit`,
      // what the kernel keeps outside the home
      `${COPIES}/${name}/hooks/hook.sh`, `${COPIES}/${name}/hooks/new.sh`, `${RETIREMENT}/planted`,
      // the clone tree: what git runs or follows in its .git directory
      `${home}/trees/clone/.git/config`, `${home}/trees/clone/.git/config.worktree`, `${home}/trees/clone/.git/hooks/pre-commit`, `${home}/trees/clone/.git/commondir`, `${home}/trees/clone/.git/gitdir`];
    // bb's plugin directory is where the rule says it is: an attempt on a name that
    // matches nothing would prove nothing.
    const pluginDir = (await sh("ls -d /tmp/bb-provider-bridge-*/ 2>/dev/null | head -1")).trim().replace(/\/$/, "");
    assert.notEqual(pluginDir, "", "bb builds its Claude plugin directory under /tmp/bb-provider-bridge-*");
    // The attempts are a script the test puts in the agent's notes, so Claude's own look
    // at a command line (which asks a person about one it cannot read ahead) is not what
    // answers: the sandbox is.
    const attempt = [
      "#!/bin/sh",
      `for p in ${paths.map((path) => `'${path}'`).join(" ")} /tmp/bb-provider-bridge-*/PLANTED-HERE; do mkdir -p "$(dirname "$p")" 2>/dev/null; (echo PLANTED >> "$p") 2>/dev/null; done`,
      `mv ${home}/TASK.md ${home}/TASK.moved 2>/dev/null; rm -f ${home}/AGENTS.md ${home}/instance.json 2>/dev/null; rm -rf ${home}/.oats 2>/dev/null`,
      // A denied file whose directory carries no rule: rename the directory away, make it anew, write the file.
      `mv ${home}/.aw ${home}/.aw-old 2>/dev/null; mkdir ${home}/.aw 2>/dev/null; (echo PLANTED > ${home}/.aw/workspace.yaml) 2>/dev/null; (echo PLANTED > ${home}/.aw/signing.key) 2>/dev/null`,
      `mv ${home}/work ${home}/work-old 2>/dev/null; mkdir ${home}/work 2>/dev/null; (echo PLANTED > ${home}/work/.git) 2>/dev/null`,
      // The kernel's copy: renamed away with its parent, and run from where it is.
      `mv ${COPIES}/${name} ${COPIES}/${name}-old 2>/dev/null; mv ${COPIES} ${COPIES}-old 2>/dev/null; ${COPIES}/${name}/hooks/hook.sh`,
      // In the clone tree, what the agent works with: a note in .git/info, a file staged.
      `(echo FREE >> ${home}/trees/clone/.git/info/exclude) 2>/dev/null; echo FREE > ${home}/trees/clone/new.txt; git -C ${home}/trees/clone add new.txt 2>/dev/null`,
      `echo FREE > ${home}/notes/bash.txt; echo FREE > ${home}/work/file.txt; echo FREE > ${EVENTS}/bash.jsonl; echo attempted`,
    ].join("\n");
    await sh(`cat > ${home}/notes/attempt.sh`, { input: attempt });
    const bash = await toolCall(id, `sh ${home}/notes/attempt.sh`);
    assert.deepEqual(bash.pending, [], "no prompt: the sandbox refuses, nobody is asked");
    assert.match(bash.result, /attempted/);
    // Never writable, and still read and run at the same path, from inside the sandbox.
    assert.match(bash.result, /ran-from-the-kernel-copy/);
    assert.equal((await sh(`ls -d ${COPIES}-old ${COPIES}/${name}-old 2>/dev/null | wc -l`)).trim(), "0");
    assert.equal((await sh(`cat ${COPIES}/${name}/hooks/hook.sh | wc -l`)).trim(), "2");
    assert.equal((await sh(`ls -A ${home}/.git 2>/dev/null | wc -l`)).trim(), "0", "no .git was made in the home");
    assert.deepEqual(await planted(paths), [], "Bash changed a path the deny rules cover");
    assert.equal((await sh(`cat ${home}/TASK.md ${home}/AGENTS.md ${home}/instance.json ${home}/.oats/modules/hook.sh | wc -l`)).trim(), "5", "nothing was moved or removed");
    assert.equal((await sh(`ls -d ${home}/.aw-old ${home}/work-old 2>/dev/null | wc -l`)).trim(), "0", "a directory that holds a denied file cannot be renamed away");
    assert.equal((await sh(`cat ${home}/.aw/signing.key ${home}/.aw/workspace.yaml`)).trim(), "key\nteam");
    assert.equal(await gitDirOf(`${home}/work`), gitDir, "the worktree's pointer still names its git directory");
    assert.equal((await sh(`cat ${home}/notes/bash.txt ${home}/work/file.txt ${EVENTS}/bash.jsonl | tr '\\n' ' '`)).trim(), "FREE FREE FREE");
    // A tree that is a clone: the rule on its .git makes the whole git directory read-only
    // for sandboxed commands, not only what git runs there. So the agent edits the tree's
    // files and can neither stage nor commit (the README says so): pinned, because a Claude
    // Code that read the rule as the name alone would leave .git/commondir to the agent.
    assert.equal((await sh(`grep -c FREE ${home}/trees/clone/.git/info/exclude || true`)).trim(), "0");
    assert.equal((await sh(`git -C ${home}/trees/clone status --porcelain`)).trim(), "?? new.txt", "the file is written, and not staged");

    // Claude's own file tools: a deny rule refuses each, with no prompt; a path outside the
    // working directories is refused by the switch, whatever it is.
    for (const path of [`${home}/.mcp.json`, `${home}/.oats/modules/new.sh`, `${home}/.aw/signing.key`, `${home}/trees/extra/.git`, `${INSTANCES}/.mcp.json`, "/home/node/.claude/settings.json", `${CLONE}/.git/hooks/pre-commit`, `${extraGitDir}/config`, `${DATA}/thread-storage/.mcp.json`,
      `${COPIES}/${name}/hooks/hook.sh`, `${RETIREMENT}/planted`, `${home}/.git/config`,
      // the one rule with a wildcard inside its path: Claude Code matches it
      `${pluginDir}/PLANTED-HERE`]) {
      const write = await toolCall(id, { tool: "Write", input: { file_path: path, content: "PLANTED\n" } });
      assert.deepEqual(write.pending, [], path);
      // The rule's own refusal, not the switch's: these are paths a rule covers.
      assert.match(write.result, /denied by your permission settings/, path);
    }
    const outside = await toolCall(id, { tool: "Write", input: { file_path: "/home/node/outside-the-home.txt", content: "PLANTED\n" } });
    assert.deepEqual(outside.pending, []);
    assert.match(outside.result, /permissions\.blockWritesOutsideWorkingDirectories setting blocks writes outside the working directories/);
    assert.deepEqual(await planted([...paths, "/home/node/outside-the-home.txt"]), [], "a file tool changed a path it must not");
    const free = await toolCall(id, { tool: "Write", input: { file_path: `${home}/notes/tool.txt`, content: "FREE\n" } });
    assert.deepEqual(free.pending, []);
    assert.equal((await sh(`cat ${home}/notes/tool.txt`)).trim(), "FREE", free.result);

    // bb's directory-move tool is gone for this Claude: it cannot take its work elsewhere.
    const move = await toolCall(id, { tool: MOVE_TOOL, input: { directory: "/home/node" } });
    assert.match(move.result, /No such tool available/);
  });
}

test("a settings file the agent tampered with is rewritten whole at the next launch, and readiness says so until then", async () => {
  const { home, endpoint } = await launched("tamper");
  const first = await settingsOf(home);
  await sh(`bb thread stop ${endpoint.threadId} --json >/dev/null`);
  const tampered = { ...first, sandbox: { filesystem: { allowWrite: ["/"] }, network: { allowedDomains: ["*"] } }, permissions: { allow: ["Bash(*)"], deny: [], blockWritesOutsideWorkingDirectories: false }, env: { OATS_INSTANCE: "someone-else" } };
  await sh(`cat > ${home}/.claude/settings.local.json`, { input: JSON.stringify(tampered) });
  const codes = (await provider("check", { home, soul: null })).result.warnings.map((warning) => warning.code);
  assert.ok(codes.includes("session-provider-sandbox-incomplete") && !codes.includes("session-provider-sandboxed"), JSON.stringify(codes));

  const again = await provider("launch", launchInput(home, "tamper", { previous: endpoint }));
  assert.equal(again.ok, true, JSON.stringify(again));
  started.push(again.result.endpoint.threadId);
  const { permissions, ...rest } = await settingsOf(home);
  const { permissions: firstPermissions, ...firstRest } = first;
  assert.deepEqual(rest, firstRest);
  // `allow` is not the provider's key (Claude writes a person's "don't ask again" there): it stays.
  assert.deepEqual(permissions, { allow: ["Bash(*)"], ...firstPermissions });

  // And a launch in full mode takes the sandbox keys out again.
  await sh(`bb thread stop ${again.result.endpoint.threadId} --json >/dev/null`);
  const full = await provider("launch", launchInput(home, "tamper", { yolo: true, previous: again.result.endpoint }));
  assert.equal(full.ok, true, JSON.stringify(full));
  started.push(full.result.endpoint.threadId);
  assert.deepEqual(await settingsOf(home), { permissions: { allow: ["Bash(*)"] }, env: { OATS_INSTANCE: "tamper" } });
});

// Rule 4: bb lets a command ask to run outside the sandbox, and nothing the provider can
// write stops that. These two tests pin what then happens, so the README's sentence
// ("limit accidents, not a determined agent") is checked against the pinned versions.
// The command is a script in the agent's notes: a plain redirect into a denied path is
// refused by Claude before it runs (it reads the command line), a script is not read.
const ESCAPE = (home) => ({ tool: "Bash", input: { command: `sh ${home}/notes/leave.sh`, description: "scripted", dangerouslyDisableSandbox: true } });
const plantEscape = (home) => sh(`cat > ${home}/notes/leave.sh`, { input: `echo PLANTED >> ${home}/.oats/modules/hook.sh; echo ran\n` });

test("accept-edits: a command that asks to leave the sandbox raises a prompt in bb; approved by a person, it writes past the deny rules", async () => {
  const { home, endpoint } = await launched("leave-ae");
  await plantEscape(home);
  const asked = await toolCall(endpoint.threadId, ESCAPE(home));
  assert.equal(asked.pending.length, 1, "a person is asked");
  assert.equal(asked.pending[0].payload.kind, "approval");
  assert.deepEqual(await planted([`${home}/.oats/modules/hook.sh`]), [], "nothing ran before a person approved");
  await sh(`bb thread interactions approve ${asked.pending[0].id} ${endpoint.threadId} --json >/dev/null`);
  await waitFor("the approved command to run", async () => (await planted([`${home}/.oats/modules/hook.sh`])).length === 1, { timeoutMs: 60_000 });
});

test("auto: a command that asks to leave the sandbox runs with no person asked when the classifier does not flag it, and writes past the deny rules", async () => {
  const { home, endpoint } = await launched("leave-auto", { yolo: null, args: ["--permission-mode", "auto"] });
  await plantEscape(home);
  // The mock grades every action harmless (test/contract/mock-anthropic.mjs).
  const ran = await toolCall(endpoint.threadId, ESCAPE(home));
  assert.deepEqual(ran.pending, [], "nobody is asked");
  assert.match(ran.result, /ran/);
  assert.deepEqual(await planted([`${home}/.oats/modules/hook.sh`]), [`${home}/.oats/modules/hook.sh`]);
});
