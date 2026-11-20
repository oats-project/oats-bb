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

const box = rig({
  name: `oats-bb-contract-sandbox-${process.pid}`,
  image: `oats-bb-contract-sandbox:${BB_VERSION}`,
  dockerfileDir: resolve(here, "sandbox"),
  // What bubblewrap needs to make its namespaces inside a container.
  runArgs: ["--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined", "--security-opt", "systempaths=unconfined"],
  settings: { version: BB_VERSION, trust: "container", dataDir: DATA },
  // Until the provider's own command takes a sandboxed launch: the tests' entry that does.
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
    `printf '#!/bin/sh\\necho hook\\n' > ${home}/.oats/modules/hook.sh`,
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
  promptFile: `${home}/TASK.md`, previous: null, sandbox: SANDBOX, trees: [`${home}/work`], ...extra,
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
  // the home
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
  const { result } = await provider("check", { home: null, soul: null });
  assert.equal(result.status, "ready");
  assert.equal(result.warnings.some((warning) => warning.code === "session-provider-sandbox-unsupported"), false, JSON.stringify(result.warnings));
});

test("bb pre-allows exactly one MCP tool for its Claude, the one that moves a thread's directory: a bb that pre-allows another fails here", async () => {
  // Rule 1 denies what bb pre-allows by name. A bb that pre-allows a tool this test does
  // not name is a bb whose sandboxed modes have not been looked at: stop, and look.
  const { endpoint } = await launched("preallowed", { yolo: true, sandbox: undefined });
  // Every argument of every process in the container that pre-allows tools, with the
  // argument after it where the value is not joined by "=".
  const argv = (await sh("for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/cmdline 2>/dev/null | grep -A1 -e '^--allowedTools' -e '^--allowed-tools' | grep -v '^--$'; done; true")).split("\n").filter(Boolean);
  const allowed = new Set();
  argv.forEach((arg, at) => {
    if (!/^--allowed-?[tT]ools/.test(arg)) return;
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[at + 1] ?? "";
    for (const tool of value.split(/[, ]+/)) if (tool) allowed.add(tool);
  });
  assert.ok(argv.length > 0, "bb's Claude is running");
  assert.deepEqual([...allowed], [MOVE_TOOL], `bb's Claude runs with --allowedTools ${JSON.stringify(argv)}`);
  // In full mode nothing is denied: the tool is there for the model to call.
  assert.equal((await settingsOf(`${INSTANCES}/preallowed`)).permissions, undefined);
  assert.ok(endpoint.threadId);
});

for (const [mode, extra] of [["accept-edits", {}], ["auto", { yolo: null, args: ["--permission-mode", "auto"] }]]) {
  test(`${mode}: a sandboxed launch writes the four keys, and neither Bash nor the file tools change what runs outside the sandbox`, async () => {
    const name = `deny-${mode}`;
    const { home, endpoint } = await launched(name, extra);
    const id = endpoint.threadId;

    // The four keys the provider owns, as it wrote them.
    const settings = await settingsOf(home);
    // The worktree's own git directory, as its pointer names it.
    const gitDir = (await sh(`cat ${home}/work/.git`)).trim().replace(/^gitdir: /, "");
    assert.match(gitDir, new RegExp(`^${CLONE}/\\.git/worktrees/`));
    assert.deepEqual(Object.keys(settings).sort(), ["env", "permissions", "sandbox"]);
    assert.deepEqual(settings.sandbox, { network: { allowedDomains: ["app.aweb.ai"] }, filesystem: { allowWrite: [EVENTS] } });
    assert.deepEqual(Object.keys(settings.permissions).sort(), ["blockWritesOutsideWorkingDirectories", "deny"]);
    assert.equal(settings.permissions.blockWritesOutsideWorkingDirectories, true);
    assert.equal(settings.permissions.deny.at(-1), MOVE_TOOL);
    for (const path of [`${home}/.oats/**`, `${home}/TASK.md`, `${INSTANCES}/.mcp.json`, "/home/node/.claude.json", "/home/node/.claude/**", "/etc/claude-code/**",
      `${home}/work/.git`, `${gitDir}/config`, `${gitDir}/hooks/**`, `${CLONE}/.git/config`, `${CLONE}/.git/hooks/**`, `${DATA}/thread-storage/.mcp.json`, "/tmp/bb-provider-bridge-*/**"]) {
      assert.ok(settings.permissions.deny.includes(`Edit(/${path})`), path);
    }
    // Readiness reports the home sandboxed: the block and both additions stand in its settings.
    assert.ok((await provider("check", { home, soul: null })).result.warnings.some((warning) => warning.code === "session-provider-sandboxed"));

    // Bash, in the sandbox: every listed path, by append, by a new file, by rename and by
    // removal. What the agent works in stays writable, and so does what OATS needs.
    const paths = [...protectedPaths(home), `${gitDir}/config`, `${gitDir}/hooks/pre-commit`];
    // The attempts are a script the test puts in the agent's notes, so Claude's own look
    // at a command line (which asks a person about one it cannot read ahead) is not what
    // answers: the sandbox is.
    const attempt = [
      "#!/bin/sh",
      `for p in ${paths.map((path) => `'${path}'`).join(" ")} /tmp/bb-provider-bridge-*/PLANTED-HERE; do mkdir -p "$(dirname "$p")" 2>/dev/null; (echo PLANTED >> "$p") 2>/dev/null; done`,
      `mv ${home}/TASK.md ${home}/TASK.moved 2>/dev/null; rm -f ${home}/AGENTS.md ${home}/instance.json 2>/dev/null; rm -rf ${home}/.oats 2>/dev/null`,
      `echo FREE > ${home}/notes/bash.txt; echo FREE > ${home}/work/file.txt; echo FREE > ${EVENTS}/bash.jsonl; echo attempted`,
    ].join("\n");
    await sh(`cat > ${home}/notes/attempt.sh`, { input: attempt });
    const bash = await toolCall(id, `sh ${home}/notes/attempt.sh`);
    assert.deepEqual(bash.pending, [], "no prompt: the sandbox refuses, nobody is asked");
    assert.match(bash.result, /attempted/);
    assert.deepEqual(await planted(paths), [], "Bash changed a path the deny rules cover");
    assert.equal((await sh(`cat ${home}/TASK.md ${home}/AGENTS.md ${home}/instance.json ${home}/.oats/modules/hook.sh | wc -l`)).trim(), "5", "nothing was moved or removed");
    assert.equal((await sh(`cat ${home}/notes/bash.txt ${home}/work/file.txt ${EVENTS}/bash.jsonl | tr '\\n' ' '`)).trim(), "FREE FREE FREE");

    // Claude's own file tools: a deny rule refuses each, with no prompt; a path outside the
    // working directories is refused by the switch, whatever it is.
    for (const path of [`${home}/.mcp.json`, `${home}/.oats/modules/new.sh`, `${INSTANCES}/.mcp.json`, "/home/node/.claude/settings.json", `${CLONE}/.git/hooks/pre-commit`, `${DATA}/thread-storage/.mcp.json`]) {
      const write = await toolCall(id, { tool: "Write", input: { file_path: path, content: "PLANTED\n" } });
      assert.deepEqual(write.pending, [], path);
      assert.match(write.result, /denied by your permission settings|blockWritesOutsideWorkingDirectories/, path);
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
