// The team image's recipe, its closed build context and the Compose fragment.
// Dependency-free: Node built-ins only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../../container/${name}`, import.meta.url), "utf8");
const dockerfile = read("Dockerfile");
const instructions = dockerfile.replace(/\\\n/g, " ").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
const declaration = JSON.parse(read("agent-child.json"));

/** [sources, destination] of each COPY. A flag (--from, --chown, --link) is refused. */
const copies = instructions.filter((line) => line.startsWith("COPY")).map((line) => {
  const tokens = line.split(/\s+/).slice(1);
  assert.ok(tokens.every((token) => !token.startsWith("--")), "plain COPY from the context only");
  assert.ok(tokens.length >= 2, line);
  return [tokens.slice(0, -1), tokens.at(-1)];
});

test("the image adds only pinned bb-app to a team image passed by argument", () => {
  assert.deepEqual(instructions.slice(0, 2), ["ARG AGENT_IMAGE", "FROM ${AGENT_IMAGE}"], "the team image is a build argument without a default");
  assert.equal(instructions.filter((line) => /^(?:ARG|FROM)\b/.test(line)).length, 2, "one stage, one argument");
  assert.deepEqual([...new Set(instructions.map((line) => line.split(/\s+/, 1)[0]))].sort(), ["ARG", "COPY", "FROM", "RUN", "USER", "WORKDIR"], "no ENV, ENTRYPOINT, CMD, EXPOSE, VOLUME or ADD: the team image's stay");
  assert.deepEqual(instructions.filter((line) => /^(?:USER|WORKDIR)\b/.test(line)), ["USER root", "WORKDIR /opt/bb", "WORKDIR /state", "USER agent"], "root only for the install; it ends as the agent in /state");
  assert.deepEqual(instructions.slice(-2).sort(), ["USER agent", "WORKDIR /state"]);

  const runs = instructions.filter((line) => line.startsWith("RUN"));
  assert.equal(runs.length, 1);
  const steps = runs[0].slice(4).split("&&").map((step) => step.trim().replace(/\s+/g, " "));
  assert.equal(steps[0], "npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/bb-npm", "the committed lock, no lifecycle script");
  assert.doesNotMatch(dockerfile, /apt-get|\bapt\b|\bapk\b|\bdpkg\b|\bcurl\b|\bwget\b|\bgit\b|npm rebuild|npm install|npm i\b|\bnpx\b|ignore-scripts=false|https?:/, "no OS package, no download tool, no rebuild, no second install");
  assert.ok(steps.includes("ln -s /opt/bb/node_modules/.bin/bb /usr/local/bin/bb"));
  assert.ok(steps.includes("ln -s /opt/bb/node_modules/.bin/bb-app /usr/local/bin/bb-app"));
  assert.equal(declaration.command[0], "/usr/local/bin/bb-app", "the declared command is the link the image makes");
  assert.deepEqual(declaration.version.command, ["/usr/local/bin/bb", "--version"]);

  // The declaration: copied to its fixed path, then made a root-owned 0644 regular file.
  assert.deepEqual(copies, [[["package.json", "package-lock.json"], "./"], [["agent-child.json"], "/etc/agent-child.json"]]);
  for (const step of ["test ! -L /etc/agent-child.json", "test -f /etc/agent-child.json", "chown 0:0 /etc/agent-child.json", "chmod 0644 /etc/agent-child.json"]) assert.ok(steps.includes(step), step);

  // The version file: the path the declaration names, holding the pin, which bb itself must report.
  const at = (step) => { const index = steps.indexOf(step); assert.notEqual(index, -1, step); return index; };
  const named = at(`version_file="$(node -p 'require("/etc/agent-child.json").version.file')"`);
  const written = at(`node -p 'require("./package.json").dependencies["bb-app"]' > "$version_file"`);
  const checked = at(`test "$(bb --version)" = "$(cat "$version_file")"`);
  assert.ok(at(steps[0]) < named && named < written && written < checked, "install, name the file, write the pin, check bb against it");
  assert.ok(steps.includes(`chmod 0644 "$version_file"`));

  const manifest = JSON.parse(read("package.json")), lock = JSON.parse(read("package-lock.json"));
  assert.deepEqual(Object.keys(manifest).sort(), ["dependencies", "name", "private", "version"], "no scripts, no second dependency group");
  assert.deepEqual(Object.keys(manifest.dependencies), ["bb-app"]);
  assert.match(manifest.dependencies["bb-app"], /^\d+\.\d+\.\d+$/, "an exact version, not a range");
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(lock.packages["node_modules/bb-app"].version, manifest.dependencies["bb-app"]);
  let platformPackages = 0;
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.doesNotMatch(name, /claude-code|@anthropic-ai/, "bb uses the team image's Claude Code; a second one never enters the image");
    // Packages inside a tarball (bb-app's own npm) are covered by that tarball's hash.
    if (pkg.inBundle) { assert.match(name, /^node_modules\/npm\/node_modules\//); continue; }
    assert.match(pkg.integrity, /^sha512-/, name);
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//, name);
    // npm 10 drops `libc`, and `npm ci` then also installs the musl build of a platform package.
    if (/-(?:glibc|musl)$/.test(name)) { platformPackages += 1; assert.deepEqual(pkg.libc, [name.match(/-(glibc|musl)$/)[1]], name); }
  }
  assert.ok(platformPackages > 0, "the lock holds platform packages, each with its libc");
});

test("the fragment sets one fixed environment entry and nothing else", () => {
  const fragment = read("compose.agent.child.yaml");
  // No YAML parser here: the file is small enough to pin line by line.
  const lines = fragment.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
  assert.deepEqual(lines, ["services:", "  agent:", "    environment:", `      AGENT_CHILD: "${declaration.name}"`]);
  assert.equal(declaration.name, "bb", "the switch names the declared child");
  assert.doesNotMatch(fragment, /\$/, "nothing is interpolated");
  assert.doesNotMatch(fragment, /\t/);
});

test("every Dockerfile COPY source is admitted by the closed build context", () => {
  const rules = read(".dockerignore").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  assert.equal(rules.shift(), "**", "the context starts closed");
  const admitted = rules.map((rule) => { assert.match(rule, /^![A-Za-z0-9][A-Za-z0-9._-]*$/, "one plain file name per rule"); return rule.slice(1); });
  const copied = copies.flatMap(([sources]) => sources);
  for (const source of copied) {
    assert.match(source, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, "a plain file of this directory");
    assert.ok(admitted.includes(source), `${source} is copied but not admitted`);
  }
  assert.deepEqual(admitted.sort(), ["Dockerfile", ...copied].sort(), "the relay, the fragment, the README and everything else stay out of the image");
});
