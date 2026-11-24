// The tools the container checks install from a committed lock (container/locks/<tool>/): each
// lock is whole, names one package at an exact version, and is the lock of the pin it serves.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const CONTAINER = join(__dirname, "..", "container");
const LOCKS = join(CONTAINER, "locks");
const tools = readdirSync(LOCKS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

interface Locked {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  /** A package that comes inside another's tarball (npm's own dependencies, in bb-app's tree): not fetched by itself. */
  inBundle?: boolean;
}

/** A tool's one package, the version its package.json asks for, and its lock's packages. */
function lockOf(tool: string): { name: string; asked: string; packages: Record<string, Locked> } {
  const manifest = JSON.parse(readFileSync(join(LOCKS, tool, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const lock = JSON.parse(readFileSync(join(LOCKS, tool, "package-lock.json"), "utf8")) as { lockfileVersion: number; packages: Record<string, Locked> };
  const names = Object.keys(manifest.dependencies ?? {});
  expect(names, `${tool}: its package.json names one package`).toHaveLength(1);
  expect(lock.lockfileVersion, `${tool}: a lock npm ci reads`).toBeGreaterThanOrEqual(2);
  return { name: names[0]!, asked: manifest.dependencies![names[0]!]!, packages: lock.packages };
}

test("there is a lock for each tool the checks install from npm with a tree of its own: bb-app and pi", () => {
  expect(tools.sort()).toEqual(["bb-app", "pi"]);
});

test.each(tools)("the lock of %s names one package at an exact version, and every package of its tree with its integrity", (tool) => {
  const { name, asked, packages } = lockOf(tool);
  expect(asked, `${tool}: ${name} is asked for at an exact version, not a range`).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  expect(packages[`node_modules/${name}`]?.version, `${tool}: the lock is the lock of ${name}@${asked} (plugin/container/relock.sh ${tool})`).toBe(asked);
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

test("pi's lock is the lock of the pi the pi run pins: its version and its tarball's integrity", () => {
  const setup = readFileSync(join(CONTAINER, "real", "pi", "setup.sh"), "utf8");
  const version = /^PI_VERSION=\$\{PI_VERSION:-(\d+\.\d+\.\d+)\}$/m.exec(setup)?.[1];
  const integrity = /^\s*PI_INTEGRITY=\$\{PI_INTEGRITY-(sha512-[A-Za-z0-9+/=]+)\}$/m.exec(setup)?.[1];
  expect(version, "container/real/pi/setup.sh pins pi as PI_VERSION=${PI_VERSION:-<version>}").toBeTruthy();
  expect(integrity, "container/real/pi/setup.sh pins pi's tarball as PI_INTEGRITY=${PI_INTEGRITY-<integrity>}").toBeTruthy();
  const { name, asked, packages } = lockOf("pi");
  expect(name).toBe("@earendil-works/pi-coding-agent");
  // Whoever moves the pin writes the lock again (plugin/container/relock.sh pi), and the other way round.
  expect(asked, "the lock's pi is the run's PI_VERSION").toBe(version);
  expect(packages[`node_modules/${name}`]?.integrity, "the lock's integrity for pi's tarball is the run's PI_INTEGRITY").toBe(integrity);
});

test("bb-app's lock is the lock of the bb-app the plugin pins", () => {
  // plugin/package.json pins bb-app for the unit tests and the build, and container/setup.sh holds it
  // equal to the repository's bb-version: the lock the live, real and pi stages install from is that version's.
  const pinned = (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { devDependencies: Record<string, string> }).devDependencies["bb-app"];
  const { name, asked } = lockOf("bb-app");
  expect(name).toBe("bb-app");
  expect(asked, "the lock's bb-app is plugin/package.json's (plugin/container/relock.sh bb-app)").toBe(pinned);
});
