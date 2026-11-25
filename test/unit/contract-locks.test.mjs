// The contract images install their npm tools from committed locks (test/contract/locks/<image>/,
// README.md there): each lock is whole, names its packages at exact versions, and is the lock of
// the pins it serves; and no contract image resolves a tree with `npm install` when it is built.
// Dependency-free: checks on the files' text.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const json = (path) => JSON.parse(read(path));
const LOCKS = "test/contract/locks/";
const names = readdirSync(new URL(LOCKS, root), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const BB_VERSION = read("bb-version").trim();
// Each contract image, and the lock it installs from.
const IMAGES = { "test/contract/Dockerfile": "claude", "test/contract/sandbox/Dockerfile": "claude", "test/contract/pi/Dockerfile": "pi" };
/** A Dockerfile's instructions: its lines that are not comments, continuations joined. */
const instructions = (path) => read(path).split("\n").filter((line) => !line.trim().startsWith("#")).join("\n").replace(/\s*\\\n\s*/g, " ");

test("there is a lock for each tree the contract images install from npm: the Claude images' and the pi image's", () => {
  assert.deepEqual(names, ["claude", "pi"]);
  assert.deepEqual([...new Set(Object.values(IMAGES))].sort(), names, "every lock has an image, and every image a lock");
});

for (const name of names) {
  test(`the lock of ${name} asks for exact versions and nothing but dependencies, names its tools among them, and holds every package of its tree with its integrity`, () => {
    const manifest = json(`${LOCKS}${name}/package.json`), lock = json(`${LOCKS}${name}/package-lock.json`);
    // `dependencies` is all the lock is asked for: no other section can bring a package into the tree.
    for (const section of ["devDependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies", "overrides", "workspaces", "scripts"]) {
      assert.equal(manifest[section], undefined, `${name}: its package.json has no ${section}`);
    }
    const asked = Object.entries(manifest.dependencies ?? {});
    assert.ok(asked.length > 0);
    assert.ok(Array.isArray(manifest.tools) && manifest.tools.length > 0 && manifest.tools.every((tool) => typeof manifest.dependencies[tool] === "string"), `${name}: its tools are packages of its dependencies`);
    assert.ok(lock.lockfileVersion >= 2, `${name}: a lock npm ci reads`);
    assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies, `${name}: the lock was written from this package.json (test/contract/relock.sh ${name})`);
    for (const [dependency, version] of asked) {
      assert.match(version, EXACT, `${name}: ${dependency} is asked for at an exact version, not a range`);
      assert.equal(lock.packages[`node_modules/${dependency}`]?.version, version, `${name}: the lock holds ${dependency}@${version} (test/contract/relock.sh ${name})`);
    }
    const tree = Object.entries(lock.packages).filter(([path]) => path !== "");
    assert.ok(tree.length >= asked.length);
    for (const [path, entry] of tree) {
      assert.notEqual(entry.link, true, `${name}: ${path} is a package of the registry, not a link`);
      assert.match(entry.version ?? "", /^\d+\.\d+\.\d+/, `${name}: ${path} has a version`);
      // A bundled package is part of its parent's tarball, which has the integrity; it is fetched from nowhere.
      if (entry.inBundle === true) { assert.equal(entry.resolved, undefined, `${name}: ${path} is bundled, and fetched from nowhere`); continue; }
      assert.match(entry.integrity ?? "", /^sha512-[A-Za-z0-9+/]+=*$/, `${name}: ${path} has its integrity`);
      assert.match(entry.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, `${name}: ${path} comes from the npm registry`);
    }
  });
}

test("every lock is the lock of the pinned bb-app (bb-version), and the locks agree on the packages they share", () => {
  const asked = Object.fromEntries(names.map((name) => [name, json(`${LOCKS}${name}/package.json`).dependencies]));
  for (const name of names) assert.equal(asked[name]["bb-app"], BB_VERSION, `${name}: bb-app is the repository's pin; write the lock again when it moves (test/contract/locks/README.md)`);
  for (const [dependency, version] of Object.entries(asked.claude)) assert.equal(asked.pi[dependency], version, `${dependency}: one version in both locks`);
});

test("bb's build toolchain is in every lock, at the versions the plugin's lock holds for this bb-app: bb fetches it from npm by itself where it is not in bb-app's tree", () => {
  // (The plugin's unit test holds that lock against the four versions bb-app's own server pins.)
  const { "bb-app": bb, ...toolchain } = json("plugin/container/locks/bb-app/package.json").dependencies;
  assert.equal(bb, BB_VERSION);
  assert.deepEqual(Object.keys(toolchain).sort(), ["@tailwindcss/node", "@tailwindcss/oxide", "esbuild", "tailwindcss"]);
  for (const name of names) {
    const asked = json(`${LOCKS}${name}/package.json`);
    for (const [dependency, version] of Object.entries(toolchain)) assert.equal(asked.dependencies[dependency], version, `${name}: ${dependency} at bb-app's own version (test/contract/locks/README.md, "bb's build toolchain")`);
    assert.ok(Object.keys(toolchain).every((dependency) => !asked.tools.includes(dependency)), `${name}: the toolchain is bb's to load, and puts no command on the PATH`);
  }
});

test("the pi lock's kernel is the provider's floor: the kernel the provider asks for at least is the one its pi contract test runs", () => {
  const floor = json("oats-package/capabilities/oats-bb/oats.json").compatibility.oats;
  assert.equal(floor, `>=${json(`${LOCKS}pi/package.json`).dependencies["@awebai/oats"]}`);
});

for (const [dockerfile, name] of Object.entries(IMAGES)) {
  test(`${dockerfile} installs from the lock of ${name} with npm ci, is told the pinned bb-app and checks it, and resolves nothing with npm install`, () => {
    const code = instructions(dockerfile);
    assert.doesNotMatch(code, /\bnpm\s+(install|i|add|update|exec)\b|\bnpx\b/, "no tree is resolved when the image is built");
    assert.ok(code.includes(`COPY --chown=node:node locks/install.sh locks/${name}/package.json locks/${name}/package-lock.json /home/node/tools/\n`), "the lock and its install script are what the build copies");
    assert.ok(code.includes(`RUN sh /home/node/tools/install.sh && test "$(bb --version)" = "\${BB_APP_VERSION:?`), "the tree is installed from the lock, and its bb-app held against the pin the build is told");
    assert.equal(code.match(/^ARG BB_APP_VERSION$/gm)?.length, 1, "the pin has no default: the test passes bb-version");
  });
}

test("the install script installs with npm ci alone, and the images' build context is the locks and the pi image's two files", () => {
  const script = read(`${LOCKS}install.sh`).split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.match(script, /\bnpm ci --no-audit --no-fund\b/);
  assert.doesNotMatch(script, /\bnpm\s+(install|i|add|update)\b|\bnpx\b/);
  assert.deepEqual(read("test/contract/.dockerignore").split("\n").filter((line) => line !== "" && !line.startsWith("#")), ["*", "!locks/", "!pi/models.json", "!pi/contract-dialog.ts"]);
});
