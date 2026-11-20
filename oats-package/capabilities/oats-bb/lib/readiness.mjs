// Is this bb fit to run an OATS home? (contract items 6a, 7, 8.) One set of checks, read by
// `oats readiness` (the provider's check command) and run by every launch before it
// touches anything. Each finding is {code, message, status}; `status` is the readiness
// wire's word for it (needs-configuration, authorization-required or unavailable).
import { existsSync } from "node:fs";
import { bbClient } from "./bb.mjs";
import { ProviderError, isObject } from "./errors.mjs";
import { exposedListeners } from "./exposure.mjs";
import { currentSandbox, readLaunchRecord } from "./local-settings.mjs";
import { TRUST_VALUES, loopbackOrigin, portOf } from "./settings.mjs";
import { isLive } from "./threads.mjs";

// Each read's own cap. Every read is also cut at the call's deadline (`left`), so a bb
// that hangs still gets a named problem inside the kernel's time, never a killed check.
const HTTP_TIMEOUT_MS = 4_000;
const PROVIDER_STATE_TIMEOUT_MS = 6_000;
// bb's provider health words (bb plugins/provider-claude-code provider-maintenance).
const PROVIDER_STATUS = { not_installed: "needs-configuration", unsupported_version: "needs-configuration", unauthenticated: "authorization-required", expired: "authorization-required", unknown: "unavailable" };

const HTTP_MAX_BYTES = 256 * 1024;

/** GET a JSON document from bb, read-only: a loopback address (the callers pass only
 *  origins that passed loopbackOrigin), no redirect followed, bounded in time and in size.
 *  Resolves { ok: true, value } or { ok: false, message }; never throws. */
