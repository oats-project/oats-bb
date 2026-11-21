// Nothing in bb's pi may hold the agent's mail stream (contract r23, A12(3)).
//
// A bb pi home's mail is delivered by the host wake broker, which presents it as an input
// to the home's thread. bb starts more pi processes than the thread's: a hidden one per
// bridge worker that lists models (its "catalog" pi), with the home as its working
// directory and every user extension loaded. With the aweb extension for pi (@awebai/pi)
// in the pi configuration bb's server runs with, each of them connects to aweb as the
// agent: the hidden one takes the mail as a turn nobody sees (seen at bb-app 0.50.1, pi
// 1.5.2), beside the broker. And without @awebai/oats-pi there, pi loads none of the
// home's skills, and nothing says so.
//
// So a pi launch is refused unless the pi configuration bb's server runs with lists
// @awebai/oats-pi, and does not list @awebai/pi. That configuration is the operator's, or
// the team image's, to set: the provider only reads it, and never changes it. One other
// state is accepted beside an @awebai/pi that is listed: AWEB_DELIVERY among the
// variables bb sets for every process it runs (its machine env), which silences the
// extension in bb's pi processes and reaches no pi outside bb. bb shows no value of its
// env, so the name is what can be read; the remedy names the value.
//
// Which directory that configuration is, bb does not say, and the provider cannot read the
// bb server's own environment: `settings.oats.bb.piAgentDir` names it (pi's
// PI_CODING_AGENT_DIR as bb's server has it; default: .pi/agent in the home of the user
// that runs bb). What is read there is settings.json's `packages`, by the packages' npm
// names. A package installed from a local path or a git URL, or an extension loaded by an
// `extensions` entry or dropped into the directory, is not recognised by name.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isObject } from "./errors.mjs";

export const PI_BRIDGE = "@awebai/oats-pi";
export const PI_AWEB_EXTENSION = "@awebai/pi";
export const DELIVERY_VARIABLE = "AWEB_DELIVERY";
const READ_MAX = 1024 * 1024;

/** Whether a `packages` entry of pi's settings names the npm package: a plain string or an
 *  object's `source`, `npm:<name>` with or without a version. */
function names(entry, name) {
  const source = typeof entry === "string" ? entry : isObject(entry) && typeof entry.source === "string" ? entry.source : null;
  if (source === null || !source.startsWith("npm:")) return false;
  const spec = source.slice("npm:".length);
  return spec === name || spec.startsWith(`${name}@`);
}

/** What `<agentDir>/settings.json` says of the two packages. → { bridge, listener } (each
 *  true when listed), or { unreadable: <why> } for a file that is there and cannot be
 *  read as pi's settings. A directory with no settings.json lists nothing. */
export function readPiPackages(agentDir) {
  const file = join(agentDir, "settings.json");
  let fd;
  try {
    // Never blocks on a FIFO at the path; the descriptor is then checked to be a file.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { unreadable: "it is not a regular file" };
    if (stat.size > READ_MAX) return { unreadable: `it is larger than ${READ_MAX} bytes` };
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) { const n = readSync(fd, bytes, read, stat.size - read, read); if (n === 0) break; read += n; }
    let doc;
    try { doc = JSON.parse(bytes.subarray(0, read).toString("utf8")); } catch { return { unreadable: "it is not JSON" }; }
    if (!isObject(doc)) return { unreadable: "it is not a JSON object" };
    if (doc.packages !== undefined && !Array.isArray(doc.packages)) return { unreadable: "its packages is not a list" };
    const packages = doc.packages ?? [];
    return { bridge: packages.some((entry) => names(entry, PI_BRIDGE)), listener: packages.some((entry) => names(entry, PI_AWEB_EXTENSION)) };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { bridge: false, listener: false };
    return { unreadable: `it cannot be read (${error?.code ?? "an error"})` };
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
  }
}

export const absolutePath = (value) => typeof value === "string" && isAbsolute(value) && !value.includes("\0");
/** What a `piAgentDir` that is no absolute path is answered with: by every launch and every
 *  readiness read, as a setting of the wrong shape (the value is not shown). */
export const PI_AGENT_DIR_SHAPE = Object.freeze({ code: "E_BACKEND_SETTINGS", status: "needs-configuration", message: "settings.oats.bb.piAgentDir must be an absolute path: the pi configuration directory bb's server runs pi with (its PI_CODING_AGENT_DIR). Set it in oats-local.yaml, or remove it for the default (.pi/agent in the home of the user that runs bb)" });

/** Why bb's pi must not run an OATS home now, by its configuration. `globalEnvNames()` →
 *  the names of bb's machine env, asked only when @awebai/pi is listed; it may throw a
 *  ProviderError, which the caller turns into its own problem. → problems
 *  [{code, status, message}] in the order a person would fix them. */
export async function piConfigurationProblems(agentDir, globalEnvNames) {
  if (!absolutePath(agentDir)) return [{ ...PI_AGENT_DIR_SHAPE }];
  // In each message: what is wrong, the remedy, and last the file that was read, which may be
  // long: the kernel relays 500 characters, and a cut must take the path, never the remedy.
  const found = readPiPackages(agentDir);
  if (found.unreadable !== undefined) {
    return [{ code: "E_BACKEND_NOT_READY", status: "needs-configuration", message: `bb's pi configuration cannot be checked: its settings.json is there and ${found.unreadable}. A pi launch needs ${PI_BRIDGE} listed there and ${PI_AWEB_EXTENSION} not: fix the file, or point settings.oats.bb.piAgentDir at the directory bb's server uses. Read: ${join(agentDir, "settings.json")}` }];
  }
  const problems = [];
  if (!found.bridge) {
    problems.push({ code: "E_BACKEND_NOT_READY", status: "needs-configuration", message: `bb's pi would load none of the home's skills, and nothing would say so: ${PI_BRIDGE} is not in bb's pi configuration. Install it there (PI_CODING_AGENT_DIR=<that directory> pi install npm:${PI_BRIDGE}), or point settings.oats.bb.piAgentDir at the directory bb's server uses. Read: ${join(agentDir, "settings.json")}` });
  }
  if (found.listener && !(await globalEnvNames()).includes(DELIVERY_VARIABLE)) {
    // The remedy before the path, which may be long: the kernel relays 500 characters.
    problems.push({ code: "E_BACKEND_PI_LISTENER", status: "needs-configuration", message: `bb's pi would take this agent's mail: ${PI_AWEB_EXTENSION} is in bb's pi configuration, and every pi bb starts (a hidden one too) connects to aweb as the agent. Give bb's server a pi configuration without it (PI_CODING_AGENT_DIR, and settings.oats.bb.piAgentDir), or silence it in bb's processes only: printf session | bb machine env set ${DELIVERY_VARIABLE}. Read: ${join(agentDir, "settings.json")}` });
  }
  return problems;
}
