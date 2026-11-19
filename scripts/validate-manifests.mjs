#!/usr/bin/env node
// Validate the package's manifests: what a kernel would refuse, and what this repository
// promises (one version everywhere; every command's script inside its capability).
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
const PROVIDER_NAME = /^[a-z0-9-]{1,40}$/;
const PROVIDER_COMMANDS = ["launch", "inspect", "input", "stop"];
const OPTIONAL_PROVIDER_COMMANDS = ["inspectMany"];
const HARNESSES = ["claude", "codex", "pi"];

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

const repoPackage = readJson(join(repoRoot, "package.json"));
const pkg = readJson(join(root, "oats-package.json"));
if (isObject(pkg)) {
  if (typeof pkg.package !== "string" || !/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(pkg.package)) report("oats-package.json", "package must be a dotted id");
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) report("oats-package.json", "version must be a semantic version");
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

    // sessionProviders (contract r7 item 1): the name is 1-40 lowercase letters, digits
    // and dashes, `tmux` is reserved; each command names one of the manifest's commands.
    if (manifest.sessionProviders !== undefined) {
      if (!isObject(manifest.sessionProviders)) report(`${at}#/sessionProviders`, "must be a map");
      for (const [name, provider] of Object.entries(isObject(manifest.sessionProviders) ? manifest.sessionProviders : {})) {
        const here = `${at}#/sessionProviders/${name}`;
        if (!PROVIDER_NAME.test(name)) report(here, "a provider name is 1-40 lowercase letters, digits and dashes");
        if (name === "tmux") report(here, "tmux is the kernel's built-in backend");
        if (!isObject(provider)) { report(here, "must be a map"); continue; }
        for (const key of Object.keys(provider)) if (!["commands", "harnesses", "description"].includes(key)) report(here, `unknown key ${key}`);
        const map = isObject(provider.commands) ? provider.commands : {};
        if (!isObject(provider.commands)) report(`${here}/commands`, "must be a map");
        for (const verb of PROVIDER_COMMANDS) if (!Object.hasOwn(map, verb)) report(`${here}/commands`, `missing ${verb}`);
        for (const [verb, command] of Object.entries(map)) {
          if (![...PROVIDER_COMMANDS, ...OPTIONAL_PROVIDER_COMMANDS].includes(verb)) report(`${here}/commands/${verb}`, "is not a session provider command");
          if (typeof command !== "string" || !Object.hasOwn(commands, command)) report(`${here}/commands/${verb}`, `names ${JSON.stringify(command)}, which is not one of the manifest's commands`);
        }
        if (!Array.isArray(provider.harnesses) || provider.harnesses.length === 0 || provider.harnesses.some((h) => !HARNESSES.includes(h))) report(`${here}/harnesses`, `must be a non-empty list of ${HARNESSES.join(", ")}`);
        if (provider.description !== undefined && typeof provider.description !== "string") report(`${here}/description`, "must be a string");
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
    for (const [i, entry] of (manifest.retirement?.disposable?.home ?? []).entries()) {
      if (typeof entry !== "string" || !/^\.[A-Za-z0-9_][A-Za-z0-9._-]*(-\*)?$/.test(entry)) report(`${at}#/retirement/disposable/home/${i}`, "must name one hidden top-level home entry");
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.stderr.write(`\n${errors.length} manifest problem${errors.length > 1 ? "s" : ""}\n`);
  process.exit(1);
}
process.stdout.write("manifests ok\n");
