#!/usr/bin/env node
// Validate the package's manifests: what a kernel would refuse, and what this repository
// promises (one version everywhere; every command's script inside its capability).
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCH_CHOICES } from "../oats-package/capabilities/oats-bb/lib/choices.mjs";
import { WIRE } from "../oats-package/capabilities/oats-bb/lib/wire.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "oats-package");
const errors = [];
const report = (path, message) => errors.push(`${path}: ${message}`);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { report(relative(repoRoot, path), `unreadable or invalid JSON (${error.message})`); return undefined; }
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const PROVIDER_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED_PROVIDERS = ["tmux", "herdr", "session-provider"];
const PROVIDER_COMMANDS = ["launch", "inspect", "input", "stop"];
const OPTIONAL_PROVIDER_COMMANDS = ["inspectMany", "check"];
const HARNESSES = ["claude", "codex", "pi"];
// A provider's launch choices (the kernel's feature `launch-choices`): at most 8, each a
// name and a description a client shows as text.
const CHOICE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_CHOICES = 8;
// One line of safe text: no control character, no bidi control, no zero-width or tag character.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b\u2060\ufeff]|[\u{e0000}-\u{e007f}]/u;

/** A command's script: a regular file inside the capability (no link, no way out). */
function checkScript(capDir, command, at) {
  if (typeof command !== "string" || !command.trim()) { report(at, "must be a non-empty command string"); return; }
  const script = command.trim().split(/\s+/)[0];
  const path = resolve(capDir, script);
  if (path !== capDir && !path.startsWith(capDir + sep)) { report(at, `script ${script} is outside the capability`); return; }
  let current = capDir;
  for (const part of relative(capDir, path).split(sep)) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) { report(at, `script ${script} does not exist`); return; }
    if (stat.isSymbolicLink()) { report(at, `script ${script} goes through a link`); return; }
  }
  if (!lstatSync(path).isFile()) report(at, `script ${script} is not a regular file`);
}

// The one bb-app pin of the repository: the provider's default and the contract test read it.
let bbVersion = null;
try { bbVersion = readFileSync(join(repoRoot, "bb-version"), "utf8").trim(); }
catch (error) { report("bb-version", `unreadable (${error.message})`); }
if (bbVersion !== null && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(bbVersion)) report("bb-version", "must hold one bb-app version");

// The floor: an OATS release, ">=<version>". It is the release whose host shutdown marks
// its stop (`reason: "host"`, contract r25, A16): with an older kernel the provider's stop
// would archive a home the kernel means to resume. (Session providers themselves are in
// OATS since 0.70.0: an older kernel would compose the capability and ignore
// `sessionProviders`, failing only at `--backend bb`.)
function floor(manifest, at) {
  if (!isObject(manifest.compatibility) || typeof manifest.compatibility.oats !== "string" || !/^>=\d+\.\d+\.\d+$/.test(manifest.compatibility.oats)) report(at, 'compatibility.oats must be a floor, ">=<version>"');
}

