// The tools the container checks install from a committed lock (container/locks/<tool>/): each
// lock is whole, names its tool at an exact version, and is the lock of the pin it serves. And
// bb's own build toolchain, which bb would otherwise fetch from npm by itself, is in the locks at
// the versions THIS bb-app asks for.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const PLUGIN = join(__dirname, "..");
const CONTAINER = join(PLUGIN, "container");
const LOCKS = join(CONTAINER, "locks");
const tools = readdirSync(LOCKS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

interface Locked {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  /** A package that comes inside another's tarball (npm's own dependencies, in bb-app's tree): not fetched by itself. */
  inBundle?: boolean;
}

/** A lock's tool (the package whose commands go on the PATH), what its package.json asks for, and its lock's packages. */
function lockOf(tool: string): { name: string; asked: Record<string, string>; packages: Record<string, Locked> } {
  const manifest = JSON.parse(readFileSync(join(LOCKS, tool, "package.json"), "utf8")) as { tool?: string; dependencies?: Record<string, string> } & Record<string, unknown>;
  const lock = JSON.parse(readFileSync(join(LOCKS, tool, "package-lock.json"), "utf8")) as { lockfileVersion: number; packages: Record<string, Locked> };
  const asked = manifest.dependencies ?? {};
  expect(typeof manifest.tool === "string" && asked[manifest.tool] !== undefined, `${tool}: its package.json names its tool, a package of its dependencies`).toBe(true);
  expect(lock.lockfileVersion, `${tool}: a lock npm ci reads`).toBeGreaterThanOrEqual(2);
  // `dependencies` is all the lock is asked for: no other section can bring a package into the tree.
  for (const section of ["devDependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies", "overrides", "workspaces"]) {
    expect(manifest[section], `${tool}: its package.json has no ${section}: what it installs is its dependencies and nothing else`).toBeUndefined();
  }
  return { name: manifest.tool!, asked, packages: lock.packages };
}

/** The four packages bb needs to build a plugin, at the versions this bb-app pins: read from bb-app's own server (not typed here). */
function toolchainOfBb(): Record<string, string> {
  const server = readFileSync(join(PLUGIN, "node_modules", "bb-app", "server", "dist", "start-server.js"), "utf8");
  const body = /\bPLUGIN_TOOLCHAIN_PINS\s*=\s*\{([^}]*)\}/.exec(server)?.[1];
  expect(body, "bb-app's server declares PLUGIN_TOOLCHAIN_PINS = { … } (bb changed how it names its build toolchain: read it again, and container/no-toolchain-fetch.sh)").toBeTruthy();
  const pins: Record<string, string> = {};
  for (const [, quoted, bare, version] of body!.matchAll(/(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*"([^"]+)"/g)) pins[(quoted ?? bare)!] = version!;
  return pins;
}

test("there is a lock for each tool the checks install from npm with a tree of its own: bb-app and pi", () => {
  expect(tools).toEqual(["bb-app", "pi"]);
});

test.each(tools)("the lock of %s names its packages at exact versions, and every package of its tree with its integrity", (tool) => {
  const { asked, packages } = lockOf(tool);
  for (const [name, version] of Object.entries(asked)) {
    expect(version, `${tool}: ${name} is asked for at an exact version, not a range`).toMatch(EXACT);
    expect(packages[`node_modules/${name}`]?.version, `${tool}: the lock holds ${name}@${version} (plugin/container/relock.sh ${tool})`).toBe(version);
  }
  const tree = Object.entries(packages).filter(([path]) => path !== "");
  expect(tree.length).toBeGreaterThan(0);
  for (const [path, entry] of tree) {
    expect(entry.link, `${tool}: ${path} is a package of the registry, not a link`).not.toBe(true);
    expect(entry.version, `${tool}: ${path} has a version`).toMatch(/^\d+\.\d+\.\d+/);
    // A bundled package is part of its parent's tarball, which has the integrity; it is fetched from nowhere.
    if (entry.inBundle === true) {
      expect(entry.resolved, `${tool}: ${path} is bundled, and fetched from nowhere`).toBeUndefined();
      continue;
    }
    expect(entry.integrity, `${tool}: ${path} has its integrity`).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    expect(entry.resolved, `${tool}: ${path} comes from the npm registry`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
  }
});

test("pi's lock is the lock of the pi the pi run pins, and of nothing else: its version and its tarball's integrity", () => {
  const setup = readFileSync(join(CONTAINER, "real", "pi", "setup.sh"), "utf8");
  const version = /^PI_VERSION=\$\{PI_VERSION:-(\d+\.\d+\.\d+)\}$/m.exec(setup)?.[1];
  const integrity = /^\s*PI_INTEGRITY=\$\{PI_INTEGRITY-(sha512-[A-Za-z0-9+/=]+)\}$/m.exec(setup)?.[1];
  expect(version, "container/real/pi/setup.sh pins pi as PI_VERSION=${PI_VERSION:-<version>}").toBeTruthy();
  expect(integrity, "container/real/pi/setup.sh pins pi's tarball as PI_INTEGRITY=${PI_INTEGRITY-<integrity>}").toBeTruthy();
  const { name, asked, packages } = lockOf("pi");
  expect(name).toBe("@earendil-works/pi-coding-agent");
  // Whoever moves the pin writes the lock again (plugin/container/relock.sh pi), and the other way round.
  expect(asked, "the lock asks for pi alone, at the run's PI_VERSION").toEqual({ [name]: version });
  expect(packages[`node_modules/${name}`]?.integrity, "the lock's integrity for pi's tarball is the run's PI_INTEGRITY").toBe(integrity);
});

test("bb-app's lock is the lock of the bb-app the plugin pins, with the build toolchain THIS bb-app asks for and nothing else", () => {
  // plugin/package.json pins bb-app for the unit tests and the build, and container/setup.sh holds it
  // equal to the repository's bb-version: the lock the live, real and pi stages install from is that version's.
  const pinned = (JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8")) as { devDependencies: Record<string, string> }).devDependencies["bb-app"];
  const toolchain = toolchainOfBb();
  expect(Object.keys(toolchain).sort(), "bb's build toolchain is four packages").toEqual(["@tailwindcss/node", "@tailwindcss/oxide", "esbuild", "tailwindcss"]);
  const { name, asked } = lockOf("bb-app");
  expect(name).toBe("bb-app");
  // bb fetches its toolchain from npm, with no lock, unless these four resolve at exactly bb's
  // versions from bb-app's own module path: the lock's tree puts them there. A bb whose pins moved
  // fails here (plugin/container/relock.sh bb-app, after the new versions are in its package.json).
  expect(asked, "the lock asks for the pinned bb-app and for bb's own toolchain pins").toEqual({ "bb-app": pinned, ...toolchain });
});

test("the plugin's own bb-app (the unit stage's build) finds bb's build toolchain in the plugin's dev dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies: Record<string, string> };
  for (const [name, version] of Object.entries(toolchainOfBb())) {
    expect(manifest.devDependencies[name], `plugin/package.json has ${name} as a dev dependency at bb's own pin (then: npm install --package-lock-only, with npm 11)`).toBe(version);
    // Never a dependency: a deployment's install of the plugin (bb's, from git) takes `dependencies` only.
    expect(manifest.dependencies?.[name], `${name} is not a dependency of the plugin: a deployment does not install it`).toBeUndefined();
    const installed = JSON.parse(readFileSync(join(PLUGIN, "node_modules", name, "package.json"), "utf8")) as { version: string };
    expect(installed.version, `${name} is installed at the top of the plugin's tree at bb's pin, where the plugin's bb-app resolves it`).toBe(version);
  }
});