async function getJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(Math.max(1, timeoutMs)), redirect: "error", headers: { accept: "application/json" } });
    if (!response.ok) { await response.body?.cancel(); return { ok: false, message: `HTTP ${response.status}` }; }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > HTTP_MAX_BYTES) return { ok: false, message: `an answer larger than ${HTTP_MAX_BYTES} bytes` };
      chunks.push(chunk);
    }
    try { return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; }
    catch { return { ok: false, message: "an answer that is not JSON" }; }
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message;
    return { ok: false, message: error?.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)} s` : cause ? `${error.message} (${cause})` : String(error?.message ?? error) };
  }
}

/** Every reason this bb must not run a home now, in the order a person would fix them.
 *  → { problems, server, daemon, bb, listable, credential } (the addresses as origins,
 *  null when refused; `listable` when bb's CLI runs and its server answers; `credential`
 *  names where bb's Claude takes its credential from, when bb reports it ready). */
export async function backendProblems(settings, { deadline = Date.now() + 16_000, env = process.env, http = getJson, exposure = exposedListeners } = {}) {
  const problems = [];
  const add = (code, status, message) => problems.push({ code, message, status });
  const left = (cap) => Math.min(cap, deadline - Date.now());

  // Trust: bb's loopback port is open to every local user's processes, unlike tmux's
  // socket in its 0700 directory. Someone must have said who shares this machine.
  if (!TRUST_VALUES.includes(settings.trust)) {
    add("E_BACKEND_TRUST", "needs-configuration", settings.trust == null
      ? "settings.oats.bb.trust is not set. bb's API has no login and its loopback port is reachable by every local user's processes: set it in oats-local.yaml to single-user (this host is one person's) or container (one OATS team container with one bb server)"
      : `settings.oats.bb.trust is ${JSON.stringify(settings.trust)}; it must be single-user or container`);
  }
  if (settings.version == null) {
    add("E_BACKEND_VERSION", "needs-configuration", "settings.oats.bb.version is not set: pin the bb-app version this deployment runs (the output of `bb --version`)");
  }

  let server = null, daemon = null, cliRuns = settings.version == null, credential = null;
  for (const [name, set] of [["server", (origin) => { server = origin; }], ["daemon", (origin) => { daemon = origin; }]]) {
    try { set(loopbackOrigin(settings[name], name)); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      add(error.code, "needs-configuration", error.message);
    }
  }

  const bb = bbClient({ cli: settings.cli, server: server ?? undefined, deadline, env });
  if (settings.version != null) {
    try {
      const version = await bb.version();
      cliRuns = true;
      if (version !== settings.version) {
        add("E_BACKEND_VERSION", "needs-configuration", `bb is ${version}, and settings.oats.bb.version pins ${settings.version}: install bb-app@${settings.version}, or move the pin with the image's`);
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      add("E_BACKEND_VERSION", "needs-configuration", `the bb version could not be read (${error.message})`);
    }
  }

  if (server && daemon) {
    const open = await exposure([portOf(server), portOf(daemon)]);
    if (open.length > 0) {
      add("E_BACKEND_EXPOSED", "needs-configuration", `bb answers off loopback, at ${open.join(", ")}. Its API has no login and runs commands: bind it to 127.0.0.1 (no BB_SERVER_BIND_HOST=0.0.0.0), and reach it from other devices through a Tailscale Serve route`);
    }
  }

  if (server) {
    const health = await http(`${server}/health`, left(HTTP_TIMEOUT_MS));
    if (!health.ok || !isObject(health.value) || health.value.ok !== true) {
      add("E_BACKEND_UNREACHABLE", "unavailable", `bb's server at ${server} does not answer (${health.ok ? "its /health is not ok" : health.message}): start bb-app, or set settings.oats.bb.server`);
      return { problems, server, daemon, bb, listable: false, credential };
    }
  }
  if (daemon) {
    // The server's /health answers before the host daemon is up; threads need the daemon.
    const status = await http(`${daemon}/status`, left(HTTP_TIMEOUT_MS));
    if (!status.ok) {
      add("E_BACKEND_UNREACHABLE", "unavailable", `bb's host daemon at ${daemon} does not answer (${status.message}): start bb-app, or set settings.oats.bb.daemon`);
    } else if (!isObject(status.value) || typeof status.value.connected !== "boolean") {
      add("E_BACKEND_NOT_READY", "unavailable", `bb's host daemon at ${daemon} answered a /status this provider cannot read (no "connected": true or false)`);
    } else if (status.value.connected !== true) {
      add("E_BACKEND_NOT_READY", "unavailable", `bb's host daemon at ${daemon} is not connected to its server yet`);
    } else if (server && typeof status.value.serverUrl === "string" && originOf(status.value.serverUrl) !== server) {
      add("E_BACKEND_NOT_READY", "needs-configuration", `the host daemon at ${daemon} serves ${status.value.serverUrl}, not settings.oats.bb.server ${server}: point both settings at one bb`);
    }
  }
  if (server) {
    const state = await http(`${server}/api/v1/system/providers/state?providerId=claude-code`, left(PROVIDER_STATE_TIMEOUT_MS));
    const provider = state.ok && isObject(state.value) && Array.isArray(state.value.providers)
      ? state.value.providers.find((entry) => isObject(entry) && entry.providerId === "claude-code") : null;
    if (!provider || typeof provider.status !== "string") {
      add("E_BACKEND_NOT_READY", "unavailable", `bb did not report its claude-code provider's status (${state.ok ? "no claude-code entry" : state.message})`);
    } else if (provider.status !== "ready") {
      const hint = typeof provider.loginCommand === "string" && PROVIDER_STATUS[provider.status] === "authorization-required" ? `: run \`${provider.loginCommand}\` as bb's user, or give bb's server the credential in its environment` : "";
      const detail = typeof provider.statusMessage === "string" && provider.statusMessage ? ` (${provider.statusMessage.slice(0, 300)})` : "";
      add("E_BACKEND_NOT_READY", PROVIDER_STATUS[provider.status] ?? "unavailable", `bb reports its claude-code provider as ${provider.status}${detail}${hint}`);
    } else {
      // Where the credential comes from, by bb's own report; never the credential, and
      // no account name.
      credential = typeof provider.accountEmail === "string" && provider.accountEmail
        ? "a Claude login of bb's user"
        : "no Claude login: a credential in bb's own configuration or in the bb server's environment";
    }
  }
  return { problems, server, daemon, bb, listable: server !== null && cliRuns, credential };
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return null; }
}

/** Live bb threads whose project root no longer exists: what a retire that could not
 *  reach bb, or an older kernel's retire, left behind. → warnings, one per root. */
async function orphanedThreads(bb, { exists = existsSync } = {}) {
  const [projects, threads] = [await bb.projects(), await bb.threads()];
  const warnings = [];
  for (const project of projects) {
    if (!isObject(project) || !Array.isArray(project.sources)) continue;
    const roots = project.sources.filter((source) => isObject(source) && typeof source.path === "string").map((source) => source.path);
    if (roots.length === 0 || roots.some((root) => exists(root))) continue;
    const ids = threads.filter((thread) => isLive(thread) && thread.projectId === project.id).map((thread) => thread.id);
    if (ids.length === 0) continue;
    warnings.push({ code: "session-provider-orphaned", message: `bb thread${ids.length > 1 ? "s" : ""} ${ids.join(", ")} of project ${project.id} ${ids.length > 1 ? "have" : "has"} no home: the project root ${roots.join(", ")} no longer exists. Archive ${ids.length > 1 ? "them" : "it"} in bb (bb thread archive <id>)` });
  }
  return warnings;
}

