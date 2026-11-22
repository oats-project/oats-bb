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

test("the image adds only pinned bb-app, pi and the OATS pi bridge to a team image passed by argument", () => {
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
  assert.ok(steps.includes("ln -s /opt/bb/node_modules/.bin/pi /usr/local/bin/pi"));
  assert.equal(declaration.command[0], "/usr/local/bin/bb-server", "the declared command is the script the image installs, which runs the bb-app link");
  assert.deepEqual(declaration.version.command, ["/usr/local/bin/bb", "--version"]);

  // The declaration: copied to its fixed path, then made a root-owned 0644 regular file.
  assert.deepEqual(copies, [[["package.json", "package-lock.json"], "./"], [["agent-child.json"], "/etc/agent-child.json"], [["pi-settings.json"], "/opt/bb/pi/settings.json"], [["bb-server.sh"], "/usr/local/bin/bb-server"]]);
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
  assert.deepEqual(Object.keys(manifest.dependencies), ["bb-app", "@earendil-works/pi-coding-agent", "@awebai/oats-pi"]);
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: an exact version, not a range`);
    assert.equal(lock.packages[`node_modules/${name}`].version, version, `${name}: the lock resolves the pin`);
  }
  assert.equal(lock.packages["node_modules/@awebai/pi"], undefined, "the aweb extension for pi never enters the image: bb's pi must not hold an agent's mail stream");
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(lock.packages["node_modules/bb-app"].version, manifest.dependencies["bb-app"]);
  let platformPackages = 0;
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.doesNotMatch(name, /claude-code/, "bb uses the team image's Claude Code; a second one never enters the image");
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

// pi, for bb's pi threads (the provider's README, "pi"): bb's server runs pi with a
// configuration of its own, which the image owns.
test("bb's pi configuration lists the OATS pi bridge at the locked version and nothing else, and the image checks it against what it installed", () => {
  const settings = JSON.parse(read("pi-settings.json"));
  const manifest = JSON.parse(read("package.json"));
  assert.deepEqual(settings, { packages: [`npm:@awebai/oats-pi@${manifest.dependencies["@awebai/oats-pi"]}`] }, "no other package, no other key: above all not @awebai/pi");
  const steps = instructions.find((line) => line.startsWith("RUN")).slice(4).split("&&").map((step) => step.trim().replace(/\s+/g, " "));
  for (const step of [
    // The package where pi looks for one it installed, as a link to the locked copy.
    "mkdir -p /opt/bb/pi/npm/node_modules/@awebai",
    "ln -s /opt/bb/node_modules/@awebai/oats-pi /opt/bb/pi/npm/node_modules/@awebai/oats-pi",
    // Root-owned: the agent cannot change what bb's pi loads.
    "chown -R 0:0 /opt/bb/pi",
    "chmod 0644 /opt/bb/pi/settings.json",
    "test ! -L /usr/local/bin/bb-server",
    "chown 0:0 /usr/local/bin/bb-server",
    "chmod 0755 /usr/local/bin/bb-server",
    // The settings name the version that was installed, and pi is the locked pi.
    `test "$(node -p 'require("/opt/bb/pi/settings.json").packages.join()')" = "npm:@awebai/oats-pi@$(node -p 'require("./package.json").dependencies["@awebai/oats-pi"]')"`,
    `test "$(node -p 'require("/opt/bb/pi/npm/node_modules/@awebai/oats-pi/package.json").version')" = "$(node -p 'require("./package.json").dependencies["@awebai/oats-pi"]')"`,
    `test "$(pi --version)" = "$(node -p 'require("./package.json").dependencies["@earendil-works/pi-coding-agent"]')"`,
  ]) assert.ok(steps.includes(step), step);
  // The directory pi runs with is on the state volume (pi writes into it; the image is read-only), and is not the agents' own.
  assert.equal(declaration.env.PI_CODING_AGENT_DIR, "/state/home/.bb-pi");
  assert.notEqual(declaration.env.PI_CODING_AGENT_DIR, "/state/home/.pi/agent");
});

test("bb-server links the image's pi settings and package into bb's pi directory at every start, whatever stands there, and then runs bb-app with its arguments", async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, readlinkSync, readFileSync: readNow, rmSync, existsSync, lstatSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "oats-bb-server-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = read("bb-server.sh");
  assert.ok(script.startsWith("#!/bin/sh\n"));
  assert.match(script, /\nset -eu\n/);
  assert.ok(script.trimEnd().endsWith('exec /usr/local/bin/bb-app "$@"'), "bb-app takes the script's place: the supervisor's signals reach bb itself");
  // The script as it is, with its two fixed paths pointed into a scratch directory.
  assert.equal(script.split("/opt/bb/pi/").length, 2, "one place names the image's pi configuration");
  assert.equal(script.split("/usr/local/bin/bb-app").length, 2, "one place names bb-app");
  const image = join(dir, "image-pi"), agentDir = join(dir, "state/home/.bb-pi"), ran = join(dir, "ran");
  mkdirSync(join(image, "npm"), { recursive: true });
  writeFileSync(join(image, "settings.json"), read("pi-settings.json"));
  writeFileSync(join(dir, "bb-app"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${ran}\n`, { mode: 0o755 });
  const local = join(dir, "bb-server");
  writeFileSync(local, script.replace("/opt/bb/pi/", `${image}/`).replace("/usr/local/bin/bb-app", join(dir, "bb-app")), { mode: 0o755 });
  const run = (env) => spawnSync("/bin/sh", [local, "--no-in-app-updates", "--server-bind-host", "127.0.0.1"], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

  // A first start: the directory is made, with the two links.
  let result = run({ PI_CODING_AGENT_DIR: agentDir });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readNow(ran, "utf8"), "--no-in-app-updates\n--server-bind-host\n127.0.0.1\n");
  assert.equal(readlinkSync(join(agentDir, "settings.json")), join(image, "settings.json"));
  assert.equal(readlinkSync(join(agentDir, "npm")), join(image, "npm"));

  // An agent replaced both, and pi wrote its own state beside them: a start puts the image's back, and keeps pi's state.
  rmSync(join(agentDir, "settings.json")); rmSync(join(agentDir, "npm"));
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:@awebai/pi"] }));
  mkdirSync(join(agentDir, "npm/node_modules/@awebai/pi"), { recursive: true });
  writeFileSync(join(agentDir, "trust.json"), "{}");
  rmSync(ran);
  result = run({ PI_CODING_AGENT_DIR: agentDir });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(lstatSync(join(agentDir, "settings.json")).isSymbolicLink());
  assert.deepEqual(JSON.parse(readNow(join(agentDir, "settings.json"), "utf8")), JSON.parse(read("pi-settings.json")));
  assert.equal(readlinkSync(join(agentDir, "npm")), join(image, "npm"));
  assert.equal(existsSync(join(agentDir, "npm/node_modules/@awebai/pi")), false);
  assert.equal(readNow(join(agentDir, "trust.json"), "utf8"), "{}");
  assert.equal(existsSync(ran), true);

  // With no directory named, bb is not started at all.
  rmSync(ran);
  for (const env of [{}, { PI_CODING_AGENT_DIR: "" }]) {
    result = run(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PI_CODING_AGENT_DIR is not set/);
    assert.equal(existsSync(ran), false);
  }
});
