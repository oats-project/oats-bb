// The container workflow's shape. No YAML parser (dependency-free), so these
// are checks on its text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/container.yml", import.meta.url), "utf8");
const code = workflow.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

test("the container workflow reads the repository only, pins every action by commit and writes to no registry", () => {
  assert.equal(code.match(/^permissions:\n(?: +.*\n)+/m)?.[0], "permissions:\n  contents: read\n", "one permission, at the top");
  assert.equal(code.match(/permissions:/g).length, 1, "no job widens it");
  const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses) assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${action} is pinned by commit`);
  assert.equal(code.match(/persist-credentials: false/g).length, code.match(/actions\/checkout@/g).length, "no checkout keeps a credential");
  assert.doesNotMatch(code, /docker (?:image )?push|docker login|skopeo|buildx.*--push|ghcr\.io|packages: write|secrets\./, "nothing is published and no secret is read");
  assert.doesNotMatch(code, /pull_request_target|workflow_run/);
});

test("the container workflow builds the base from one pinned OATS commit and runs that checkout's own acceptance with the fragment", () => {
  const pins = [...workflow.matchAll(/\b[0-9a-f]{40}\b/g)].map((match) => match[0]).filter((sha) => !code.includes(`@${sha}`));
  assert.equal(pins.length, 1, "one OATS commit, on one line");
  assert.match(code, new RegExp(`^env:\\n  OATS_COMMIT: ${pins[0]}\\n`, "m"));
  assert.doesNotMatch(pins[0], /^0+$/, "a real commit");
  assert.match(code, /repository: oats-project\/oats\n\s+ref: \$\{\{ env\.OATS_COMMIT \}\}\n\s+path: oats\n/);
  assert.match(code, /run: test "\$\(git -C oats rev-parse HEAD\)" = "\$OATS_COMMIT"/);

  const runs = [...code.matchAll(/run: (docker build .*|bash .*)/g)].map((match) => match[1]);
  assert.deepEqual(runs, [
    'docker build --platform linux/amd64 --tag "$BASE_IMAGE" oats/container/agent',
    'docker build --platform linux/amd64 --build-arg "AGENT_IMAGE=$BASE_IMAGE" --tag "$AGENT_IMAGE" oats-bb/container',
    "bash .github/scripts/team-image-accept.sh",
  ], "the base, this image from it, then the OATS checkout's fixture script");
  assert.match(code, /working-directory: oats\n\s+run: bash \.github\/scripts\/team-image-accept\.sh\n\s+env:\n\s+AGENT_CHILD: bb\n\s+AGENT_CHILD_FRAGMENT: \$\{\{ github\.workspace \}\}\/oats-bb\/container\/compose\.agent\.child\.yaml\n/);
  assert.doesNotMatch(code, /\bsed\b|\bpatch\b|git apply|>> ?oats\/|> ?oats\//, "the OATS checkout is used as committed");

  for (const line of ["OATS commit: `%s`", "Base team image: `%s`", "Team image for bb: `%s`"]) assert.ok(code.includes(line), line);
  assert.match(code, />> "\$GITHUB_STEP_SUMMARY"/);
  assert.ok(code.indexOf("GITHUB_STEP_SUMMARY") < code.indexOf("team-image-accept.sh"), "recorded before acceptance, so a failed run shows them too");
});

test("the container workflow runs only for the image, its tests, the pin and itself, and runs the image's unit tests", () => {
  const paths = ["container/**", "test/unit/container-*.test.mjs", "bb-version", ".github/workflows/container.yml"];
  // The whole `on:` block, compared entire: a path added to or dropped from either list, another
  // trigger or a paths-ignore changes it.
  const on = code.match(/^on:\n(?:(?: +.*)?\n)+/m)?.[0].replace(/\n+$/, "\n");
  const list = paths.map((path) => `      - "${path}"\n`).join("");
  assert.equal(on, `on:\n  pull_request:\n    paths:\n${list}  push:\n    branches: [main]\n    paths:\n${list}  workflow_dispatch:\n`);
  assert.equal(code.match(/^on:$/gm).length, 1);
  // A filter that left out this file or the tests would let a change to either go unproven.
  assert.match(code, /working-directory: oats-bb\n\s+run: node --test test\/unit\/container-\*\.test\.mjs\n/);
  assert.ok(code.indexOf("node --test test/unit/container-") < code.indexOf("docker build"), "the unit tests run before any image is built");
  const setup = code.indexOf("actions/setup-node@");
  assert.ok(setup !== -1 && setup < code.indexOf("node --test test/unit/container-"), "on the Node version the job sets up");
  // No command of any kind runs before them, so nothing is installed for them.
  assert.equal(code.match(/^\s*(?:- )?run: (.*)$/m)?.[1], "node --test test/unit/container-*.test.mjs", "the unit tests are the job's first command");
});