/** The readiness result: {status, problems, warnings}, the shape `oats readiness` relays
 *  as a providers item. `status` is ready (no problem), needs-configuration,
 *  authorization-required or unavailable. `credential` is for a person's report only. */
export async function readinessResult(settings, options = {}) {
  const { problems, bb, listable, credential } = await backendProblems(settings, options);
  const warnings = [];
  if (listable) {
    try { warnings.push(...await orphanedThreads(bb, options)); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      warnings.push({ code: "session-provider-orphans-unchecked", message: `bb's threads could not be listed, so orphaned threads were not looked for (${error.message})` });
    }
  }
  const order = ["needs-configuration", "authorization-required", "unavailable"];
  const status = problems.length === 0 ? "ready" : order.find((word) => problems.some((problem) => problem.status === word));
  return { result: { status, problems: problems.map(({ code, message }) => ({ code, message })), warnings }, credential };
}

// Hosts that serve everyone's repositories: allowing one for a knowledge base's remote
// allows the whole forge, not only that base.
const GENERAL_FORGES = new Set(["github.com", "gitlab.com", "bitbucket.org", "codeberg.org", "dev.azure.com", "git.sr.ht"]);

/** What the provider added to the home's sandbox at its last launch, with who asked for
 *  each entry: readiness lists it (contract item 6). → warnings; none in full mode or
 *  before a first launch. */
export function sandboxWarnings(home) {
  let current, launched;
  try { current = currentSandbox(home); launched = readLaunchRecord(home); }
  catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return [{ code: "session-provider-sandbox-unread", message: "what the provider added to this home's sandbox could not be read: its record or .claude/settings.local.json in the home is not what the provider wrote. The next launch refuses or rewrites it" }];
  }
  const warnings = [];
  if (launched && launched.mode !== null && launched.mode !== "full" && !launched.sandboxGiven) {
    // A kernel that hands a launch no sandbox allowances: bb's sandbox then blocks OATS's
    // own commands, and nothing in the home says so but this.
    warnings.push({ code: "session-provider-sandbox-missing", message: `this home runs in bb's ${launched.mode} mode, and its launch carried no sandbox allowances: bb's sandbox blocks the agent's aw (no network to the messaging server) and oats instance attention (no write to the deployment's events). Run it in full mode (--yolo), or on a kernel that hands the launch its allowances` });
  }
  if (current.domains.length > 0 || current.write.length > 0) {
    const hosts = current.domains.map((entry) => `${entry.host} (${entry.capability}${entry.setting ? `, its setting ${entry.setting}` : ""})`);
    const paths = current.write.map((entry) => `${entry.path} (the kernel${entry.reason ? `: ${entry.reason}` : ""})`);
    warnings.push({ code: "session-provider-sandbox", message: `in bb's sandboxed modes this home's Claude may also reach ${hosts.length ? hosts.join(", ") : "no added host"} and write ${paths.length ? paths.join(", ") : "no added path"}: what OATS's own operation needs, written by the provider into the home's .claude/settings.local.json at launch` });
    const forges = current.domains.filter((entry) => GENERAL_FORGES.has(entry.host.split(":")[0]));
    if (forges.length > 0) {
      warnings.push({ code: "session-provider-sandbox-forge", message: `${forges.map((entry) => `${entry.host} (${entry.capability})`).join(", ")} ${forges.length > 1 ? "are general forges" : "is a general forge"}: allowing it opens every repository there to this agent's commands, not only the one it was allowed for` });
    }
  }
  if (current.mismatch > 0) {
    // The home is writable by its own agent: say that the two disagree, and print nothing
    // of what either holds beyond what passed the checks above.
    warnings.push({ code: "session-provider-sandbox-mismatch", message: `${current.mismatch} entr${current.mismatch > 1 ? "ies" : "y"} of the provider's sandbox record in this home ${current.mismatch > 1 ? "are" : "is"} not in .claude/settings.local.json, or not an exact host or path: the record or the file was changed after the launch. Read the file itself for what the sandbox allows now; the next launch rewrites both` });
  }
  return warnings;
}