// The OATS release that has the feature `launch-choices`: a kernel without it does not know
// the manifest property `launchChoices`, and takes the whole session provider for malformed
// (OATS 0.70.5: every spawn on bb answers E_BACKEND_UNKNOWN). So a manifest that declares
// launch choices must be floored at that release, in the package and in the capability.
// NOT TAGGED when the choices were written (2026-11-25): null, and the manifests are
// refused until it is set here, with both floors raised to it. Never a guess.
const LAUNCH_CHOICES_FLOOR = null;
const versionOf = (range) => /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range ?? "")?.slice(1).map(Number) ?? null;
const below = (a, b) => { for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
/** The floor a manifest that declares launch choices must have. */
function launchChoicesFloor(manifest, at) {
  if (LAUNCH_CHOICES_FLOOR === null) { report(at, "launch choices are declared, and the OATS release with the feature launch-choices is not named yet: set LAUNCH_CHOICES_FLOOR in scripts/validate-manifests.mjs to that release, and raise compatibility.oats to it in oats-package.json and in the capability's oats.json"); return; }
  const [has, needs] = [versionOf(manifest.compatibility?.oats), versionOf(`>=${LAUNCH_CHOICES_FLOOR}`)];
  if (has === null || needs === null || below(has, needs)) report(at, `compatibility.oats is ${JSON.stringify(manifest.compatibility?.oats)}, and launch choices need OATS ${LAUNCH_CHOICES_FLOOR} or later (the release with the feature launch-choices): an older kernel takes the session provider for malformed`);
}
let declaresLaunchChoices = false;

const repoPackage = readJson(join(repoRoot, "package.json"));
const pkg = readJson(join(root, "oats-package.json"));
if (isObject(pkg)) {
  if (typeof pkg.package !== "string" || !/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(pkg.package)) report("oats-package.json", "package must be a dotted id");
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) report("oats-package.json", "version must be a semantic version");
  floor(pkg, "oats-package.json");
  if (isObject(repoPackage) && repoPackage.version !== pkg.version) report("package.json", `version ${repoPackage.version} differs from oats-package.json's ${pkg.version}`);
  if (!Array.isArray(pkg.capabilities) || pkg.capabilities.length === 0) report("oats-package.json", "capabilities must be a non-empty list");
  const seen = new Set();
  for (const dir of Array.isArray(pkg.capabilities) ? pkg.capabilities : []) {
    const capDir = resolve(root, String(dir));
    const at = `${dir}/oats.json`;
    if (!capDir.startsWith(root + sep)) { report("oats-package.json", `capability directory ${dir} is outside the package`); continue; }
    const manifest = readJson(join(capDir, "oats.json"));
    if (!isObject(manifest)) continue;
    if (typeof manifest.capability !== "string" || !manifest.capability) report(at, "capability must be a non-empty id");
    if (seen.has(manifest.capability)) report(at, `capability ${manifest.capability} is declared twice`);
    seen.add(manifest.capability);
    if (manifest.version !== pkg.version) report(at, `version ${manifest.version} differs from the package's ${pkg.version}`);
    floor(manifest, at);
    if (manifest.compatibility?.oats !== pkg.compatibility?.oats) report(at, "compatibility.oats differs from the package's");
    if (manifest.command !== undefined && (typeof manifest.command !== "string" || !NAME.test(manifest.command))) report(at, "command must be a lowercase namespace");
    if (typeof manifest.description !== "string" || !manifest.description) report(at, "description must be a non-empty string");

    const commands = isObject(manifest.commands) ? manifest.commands : {};
    if (manifest.commands !== undefined && !isObject(manifest.commands)) report(`${at}#/commands`, "must be a map");
    for (const [name, command] of Object.entries(commands)) {
      if (!NAME.test(name)) report(`${at}#/commands/${name}`, "command names are lowercase letters, digits and dashes");
      checkScript(capDir, command, `${at}#/commands/${name}`);
    }
    for (const [event, hook] of Object.entries(isObject(manifest.hooks) ? manifest.hooks : {})) {
      checkScript(capDir, isObject(hook) ? hook.command : hook, `${at}#/hooks/${event}`);
    }

    // sessionProviders (the contract's item 1): the name is 1-40 lowercase letters, digits
    // and dashes, three names are the kernel's; each command names one of the manifest's.
    if (manifest.sessionProviders !== undefined) {
      if (!isObject(manifest.sessionProviders)) report(`${at}#/sessionProviders`, "must be a map");
      for (const [name, provider] of Object.entries(isObject(manifest.sessionProviders) ? manifest.sessionProviders : {})) {
        const here = `${at}#/sessionProviders/${name}`;
        if (!PROVIDER_NAME.test(name)) report(here, "a provider name is 1-40 lowercase letters, digits and dashes");
        if (RESERVED_PROVIDERS.includes(name)) report(here, `${name} is reserved by the kernel`);
        if (!isObject(provider)) { report(here, "must be a map"); continue; }
        for (const key of Object.keys(provider)) if (!["commands", "harnesses", "description", "wire", "launchChoices"].includes(key)) report(here, `unknown key ${key}`);
        // launchChoices: what a person may choose for a launch of this provider, by name. The
        // kernel knows no choice's meaning: the names are the provider's, and the same in its code.
        if (provider.launchChoices !== undefined) {
          declaresLaunchChoices = true;
          launchChoicesFloor(manifest, `${at}#/compatibility/oats`);
          const choices = isObject(provider.launchChoices) ? provider.launchChoices : {};
          if (!isObject(provider.launchChoices)) report(`${here}/launchChoices`, "must be a map");
          if (Object.keys(choices).length > MAX_CHOICES) report(`${here}/launchChoices`, `declares more than ${MAX_CHOICES} choices`);
          for (const [choice, declared] of Object.entries(choices)) {
            const there = `${here}/launchChoices/${choice}`;
            if (!CHOICE_NAME.test(choice)) report(there, "a choice name is a lowercase letter, then up to 39 lowercase letters, digits and dashes");
            if (!isObject(declared)) { report(there, "must be a map"); continue; }
            for (const key of Object.keys(declared)) if (key !== "description") report(there, `unknown key ${key}`);
            if (typeof declared.description !== "string" || declared.description === "" || [...declared.description].length > 200 || UNSAFE_TEXT.test(declared.description)) report(`${there}/description`, "must be one line of at most 200 characters, with no control or bidi character");
          }
          if (name === "bb" && JSON.stringify(Object.keys(choices).sort()) !== JSON.stringify(Object.keys(LAUNCH_CHOICES).sort())) report(`${here}/launchChoices`, `declares ${Object.keys(choices).sort().join(", ") || "none"}, and lib/choices.mjs takes ${Object.keys(LAUNCH_CHOICES).sort().join(", ")}`);
        } else if (name === "bb") report(`${here}/launchChoices`, `is not declared, and lib/choices.mjs takes ${Object.keys(LAUNCH_CHOICES).sort().join(", ")}`);
        // The wire the provider speaks: declared here, and the same in its code.
        if (typeof provider.wire !== "string" || !/^\d+\.\d+$/.test(provider.wire)) report(`${here}/wire`, 'must be the wire version, "<major>.<minor>"');
        else if (name === "bb" && provider.wire !== WIRE) report(`${here}/wire`, `is ${provider.wire}, and lib/wire.mjs speaks ${WIRE}`);
        const map = isObject(provider.commands) ? provider.commands : {};
        if (!isObject(provider.commands)) report(`${here}/commands`, "must be a map");
        for (const verb of PROVIDER_COMMANDS) if (!Object.hasOwn(map, verb)) report(`${here}/commands`, `missing ${verb}`);
        for (const [verb, command] of Object.entries(map)) {
          if (![...PROVIDER_COMMANDS, ...OPTIONAL_PROVIDER_COMMANDS].includes(verb)) report(`${here}/commands/${verb}`, "is not a session provider command");
          if (typeof command !== "string" || !Object.hasOwn(commands, command)) report(`${here}/commands/${verb}`, `names ${JSON.stringify(command)}, which is not one of the manifest's commands`);
        }
        if (!Array.isArray(provider.harnesses) || provider.harnesses.length === 0 || provider.harnesses.some((h) => !HARNESSES.includes(h))) report(`${here}/harnesses`, `must be a non-empty list of ${HARNESSES.join(", ")}`);
        if (provider.description !== undefined && (typeof provider.description !== "string" || provider.description.length > 200 || /[\r\n]/.test(provider.description))) report(`${here}/description`, "must be one line of at most 200 characters");
      }
    }

    for (const [key, setting] of Object.entries(isObject(manifest.settings) ? manifest.settings : {})) {
      const here = `${at}#/settings/${key}`;
      if (!isObject(setting)) { report(here, "must be a map"); continue; }
      if (typeof setting.description !== "string" || !setting.description) report(here, "needs a description");
      if (setting.hostOnly !== undefined && typeof setting.hostOnly !== "boolean") report(here, "hostOnly must be a boolean");
      if (setting.hostOnly === true && setting.committedOnly === true) report(here, "cannot be both hostOnly and committedOnly");
      if (setting.values !== undefined && (!Array.isArray(setting.values) || setting.values.some((v) => typeof v !== "string"))) report(here, "values must be a list of strings");
      if (Array.isArray(setting.values) && setting.default !== undefined && !setting.values.includes(setting.default)) report(here, "default is not one of values");
    }
    if (manifest.sessionProviders?.bb && manifest.settings?.version?.default !== bbVersion) {
      report(`${at}#/settings/version/default`, `is ${JSON.stringify(manifest.settings?.version?.default)}, and bb-version pins ${bbVersion}: the default is the version the contract test runs`);
    }
    for (const [i, entry] of (manifest.retirement?.disposable?.home ?? []).entries()) {
      if (typeof entry !== "string" || !/^\.[A-Za-z0-9_][A-Za-z0-9._-]*(-\*)?$/.test(entry)) report(`${at}#/retirement/disposable/home/${i}`, "must name one hidden top-level home entry");
    }
  }
}

// The package's own floor follows its capabilities': a kernel reads it first.
if (declaresLaunchChoices && LAUNCH_CHOICES_FLOOR !== null && isObject(pkg)) launchChoicesFloor(pkg, "oats-package.json#/compatibility/oats");

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.stderr.write(`\n${errors.length} manifest problem${errors.length > 1 ? "s" : ""}\n`);
  process.exit(1);
}
process.stdout.write("manifests ok\n");
