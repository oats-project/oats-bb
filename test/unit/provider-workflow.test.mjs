// The provider workflow's shape. No YAML parser (dependency-free), so these are checks on
// its text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/provider.yml", import.meta.url), "utf8");
const code = workflow.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

test("the provider workflow reads the repository only, pins every action by commit and reads no secret", () => {
  assert.equal(code.match(/^permissions:\n(?: +.*\n)+/m)?.[0], "permissions:\n  contents: read\n", "one permission, at the top");
  assert.equal(code.match(/permissions:/g).length, 1, "no job widens it");
  const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses) assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${action} is pinned by commit`);
  assert.equal(code.match(/persist-credentials: false/g).length, code.match(/actions\/checkout@/g).length, "no checkout keeps a credential");
  assert.doesNotMatch(code, /secrets\.|pull_request_target|workflow_run|docker login|packages: write/);
});

test("a pull request runs the provider's jobs only for what its tests read; every push to main runs them", () => {
  const paths = ["oats-package/**", "test/**", "scripts/**", "bb-version", "package.json", "plugin/package.json", "container/**",
    ".github/workflows/container.yml", ".github/workflows/provider.yml"];
  // The whole `on:` block, compared entire: a path added or dropped, a filter on push, another trigger changes it.
  const on = code.match(/^on:\n(?:(?: +.*)?\n)+/m)?.[0].replace(/\n+$/, "\n");
  const list = paths.map((path) => `      - "${path}"\n`).join("");
  assert.equal(on, `on:\n  pull_request:\n    paths:\n${list}  push:\n    branches: [main]\n`);
  assert.equal(code.match(/^on:$/gm).length, 1);
});

// The second contract file runs Claude Code's sandbox inside its container, which makes a
// user namespace inside bubblewrap's. Ubuntu's AppArmor forbids that through a profile it
// attaches to /usr/bin/bwrap by path (bwrap-userns-restrict), which an unconfined
// container's bwrap matches too. The job lifts exactly that, on its own throwaway runner,
// before the contract test, and nothing wider.
test("the contract job lets its container make user namespaces: one sysctl and two AppArmor profiles unloaded on the job's own runner, before the test, and nothing wider", () => {
  const contract = code.slice(code.indexOf("\n  contract:"));
  const step = contract.match(/- name: Let the contract container make user namespaces\n\s+run: \|\n((?: {10}.*\n)+)/)?.[1];
  assert.ok(step, "the step is there");
  assert.deepEqual(step.split("\n").map((line) => line.trim()).filter(Boolean), [
    "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
    "for profile in bwrap-userns-restrict unprivileged_userns; do",
    'if [ -e /etc/apparmor.d/$profile ]; then sudo apparmor_parser -R /etc/apparmor.d/$profile && echo "removed $profile"; fi',
    "done",
  ]);
  assert.ok(contract.indexOf("Let the contract container make user namespaces") < contract.indexOf("run: npm run test:contract"), "before the contract test");
  // Only that step uses sudo, and only in the contract job; no container runs privileged.
  assert.equal(code.slice(0, code.indexOf("\n  contract:")).includes("sudo"), false, "the unit jobs change nothing on their runner");
  assert.equal(contract.match(/sudo /g).length, 2);
  assert.doesNotMatch(code, /--privileged|--cap-add|aa-teardown|apparmor.*stop|setenforce/);
  assert.match(contract, /runs-on: ubuntu-latest/, "a forge-hosted runner, thrown away after the job");
});
