// One bb-app version for the whole repository: the root bb-version file. The
// team image, the provider's default and the plugin's build all follow it.
// Dependency-free on purpose: the provider's job runs this without installing
// anything.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const json = (path) => JSON.parse(read(path));

const parts = (version) => {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version);
  assert.ok(match, `unsupported version in a range: ${JSON.stringify(version)}`);
  return { given: match.slice(1).filter((part) => part !== undefined).length, numbers: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] };
};
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether `version` (x.y.z) is inside an npm-style range: comparators
 * joined by spaces (and) and `||` (or), with `^`, `~` and partial versions.
 * A form it does not know, anywhere in the range, fails the test rather than
 * passing it: the whole range is read before any of it decides. */
export function contains(range, version) {
  const wanted = parts(version).numbers;
  const read = (comparator) => {
    const match = /^(>=|<=|>|<|=|\^|~)?v?(.+)$/.exec(comparator);
    return { operator: match[1] ?? "=", ...parts(match[2]) };
  };
  const one = ({ operator, given, numbers }) => {
    const order = compare(wanted, numbers);
    // The first version after everything a partial or a caret/tilde admits.
    const after = (index) => numbers.map((number, at) => (at < index ? number : at === index ? number + 1 : 0));
    if (operator === ">=") return order >= 0;
    if (operator === ">") return given === 3 ? order > 0 : compare(wanted, after(given - 1)) >= 0;
    if (operator === "<") return order < 0;
    if (operator === "<=") return given === 3 ? order <= 0 : compare(wanted, after(given - 1)) < 0;
    if (operator === "=") return given === 3 ? order === 0 : order >= 0 && compare(wanted, after(given - 1)) < 0;
    if (operator === "~") return order >= 0 && compare(wanted, after(given === 1 ? 0 : 1)) < 0;
    // Caret: up to the first nonzero part given.
    const lead = numbers.findIndex((number, at) => number > 0 || at === given - 1);
    return order >= 0 && compare(wanted, after(lead)) < 0;
  };
  const alternatives = range.split("||").map((alternative) => {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    assert.ok(comparators.length, `empty alternative in range ${JSON.stringify(range)}`);
    return comparators.map(read);
  });
  return alternatives.some((comparators) => comparators.every(one));
}

test("bb-version is the one pin: the container's dependency and lock, the provider's default and the plugin's dev dependency equal it, and the plugin's engines range contains it", () => {
  const pin = read("bb-version").trim();
  assert.match(pin, /^\d+\.\d+\.\d+$/, "bb-version holds one exact bb-app version");

  assert.equal(json("container/package.json").dependencies["bb-app"], pin, "container/package.json");
  const lock = json("container/package-lock.json");
  assert.equal(lock.packages[""].dependencies["bb-app"], pin, "container/package-lock.json, the root's dependency");
  assert.equal(lock.packages["node_modules/bb-app"].version, pin, "container/package-lock.json, the resolved bb-app");

  const provider = "oats-package/capabilities/oats-bb/oats.json";
  if (existsSync(new URL(provider, root))) assert.equal(json(provider).settings.version.default, pin, `${provider}, settings.version.default`);

  if (existsSync(new URL("plugin/package.json", root))) {
    const plugin = json("plugin/package.json");
    assert.equal(plugin.devDependencies["bb-app"], pin, "plugin/package.json, devDependencies");
    const range = plugin.engines?.bb;
    if (range !== undefined) assert.ok(contains(range, pin), `plugin/package.json engines.bb ${JSON.stringify(range)} must contain ${pin}`);
  }

  // The range check itself, so a wrong answer cannot hide a moved pin.
  for (const [range, version, inside] of [
    [">=0.50.1 <0.51", "0.50.1", true], [">=0.50.1 <0.51", "0.50.9", true], [">=0.50.1 <0.51", "0.51.0", false], [">=0.50.1 <0.51", "0.50.0", false],
    ["0.50.1", "0.50.1", true], ["0.50.1", "0.50.2", false], ["=0.50", "0.50.7", true], ["0.50", "0.51.0", false],
    ["^0.50.1", "0.50.3", true], ["^0.50.1", "0.51.0", false], ["^1.2.3", "1.9.0", true], ["^1.2.3", "2.0.0", false], ["^0.0.3", "0.0.4", false],
    ["~0.50.1", "0.50.9", true], ["~0.50.1", "0.51.0", false], ["~1", "1.9.9", true], ["~1", "2.0.0", false],
    [">0.50", "0.50.9", false], [">0.50", "0.51.0", true], ["<=0.50", "0.50.9", true], ["<=0.50", "0.51.0", false], [">0.50.1", "0.50.1", false], ["<=0.50.1", "0.50.1", true],
    ["<0.50 || >=0.50.1", "0.50.1", true], ["<0.50 || >=0.50.2", "0.50.1", false],
  ]) assert.equal(contains(range, version), inside, `${range} and ${version}`);
  for (const range of ["0.50.x", "*", ">=0.50.1 - 0.51", "latest", "", ">=0.50.1 <0.51 || latest", ">=0.50.1 <0.51 ||", "<0.40 latest", ">=0.50.1 <0.51 || 0.50.x"]) assert.throws(() => contains(range, "0.50.1"), /unsupported version|empty alternative/, `an unknown range form fails: ${JSON.stringify(range)}`);
});
